package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"miaomiaowu/internal/storage"
	"miaomiaowu/internal/traffic"
	"miaomiaowu/internal/version"
)

// TrafficHandler 处理与流量相关的 API 请求
type TrafficHandler struct {
	repo      *storage.TrafficRepository
	collector *traffic.Collector
}

// 创建一个新的流量处理程序
func NewTrafficHandler(repo *storage.TrafficRepository, collector *traffic.Collector) *TrafficHandler {
	return &TrafficHandler{
		repo:      repo,
		collector: collector,
	}
}

// SerHTTP 路由流量 API 请求
func (h *TrafficHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/traffic")
	path = strings.TrimPrefix(path, "/")

	switch {
	case path == "" || path == "servers":
		h.handleServers(w, r)
	case strings.HasPrefix(path, "servers/"):
		h.handleServerDetail(w, r, strings.TrimPrefix(path, "servers/"))
	case path == "users":
		h.handleUsers(w, r)
	case strings.HasPrefix(path, "users/"):
		h.handleUserDetail(w, r, strings.TrimPrefix(path, "users/"))
	case path == "snapshots":
		h.handleSnapshots(w, r)
	case path == "node-snapshots":
		h.handleNodeSnapshots(w, r)
	case path == "user-snapshots":
		h.handleUserSnapshots(w, r)
	default:
		http.NotFound(w, r)
	}
}

// ServerTrafficResponse 表示服务器的流量数据
type ServerTrafficResponse struct {
	ServerID   int64                 `json:"server_id"`
	ServerName string                `json:"server_name"`
	Inbounds   []storage.NodeTraffic `json:"inbounds"`
	Outbounds  []storage.NodeTraffic `json:"outbounds"`
	Users      []storage.UserTraffic `json:"users"`
}

// ServersTrafficResponse 表示所有服务器的流量数据
type ServersTrafficResponse struct {
	Success bool                    `json:"success"`
	Servers []ServerTrafficResponse `json:"servers"`
}

func (h *TrafficHandler) handleServers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	servers, err := h.repo.ListRemoteServers(ctx)
	if err != nil {
		log.Printf("[Traffic API] Failed to list servers: %v", err)
		h.writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   "Failed to list servers",
		})
		return
	}

	// 获取所有节点流量
	allNodeTraffic, err := h.repo.GetAllNodeTraffic(ctx)
	if err != nil {
		log.Printf("[Traffic API] Failed to get node traffic: %v", err)
		h.writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   "Failed to get node traffic",
		})
		return
	}

	allUserTraffic, err := h.repo.GetAllUserTraffic(ctx)
	if err != nil {
		log.Printf("[Traffic API] Failed to get user traffic: %v", err)
		h.writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   "Failed to get user traffic",
		})
		return
	}

	// 按服务器分组
	nodeByServer := make(map[int64][]storage.NodeTraffic)
	userByServer := make(map[int64][]storage.UserTraffic)

	for _, t := range allNodeTraffic {
		nodeByServer[t.ServerID] = append(nodeByServer[t.ServerID], t)
	}
	for _, t := range allUserTraffic {
		userByServer[t.ServerID] = append(userByServer[t.ServerID], t)
	}

	// 建立服务器 ID → 名称映射
	serverNameMap := make(map[int64]string)
	for _, server := range servers {
		serverNameMap[server.ID] = server.Name
	}

	// 收集所有出现过的 server_id
	allServerIDs := make(map[int64]bool)
	for sid := range nodeByServer {
		allServerIDs[sid] = true
	}
	for sid := range userByServer {
		allServerIDs[sid] = true
	}

	// 建立响应
	var result []ServerTrafficResponse
	for sid := range allServerIDs {
		name, ok := serverNameMap[sid]
		if !ok {
			name = fmt.Sprintf("未知服务器-%d", sid)
		}
		nodeTraffic := nodeByServer[sid]
		var inbounds, outbounds []storage.NodeTraffic
		for _, t := range nodeTraffic {
			if t.Type == "inbound" {
				inbounds = append(inbounds, t)
			} else {
				outbounds = append(outbounds, t)
			}
		}

		result = append(result, ServerTrafficResponse{
			ServerID:   sid,
			ServerName: name,
			Inbounds:   inbounds,
			Outbounds:  outbounds,
			Users:      userByServer[sid],
		})
	}

	h.writeJSON(w, http.StatusOK, ServersTrafficResponse{
		Success: true,
		Servers: result,
	})
}

func (h *TrafficHandler) handleServerDetail(w http.ResponseWriter, r *http.Request, serverIDStr string) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	serverID, err := strconv.ParseInt(serverIDStr, 10, 64)
	if err != nil {
		h.writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"error":   "Invalid server ID",
		})
		return
	}

	ctx := r.Context()

	// 获取服务器信息
	server, err := h.repo.GetRemoteServer(ctx, serverID)
	if err != nil {
		h.writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"success": false,
			"error":   "Server not found",
		})
		return
	}

	// 获取节点流量
	nodeTraffic, err := h.repo.GetNodeTrafficByServer(ctx, serverID)
	if err != nil {
		log.Printf("[Traffic API] Failed to get node traffic for server %d: %v", serverID, err)
		nodeTraffic = []storage.NodeTraffic{}
	}

	var inbounds, outbounds []storage.NodeTraffic
	for _, t := range nodeTraffic {
		if t.Type == "inbound" {
			inbounds = append(inbounds, t)
		} else {
			outbounds = append(outbounds, t)
		}
	}

	// 获取用户流量
	userTraffic, err := h.repo.GetUserTrafficByServer(ctx, serverID)
	if err != nil {
		log.Printf("[Traffic API] Failed to get user traffic for server %d: %v", serverID, err)
		userTraffic = []storage.UserTraffic{}
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"server": ServerTrafficResponse{
			ServerID:   server.ID,
			ServerName: server.Name,
			Inbounds:   inbounds,
			Outbounds:  outbounds,
			Users:      userTraffic,
		},
	})
}

// UserTrafficSummary 表示用户在所有服务器上的聚合流量
type UserTrafficSummary struct {
	Username      string                `json:"username"`
	TotalUplink   int64                 `json:"total_uplink"`
	TotalDownlink int64                 `json:"total_downlink"`
	CycleUplink   int64                 `json:"cycle_uplink"`
	CycleDownlink int64                 `json:"cycle_downlink"`
	Servers       []storage.UserTraffic `json:"servers"`
}

func (h *TrafficHandler) handleUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	allUserTraffic, err := h.repo.GetAllUserTraffic(ctx)
	if err != nil {
		log.Printf("[Traffic API] Failed to get user traffic: %v", err)
		h.writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   "Failed to get user traffic",
		})
		return
	}

	// 按用户名聚合
	userMap := make(map[string]*UserTrafficSummary)
	for _, t := range allUserTraffic {
		if _, ok := userMap[t.Username]; !ok {
			userMap[t.Username] = &UserTrafficSummary{
				Username: t.Username,
			}
		}
		summary := userMap[t.Username]
		summary.TotalUplink += t.TotalUplink + t.Uplink
		summary.TotalDownlink += t.TotalDownlink + t.Downlink
		summary.CycleUplink += t.Uplink
		summary.CycleDownlink += t.Downlink
		summary.Servers = append(summary.Servers, t)
	}

	// 转换为切片
	var result []UserTrafficSummary
	for _, summary := range userMap {
		result = append(result, *summary)
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"users":   result,
	})
}

func (h *TrafficHandler) handleUserDetail(w http.ResponseWriter, r *http.Request, username string) {
	if r.Method == http.MethodDelete {
		// 重置用户流量周期
		h.handleResetUserCycle(w, r, username)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	// 获取该用户的所有用户流量
	allUserTraffic, err := h.repo.GetAllUserTraffic(ctx)
	if err != nil {
		log.Printf("[Traffic API] Failed to get user traffic: %v", err)
		h.writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   "Failed to get user traffic",
		})
		return
	}

	// 按用户名过滤
	var userTraffic []storage.UserTraffic
	for _, t := range allUserTraffic {
		if t.Username == username {
			userTraffic = append(userTraffic, t)
		}
	}

	if len(userTraffic) == 0 {
		h.writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"success": false,
			"error":   "User traffic not found",
		})
		return
	}

	// 计算总结
	var totalUplink, totalDownlink, cycleUplink, cycleDownlink int64
	for _, t := range userTraffic {
		totalUplink += t.TotalUplink + t.Uplink
		totalDownlink += t.TotalDownlink + t.Downlink
		cycleUplink += t.Uplink
		cycleDownlink += t.Downlink
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"user": UserTrafficSummary{
			Username:      username,
			TotalUplink:   totalUplink,
			TotalDownlink: totalDownlink,
			CycleUplink:   cycleUplink,
			CycleDownlink: cycleDownlink,
			Servers:       userTraffic,
		},
	})
}

func (h *TrafficHandler) handleResetUserCycle(w http.ResponseWriter, r *http.Request, username string) {
	ctx := r.Context()

	if err := h.repo.ResetUserTrafficCycle(ctx, username); err != nil {
		log.Printf("[Traffic API] Failed to reset user cycle for %s: %v", username, err)
		h.writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   "Failed to reset user cycle",
		})
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "User cycle reset successfully",
	})
}

func (h *TrafficHandler) handleSnapshots(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	// 解析查询参数
	serverIDStr := r.URL.Query().Get("server_id")
	daysStr := r.URL.Query().Get("days")

	var serverID int64
	if serverIDStr != "" {
		var err error
		serverID, err = strconv.ParseInt(serverIDStr, 10, 64)
		if err != nil {
			serverID = 0
		}
	}

	days := 30
	if daysStr != "" {
		if d, err := strconv.Atoi(daysStr); err == nil && d > 0 {
			days = d
		}
	}

	snapshots, err := h.repo.GetTrafficSnapshots(ctx, serverID, days)
	if err != nil {
		log.Printf("[Traffic API] Failed to get snapshots: %v", err)
		h.writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   "Failed to get snapshots",
		})
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"snapshots": snapshots,
	})
}

func (h *TrafficHandler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// RemoteTrafficHandler 处理来自远程服务器的流量报告
type RemoteTrafficHandler struct {
	repo      *storage.TrafficRepository
	collector *traffic.Collector
}

// 创建一个新的远程流量处理程序
func NewRemoteTrafficHandler(repo *storage.TrafficRepository, collector *traffic.Collector) *RemoteTrafficHandler {
	return &RemoteTrafficHandler{
		repo:      repo,
		collector: collector,
	}
}

// RemoteTrafficRequest 表示来自远程服务器的流量报告
type RemoteTrafficRequest struct {
	Stats *traffic.XrayStats `json:"stats,omitempty"`
}

// 处理来自远程服务器的 POST 请求
func (h *RemoteTrafficHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if r.Header.Get("User-Agent") != version.AgentUserAgent {
		h.writeJSON(w, http.StatusForbidden, map[string]interface{}{
			"success": false,
			"error":   "Forbidden",
		})
		return
	}

	ctx := r.Context()

	// 从标头获取令牌
	token := r.Header.Get("X-Remote-Token")
	if token == "" {
		// 尝试授权标头
		auth := r.Header.Get("Authorization")
		if strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
	}

	if token == "" {
		h.writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"success": false,
			"error":   "Missing authentication token",
		})
		return
	}

	// 验证令牌并获取远程服务器
	remoteServer, err := h.repo.GetRemoteServerByToken(ctx, token)
	if err != nil {
		h.writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"success": false,
			"error":   "Invalid token",
		})
		return
	}

	// 解析请求体
	var req RemoteTrafficRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"error":   "Invalid request body",
		})
		return
	}

	if req.Stats == nil {
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"message": "No stats to process",
		})
		return
	}

	// 为该远程查找或创建相应的 XrayServer
	// 现在，我们使用远程服务器 ID 作为伪服务器 ID
	// 在实际实现中，您可能希望将远程服务器与 xray_servers 相关联
	serverID := remoteServer.ID

	// 更新流量报告上的last_heartbeat - 这取代了单独心跳的需要
	if err := h.repo.UpdateRemoteServerLastActivity(ctx, serverID); err != nil {
		log.Printf("[Remote Traffic] Failed to update last activity for %s: %v", remoteServer.Name, err)
	}

	// 处理指标
	if err := h.collector.ProcessRemoteMetrics(ctx, serverID, req.Stats); err != nil {
		log.Printf("[Remote Traffic] Failed to process metrics from %s: %v", remoteServer.Name, err)
		h.writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   "Failed to process metrics",
		})
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Traffic data received",
	})
}

func (h *RemoteTrafficHandler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *TrafficHandler) handleNodeSnapshots(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	date := r.URL.Query().Get("date")
	if date == "" {
		h.writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "date is required"})
		return
	}
	snapshots, err := h.repo.GetNodeTrafficSnapshots(r.Context(), date)
	if err != nil {
		h.writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "snapshots": snapshots})
}

func (h *TrafficHandler) handleUserSnapshots(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	date := r.URL.Query().Get("date")
	if date == "" {
		h.writeJSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "date is required"})
		return
	}
	snapshots, err := h.repo.GetUserTrafficSnapshots(r.Context(), date)
	if err != nil {
		h.writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	h.writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "snapshots": snapshots})
}
