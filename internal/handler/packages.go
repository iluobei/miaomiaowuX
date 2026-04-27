package handler

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"miaomiaowu/internal/storage"
	"net/http"
	"strconv"
	"strings"
	"time"

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
	Name           string  `json:"name"`
	Description    string  `json:"description"`
	TrafficLimitGB float64 `json:"traffic_limit_gb"`
	CycleDays      int     `json:"cycle_days"`
	IsReset        bool    `json:"is_reset"`
	ResetDay       int     `json:"reset_day"`
	Nodes          []int64 `json:"nodes"`
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
	repo *storage.TrafficRepository
}

func NewPackageUpdateHandler(repo *storage.TrafficRepository) *PackageUpdateHandler {
	return &PackageUpdateHandler{repo: repo}
}

type updatePackageRequest struct {
	ID             int64   `json:"id"`
	Name           string  `json:"name"`
	Description    string  `json:"description"`
	TrafficLimitGB float64 `json:"traffic_limit_gb"`
	CycleDays      int     `json:"cycle_days"`
	IsReset        bool    `json:"is_reset"`
	ResetDay       int     `json:"reset_day"`
	Nodes          []int64 `json:"nodes"`
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
	}

	if err := h.repo.UpdatePackage(r.Context(), pkg); err != nil {
		if err == storage.ErrPackageNotFound {
			http.Error(w, "Package not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Package updated successfully",
	})
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
	repo          *storage.TrafficRepository
	remoteManage  *RemoteManageHandler
}

func NewPackageUnassignHandler(repo *storage.TrafficRepository, remoteManage *RemoteManageHandler) *PackageUnassignHandler {
	return &PackageUnassignHandler{repo: repo, remoteManage: remoteManage}
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
}

func NewPackageAssignHandler(repo *storage.TrafficRepository, remoteManage *RemoteManageHandler) *PackageAssignHandler {
	return &PackageAssignHandler{repo: repo, remoteManage: remoteManage}
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
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]interface{}{
					"message":  "Package assigned with warnings",
					"warnings": warnings,
				})
				return
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Package assigned successfully",
	})
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
