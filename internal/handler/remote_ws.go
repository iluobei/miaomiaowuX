package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"miaomiaowu/internal/agentlog"
	"miaomiaowu/internal/storage"
	"miaomiaowu/internal/traffic"
	"miaomiaowu/internal/version"

	"github.com/gorilla/websocket"
)

// WebSocket 消息类型
const (
	WSMsgTypeAuth                = "auth"
	WSMsgTypeAuthResult          = "auth_result"
	WSMsgTypeHeartbeat           = "heartbeat"
	WSMsgTypeTraffic             = "traffic"
	WSMsgTypeConfig              = "config"
	WSMsgTypePing                = "ping"
	WSMsgTypePong                = "pong"
	WSMsgTypeSpeed               = "speed"                 // 实时速度数据
	WSMsgTypeCertRequest         = "cert_request"          // Master -> Agent：请求证书
	WSMsgTypeCertUpdate          = "cert_update"           // Agent -> Master：证书结果
	WSMsgTypeCertDeploy          = "cert_deploy"           // Master -> Agent：部署证书
	WSMsgTypeTokenUpdate         = "token_update"          // Master -> Agent：推送新的服务器令牌
	WSMsgTypeScanResult          = "scan_result"           // Agent -> Master：启动扫描结果
	WSMsgTypeDomainLatencyProbe  = "domain_latency_probe"  // Master -> Agent：探测域延迟
	WSMsgTypeDomainLatencyResult = "domain_latency_result" // Agent -> Master：探测结果
)

// WSMessage 表示 WebSocket 消息
type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// WSAuthPayload 表示身份验证消息负载
type WSAuthPayload struct {
	Token string `json:"token"`
}

// WSAuthResultPayload 表示身份验证结果消息负载
type WSAuthResultPayload struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// WSTrafficPayload 表示流量数据消息负载
type WSTrafficPayload struct {
	Stats *traffic.XrayStats `json:"stats,omitempty"`
}

// WSHeartbeatPayload 表示心跳消息负载
type WSHeartbeatPayload struct {
	BootTime     *time.Time `json:"boot_time,omitempty"`
	XrayBootTime *time.Time `json:"xray_boot_time,omitempty"`
	ListenPort   int        `json:"listen_port,omitempty"`
}

// WSSpeedPayload 表示实时速度数据负载
type WSSpeedPayload struct {
	UploadSpeed   int64 `json:"upload_speed"`   // 字节/秒
	DownloadSpeed int64 `json:"download_speed"` // 字节/秒
}

// WSCertRequestPayload 表示证书请求负载（Master -> Agent）
type WSCertRequestPayload struct {
	CertID         int64  `json:"cert_id"`
	Domain         string `json:"domain"`
	Email          string `json:"email"`
	Provider       string `json:"provider"`
	ChallengeMode  string `json:"challenge_mode"`
	WebrootPath    string `json:"webroot_path,omitempty"`
	DNSProvider    string `json:"dns_provider,omitempty"`
	DNSCredentials string `json:"dns_credentials,omitempty"` // JSON 字符串
}

// WSCertDeployPayload 表示证书部署负载（Master -> Agent）
type WSCertDeployPayload struct {
	Domain   string `json:"domain"`
	CertPEM  string `json:"cert_pem"`
	KeyPEM   string `json:"key_pem"`
	CertPath string `json:"cert_path"`
	KeyPath  string `json:"key_path"`
	Reload   string `json:"reload"` // nginx、xray、两者、无
}

// WSCertUpdatePayload 表示证书结果负载（Agent -> Master）
type WSCertUpdatePayload struct {
	CertID     int64     `json:"cert_id"`
	Domain     string    `json:"domain"`
	Success    bool      `json:"success"`
	CertPath   string    `json:"cert_path,omitempty"`
	KeyPath    string    `json:"key_path,omitempty"`
	CertPEM    string    `json:"cert_pem,omitempty"`
	KeyPEM     string    `json:"key_pem,omitempty"`
	IssueDate  time.Time `json:"issue_date,omitempty"`
	ExpiryDate time.Time `json:"expiry_date,omitempty"`
	Error      string    `json:"error,omitempty"`
}

// WSDomainLatencyProbePayload 从主服务器发送到代理
type WSDomainLatencyProbePayload struct {
	RequestID string   `json:"request_id"`
	Domains   []string `json:"domains"`
	TimeoutMs int      `json:"timeout_ms"`
}

// WSDomainLatencyResultPayload 从代理发送到主服务器
type WSDomainLatencyResultPayload struct {
	RequestID string                      `json:"request_id"`
	Success   bool                        `json:"success"`
	Results   []WSDomainLatencyResultItem `json:"results,omitempty"`
	Error     string                      `json:"error,omitempty"`
}

// WSDomainLatencyResultItem 表示单个域探测结果
type WSDomainLatencyResultItem struct {
	Domain       string `json:"domain"`
	Target       string `json:"target"`
	Success      bool   `json:"success"`
	LatencyMs    int64  `json:"latency_ms,omitempty"`
	Error        string `json:"error,omitempty"`
	NginxSSLPort int    `json:"nginx_ssl_port,omitempty"`
}

// RemoteWSConnection 表示来自子服务器的活动 WebSocket 连接
type RemoteWSConnection struct {
	ServerID   int64
	ServerName string
	Token      string
	Conn       *websocket.Conn
	LastPing   time.Time
	mu         sync.Mutex
}

// RemoteWSHandler 处理来自远程（子）服务器的 WebSocket 连接
type RemoteWSHandler struct {
	repo              *storage.TrafficRepository
	collector         *traffic.Collector
	upgrader          websocket.Upgrader
	conns             sync.Map // 令牌 -> *RemoteWSConnection
	mu                sync.RWMutex
	stealSelfDeployer func(ctx context.Context, serverID int64) error
	pendingProbes     sync.Map // 详见上下文
}

// 创建一个新的 WebSocket 处理程序
func NewRemoteWSHandler(repo *storage.TrafficRepository, collector *traffic.Collector) *RemoteWSHandler {
	return &RemoteWSHandler{
		repo:      repo,
		collector: collector,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true // 允许远程服务器连接的所有来源
			},
		},
	}
}

// 处理 WebSocket 升级和连接
func (h *RemoteWSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("User-Agent") != version.AgentUserAgent {
		http.Error(w, "Forbidden", http.StatusForbidden)
		log.Printf("[Remote WS] Rejected connection from %s: invalid User-Agent", r.RemoteAddr)
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Remote WS] Failed to upgrade connection: %v", err)
		return
	}

	log.Printf("[Remote WS] New connection from %s", r.RemoteAddr)

	// 在 goroutine 中处理连接
	go h.handleConnection(conn, r.RemoteAddr)
}

// 处理单个 WebSocket 连接
func (h *RemoteWSHandler) handleConnection(conn *websocket.Conn, remoteAddr string) {
	defer conn.Close()

	// 设置连接参数
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	var wsConn *RemoteWSConnection
	authenticated := false

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[Remote WS] Connection error from %s: %v", remoteAddr, err)
			}
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("[Remote WS] Invalid message from %s: %v", remoteAddr, err)
			continue
		}

		switch msg.Type {
		case WSMsgTypeAuth:
			wsConn, authenticated = h.handleAuth(conn, remoteAddr, msg.Payload)
			if authenticated {
				// 重置经过身份验证的连接的读取截止时间
				conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
			}

		case WSMsgTypeTraffic:
			if !authenticated {
				h.sendAuthRequired(conn)
				continue
			}
			h.handleTraffic(wsConn, msg.Payload)
			conn.SetReadDeadline(time.Now().Add(5 * time.Minute))

		case WSMsgTypeHeartbeat:
			if !authenticated {
				h.sendAuthRequired(conn)
				continue
			}
			h.handleHeartbeat(wsConn, msg.Payload, remoteAddr)
			conn.SetReadDeadline(time.Now().Add(5 * time.Minute))

		case WSMsgTypePing:
			// 用乒乓球回应
			h.sendMessage(conn, WSMessage{Type: WSMsgTypePong})
			conn.SetReadDeadline(time.Now().Add(5 * time.Minute))

		case WSMsgTypeSpeed:
			if !authenticated {
				h.sendAuthRequired(conn)
				continue
			}
			h.handleSpeed(wsConn, msg.Payload)
			conn.SetReadDeadline(time.Now().Add(5 * time.Minute))

		case WSMsgTypeCertUpdate:
			if !authenticated {
				h.sendAuthRequired(conn)
				continue
			}
			h.handleCertUpdate(wsConn, msg.Payload)
			conn.SetReadDeadline(time.Now().Add(5 * time.Minute))

		case WSMsgTypeScanResult:
			if !authenticated {
				h.sendAuthRequired(conn)
				continue
			}
			h.handleScanResult(wsConn, msg.Payload)
			conn.SetReadDeadline(time.Now().Add(5 * time.Minute))

		case WSMsgTypeDomainLatencyResult:
			if !authenticated {
				h.sendAuthRequired(conn)
				continue
			}
			h.handleDomainLatencyResult(msg.Payload)
			conn.SetReadDeadline(time.Now().Add(5 * time.Minute))

		default:
			log.Printf("[Remote WS] Unknown message type from %s: %s", remoteAddr, msg.Type)
		}
	}

	// 断开连接时清理
	if wsConn != nil {
		h.conns.Delete(wsConn.Token)
		log.Printf("[Remote WS] Connection closed for server %s (%d)", wsConn.ServerName, wsConn.ServerID)
	}
}

// 处理认证消息
func (h *RemoteWSHandler) handleAuth(conn *websocket.Conn, remoteAddr string, payload json.RawMessage) (*RemoteWSConnection, bool) {
	var authPayload WSAuthPayload
	if err := json.Unmarshal(payload, &authPayload); err != nil {
		log.Printf("[Remote WS] Invalid auth payload from %s: %v", remoteAddr, err)
		h.sendAuthResult(conn, false, "Invalid auth payload")
		return nil, false
	}

	if authPayload.Token == "" {
		h.sendAuthResult(conn, false, "Token required")
		return nil, false
	}

	// 验证令牌
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	server, err := h.repo.GetRemoteServerByToken(ctx, authPayload.Token)
	if err != nil {
		log.Printf("[Remote WS] Invalid token from %s", remoteAddr)
		h.sendAuthResult(conn, false, "Invalid token")
		return nil, false
	}

	// 检查是否已经连接
	if existingConn, ok := h.conns.Load(authPayload.Token); ok {
		// 关闭现有连接
		existing := existingConn.(*RemoteWSConnection)
		existing.mu.Lock()
		existing.Conn.Close()
		existing.mu.Unlock()
		h.conns.Delete(authPayload.Token)
		log.Printf("[Remote WS] Closed existing connection for server %s", server.Name)
	}

	// 创建新连接
	wsConn := &RemoteWSConnection{
		ServerID:   server.ID,
		ServerName: server.Name,
		Token:      authPayload.Token,
		Conn:       conn,
		LastPing:   time.Now(),
	}

	h.conns.Store(authPayload.Token, wsConn)

	// 将服务器状态更新为已连接
	// 从远程地址提取IP（删除端口）
	ip := remoteAddr
	if idx := strings.LastIndex(ip, ":"); idx != -1 {
		// 检查是否是带有括号 [::1]:port 的 IPv6
		if !strings.Contains(ip, "[") {
			ip = ip[:idx]
		}
	}

	updateCtx, updateCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer updateCancel()
	if err := h.repo.UpdateRemoteServerHeartbeat(updateCtx, authPayload.Token, ip); err != nil {
		log.Printf("[Remote WS] Failed to update server status for %s: %v", server.Name, err)
	}

	// 重置回退状态，以便当 WS 处于活动状态时拉收集器停止
	if err := h.repo.ResetRemoteServerPushFailCount(updateCtx, server.ID); err != nil {
		log.Printf("[Remote WS] Failed to reset fallback for %s: %v", server.Name, err)
	}

	log.Printf("[Remote WS] Server %s (%d) authenticated via WebSocket from %s", server.Name, server.ID, remoteAddr)
	h.sendAuthResult(conn, true, "Authenticated")

	// 在第一次连接时自动部署窃取配置（服务器处于挂起状态）
	if server.Use443 && server.Domain != "" && server.Status == "pending" && h.stealSelfDeployer != nil {
		go func() {
			// 等待代理完全初始化
			time.Sleep(5 * time.Second)
			deployCtx, deployCancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer deployCancel()
			if err := h.stealSelfDeployer(deployCtx, server.ID); err != nil {
				log.Printf("[Remote WS] Failed to auto-deploy steal-self config for server %s (%d): %v", server.Name, server.ID, err)
			} else {
				log.Printf("[Remote WS] Auto-deployed steal-self config for server %s (%d)", server.Name, server.ID)
			}
		}()
	}

	return wsConn, true
}

// 处理流量数据消息
func (h *RemoteWSHandler) handleTraffic(wsConn *RemoteWSConnection, payload json.RawMessage) {
	var trafficPayload WSTrafficPayload
	if err := json.Unmarshal(payload, &trafficPayload); err != nil {
		log.Printf("[Remote WS] Invalid traffic payload from server %s: %v", wsConn.ServerName, err)
		return
	}

	if trafficPayload.Stats == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 更新流量报告上的last_heartbeat - 这取代了单独心跳的需要
	if err := h.repo.UpdateRemoteServerLastActivity(ctx, wsConn.ServerID); err != nil {
		log.Printf("[Remote WS] Failed to update last activity for server %s: %v", wsConn.ServerName, err)
	}

	if err := h.collector.ProcessRemoteMetrics(ctx, wsConn.ServerID, trafficPayload.Stats); err != nil {
		log.Printf("[Remote WS] Failed to process traffic from server %s: %v", wsConn.ServerName, err)
		return
	}

	agentlog.Printf("[Remote WS] Processed traffic from server %s: %d inbounds, %d outbounds, %d users",
		wsConn.ServerName,
		len(trafficPayload.Stats.Inbound),
		len(trafficPayload.Stats.Outbound),
		len(trafficPayload.Stats.User))
}

// 处理心跳消息
func (h *RemoteWSHandler) handleHeartbeat(wsConn *RemoteWSConnection, payload json.RawMessage, remoteAddr string) {
	var hbPayload WSHeartbeatPayload
	if err := json.Unmarshal(payload, &hbPayload); err != nil {
		log.Printf("[Remote WS] Invalid heartbeat payload from server %s: %v", wsConn.ServerName, err)
	}

	wsConn.mu.Lock()
	wsConn.LastPing = time.Now()
	wsConn.mu.Unlock()

	// 更新数据库中的心跳
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 从远程地址中提取IP
	ip := remoteAddr
	if colonIdx := len(ip) - 1; colonIdx > 0 {
		for i := colonIdx; i >= 0; i-- {
			if ip[i] == ':' {
				ip = ip[:i]
				break
			}
		}
	}

	update := storage.HeartbeatUpdate{
		Token:      wsConn.Token,
		IPAddress:  ip,
		ListenPort: hbPayload.ListenPort,
	}
	if hbPayload.BootTime != nil {
		update.BootTime = hbPayload.BootTime
	}
	if hbPayload.XrayBootTime != nil {
		update.XrayBootTime = hbPayload.XrayBootTime
	}

	if _, err := h.repo.UpdateRemoteServerHeartbeatWithRestart(ctx, update); err != nil {
		log.Printf("[Remote WS] Failed to update heartbeat for server %s: %v", wsConn.ServerName, err)
	}
}

// 处理实时速度数据消息
func (h *RemoteWSHandler) handleSpeed(wsConn *RemoteWSConnection, payload json.RawMessage) {
	var speedPayload WSSpeedPayload
	if err := json.Unmarshal(payload, &speedPayload); err != nil {
		log.Printf("[Remote WS] Invalid speed payload from server %s: %v", wsConn.ServerName, err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 更新速度报告上的last_heartbeat - 这使服务器标记为在线
	if err := h.repo.UpdateRemoteServerLastActivity(ctx, wsConn.ServerID); err != nil {
		log.Printf("[Remote WS] Failed to update last activity for server %s: %v", wsConn.ServerName, err)
	}

	if err := h.repo.UpdateRemoteServerSpeed(ctx, wsConn.ServerID, speedPayload.UploadSpeed, speedPayload.DownloadSpeed); err != nil {
		log.Printf("[Remote WS] Failed to update speed for server %s: %v", wsConn.ServerName, err)
		return
	}

	agentlog.Printf("[Remote WS] Updated speed from server %s: ↑%d B/s ↓%d B/s",
		wsConn.ServerName, speedPayload.UploadSpeed, speedPayload.DownloadSpeed)
}

// 发送认证结果消息
func (h *RemoteWSHandler) sendAuthResult(conn *websocket.Conn, success bool, message string) {
	payload, _ := json.Marshal(WSAuthResultPayload{
		Success: success,
		Message: message,
	})
	h.sendMessage(conn, WSMessage{
		Type:    WSMsgTypeAuthResult,
		Payload: payload,
	})
}

// 发送需要身份验证的消息
func (h *RemoteWSHandler) sendAuthRequired(conn *websocket.Conn) {
	h.sendAuthResult(conn, false, "Authentication required")
}

// 发送 WebSocket 消息
func (h *RemoteWSHandler) sendMessage(conn *websocket.Conn, msg WSMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, data)
}

// 检查服务器是否通过 WebSocket 连接
func (h *RemoteWSHandler) IsConnected(token string) bool {
	_, ok := h.conns.Load(token)
	return ok
}

// 返回已连接服务器令牌的列表
func (h *RemoteWSHandler) GetConnectedServers() []string {
	var tokens []string
	h.conns.Range(func(key, value interface{}) bool {
		tokens = append(tokens, key.(string))
		return true
	})
	return tokens
}

// 将配置更新发送到特定服务器
func (h *RemoteWSHandler) BroadcastConfig(token string, config interface{}) error {
	connInterface, ok := h.conns.Load(token)
	if !ok {
		return nil
	}

	wsConn := connInterface.(*RemoteWSConnection)
	payload, err := json.Marshal(config)
	if err != nil {
		return err
	}

	wsConn.mu.Lock()
	defer wsConn.mu.Unlock()

	return h.sendMessage(wsConn.Conn, WSMessage{
		Type:    WSMsgTypeConfig,
		Payload: payload,
	})
}

// 删除最近未执行 ping 操作的陈旧连接
func (h *RemoteWSHandler) CleanupStaleConnections(timeout time.Duration) {
	cutoff := time.Now().Add(-timeout)

	h.conns.Range(func(key, value interface{}) bool {
		wsConn := value.(*RemoteWSConnection)
		wsConn.mu.Lock()
		lastPing := wsConn.LastPing
		wsConn.mu.Unlock()

		if lastPing.Before(cutoff) {
			log.Printf("[Remote WS] Cleaning up stale connection for server %s", wsConn.ServerName)
			wsConn.Conn.Close()
			h.conns.Delete(key)
		}
		return true
	})
}

// 启动一个 goroutine，定期清理过时的连接
func (h *RemoteWSHandler) StartCleanupLoop(ctx context.Context, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.CleanupStaleConnections(5 * time.Minute)
			}
		}
	}()
}

// 向特定远程服务器发送证书请求
func (h *RemoteWSHandler) SendCertRequest(token string, payload WSCertRequestPayload) error {
	connInterface, ok := h.conns.Load(token)
	if !ok {
		return errors.New("server not connected")
	}

	wsConn := connInterface.(*RemoteWSConnection)
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	wsConn.mu.Lock()
	defer wsConn.mu.Unlock()

	return h.sendMessage(wsConn.Conn, WSMessage{
		Type:    WSMsgTypeCertRequest,
		Payload: payloadBytes,
	})
}

// 向特定远程服务器发送证书部署命令
func (h *RemoteWSHandler) SendCertDeploy(token string, payload WSCertDeployPayload) error {
	connInterface, ok := h.conns.Load(token)
	if !ok {
		return errors.New("server not connected")
	}

	wsConn := connInterface.(*RemoteWSConnection)
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	wsConn.mu.Lock()
	defer wsConn.mu.Unlock()

	return h.sendMessage(wsConn.Conn, WSMessage{
		Type:    WSMsgTypeCertDeploy,
		Payload: payloadBytes,
	})
}

// CertUpdateHandler 是处理证书更新的回调函数类型
type CertUpdateHandler func(serverID int64, payload WSCertUpdatePayload)

// certUpdateHandler 存储证书更新的回调
var certUpdateHandler CertUpdateHandler

// 设置处理证书更新消息的回调
func (h *RemoteWSHandler) SetCertUpdateHandler(handler CertUpdateHandler) {
	certUpdateHandler = handler
}

// 处理来自远程服务器的证书更新消息
func (h *RemoteWSHandler) handleCertUpdate(wsConn *RemoteWSConnection, payload json.RawMessage) {
	var certPayload WSCertUpdatePayload
	if err := json.Unmarshal(payload, &certPayload); err != nil {
		log.Printf("[Remote WS] Invalid cert_update payload from %s: %v", wsConn.ServerName, err)
		return
	}

	log.Printf("[Remote WS] Received cert_update from %s: domain=%s, success=%v",
		wsConn.ServerName, certPayload.Domain, certPayload.Success)

	// 调用已注册的处理程序（如果可用）
	if certUpdateHandler != nil {
		certUpdateHandler(wsConn.ServerID, certPayload)
	}
}

// WSScanResultPayload 表示扫描结果负载（Agent -> Master）
type WSScanResultPayload struct {
	XrayRunning bool                     `json:"xray_running"`
	XrayVersion string                   `json:"xray_version,omitempty"`
	Inbounds    []map[string]interface{} `json:"inbounds,omitempty"`
}

// ScanResultHandler 是处理扫描结果的回调函数类型
type ScanResultHandler func(serverID int64, payload WSScanResultPayload)

// scanResultHandler 存储扫描结果的回调
var scanResultHandler ScanResultHandler

// 设置处理扫描结果消息的回调
func (h *RemoteWSHandler) SetScanResultHandler(handler ScanResultHandler) {
	scanResultHandler = handler
}

// 设置首次连接时自动部署steal-self 配置的回调
func (h *RemoteWSHandler) SetStealSelfDeployer(deployer func(ctx context.Context, serverID int64) error) {
	h.stealSelfDeployer = deployer
}

// 处理来自远程服务器的扫描结果消息
func (h *RemoteWSHandler) handleScanResult(wsConn *RemoteWSConnection, payload json.RawMessage) {
	var scanPayload WSScanResultPayload
	if err := json.Unmarshal(payload, &scanPayload); err != nil {
		log.Printf("[Remote WS] Invalid scan_result payload from %s: %v", wsConn.ServerName, err)
		return
	}

	log.Printf("[Remote WS] Received scan_result from %s: xray_running=%v, inbounds=%d",
		wsConn.ServerName, scanPayload.XrayRunning, len(scanPayload.Inbounds))

	if scanResultHandler != nil {
		scanResultHandler(wsConn.ServerID, scanPayload)
	}
}

// WSTokenUpdatePayload 表示令牌更新负载（Master -> Agent）
type WSTokenUpdatePayload struct {
	ServerToken string    `json:"server_token"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// 向连接的代理发送新的服务器令牌
func (h *RemoteWSHandler) SendTokenUpdate(oldToken string, newToken string, expiresAt time.Time) error {
	connInterface, ok := h.conns.Load(oldToken)
	if !ok {
		return errors.New("server not connected")
	}

	wsConn := connInterface.(*RemoteWSConnection)

	payload := WSTokenUpdatePayload{
		ServerToken: newToken,
		ExpiresAt:   expiresAt,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	wsConn.mu.Lock()
	defer wsConn.mu.Unlock()

	err = h.sendMessage(wsConn.Conn, WSMessage{
		Type:    WSMsgTypeTokenUpdate,
		Payload: payloadBytes,
	})

	if err != nil {
		return err
	}

	// 更新连接的令牌引用
	h.conns.Delete(oldToken)
	wsConn.Token = newToken
	h.conns.Store(newToken, wsConn)

	log.Printf("[Remote WS] Sent token_update to server %s, new token will expire at %s",
		wsConn.ServerName, expiresAt.Format(time.RFC3339))

	return nil
}

// 处理来自代理的域延迟探测结果
func (h *RemoteWSHandler) handleDomainLatencyResult(payload json.RawMessage) {
	var result WSDomainLatencyResultPayload
	if err := json.Unmarshal(payload, &result); err != nil {
		log.Printf("[Remote WS] Invalid domain_latency_result payload: %v", err)
		return
	}

	if ch, ok := h.pendingProbes.Load(result.RequestID); ok {
		ch.(chan WSDomainLatencyResultPayload) <- result
	}
}

// 通过 WebSocket 向代理发送域延迟探测请求并等待结果。
func (h *RemoteWSHandler) SendDomainLatencyProbe(serverID int64, domains []string, timeoutMs int) (*WSDomainLatencyResultPayload, error) {
	wsConn, ok := h.GetConnectionByServerID(serverID)
	if !ok {
		return nil, errors.New("server not connected via WebSocket")
	}

	requestID := time.Now().UnixNano()
	reqID := fmt.Sprintf("%d-%d", serverID, requestID)

	resultCh := make(chan WSDomainLatencyResultPayload, 1)
	h.pendingProbes.Store(reqID, resultCh)
	defer func() {
		h.pendingProbes.Delete(reqID)
		close(resultCh)
	}()

	probePayload := WSDomainLatencyProbePayload{
		RequestID: reqID,
		Domains:   domains,
		TimeoutMs: timeoutMs,
	}
	payloadBytes, err := json.Marshal(probePayload)
	if err != nil {
		return nil, fmt.Errorf("marshal probe payload: %w", err)
	}

	wsConn.mu.Lock()
	err = h.sendMessage(wsConn.Conn, WSMessage{
		Type:    WSMsgTypeDomainLatencyProbe,
		Payload: payloadBytes,
	})
	wsConn.mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("send probe message: %w", err)
	}

	// 等待超时结果（探测超时 + 5 秒缓冲区）
	waitTimeout := time.Duration(timeoutMs)*time.Millisecond + 5*time.Second
	select {
	case result := <-resultCh:
		return &result, nil
	case <-time.After(waitTimeout):
		return nil, fmt.Errorf("domain latency probe timed out after %v", waitTimeout)
	}
}

// 按服务器 ID 返回服务器的 WebSocket 连接
func (h *RemoteWSHandler) GetConnectionByServerID(serverID int64) (*RemoteWSConnection, bool) {
	var found *RemoteWSConnection
	h.conns.Range(func(key, value any) bool {
		wsConn := value.(*RemoteWSConnection)
		if wsConn.ServerID == serverID {
			found = wsConn
			return false // 停止迭代
		}
		return true
	})
	return found, found != nil
}
