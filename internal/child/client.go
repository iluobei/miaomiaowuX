package child

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"miaomiaowu/internal/agentlog"
	"miaomiaowu/internal/storage"
	"miaomiaowu/internal/traffic"
	"miaomiaowu/internal/version"

	"github.com/gorilla/websocket"
)

// ConnectionMode表示当前连接模式
type ConnectionMode string

const (
	ModeWebSocket ConnectionMode = "websocket"
	ModeHTTP      ConnectionMode = "http"
	ModePull      ConnectionMode = "pull"
	ModeAuto      ConnectionMode = "auto"
)

const (
	reconnectBackoffBase = 5 * time.Second
	reconnectBackoffMax  = 5 * time.Minute
)

// Config 保存子服务器模式的配置
type Config struct {
	MasterURL             string        // 主服务器 URL（例如”https://master.example.com”）
	Token                 string        // 身份验证令牌
	ConnectionMode        string        // “auto” (推荐) | “websocket” | “http” | “pull”
	TrafficReportInterval time.Duration // 流量报告间隔（默认1分钟）
	SpeedReportInterval   time.Duration // 速度报告间隔（默认3秒）
	HeartbeatInterval     time.Duration // 心跳间隔（默认30秒）
}

// Client代表连接到主服务器的子服务器客户端
type Client struct {
	config     Config
	collector  *traffic.Collector
	repo       *storage.TrafficRepository
	wsConn     *websocket.Conn
	wsMu       sync.Mutex
	connected  bool
	reconnects int
	stopCh     chan struct{}
	wg         sync.WaitGroup

	// 连接状态
	currentMode   ConnectionMode
	httpClient    *http.Client
	httpAvailable bool
	modeMu        sync.RWMutex

	// 速度计算（来自系统网络接口）
	lastRxBytes    int64
	lastTxBytes    int64
	lastSampleTime time.Time
	speedMu        sync.Mutex
}

// 创建一个新的子服务器客户端
func NewClient(config Config, collector *traffic.Collector, repo *storage.TrafficRepository) *Client {
	if config.TrafficReportInterval == 0 {
		config.TrafficReportInterval = 1 * time.Minute
	}
	if config.SpeedReportInterval == 0 {
		config.SpeedReportInterval = 3 * time.Second
	}
	if config.HeartbeatInterval == 0 {
		config.HeartbeatInterval = 30 * time.Second
	}
	if config.ConnectionMode == "" {
		config.ConnectionMode = string(ModeAuto)
	}
	return &Client{
		config:    config,
		collector: collector,
		repo:      repo,
		stopCh:    make(chan struct{}),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		currentMode: ModePull, // 默认为pull模式
	}
}

// 返回 WebSocket 握手的 HTTP 标头
func (c *Client) wsHeaders() http.Header {
	h := http.Header{}
	h.Set("User-Agent", version.AgentUserAgent)
	return h
}

// 创建带有标准标头（Content-Type、Authorization、User-Agent）的 HTTP 请求
func (c *Client) newRequest(ctx context.Context, method, urlStr string, body []byte) (*http.Request, error) {
	var req *http.Request
	var err error
	if body != nil {
		req, err = http.NewRequestWithContext(ctx, method, urlStr, bytes.NewReader(body))
	} else {
		req, err = http.NewRequestWithContext(ctx, method, urlStr, nil)
	}
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.config.Token)
	req.Header.Set("User-Agent", version.AgentUserAgent)
	return req, nil
}

// 启动子服务器客户端并自动选择模式
func (c *Client) Start(ctx context.Context) {
	log.Printf("[Child Client] Starting in %s mode", c.config.ConnectionMode)

	mode := ConnectionMode(c.config.ConnectionMode)

	switch mode {
	case ModeWebSocket:
		// 只使用WebSocket
		c.wg.Add(1)
		go c.runWebSocket(ctx)

	case ModeHTTP:
		// 仅使用HTTP推送
		c.wg.Add(1)
		go c.runHTTPReporter(ctx)

	case ModePull:
		// 仅使用pull模式 - 只需记录并等待主服务pull
		c.setCurrentMode(ModePull)
		log.Printf("[Child Client] Pull mode enabled - API will be served at /api/child/traffic and /api/child/speed")

	case ModeAuto:
		fallthrough
	default:
		// 自动模式：尝试 WebSocket -> HTTP -> Pull
		c.wg.Add(1)
		go c.runAutoMode(ctx)
	}
}

// 停止子服务器客户端
func (c *Client) Stop() {
	close(c.stopCh)
	c.wg.Wait()

	c.wsMu.Lock()
	if c.wsConn != nil {
		c.wsConn.Close()
	}
	c.wsMu.Unlock()

	log.Printf("[Child Client] Stopped")
}

// 返回 WebSocket 是否已连接
func (c *Client) IsConnected() bool {
	c.wsMu.Lock()
	defer c.wsMu.Unlock()
	return c.connected
}

// 管理 WebSocket 连接生命周期并回退到自动模式
func (c *Client) runWebSocket(ctx context.Context) {
	defer c.wg.Done()

	maxConsecutiveFailures := 5
	consecutiveFailures := 0

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopCh:
			return
		default:
		}

		c.setCurrentMode(ModeWebSocket)
		if err := c.connectAndRun(ctx); err != nil {
			// 检查上下文是否被取消（正常关闭）
			if ctx.Err() != nil {
				log.Printf("[Child Client] Context canceled, stopping gracefully")
				return
			}

			log.Printf("[Child Client] WebSocket error: %v", err)
			consecutiveFailures++

			// 失败次数过多后，切换到自动模式进行回退
			if consecutiveFailures >= maxConsecutiveFailures {
				log.Printf("[Child Client] Too many WebSocket failures (%d), switching to auto mode for fallback...", consecutiveFailures)
				c.runAutoModeLoop(ctx)
				consecutiveFailures = 0 // 自动模式循环后重置
				continue
			}
		} else {
			consecutiveFailures = 0 // 连接成功后重置
		}

		// 重新连接前退避，发送流量数据以保持服务器在线
		backoff := c.calculateBackoff()
		log.Printf("[Child Client] Reconnecting in %v...", backoff)

		// 在退避期间发送流量数据，以防止服务器被标记为离线
		c.waitWithTrafficReport(ctx, backoff)
	}
}

// 计算重连退避时长
func (c *Client) calculateBackoff() time.Duration {
	c.reconnects++

	backoff := reconnectBackoffBase
	for i := 1; i < c.reconnects; i++ {
		// 指数增长具有硬上限以避免溢出。
		if backoff >= reconnectBackoffMax/2 {
			return reconnectBackoffMax
		}
		backoff *= 2
	}

	if backoff > reconnectBackoffMax {
		return reconnectBackoffMax
	}

	return backoff
}

// 建立并维护 WebSocket 连接
func (c *Client) connectAndRun(ctx context.Context) error {
	// 解析master URL并转换为WebSocket URL
	masterURL := c.config.MasterURL
	u, err := url.Parse(masterURL)
	if err != nil {
		return err
	}

	// 将 http(s) 转换为 ws(s)
	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	}

	// 设置WebSocket路径
	u.Path = "/api/remote/ws"

	log.Printf("[Child Client] Connecting to %s", u.String())

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.DialContext(ctx, u.String(), c.wsHeaders())
	if err != nil {
		return err
	}

	c.wsMu.Lock()
	c.wsConn = conn
	c.wsMu.Unlock()

	defer func() {
		c.wsMu.Lock()
		c.wsConn = nil
		c.connected = false
		c.wsMu.Unlock()
		conn.Close()
	}()

	// 认证
	if err := c.authenticate(conn); err != nil {
		return err
	}

	c.wsMu.Lock()
	c.connected = true
	c.wsMu.Unlock()
	c.reconnects = 0 // 连接成功后重置重新连接计数器

	log.Printf("[Child Client] Connected and authenticated")

	// 启动流量报告和心跳
	return c.runMessageLoop(ctx, conn)
}

// 验证发送验证消息
func (c *Client) authenticate(conn *websocket.Conn) error {
	authPayload, _ := json.Marshal(map[string]string{
		"token": c.config.Token,
	})

	msg := map[string]interface{}{
		"type":    "auth",
		"payload": json.RawMessage(authPayload),
	}

	if err := conn.WriteJSON(msg); err != nil {
		return err
	}

	// 等待认证结果
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, message, err := conn.ReadMessage()
	if err != nil {
		return err
	}

	var result struct {
		Type    string `json:"type"`
		Payload struct {
			Success bool   `json:"success"`
			Message string `json:"message"`
		} `json:"payload"`
	}

	if err := json.Unmarshal(message, &result); err != nil {
		return err
	}

	if result.Type != "auth_result" || !result.Payload.Success {
		return &AuthError{Message: result.Payload.Message}
	}

	return nil
}

// 处理发送流量数据、速度数据和心跳
func (c *Client) runMessageLoop(ctx context.Context, conn *websocket.Conn) error {
	trafficTicker := time.NewTicker(c.config.TrafficReportInterval)
	speedTicker := time.NewTicker(c.config.SpeedReportInterval)
	heartbeatTicker := time.NewTicker(c.config.HeartbeatInterval)
	defer trafficTicker.Stop()
	defer speedTicker.Stop()
	defer heartbeatTicker.Stop()

	// 启动一个 goroutine 来处理传入的消息
	errCh := make(chan error, 1)
	go func() {
		for {
			conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
			_, _, err := conn.ReadMessage()
			if err != nil {
				errCh <- err
				return
			}
			// 处理传入消息（配置更新等）
		}
	}()

	// 发送初始流量和速度数据
	c.sendTrafficData(conn)
	c.sendSpeedData(conn)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-c.stopCh:
			return nil
		case err := <-errCh:
			return err
		case <-trafficTicker.C:
			if err := c.sendTrafficData(conn); err != nil {
				return err
			}
		case <-speedTicker.C:
			if err := c.sendSpeedData(conn); err != nil {
				return err
			}
		case <-heartbeatTicker.C:
			if err := c.sendHeartbeat(conn); err != nil {
				return err
			}
		}
	}
}

// 收集流量数据并发送给master
func (c *Client) sendTrafficData(conn *websocket.Conn) error {
	// 从本地 Xray 收集指标
	stats, err := c.collectLocalMetrics()
	if err != nil {
		log.Printf("[Child Client] Failed to collect metrics: %v", err)
		// 不返回错误，继续使用空统计信息
		stats = &traffic.XrayStats{}
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"stats": stats,
	})

	msg := map[string]interface{}{
		"type":    "traffic",
		"payload": json.RawMessage(payload),
	}

	c.wsMu.Lock()
	err = conn.WriteJSON(msg)
	c.wsMu.Unlock()

	if err != nil {
		return err
	}

	agentlog.Printf("[Child Client] Sent traffic data: %d inbounds, %d outbounds, %d users",
		len(stats.Inbound), len(stats.Outbound), len(stats.User))

	return nil
}

// 发送心跳消息
func (c *Client) sendHeartbeat(conn *websocket.Conn) error {
	now := time.Now()
	payload, _ := json.Marshal(map[string]interface{}{
		"boot_time": now, // 在实际的实现中，这将是实际的启动时间
	})

	msg := map[string]interface{}{
		"type":    "heartbeat",
		"payload": json.RawMessage(payload),
	}

	c.wsMu.Lock()
	err := conn.WriteJSON(msg)
	c.wsMu.Unlock()

	return err
}

// 从本地 Xray 服务器收集流量指标
func (c *Client) collectLocalMetrics() (*traffic.XrayStats, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 获取本地服务器
	servers, err := c.repo.ListXrayServers(ctx)
	if err != nil {
		return nil, err
	}

	stats := &traffic.XrayStats{
		Inbound:  make(map[string]traffic.TrafficData),
		Outbound: make(map[string]traffic.TrafficData),
		User:     make(map[string]traffic.TrafficData),
	}

	// 从每个服务器收集配置路径
	for _, server := range servers {
		if server.ConfigPath == "" {
			continue
		}

		// 从此服务器获取指标
		host, port, err := c.collector.GetMetricsPortFromConfig(server.ConfigPath)
		if err != nil {
			continue
		}

		metrics, err := c.collector.FetchMetrics(host, port)
		if err != nil {
			continue
		}

		if metrics.Stats == nil {
			continue
		}

		// 合并统计数据
		for k, v := range metrics.Stats.Inbound {
			stats.Inbound[k] = v
		}
		for k, v := range metrics.Stats.Outbound {
			stats.Outbound[k] = v
		}
		for k, v := range metrics.Stats.User {
			stats.User[k] = v
		}
	}

	return stats, nil
}

// 返回当前流量统计信息（对于pull模式）
func (c *Client) GetStats() (*traffic.XrayStats, error) {
	return c.collectLocalMetrics()
}

// 返回当前速度数据（针对pull模式）
func (c *Client) GetSpeed() (uploadSpeed, downloadSpeed int64) {
	return c.collectSpeed()
}

// 返回当前连接模式
func (c *Client) GetCurrentMode() ConnectionMode {
	c.modeMu.RLock()
	defer c.modeMu.RUnlock()
	return c.currentMode
}

// 设置当前连接模式
func (c *Client) setCurrentMode(mode ConnectionMode) {
	c.modeMu.Lock()
	defer c.modeMu.Unlock()
	c.currentMode = mode
}

// 实现了三层回退：WebSocket -> HTTP -> Pull
func (c *Client) runAutoMode(ctx context.Context) {
	defer c.wg.Done()
	c.runAutoModeLoop(ctx)
}

// runAutoModeLoop 是自动模式回退的内部循环
// 当发生太多故障时，可以从 runAutoMode 或 runWebSocket 调用它
func (c *Client) runAutoModeLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopCh:
			return
		default:
		}

		// 首先尝试 WebSocket
		log.Printf("[Child Client] Trying WebSocket connection...")
		if err := c.tryWebSocketOnce(ctx); err == nil {
			// WebSocket连接成功，运行直至断开
			c.setCurrentMode(ModeWebSocket)
			log.Printf("[Child Client] WebSocket mode active")
			if err := c.connectAndRun(ctx); err != nil {
				// 检查上下文是否被取消（正常关闭）
				if ctx.Err() != nil {
					log.Printf("[Child Client] Context canceled, stopping gracefully")
					return
				}
				log.Printf("[Child Client] WebSocket disconnected: %v", err)
				backoff := c.calculateBackoff()
				log.Printf("[Child Client] Reconnecting in %v...", backoff)
				c.waitWithTrafficReport(ctx, backoff)
			}
			continue
		} else {
			log.Printf("[Child Client] WebSocket failed: %v, trying HTTP...", err)
		}

		// 尝试 HTTP 推送
		if c.tryHTTPOnce(ctx) {
			c.setCurrentMode(ModeHTTP)
			c.reconnects = 0 // HTTP 可达，重置重新连接退避
			log.Printf("[Child Client] HTTP mode active")
			c.runHTTPReporterLoop(ctx)
			// 检查 HTTP 循环结束后是否应该退出
			if ctx.Err() != nil {
				return
			}
			continue
		}

		// 回退到pull模式
		c.setCurrentMode(ModePull)
		log.Printf("[Child Client] Falling back to pull mode - API available at /api/child/traffic and /api/child/speed")

		// 在pull模式下，仍然通过 HTTP 发送流量数据以保持服务器标记为在线
		// 在重试更高优先级模式之前运行带有流量报告的短循环
		backoff := c.calculateBackoff()
		if backoff < 30*time.Second {
			backoff = 30 * time.Second
		}
		log.Printf("[Child Client] Pull mode retry backoff: %v", backoff)
		c.runPullModeWithTrafficReport(ctx, backoff)

		// 检查pull拉模式循环结束后是否应该退出
		if ctx.Err() != nil {
			return
		}
		log.Printf("[Child Client] Retrying higher-priority connection modes...")
	}
}

// 尝试单个 WebSocket 连接测试
func (c *Client) tryWebSocketOnce(ctx context.Context) error {
	masterURL := c.config.MasterURL
	u, err := url.Parse(masterURL)
	if err != nil {
		return err
	}

	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	}
	u.Path = "/api/remote/ws"

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.DialContext(ctx, u.String(), c.wsHeaders())
	if err != nil {
		return err
	}
	conn.Close()
	return nil
}

// 测试 HTTP 推送是否可用
func (c *Client) tryHTTPOnce(ctx context.Context) bool {
	u, err := url.Parse(c.config.MasterURL)
	if err != nil {
		return false
	}
	u.Path = "/api/remote/heartbeat"

	req, err := c.newRequest(ctx, http.MethodPost, u.String(), []byte("{}"))
	if err != nil {
		return false
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		log.Printf("[Child Client] HTTP test failed: %v", err)
		return false
	}
	defer resp.Body.Close()

	// 接受 200 OK 或 401 Unauthorized（表示服务器可访问）
	c.httpAvailable = resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusUnauthorized
	return c.httpAvailable
}

// 运行 HTTP 推送报告器
func (c *Client) runHTTPReporter(ctx context.Context) {
	defer c.wg.Done()
	c.setCurrentMode(ModeHTTP)
	c.runHTTPReporterLoop(ctx)
}

// 运行 HTTP 报告循环
func (c *Client) runHTTPReporterLoop(ctx context.Context) {
	trafficTicker := time.NewTicker(c.config.TrafficReportInterval)
	speedTicker := time.NewTicker(c.config.SpeedReportInterval)
	heartbeatTicker := time.NewTicker(c.config.HeartbeatInterval)
	defer trafficTicker.Stop()
	defer speedTicker.Stop()
	defer heartbeatTicker.Stop()

	// 发送初始数据
	c.sendTrafficHTTP(ctx)
	c.sendSpeedHTTP(ctx)

	consecutiveErrors := 0
	maxErrors := 5

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopCh:
			return
		case <-trafficTicker.C:
			if err := c.sendTrafficHTTP(ctx); err != nil {
				consecutiveErrors++
				if consecutiveErrors >= maxErrors {
					log.Printf("[Child Client] Too many HTTP errors, will retry connection modes")
					return
				}
			} else {
				consecutiveErrors = 0
			}
		case <-speedTicker.C:
			if err := c.sendSpeedHTTP(ctx); err != nil {
				// 速度错误不太重要，只需记录
				log.Printf("[Child Client] Failed to send speed via HTTP: %v", err)
			}
		case <-heartbeatTicker.C:
			if err := c.sendHeartbeatHTTP(ctx); err != nil {
				consecutiveErrors++
				if consecutiveErrors >= maxErrors {
					log.Printf("[Child Client] Too many HTTP errors, will retry connection modes")
					return
				}
			} else {
				consecutiveErrors = 0
			}
		}
	}
}

// 通过 HTTP POST 发送流量数据
func (c *Client) sendTrafficHTTP(ctx context.Context) error {
	stats, err := c.collectLocalMetrics()
	if err != nil {
		stats = &traffic.XrayStats{}
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"stats": stats,
	})

	u, err := url.Parse(c.config.MasterURL)
	if err != nil {
		return err
	}
	u.Path = "/api/remote/traffic"

	req, err := c.newRequest(ctx, http.MethodPost, u.String(), payload)
	if err != nil {
		return err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	log.Printf("[Child Client] Sent traffic data via HTTP: %d inbounds, %d outbounds, %d users",
		len(stats.Inbound), len(stats.Outbound), len(stats.User))
	return nil
}

// 通过 HTTP POST 发送速度数据
func (c *Client) sendSpeedHTTP(ctx context.Context) error {
	uploadSpeed, downloadSpeed := c.collectSpeed()

	payload, _ := json.Marshal(map[string]interface{}{
		"upload_speed":   uploadSpeed,
		"download_speed": downloadSpeed,
	})

	u, err := url.Parse(c.config.MasterURL)
	if err != nil {
		return err
	}
	u.Path = "/api/remote/speed"

	req, err := c.newRequest(ctx, http.MethodPost, u.String(), payload)
	if err != nil {
		return err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	agentlog.Printf("[Child Client] Sent speed via HTTP: ↑%d B/s ↓%d B/s", uploadSpeed, downloadSpeed)
	return nil
}

// 通过 HTTP POST 发送心跳
func (c *Client) sendHeartbeatHTTP(ctx context.Context) error {
	now := time.Now()
	payload, _ := json.Marshal(map[string]interface{}{
		"boot_time": now,
	})

	u, err := url.Parse(c.config.MasterURL)
	if err != nil {
		return err
	}
	u.Path = "/api/remote/heartbeat"

	req, err := c.newRequest(ctx, http.MethodPost, u.String(), payload)
	if err != nil {
		return err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// runPullModeWithTrafficReport 在发送流量数据的同时运行pull模式以保持服务器在线
// 持续时间指定返回重试更高优先级模式之前运行的时间
func (c *Client) runPullModeWithTrafficReport(ctx context.Context, duration time.Duration) {
	trafficTicker := time.NewTicker(c.config.TrafficReportInterval)
	defer trafficTicker.Stop()

	timeout := time.After(duration)

	// 立即发送初始流量数据
	if err := c.sendTrafficHTTP(ctx); err != nil {
		log.Printf("[Child Client] Pull mode traffic report failed: %v", err)
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopCh:
			return
		case <-timeout:
			return
		case <-trafficTicker.C:
			if err := c.sendTrafficHTTP(ctx); err != nil {
				log.Printf("[Child Client] Pull mode traffic report failed: %v", err)
			}
		}
	}
}

// waitWithTrafficReport 在发送流量数据时等待指定的持续时间
// 防止服务器被标记为离线
func (c *Client) waitWithTrafficReport(ctx context.Context, duration time.Duration) {
	if duration <= 0 {
		return
	}

	// 如果持续时间足够长，立即发送流量
	if duration > 30*time.Second {
		if err := c.sendTrafficHTTP(ctx); err != nil {
			log.Printf("[Child Client] Traffic report during backoff failed: %v", err)
		}
	}

	trafficTicker := time.NewTicker(c.config.TrafficReportInterval)
	defer trafficTicker.Stop()

	timeout := time.After(duration)

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopCh:
			return
		case <-timeout:
			return
		case <-trafficTicker.C:
			if err := c.sendTrafficHTTP(ctx); err != nil {
				log.Printf("[Child Client] Traffic report during backoff failed: %v", err)
			}
		}
	}
}

// 通过 WebSocket 发送速度数据
func (c *Client) sendSpeedData(conn *websocket.Conn) error {
	uploadSpeed, downloadSpeed := c.collectSpeed()

	payload, _ := json.Marshal(map[string]interface{}{
		"upload_speed":   uploadSpeed,
		"download_speed": downloadSpeed,
	})

	msg := map[string]interface{}{
		"type":    "speed",
		"payload": json.RawMessage(payload),
	}

	c.wsMu.Lock()
	err := conn.WriteJSON(msg)
	c.wsMu.Unlock()

	if err != nil {
		return err
	}

	log.Printf("[Child Client] Sent speed data: ↑%d B/s ↓%d B/s", uploadSpeed, downloadSpeed)
	return nil
}

// 计算当前系统网络接口的上传和下载速度
func (c *Client) collectSpeed() (uploadSpeed, downloadSpeed int64) {
	c.speedMu.Lock()
	defer c.speedMu.Unlock()

	// 从系统获取当前网络统计信息
	rxBytes, txBytes := c.getSystemNetworkStats()

	now := time.Now()

	// 计算速度=（当前-上次）/经过的时间
	if !c.lastSampleTime.IsZero() && c.lastRxBytes > 0 {
		elapsed := now.Sub(c.lastSampleTime).Seconds()
		if elapsed > 0 {
			// 上传 = TX（发送），下载 = RX（接收）
			uploadSpeed = int64(float64(txBytes-c.lastTxBytes) / elapsed)
			downloadSpeed = int64(float64(rxBytes-c.lastRxBytes) / elapsed)

			// 确保非负速度
			if uploadSpeed < 0 {
				uploadSpeed = 0
			}
			if downloadSpeed < 0 {
				downloadSpeed = 0
			}
		}
	}

	// 更新最后的值
	c.lastRxBytes = rxBytes
	c.lastTxBytes = txBytes
	c.lastSampleTime = now

	return uploadSpeed, downloadSpeed
}

// 从 /proc/net/dev 读取网络统计信息
func (c *Client) getSystemNetworkStats() (rxBytes, txBytes int64) {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		log.Printf("[Child Client] Failed to read /proc/net/dev: %v", err)
		return 0, 0
	}

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		// 跳过标题行和环回接口
		if strings.HasPrefix(line, "Inter") || strings.HasPrefix(line, "face") || strings.HasPrefix(line, "lo:") {
			continue
		}

		// 解析接口行：“eth0: rx_bytes rx_packets ... tx_bytes tx_packets ...”
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		// 解析值
		fields := strings.Fields(parts[1])
		if len(fields) < 10 {
			continue
		}

		// fields[0] = 接收字节，fields[8] = 发送字节
		rx, err1 := strconv.ParseInt(fields[0], 10, 64)
		tx, err2 := strconv.ParseInt(fields[8], 10, 64)
		if err1 == nil && err2 == nil {
			rxBytes += rx
			txBytes += tx
		}
	}

	return rxBytes, txBytes
}

// AuthError代表认证错误
type AuthError struct {
	Message string
}

func (e *AuthError) Error() string {
	return "authentication failed: " + e.Message
}
