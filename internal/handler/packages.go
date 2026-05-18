package handler

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"miaomiaowux/internal/storage"
	"miaomiaowux/internal/substore"

	"github.com/google/uuid"
)

// PackageListHandler 处理列出所有包模板
type PackageListHandler struct {
	repo *storage.TrafficRepository
}

func NewPackageListHandler(repo *storage.TrafficRepository) *PackageListHandler {
	return &PackageListHandler{repo: repo}
}

func (h *PackageListHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	packages, err := h.repo.ListPackages(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"packages": packages,
	})
}

// PackageCreateHandler 处理创建新的包模板
type PackageCreateHandler struct {
	repo *storage.TrafficRepository
}

func NewPackageCreateHandler(repo *storage.TrafficRepository) *PackageCreateHandler {
	return &PackageCreateHandler{repo: repo}
}

type createPackageRequest struct {
	Name           string                     `json:"name"`
	Description    string                     `json:"description"`
	TrafficLimitGB float64                    `json:"traffic_limit_gb"`
	CycleDays      int                        `json:"cycle_days"`
	IsReset        bool                       `json:"is_reset"`
	ResetDay       int                        `json:"reset_day"`
	Nodes          []int64                    `json:"nodes"`
	SpeedLimitMbps float64                    `json:"speed_limit_mbps"`
	DeviceLimit    int                        `json:"device_limit"`
	AutoSpeedRules []storage.AutoSpeedLimitRule `json:"auto_speed_rules"`
}

func (h *PackageCreateHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req createPackageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 验证必填字段
	if req.Name == "" {
		http.Error(w, "Package name is required", http.StatusBadRequest)
		return
	}

	if req.TrafficLimitGB <= 0 {
		http.Error(w, "Traffic limit must be greater than 0", http.StatusBadRequest)
		return
	}

	if req.CycleDays <= 0 {
		http.Error(w, "Duration days must be greater than 0", http.StatusBadRequest)
		return
	}

	if req.IsReset && (req.ResetDay < 1 || req.ResetDay > 31) {
		http.Error(w, "Reset day must be between 1 and 31", http.StatusBadRequest)
		return
	}

	// 如果 nil 则初始化空节点数组
	nodes := req.Nodes
	if nodes == nil {
		nodes = []int64{}
	}

	pkg := storage.Package{
		Name:              req.Name,
		Description:       req.Description,
		TrafficLimitGB:    req.TrafficLimitGB,
		TrafficLimitBytes: int64(req.TrafficLimitGB * 1024 * 1024 * 1024),
		CycleDays:         req.CycleDays,
		IsReset:           req.IsReset,
		ResetDay:          req.ResetDay,
		Nodes:             nodes,
		SpeedLimitMbps:    req.SpeedLimitMbps,
		DeviceLimit:       req.DeviceLimit,
		AutoSpeedRules:    req.AutoSpeedRules,
	}

	id, err := h.repo.CreatePackage(r.Context(), pkg)
	if err != nil {
		if err == storage.ErrPackageExists {
			http.Error(w, "Package with this name already exists", http.StatusConflict)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      id,
		"message": "Package created successfully",
	})
}

// PackageUpdateHandler 处理更新现有包模板
type PackageUpdateHandler struct {
	repo         *storage.TrafficRepository
	remoteManage *RemoteManageHandler
	pusher       *LimiterConfigPusher
}

func NewPackageUpdateHandler(repo *storage.TrafficRepository, remoteManage *RemoteManageHandler, pusher *LimiterConfigPusher) *PackageUpdateHandler {
	return &PackageUpdateHandler{repo: repo, remoteManage: remoteManage, pusher: pusher}
}

type updatePackageRequest struct {
	ID             int64                       `json:"id"`
	Name           string                      `json:"name"`
	Description    string                      `json:"description"`
	TrafficLimitGB float64                     `json:"traffic_limit_gb"`
	CycleDays      int                         `json:"cycle_days"`
	IsReset        bool                        `json:"is_reset"`
	ResetDay       int                         `json:"reset_day"`
	Nodes          []int64                     `json:"nodes"`
	SpeedLimitMbps float64                     `json:"speed_limit_mbps"`
	DeviceLimit    int                         `json:"device_limit"`
	AutoSpeedRules []storage.AutoSpeedLimitRule `json:"auto_speed_rules"`
}

func (h *PackageUpdateHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req updatePackageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 验证必填字段
	if req.ID <= 0 {
		http.Error(w, "Invalid package ID", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Package name is required", http.StatusBadRequest)
		return
	}

	if req.TrafficLimitGB <= 0 {
		http.Error(w, "Traffic limit must be greater than 0", http.StatusBadRequest)
		return
	}

	if req.CycleDays <= 0 {
		http.Error(w, "Duration days must be greater than 0", http.StatusBadRequest)
		return
	}

	if req.IsReset && (req.ResetDay < 1 || req.ResetDay > 31) {
		http.Error(w, "Reset day must be between 1 and 31", http.StatusBadRequest)
		return
	}

	// 如果 nil 则初始化空节点数组
	nodes := req.Nodes
	if nodes == nil {
		nodes = []int64{}
	}

	// 获取旧套餐的节点列表，用于后续计算差异
	var oldNodes []int64
	if oldPkg, err := h.repo.GetPackage(r.Context(), req.ID); err == nil {
		oldNodes = oldPkg.Nodes
	}

	pkg := storage.Package{
		ID:                req.ID,
		Name:              req.Name,
		Description:       req.Description,
		TrafficLimitGB:    req.TrafficLimitGB,
		TrafficLimitBytes: int64(req.TrafficLimitGB * 1024 * 1024 * 1024),
		CycleDays:         req.CycleDays,
		IsReset:           req.IsReset,
		ResetDay:          req.ResetDay,
		Nodes:             nodes,
		SpeedLimitMbps:    req.SpeedLimitMbps,
		DeviceLimit:       req.DeviceLimit,
		AutoSpeedRules:    req.AutoSpeedRules,
	}

	if err := h.repo.UpdatePackage(r.Context(), pkg); err != nil {
		if err == storage.ErrPackageNotFound {
			http.Error(w, "Package not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if h.pusher != nil {
		go h.pusher.PushToAllServersForPackage(context.Background(), req.ID)
	}

	// 异步同步 xray 用户凭据：对比新旧节点差异，为绑定此套餐的用户添加/移除入站配置
	go h.syncInboundUsersAfterNodeChange(context.Background(), req.ID, oldNodes, nodes)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Package updated successfully",
	})
}

func (h *PackageUpdateHandler) syncInboundUsersAfterNodeChange(ctx context.Context, packageID int64, oldNodes, newNodes []int64) {
	oldSet := make(map[int64]bool, len(oldNodes))
	for _, id := range oldNodes {
		oldSet[id] = true
	}
	newSet := make(map[int64]bool, len(newNodes))
	for _, id := range newNodes {
		newSet[id] = true
	}

	var addedNodes, removedNodes []int64
	for _, id := range newNodes {
		if !oldSet[id] {
			addedNodes = append(addedNodes, id)
		}
	}
	for _, id := range oldNodes {
		if !newSet[id] {
			removedNodes = append(removedNodes, id)
		}
	}

	if len(addedNodes) == 0 && len(removedNodes) == 0 {
		return
	}

	users, err := h.repo.ListUsersWithPackage(ctx)
	if err != nil {
		log.Printf("[PackageUpdate] Failed to list users with package: %v", err)
		return
	}

	var targetUsers []storage.User
	for _, u := range users {
		if u.PackageID == packageID {
			targetUsers = append(targetUsers, u)
		}
	}
	if len(targetUsers) == 0 {
		return
	}

	log.Printf("[PackageUpdate] Syncing inbound users for package %d: %d added nodes, %d removed nodes, %d users",
		packageID, len(addedNodes), len(removedNodes), len(targetUsers))

	for _, user := range targetUsers {
		for _, nodeID := range addedNodes {
			node, err := h.repo.GetNodeByID(ctx, nodeID)
			if err != nil {
				log.Printf("[PackageUpdate] Failed to get node %d: %v", nodeID, err)
				continue
			}
			if node.InboundTag == "" || node.OriginalServer == "" {
				continue
			}
			server, err := h.repo.GetRemoteServerByName(ctx, node.OriginalServer)
			if err != nil {
				log.Printf("[PackageUpdate] Failed to find server %s: %v", node.OriginalServer, err)
				continue
			}
			if err := addUserToInbound(ctx, h.remoteManage, h.repo, user, server.ID, node.InboundTag); err != nil {
				log.Printf("[PackageUpdate] Failed to add user %s to inbound %s on server %d: %v",
					user.Username, node.InboundTag, server.ID, err)
			}
		}

		for _, nodeID := range removedNodes {
			node, err := h.repo.GetNodeByID(ctx, nodeID)
			if err != nil {
				continue
			}
			if node.InboundTag == "" || node.OriginalServer == "" {
				continue
			}
			server, err := h.repo.GetRemoteServerByName(ctx, node.OriginalServer)
			if err != nil {
				continue
			}
			cfg, err := h.repo.GetUserInboundConfig(ctx, user.Username, server.ID, node.InboundTag)
			if err != nil {
				continue
			}
			if err := removeUserFromInbound(ctx, h.remoteManage, *cfg); err != nil {
				log.Printf("[PackageUpdate] Failed to remove user %s from inbound %s on server %d: %v",
					user.Username, cfg.InboundTag, cfg.ServerID, err)
			}
			_ = h.repo.DeleteUserInboundConfig(ctx, user.Username, server.ID, node.InboundTag)
		}

		if h.pusher != nil {
			h.pusher.PushToAllServersForUser(ctx, user.Username)
		}
	}
}

// PackageDeleteHandler 处理删除包模板
type PackageDeleteHandler struct {
	repo *storage.TrafficRepository
}

func NewPackageDeleteHandler(repo *storage.TrafficRepository) *PackageDeleteHandler {
	return &PackageDeleteHandler{repo: repo}
}

func (h *PackageDeleteHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 从 URL 路径或请求正文中提取 ID
	var id int64
	var err error

	if r.Method == http.MethodDelete {
		// 从 URL 路径提取：/api/admin/packages/123
		pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/admin/packages/"), "/")
		if len(pathParts) > 0 && pathParts[0] != "" {
			id, err = strconv.ParseInt(pathParts[0], 10, 64)
			if err != nil {
				http.Error(w, "Invalid package ID", http.StatusBadRequest)
				return
			}
		}
	} else {
		// 从 JSON 正文中提取
		var req struct {
			ID int64 `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		id = req.ID
	}

	if id <= 0 {
		http.Error(w, "Invalid package ID", http.StatusBadRequest)
		return
	}

	if err := h.repo.DeletePackage(r.Context(), id); err != nil {
		if err == storage.ErrPackageNotFound {
			http.Error(w, "Package not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Package deleted successfully",
	})
}

// PackageUnassignHandler 处理从用户删除包分配
type PackageUnassignHandler struct {
	repo         *storage.TrafficRepository
	remoteManage *RemoteManageHandler
	pusher       *LimiterConfigPusher
}

func NewPackageUnassignHandler(repo *storage.TrafficRepository, remoteManage *RemoteManageHandler, pusher *LimiterConfigPusher) *PackageUnassignHandler {
	return &PackageUnassignHandler{repo: repo, remoteManage: remoteManage, pusher: pusher}
}

func (h *PackageUnassignHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Username == "" {
		http.Error(w, "Username is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	// 先从入站中移除用户凭据
	configs, err := h.repo.GetUserInboundConfigs(ctx, req.Username)
	if err != nil {
		log.Printf("[PackageUnassign] Failed to get user inbound configs: %v", err)
	}
	for _, cfg := range configs {
		if err := removeUserFromInbound(ctx, h.remoteManage, cfg); err != nil {
			log.Printf("[PackageUnassign] Failed to remove user %s from inbound %s on server %d: %v",
				req.Username, cfg.InboundTag, cfg.ServerID, err)
		}
	}
	if err := h.repo.DeleteUserInboundConfigs(ctx, req.Username); err != nil {
		log.Printf("[PackageUnassign] Failed to delete user inbound config records: %v", err)
	}

	if h.pusher != nil {
		go h.pusher.PushToAllServersForUser(context.Background(), req.Username)
	}

	if err := h.repo.RemovePackageFromUser(ctx, req.Username); err != nil {
		if err == storage.ErrUserNotFound {
			http.Error(w, "User not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Package removed successfully",
	})
}

// PackageAssignHandler 处理将包分配给用户的操作
type PackageAssignHandler struct {
	repo         *storage.TrafficRepository
	remoteManage *RemoteManageHandler
	pusher       *LimiterConfigPusher
}

func NewPackageAssignHandler(repo *storage.TrafficRepository, remoteManage *RemoteManageHandler, pusher *LimiterConfigPusher) *PackageAssignHandler {
	return &PackageAssignHandler{repo: repo, remoteManage: remoteManage, pusher: pusher}
}

type assignPackageRequest struct {
	Username   string `json:"username"`
	PackageID  int64  `json:"package_id"`
	StartDate  string `json:"start_date"`
	ExpireDate string `json:"expire_date"`
	IsReset    bool   `json:"is_reset"`
	ResetDay   int    `json:"reset_day"`
}

func (h *PackageAssignHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req assignPackageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Username == "" {
		http.Error(w, "Username is required", http.StatusBadRequest)
		return
	}
	if req.PackageID <= 0 {
		http.Error(w, "Package ID is required", http.StatusBadRequest)
		return
	}

	var startDate time.Time
	if req.StartDate != "" {
		parsed, err := time.Parse("2006-01-02", req.StartDate)
		if err != nil {
			http.Error(w, "Invalid start_date format, expected YYYY-MM-DD", http.StatusBadRequest)
			return
		}
		startDate = parsed
	} else {
		startDate = time.Now()
	}

	// 计算到期时间：优先使用前端传入的 expire_date，否则默认 start + 30 天
	ctx := r.Context()
	var endDate time.Time
	if req.ExpireDate != "" {
		parsed, err := time.Parse("2006-01-02", req.ExpireDate)
		if err != nil {
			http.Error(w, "Invalid expire_date format, expected YYYY-MM-DD", http.StatusBadRequest)
			return
		}
		endDate = parsed
	} else {
		pkg, err := h.repo.GetPackage(ctx, req.PackageID)
		if err == nil && pkg.CycleDays > 0 {
			endDate = startDate.AddDate(0, 0, pkg.CycleDays)
		} else {
			endDate = startDate.AddDate(0, 1, 0)
		}
	}

	if err := h.repo.AssignPackageToUser(ctx, req.Username, req.PackageID, startDate, endDate, req.IsReset, req.ResetDay); err != nil {
		if err == storage.ErrPackageNotFound {
			http.Error(w, "Package not found", http.StatusNotFound)
			return
		}
		if err == storage.ErrUserNotFound {
			http.Error(w, "User not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 获取套餐关联的节点，为每个节点的入站添加用户凭据
	pkg, err := h.repo.GetPackage(ctx, req.PackageID)
	if err != nil {
		log.Printf("[PackageAssign] Failed to get package: %v", err)
	} else {
		user, err := h.repo.GetUser(ctx, req.Username)
		if err != nil {
			log.Printf("[PackageAssign] Failed to get user: %v", err)
		} else {
			var warnings []string
			for _, nodeID := range pkg.Nodes {
				node, err := h.repo.GetNodeByID(ctx, nodeID)
				if err != nil {
					log.Printf("[PackageAssign] Failed to get node %d: %v", nodeID, err)
					continue
				}
				if node.InboundTag == "" || node.OriginalServer == "" {
					continue
				}
				server, err := h.repo.GetRemoteServerByName(ctx, node.OriginalServer)
				if err != nil {
					log.Printf("[PackageAssign] Failed to find server %s: %v", node.OriginalServer, err)
					continue
				}
				if err := addUserToInbound(ctx, h.remoteManage, h.repo, user, server.ID, node.InboundTag); err != nil {
					log.Printf("[PackageAssign] Failed to add user %s to inbound %s on server %d: %v",
						req.Username, node.InboundTag, server.ID, err)
					warnings = append(warnings, fmt.Sprintf("节点 %s 添加用户失败", node.NodeName))
				}
			}
			if len(warnings) > 0 {
				if h.pusher != nil {
					go h.pusher.PushToAllServersForUser(context.Background(), req.Username)
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]interface{}{
					"message":  "Package assigned with warnings",
					"warnings": warnings,
				})
				return
			}
		}
	}

	if h.pusher != nil {
		go h.pusher.PushToAllServersForUser(context.Background(), req.Username)
	}

	go h.autoGenerateSubscription(context.Background(), req.Username, req.PackageID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Package assigned successfully",
	})
}

func (h *PackageAssignHandler) autoGenerateSubscription(ctx context.Context, username string, packageID int64) {
	pkg, err := h.repo.GetPackage(ctx, packageID)
	if err != nil {
		log.Printf("[PackageAssign] 自动生成订阅失败: 获取套餐错误: %v", err)
		return
	}

	var proxies []map[string]any
	for _, nodeID := range pkg.Nodes {
		node, err := h.repo.GetNodeByID(ctx, nodeID)
		if err != nil || !node.Enabled || node.ClashConfig == "" {
			continue
		}
		var proxyConfig map[string]any
		if err := json.Unmarshal([]byte(node.ClashConfig), &proxyConfig); err != nil {
			continue
		}
		proxies = append(proxies, proxyConfig)
	}

	if len(proxies) == 0 {
		log.Printf("[PackageAssign] 自动生成订阅跳过: 套餐 %d 无可用节点", packageID)
		return
	}

	templateContent, err := h.loadDefaultTemplate(ctx)
	if err != nil {
		log.Printf("[PackageAssign] 自动生成订阅失败: %v", err)
		return
	}

	processor := substore.NewTemplateV3Processor(nil, nil)
	result, err := processor.ProcessTemplate(templateContent, proxies)
	if err != nil {
		log.Printf("[PackageAssign] 自动生成订阅失败: 处理模板错误: %v", err)
		return
	}

	result, err = injectProxiesIntoTemplate(result, proxies)
	if err != nil {
		log.Printf("[PackageAssign] 自动生成订阅失败: 注入代理错误: %v", err)
		return
	}

	os.MkdirAll("subscribes", 0755)

	existing, err := h.repo.GetUserPackageSubscription(ctx, username)
	if err == nil {
		filePath := filepath.Join("subscribes", existing.Filename)
		if err := os.WriteFile(filePath, []byte(result), 0644); err != nil {
			log.Printf("[PackageAssign] 自动生成订阅失败: 写入文件错误: %v", err)
			return
		}
		existing.Name = fmt.Sprintf("%s - %s", username, pkg.Name)
		existing.Description = "套餐自动生成"
		h.repo.UpdateSubscribeFile(ctx, existing)
		log.Printf("[PackageAssign] 已更新用户 %s 的套餐订阅文件", username)
		return
	}

	filename := fmt.Sprintf("pkg_%s.yaml", username)
	filePath := filepath.Join("subscribes", filename)
	if err := os.WriteFile(filePath, []byte(result), 0644); err != nil {
		log.Printf("[PackageAssign] 自动生成订阅失败: 写入文件错误: %v", err)
		return
	}

	file := storage.SubscribeFile{
		Name:        fmt.Sprintf("%s - %s", username, pkg.Name),
		Description: "套餐自动生成",
		Type:        storage.SubscribeTypePackage,
		Filename:    filename,
	}
	created, err := h.repo.CreateSubscribeFile(ctx, file)
	if err != nil {
		log.Printf("[PackageAssign] 自动生成订阅失败: 创建记录错误: %v", err)
		return
	}
	if err := h.repo.AssignSubscriptionToUser(ctx, username, created.ID); err != nil {
		log.Printf("[PackageAssign] 自动生成订阅失败: 关联用户错误: %v", err)
		return
	}
	log.Printf("[PackageAssign] 已为用户 %s 创建套餐订阅文件", username)
}

func (h *PackageAssignHandler) loadDefaultTemplate(ctx context.Context) (string, error) {
	templatesDir := "rule_templates"
	var candidates []string

	cfg, err := h.repo.GetSystemConfig(ctx)
	if err == nil && cfg.DefaultTemplateFilename != "" {
		candidates = append(candidates, cfg.DefaultTemplateFilename)
	}
	candidates = append(candidates, "default.yaml", "redirhost__v3.yaml")

	for _, name := range candidates {
		content, err := os.ReadFile(filepath.Join(templatesDir, name))
		if err == nil {
			return string(content), nil
		}
	}
	return "", fmt.Errorf("未找到可用模板")
}

// addUserToInbound 获取远程入站配置，添加用户凭据，然后重新提交
func addUserToInbound(ctx context.Context, rm *RemoteManageHandler, repo *storage.TrafficRepository, user storage.User, serverID int64, inboundTag string) error {
	// 获取该服务器的所有入站
	result, err := rm.forwardToRemoteServer(ctx, serverID, "GET", "/api/child/inbounds", nil)
	if err != nil {
		return fmt.Errorf("get inbounds: %w", err)
	}

	var resp struct {
		Success  bool                     `json:"success"`
		Inbounds []map[string]interface{} `json:"inbounds"`
	}
	if err := json.Unmarshal(result, &resp); err != nil || !resp.Success {
		return fmt.Errorf("parse inbounds response: %v", err)
	}

	// 找到目标入站
	var targetInbound map[string]interface{}
	for _, ib := range resp.Inbounds {
		if tag, _ := ib["tag"].(string); tag == inboundTag {
			targetInbound = ib
			break
		}
	}
	if targetInbound == nil {
		return fmt.Errorf("inbound %s not found", inboundTag)
	}

	protocol, _ := targetInbound["protocol"].(string)
	settings, _ := targetInbound["settings"].(map[string]interface{})
	if settings == nil {
		settings = make(map[string]interface{})
		targetInbound["settings"] = settings
	}

	// 尝试复用已保存的凭据（续费场景）
	var credential map[string]interface{}
	var credJSON string
	existing, _ := repo.GetUserInboundConfig(ctx, user.Username, serverID, inboundTag)
	if existing != nil && existing.Protocol == protocol {
		json.Unmarshal([]byte(existing.CredentialJSON), &credential)
		credJSON = existing.CredentialJSON
	}
	if credential == nil {
		var err error
		credential, credJSON, err = generateCredential(protocol, user)
		if err != nil {
			return fmt.Errorf("generate credential: %w", err)
		}
	}

	// 从现有 client 继承 flow 字段（VLESS Reality 需要）
	if strings.EqualFold(protocol, "vless") {
		if _, hasFlow := credential["flow"]; !hasFlow {
			if clients, ok := settings["clients"].([]interface{}); ok && len(clients) > 0 {
				if first, ok := clients[0].(map[string]interface{}); ok {
					if flow, ok := first["flow"].(string); ok && flow != "" {
						credential["flow"] = flow
						credJSON = ""
						if b, err := json.Marshal(credential); err == nil {
							credJSON = string(b)
						}
					}
				}
			}
		}
	}

	switch strings.ToLower(protocol) {
	case "vless", "vmess", "trojan", "shadowsocks":
		clients, _ := settings["clients"].([]interface{})
		clients = append(clients, credential)
		settings["clients"] = clients
	case "socks", "http":
		accounts, _ := settings["accounts"].([]interface{})
		accounts = append(accounts, credential)
		settings["accounts"] = accounts
	default:
		return fmt.Errorf("unsupported protocol: %s", protocol)
	}

	// 先删除旧入站，再添加更新后的入站
	removeBody, _ := json.Marshal(map[string]string{"action": "remove", "tag": inboundTag})
	if _, err := rm.forwardToRemoteServer(ctx, serverID, "POST", "/api/child/inbounds", removeBody); err != nil {
		return fmt.Errorf("remove old inbound: %w", err)
	}

	addBody, _ := json.Marshal(map[string]interface{}{"action": "add", "inbound": targetInbound})
	if _, err := rm.forwardToRemoteServer(ctx, serverID, "POST", "/api/child/inbounds", addBody); err != nil {
		return fmt.Errorf("add updated inbound: %w", err)
	}

	// 仅在没有已保存记录时写入新记录
	if existing == nil {
		repo.SaveUserInboundConfig(ctx, storage.UserInboundConfig{
			Username:       user.Username,
			ServerID:       serverID,
			InboundTag:     inboundTag,
			Protocol:       protocol,
			CredentialJSON: credJSON,
		})
	}

	return nil
}

// removeUserFromInbound 从远程入站中移除用户凭据
func removeUserFromInbound(ctx context.Context, rm *RemoteManageHandler, cfg storage.UserInboundConfig) error {
	result, err := rm.forwardToRemoteServer(ctx, cfg.ServerID, "GET", "/api/child/inbounds", nil)
	if err != nil {
		return fmt.Errorf("get inbounds: %w", err)
	}

	var resp struct {
		Success  bool                     `json:"success"`
		Inbounds []map[string]interface{} `json:"inbounds"`
	}
	if err := json.Unmarshal(result, &resp); err != nil || !resp.Success {
		return fmt.Errorf("parse inbounds response: %v", err)
	}

	var targetInbound map[string]interface{}
	for _, ib := range resp.Inbounds {
		if tag, _ := ib["tag"].(string); tag == cfg.InboundTag {
			targetInbound = ib
			break
		}
	}
	if targetInbound == nil {
		return nil // 入站已不存在，无需清理
	}

	settings, _ := targetInbound["settings"].(map[string]interface{})
	if settings == nil {
		return nil
	}

	// 解析保存的凭据用于匹配
	var savedCred map[string]interface{}
	json.Unmarshal([]byte(cfg.CredentialJSON), &savedCred)

	protocol := strings.ToLower(cfg.Protocol)
	switch protocol {
	case "vless", "vmess", "trojan", "shadowsocks":
		clients, _ := settings["clients"].([]interface{})
		settings["clients"] = filterCredentials(clients, savedCred, protocol)
	case "socks", "http":
		accounts, _ := settings["accounts"].([]interface{})
		settings["accounts"] = filterCredentials(accounts, savedCred, protocol)
	}

	removeBody, _ := json.Marshal(map[string]string{"action": "remove", "tag": cfg.InboundTag})
	if _, err := rm.forwardToRemoteServer(ctx, cfg.ServerID, "POST", "/api/child/inbounds", removeBody); err != nil {
		return fmt.Errorf("remove old inbound: %w", err)
	}

	addBody, _ := json.Marshal(map[string]interface{}{"action": "add", "inbound": targetInbound})
	if _, err := rm.forwardToRemoteServer(ctx, cfg.ServerID, "POST", "/api/child/inbounds", addBody); err != nil {
		return fmt.Errorf("add updated inbound: %w", err)
	}

	return nil
}

// generateCredential 根据协议类型生成用户凭据
func generateCredential(protocol string, user storage.User) (map[string]interface{}, string, error) {
	cred := make(map[string]interface{})
	email := user.Email
	if email == "" {
		email = user.Username
	}

	switch strings.ToLower(protocol) {
	case "vless", "vmess":
		id := uuid.New().String()
		cred["id"] = id
		cred["email"] = email
		cred["level"] = 0
	case "trojan":
		cred["password"] = uuid.New().String()
		cred["email"] = email
		cred["level"] = 0
	case "shadowsocks":
		key := make([]byte, 16)
		rand.Read(key)
		cred["password"] = base64.StdEncoding.EncodeToString(key)
		cred["email"] = email
		cred["level"] = 0
	case "socks", "http":
		cred["user"] = user.Username
		cred["pass"] = uuid.New().String()[:16]
	default:
		return nil, "", fmt.Errorf("unsupported protocol: %s", protocol)
	}

	credJSON, _ := json.Marshal(cred)
	return cred, string(credJSON), nil
}

// filterCredentials 从凭据列表中移除匹配的凭据
func filterCredentials(items []interface{}, savedCred map[string]interface{}, protocol string) []interface{} {
	var result []interface{}
	for _, item := range items {
		m, ok := item.(map[string]interface{})
		if !ok {
			result = append(result, item)
			continue
		}
		if matchCredential(m, savedCred, protocol) {
			continue
		}
		result = append(result, item)
	}
	return result
}

func matchCredential(a, b map[string]interface{}, protocol string) bool {
	switch strings.ToLower(protocol) {
	case "vless", "vmess":
		return fmt.Sprint(a["id"]) == fmt.Sprint(b["id"])
	case "trojan":
		return fmt.Sprint(a["password"]) == fmt.Sprint(b["password"])
	case "shadowsocks":
		return fmt.Sprint(a["password"]) == fmt.Sprint(b["password"])
	case "socks", "http":
		return fmt.Sprint(a["user"]) == fmt.Sprint(b["user"])
	}
	return false
}
