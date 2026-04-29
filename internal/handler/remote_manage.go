package handler

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"miaomiaowu/internal/event"
	"miaomiaowu/internal/storage"
	"miaomiaowu/internal/version"
	"miaomiaowu/templates"
)

// RemoteManageHandler 处理需要转发到子服务器的管理请求
type RemoteManageHandler struct {
	repo        *storage.TrafficRepository
	wsHandler   *RemoteWSHandler
	httpClient  *http.Client
	certHandler *CertificateHandler
}

// 创建一个新的远程管理处理程序
func NewRemoteManageHandler(repo *storage.TrafficRepository, wsHandler *RemoteWSHandler) *RemoteManageHandler {
	return &RemoteManageHandler{
		repo:      repo,
		wsHandler: wsHandler,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// 设置安装后自动部署的证书处理程序。
func (h *RemoteManageHandler) SetCertificateHandler(ch *CertificateHandler) {
	h.certHandler = ch
}

// 处理通过 WebSocket 从代理收到的扫描结果。
func (h *RemoteManageHandler) HandleScanResult(serverID int64, payload WSScanResultPayload) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 更新数据库中的 X 射线状态
	if err := h.repo.UpdateRemoteServerXrayStatus(ctx, serverID, payload.XrayRunning, payload.XrayVersion); err != nil {
		log.Printf("[Remote Manage] Failed to update Xray status for server %d: %v", serverID, err)
	}

	if payload.XrayRunning {
		result := h.syncInboundsToNodesInternal(ctx, serverID)
		log.Printf("[Remote Manage] Auto-sync from scan_result for server %d: synced=%d, skipped=%d",
			serverID, result.SyncedCount, result.SkippedCount)
	}
}

// RemoteWriteJSON 写入 JSON 响应
func remoteWriteJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// RemoteWriteError 写入错误响应
func remoteWriteError(w http.ResponseWriter, status int, message string) {
	remoteWriteJSON(w, status, map[string]string{"error": message})
}

// 代理对远程服务器的服务状态请求
func (h *RemoteManageHandler) HandleServicesStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, "GET", "/api/child/services/status", nil)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// 将服务控制请求代理到远程服务器
func (h *RemoteManageHandler) HandleServiceControl(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "failed to read body")
		return
	}

	// xray 启动/重启时使用带恢复的逻辑
	var req struct {
		Service string `json:"service"`
		Action  string `json:"action"`
	}
	if json.Unmarshal(body, &req) == nil && req.Service == "xray" && (req.Action == "start" || req.Action == "restart") {
		if err := h.restartXrayWithRecovery(r.Context(), id, "ServiceControl"); err != nil {
			remoteWriteError(w, http.StatusBadGateway, err.Error())
			return
		}
		remoteWriteJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"message": fmt.Sprintf("Service xray %sed successfully", req.Action),
		})
		return
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, "POST", "/api/child/services/control", body)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// 代理 xray 安装请求到远程服务器
func (h *RemoteManageHandler) HandleXrayInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, "POST", "/api/child/xray/install", nil)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	// 成功安装 xray 后触发自动部署证书
	if h.certHandler != nil {
		go h.certHandler.DeployAutoDeployCertificates(id)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// 代理对远程服务器的 xray 删除请求
func (h *RemoteManageHandler) HandleXrayRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, "POST", "/api/child/xray/remove", nil)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// 将 xray 配置请求代理到远程服务器
func (h *RemoteManageHandler) HandleXrayConfig(w http.ResponseWriter, r *http.Request) {
	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	var body []byte
	if r.Method == http.MethodPut || r.Method == http.MethodPost {
		body, err = io.ReadAll(r.Body)
		if err != nil {
			remoteWriteError(w, http.StatusBadRequest, "failed to read body")
			return
		}
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, r.Method, "/api/child/xray/config", body)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// 代理 nginx 安装请求到远程服务器
func (h *RemoteManageHandler) HandleNginxInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	server, err := h.repo.GetRemoteServer(r.Context(), id)
	if err != nil {
		remoteWriteError(w, http.StatusNotFound, "server not found")
		return
	}

	var body []byte
	if server.Domain != "" {
		body, _ = json.Marshal(map[string]string{"domain": server.Domain})
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, "POST", "/api/child/nginx/install", body)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	// nginx 安装成功后触发自动部署证书
	if h.certHandler != nil {
		go h.certHandler.DeployAutoDeployCertificates(id)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// 代理 nginx 删除对远程服务器的请求
func (h *RemoteManageHandler) HandleNginxRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, "POST", "/api/child/nginx/remove", nil)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// ================== SSE 流安装/删除 ==================

func remoteSSEError(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	b, _ := json.Marshal(map[string]string{"type": "error", "message": msg})
	fmt.Fprintf(w, "data: %s\n\n", b)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func (h *RemoteManageHandler) forwardStreamToRemote(w http.ResponseWriter, r *http.Request, serverID int64, agentPath string) {
	server, err := h.repo.GetRemoteServer(r.Context(), serverID)
	if err != nil {
		remoteSSEError(w, "server not found: "+err.Error())
		return
	}
	if server.Status != "connected" {
		remoteSSEError(w, "server not connected")
		return
	}

	ip := server.IPAddress
	if idx := strings.LastIndex(ip, ":"); idx != -1 && !strings.Contains(ip, "[") {
		ip = ip[:idx]
	}
	port := "23889"
	if server.ListenPort > 0 {
		port = fmt.Sprintf("%d", server.ListenPort)
	}
	childURL := fmt.Sprintf("http://%s:%s%s", ip, port, agentPath)

	log.Printf("[Remote Manage] Forwarding stream %s to server %s (%s)", agentPath, server.Name, childURL)

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, childURL, nil)
	if err != nil {
		remoteSSEError(w, "failed to create request: "+err.Error())
		return
	}
	req.Header.Set("Authorization", "Bearer "+server.Token)
	req.Header.Set("User-Agent", version.AgentUserAgent)

	client := &http.Client{} // SSE 没有超时
	resp, err := client.Do(req)
	if err != nil {
		remoteSSEError(w, "agent unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		remoteSSEError(w, fmt.Sprintf("agent error %d: %s", resp.StatusCode, string(body)))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		remoteSSEError(w, "streaming not supported")
		return
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 256*1024), 256*1024)
	for scanner.Scan() {
		line := scanner.Text()
		fmt.Fprintf(w, "%s\n", line)
		flusher.Flush()
		select {
		case <-r.Context().Done():
			return
		default:
		}
	}
}

func (h *RemoteManageHandler) HandleXrayInstallStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("server_id"), 10, 64)
	if err != nil {
		remoteSSEError(w, "invalid server_id")
		return
	}
	h.forwardStreamToRemote(w, r, id, "/api/child/xray/install-stream")
}

func (h *RemoteManageHandler) HandleXrayRemoveStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("server_id"), 10, 64)
	if err != nil {
		remoteSSEError(w, "invalid server_id")
		return
	}
	h.forwardStreamToRemote(w, r, id, "/api/child/xray/remove-stream")
}

func (h *RemoteManageHandler) HandleNginxInstallStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("server_id"), 10, 64)
	if err != nil {
		remoteSSEError(w, "invalid server_id")
		return
	}

	server, err := h.repo.GetRemoteServer(r.Context(), id)
	if err != nil {
		remoteSSEError(w, "server not found")
		return
	}

	agentPath := "/api/child/nginx/install-stream"
	if server.Domain != "" {
		agentPath += "?domain=" + server.Domain
	}
	h.forwardStreamToRemote(w, r, id, agentPath)

	// 流完成后触发自动部署证书
	if h.certHandler != nil {
		go h.certHandler.DeployAutoDeployCertificates(id)
	}
}

func (h *RemoteManageHandler) HandleNginxRemoveStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("server_id"), 10, 64)
	if err != nil {
		remoteSSEError(w, "invalid server_id")
		return
	}
	h.forwardStreamToRemote(w, r, id, "/api/child/nginx/remove-stream")
}

func (h *RemoteManageHandler) HandleAgentUpgradeStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("server_id"), 10, 64)
	if err != nil {
		remoteSSEError(w, "invalid server_id")
		return
	}
	h.forwardStreamToRemote(w, r, id, "/api/child/agent/upgrade-stream")
}

func (h *RemoteManageHandler) HandleAgentUninstallStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("server_id"), 10, 64)
	if err != nil {
		remoteSSEError(w, "invalid server_id")
		return
	}
	h.forwardStreamToRemote(w, r, id, "/api/child/agent/uninstall-stream")
}

// 将 nginx 配置请求代理到远程服务器
func (h *RemoteManageHandler) HandleNginxConfig(w http.ResponseWriter, r *http.Request) {
	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	var body []byte
	if r.Method == http.MethodPut || r.Method == http.MethodPost {
		body, err = io.ReadAll(r.Body)
		if err != nil {
			remoteWriteError(w, http.StatusBadRequest, "failed to read body")
			return
		}
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, r.Method, "/api/child/nginx/config", body)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// 将系统信息请求代理到远程服务器
func (h *RemoteManageHandler) HandleSystemInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, "GET", "/api/child/system/info", nil)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// 通过 HTTP 将请求转发到远程服务器
func (h *RemoteManageHandler) forwardToRemoteServer(ctx context.Context, serverID int64, method, path string, body []byte) ([]byte, error) {
	// 获取服务器信息
	server, err := h.repo.GetRemoteServer(ctx, serverID)
	if err != nil {
		return nil, fmt.Errorf("server not found: %v", err)
	}

	if server.Status != "connected" {
		return nil, fmt.Errorf("server not connected (status: %s)", server.Status)
	}

	if server.IPAddress == "" {
		return nil, fmt.Errorf("server IP address unknown")
	}

	// 提取纯 IP 地址（如果存在，则删除端口）
	ip := server.IPAddress
	if idx := strings.LastIndex(ip, ":"); idx != -1 {
		// 检查是否是带有括号 [::1]:port 的 IPv6
		if !strings.Contains(ip, "[") {
			ip = ip[:idx]
		}
	}

	// 构建子服务器的 URL
	// 使用代理报告的 ListenPort，回退到 23889（代理默认值）
	port := "23889"
	if server.ListenPort > 0 {
		port = fmt.Sprintf("%d", server.ListenPort)
	}
	childURL := fmt.Sprintf("http://%s:%s%s", ip, port, path)

	log.Printf("[Remote Manage] Forwarding %s %s to server %s (%s)", method, path, server.Name, childURL)

	var req *http.Request
	if body != nil {
		req, err = http.NewRequestWithContext(ctx, method, childURL, bytes.NewReader(body))
	} else {
		req, err = http.NewRequestWithContext(ctx, method, childURL, nil)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+server.Token)
	req.Header.Set("User-Agent", version.AgentUserAgent)

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %v", err)
	}

	if resp.StatusCode >= 400 {
		// 尝试提取错误消息
		var errResp map[string]interface{}
		if json.Unmarshal(respBody, &errResp) == nil {
			if msg, ok := errResp["error"].(string); ok {
				return nil, fmt.Errorf("%s", msg)
			}
		}
		return nil, fmt.Errorf("remote server returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

// 处理远程服务器上的 xray 配置文件的列表和管理
func (h *RemoteManageHandler) HandleXrayConfigFiles(w http.ResponseWriter, r *http.Request) {
	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	// 转发查询参数
	query := ""
	if file := r.URL.Query().Get("file"); file != "" {
		query = "?file=" + file
	}

	var body []byte
	if r.Method == http.MethodPut || r.Method == http.MethodPost {
		body, err = io.ReadAll(r.Body)
		if err != nil {
			remoteWriteError(w, http.StatusBadRequest, "failed to read body")
			return
		}
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, r.Method, "/api/child/xray/config/files"+query, body)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// 处理远程服务器上的 nginx 配置文件的列表和管理
func (h *RemoteManageHandler) HandleNginxConfigFiles(w http.ResponseWriter, r *http.Request) {
	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	// 转发查询参数
	query := ""
	if file := r.URL.Query().Get("file"); file != "" {
		query = "?file=" + file
	}

	var body []byte
	if r.Method == http.MethodPut || r.Method == http.MethodPost {
		body, err = io.ReadAll(r.Body)
		if err != nil {
			remoteWriteError(w, http.StatusBadRequest, "failed to read body")
			return
		}
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, r.Method, "/api/child/nginx/config/files"+query, body)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// getRemoteServerPort 提取或确定远程服务器的端口
// 现在，我们假设子服务器在配置中指定的同一端口上运行
func (h *RemoteManageHandler) getRemoteServerPort(server *storage.RemoteServer) string {
	// 默认端口
	port := "23889"

	// 如果服务器的名称或元数据中有特定端口，请将其提取
	// 目前，使用默认值
	if server.IPAddress != "" && strings.Contains(server.IPAddress, ":") {
		parts := strings.Split(server.IPAddress, ":")
		if len(parts) == 2 {
			port = parts[1]
		}
	}

	return port
}

// ================== X 射线入库管理 ==================

// 将入站管理请求代理到远程服务器
func (h *RemoteManageHandler) HandleInbounds(w http.ResponseWriter, r *http.Request) {
	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	var body []byte
	var inboundReq map[string]interface{}
	if r.Method == http.MethodPost {
		body, err = io.ReadAll(r.Body)
		if err != nil {
			remoteWriteError(w, http.StatusBadRequest, "failed to read body")
			return
		}
		// 解析请求体以获取入站配置
		if err := json.Unmarshal(body, &inboundReq); err != nil {
			remoteWriteError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, r.Method, "/api/child/inbounds", body)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	// 对于 GET 请求，过滤掉空 tag 和 tag="api" 的入站
	if r.Method == http.MethodGet {
		result = h.filterInboundsResponse(result)
	}

	// 对于 POST 请求，处理添加和删除操作
	if r.Method == http.MethodPost {
		action, _ := inboundReq["action"].(string)
		actionLower := strings.ToLower(action)

		// 检查远程服务器响应是否成功
		var resp map[string]interface{}
		if err := json.Unmarshal(result, &resp); err == nil {
			if success, ok := resp["success"].(bool); ok && success {
				if actionLower == "" || actionLower == "add" {
					// 添加入站：发布事件
					if inbound, ok := inboundReq["inbound"].(map[string]interface{}); ok {
						tag, _ := inbound["tag"].(string)
						protocol, _ := inbound["protocol"].(string)
						port, _ := inbound["port"].(float64)
						customNodeName, _ := inboundReq["node_name"].(string)
						// 转换为 map[string]any
						inboundAny := make(map[string]any)
						for k, v := range inbound {
							inboundAny[k] = v
						}
						event.GetBus().PublishAsync(event.InboundEvent{
							Type:     event.EventInboundAdded,
							ServerID: id,
							Tag:      tag,
							Protocol: protocol,
							Port:     int(port),
							Inbound:  inboundAny,
							NodeName: customNodeName,
						})
					}
				} else if actionLower == "remove" {
					// 删除入站：发布事件
					if tag, ok := inboundReq["tag"].(string); ok && tag != "" {
						event.GetBus().PublishAsync(event.InboundEvent{
							Type:     event.EventInboundRemoved,
							ServerID: id,
							Tag:      tag,
						})
					}
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// 过滤入站响应，移除空 tag 和 tag="api" 的入站
func (h *RemoteManageHandler) filterInboundsResponse(result []byte) []byte {
	var resp struct {
		Success  bool                     `json:"success"`
		Inbounds []map[string]interface{} `json:"inbounds"`
		Message  string                   `json:"message,omitempty"`
	}

	if err := json.Unmarshal(result, &resp); err != nil {
		return result
	}

	// 过滤入站列表
	filtered := make([]map[string]interface{}, 0, len(resp.Inbounds))
	for _, ib := range resp.Inbounds {
		tag, _ := ib["tag"].(string)
		source, _ := ib["_source"].(string)

		// 跳过 tag="api" 的入站
		if tag == "api" {
			continue
		}
		// 跳过空 tag 的 runtime_only 入站
		if tag == "" && source == "runtime_only" {
			continue
		}
		// 对于空 tag 的配置入站，生成名称
		if tag == "" && source == "config" {
			protocol, _ := ib["protocol"].(string)
			port := 0
			if p, ok := ib["port"].(float64); ok {
				port = int(p)
			}
			if protocol != "" && port > 0 {
				ib["tag"] = fmt.Sprintf("%s-%d", protocol, port)
				ib["_generated_tag"] = true
			}
		}
		filtered = append(filtered, ib)
	}

	resp.Inbounds = filtered
	newResult, err := json.Marshal(resp)
	if err != nil {
		return result
	}
	return newResult
}

// 自动将入站同步到节点表
func (h *RemoteManageHandler) autoSyncInboundToNodes(ctx context.Context, serverID int64, inbound map[string]interface{}) {
	// 获取远程服务器信息
	server, err := h.repo.GetRemoteServer(ctx, serverID)
	if err != nil {
		log.Printf("[Remote Manage] Failed to get remote server %d: %v", serverID, err)
		return
	}

	// 确定服务器地址：始终使用IP
	serverHost := server.IPAddress
	if serverHost == "" {
		serverHost = server.PullAddress
	}
	if serverHost == "" {
		log.Printf("[Remote Manage] No server address available for server %d", serverID)
		return
	}

	// 转换入站为 Clash 代理配置（有域名说明走 tunnel 模式，端口用 443）
	tunnelPort := 0
	if server.Domain != "" {
		tunnelPort = 443
	}
	clashProxy, err := h.inboundToClashProxy(inbound, serverHost, server.Name, tunnelPort)
	if err != nil {
		log.Printf("[Remote Manage] Failed to convert inbound to Clash proxy: %v", err)
		return
	}

	// 序列化为 JSON（与 HandleSyncInboundsToNodes 保持一致）
	clashJSON, err := json.Marshal(clashProxy)
	if err != nil {
		log.Printf("[Remote Manage] Failed to marshal Clash proxy to JSON: %v", err)
		return
	}

	// 获取入站标签
	inboundTag, _ := inbound["tag"].(string)
	protocol, _ := inbound["protocol"].(string)
	nodeName, _ := clashProxy["name"].(string)

	// 创建节点
	node := storage.Node{
		Username:       "admin", // 默认为管理员
		NodeName:       nodeName,
		Protocol:       protocol,
		ClashConfig:    string(clashJSON),
		ParsedConfig:   string(clashJSON),
		Enabled:        true,
		Tag:            fmt.Sprintf("远程:%s", server.Name),
		OriginalServer: server.Name,
		InboundTag:     inboundTag,
	}

	_, err = h.repo.CreateNode(ctx, node)
	if err != nil {
		log.Printf("[Remote Manage] Failed to create node for inbound %s: %v", inboundTag, err)
		return
	}

	log.Printf("[Remote Manage] Auto-synced inbound %s to nodes table for server %s", inboundTag, server.Name)
}

// 自动删除入站对应的节点
func (h *RemoteManageHandler) autoDeleteInboundNodes(ctx context.Context, serverID int64, inboundTag string) {
	// 获取远程服务器信息
	server, err := h.repo.GetRemoteServer(ctx, serverID)
	if err != nil {
		log.Printf("[Remote Manage] Failed to get remote server %d for node deletion: %v", serverID, err)
		return
	}

	// 删除对应的节点
	deleted, err := h.repo.DeleteNodesByInboundTag(ctx, server.Name, inboundTag)
	if err != nil {
		log.Printf("[Remote Manage] Failed to delete nodes for inbound %s: %v", inboundTag, err)
		return
	}

	if deleted > 0 {
		log.Printf("[Remote Manage] Auto-deleted %d node(s) for inbound %s on server %s", deleted, inboundTag, server.Name)
	}
}

// ================== X 射线出库管理 ==================

// 将出站管理请求代理到远程服务器
func (h *RemoteManageHandler) HandleOutbounds(w http.ResponseWriter, r *http.Request) {
	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	var body []byte
	if r.Method == http.MethodPost {
		body, err = io.ReadAll(r.Body)
		if err != nil {
			remoteWriteError(w, http.StatusBadRequest, "failed to read body")
			return
		}
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, r.Method, "/api/child/outbounds", body)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// ================== X 射线路由管理 ==================

// 代理将管理请求路由到远程服务器
func (h *RemoteManageHandler) HandleRouting(w http.ResponseWriter, r *http.Request) {
	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	var body []byte
	if r.Method == http.MethodPost {
		body, err = io.ReadAll(r.Body)
		if err != nil {
			remoteWriteError(w, http.StatusBadRequest, "failed to read body")
			return
		}
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, r.Method, "/api/child/routing", body)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// ==================扫描==================

// 将扫描请求代理到远程服务器并将入站同步到节点
func (h *RemoteManageHandler) HandleScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, "POST", "/api/child/scan", nil)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	// 解析扫描结果以更新数据库中的 X 射线状态
	var scanResult struct {
		Success     bool   `json:"success"`
		XrayRunning bool   `json:"xray_running"`
		XrayVersion string `json:"xray_version"`
	}
	if err := json.Unmarshal(result, &scanResult); err == nil && scanResult.Success {
		// 更新数据库中的 X 射线状态
		if updateErr := h.repo.UpdateRemoteServerXrayStatus(r.Context(), id, scanResult.XrayRunning, scanResult.XrayVersion); updateErr != nil {
			log.Printf("[Remote Manage] Failed to update Xray status for server %d: %v", id, updateErr)
		}

		// 如果 Xray 正在运行，则将入站同步到节点表
		if scanResult.XrayRunning {
			syncResult := h.syncInboundsToNodesInternal(r.Context(), id)
			log.Printf("[Remote Manage] Sync inbounds result for server %d: synced=%d, skipped=%d, tags=%v",
				id, syncResult.SyncedCount, syncResult.SkippedCount, syncResult.SyncedTags)

			// 将同步结果合并到响应中
			var response map[string]interface{}
			if err := json.Unmarshal(result, &response); err == nil {
				response["synced_count"] = syncResult.SyncedCount
				response["skipped_count"] = syncResult.SkippedCount
				response["synced_tags"] = syncResult.SyncedTags
				if len(syncResult.Errors) > 0 {
					response["sync_errors"] = syncResult.Errors
				}
				result, _ = json.Marshal(response)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// 将远程服务器的入站同步到节点表（内部使用）
func (h *RemoteManageHandler) syncInboundsToNodesInternal(ctx context.Context, serverID int64) SyncInboundsToNodesResponse {
	response := SyncInboundsToNodesResponse{
		Success:    true,
		SyncedTags: []string{},
		Errors:     []string{},
	}

	// 获取远程服务器信息
	server, err := h.repo.GetRemoteServer(ctx, serverID)
	if err != nil {
		response.Success = false
		response.Errors = append(response.Errors, fmt.Sprintf("获取服务器信息失败: %v", err))
		return response
	}

	// 使用服务器的IP地址
	serverHost := server.IPAddress
	if serverHost == "" {
		response.Success = false
		response.Errors = append(response.Errors, "服务器IP地址为空")
		return response
	}

	// 有域名且为 tunnel 模式，节点端口用 443
	tunnelPort := 0
	if server.Domain != "" && server.StealMode == "tunnel" {
		tunnelPort = 443
	}

	// 从远程服务器获取入站
	result, err := h.forwardToRemoteServer(ctx, serverID, "GET", "/api/child/inbounds", nil)
	if err != nil {
		response.Success = false
		response.Errors = append(response.Errors, fmt.Sprintf("获取入站失败: %v", err))
		return response
	}

	var inboundsResp struct {
		Success  bool                     `json:"success"`
		Inbounds []map[string]interface{} `json:"inbounds"`
	}
	if err := json.Unmarshal(result, &inboundsResp); err != nil {
		response.Success = false
		response.Errors = append(response.Errors, fmt.Sprintf("解析入站失败: %v", err))
		return response
	}

	if !inboundsResp.Success {
		response.Success = false
		response.Errors = append(response.Errors, "远程服务器返回错误")
		return response
	}

	username := "admin"

	// 在循环之前获取现有节点一次
	existingNodes, _ := h.repo.ListNodes(ctx, username)
	existingNodeNames := make(map[string]bool)
	existingNodeKeys := make(map[string]bool) // 键：服务器：协议：端口

	for _, n := range existingNodes {
		existingNodeNames[n.NodeName] = true
		// 从现有节点的冲突配置构建重复数据删除密钥
		var config map[string]interface{}
		if err := json.Unmarshal([]byte(n.ClashConfig), &config); err == nil {
			if proto, ok := config["type"].(string); ok {
				if port, ok := config["port"].(float64); ok {
					key := fmt.Sprintf("%s:%s:%d", n.OriginalServer, proto, int(port))
					existingNodeKeys[key] = true
				}
			}
		}
	}

	// 处理每个入站并创建节点
	for _, inbound := range inboundsResp.Inbounds {
		tag, _ := inbound["tag"].(string)
		protocol, _ := inbound["protocol"].(string)
		port, _ := inbound["port"].(float64)

		// 跳过 api 入站
		if tag == "api" || protocol == "tunnel" {
			response.SkippedCount++
			continue
		}

		// 通过服务器+协议+端口进行重复数据删除
		dedupeKey := fmt.Sprintf("%s:%s:%d", server.Name, protocol, int(port))
		if existingNodeKeys[dedupeKey] {
			response.SkippedCount++
			continue
		}

		// 创建节点名称：如果没有标签，则使用协议：端口
		var nodeName string
		if tag != "" {
			nodeName = fmt.Sprintf("[%s] %s", server.Name, tag)
		} else {
			nodeName = fmt.Sprintf("[%s] %s:%d", server.Name, protocol, int(port))
		}

		// 检查同名节点是否已存在
		if existingNodeNames[nodeName] {
			response.SkippedCount++
			continue
		}

		// 将入站转换为 Clash 代理配置
		clashProxy, err := h.inboundToClashProxy(inbound, serverHost, server.Name, tunnelPort)
		if err != nil {
			response.Errors = append(response.Errors, fmt.Sprintf("tag=%s: %v", tag, err))
			response.SkippedCount++
			continue
		}

		if clashProxy == nil {
			response.Errors = append(response.Errors, fmt.Sprintf("tag=%s: 无法生成节点配置", tag))
			response.SkippedCount++
			continue
		}

		// 序列化 Clash 配置
		clashConfigJSON, err := json.Marshal(clashProxy)
		if err != nil {
			response.Errors = append(response.Errors, fmt.Sprintf("tag=%s: 序列化配置失败", tag))
			response.SkippedCount++
			continue
		}

		// 创建节点
		node := storage.Node{
			Username:       username,
			NodeName:       nodeName,
			Protocol:       protocol,
			ClashConfig:    string(clashConfigJSON),
			ParsedConfig:   string(clashConfigJSON),
			Enabled:        true,
			Tag:            fmt.Sprintf("远程:%s", server.Name),
			OriginalServer: server.Name,
			InboundTag:     tag,
		}

		if _, err := h.repo.CreateNode(ctx, node); err != nil {
			response.Errors = append(response.Errors, fmt.Sprintf("tag=%s: 创建节点失败: %v", tag, err))
			continue
		}

		response.SyncedCount++
		if tag != "" {
			response.SyncedTags = append(response.SyncedTags, fmt.Sprintf("%s (port:%d)", tag, int(port)))
		} else {
			response.SyncedTags = append(response.SyncedTags, fmt.Sprintf("%s:%d", protocol, int(port)))
		}

		// 更新重复数据删除映射以防止同一批次出现重复
		existingNodeKeys[dedupeKey] = true
		existingNodeNames[nodeName] = true
	}

	response.Message = fmt.Sprintf("已同步 %d 个节点，跳过 %d 个", response.SyncedCount, response.SkippedCount)
	return response
}

// ================== X射线系统配置==================

// 将 xray 系统配置请求代理到远程服务器
func (h *RemoteManageHandler) HandleXraySystemConfig(w http.ResponseWriter, r *http.Request) {
	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	var body []byte
	if r.Method == http.MethodPost {
		body, err = io.ReadAll(r.Body)
		if err != nil {
			remoteWriteError(w, http.StatusBadRequest, "failed to read body")
			return
		}
	}

	result, err := h.forwardToRemoteServer(r.Context(), id, r.Method, "/api/child/xray/system-config", body)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(result)
}

// ================== 将入站同步到节点 ==================

// SyncInboundsToNodesRequest 表示将入站同步到节点的请求
type SyncInboundsToNodesRequest struct {
	ServerHost    string `json:"server_host"`    // 远程服务器的对外访问地址
	ForceOverride bool   `json:"force_override"` // 是否强制覆盖已存在的节点
}

// SyncInboundsToNodesResponse 表示同步入站的响应
type SyncInboundsToNodesResponse struct {
	Success      bool     `json:"success"`
	Message      string   `json:"message"`
	SyncedCount  int      `json:"synced_count"`
	SkippedCount int      `json:"skipped_count"`
	SyncedTags   []string `json:"synced_tags,omitempty"`
	Errors       []string `json:"errors,omitempty"`
}

// 将远程服务器的入站同步到节点表
func (h *RemoteManageHandler) HandleSyncInboundsToNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	// 解析服务器主机的请求正文
	var req SyncInboundsToNodesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.ServerHost == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_host is required")
		return
	}

	// 获取远程服务器信息
	server, err := h.repo.GetRemoteServer(r.Context(), id)
	if err != nil {
		remoteWriteError(w, http.StatusNotFound, "remote server not found")
		return
	}

	// 从远程服务器获取入站
	result, err := h.forwardToRemoteServer(r.Context(), id, "GET", "/api/child/inbounds", nil)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, fmt.Sprintf("failed to fetch inbounds: %v", err))
		return
	}

	var inboundsResp struct {
		Success  bool                     `json:"success"`
		Inbounds []map[string]interface{} `json:"inbounds"`
	}
	if err := json.Unmarshal(result, &inboundsResp); err != nil {
		remoteWriteError(w, http.StatusInternalServerError, fmt.Sprintf("failed to parse inbounds: %v", err))
		return
	}

	if !inboundsResp.Success {
		remoteWriteError(w, http.StatusBadGateway, "remote server returned error")
		return
	}

	// 从请求上下文中获取用户名（管理员用户）
	username := "admin" // 目前默认为管理员
	if u := r.Context().Value("username"); u != nil {
		if ustr, ok := u.(string); ok && ustr != "" {
			username = ustr
		}
	}

	response := SyncInboundsToNodesResponse{
		Success:    true,
		SyncedTags: []string{},
		Errors:     []string{},
	}

	// 在循环之前获取现有节点一次
	existingNodes, _ := h.repo.ListNodes(r.Context(), username)
	existingNodeNames := make(map[string]bool)
	for _, n := range existingNodes {
		existingNodeNames[n.NodeName] = true
	}

	// 处理每个入站并创建节点
	for _, inbound := range inboundsResp.Inbounds {
		tag, _ := inbound["tag"].(string)
		protocol, _ := inbound["protocol"].(string)
		port, _ := inbound["port"].(float64)
		settings, hasSettings := inbound["settings"].(map[string]interface{})

		// 记录入站信息以进行调试
		log.Printf("[Sync Nodes] Processing inbound: tag=%s, protocol=%s, port=%v, hasSettings=%v", tag, protocol, port, hasSettings)
		if settings != nil {
			clients, hasClients := settings["clients"].([]interface{})
			accounts, hasAccounts := settings["accounts"].([]interface{})
			log.Printf("[Sync Nodes]   settings: hasClients=%v (count=%d), hasAccounts=%v (count=%d)", hasClients, len(clients), hasAccounts, len(accounts))
		}

		// 跳过 api 入站
		if tag == "api" || protocol == "tunnel" {
			log.Printf("[Sync Nodes] Skipped: api/tunnel inbound")
			response.SkippedCount++
			continue
		}

		// 创建节点名称：[server_name]标签
		nodeName := fmt.Sprintf("[%s] %s", server.Name, tag)

		// 检查同名节点是否已存在
		if existingNodeNames[nodeName] {
			if req.ForceOverride {
				// 强制覆盖：先删除已存在的节点
				log.Printf("[Sync Nodes] Force override: deleting existing node: %s", nodeName)
				for _, n := range existingNodes {
					if n.NodeName == nodeName {
						if err := h.repo.DeleteNode(r.Context(), n.ID, username); err != nil {
							log.Printf("[Sync Nodes] Error deleting existing node %s: %v", nodeName, err)
							response.Errors = append(response.Errors, fmt.Sprintf("tag=%s: 删除旧节点失败: %v", tag, err))
							response.SkippedCount++
							continue
						}
						break
					}
				}
			} else {
				log.Printf("[Sync Nodes] Skipped: node already exists: %s", nodeName)
				response.Errors = append(response.Errors, fmt.Sprintf("tag=%s: 节点已存在", tag))
				response.SkippedCount++
				continue
			}
		}

		// 将入站转换为 Clash 代理配置
		tunnelPort := 0
		if server.Domain != "" {
			tunnelPort = 443
		}
		clashProxy, err := h.inboundToClashProxy(inbound, req.ServerHost, server.Name, tunnelPort)
		if err != nil {
			log.Printf("[Sync Nodes] Error converting inbound %s: %v", tag, err)
			response.Errors = append(response.Errors, fmt.Sprintf("tag=%s: %v", tag, err))
			response.SkippedCount++
			continue
		}

		if clashProxy == nil {
			log.Printf("[Sync Nodes] Skipped: clashProxy is nil for tag=%s", tag)
			response.Errors = append(response.Errors, fmt.Sprintf("tag=%s: 无法生成节点配置", tag))
			response.SkippedCount++
			continue
		}

		// 序列化 Clash 配置
		clashConfigJSON, err := json.Marshal(clashProxy)
		if err != nil {
			log.Printf("[Sync Nodes] Error serializing clash config for %s: %v", tag, err)
			response.Errors = append(response.Errors, fmt.Sprintf("tag=%s: 序列化配置失败", tag))
			response.SkippedCount++
			continue
		}

		// 创建节点
		node := storage.Node{
			Username:       username,
			NodeName:       nodeName,
			Protocol:       protocol,
			ClashConfig:    string(clashConfigJSON),
			ParsedConfig:   string(clashConfigJSON),
			Enabled:        true,
			Tag:            fmt.Sprintf("远程:%s", server.Name),
			OriginalServer: server.Name,
			InboundTag:     tag,
		}

		if _, err := h.repo.CreateNode(r.Context(), node); err != nil {
			response.Errors = append(response.Errors, fmt.Sprintf("tag=%s: failed to create node: %v", tag, err))
			continue
		}

		response.SyncedCount++
		response.SyncedTags = append(response.SyncedTags, fmt.Sprintf("%s (port:%d)", tag, int(port)))
	}

	response.Message = fmt.Sprintf("已同步 %d 个节点，跳过 %d 个", response.SyncedCount, response.SkippedCount)
	if len(response.Errors) > 0 {
		response.Success = response.SyncedCount > 0
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// inboundToClashProxy 将 Xray 入站配置转换为 Clash 代理配置。
// tunnelPort > 0 表示服务器使用隧道模式；将其用作节点的外部端口。
func (h *RemoteManageHandler) inboundToClashProxy(inbound map[string]interface{}, serverHost, serverName string, tunnelPort int) (map[string]interface{}, error) {
	protocol, _ := inbound["protocol"].(string)
	tag, _ := inbound["tag"].(string)
	port, _ := inbound["port"].(float64)
	settings, _ := inbound["settings"].(map[string]interface{})
	streamSettings, _ := inbound["streamSettings"].(map[string]interface{})

	if settings == nil {
		return nil, fmt.Errorf("no settings found")
	}

	// 获取第一个客户/帐户
	var client map[string]interface{}
	if clients, ok := settings["clients"].([]interface{}); ok && len(clients) > 0 {
		client, _ = clients[0].(map[string]interface{})
	} else if accounts, ok := settings["accounts"].([]interface{}); ok && len(accounts) > 0 {
		client, _ = accounts[0].(map[string]interface{})
	}

	if client == nil && protocol != "shadowsocks" {
		return nil, fmt.Errorf("no client/account found")
	}

	// 节点名称
	nodeName := fmt.Sprintf("[%s] %s", serverName, tag)

	nodePort := int(port)
	if tunnelPort > 0 {
		nodePort = tunnelPort
	}

	proxy := map[string]interface{}{
		"name":   nodeName,
		"server": serverHost,
		"port":   nodePort,
	}

	switch protocol {
	case "vless":
		proxy["type"] = "vless"
		if id, ok := client["id"].(string); ok {
			proxy["uuid"] = id
		}
		// 检查流量
		if flow, ok := client["flow"].(string); ok && flow != "" {
			proxy["flow"] = flow
		}
		// 添加流设置
		h.addStreamSettings(proxy, streamSettings)

	case "vmess":
		proxy["type"] = "vmess"
		if id, ok := client["id"].(string); ok {
			proxy["uuid"] = id
		}
		proxy["alterId"] = 0
		if aid, ok := client["alterId"].(float64); ok {
			proxy["alterId"] = int(aid)
		}
		proxy["cipher"] = "auto"
		// 添加流设置
		h.addStreamSettings(proxy, streamSettings)

	case "trojan":
		proxy["type"] = "trojan"
		if password, ok := client["password"].(string); ok {
			proxy["password"] = password
		}
		// 检查流量
		if flow, ok := client["flow"].(string); ok && flow != "" {
			proxy["flow"] = flow
		}
		// 添加流设置
		h.addStreamSettings(proxy, streamSettings)
		// mihomo trojan 使用 sni 而非 servername
		if sn, ok := proxy["servername"]; ok {
			proxy["sni"] = sn
			delete(proxy, "servername")
		}

	case "shadowsocks":
		proxy["type"] = "ss"
		if method, ok := settings["method"].(string); ok {
			proxy["cipher"] = method
		}
		// Shadowsocks 2022 密码处理
		if password, ok := settings["password"].(string); ok {
			if client != nil {
				if clientPassword, ok := client["password"].(string); ok {
					// 对于 SS2022, 拼接服务器密码和客户端密码
					proxy["password"] = password + ":" + clientPassword
				}
			} else {
				proxy["password"] = password
			}
		}

	case "hysteria":
		proxy["type"] = "hysteria2"
		if auth, ok := client["auth"].(string); ok {
			proxy["password"] = auth
		}
		if streamSettings != nil {
			if tlsSettings, ok := streamSettings["tlsSettings"].(map[string]interface{}); ok {
				if sni, ok := tlsSettings["serverName"].(string); ok && sni != "" {
					proxy["sni"] = sni
				}
			}
			if hySettings, ok := streamSettings["hysteriaSettings"].(map[string]interface{}); ok {
				if obfsPwd, ok := hySettings["password"].(string); ok && obfsPwd != "" {
					proxy["obfs"] = "salamander"
					proxy["obfs-password"] = obfsPwd
				}
			}
		}

	case "socks", "http":
		proxy["type"] = protocol
		if user, ok := client["user"].(string); ok {
			proxy["username"] = user
		}
		if pass, ok := client["pass"].(string); ok {
			proxy["password"] = pass
		}

	default:
		return nil, fmt.Errorf("unsupported protocol: %s", protocol)
	}

	return proxy, nil
}

// 将流设置添加到 Clash 代理配置
func (h *RemoteManageHandler) addStreamSettings(proxy map[string]interface{}, streamSettings map[string]interface{}) {
	if streamSettings == nil {
		return
	}

	network, _ := streamSettings["network"].(string)
	security, _ := streamSettings["security"].(string)

	// 设置网络类型（始终包含，即使对于 tcp）
	if network != "" {
		proxy["network"] = network
	}

	// UDP支持
	proxy["udp"] = true

	// 处理 TLS
	if security == "tls" {
		proxy["tls"] = true
		if tlsSettings, ok := streamSettings["tlsSettings"].(map[string]interface{}); ok {
			if sni, ok := tlsSettings["serverName"].(string); ok && sni != "" {
				proxy["servername"] = sni
			}
			if alpn, ok := tlsSettings["alpn"].([]interface{}); ok && len(alpn) > 0 {
				alpnStrs := make([]string, 0, len(alpn))
				for _, a := range alpn {
					if s, ok := a.(string); ok {
						alpnStrs = append(alpnStrs, s)
					}
				}
				proxy["alpn"] = alpnStrs
			}
			if fp, ok := tlsSettings["fingerprint"].(string); ok && fp != "" {
				proxy["client-fingerprint"] = fp
			}
			allowInsecure, _ := tlsSettings["allowInsecure"].(bool)
			proxy["skip-cert-verify"] = allowInsecure
		}
	}

	// 处理现实
	if security == "reality" {
		proxy["tls"] = true
		proxy["skip-cert-verify"] = true
		if realitySettings, ok := streamSettings["realitySettings"].(map[string]interface{}); ok {
			realityOpts := map[string]interface{}{}
			if publicKey, ok := realitySettings["publicKey"].(string); ok {
				realityOpts["public-key"] = publicKey
			}
			// ShortIds 是 Xray 配置中的一个数组
			if shortIds, ok := realitySettings["shortIds"].([]interface{}); ok && len(shortIds) > 0 {
				if sid, ok := shortIds[0].(string); ok {
					realityOpts["short-id"] = sid
				}
			}
			// 后备：单个 ShortId 字段
			if _, exists := realityOpts["short-id"]; !exists {
				if shortId, ok := realitySettings["shortId"].(string); ok {
					realityOpts["short-id"] = shortId
				}
			}
			if spiderX, ok := realitySettings["spiderX"].(string); ok {
				realityOpts["spider-x"] = spiderX
			}
			if len(realityOpts) > 0 {
				proxy["reality-opts"] = realityOpts
			}
			// serverNames 是 Xray 配置中的一个数组
			if serverNames, ok := realitySettings["serverNames"].([]interface{}); ok && len(serverNames) > 0 {
				if sn, ok := serverNames[0].(string); ok && sn != "" {
					proxy["servername"] = sn
				}
			}
			// 后备：单个 serverName 字段
			if _, exists := proxy["servername"]; !exists {
				if sni, ok := realitySettings["serverName"].(string); ok && sni != "" {
					proxy["servername"] = sni
				}
			}
			if fp, ok := realitySettings["fingerprint"].(string); ok && fp != "" {
				proxy["client-fingerprint"] = fp
			}
		}
		// 如果未设置，则为 REALITY 默认客户端指纹
		if _, exists := proxy["client-fingerprint"]; !exists {
			proxy["client-fingerprint"] = "chrome"
		}
	}

	// 处理WebSocket
	if network == "ws" {
		if wsSettings, ok := streamSettings["wsSettings"].(map[string]interface{}); ok {
			wsOpts := map[string]interface{}{}
			if path, ok := wsSettings["path"].(string); ok {
				wsOpts["path"] = path
			}
			if headers, ok := wsSettings["headers"].(map[string]interface{}); ok {
				wsOpts["headers"] = headers
			}
			if len(wsOpts) > 0 {
				proxy["ws-opts"] = wsOpts
			}
		}
	}

	// 处理 gRPC
	if network == "grpc" {
		if grpcSettings, ok := streamSettings["grpcSettings"].(map[string]interface{}); ok {
			grpcOpts := map[string]interface{}{}
			if serviceName, ok := grpcSettings["serviceName"].(string); ok {
				grpcOpts["grpc-service-name"] = serviceName
			}
			if len(grpcOpts) > 0 {
				proxy["grpc-opts"] = grpcOpts
			}
		}
	}

	// 处理 HTTP/2
	if network == "h2" || network == "http" {
		if httpSettings, ok := streamSettings["httpSettings"].(map[string]interface{}); ok {
			h2Opts := map[string]interface{}{}
			if path, ok := httpSettings["path"].(string); ok {
				h2Opts["path"] = path
			}
			if host, ok := httpSettings["host"].([]interface{}); ok && len(host) > 0 {
				h2Opts["host"] = host
			}
			if len(h2Opts) > 0 {
				proxy["h2-opts"] = h2Opts
			}
		}
	}

	// 处理 XHTTP
	if network == "xhttp" {
		if xhttpSettings, ok := streamSettings["xhttpSettings"].(map[string]interface{}); ok {
			xhttpOpts := map[string]interface{}{
				"headers": map[string]interface{}{},
			}
			if path, ok := xhttpSettings["path"].(string); ok {
				xhttpOpts["path"] = path
			}
			proxy["xhttp-opts"] = xhttpOpts
			if mode, ok := xhttpSettings["mode"].(string); ok && mode != "" {
				proxy["mode"] = mode
			}
		}
	}
}

// InboundToClashProxyByServerID 将 Xray 入站配置转换为 Clash 代理 JSON 字符串。
// 这是供事件侦听器使用的导出方法。
func (h *RemoteManageHandler) InboundToClashProxyByServerID(serverID int64, inbound map[string]any) (string, error) {
	ctx := context.Background()
	server, err := h.repo.GetRemoteServer(ctx, serverID)
	if err != nil {
		return "", fmt.Errorf("get server: %w", err)
	}

	// 使用节点服务器字段的 IP 地址
	serverHost := server.IPAddress
	if serverHost == "" {
		return "", fmt.Errorf("server has no IP or domain")
	}

	// 将现有方法的入站转换为map[string]接口
	inboundMap := make(map[string]interface{})
	for k, v := range inbound {
		inboundMap[k] = v
	}

	tunnelPort := 0
	if server.Domain != "" {
		tunnelPort = 443
	}

	proxy, err := h.inboundToClashProxy(inboundMap, serverHost, server.Name, tunnelPort)
	if err != nil {
		return "", err
	}

	clashJSON, err := json.Marshal(proxy)
	if err != nil {
		return "", fmt.Errorf("marshal clash config: %w", err)
	}

	return string(clashJSON), nil
}

// 重置服务器令牌（代理用于推送到服务器）
func (h *RemoteManageHandler) HandleResetServerToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	ctx := r.Context()

	// 获取当前服务器信息以查找旧令牌
	server, err := h.repo.GetRemoteServer(ctx, id)
	if err != nil {
		remoteWriteError(w, http.StatusNotFound, "server not found")
		return
	}
	oldToken := server.Token

	// 重置令牌
	newToken, expiresAt, err := h.repo.ResetServerToken(ctx, id)
	if err != nil {
		remoteWriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// 尝试通过 WebSocket 将新令牌推送到连接的代理
	pushSuccess := false
	if h.wsHandler != nil && h.wsHandler.IsConnected(oldToken) {
		if err := h.wsHandler.SendTokenUpdate(oldToken, newToken, *expiresAt); err != nil {
			log.Printf("[Token Reset] Failed to push token update to agent: %v", err)
		} else {
			pushSuccess = true
			log.Printf("[Token Reset] Successfully pushed new token to server %s", server.Name)
		}
	}

	remoteWriteJSON(w, http.StatusOK, map[string]any{
		"success":      true,
		"server_token": newToken,
		"expires_at":   expiresAt.Format(time.RFC3339),
		"pushed":       pushSuccess,
		"message":      "Server token reset successfully",
	})
}

// 重置代理令牌（服务器使用它从代理中拉取）
func (h *RemoteManageHandler) HandleResetAgentToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	ctx := r.Context()

	// 重置代理令牌
	newToken, expiresAt, err := h.repo.ResetAgentToken(ctx, id)
	if err != nil {
		remoteWriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	remoteWriteJSON(w, http.StatusOK, map[string]any{
		"success":     true,
		"agent_token": newToken,
		"expires_at":  expiresAt.Format(time.RFC3339),
		"message":     "Agent token reset successfully",
	})
}

// 重置服务器令牌和代理令牌
func (h *RemoteManageHandler) HandleResetAllTokens(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	serverID := r.URL.Query().Get("server_id")
	if serverID == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id required")
		return
	}

	id, err := strconv.ParseInt(serverID, 10, 64)
	if err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	ctx := r.Context()

	// 获取当前服务器信息以查找旧令牌
	server, err := h.repo.GetRemoteServer(ctx, id)
	if err != nil {
		remoteWriteError(w, http.StatusNotFound, "server not found")
		return
	}
	oldToken := server.Token

	// 重置所有令牌
	serverToken, serverExpiresAt, agentToken, agentExpiresAt, err := h.repo.ResetAllTokens(ctx, id)
	if err != nil {
		remoteWriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// 尝试通过 WebSocket 将新的服务器令牌推送到连接的代理
	pushSuccess := false
	if h.wsHandler != nil && h.wsHandler.IsConnected(oldToken) {
		if err := h.wsHandler.SendTokenUpdate(oldToken, serverToken, *serverExpiresAt); err != nil {
			log.Printf("[Token Reset] Failed to push token update to agent: %v", err)
		} else {
			pushSuccess = true
			log.Printf("[Token Reset] Successfully pushed new token to server %s", server.Name)
		}
	}

	remoteWriteJSON(w, http.StatusOK, map[string]any{
		"success":                 true,
		"server_token":            serverToken,
		"server_token_expires_at": serverExpiresAt.Format(time.RFC3339),
		"agent_token":             agentToken,
		"agent_token_expires_at":  agentExpiresAt.Format(time.RFC3339),
		"pushed":                  pushSuccess,
		"message":                 "All tokens reset successfully",
	})
}

func (h *RemoteManageHandler) restartXrayWithRecovery(ctx context.Context, serverID int64, logPrefix string) error {
	restartAndVerify := func(waitSec int) error {
		if _, err := h.forwardToRemoteServer(ctx, serverID, http.MethodPost, "/api/child/services/control", []byte(`{"service":"xray","action":"restart"}`)); err != nil {
			return err
		}
		time.Sleep(time.Duration(waitSec) * time.Second)
		statusResult, err := h.forwardToRemoteServer(ctx, serverID, http.MethodGet, "/api/child/services/status", nil)
		if err != nil {
			return fmt.Errorf("failed to check xray status: %v", err)
		}
		var statusResp struct {
			Xray *struct {
				Running bool `json:"running"`
			} `json:"xray"`
		}
		if err := json.Unmarshal(statusResult, &statusResp); err != nil {
			return fmt.Errorf("failed to parse status response: %v", err)
		}
		if statusResp.Xray == nil || !statusResp.Xray.Running {
			return fmt.Errorf("xray process exited after restart (likely port conflict)")
		}
		return nil
	}

	// 第一轮：直接重启，等 2 秒验证
	if err := restartAndVerify(2); err == nil {
		return nil
	} else {
		log.Printf("[%s] Xray restart attempt 1 failed on server %d: %v", logPrefix, serverID, err)
	}

	// 第二轮：可能只是启动慢，等久一点再验证
	if err := restartAndVerify(4); err == nil {
		log.Printf("[%s] Xray restarted on server %d after longer wait", logPrefix, serverID)
		return nil
	} else {
		log.Printf("[%s] Xray restart attempt 2 failed on server %d: %v, trying stream cleanup", logPrefix, serverID, err)
	}

	// 第三轮：清理 nginx stream 端口冲突后重试
	clearPayload, _ := json.Marshal(map[string]int{"port": 443})
	clearResult, clearErr := h.forwardToRemoteServer(ctx, serverID, http.MethodPost, "/api/child/nginx/clear-stream-port", clearPayload)
	if clearErr == nil {
		var clearResp struct {
			Removed int `json:"removed"`
		}
		json.Unmarshal(clearResult, &clearResp)
		if clearResp.Removed > 0 {
			log.Printf("[%s] Removed %d stream config(s) on server %d, retrying", logPrefix, clearResp.Removed, serverID)
			if err := restartAndVerify(3); err == nil {
				log.Printf("[%s] Xray restarted after stream cleanup on server %d", logPrefix, serverID)
				return nil
			}
		}
	} else {
		log.Printf("[%s] Stream cleanup failed on server %d: %v", logPrefix, serverID, clearErr)
	}

	// 第四轮兜底：先停 nginx 释放端口 → 重启 xray → 再启 nginx
	log.Printf("[%s] All normal attempts failed on server %d, trying nginx stop → xray restart → nginx start", logPrefix, serverID)
	h.forwardToRemoteServer(ctx, serverID, http.MethodPost, "/api/child/services/control", []byte(`{"service":"nginx","action":"stop"}`))
	time.Sleep(1 * time.Second)

	if err := restartAndVerify(3); err != nil {
		// xray 还是起不来，把 nginx 恢复
		h.forwardToRemoteServer(ctx, serverID, http.MethodPost, "/api/child/services/control", []byte(`{"service":"nginx","action":"start"}`))
		log.Printf("[%s] Xray restart failed even after stopping nginx on server %d: %v", logPrefix, serverID, err)
		return fmt.Errorf("xray restart failed after all recovery attempts: %v", err)
	}

	// xray 起来了，恢复 nginx
	h.forwardToRemoteServer(ctx, serverID, http.MethodPost, "/api/child/services/control", []byte(`{"service":"nginx","action":"start"}`))
	log.Printf("[%s] Xray restarted via nginx stop/start fallback on server %d", logPrefix, serverID)
	return nil
}

func (h *RemoteManageHandler) HandleValidateSite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ServerID  int64  `json:"server_id"`
		SiteType  string `json:"site_type"`
		SiteValue string `json:"site_value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ServerID == 0 || req.SiteValue == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id and site_value are required")
		return
	}

	payload, _ := json.Marshal(map[string]string{
		"site_type":  req.SiteType,
		"site_value": req.SiteValue,
	})
	resp, err := h.forwardToRemoteServer(r.Context(), req.ServerID, http.MethodPost, "/api/child/validate-site", payload)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, fmt.Sprintf("验证失败: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(resp)
}

func (h *RemoteManageHandler) HandleAddWebsite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ServerID  int64  `json:"server_id"`
		Domain    string `json:"domain"`
		SiteType  string `json:"site_type"`
		SiteValue string `json:"site_value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ServerID == 0 || req.Domain == "" {
		remoteWriteError(w, http.StatusBadRequest, "server_id and domain are required")
		return
	}

	ctx := r.Context()
	server, err := h.repo.GetRemoteServer(ctx, req.ServerID)
	if err != nil {
		remoteWriteError(w, http.StatusNotFound, "server not found")
		return
	}

	domain := strings.ToLower(strings.TrimSpace(req.Domain))
	rootDomain := extractRootDomain(domain)

	// 1. 生成 nginx domain config
	tplDir := "tunnel"
	if server.StealMode == "fallback" {
		tplDir = "fallback"
	}
	tplFile := tplDir + "/domain_static.conf"
	if req.SiteType == "proxy" {
		tplFile = tplDir + "/domain_proxy.conf"
	}
	domainTpl, err := templates.ReadFile(tplFile)
	if err != nil {
		remoteWriteError(w, http.StatusInternalServerError, fmt.Sprintf("读取模板失败: %v", err))
		return
	}
	domainConf := strings.ReplaceAll(string(domainTpl), "{domain}", domain)
	domainConf = strings.ReplaceAll(domainConf, "{root_domain}", rootDomain)
	domainConf = strings.ReplaceAll(domainConf, "{static_root_path}", req.SiteValue)
	domainConf = strings.ReplaceAll(domainConf, "{proxy_pass_server}", req.SiteValue)

	// 2. 部署 nginx domain config（不覆盖 nginx.conf）
	sslPayload, _ := json.Marshal(map[string]any{
		"domain":        domain,
		"domain_config": domainConf,
	})
	if _, err := h.forwardToRemoteServer(ctx, req.ServerID, http.MethodPost, "/api/child/nginx/setup-ssl", sslPayload); err != nil {
		remoteWriteError(w, http.StatusBadGateway, fmt.Sprintf("部署 nginx 配置失败: %v", err))
		return
	}

	// 3. 读取当前 xray 配置
	xrayResp, err := h.forwardToRemoteServer(ctx, req.ServerID, http.MethodGet, "/api/child/xray/config", nil)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, fmt.Sprintf("读取 xray 配置失败: %v", err))
		return
	}
	var xrayConfigResp struct {
		Config string `json:"config"`
	}
	json.Unmarshal(xrayResp, &xrayConfigResp)

	var xrayConfig map[string]any
	if err := json.Unmarshal([]byte(xrayConfigResp.Config), &xrayConfig); err != nil {
		remoteWriteError(w, http.StatusInternalServerError, fmt.Sprintf("解析 xray 配置失败: %v", err))
		return
	}

	// 4. 修改 xray 配置
	if server.StealMode == "fallback" {
		h.addWebsiteFallbackConfig(xrayConfig, domain)
	} else {
		h.addWebsiteTunnelConfig(xrayConfig, domain)
	}

	updatedConfig, _ := json.MarshalIndent(xrayConfig, "", "    ")
	configPayload, _ := json.Marshal(map[string]string{
		"config": string(updatedConfig),
	})
	if _, err := h.forwardToRemoteServer(ctx, req.ServerID, http.MethodPost, "/api/child/xray/config", configPayload); err != nil {
		remoteWriteError(w, http.StatusBadGateway, fmt.Sprintf("写入 xray 配置失败: %v", err))
		return
	}

	// 5. 部署证书
	if h.certHandler != nil {
		cert, certErr := h.repo.GetCertificateByDomain(ctx, rootDomain, req.ServerID)
		if certErr == nil && cert != nil && cert.CertPEM != "" && cert.KeyPEM != "" {
			payload := WSCertDeployPayload{
				Domain:   rootDomain,
				CertPEM:  cert.CertPEM,
				KeyPEM:   cert.KeyPEM,
				CertPath: fmt.Sprintf("/usr/local/nginx/cert/%s.pem", certDeployFilename(cert.Domain)),
				KeyPath:  fmt.Sprintf("/usr/local/nginx/cert/%s.key", certDeployFilename(cert.Domain)),
				Reload:   "nginx",
			}
			h.certHandler.deployToRemoteServer(server, payload)
		}
	}

	// 6. 重启 xray
	if err := h.restartXrayWithRecovery(ctx, req.ServerID, "AddWebsite"); err != nil {
		log.Printf("[AddWebsite] %v", err)
	}

	remoteWriteJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": fmt.Sprintf("网站 %s 添加成功", domain),
	})
}

func (h *RemoteManageHandler) addWebsiteTunnelConfig(config map[string]any, domain string) {
	routing, _ := config["routing"].(map[string]any)
	if routing == nil {
		return
	}
	rules, _ := routing["rules"].([]any)

	for _, rule := range rules {
		r, _ := rule.(map[string]any)
		if r == nil {
			continue
		}
		outTag, _ := r["outboundTag"].(string)
		if outTag != "nginx" {
			continue
		}
		inTags, _ := r["inboundTag"].([]any)
		hasTunnelIn := false
		for _, t := range inTags {
			if s, _ := t.(string); s == "tunnel-in" {
				hasTunnelIn = true
				break
			}
		}
		if !hasTunnelIn {
			continue
		}
		domains, _ := r["domain"].([]any)
		for _, d := range domains {
			if s, _ := d.(string); s == domain {
				return
			}
		}
		r["domain"] = append(domains, domain)
		return
	}

	newRule := map[string]any{
		"inboundTag":  []any{"tunnel-in"},
		"domain":      []any{domain},
		"outboundTag": "nginx",
	}
	rules = append([]any{newRule}, rules...)
	routing["rules"] = rules
}

func (h *RemoteManageHandler) addWebsiteFallbackConfig(config map[string]any, domain string) {
	inbounds, _ := config["inbounds"].([]any)
	for _, inb := range inbounds {
		ib, _ := inb.(map[string]any)
		if ib == nil {
			continue
		}
		settings, _ := ib["settings"].(map[string]any)
		if settings == nil {
			continue
		}
		realitySettings, _ := settings["realitySettings"].(map[string]any)
		if realitySettings == nil {
			continue
		}
		serverNames, _ := realitySettings["serverNames"].([]any)
		for _, sn := range serverNames {
			if s, _ := sn.(string); s == domain {
				return
			}
		}
		realitySettings["serverNames"] = append(serverNames, domain)
		return
	}
}
