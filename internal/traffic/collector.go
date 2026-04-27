package traffic

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"miaomiaowu/internal/storage"
)

// XrayMetrics 表示来自 Xray 的 /debug/vars 端点的指标响应
type XrayMetrics struct {
	Stats *XrayStats `json:"stats,omitempty"`
}

// XrayStats 包含入站、出站和用户流量统计信息
type XrayStats struct {
	Inbound  map[string]TrafficData `json:"inbound,omitempty"`
	Outbound map[string]TrafficData `json:"outbound,omitempty"`
	User     map[string]TrafficData `json:"user,omitempty"`
}

// TrafficData 包含上行链路和下行链路流量（以字节为单位）
type TrafficData struct {
	Uplink   int64 `json:"uplink"`
	Downlink int64 `json:"downlink"`
}

// XrayConfig 表示 xray config.json 的结构，用于读取 metrics 端口
type XrayConfig struct {
	Metrics *MetricsConfig `json:"metrics,omitempty"`
}

// MetricsConfig 表示 xray 配置中的指标部分
type MetricsConfig struct {
	Tag    string `json:"tag,omitempty"`
	Listen string `json:"listen,omitempty"`
}

// ServerSpeed 保存服务器的实时速度数据
type ServerSpeed struct {
	UploadSpeed   int64     // 字节/秒
	DownloadSpeed int64     // 字节/秒
	UpdatedAt     time.Time // 最后更新时间
}

// serverTrafficSnapshot 保存流量快照以进行速度计算
type serverTrafficSnapshot struct {
	uplink     int64
	downlink   int64
	sampleTime time.Time
}

// 收集器从 Xray 服务器收集流量数据
type Collector struct {
	repo               *storage.TrafficRepository
	httpClient         *http.Client
	interval           time.Duration
	speedInterval      time.Duration
	defaultMetricsPort int
	defaultMetricsHost string

	// 本地服务器的速度跟踪
	speedMu      sync.RWMutex
	serverSpeeds map[int64]*ServerSpeed           // serverID -> 速度数据
	lastTraffic  map[int64]*serverTrafficSnapshot // serverID -> 最后的流量快照
}

// 创建一个新的流量收集器
func NewCollector(repo *storage.TrafficRepository) *Collector {
	return &Collector{
		repo:               repo,
		httpClient:         &http.Client{Timeout: 10 * time.Second},
		interval:           1 * time.Minute,
		speedInterval:      3 * time.Second,
		defaultMetricsPort: 38889,       // 配置模板中的默认指标端口
		defaultMetricsHost: "127.0.0.1", // 默认指标主机
		serverSpeeds:       make(map[int64]*ServerSpeed),
		lastTraffic:        make(map[int64]*serverTrafficSnapshot),
	}
}

// 设置采集间隔
func (c *Collector) SetInterval(interval time.Duration) {
	if interval > 0 {
		c.interval = interval
	}
}

func (c *Collector) SetSpeedInterval(interval time.Duration) {
	if interval > 0 {
		c.speedInterval = interval
	}
}

// 开始流量收集循环
func (c *Collector) Start(ctx context.Context) {
	log.Printf("[Traffic Collector] Starting with interval: %v", c.interval)

	// 开始后立即收集
	c.collectAll(ctx)

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("[Traffic Collector] Stopping...")
			return
		case <-ticker.C:
			c.collectAll(ctx)
		}
	}
}

// 收集所有活动服务器的流量
func (c *Collector) collectAll(ctx context.Context) {
	// 首先，检查并标记离线远程服务器（60秒无心跳）
	if err := c.repo.MarkOfflineRemoteServers(ctx, 60*time.Second); err != nil {
		log.Printf("[Traffic Collector] Failed to mark offline servers: %v", err)
	}

	// 从需要拉模式（显式拉模式或回退模式）的远程服务器收集
	remoteServers, err := c.repo.ListRemoteServers(ctx)
	if err != nil {
		log.Printf("[Traffic Collector] Failed to list remote servers: %v", err)
		return
	}

	for _, remote := range remoteServers {
		if remote.Status == storage.RemoteServerStatusOffline && c.repo.ShouldUsePullMode(remote) {
			continue
		}
		if c.repo.ShouldUsePullMode(remote) {
			if err := c.CollectFromRemoteServer(ctx, remote); err != nil {
				log.Printf("[Traffic Collector] Failed to pull from remote server %s (%d): %v", remote.Name, remote.ID, err)
			}
		} else {
			c.checkAndTriggerFallback(ctx, remote)
		}
	}
}

// 检查服务器是否应回退到拉取模式
func (c *Collector) checkAndTriggerFallback(ctx context.Context, server storage.RemoteServer) {
	// 如果没有可用的拉取配置则跳过
	if server.PullAddress == "" || server.PullPort == 0 {
		return
	}

	// 如果已处于拉模式则跳过
	if server.FallbackToPull {
		return
	}

	// 检查最后一次心跳是否太旧（超过5分钟）
	offlineThreshold := 5 * time.Minute
	if server.LastHeartbeat == nil || time.Since(*server.LastHeartbeat) > offlineThreshold {
		// 增加失败计数并检查回退
		fallback, err := c.repo.IncrementRemoteServerPushFailCount(ctx, server.ID, 3) // 连续 3 次失败触发回退
		if err != nil {
			log.Printf("[Traffic Collector] Failed to increment push fail count for server %s: %v", server.Name, err)
			return
		}
		if fallback {
			log.Printf("[Traffic Collector] Server %s has been offline too long, fallback to pull mode", server.Name)
		}
	}
}

// 从 xray 配置文件中读取指标端口（子服务器模式使用）
func (c *Collector) GetMetricsPortFromConfig(configPath string) (string, int, error) {
	if configPath == "" {
		return "127.0.0.1", c.defaultMetricsPort, nil
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return "127.0.0.1", c.defaultMetricsPort, fmt.Errorf("read config file: %w", err)
	}

	var config XrayConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return "127.0.0.1", c.defaultMetricsPort, fmt.Errorf("parse config file: %w", err)
	}

	if config.Metrics == nil || config.Metrics.Listen == "" {
		return "", 0, fmt.Errorf("metrics not configured in xray config")
	}

	listen := config.Metrics.Listen
	host := "127.0.0.1"
	var port int

	if strings.Contains(listen, ":") {
		parts := strings.Split(listen, ":")
		if len(parts) == 2 {
			if parts[0] != "" {
				host = parts[0]
			}
			p, err := strconv.Atoi(parts[1])
			if err != nil {
				return "", 0, fmt.Errorf("invalid metrics port: %s", parts[1])
			}
			port = p
		}
	} else {
		p, err := strconv.Atoi(listen)
		if err != nil {
			return "", 0, fmt.Errorf("invalid metrics listen format: %s", listen)
		}
		port = p
	}

	if port <= 0 || port > 65535 {
		return "", 0, fmt.Errorf("invalid metrics port: %d", port)
	}

	return host, port, nil
}

// 从 Xray 的 /debug/vars 端点获取指标
func (c *Collector) FetchMetrics(host string, port int) (*XrayMetrics, error) {
	url := fmt.Sprintf("http://%s:%d/debug/vars", host, port)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	var metrics XrayMetrics
	if err := json.Unmarshal(body, &metrics); err != nil {
		return nil, fmt.Errorf("unmarshal metrics: %w", err)
	}

	return &metrics, nil
}

// 处理并存储收集的指标
func (c *Collector) ProcessMetrics(ctx context.Context, serverID int64, metrics *XrayMetrics) error {
	if metrics == nil || metrics.Stats == nil {
		log.Printf("[Traffic Collector] No stats in metrics for server %d", serverID)
		return nil
	}

	stats := metrics.Stats

	// 计算总流量以进行速度计算
	var totalUplink, totalDownlink int64
	for _, data := range stats.Inbound {
		totalUplink += data.Uplink
		totalDownlink += data.Downlink
	}

	// 计算和更新速度
	c.updateServerSpeed(serverID, totalUplink, totalDownlink)

	// 处理入站流量
	for tag, data := range stats.Inbound {
		if err := c.repo.UpsertNodeTraffic(ctx, serverID, tag, "inbound", data.Uplink, data.Downlink); err != nil {
			log.Printf("[Traffic Collector] Failed to upsert inbound traffic for %s: %v", tag, err)
		}
	}

	// 处理出站流量
	for tag, data := range stats.Outbound {
		if err := c.repo.UpsertNodeTraffic(ctx, serverID, tag, "outbound", data.Uplink, data.Downlink); err != nil {
			log.Printf("[Traffic Collector] Failed to upsert outbound traffic for %s: %v", tag, err)
		}
	}

	// 处理用户流量
	for username, data := range stats.User {
		if err := c.repo.UpsertUserTraffic(ctx, serverID, username, data.Uplink, data.Downlink); err != nil {
			log.Printf("[Traffic Collector] Failed to upsert user traffic for %s: %v", username, err)
		}
	}

	log.Printf("[Traffic Collector] Processed metrics for server %d: %d inbounds, %d outbounds, %d users",
		serverID, len(stats.Inbound), len(stats.Outbound), len(stats.User))

	return nil
}

// 处理从远程服务器报告的指标
func (c *Collector) ProcessRemoteMetrics(ctx context.Context, serverID int64, stats *XrayStats) error {
	if stats == nil {
		return nil
	}

	// 处理入站流量
	for tag, data := range stats.Inbound {
		if err := c.repo.UpsertNodeTraffic(ctx, serverID, tag, "inbound", data.Uplink, data.Downlink); err != nil {
			log.Printf("[Traffic Collector] Failed to upsert remote inbound traffic for %s: %v", tag, err)
		}
	}

	// 处理出站流量
	for tag, data := range stats.Outbound {
		if err := c.repo.UpsertNodeTraffic(ctx, serverID, tag, "outbound", data.Uplink, data.Downlink); err != nil {
			log.Printf("[Traffic Collector] Failed to upsert remote outbound traffic for %s: %v", tag, err)
		}
	}

	// 处理用户流量
	for username, data := range stats.User {
		if err := c.repo.UpsertUserTraffic(ctx, serverID, username, data.Uplink, data.Downlink); err != nil {
			log.Printf("[Traffic Collector] Failed to upsert remote user traffic for %s: %v", username, err)
		}
	}

	log.Printf("[Traffic Collector] Processed remote metrics for server %d: %d inbounds, %d outbounds, %d users",
		serverID, len(stats.Inbound), len(stats.Outbound), len(stats.User))

	return nil
}

// 为所有服务器创建每日快照
func (c *Collector) CreateDailySnapshots(ctx context.Context) error {
	remoteServers, err := c.repo.ListRemoteServers(ctx)
	if err != nil {
		return fmt.Errorf("list remote servers: %w", err)
	}

	date := time.Now().Format("2006-01-02")
	for _, rs := range remoteServers {
		if err := c.repo.CreateTrafficSnapshot(ctx, rs.ID, date); err != nil {
			log.Printf("[Traffic Collector] Failed to create snapshot for server %s: %v", rs.Name, err)
		}
		if err := c.repo.CreateNodeTrafficSnapshots(ctx, rs.ID, date); err != nil {
			log.Printf("[Traffic Collector] Failed to create node snapshot for server %s: %v", rs.Name, err)
		}
		if err := c.repo.CreateUserTrafficSnapshots(ctx, rs.ID, date); err != nil {
			log.Printf("[Traffic Collector] Failed to create user snapshot for server %s: %v", rs.Name, err)
		}
	}

	log.Printf("[Traffic Collector] Created daily snapshots for %d servers", len(remoteServers))
	return nil
}

// 删除旧快照
func (c *Collector) CleanOldData(ctx context.Context, days int) error {
	if err := c.repo.CleanOldSnapshots(ctx, days); err != nil {
		return fmt.Errorf("clean old snapshots: %w", err)
	}
	log.Printf("[Traffic Collector] Cleaned snapshots older than %d days", days)
	return nil
}

// 以拉取模式从远程服务器拉取流量数据
func (c *Collector) CollectFromRemoteServer(ctx context.Context, server storage.RemoteServer) error {
	if server.ConnectionMode != storage.ConnectionModePull {
		return nil
	}

	if server.PullAddress == "" || server.PullPort == 0 {
		return fmt.Errorf("pull address or port not configured for server %s", server.Name)
	}

	url := fmt.Sprintf("http://%s:%d/api/child/traffic", server.PullAddress, server.PullPort)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	// 添加身份验证令牌（首选 PullToken，回退到 Token）
	authToken := server.PullToken
	if authToken == "" {
		authToken = server.Token
	}
	if authToken != "" {
		req.Header.Set("Authorization", "Bearer "+authToken)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}

	// 解析响应
	var response struct {
		Success bool       `json:"success"`
		Stats   *XrayStats `json:"stats,omitempty"`
		Error   string     `json:"error,omitempty"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return fmt.Errorf("unmarshal response: %w", err)
	}

	if !response.Success {
		return fmt.Errorf("remote server error: %s", response.Error)
	}

	if response.Stats == nil {
		log.Printf("[Traffic Collector] No stats from remote server %s", server.Name)
		return nil
	}

	// 处理指标
	if err := c.ProcessRemoteMetrics(ctx, server.ID, response.Stats); err != nil {
		return fmt.Errorf("process metrics: %w", err)
	}

	// 更新上次拉取时间戳
	if err := c.repo.UpdateRemoteServerLastPull(ctx, server.ID); err != nil {
		log.Printf("[Traffic Collector] Failed to update last pull time for server %s: %v", server.Name, err)
	}

	log.Printf("[Traffic Collector] Pulled traffic from remote server %s: %d inbounds, %d outbounds, %d users",
		server.Name, len(response.Stats.Inbound), len(response.Stats.Outbound), len(response.Stats.User))

	return nil
}

// 启动拉模式服务器的速度收集循环
func (c *Collector) StartSpeedCollection(ctx context.Context) {
	ticker := time.NewTicker(c.speedInterval)
	defer ticker.Stop()

	log.Printf("[Speed Collector] Starting speed collection with %v interval", c.speedInterval)

	for {
		select {
		case <-ctx.Done():
			log.Printf("[Speed Collector] Stopping...")
			return
		case <-ticker.C:
			c.collectSpeedFromPullServers(ctx)
		}
	}
}

// 使用拉模式从所有服务器收集速度
func (c *Collector) collectSpeedFromPullServers(ctx context.Context) {
	remoteServers, err := c.repo.ListRemoteServers(ctx)
	if err != nil {
		log.Printf("[Speed Collector] Failed to list remote servers: %v", err)
		return
	}

	for _, remote := range remoteServers {
		// 跳过离线服务器以避免日志垃圾邮件
		if remote.Status == storage.RemoteServerStatusOffline {
			continue
		}
		// 仅使用拉模式从服务器收集
		if c.repo.ShouldUsePullMode(remote) {
			if err := c.PullSpeedFromRemoteServer(ctx, remote); err != nil {
				log.Printf("[Speed Collector] Failed to pull speed from server %s: %v", remote.Name, err)
			}
		}
	}
}

// 从远程服务器拉取速度数据
func (c *Collector) PullSpeedFromRemoteServer(ctx context.Context, server storage.RemoteServer) error {
	if server.PullAddress == "" || server.PullPort == 0 {
		return fmt.Errorf("pull address or port not configured for server %s", server.Name)
	}

	url := fmt.Sprintf("http://%s:%d/api/child/speed", server.PullAddress, server.PullPort)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	// 添加身份验证令牌（首选 PullToken，回退到 Token）
	authToken := server.PullToken
	if authToken == "" {
		authToken = server.Token
	}
	if authToken != "" {
		req.Header.Set("Authorization", "Bearer "+authToken)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}

	// 解析响应
	var response struct {
		Success       bool   `json:"success"`
		UploadSpeed   int64  `json:"upload_speed"`
		DownloadSpeed int64  `json:"download_speed"`
		Error         string `json:"error,omitempty"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return fmt.Errorf("unmarshal response: %w", err)
	}

	if !response.Success {
		return fmt.Errorf("remote server error: %s", response.Error)
	}

	// 数据库更新速度
	if err := c.repo.UpdateRemoteServerSpeed(ctx, server.ID, response.UploadSpeed, response.DownloadSpeed); err != nil {
		return fmt.Errorf("update speed: %w", err)
	}

	log.Printf("[Speed Collector] Pulled speed from server %s: ↑%d B/s ↓%d B/s",
		server.Name, response.UploadSpeed, response.DownloadSpeed)

	return nil
}

// 计算并更新本地服务器的速度
func (c *Collector) updateServerSpeed(serverID int64, currentUplink, currentDownlink int64) {
	c.speedMu.Lock()
	defer c.speedMu.Unlock()

	now := time.Now()

	last, exists := c.lastTraffic[serverID]

	// 更新最后的流量快照
	c.lastTraffic[serverID] = &serverTrafficSnapshot{
		uplink:     currentUplink,
		downlink:   currentDownlink,
		sampleTime: now,
	}

	// 如果我们有以前的数据，计算速度
	if exists && !last.sampleTime.IsZero() {
		elapsed := now.Sub(last.sampleTime).Seconds()
		if elapsed > 0 {
			// 计算字节差
			uplinkDiff := currentUplink - last.uplink
			downlinkDiff := currentDownlink - last.downlink

			// 处理计数器重置（如果重新启动 xray）
			if uplinkDiff < 0 {
				uplinkDiff = currentUplink
			}
			if downlinkDiff < 0 {
				downlinkDiff = currentDownlink
			}

			uploadSpeed := int64(float64(uplinkDiff) / elapsed)
			downloadSpeed := int64(float64(downlinkDiff) / elapsed)

			c.serverSpeeds[serverID] = &ServerSpeed{
				UploadSpeed:   uploadSpeed,
				DownloadSpeed: downloadSpeed,
				UpdatedAt:     now,
			}
		}
	}
}

// 返回本地服务器的当前速度
func (c *Collector) GetServerSpeed(serverID int64) *ServerSpeed {
	c.speedMu.RLock()
	defer c.speedMu.RUnlock()

	if speed, exists := c.serverSpeeds[serverID]; exists {
		// 返回副本以避免竞争条件
		return &ServerSpeed{
			UploadSpeed:   speed.UploadSpeed,
			DownloadSpeed: speed.DownloadSpeed,
			UpdatedAt:     speed.UpdatedAt,
		}
	}
	return nil
}

// 返回所有本地服务器的速度
func (c *Collector) GetAllServerSpeeds() map[int64]*ServerSpeed {
	c.speedMu.RLock()
	defer c.speedMu.RUnlock()

	result := make(map[int64]*ServerSpeed)
	for id, speed := range c.serverSpeeds {
		result[id] = &ServerSpeed{
			UploadSpeed:   speed.UploadSpeed,
			DownloadSpeed: speed.DownloadSpeed,
			UpdatedAt:     speed.UpdatedAt,
		}
	}
	return result
}
