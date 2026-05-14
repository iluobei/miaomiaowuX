package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

// parseNullTimeString 将 sql.NullString 解析为 *time.Time。
// Modernc.org/sqlite 将 time.Time 存储为 RFC3339 字符串，sql.NullTime 无法直接扫描。
func parseNullTimeString(ns sql.NullString) *time.Time {
	if !ns.Valid || ns.String == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05", "2006-01-02T15:04:05Z"} {
		if t, err := time.Parse(layout, ns.String); err == nil {
			return &t
		}
	}
	return nil
}

const (
	pragmaJournalMode = "PRAGMA journal_mode=WAL;"
)

const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

const (
	SubscriptionButtonQR     = "qr"
	SubscriptionButtonCopy   = "copy"
	SubscriptionButtonImport = "import"
)

// TrafficRecord 表示特定日期的聚合流量快照。
type TrafficRecord struct {
	Date           time.Time
	TotalLimit     int64
	TotalUsed      int64
	TotalRemaining int64
}

// TrafficRepository 管理流量使用快照的持久性。
type TrafficRepository struct {
	db *sql.DB
}

// SubscriptionLink 表示向客户端公开的可配置订阅条目。
type SubscriptionLink struct {
	ID           int64
	Name         string
	Type         string
	Description  string
	RuleFilename string
	Buttons      []string
	ShortURL     string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func normalizeSubscriptionButtons(input []string) []string {
	if len(input) == 0 {
		return append([]string(nil), defaultSubscriptionButtons...)
	}

	seen := make(map[string]struct{}, len(input))
	for _, button := range input {
		key := strings.ToLower(strings.TrimSpace(button))
		if _, ok := allowedSubscriptionButtons[key]; ok {
			seen[key] = struct{}{}
		}
	}

	if len(seen) == 0 {
		return append([]string(nil), defaultSubscriptionButtons...)
	}

	order := []string{SubscriptionButtonQR, SubscriptionButtonCopy, SubscriptionButtonImport}
	normalized := make([]string, 0, len(seen))
	for _, button := range order {
		if _, ok := seen[button]; ok {
			normalized = append(normalized, button)
		}
	}

	return normalized
}

func encodeSubscriptionButtons(input []string) (string, error) {
	normalized := normalizeSubscriptionButtons(input)
	data, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func decodeSubscriptionButtons(encoded string) []string {
	if strings.TrimSpace(encoded) == "" {
		return append([]string(nil), defaultSubscriptionButtons...)
	}

	var raw []string
	if err := json.Unmarshal([]byte(encoded), &raw); err != nil {
		return append([]string(nil), defaultSubscriptionButtons...)
	}

	return normalizeSubscriptionButtons(raw)
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSubscriptionLink(scanner rowScanner) (SubscriptionLink, error) {
	var (
		link    SubscriptionLink
		buttons string
	)

	if err := scanner.Scan(&link.ID, &link.Name, &link.Type, &link.Description, &link.RuleFilename, &buttons, &link.ShortURL, &link.CreatedAt, &link.UpdatedAt); err != nil {
		return SubscriptionLink{}, err
	}

	link.Buttons = decodeSubscriptionButtons(buttons)

	return link, nil
}

var (
	ErrTokenNotFound                = errors.New("token not found")
	ErrUserNotFound                 = errors.New("user not found")
	ErrUserExists                   = errors.New("user already exists")
	ErrRuleVersionNotFound          = errors.New("rule version not found")
	ErrSubscriptionNotFound         = errors.New("subscription link not found")
	ErrSubscriptionExists           = errors.New("subscription link already exists")
	ErrNodeNotFound                 = errors.New("node not found")
	ErrSubscribeFileNotFound        = errors.New("subscribe file not found")
	ErrSubscribeFileExists          = errors.New("subscribe file already exists")
	ErrUserSettingsNotFound         = errors.New("user settings not found")
	ErrExternalSubscriptionNotFound = errors.New("external subscription not found")
	ErrExternalSubscriptionExists   = errors.New("external subscription already exists")
	ErrPackageNotFound              = errors.New("package not found")
	ErrPackageExists                = errors.New("package already exists")
	ErrRemoteServerNotFound         = errors.New("remote server not found")
	ErrRemoteServerExists           = errors.New("remote server already exists")
	ErrCertificateNotFound          = errors.New("certificate not found")
	ErrCertificateExists            = errors.New("certificate already exists")
)

var (
	allowedSubscriptionButtons = map[string]struct{}{
		SubscriptionButtonQR:     {},
		SubscriptionButtonCopy:   {},
		SubscriptionButtonImport: {},
	}
	defaultSubscriptionButtons = []string{
		SubscriptionButtonQR,
		SubscriptionButtonCopy,
		SubscriptionButtonImport,
	}
)

const (
	TrafficMethodUp   = "up"
	TrafficMethodDown = "down"
	TrafficMethodBoth = "both"
)

// Package代表流量包模板
type Package struct {
	ID                int64     `json:"id"`
	Name              string    `json:"name"`
	Description       string    `json:"description"`
	TrafficLimitGB    float64   `json:"traffic_limit_gb"` // GB 流量限制
	TrafficLimitBytes int64     `json:"-"`                // 流量限制（以字节为单位）（仅限内部使用）
	CycleDays         int       `json:"cycle_days"`       // 包裹持续时间（天）
	IsReset           bool      `json:"is_reset"`         // 流量是否按月重置
	ResetDay          int       `json:"reset_day"`        // 重置的月份日期 (1-31)
	Nodes             []int64   `json:"nodes"`              // 关联节点 ID
	SpeedLimitMbps    float64   `json:"speed_limit_mbps"`   // 限速 (Mbps)，0=不限
	DeviceLimit       int       `json:"device_limit"`       // 设备数限制，0=不限
	ShortCode         string    `json:"short_code"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// Node代表存储在数据库中的代理节点。
type Node struct {
	ID             int64
	Username       string
	RawURL         string
	NodeName       string
	Protocol       string
	ParsedConfig   string
	ClashConfig    string
	Enabled        bool
	Tag            string
	Tags           []string // 多标签支持（兼容旧版单Tag）
	OriginalServer string
	InboundTag       string // 关联入站标签（用于将节点链接到入站）
	ChainProxyNodeID *int64 // 链式代理目标节点 ID
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// SubscribeFile 表示订阅文件配置。
type SubscribeFile struct {
	ID                  int64
	Name                string
	Description         string
	URL                 string
	Type                string
	Filename            string
	FileShortCode       string     // 用于复合短链接中文件识别的 3 字符代码
	CustomShortCode     string     // 用户自定义的文件短码
	AutoSyncCustomRules bool       // 是否自动同步自定义规则到该文件
	ExpireAt            *time.Time // 可选的过期时间戳
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// UserSettings 代表用户特定的配置。
type UserSettings struct {
	Username             string
	ForceSyncExternal    bool
	MatchRule            string     // “节点名称”或“服务器端口”
	SyncScope            string     // “saved_only”或“all” - 同步外部订阅的范围
	KeepNodeName         bool       // 同步时保留原始节点名称
	CacheExpireMinutes   int        // 缓存过期时间（分钟）
	SyncTraffic          bool       // 同步外部订阅的流量信息
	NodeNameFilter       string     // 正则表达式过滤节点名称
	CustomRulesEnabled   bool       // 启用自定义规则功能
	EnableShortLink      bool       // 启用订阅短链接功能
	UseNewTemplateSystem bool       // 使用新的模板系统（基于数据库），默认true
	EnableProxyProvider  bool       // 启用代理提供商功能
	NodeOrder            []int64    // 节点显示顺序（节点 ID 数组）
	DebugEnabled         bool       // 启用调试日志记录到文件
	DebugLogPath         string     // 当前调试日志文件的路径
	DebugStartedAt       *time.Time // 调试日志记录何时开始
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// SystemConfig 代表所有用户共享的全局系统配置。
type SystemConfig struct {
	ProxyGroupsSourceURL    string // 代理组配置的远程 URL
	ClientCompatibilityMode bool   // 自动过滤客户端不兼容的节点
	EnableShortLink         bool   // 全局启用订阅短链接
	SpeedCollectInterval    int    // 网速采集间隔（秒），默认 3
	TrafficCollectInterval  int    // 流量采集间隔（秒），默认 60
	TrafficCheckInterval    int    // 流量限额检查间隔（秒），默认 120
	HeartbeatInterval       int    // 心跳间隔（秒），默认 30
	AgentLogEnabled         bool   // 是否打印 agent 交互日志，默认关闭

	NotifyEnabled               bool
	TelegramBotToken            string
	TelegramChatID              string
	NotifyLogin                 bool
	NotifySubscribeFetch        bool
	NotifyDailyTraffic          bool
	NotifyServerOffline         bool
	NotifyServerOnline          bool
	NotifyTrafficThreshold      bool
	NotifyDailyTrafficTime      string // "HH:MM"，默认 "08:00"
	NotifyTrafficThresholdPercent int  // 0-100，默认 80
	EnableOverrideScripts       bool   // 启用覆写脚本功能
	SilentMode                  bool   // 静默模式：所有请求返回404，仅订阅接口可用
	SilentModeTimeout           int    // 获取订阅后恢复访问的分钟数，默认15
}

// ExternalSubscription表示用户导入的外部订阅URL。
type ExternalSubscription struct {
	ID          int64
	Username    string
	Name        string
	URL         string
	UserAgent   string // User-Agent 请求头
	NodeCount   int
	LastSyncAt  *time.Time
	Upload      int64      // 已上传流量（字节）
	Download    int64      // 已下载流量（字节）
	Total       int64      // 总流量（字节）
	Expire      *time.Time // 过期时间
	TrafficMode string     // 流量统计方式: "download", "upload", "both"
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// CustomRule 表示 DNS、规则或规则提供者的自定义规则。
type CustomRule struct {
	ID        int64
	Name      string
	Type      string // “dns”、“规则”、“规则提供者”
	Mode      string // “替换”、“前置”
	Content   string
	Enabled   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// OverrideScript 表示 JavaScript 覆写脚本。
type OverrideScript struct {
	ID        int64
	Username  string
	Name      string
	Hook      string // "post_fetch" | "pre_save_nodes"
	Content   string
	Enabled   bool
	SortOrder int
	CreatedAt time.Time
	UpdatedAt time.Time
}

// CustomRuleApplication 跟踪自定义规则应用了哪些内容来订阅文件
type CustomRuleApplication struct {
	ID              int64
	SubscribeFileID int64
	CustomRuleID    int64
	RuleType        string // “dns”、“规则”、“规则提供者”
	RuleMode        string // “替换”、“前置”
	AppliedContent  string // 已应用的 JSON 序列化内容
	ContentHash     string // 内容的 SHA256 哈希值用于快速比较
	AppliedAt       time.Time
}

// ProxyProviderConfig 表示代理提供程序配置。
type ProxyProviderConfig struct {
	ID                        int64
	Username                  string
	ExternalSubscriptionID    int64
	Name                      string
	Type                      string
	Interval                  int
	Proxy                     string
	SizeLimit                 int
	Header                    string
	HealthCheckEnabled        bool
	HealthCheckURL            string
	HealthCheckInterval       int
	HealthCheckTimeout        int
	HealthCheckLazy           bool
	HealthCheckExpectedStatus int
	Filter                    string
	ExcludeFilter             string
	ExcludeType               string
	GeoIPFilter               string
	Override                  string
	ProcessMode               string
	CreatedAt                 time.Time
	UpdatedAt                 time.Time
}

// XrayServer 表示 Xray 服务器配置。
type XrayServer struct {
	ID                   int64     `json:"id"`
	Name                 string    `json:"name"`
	Host                 string    `json:"host"`
	Port                 int       `json:"port"`
	Description          string    `json:"description,omitempty"`
	IsPrimary            bool      `json:"is_primary"`
	ProcessID            int       `json:"process_id"`
	ConfigPath           string    `json:"config_path,omitempty"`
	TrafficLimit         int64     `json:"traffic_limit"`
	TrafficResetDay      int       `json:"traffic_reset_day"`
	TrafficUsedOffset    int64     `json:"traffic_used_offset"`
	TrafficUsed          int64     `json:"traffic_used"`           // 计算字段
	CurrentUploadSpeed   int64     `json:"current_upload_speed"`   // 实时上传速度
	CurrentDownloadSpeed int64     `json:"current_download_speed"` // 实时下载速度
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// 远程服务器的连接模式常量。
const (
	ConnectionModePush      = "push"
	ConnectionModePull      = "pull"
	ConnectionModeWebSocket = "websocket"
	ConnectionModeAuto      = "auto"
)

// 远程服务器状态常量。
const (
	RemoteServerStatusPending   = "pending"
	RemoteServerStatusConnected = "connected"
	RemoteServerStatusOffline   = "offline"
)

// BatchInbound 表示批量入站配置。
type BatchInbound struct {
	ID        int64
	BatchID   string
	Tag       string
	ServerID  int64
	Protocol  string
	Port      int
	CreatedAt time.Time
}

// BatchOutb​​ound 表示批量出站配置。
type BatchOutbound struct {
	ID        int64
	BatchID   string
	Tag       string
	ServerID  int64
	Protocol  string
	CreatedAt time.Time
}

// RemoteServer 代表远程服务器配置。
type RemoteServer struct {
	ID                   int64      `json:"id"`
	Name                 string     `json:"name"`
	Token                string     `json:"token"` // 服务器令牌（代理持有，用于推送到服务器）- 保留用于向后兼容
	Status               string     `json:"status"`
	LastHeartbeat        *time.Time `json:"last_heartbeat,omitempty"`
	IPAddress            string     `json:"ip_address,omitempty"`
	Domain               string     `json:"domain,omitempty"`
	BootTime             *time.Time `json:"boot_time,omitempty"`
	XrayBootTime         *time.Time `json:"xray_boot_time,omitempty"`
	BootCount            int        `json:"boot_count"`
	XrayBootCount        int        `json:"xray_boot_count"`
	TokenExpiresAt       *time.Time `json:"token_expires_at,omitempty"`
	LastTokenRefresh     *time.Time `json:"last_token_refresh,omitempty"`
	ConnectionMode       string     `json:"connection_mode"`
	PullAddress          string     `json:"pull_address,omitempty"`
	PullPort             int        `json:"pull_port,omitempty"`
	PullToken            string     `json:"pull_token,omitempty"` // 代理令牌（服务器持有，用于从代理拉取）- 旧字段名称
	LastPullAt           *time.Time `json:"last_pull_at,omitempty"`
	PushFailCount        int        `json:"push_fail_count"`
	LastPushFail         *time.Time `json:"last_push_fail,omitempty"`
	FallbackToPull       bool       `json:"fallback_to_pull"`
	FallbackAt           *time.Time `json:"fallback_at,omitempty"`
	CurrentUploadSpeed   int64      `json:"current_upload_speed"`
	CurrentDownloadSpeed int64      `json:"current_download_speed"`
	SpeedUpdatedAt       *time.Time `json:"speed_updated_at,omitempty"`
	XrayRunning          bool       `json:"xray_running"`
	XrayVersion          string     `json:"xray_version,omitempty"`
	XrayScannedAt        *time.Time `json:"xray_scanned_at,omitempty"`
	ListenPort           int        `json:"listen_port,omitempty"`
	TrafficLimit         int64      `json:"traffic_limit"`
	TrafficResetDay      int        `json:"traffic_reset_day"`
	// 双令牌系统字段
	AgentToken            string     `json:"agent_token,omitempty"` // 代理令牌（服务器持有，用于从代理拉取）
	AgentTokenExpiresAt   *time.Time `json:"agent_token_expires_at,omitempty"`
	LastAgentTokenRefresh *time.Time `json:"last_agent_token_refresh,omitempty"`
	Use443                bool       `json:"use_443"`                // 是否使用443端口与nginx+xray隧道
	StealMode             string     `json:"steal_mode,omitempty"` // "tunnel" | "fallback"，默认 tunnel
	SiteType              string     `json:"site_type,omitempty"`  // "static" | "proxy"
	SiteValue             string     `json:"site_value,omitempty"` // 静态路径或反向代理地址
	XrayMode              string     `json:"xray_mode"`            // "external" (默认) 或 "embedded"
	TimeOffsetSeconds     *int64     `json:"time_offset_seconds,omitempty"` // agent 与主控的时钟偏差（秒）
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

// NodeTraffic 表示节点的流量统计信息。
type NodeTraffic struct {
	ID            int64     `json:"id"`
	ServerID      int64     `json:"server_id"`
	Tag           string    `json:"tag"`
	Type          string    `json:"type"`
	Uplink        int64     `json:"uplink"`
	Downlink      int64     `json:"downlink"`
	TotalUplink   int64     `json:"total_uplink"`
	TotalDownlink int64     `json:"total_downlink"`
	LastUplink    int64     `json:"last_uplink"`
	LastDownlink  int64     `json:"last_downlink"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// UserTraffic 表示用户的流量统计信息。
type UserTraffic struct {
	ID            int64     `json:"id"`
	ServerID      int64     `json:"server_id"`
	Username      string    `json:"username"`
	Uplink        int64     `json:"uplink"`
	Downlink      int64     `json:"downlink"`
	TotalUplink   int64     `json:"total_uplink"`
	TotalDownlink int64     `json:"total_downlink"`
	LastUplink    int64     `json:"last_uplink"`
	LastDownlink  int64     `json:"last_downlink"`
	CycleStart    time.Time `json:"cycle_start"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// TrafficSnapshot 代表每日流量快照。
type TrafficSnapshot struct {
	ID               int64
	ServerID         int64
	Date             string
	InboundUplink    int64
	InboundDownlink  int64
	OutboundUplink   int64
	OutboundDownlink int64
	UserUplink       int64
	UserDownlink     int64
	CreatedAt        time.Time
}

type NodeTrafficSnapshot struct {
	ID       int64
	ServerID int64
	Tag      string
	Date     string
	Uplink   int64
	Downlink int64
}

type UserTrafficSnapshot struct {
	ID       int64
	ServerID int64
	Username string
	Date     string
	Uplink   int64
	Downlink int64
}

var (
	allowedTrafficMethods = map[string]struct{}{
		TrafficMethodUp:   {},
		TrafficMethodDown: {},
		TrafficMethodBoth: {},
	}
)

// 初始化存储在给定路径或 DSN 中的新的 SQLite 支持的存储库。
func NewTrafficRepository(path string) (*TrafficRepository, error) {
	if path == "" {
		return nil, errors.New("traffic repository path is empty")
	}

	if path != ":memory:" && !strings.HasPrefix(path, "file:") {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, fmt.Errorf("create traffic data directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite db: %w", err)
	}

	db.SetMaxOpenConns(1)

	if _, err := db.Exec(pragmaJournalMode); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable wal: %w", err)
	}

	repo := &TrafficRepository{db: db}
	if err := repo.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}

	return repo, nil
}

// 关闭会释放底层数据库资源。
func (r *TrafficRepository) Close() error {
	if r == nil || r.db == nil {
		return nil
	}
	return r.db.Close()
}

// Checkpoint 强制 WAL 检查点以确保所有数据都写入主数据库文件。
// 这在创建备份之前很有用。
func (r *TrafficRepository) Checkpoint() error {
	if r == nil || r.db == nil {
		return nil
	}
	_, err := r.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}

func (r *TrafficRepository) migrate() error {
	const trafficSchema = `
CREATE TABLE IF NOT EXISTS traffic_records (
    date TEXT PRIMARY KEY,
    total_limit INTEGER NOT NULL,
    total_used INTEGER NOT NULL,
    total_remaining INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`

	if _, err := r.db.Exec(trafficSchema); err != nil {
		return fmt.Errorf("migrate traffic_records: %w", err)
	}

	const userTrafficRecordsSchema = `
CREATE TABLE IF NOT EXISTS user_traffic_records (
    username TEXT NOT NULL,
    date TEXT NOT NULL,
    total_limit INTEGER NOT NULL,
    total_used INTEGER NOT NULL,
    total_remaining INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (username, date)
);
`
	if _, err := r.db.Exec(userTrafficRecordsSchema); err != nil {
		return fmt.Errorf("migrate user_traffic_records: %w", err)
	}

	const userTokenSchema = `
CREATE TABLE IF NOT EXISTS user_tokens (
    username TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`

	if _, err := r.db.Exec(userTokenSchema); err != nil {
		return fmt.Errorf("migrate user_tokens: %w", err)
	}

	// 如果 user_short_code 列不存在，则将其添加到 user_tokens 表中（3 字符代码）
	if err := r.ensureUserTokenColumn("user_short_code", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}

	// 为user_short_code创建唯一索引（仅适用于非空值）
	if _, err := r.db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tokens_user_short_code ON user_tokens(user_short_code) WHERE user_short_code != '';`); err != nil {
		return fmt.Errorf("create user_short_code index: %w", err)
	}

	// 为没有用户短代码的现有用户生成用户短代码
	if err := r.generateMissingUserShortCodes(); err != nil {
		return fmt.Errorf("generate missing user short codes: %w", err)
	}

	const sessionSchema = `
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`

	if _, err := r.db.Exec(sessionSchema); err != nil {
		return fmt.Errorf("migrate sessions: %w", err)
	}

	const userSchema = `
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    email TEXT,
    nickname TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`

	if _, err := r.db.Exec(userSchema); err != nil {
		return fmt.Errorf("migrate users: %w", err)
	}

	if err := r.ensureUserColumn("email", "TEXT"); err != nil {
		return err
	}

	if err := r.ensureUserColumn("nickname", "TEXT"); err != nil {
		return err
	}

	if err := r.ensureUserColumn("avatar_url", "TEXT"); err != nil {
		return err
	}

	if err := r.syncNicknames(); err != nil {
		return err
	}

	if err := r.ensureUserColumn("role", "TEXT NOT NULL DEFAULT 'user'"); err != nil {
		return err
	}

	if err := r.ensureUserColumn("is_active", "INTEGER NOT NULL DEFAULT 1"); err != nil {
		return err
	}

	if err := r.ensureUserColumn("remark", "TEXT"); err != nil {
		return err
	}
	if err := r.ensureUserColumn("is_over_limit", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureUserColumn("totp_secret", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := r.ensureUserColumn("totp_enabled", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureUserColumn("recovery_codes", "TEXT NOT NULL DEFAULT '[]'"); err != nil {
		return err
	}

	const historySchema = `
CREATE TABLE IF NOT EXISTS rule_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(filename, version)
);
`

	if _, err := r.db.Exec(historySchema); err != nil {
		return fmt.Errorf("migrate rule_versions: %w", err)
	}

	const subscriptionSchema = `
CREATE TABLE IF NOT EXISTS subscription_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '',
    description TEXT,
    rule_filename TEXT NOT NULL,
    buttons TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name)
);
`

	if _, err := r.db.Exec(subscriptionSchema); err != nil {
		return fmt.Errorf("migrate subscription_links: %w", err)
	}

	// 如果不存在，则将short_url列添加到subscription_links表中
	if err := r.ensureSubscriptionLinkColumn("short_url", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}

	// 为short_url创建唯一索引（仅适用于非空值）
	if _, err := r.db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_links_short_url ON subscription_links(short_url) WHERE short_url != '';`); err != nil {
		return fmt.Errorf("create short_url index: %w", err)
	}

	const nodesSchema = `
CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    raw_url TEXT NOT NULL,
    node_name TEXT NOT NULL,
    protocol TEXT NOT NULL,
    parsed_config TEXT NOT NULL,
    clash_config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    tag TEXT NOT NULL DEFAULT '手动输入',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nodes_username ON nodes(username);
CREATE INDEX IF NOT EXISTS idx_nodes_protocol ON nodes(protocol);
CREATE INDEX IF NOT EXISTS idx_nodes_enabled ON nodes(enabled);
`

	if _, err := r.db.Exec(nodesSchema); err != nil {
		return fmt.Errorf("migrate nodes: %w", err)
	}

	// 如果现有节点表不存在，则将标签列添加到现有节点表中
	if err := r.ensureNodeColumn("tag", "TEXT NOT NULL DEFAULT '手动输入'"); err != nil {
		return err
	}

	// 如果不存在，则将original_server列添加到现有节点表中
	if err := r.ensureNodeColumn("original_server", "TEXT"); err != nil {
		return err
	}

	// 如果 inbound_tag 列不存在，则将其添加到现有节点表中
	if err := r.ensureNodeColumn("inbound_tag", "TEXT"); err != nil {
		return err
	}
	if err := r.ensureNodeColumn("chain_proxy_node_id", "INTEGER"); err != nil {
		return err
	}

	// 确保列存在后创建标签索引
	if _, err := r.db.Exec(`CREATE INDEX IF NOT EXISTS idx_nodes_tag ON nodes(tag);`); err != nil {
		return fmt.Errorf("create tag index: %w", err)
	}

	const subscribeFilesSchema = `
CREATE TABLE IF NOT EXISTS subscribe_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('create','import','upload')),
    filename TEXT NOT NULL,
    expire_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name)
);
CREATE INDEX IF NOT EXISTS idx_subscribe_files_type ON subscribe_files(type);
`

	if _, err := r.db.Exec(subscribeFilesSchema); err != nil {
		return fmt.Errorf("migrate subscribe_files: %w", err)
	}

	// 用户-订阅关联表（多对多关系）
	// 关联到 subscribe_files 表
	const userSubscriptionsSchema = `
CREATE TABLE IF NOT EXISTS user_subscriptions (
    username TEXT NOT NULL,
    subscription_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (username, subscription_id),
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY(subscription_id) REFERENCES subscribe_files(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_username ON user_subscriptions(username);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_subscription_id ON user_subscriptions(subscription_id);
`

	if _, err := r.db.Exec(userSubscriptionsSchema); err != nil {
		return fmt.Errorf("migrate user_subscriptions: %w", err)
	}

	const userSettingsSchema = `
CREATE TABLE IF NOT EXISTS user_settings (
    username TEXT PRIMARY KEY,
    force_sync_external INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
);
`

	if _, err := r.db.Exec(userSettingsSchema); err != nil {
		return fmt.Errorf("migrate user_settings: %w", err)
	}

	// 如果不存在，则将 match_rule 列添加到 user_settings 表中
	if err := r.ensureUserSettingsColumn("match_rule", "TEXT NOT NULL DEFAULT 'node_name'"); err != nil {
		return err
	}

	// 如果 user_settings 表不存在，则将其添加到 user_settings 表中
	if err := r.ensureUserSettingsColumn("cache_expire_minutes", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	// 如果不存在，则将sync_traffic列添加到user_settings表中
	if err := r.ensureUserSettingsColumn("sync_traffic", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	// 如果不存在，则将sync_scope列添加到user_settings表中
	if err := r.ensureUserSettingsColumn("sync_scope", "TEXT NOT NULL DEFAULT 'saved_only'"); err != nil {
		return err
	}

	// 如果不存在，则将 keep_node_name 列添加到 user_settings 表中
	if err := r.ensureUserSettingsColumn("keep_node_name", "INTEGER NOT NULL DEFAULT 1"); err != nil {
		return err
	}

	const externalSubscriptionsSchema = `
CREATE TABLE IF NOT EXISTS external_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE,
    UNIQUE(username, url)
);
CREATE INDEX IF NOT EXISTS idx_external_subscriptions_username ON external_subscriptions(username);
CREATE INDEX IF NOT EXISTS idx_external_subscriptions_url ON external_subscriptions(url);
`

	if _, err := r.db.Exec(externalSubscriptionsSchema); err != nil {
		return fmt.Errorf("migrate external_subscriptions: %w", err)
	}

	// 将流量字段添加到 external_subscriptions 表
	if err := r.ensureExternalSubscriptionColumn("upload", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureExternalSubscriptionColumn("download", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureExternalSubscriptionColumn("total", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureExternalSubscriptionColumn("expire", "TIMESTAMP"); err != nil {
		return err
	}
	if err := r.ensureExternalSubscriptionColumn("user_agent", "TEXT NOT NULL DEFAULT 'clash-meta/2.4.0'"); err != nil {
		return err
	}
	if err := r.ensureExternalSubscriptionColumn("traffic_mode", "TEXT NOT NULL DEFAULT 'both'"); err != nil {
		return err
	}

	// 将 custom_rules_enabled 添加到 user_settings 表
	if err := r.ensureUserSettingsColumn("custom_rules_enabled", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	// 将enable_short_link添加到user_settings表
	if err := r.ensureUserSettingsColumn("enable_short_link", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	// 将 use_new_template_system 添加到 user_settings 表（默认 true）
	if err := r.ensureUserSettingsColumn("use_new_template_system", "INTEGER NOT NULL DEFAULT 1"); err != nil {
		return err
	}

	// 将enable_proxy_provider添加到user_settings表中
	if err := r.ensureUserSettingsColumn("enable_proxy_provider", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	// 将node_name_filter添加到user_settings表（正则表达式过滤节点名称）
	if err := r.ensureUserSettingsColumn("node_name_filter", "TEXT NOT NULL DEFAULT '剩余|流量|到期|订阅|时间|重置'"); err != nil {
		return err
	}

	// 将node_order添加到user_settings表（用于显示顺序的节点ID的JSON数组）
	if err := r.ensureUserSettingsColumn("node_order", "TEXT NOT NULL DEFAULT '[]'"); err != nil {
		return err
	}

	// 将调试日志记录字段添加到 user_settings 表
	if err := r.ensureUserSettingsColumn("debug_enabled", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureUserSettingsColumn("debug_log_path", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := r.ensureUserSettingsColumn("debug_started_at", "TIMESTAMP"); err != nil {
		return err
	}

	// 将 file_short_code 列添加到 subscribe_files 表（3 字符代码）
	if err := r.ensureSubscribeFileColumn("file_short_code", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}

	// 将 expire_at 列添加到 subscribe_files 表
	if err := r.ensureSubscribeFileColumn("expire_at", "TIMESTAMP"); err != nil {
		return err
	}

	// 在 subscribe_files 中为 file_short_code 创建唯一索引（仅适用于非空值）
	if _, err := r.db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribe_files_file_short_code ON subscribe_files(file_short_code) WHERE file_short_code != '';`); err != nil {
		return fmt.Errorf("create subscribe_files file_short_code index: %w", err)
	}

	// 为没有的现有 subscribe_files 生成文件短代码
	if err := r.generateMissingFileShortCodes(); err != nil {
		return fmt.Errorf("generate missing file short codes: %w", err)
	}

	// 自定义短码支持
	if err := r.ensureSubscribeFileColumn("custom_short_code", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if _, err := r.db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribe_files_custom_short_code ON subscribe_files(custom_short_code) WHERE custom_short_code != '';`); err != nil {
		return fmt.Errorf("create subscribe_files custom_short_code index: %w", err)
	}
	if err := r.ensureUserTokenColumn("custom_user_short_code", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if _, err := r.db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tokens_custom_user_short_code ON user_tokens(custom_user_short_code) WHERE custom_user_short_code != '';`); err != nil {
		return fmt.Errorf("create custom_user_short_code index: %w", err)
	}

	// 为全局设置创建system_config表
	const systemConfigSchema = `
CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    proxy_groups_source_url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
	if _, err := r.db.Exec(systemConfigSchema); err != nil {
		return fmt.Errorf("migrate system_config: %w", err)
	}

	// 确保 system_config 恰好只有一行（单例模式）
	const ensureSystemConfigRow = `
INSERT INTO system_config (id, proxy_groups_source_url)
SELECT 1, ''
WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE id = 1);
`
	if _, err := r.db.Exec(ensureSystemConfigRow); err != nil {
		return fmt.Errorf("seed system_config: %w", err)
	}

	// 将 client_compatibility_mode 列添加到 system_config 表
	if err := r.ensureSystemConfigColumn("client_compatibility_mode", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	if err := r.ensureSystemConfigColumn("enable_short_link", "INTEGER NOT NULL DEFAULT 1"); err != nil {
		return err
	}

	if err := r.ensureSystemConfigColumn("speed_collect_interval", "INTEGER NOT NULL DEFAULT 3"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("traffic_collect_interval", "INTEGER NOT NULL DEFAULT 60"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("traffic_check_interval", "INTEGER NOT NULL DEFAULT 120"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("heartbeat_interval", "INTEGER NOT NULL DEFAULT 30"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("agent_log_enabled", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	if err := r.ensureSystemConfigColumn("notify_enabled", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("telegram_bot_token", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("telegram_chat_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("notify_login", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("notify_subscribe_fetch", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("notify_daily_traffic", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("notify_server_offline", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("notify_server_online", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("notify_traffic_threshold", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("notify_daily_traffic_time", "TEXT NOT NULL DEFAULT '08:00'"); err != nil {
		return err
	}
	if err := r.ensureSystemConfigColumn("notify_traffic_threshold_percent", "INTEGER NOT NULL DEFAULT 80"); err != nil {
		return err
	}

	const customRulesSchema = `
CREATE TABLE IF NOT EXISTS custom_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('dns','rules','rule-providers')),
    mode TEXT NOT NULL CHECK (mode IN ('replace','prepend','append')),
    content TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, type)
);
CREATE INDEX IF NOT EXISTS idx_custom_rules_type ON custom_rules(type);
CREATE INDEX IF NOT EXISTS idx_custom_rules_enabled ON custom_rules(enabled);
`

	if _, err := r.db.Exec(customRulesSchema); err != nil {
		return fmt.Errorf("migrate custom_rules: %w", err)
	}

	// 迁移现有的 custom_rules 表以支持“追加”模式
	if err := r.migrateCustomRulesAppendMode(); err != nil {
		return fmt.Errorf("migrate custom_rules append mode: %w", err)
	}

	// 将 auto_sync_custom_rules 列添加到 subscribe_files 表
	if err := r.ensureSubscribeFileColumn("auto_sync_custom_rules", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	// 创建 custom_rule_applications 表用于跟踪应用的内容
	const customRuleApplicationsSchema = `
CREATE TABLE IF NOT EXISTS custom_rule_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscribe_file_id INTEGER NOT NULL,
    custom_rule_id INTEGER NOT NULL,
    rule_type TEXT NOT NULL,
    rule_mode TEXT NOT NULL,
    applied_content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subscribe_file_id) REFERENCES subscribe_files(id) ON DELETE CASCADE,
    FOREIGN KEY (custom_rule_id) REFERENCES custom_rules(id) ON DELETE CASCADE,
    UNIQUE(subscribe_file_id, custom_rule_id, rule_type)
);
CREATE INDEX IF NOT EXISTS idx_custom_rule_applications_file ON custom_rule_applications(subscribe_file_id);
CREATE INDEX IF NOT EXISTS idx_custom_rule_applications_rule ON custom_rule_applications(custom_rule_id);
`

	if _, err := r.db.Exec(customRuleApplicationsSchema); err != nil {
		return fmt.Errorf("migrate custom_rule_applications: %w", err)
	}

	const overrideScriptsSchema = `
CREATE TABLE IF NOT EXISTS override_scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    hook TEXT NOT NULL,
    content TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_override_scripts_username ON override_scripts(username);
CREATE INDEX IF NOT EXISTS idx_override_scripts_hook ON override_scripts(hook);
`
	if _, err := r.db.Exec(overrideScriptsSchema); err != nil {
		return fmt.Errorf("migrate override_scripts: %w", err)
	}

	if err := r.ensureSystemConfigColumn("enable_override_scripts", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return fmt.Errorf("ensure enable_override_scripts column: %w", err)
	}
	if err := r.ensureSystemConfigColumn("silent_mode", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return fmt.Errorf("ensure silent_mode column: %w", err)
	}
	if err := r.ensureSystemConfigColumn("silent_mode_timeout", "INTEGER NOT NULL DEFAULT 15"); err != nil {
		return err
	}

	const xrayServersSchema = `
CREATE TABLE IF NOT EXISTS xray_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    description TEXT,
    is_local INTEGER NOT NULL DEFAULT 0,
    is_primary INTEGER NOT NULL DEFAULT 0,
    process_id INTEGER NOT NULL DEFAULT 0,
    config_path TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(host, port)
);
CREATE INDEX IF NOT EXISTS idx_xray_servers_is_local ON xray_servers(is_local);
`

	if _, err := r.db.Exec(xrayServersSchema); err != nil {
		return fmt.Errorf("migrate xray_servers: %w", err)
	}

	// 如果不存在，则将 is_primary 列添加到 xray_servers（对于现有数据库）
	_, _ = r.db.Exec("ALTER TABLE xray_servers ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0")

	// 确保列存在后为 is_primary 创建索引
	_, _ = r.db.Exec("CREATE INDEX IF NOT EXISTS idx_xray_servers_is_primary ON xray_servers(is_primary)")

	// 添加流量限制并重置列到 xray_servers（如果不存在）
	_, _ = r.db.Exec("ALTER TABLE xray_servers ADD COLUMN traffic_limit INTEGER NOT NULL DEFAULT 0")
	_, _ = r.db.Exec("ALTER TABLE xray_servers ADD COLUMN traffic_reset_day INTEGER NOT NULL DEFAULT 0")
	_, _ = r.db.Exec("ALTER TABLE xray_servers ADD COLUMN traffic_used_offset INTEGER NOT NULL DEFAULT 0")

	// 包表 - 存储包模板
	const packagesSchema = `
CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    traffic_limit_bytes INTEGER NOT NULL DEFAULT 0,
    cycle_days INTEGER NOT NULL DEFAULT 30,
    is_reset INTEGER NOT NULL DEFAULT 0,
    reset_day INTEGER NOT NULL DEFAULT 1,
    nodes TEXT DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name);
`

	if _, err := r.db.Exec(packagesSchema); err != nil {
		return fmt.Errorf("migrate packages: %w", err)
	}

	// 如果不存在，则将节点列添加到包表中
	_, _ = r.db.Exec("ALTER TABLE packages ADD COLUMN nodes TEXT DEFAULT '[]'")

	// 如果不存在，则将 short_code 列添加到包表中
	_, _ = r.db.Exec("ALTER TABLE packages ADD COLUMN short_code TEXT DEFAULT ''")

	// 为已有 package 补全短码
	if err := r.generateMissingPackageShortCodes(); err != nil {
		return fmt.Errorf("generate missing package short codes: %w", err)
	}

	// 如果不存在，则将 package_id 列添加到用户表中
	const addPackageIDColumn = `
ALTER TABLE users ADD COLUMN package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL;
`
	// 如果列已存在则忽略错误
	_, _ = r.db.Exec(addPackageIDColumn)

	// 添加包裹分配跟踪字段（如果不存在）
	const addPackageFields = `
ALTER TABLE users ADD COLUMN package_start_date TIMESTAMP;
ALTER TABLE users ADD COLUMN package_end_date TIMESTAMP;
`
	_, _ = r.db.Exec("ALTER TABLE users ADD COLUMN package_start_date TIMESTAMP")
	_, _ = r.db.Exec("ALTER TABLE users ADD COLUMN package_end_date TIMESTAMP")
	_, _ = r.db.Exec("ALTER TABLE users ADD COLUMN is_reset INTEGER NOT NULL DEFAULT 0")
	_, _ = r.db.Exec("ALTER TABLE users ADD COLUMN reset_day INTEGER NOT NULL DEFAULT 1")

	// 系统设置表 - 存储全局系统配置
	const systemSettingsSchema = `
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
	if _, err := r.db.Exec(systemSettingsSchema); err != nil {
		return fmt.Errorf("迁移 system_settings: %w", err)
	}

	// 如果不存在则初始化 API token
	if err := r.initializeAPIToken(); err != nil {
		return fmt.Errorf("初始化 api token: %w", err)
	}

	// 远程服务器表 - 存储远程 MMWX 服务器实例
	const remoteServersSchema = `
CREATE TABLE IF NOT EXISTS remote_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'offline')),
    last_heartbeat TIMESTAMP,
    ip_address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_remote_servers_token ON remote_servers(token);
CREATE INDEX IF NOT EXISTS idx_remote_servers_status ON remote_servers(status);
`
	if _, err := r.db.Exec(remoteServersSchema); err != nil {
		return fmt.Errorf("migrate remote_servers: %w", err)
	}

	// 添加新列以进行重启检测和令牌刷新
	if err := r.ensureRemoteServerColumn("boot_time", "TIMESTAMP"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("xray_boot_time", "TIMESTAMP"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("boot_count", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("xray_boot_count", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("token_expires_at", "TIMESTAMP"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("last_token_refresh", "TIMESTAMP"); err != nil {
		return err
	}
	// 混合流量同步的连接模式字段
	if err := r.ensureRemoteServerColumn("connection_mode", "TEXT NOT NULL DEFAULT 'push'"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("pull_address", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("pull_port", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("pull_token", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("last_pull_at", "TIMESTAMP"); err != nil {
		return err
	}
	// 自动回退字段
	if err := r.ensureRemoteServerColumn("push_fail_count", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("last_push_fail", "TIMESTAMP"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("fallback_to_pull", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("fallback_at", "TIMESTAMP"); err != nil {
		return err
	}
	// 实时速度场
	if err := r.ensureRemoteServerColumn("current_upload_speed", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("current_download_speed", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("speed_updated_at", "TIMESTAMP"); err != nil {
		return err
	}
	// X 射线状态字段（来自扫描）
	if err := r.ensureRemoteServerColumn("xray_running", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("xray_version", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("xray_scanned_at", "TIMESTAMP"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("listen_port", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("traffic_limit", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("traffic_reset_day", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("domain", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	// 双令牌系统字段
	if err := r.ensureRemoteServerColumn("agent_token", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("agent_token_expires_at", "TIMESTAMP"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("last_agent_token_refresh", "TIMESTAMP"); err != nil {
		return err
	}
	// 443端口模式（nginx隧道）
	if err := r.ensureRemoteServerColumn("use_443", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("steal_mode", "TEXT NOT NULL DEFAULT 'tunnel'"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("site_type", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("site_value", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("time_offset_seconds", "INTEGER"); err != nil {
		return err
	}
	if err := r.ensureRemoteServerColumn("xray_mode", "TEXT NOT NULL DEFAULT 'external'"); err != nil {
		return err
	}

	// 套餐限速字段
	_, _ = r.db.Exec("ALTER TABLE packages ADD COLUMN speed_limit_mbps REAL NOT NULL DEFAULT 0")
	_, _ = r.db.Exec("ALTER TABLE packages ADD COLUMN device_limit INTEGER NOT NULL DEFAULT 0")

	// 用户限速覆写字段
	_, _ = r.db.Exec("ALTER TABLE users ADD COLUMN speed_limit_override REAL")
	_, _ = r.db.Exec("ALTER TABLE users ADD COLUMN device_limit_override INTEGER")

	// 批量入站表 - 跟踪跨多个服务器批量添加的入站
	const batchInboundsSchema = `
CREATE TABLE IF NOT EXISTS batch_inbounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    server_id INTEGER NOT NULL,
    protocol TEXT NOT NULL,
    port INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES xray_servers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_batch_inbounds_batch_id ON batch_inbounds(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_inbounds_server_id ON batch_inbounds(server_id);
CREATE INDEX IF NOT EXISTS idx_batch_inbounds_tag ON batch_inbounds(tag);
`
	if _, err := r.db.Exec(batchInboundsSchema); err != nil {
		return fmt.Errorf("migrate batch_inbounds: %w", err)
	}

	// 批量出站表 - 跟踪跨多个服务器批量添加的出站
	const batchOutboundsSchema = `
CREATE TABLE IF NOT EXISTS batch_outbounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    server_id INTEGER NOT NULL,
    protocol TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES xray_servers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_batch_outbounds_batch_id ON batch_outbounds(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_outbounds_server_id ON batch_outbounds(server_id);
CREATE INDEX IF NOT EXISTS idx_batch_outbounds_tag ON batch_outbounds(tag);
`
	if _, err := r.db.Exec(batchOutboundsSchema); err != nil {
		return fmt.Errorf("migrate batch_outbounds: %w", err)
	}

	// 节点流量表 - 存储每个服务器的入站/出站流量
	const nodeTrafficSchema = `
CREATE TABLE IF NOT EXISTS node_traffic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('inbound', 'outbound')),
    uplink INTEGER NOT NULL DEFAULT 0,
    downlink INTEGER NOT NULL DEFAULT 0,
    total_uplink INTEGER NOT NULL DEFAULT 0,
    total_downlink INTEGER NOT NULL DEFAULT 0,
    last_uplink INTEGER NOT NULL DEFAULT 0,
    last_downlink INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, tag, type),
    FOREIGN KEY (server_id) REFERENCES xray_servers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_node_traffic_server_id ON node_traffic(server_id);
CREATE INDEX IF NOT EXISTS idx_node_traffic_tag ON node_traffic(tag);
CREATE INDEX IF NOT EXISTS idx_node_traffic_type ON node_traffic(type);
`
	if _, err := r.db.Exec(nodeTrafficSchema); err != nil {
		return fmt.Errorf("migrate node_traffic: %w", err)
	}

	// 用户流量表 - 存储每个服务器的用户流量
	const userTrafficSchema = `
CREATE TABLE IF NOT EXISTS user_traffic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    uplink INTEGER NOT NULL DEFAULT 0,
    downlink INTEGER NOT NULL DEFAULT 0,
    total_uplink INTEGER NOT NULL DEFAULT 0,
    total_downlink INTEGER NOT NULL DEFAULT 0,
    last_uplink INTEGER NOT NULL DEFAULT 0,
    last_downlink INTEGER NOT NULL DEFAULT 0,
    cycle_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, username),
    FOREIGN KEY (server_id) REFERENCES xray_servers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_traffic_server_id ON user_traffic(server_id);
CREATE INDEX IF NOT EXISTS idx_user_traffic_username ON user_traffic(username);
`
	if _, err := r.db.Exec(userTrafficSchema); err != nil {
		return fmt.Errorf("migrate user_traffic: %w", err)
	}

	// 流量快照表 - 存储每日流量快照以了解历史趋势
	const trafficSnapshotsSchema = `
CREATE TABLE IF NOT EXISTS traffic_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    inbound_uplink INTEGER NOT NULL DEFAULT 0,
    inbound_downlink INTEGER NOT NULL DEFAULT 0,
    outbound_uplink INTEGER NOT NULL DEFAULT 0,
    outbound_downlink INTEGER NOT NULL DEFAULT 0,
    user_uplink INTEGER NOT NULL DEFAULT 0,
    user_downlink INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, date),
    FOREIGN KEY (server_id) REFERENCES xray_servers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_traffic_snapshots_server_id ON traffic_snapshots(server_id);
CREATE INDEX IF NOT EXISTS idx_traffic_snapshots_date ON traffic_snapshots(date);
`
	if _, err := r.db.Exec(trafficSnapshotsSchema); err != nil {
		return fmt.Errorf("migrate traffic_snapshots: %w", err)
	}

	const nodeTrafficSnapshotsSchema = `
CREATE TABLE IF NOT EXISTS node_traffic_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    date TEXT NOT NULL,
    uplink INTEGER NOT NULL DEFAULT 0,
    downlink INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, tag, date)
);
CREATE INDEX IF NOT EXISTS idx_node_traffic_snapshots_date ON node_traffic_snapshots(date);
`
	if _, err := r.db.Exec(nodeTrafficSnapshotsSchema); err != nil {
		return fmt.Errorf("migrate node_traffic_snapshots: %w", err)
	}

	const userTrafficSnapshotsSchema = `
CREATE TABLE IF NOT EXISTS user_traffic_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    date TEXT NOT NULL,
    uplink INTEGER NOT NULL DEFAULT 0,
    downlink INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, username, date)
);
CREATE INDEX IF NOT EXISTS idx_user_traffic_snapshots_date ON user_traffic_snapshots(date);
`
	if _, err := r.db.Exec(userTrafficSnapshotsSchema); err != nil {
		return fmt.Errorf("migrate user_traffic_snapshots: %w", err)
	}

	// ACL4SSR 规则配置模板表
	const templatesSchema = `
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'clash' CHECK (category IN ('clash','surge')),
    template_url TEXT NOT NULL DEFAULT '',
    rule_source TEXT NOT NULL DEFAULT '',
    use_proxy INTEGER NOT NULL DEFAULT 0,
    enable_include_all INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name)
);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
`

	if _, err := r.db.Exec(templatesSchema); err != nil {
		return fmt.Errorf("migrate templates: %w", err)
	}

	// 代理提供商配置表
	const proxyProviderConfigsSchema = `
CREATE TABLE IF NOT EXISTS proxy_provider_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    external_subscription_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'http',
    interval INTEGER DEFAULT 3600,
    proxy TEXT DEFAULT 'DIRECT',
    size_limit INTEGER DEFAULT 0,
    header TEXT,
    health_check_enabled INTEGER DEFAULT 1,
    health_check_url TEXT DEFAULT 'https://www.gstatic.com/generate_204',
    health_check_interval INTEGER DEFAULT 300,
    health_check_timeout INTEGER DEFAULT 5000,
    health_check_lazy INTEGER DEFAULT 1,
    health_check_expected_status INTEGER DEFAULT 204,
    filter TEXT,
    exclude_filter TEXT,
    exclude_type TEXT,
    geo_ip_filter TEXT,
    override TEXT,
    process_mode TEXT DEFAULT 'client',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (external_subscription_id) REFERENCES external_subscriptions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_proxy_provider_configs_username ON proxy_provider_configs(username);
CREATE INDEX IF NOT EXISTS idx_proxy_provider_configs_external_subscription_id ON proxy_provider_configs(external_subscription_id);
`
	if _, err := r.db.Exec(proxyProviderConfigsSchema); err != nil {
		return fmt.Errorf("migrate proxy_provider_configs: %w", err)
	}

	// 添加 geo_ip_filter 列（为旧数据库迁移）
	if err := r.ensureProxyProviderConfigColumn("geo_ip_filter", "TEXT"); err != nil {
		return fmt.Errorf("ensure geo_ip_filter column: %w", err)
	}

	// 证书表 - 存储由 ACME 管理的 SSL/TLS 证书
	const certificatesSchema = `
CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    email TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'letsencrypt',
    cert_path TEXT,
    key_path TEXT,
    cert_pem TEXT,
    key_pem TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'valid', 'expired', 'failed')),
    expiry_date TIMESTAMP,
    issue_date TIMESTAMP,
    auto_renew INTEGER NOT NULL DEFAULT 1,
    challenge_mode TEXT NOT NULL DEFAULT 'standalone' CHECK (challenge_mode IN ('standalone', 'webroot', 'dns')),
    webroot_path TEXT,
    remote_server_id INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    dns_provider_id INTEGER NOT NULL DEFAULT 0,
    deploy_target TEXT NOT NULL DEFAULT 'none',
    deploy_cert_path TEXT,
    deploy_key_path TEXT,
    auto_deploy INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(domain, remote_server_id)
);
CREATE INDEX IF NOT EXISTS idx_certificates_domain ON certificates(domain);
CREATE INDEX IF NOT EXISTS idx_certificates_status ON certificates(status);
CREATE INDEX IF NOT EXISTS idx_certificates_remote_server_id ON certificates(remote_server_id);
CREATE INDEX IF NOT EXISTS idx_certificates_expiry_date ON certificates(expiry_date);
`
	if _, err := r.db.Exec(certificatesSchema); err != nil {
		return fmt.Errorf("migrate certificates: %w", err)
	}

	// 迁移：为现有数据库添加新列
	for _, col := range []struct{ name, def string }{
		{"dns_provider_id", "INTEGER NOT NULL DEFAULT 0"},
		{"deploy_target", "TEXT NOT NULL DEFAULT 'none'"},
		{"deploy_cert_path", "TEXT"},
		{"deploy_key_path", "TEXT"},
		{"auto_deploy", "INTEGER NOT NULL DEFAULT 0"},
	} {
		r.db.Exec(fmt.Sprintf("ALTER TABLE certificates ADD COLUMN %s %s", col.name, col.def))
	}

	// 迁移：如果 CHECK 约束已过时，则重建表（challenge_mode 中缺少“dns”）
	var checkSQL string
	row := r.db.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name='certificates'`)
	if row.Scan(&checkSQL) == nil && !strings.Contains(checkSQL, "'dns'") {
		r.db.Exec(`ALTER TABLE certificates RENAME TO _certificates_old`)
		r.db.Exec(certificatesSchema)
		r.db.Exec(`INSERT INTO certificates SELECT * FROM _certificates_old`)
		r.db.Exec(`DROP TABLE _certificates_old`)
	}

	// DNS 提供商表 - 存储可重复使用的 DNS API 凭据
	const dnsProvidersSchema = `
CREATE TABLE IF NOT EXISTS dns_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    provider_type TEXT NOT NULL,
    credentials TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
	if _, err := r.db.Exec(dnsProvidersSchema); err != nil {
		return fmt.Errorf("migrate dns_providers: %w", err)
	}

	const userInboundConfigsSchema = `
CREATE TABLE IF NOT EXISTS user_inbound_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    server_id INTEGER NOT NULL,
    inbound_tag TEXT NOT NULL,
    protocol TEXT NOT NULL,
    credential_json TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
	if _, err := r.db.Exec(userInboundConfigsSchema); err != nil {
		return fmt.Errorf("migrate user_inbound_configs: %w", err)
	}

	const userOutboundsSchema = `
CREATE TABLE IF NOT EXISTS user_outbounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    server_id INTEGER NOT NULL,
    inbound_tag TEXT NOT NULL,
    outbound_tag TEXT NOT NULL,
    outbound_json TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
);
`
	if _, err := r.db.Exec(userOutboundsSchema); err != nil {
		return fmt.Errorf("migrate user_outbounds: %w", err)
	}

	const trafficThresholdNotifiedSchema = `
CREATE TABLE IF NOT EXISTS traffic_threshold_notified (
    server_id INTEGER PRIMARY KEY,
    notified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`
	if _, err := r.db.Exec(trafficThresholdNotifiedSchema); err != nil {
		return fmt.Errorf("migrate traffic_threshold_notified: %w", err)
	}

	return nil
}

// 返回按创建顺序排列的所有已配置订阅链接。
func (r *TrafficRepository) ListSubscriptionLinks(ctx context.Context) ([]SubscriptionLink, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	rows, err := r.db.QueryContext(ctx, `SELECT id, name, type, COALESCE(description, ''), rule_filename, buttons, COALESCE(short_url, ''), created_at, updated_at FROM subscription_links ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list subscription links: %w", err)
	}
	defer rows.Close()

	var links []SubscriptionLink
	for rows.Next() {
		link, err := scanSubscriptionLink(rows)
		if err != nil {
			return nil, fmt.Errorf("scan subscription link: %w", err)
		}
		links = append(links, link)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscription links: %w", err)
	}

	return links, nil
}

// 通过唯一名称检索订阅链接。
func (r *TrafficRepository) GetSubscriptionByName(ctx context.Context, name string) (SubscriptionLink, error) {
	var link SubscriptionLink
	if r == nil || r.db == nil {
		return link, errors.New("traffic repository not initialized")
	}

	name = strings.TrimSpace(name)
	if name == "" {
		return link, errors.New("subscription name is required")
	}

	row := r.db.QueryRowContext(ctx, `SELECT id, name, type, COALESCE(description, ''), rule_filename, buttons, COALESCE(short_url, ''), created_at, updated_at FROM subscription_links WHERE name = ? LIMIT 1`, name)
	result, err := scanSubscriptionLink(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return link, ErrSubscriptionNotFound
		}
		return link, fmt.Errorf("get subscription by name: %w", err)
	}

	return result, nil
}

// 通过标识符检索订阅链接。
func (r *TrafficRepository) GetSubscriptionByID(ctx context.Context, id int64) (SubscriptionLink, error) {
	var link SubscriptionLink
	if r == nil || r.db == nil {
		return link, errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return link, errors.New("subscription id is required")
	}

	row := r.db.QueryRowContext(ctx, `SELECT id, name, type, COALESCE(description, ''), rule_filename, buttons, COALESCE(short_url, ''), created_at, updated_at FROM subscription_links WHERE id = ? LIMIT 1`, id)
	result, err := scanSubscriptionLink(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return link, ErrSubscriptionNotFound
		}
		return link, fmt.Errorf("get subscription by id: %w", err)
	}

	return result, nil
}

// 返回最早创建的订阅链接。
func (r *TrafficRepository) GetFirstSubscriptionLink(ctx context.Context) (SubscriptionLink, error) {
	var link SubscriptionLink
	if r == nil || r.db == nil {
		return link, errors.New("traffic repository not initialized")
	}

	row := r.db.QueryRowContext(ctx, `SELECT id, name, type, COALESCE(description, ''), rule_filename, buttons, COALESCE(short_url, ''), created_at, updated_at FROM subscription_links ORDER BY id ASC LIMIT 1`)
	result, err := scanSubscriptionLink(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return link, ErrSubscriptionNotFound
		}
		return link, fmt.Errorf("get first subscription: %w", err)
	}

	return result, nil
}

// 插入新的订阅链接定义。
func (r *TrafficRepository) CreateSubscriptionLink(ctx context.Context, link SubscriptionLink) (SubscriptionLink, error) {
	if r == nil || r.db == nil {
		return SubscriptionLink{}, errors.New("traffic repository not initialized")
	}

	link.Name = strings.TrimSpace(link.Name)
	link.Type = strings.TrimSpace(link.Type)
	link.Description = strings.TrimSpace(link.Description)
	link.RuleFilename = strings.TrimSpace(link.RuleFilename)

	if link.Name == "" {
		return SubscriptionLink{}, errors.New("subscription name is required")
	}
	if link.Type == "" {
		link.Type = link.Name
	}
	if link.RuleFilename == "" {
		return SubscriptionLink{}, errors.New("rule filename is required")
	}

	encodedButtons, err := encodeSubscriptionButtons(link.Buttons)
	if err != nil {
		return SubscriptionLink{}, fmt.Errorf("encode subscription buttons: %w", err)
	}

	res, err := r.db.ExecContext(ctx, `INSERT INTO subscription_links (name, type, description, rule_filename, buttons) VALUES (?, ?, ?, ?, ?)`, link.Name, link.Type, link.Description, link.RuleFilename, encodedButtons)
	if err != nil {
		lowered := strings.ToLower(err.Error())
		if strings.Contains(lowered, "unique") {
			return SubscriptionLink{}, ErrSubscriptionExists
		}
		return SubscriptionLink{}, fmt.Errorf("create subscription link: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return SubscriptionLink{}, fmt.Errorf("fetch subscription id: %w", err)
	}

	return r.GetSubscriptionByID(ctx, id)
}

// 更新现有订阅链接。
func (r *TrafficRepository) UpdateSubscriptionLink(ctx context.Context, link SubscriptionLink) (SubscriptionLink, error) {
	if r == nil || r.db == nil {
		return SubscriptionLink{}, errors.New("traffic repository not initialized")
	}

	if link.ID <= 0 {
		return SubscriptionLink{}, errors.New("subscription id is required")
	}

	link.Name = strings.TrimSpace(link.Name)
	link.Type = strings.TrimSpace(link.Type)
	link.Description = strings.TrimSpace(link.Description)
	link.RuleFilename = strings.TrimSpace(link.RuleFilename)

	if link.Name == "" {
		return SubscriptionLink{}, errors.New("subscription name is required")
	}
	if link.Type == "" {
		link.Type = link.Name
	}
	if link.RuleFilename == "" {
		return SubscriptionLink{}, errors.New("rule filename is required")
	}

	encodedButtons, err := encodeSubscriptionButtons(link.Buttons)
	if err != nil {
		return SubscriptionLink{}, fmt.Errorf("encode subscription buttons: %w", err)
	}

	res, err := r.db.ExecContext(ctx, `UPDATE subscription_links SET name = ?, type = ?, description = ?, rule_filename = ?, buttons = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, link.Name, link.Type, link.Description, link.RuleFilename, encodedButtons, link.ID)
	if err != nil {
		lowered := strings.ToLower(err.Error())
		if strings.Contains(lowered, "unique") {
			return SubscriptionLink{}, ErrSubscriptionExists
		}
		return SubscriptionLink{}, fmt.Errorf("update subscription link: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return SubscriptionLink{}, fmt.Errorf("subscription update rows affected: %w", err)
	}
	if affected == 0 {
		return SubscriptionLink{}, ErrSubscriptionNotFound
	}

	return r.GetSubscriptionByID(ctx, link.ID)
}

// 删除订阅链接定义。
func (r *TrafficRepository) DeleteSubscriptionLink(ctx context.Context, id int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}
	if id <= 0 {
		return errors.New("subscription id is required")
	}

	res, err := r.db.ExecContext(ctx, `DELETE FROM subscription_links WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete subscription link: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("subscription delete rows affected: %w", err)
	}
	if affected == 0 {
		return ErrSubscriptionNotFound
	}

	return nil
}

// 返回引用给定规则文件名的订阅数量。
func (r *TrafficRepository) CountSubscriptionsByFilename(ctx context.Context, filename string) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}

	filename = strings.TrimSpace(filename)
	if filename == "" {
		return 0, errors.New("rule filename is required")
	}

	var count int64
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM subscription_links WHERE rule_filename = ?`, filename).Scan(&count); err != nil {
		return 0, fmt.Errorf("count subscription by filename: %w", err)
	}

	return count, nil
}

func (r *TrafficRepository) ensureUserColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(users)`)
	if err != nil {
		return fmt.Errorf("users table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE users ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) ensureUserTokenColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(user_tokens)`)
	if err != nil {
		return fmt.Errorf("user_tokens table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE user_tokens ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) ensureSubscriptionLinkColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(subscription_links)`)
	if err != nil {
		return fmt.Errorf("subscription_links table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE subscription_links ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) ensureNodeColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(nodes)`)
	if err != nil {
		return fmt.Errorf("nodes table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE nodes ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) ensureUserSettingsColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(user_settings)`)
	if err != nil {
		return fmt.Errorf("user_settings table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE user_settings ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) migrateCustomRulesAppendMode() error {
	// 通过尝试插入虚拟行来检查表是否已经支持“追加”模式
	// 如果失败，我们需要重新创建表
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// 检查追加模式是否已经支持
	_, err = tx.Exec(`INSERT INTO custom_rules (name, type, mode, content) VALUES ('__test_append__', 'rules', 'append', 'test')`)
	if err == nil {
		// 支持追加模式，清理测试行
		tx.Exec(`DELETE FROM custom_rules WHERE name = '__test_append__'`)
		tx.Commit()
		return nil
	}

	// 需要迁移 - 使用新约束重新创建表
	// 1. 重命名旧表
	if _, err := tx.Exec(`ALTER TABLE custom_rules RENAME TO custom_rules_old`); err != nil {
		return fmt.Errorf("rename old table: %w", err)
	}

	// 2. 使用更新的约束创建新表
	const newTableSchema = `
CREATE TABLE custom_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('dns','rules','rule-providers')),
    mode TEXT NOT NULL CHECK (mode IN ('replace','prepend','append')),
    content TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, type)
);
CREATE INDEX IF NOT EXISTS idx_custom_rules_type ON custom_rules(type);
CREATE INDEX IF NOT EXISTS idx_custom_rules_enabled ON custom_rules(enabled);
`
	if _, err := tx.Exec(newTableSchema); err != nil {
		return fmt.Errorf("create new table: %w", err)
	}

	// 3.从旧表复制数据
	if _, err := tx.Exec(`
		INSERT INTO custom_rules (id, name, type, mode, content, enabled, created_at, updated_at)
		SELECT id, name, type, mode, content, enabled, created_at, updated_at
		FROM custom_rules_old
	`); err != nil {
		return fmt.Errorf("copy data: %w", err)
	}

	// 4. 删除旧表
	if _, err := tx.Exec(`DROP TABLE custom_rules_old`); err != nil {
		return fmt.Errorf("drop old table: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}

func (r *TrafficRepository) ensureSubscribeFileColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(subscribe_files)`)
	if err != nil {
		return fmt.Errorf("subscribe_files table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE subscribe_files ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) ensureExternalSubscriptionColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(external_subscriptions)`)
	if err != nil {
		return fmt.Errorf("external_subscriptions table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE external_subscriptions ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) ensureProxyProviderConfigColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(proxy_provider_configs)`)
	if err != nil {
		return fmt.Errorf("proxy_provider_configs table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE proxy_provider_configs ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) ensureSystemConfigColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(system_config)`)
	if err != nil {
		return fmt.Errorf("system_config table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE system_config ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) ensureRemoteServerColumn(name, definition string) error {
	rows, err := r.db.Query(`PRAGMA table_info(remote_servers)`)
	if err != nil {
		return fmt.Errorf("remote_servers table info: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			colName    string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultVal, &pk); err != nil {
			return fmt.Errorf("scan table info: %w", err)
		}
		if strings.EqualFold(colName, name) {
			return nil
		}
	}

	alter := fmt.Sprintf("ALTER TABLE remote_servers ADD COLUMN %s %s", name, definition)
	if _, err := r.db.Exec(alter); err != nil {
		return fmt.Errorf("add column %s: %w", name, err)
	}

	return nil
}

func (r *TrafficRepository) syncNicknames() error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if _, err := r.db.Exec(`UPDATE users SET nickname = username WHERE nickname IS NULL OR nickname = ''`); err != nil {
		return fmt.Errorf("sync nicknames: %w", err)
	}

	return nil
}

// 更新提供的日期的聚合流量使用情况。
func (r *TrafficRepository) RecordDaily(ctx context.Context, date time.Time, totalLimit, totalUsed, totalRemaining int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	normalized := date.UTC().Format("2006-01-02")

	const stmt = `
INSERT INTO traffic_records (date, total_limit, total_used, total_remaining)
VALUES (?, ?, ?, ?)
ON CONFLICT(date) DO UPDATE SET
    total_limit = excluded.total_limit,
    total_used = excluded.total_used,
    total_remaining = excluded.total_remaining,
    created_at = CURRENT_TIMESTAMP;
`

	if _, err := r.db.ExecContext(ctx, stmt, normalized, totalLimit, totalUsed, totalRemaining); err != nil {
		return fmt.Errorf("upsert traffic record: %w", err)
	}

	return nil
}

// 返回最多请求数量的最新流量记录，按从最新到最旧的顺序排列。
func (r *TrafficRepository) ListRecent(ctx context.Context, limit int) ([]TrafficRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	if limit <= 0 {
		limit = 30
	}

	rows, err := r.db.QueryContext(ctx, `
SELECT date, total_limit, total_used, total_remaining
FROM traffic_records
ORDER BY date DESC
LIMIT ?;
`, limit)
	if err != nil {
		return nil, fmt.Errorf("list recent traffic records: %w", err)
	}
	defer rows.Close()

	var records []TrafficRecord
	for rows.Next() {
		var (
			dateStr        string
			totalLimit     int64
			totalUsed      int64
			totalRemaining int64
		)

		if err := rows.Scan(&dateStr, &totalLimit, &totalUsed, &totalRemaining); err != nil {
			return nil, fmt.Errorf("scan traffic record: %w", err)
		}

		parsed, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			return nil, fmt.Errorf("parse traffic record date: %w", err)
		}

		records = append(records, TrafficRecord{
			Date:           parsed,
			TotalLimit:     totalLimit,
			TotalUsed:      totalUsed,
			TotalRemaining: totalRemaining,
		})
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate traffic records: %w", err)
	}

	return records, nil
}

func (r *TrafficRepository) RecordUserDaily(ctx context.Context, username string, date time.Time, totalLimit, totalUsed, totalRemaining int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}
	normalized := date.UTC().Format("2006-01-02")
	const stmt = `
INSERT INTO user_traffic_records (username, date, total_limit, total_used, total_remaining)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(username, date) DO UPDATE SET
    total_limit = excluded.total_limit,
    total_used = excluded.total_used,
    total_remaining = excluded.total_remaining,
    created_at = CURRENT_TIMESTAMP;
`
	if _, err := r.db.ExecContext(ctx, stmt, username, normalized, totalLimit, totalUsed, totalRemaining); err != nil {
		return fmt.Errorf("upsert user traffic record: %w", err)
	}
	return nil
}

func (r *TrafficRepository) ListUserRecent(ctx context.Context, username string, limit int) ([]TrafficRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}
	if limit <= 0 {
		limit = 30
	}
	rows, err := r.db.QueryContext(ctx, `
SELECT date, total_limit, total_used, total_remaining
FROM user_traffic_records
WHERE username = ?
ORDER BY date DESC
LIMIT ?;
`, username, limit)
	if err != nil {
		return nil, fmt.Errorf("list user recent traffic records: %w", err)
	}
	defer rows.Close()

	var records []TrafficRecord
	for rows.Next() {
		var (
			dateStr        string
			totalLimit     int64
			totalUsed      int64
			totalRemaining int64
		)
		if err := rows.Scan(&dateStr, &totalLimit, &totalUsed, &totalRemaining); err != nil {
			return nil, fmt.Errorf("scan user traffic record: %w", err)
		}
		parsed, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			return nil, fmt.Errorf("parse user traffic record date: %w", err)
		}
		records = append(records, TrafficRecord{
			Date:           parsed,
			TotalLimit:     totalLimit,
			TotalUsed:      totalUsed,
			TotalRemaining: totalRemaining,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user traffic records: %w", err)
	}
	return records, nil
}

// 返回给定用户名的现有令牌或创建一个新令牌。
func (r *TrafficRepository) GetOrCreateUserToken(ctx context.Context, username string) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return "", errors.New("username is required")
	}

	const selectStmt = `SELECT token FROM user_tokens WHERE username = ? LIMIT 1;`
	var token string
	if err := r.db.QueryRowContext(ctx, selectStmt, username).Scan(&token); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("query user token: %w", err)
		}

		// 使用重试逻辑生成新令牌和用户短代码
		newToken := uuid.NewString()
		const maxRetries = 10
		for i := 0; i < maxRetries; i++ {
			newUserShortCode, err := generateUserShortCode()
			if err != nil {
				return "", fmt.Errorf("generate user short code: %w", err)
			}

			const insertStmt = `INSERT INTO user_tokens (username, token, user_short_code, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP);`
			if _, err := r.db.ExecContext(ctx, insertStmt, username, newToken, newUserShortCode); err != nil {
				if strings.Contains(strings.ToLower(err.Error()), "unique") && strings.Contains(strings.ToLower(err.Error()), "user_short_code") {
					// 用户短代码冲突，重试
					continue
				}
				return "", fmt.Errorf("insert user token: %w", err)
			}
			break
		}
		token = newToken
	}

	return token, nil
}

// 为提供的用户名生成并存储一个新令牌。
func (r *TrafficRepository) ResetUserToken(ctx context.Context, username string) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return "", errors.New("username is required")
	}

	newToken := uuid.NewString()

	// 生成具有重试逻辑的新用户短代码
	const maxRetries = 10
	for i := 0; i < maxRetries; i++ {
		newUserShortCode, err := generateUserShortCode()
		if err != nil {
			return "", fmt.Errorf("generate user short code: %w", err)
		}

		const stmt = `
INSERT INTO user_tokens (username, token, user_short_code, updated_at)
VALUES (?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(username) DO UPDATE SET
    token = excluded.token,
    user_short_code = excluded.user_short_code,
    updated_at = CURRENT_TIMESTAMP;
`

		if _, err := r.db.ExecContext(ctx, stmt, username, newToken, newUserShortCode); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") && strings.Contains(strings.ToLower(err.Error()), "user_short_code") {
				// 用户短代码冲突，重试
				continue
			}
			return "", fmt.Errorf("reset user token: %w", err)
		}

		return newToken, nil
	}

	return "", errors.New("failed to generate unique user short code after retries")
}

// 返回与提供的令牌关联的用户名（如果存在）。
func (r *TrafficRepository) ValidateUserToken(ctx context.Context, token string) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}

	token = strings.TrimSpace(token)
	if token == "" {
		return "", errors.New("token is required")
	}

	const stmt = `SELECT username FROM user_tokens WHERE token = ? LIMIT 1;`
	var username string
	if err := r.db.QueryRowContext(ctx, stmt, token).Scan(&username); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrTokenNotFound
		}
		return "", fmt.Errorf("query user token by value: %w", err)
	}

	return username, nil
}

// 为文件短代码生成随机的 3 个字符的字符串。
func generateFileShortCode() (string, error) {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	const length = 3

	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate random bytes: %w", err)
	}

	for i := range bytes {
		bytes[i] = charset[int(bytes[i])%len(charset)]
	}

	return string(bytes), nil
}

// 为用户短代码生成随机的 3 个字符的字符串。
func generateUserShortCode() (string, error) {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	const length = 3

	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate random bytes: %w", err)
	}

	for i := range bytes {
		bytes[i] = charset[int(bytes[i])%len(charset)]
	}

	return string(bytes), nil
}

// 为没有文件短代码的 subscribe_files 生成文件短代码。
func (r *TrafficRepository) generateMissingFileShortCodes() error {
	rows, err := r.db.Query(`SELECT id FROM subscribe_files WHERE file_short_code = '' OR file_short_code IS NULL`)
	if err != nil {
		return fmt.Errorf("query subscribe files without file short codes: %w", err)
	}
	defer rows.Close()

	var fileIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan file ID: %w", err)
		}
		fileIDs = append(fileIDs, id)
	}

	// 为每个文件生成文件短代码
	for _, id := range fileIDs {
		const maxRetries = 10
		for i := 0; i < maxRetries; i++ {
			newShortCode, err := generateFileShortCode()
			if err != nil {
				return fmt.Errorf("generate file short code: %w", err)
			}

			_, err = r.db.Exec(`UPDATE subscribe_files SET file_short_code = ? WHERE id = ?`, newShortCode, id)
			if err != nil {
				if strings.Contains(strings.ToLower(err.Error()), "unique") {
					continue // 使用新的短代码重试
				}
				return fmt.Errorf("update file short code for file %d: %w", id, err)
			}
			break // 成功，移至下一个文件
		}
	}

	return nil
}

// 为没有的 user_tokens 生成用户短代码。
func (r *TrafficRepository) generateMissingUserShortCodes() error {
	// 获取所有不带用户短代码的user_token
	rows, err := r.db.Query(`SELECT username FROM user_tokens WHERE user_short_code = '' OR user_short_code IS NULL`)
	if err != nil {
		return fmt.Errorf("query users without user short codes: %w", err)
	}
	defer rows.Close()

	var usernames []string
	for rows.Next() {
		var username string
		if err := rows.Scan(&username); err != nil {
			return fmt.Errorf("scan username: %w", err)
		}
		usernames = append(usernames, username)
	}

	// 为每个用户生成用户短代码
	for _, username := range usernames {
		const maxRetries = 10
		for i := 0; i < maxRetries; i++ {
			newShortCode, err := generateUserShortCode()
			if err != nil {
				return fmt.Errorf("generate user short code: %w", err)
			}

			_, err = r.db.Exec(`UPDATE user_tokens SET user_short_code = ? WHERE username = ?`, newShortCode, username)
			if err != nil {
				if strings.Contains(strings.ToLower(err.Error()), "unique") {
					continue // 使用新的短代码重试
				}
				return fmt.Errorf("update user short code for user %s: %w", username, err)
			}
			break // 成功，移至下一个用户
		}
	}

	return nil
}

func generatePackageShortCode() (string, error) {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	const length = 3
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate random bytes: %w", err)
	}
	for i := range bytes {
		bytes[i] = charset[int(bytes[i])%len(charset)]
	}
	return string(bytes), nil
}

func (r *TrafficRepository) generateMissingPackageShortCodes() error {
	rows, err := r.db.Query(`SELECT id FROM packages WHERE short_code = '' OR short_code IS NULL`)
	if err != nil {
		return fmt.Errorf("query packages without short codes: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan package ID: %w", err)
		}
		ids = append(ids, id)
	}

	for _, id := range ids {
		const maxRetries = 10
		for i := 0; i < maxRetries; i++ {
			code, err := generatePackageShortCode()
			if err != nil {
				return err
			}
			_, err = r.db.Exec(`UPDATE packages SET short_code = ? WHERE id = ?`, code, id)
			if err != nil {
				if strings.Contains(strings.ToLower(err.Error()), "unique") {
					continue
				}
				return fmt.Errorf("update package short code for %d: %w", id, err)
			}
			break
		}
	}
	return nil
}

func (r *TrafficRepository) GetAllPackageShortCodes(ctx context.Context) (map[string]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}
	rows, err := r.db.QueryContext(ctx, `SELECT COALESCE(short_code, ''), id FROM packages WHERE short_code != ''`)
	if err != nil {
		return nil, fmt.Errorf("query all package short codes: %w", err)
	}
	defer rows.Close()

	codes := make(map[string]int64)
	for rows.Next() {
		var code string
		var id int64
		if err := rows.Scan(&code, &id); err != nil {
			return nil, fmt.Errorf("scan package short code: %w", err)
		}
		if code != "" {
			codes[code] = id
		}
	}
	return codes, rows.Err()
}

// ResetAllSubscriptionShortURLs 重置所有 subscribe_files 的文件短代码。
// 当用户单击设置中的“重置短链接”按钮时会调用此函数。
func (r *TrafficRepository) ResetAllSubscriptionShortURLs(ctx context.Context) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	// 获取所有 subscribe_files ID
	rows, err := r.db.QueryContext(ctx, `SELECT id FROM subscribe_files`)
	if err != nil {
		return fmt.Errorf("query subscribe_files IDs: %w", err)
	}
	defer rows.Close()

	var fileIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan file ID: %w", err)
		}
		fileIDs = append(fileIDs, id)
	}

	// 重置每个 subscribe_file 的文件短代码
	for _, id := range fileIDs {
		if err := r.resetFileShortCode(ctx, id); err != nil {
			return fmt.Errorf("reset file short code for file %d: %w", id, err)
		}
	}

	return nil
}

// 重置单个 subscribe_file 的文件短代码。
func (r *TrafficRepository) resetFileShortCode(ctx context.Context, fileID int64) error {
	const maxRetries = 10
	for i := 0; i < maxRetries; i++ {
		newShortCode, err := generateFileShortCode()
		if err != nil {
			return fmt.Errorf("generate file short code: %w", err)
		}

		const updateStmt = `UPDATE subscribe_files SET file_short_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`
		_, err = r.db.ExecContext(ctx, updateStmt, newShortCode, fileID)
		if err != nil {
			// 检查是否违反唯一约束
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				continue // 使用不同的短代码重试
			}
			return fmt.Errorf("update file short code: %w", err)
		}

		return nil
	}

	return errors.New("failed to generate unique short URL after retries")
}

// 返回与短 URL 关联的订阅文件名。
func (r *TrafficRepository) GetSubscriptionByShortURL(ctx context.Context, shortcode string) (filename string, err error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}

	shortcode = strings.TrimSpace(shortcode)
	if shortcode == "" {
		return "", errors.New("shortcode is required")
	}

	const stmt = `SELECT rule_filename FROM subscription_links WHERE short_url = ? LIMIT 1;`
	if err := r.db.QueryRowContext(ctx, stmt, shortcode).Scan(&filename); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrSubscriptionNotFound
		}
		return "", fmt.Errorf("query subscription by short URL: %w", err)
	}

	return filename, nil
}

// 返回与文件短代码关联的订阅文件名。
func (r *TrafficRepository) GetFilenameByFileShortCode(ctx context.Context, fileShortCode string) (filename string, err error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}

	fileShortCode = strings.TrimSpace(fileShortCode)
	if fileShortCode == "" {
		return "", errors.New("file short code is required")
	}

	const stmt = `SELECT filename FROM subscribe_files WHERE file_short_code = ? LIMIT 1;`
	if err := r.db.QueryRowContext(ctx, stmt, fileShortCode).Scan(&filename); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrSubscribeFileNotFound
		}
		return "", fmt.Errorf("query subscribe file by file short code: %w", err)
	}

	return filename, nil
}

// 返回与用户短代码关联的用户名。
func (r *TrafficRepository) GetUsernameByUserShortCode(ctx context.Context, userShortCode string) (username string, err error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}

	userShortCode = strings.TrimSpace(userShortCode)
	if userShortCode == "" {
		return "", errors.New("user short code is required")
	}

	const stmt = `SELECT username FROM user_tokens WHERE user_short_code = ? LIMIT 1;`
	if err := r.db.QueryRowContext(ctx, stmt, userShortCode).Scan(&username); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errors.New("user not found")
		}
		return "", fmt.Errorf("query user by user short code: %w", err)
	}

	return username, nil
}

// 返回给定用户名的用户短代码。
func (r *TrafficRepository) GetUserShortCode(ctx context.Context, username string) (userShortCode string, err error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return "", errors.New("username is required")
	}

	const stmt = `SELECT user_short_code FROM user_tokens WHERE username = ? LIMIT 1;`
	if err := r.db.QueryRowContext(ctx, stmt, username).Scan(&userShortCode); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errors.New("user short code not found")
		}
		return "", fmt.Errorf("query user short code: %w", err)
	}

	return userShortCode, nil
}

func (r *TrafficRepository) GetEffectiveUserShortCode(ctx context.Context, username string) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return "", errors.New("username is required")
	}
	var userCode, customCode string
	const stmt = `SELECT COALESCE(user_short_code, ''), COALESCE(custom_user_short_code, '') FROM user_tokens WHERE username = ? LIMIT 1;`
	if err := r.db.QueryRowContext(ctx, stmt, username).Scan(&userCode, &customCode); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errors.New("user short code not found")
		}
		return "", fmt.Errorf("query effective user short code: %w", err)
	}
	if customCode != "" {
		return customCode, nil
	}
	return userCode, nil
}

func (r *TrafficRepository) GetAllFileShortCodes(ctx context.Context) (map[string]string, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}
	rows, err := r.db.QueryContext(ctx, `SELECT COALESCE(file_short_code, ''), COALESCE(custom_short_code, ''), filename FROM subscribe_files`)
	if err != nil {
		return nil, fmt.Errorf("query all file short codes: %w", err)
	}
	defer rows.Close()

	codes := make(map[string]string)
	for rows.Next() {
		var fileCode, customCode, filename string
		if err := rows.Scan(&fileCode, &customCode, &filename); err != nil {
			return nil, fmt.Errorf("scan file short code: %w", err)
		}
		if customCode != "" {
			codes[customCode] = filename
		}
		if fileCode != "" {
			codes[fileCode] = filename
		}
	}
	return codes, rows.Err()
}

func (r *TrafficRepository) GetAllUserShortCodes(ctx context.Context) (map[string]string, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}
	rows, err := r.db.QueryContext(ctx, `SELECT COALESCE(user_short_code, ''), COALESCE(custom_user_short_code, ''), username FROM user_tokens`)
	if err != nil {
		return nil, fmt.Errorf("query all user short codes: %w", err)
	}
	defer rows.Close()

	codes := make(map[string]string)
	for rows.Next() {
		var userCode, customCode, username string
		if err := rows.Scan(&userCode, &customCode, &username); err != nil {
			return nil, fmt.Errorf("scan user short code: %w", err)
		}
		if customCode != "" {
			codes[customCode] = username
		}
		if userCode != "" {
			codes[userCode] = username
		}
	}
	return codes, rows.Err()
}

func (r *TrafficRepository) UpdateUserCustomShortCode(ctx context.Context, username, code string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}
	code = strings.TrimSpace(code)

	if _, err := r.GetOrCreateUserToken(ctx, username); err != nil {
		return fmt.Errorf("ensure user token exists: %w", err)
	}

	res, err := r.db.ExecContext(ctx, `UPDATE user_tokens SET custom_user_short_code = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, code, username)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return errors.New("该自定义连接已被使用")
		}
		return fmt.Errorf("update user custom short code: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (r *TrafficRepository) GetUserCustomShortCode(ctx context.Context, username string) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return "", errors.New("username is required")
	}
	var code string
	const stmt = `SELECT COALESCE(custom_user_short_code, '') FROM user_tokens WHERE username = ? LIMIT 1;`
	if err := r.db.QueryRowContext(ctx, stmt, username).Scan(&code); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("query user custom short code: %w", err)
	}
	return code, nil
}

func (r *TrafficRepository) GetFilenameByCustomShortCode(ctx context.Context, code string) (filename string, err error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}
	code = strings.TrimSpace(code)
	if code == "" {
		return "", ErrSubscribeFileNotFound
	}
	const stmt = `SELECT filename FROM subscribe_files WHERE custom_short_code = ? LIMIT 1;`
	if err := r.db.QueryRowContext(ctx, stmt, code).Scan(&filename); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrSubscribeFileNotFound
		}
		return "", fmt.Errorf("query subscribe file by custom short code: %w", err)
	}
	return filename, nil
}

// 保留提供的文件名的新规则版本并返回新版本号。
func (r *TrafficRepository) SaveRuleVersion(ctx context.Context, filename, content, createdBy string) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}

	filename = strings.TrimSpace(filename)
	createdBy = strings.TrimSpace(createdBy)
	if filename == "" {
		return 0, errors.New("filename is required")
	}
	if createdBy == "" {
		return 0, errors.New("createdBy is required")
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		} else {
			_ = tx.Commit()
		}
	}()

	var currentVersion sql.NullInt64
	if err = tx.QueryRowContext(ctx, `SELECT MAX(version) FROM rule_versions WHERE filename = ?`, filename).Scan(&currentVersion); err != nil {
		return 0, fmt.Errorf("query max version: %w", err)
	}

	newVersion := int64(1)
	if currentVersion.Valid {
		newVersion = currentVersion.Int64 + 1
	}

	if _, err = tx.ExecContext(ctx, `INSERT INTO rule_versions (filename, version, content, created_by) VALUES (?, ?, ?, ?)`, filename, newVersion, content, createdBy); err != nil {
		return 0, fmt.Errorf("insert rule version: %w", err)
	}

	return newVersion, nil
}

// 返回文件的最新规则版本。
func (r *TrafficRepository) ListRuleVersions(ctx context.Context, filename string, limit int) ([]RuleVersion, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	filename = strings.TrimSpace(filename)
	if filename == "" {
		return nil, errors.New("filename is required")
	}

	if limit <= 0 {
		limit = 10
	}

	rows, err := r.db.QueryContext(ctx, `SELECT version, content, created_by, created_at FROM rule_versions WHERE filename = ? ORDER BY version DESC LIMIT ?`, filename, limit)
	if err != nil {
		return nil, fmt.Errorf("query rule versions: %w", err)
	}
	defer rows.Close()

	var versions []RuleVersion
	for rows.Next() {
		var rv RuleVersion
		rv.Filename = filename
		if err := rows.Scan(&rv.Version, &rv.Content, &rv.CreatedBy, &rv.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan rule version: %w", err)
		}
		versions = append(versions, rv)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rule versions: %w", err)
	}

	return versions, nil
}

// 返回所提供规则文件的最新存储版本。
func (r *TrafficRepository) LatestRuleVersion(ctx context.Context, filename string) (RuleVersion, error) {
	versions, err := r.ListRuleVersions(ctx, filename, 1)
	if err != nil {
		return RuleVersion{}, err
	}
	if len(versions) == 0 {
		return RuleVersion{}, ErrRuleVersionNotFound
	}
	return versions[0], nil
}

// RuleVersion 表示 YAML 规则文件的存档版本。
type RuleVersion struct {
	Filename  string
	Version   int64
	Content   string
	CreatedBy string
	CreatedAt time.Time
}

// 用户代表存储在存储库中的经过身份验证的帐户。
type User struct {
	Username     string
	PasswordHash string
	Email        string
	Nickname     string
	AvatarURL    string
	Role         string
	IsActive     bool
	Remark       string
	PackageID           int64
	IsReset             bool
	ResetDay            int
	PackageEndDate      *time.Time
	SpeedLimitOverride  *float64
	DeviceLimitOverride *int
	TOTPSecret          string
	TOTPEnabled   bool
	RecoveryCodes string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// UserProfileUpdate 捕获用户的可编辑配置文件字段。
type UserProfileUpdate struct {
	Email     string
	Nickname  string
	AvatarURL string
}

// 插入或更新提供的用户。
func (r *TrafficRepository) EnsureUser(ctx context.Context, username, passwordHash string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}
	if passwordHash == "" {
		return errors.New("password hash is required")
	}

	_, err := r.db.ExecContext(ctx, `INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`, username, passwordHash, username, RoleUser)
	if err != nil {
		return fmt.Errorf("ensure user: %w", err)
	}

	return nil
}

// 使用提供的凭据插入一个全新的用户。如果用户名已存在，则返回 ErrUserExists。
func (r *TrafficRepository) CreateUser(ctx context.Context, username, email, nickname, passwordHash, role, remark string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	email = strings.TrimSpace(email)
	nickname = strings.TrimSpace(nickname)
	role = strings.TrimSpace(role)
	remark = strings.TrimSpace(remark)

	if username == "" {
		return errors.New("username is required")
	}
	if passwordHash == "" {
		return errors.New("password hash is required")
	}
	if nickname == "" {
		nickname = username
	}
	if role == "" {
		role = RoleUser
	}
	role = strings.ToLower(role)
	if role != RoleAdmin {
		role = RoleUser
	}

	_, err := r.db.ExecContext(ctx, `INSERT INTO users (username, password_hash, email, nickname, role, is_active, remark) VALUES (?, ?, ?, ?, ?, 1, ?)`, username, passwordHash, email, nickname, role, remark)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ErrUserExists
		}
		return fmt.Errorf("create user: %w", err)
	}

	return nil
}

// 通过用户名检索用户。
func (r *TrafficRepository) GetUser(ctx context.Context, username string) (User, error) {
	var user User
	if r == nil || r.db == nil {
		return user, errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return user, errors.New("username is required")
	}

	row := r.db.QueryRowContext(ctx, `SELECT username, password_hash, COALESCE(email, ''), COALESCE(nickname, ''), COALESCE(avatar_url, ''), COALESCE(role, ''), is_active, COALESCE(package_id, 0), COALESCE(is_reset, 0), COALESCE(reset_day, 1), package_end_date, COALESCE(totp_secret, ''), COALESCE(totp_enabled, 0), COALESCE(recovery_codes, '[]'), created_at, updated_at FROM users WHERE username = ? LIMIT 1`, username)
	var active, isReset, totpEnabled int
	var endDate sql.NullTime
	if err := row.Scan(&user.Username, &user.PasswordHash, &user.Email, &user.Nickname, &user.AvatarURL, &user.Role, &active, &user.PackageID, &isReset, &user.ResetDay, &endDate, &user.TOTPSecret, &totpEnabled, &user.RecoveryCodes, &user.CreatedAt, &user.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return user, ErrUserNotFound
		}
		return user, fmt.Errorf("get user: %w", err)
	}
	if user.Nickname == "" {
		user.Nickname = user.Username
	}
	if user.Role == "" {
		user.Role = RoleUser
	}
	user.IsActive = active != 0
	user.IsReset = isReset != 0
	user.TOTPEnabled = totpEnabled != 0
	if endDate.Valid {
		user.PackageEndDate = &endDate.Time
	}

	return user, nil
}

// 返回最多按创建时间排序的限制用户。
func (r *TrafficRepository) ListUsers(ctx context.Context, limit int) ([]User, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	if limit <= 0 {
		limit = 10
	}

	rows, err := r.db.QueryContext(ctx, `SELECT username, password_hash, COALESCE(email, ''), COALESCE(nickname, ''), COALESCE(avatar_url, ''), COALESCE(role, ''), is_active, COALESCE(remark, ''), COALESCE(package_id, 0), COALESCE(is_reset, 0), COALESCE(reset_day, 1), package_end_date, speed_limit_override, device_limit_override, created_at, updated_at FROM users ORDER BY created_at ASC LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var user User
		var active, isReset int
		var endDate sql.NullTime
		var speedOverride sql.NullFloat64
		var deviceOverride sql.NullInt64
		if err := rows.Scan(&user.Username, &user.PasswordHash, &user.Email, &user.Nickname, &user.AvatarURL, &user.Role, &active, &user.Remark, &user.PackageID, &isReset, &user.ResetDay, &endDate, &speedOverride, &deviceOverride, &user.CreatedAt, &user.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		if user.Nickname == "" {
			user.Nickname = user.Username
		}
		if user.Role == "" {
			user.Role = RoleUser
		}
		user.IsActive = active != 0
		user.IsReset = isReset != 0
		if endDate.Valid {
			user.PackageEndDate = &endDate.Time
		}
		if speedOverride.Valid {
			v := speedOverride.Float64
			user.SpeedLimitOverride = &v
		}
		if deviceOverride.Valid {
			v := int(deviceOverride.Int64)
			user.DeviceLimitOverride = &v
		}
		users = append(users, user)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate users: %w", err)
	}

	return users, nil
}

// 更新指定用户的备注字段。
func (r *TrafficRepository) UpdateUserRemark(ctx context.Context, username, remark string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	const stmt = `UPDATE users SET remark = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`
	_, err := r.db.ExecContext(ctx, stmt, remark, username)
	if err != nil {
		return fmt.Errorf("update user remark: %w", err)
	}
	return nil
}

// 更新指定用户存储的密码哈希值。
func (r *TrafficRepository) UpdateUserPassword(ctx context.Context, username, passwordHash string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}
	if passwordHash == "" {
		return errors.New("password hash is required")
	}

	res, err := r.db.ExecContext(ctx, `UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, passwordHash, username)
	if err != nil {
		return fmt.Errorf("update user password: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("password rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// 设置指定用户的角色。
func (r *TrafficRepository) UpdateUserRole(ctx context.Context, username, role string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	role = strings.TrimSpace(role)
	if username == "" {
		return errors.New("username is required")
	}
	if role == "" {
		role = RoleUser
	}
	role = strings.ToLower(role)
	if role != RoleAdmin {
		role = RoleUser
	}

	res, err := r.db.ExecContext(ctx, `UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, role, username)
	if err != nil {
		return fmt.Errorf("update user role: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("role rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// 更新指定用户的电子邮件。
func (r *TrafficRepository) UpdateUserEmail(ctx context.Context, username, email string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	email = strings.TrimSpace(email)
	if username == "" {
		return errors.New("username is required")
	}

	res, err := r.db.ExecContext(ctx, `UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, email, username)
	if err != nil {
		return fmt.Errorf("update user email: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("email rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// 切换用户的活动状态。
func (r *TrafficRepository) UpdateUserStatus(ctx context.Context, username string, active bool) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	value := 0
	if active {
		value = 1
	}

	res, err := r.db.ExecContext(ctx, `UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, value, username)
	if err != nil {
		return fmt.Errorf("update user status: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("status rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// 删除用户和所有相关数据（订阅、会话、节点等）
func (r *TrafficRepository) DeleteUser(ctx context.Context, username string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	// 启动事务以确保所有删除同时成功或失败
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// 删除用户的订阅绑定
	_, err = tx.ExecContext(ctx, `DELETE FROM user_subscriptions WHERE username = ?`, username)
	if err != nil {
		return fmt.Errorf("delete user subscriptions: %w", err)
	}

	// 删除用户的会话
	_, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE username = ?`, username)
	if err != nil {
		return fmt.Errorf("delete user sessions: %w", err)
	}

	// 删除用户的节点
	_, err = tx.ExecContext(ctx, `DELETE FROM nodes WHERE username = ?`, username)
	if err != nil {
		return fmt.Errorf("delete user nodes: %w", err)
	}

	// 删除用户的外部订阅
	_, err = tx.ExecContext(ctx, `DELETE FROM external_subscriptions WHERE username = ?`, username)
	if err != nil {
		return fmt.Errorf("delete user external subscriptions: %w", err)
	}

	// 删除用户设置
	_, err = tx.ExecContext(ctx, `DELETE FROM user_settings WHERE username = ?`, username)
	if err != nil {
		return fmt.Errorf("delete user settings: %w", err)
	}

	// 删除用户的令牌
	_, err = tx.ExecContext(ctx, `DELETE FROM user_tokens WHERE username = ?`, username)
	if err != nil {
		return fmt.Errorf("delete user token: %w", err)
	}

	// 最后删除用户
	res, err := tx.ExecContext(ctx, `DELETE FROM users WHERE username = ?`, username)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete user rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}

// 更新与用户帐户关联的昵称。
func (r *TrafficRepository) UpdateUserNickname(ctx context.Context, username, nickname string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	nickname = strings.TrimSpace(nickname)

	if username == "" {
		return errors.New("username is required")
	}
	if nickname == "" {
		nickname = username
	}

	res, err := r.db.ExecContext(ctx, `UPDATE users SET nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, nickname, username)
	if err != nil {
		return fmt.Errorf("update user nickname: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("nickname rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// 更新指定用户的可编辑配置文件字段。
func (r *TrafficRepository) UpdateUserProfile(ctx context.Context, username string, profile UserProfileUpdate) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	email := strings.TrimSpace(profile.Email)
	nickname := strings.TrimSpace(profile.Nickname)
	avatar := strings.TrimSpace(profile.AvatarURL)

	if nickname == "" {
		nickname = username
	}

	res, err := r.db.ExecContext(ctx, `UPDATE users SET email = ?, nickname = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, email, nickname, avatar, username)
	if err != nil {
		return fmt.Errorf("update user profile: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("profile rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// 更改用户名并更新相关表。
func (r *TrafficRepository) RenameUser(ctx context.Context, oldUsername, newUsername string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	oldUsername = strings.TrimSpace(oldUsername)
	newUsername = strings.TrimSpace(newUsername)
	if oldUsername == "" || newUsername == "" {
		return errors.New("usernames are required")
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("rename user begin tx: %w", err)
	}

	defer func() {
		if err != nil {
			_ = tx.Rollback()
		} else {
			_ = tx.Commit()
		}
	}()

	res, err := tx.ExecContext(ctx, `UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, newUsername, oldUsername)
	if err != nil {
		return fmt.Errorf("rename user: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rename user rows affected: %w", err)
	}
	if affected == 0 {
		return ErrUserNotFound
	}

	if _, err = tx.ExecContext(ctx, `UPDATE user_tokens SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, newUsername, oldUsername); err != nil {
		return fmt.Errorf("rename user tokens: %w", err)
	}

	return nil
}

// Session 表示存储在数据库中的经过身份验证的会话。
type Session struct {
	Token     string
	Username  string
	ExpiresAt time.Time
	CreatedAt time.Time
}

// 将新会话保存到数据库。
func (r *TrafficRepository) CreateSession(ctx context.Context, token, username string, expiresAt time.Time) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	token = strings.TrimSpace(token)
	username = strings.TrimSpace(username)
	if token == "" {
		return errors.New("token is required")
	}
	if username == "" {
		return errors.New("username is required")
	}

	const stmt = `INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)`
	if _, err := r.db.ExecContext(ctx, stmt, token, username, expiresAt); err != nil {
		return fmt.Errorf("create session: %w", err)
	}

	return nil
}

// 从数据库中删除会话。
func (r *TrafficRepository) DeleteSession(ctx context.Context, token string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	token = strings.TrimSpace(token)
	if token == "" {
		return errors.New("token is required")
	}

	const stmt = `DELETE FROM sessions WHERE token = ?`
	if _, err := r.db.ExecContext(ctx, stmt, token); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}

	return nil
}

// 删除特定用户的所有会话。
func (r *TrafficRepository) DeleteUserSessions(ctx context.Context, username string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	const stmt = `DELETE FROM sessions WHERE username = ?`
	if _, err := r.db.ExecContext(ctx, stmt, username); err != nil {
		return fmt.Errorf("delete user sessions: %w", err)
	}

	return nil
}

// 从数据库中检索所有未过期的会话。
func (r *TrafficRepository) LoadSessions(ctx context.Context) ([]Session, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const stmt = `SELECT token, username, expires_at, created_at FROM sessions WHERE expires_at > datetime('now') ORDER BY created_at ASC`
	rows, err := r.db.QueryContext(ctx, stmt)
	if err != nil {
		return nil, fmt.Errorf("load sessions: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var session Session
		if err := rows.Scan(&session.Token, &session.Username, &session.ExpiresAt, &session.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		sessions = append(sessions, session)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sessions: %w", err)
	}

	return sessions, nil
}

// 从数据库中删除过期的会话。
func (r *TrafficRepository) CleanupExpiredSessions(ctx context.Context) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	const stmt = `DELETE FROM sessions WHERE expires_at <= datetime('now')`
	if _, err := r.db.ExecContext(ctx, stmt); err != nil {
		return fmt.Errorf("cleanup expired sessions: %w", err)
	}

	return nil
}

// 将订阅分配给用户。
func (r *TrafficRepository) AssignSubscriptionToUser(ctx context.Context, username string, subscriptionID int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}
	if subscriptionID <= 0 {
		return errors.New("invalid subscription ID")
	}

	_, err := r.db.ExecContext(ctx, `INSERT INTO user_subscriptions (username, subscription_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, username, subscriptionID)
	if err != nil {
		return fmt.Errorf("assign subscription to user: %w", err)
	}

	return nil
}

// 删除用户的订阅分配。
func (r *TrafficRepository) RemoveSubscriptionFromUser(ctx context.Context, username string, subscriptionID int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}
	if subscriptionID <= 0 {
		return errors.New("invalid subscription ID")
	}

	_, err := r.db.ExecContext(ctx, `DELETE FROM user_subscriptions WHERE username = ? AND subscription_id = ?`, username, subscriptionID)
	if err != nil {
		return fmt.Errorf("remove subscription from user: %w", err)
	}

	return nil
}

// GetUserSubscriptionIDs 返回分配给用户的所有订阅 ID。
// 仅返回 subscribe_files 表中存在的 ID（过滤掉孤立记录）。
func (r *TrafficRepository) GetUserSubscriptionIDs(ctx context.Context, username string) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("username is required")
	}

	// 使用 subscribe_files 加入仅返回有效的订阅 ID
	const stmt = `
		SELECT us.subscription_id
		FROM user_subscriptions us
		INNER JOIN subscribe_files sf ON us.subscription_id = sf.id
		WHERE us.username = ?
		ORDER BY us.created_at ASC
	`
	rows, err := r.db.QueryContext(ctx, stmt, username)
	if err != nil {
		return nil, fmt.Errorf("get user subscription IDs: %w", err)
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan subscription ID: %w", err)
		}
		ids = append(ids, id)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscription IDs: %w", err)
	}

	return ids, nil
}

// 使用提供的列表替换用户的所有订阅。
func (r *TrafficRepository) SetUserSubscriptions(ctx context.Context, username string, subscriptionIDs []int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	// 使用事务确保原子性
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// 删除用户的所有现有订阅
	_, err = tx.ExecContext(ctx, `DELETE FROM user_subscriptions WHERE username = ?`, username)
	if err != nil {
		return fmt.Errorf("delete existing subscriptions: %w", err)
	}

	// 插入新的订阅
	if len(subscriptionIDs) > 0 {
		stmt, err := tx.PrepareContext(ctx, `INSERT INTO user_subscriptions (username, subscription_id) VALUES (?, ?)`)
		if err != nil {
			return fmt.Errorf("prepare insert statement: %w", err)
		}
		defer stmt.Close()

		for _, id := range subscriptionIDs {
			if id <= 0 {
				continue
			}
			_, err = stmt.ExecContext(ctx, username, id)
			if err != nil {
				return fmt.Errorf("insert subscription %d: %w", id, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}

// 返回分配给用户的所有订阅。
func (r *TrafficRepository) GetUserSubscriptions(ctx context.Context, username string) ([]SubscribeFile, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("username is required")
	}

	const stmt = `
		SELECT s.id, s.name, COALESCE(s.description, ''), COALESCE(s.url, ''), s.type, s.filename, COALESCE(s.file_short_code, ''), COALESCE(s.auto_sync_custom_rules, 0), s.expire_at, s.created_at, s.updated_at
		FROM subscribe_files s
		INNER JOIN user_subscriptions us ON s.id = us.subscription_id
		WHERE us.username = ?
		ORDER BY s.created_at DESC
	`
	rows, err := r.db.QueryContext(ctx, stmt, username)
	if err != nil {
		return nil, fmt.Errorf("get user subscriptions: %w", err)
	}
	defer rows.Close()

	var subscriptions []SubscribeFile
	for rows.Next() {
		var sub SubscribeFile
		var autoSync int
		var expireAt sql.NullTime
		if err := rows.Scan(&sub.ID, &sub.Name, &sub.Description, &sub.URL, &sub.Type, &sub.Filename, &sub.FileShortCode, &autoSync, &expireAt, &sub.CreatedAt, &sub.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan subscription: %w", err)
		}
		sub.AutoSyncCustomRules = autoSync != 0
		if expireAt.Valid {
			sub.ExpireAt = &expireAt.Time
		}
		subscriptions = append(subscriptions, sub)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscriptions: %w", err)
	}

	return subscriptions, nil
}

// 检索给定用户名的用户设置。
func (r *TrafficRepository) GetUserSettings(ctx context.Context, username string) (UserSettings, error) {
	var settings UserSettings
	if r == nil || r.db == nil {
		return settings, errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return settings, errors.New("username is required")
	}

	const stmt = `SELECT username, force_sync_external, COALESCE(match_rule, 'node_name'), COALESCE(sync_scope, 'saved_only'), COALESCE(keep_node_name, 1), COALESCE(cache_expire_minutes, 0), COALESCE(sync_traffic, 0), COALESCE(node_name_filter, '剩余|流量|到期|订阅|时间|重置'), COALESCE(custom_rules_enabled, 0), COALESCE(enable_short_link, 0), COALESCE(use_new_template_system, 1), COALESCE(enable_proxy_provider, 0), COALESCE(node_order, '[]'), COALESCE(debug_enabled, 0), COALESCE(debug_log_path, ''), debug_started_at, created_at, updated_at FROM user_settings WHERE username = ? LIMIT 1`
	var forceSyncInt, keepNodeNameInt, syncTrafficInt, customRulesEnabledInt, enableShortLinkInt, useNewTemplateSystemInt, enableProxyProviderInt, debugEnabledInt int
	var nodeOrderJSON string
	var debugStartedAt sql.NullTime
	err := r.db.QueryRowContext(ctx, stmt, username).Scan(&settings.Username, &forceSyncInt, &settings.MatchRule, &settings.SyncScope, &keepNodeNameInt, &settings.CacheExpireMinutes, &syncTrafficInt, &settings.NodeNameFilter, &customRulesEnabledInt, &enableShortLinkInt, &useNewTemplateSystemInt, &enableProxyProviderInt, &nodeOrderJSON, &debugEnabledInt, &settings.DebugLogPath, &debugStartedAt, &settings.CreatedAt, &settings.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return settings, ErrUserSettingsNotFound
		}
		return settings, fmt.Errorf("get user settings: %w", err)
	}

	settings.ForceSyncExternal = forceSyncInt == 1
	settings.KeepNodeName = keepNodeNameInt == 1
	settings.SyncTraffic = syncTrafficInt == 1
	settings.CustomRulesEnabled = customRulesEnabledInt == 1
	settings.EnableShortLink = enableShortLinkInt == 1
	settings.UseNewTemplateSystem = useNewTemplateSystemInt == 1
	settings.EnableProxyProvider = enableProxyProviderInt == 1
	settings.DebugEnabled = debugEnabledInt == 1

	// 解析node_order JSON
	if nodeOrderJSON != "" && nodeOrderJSON != "[]" {
		if err := json.Unmarshal([]byte(nodeOrderJSON), &settings.NodeOrder); err != nil {
			// 如果 JSON 解析失败，则使用空数组
			settings.NodeOrder = []int64{}
		}
	} else {
		settings.NodeOrder = []int64{}
	}

	// 处理可为空的 debug_started_at
	if debugStartedAt.Valid {
		settings.DebugStartedAt = &debugStartedAt.Time
	}

	return settings, nil
}

// 创建或更新用户设置。
func (r *TrafficRepository) UpsertUserSettings(ctx context.Context, settings UserSettings) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username := strings.TrimSpace(settings.Username)
	if username == "" {
		return errors.New("username is required")
	}

	forceSyncInt := 0
	if settings.ForceSyncExternal {
		forceSyncInt = 1
	}

	keepNodeNameInt := 1 // 默认为 true
	if !settings.KeepNodeName {
		keepNodeNameInt = 0
	}

	syncTrafficInt := 0
	if settings.SyncTraffic {
		syncTrafficInt = 1
	}

	customRulesEnabledInt := 0
	if settings.CustomRulesEnabled {
		customRulesEnabledInt = 1
	}

	enableShortLinkInt := 0
	if settings.EnableShortLink {
		enableShortLinkInt = 1
	}

	useNewTemplateSystemInt := 1 // 默认为 true
	if !settings.UseNewTemplateSystem {
		useNewTemplateSystemInt = 0
	}

	enableProxyProviderInt := 0
	if settings.EnableProxyProvider {
		enableProxyProviderInt = 1
	}

	debugEnabledInt := 0
	if settings.DebugEnabled {
		debugEnabledInt = 1
	}

	matchRule := strings.TrimSpace(settings.MatchRule)
	if matchRule == "" {
		matchRule = "node_name"
	}

	syncScope := strings.TrimSpace(settings.SyncScope)
	if syncScope == "" {
		syncScope = "saved_only"
	}

	cacheExpireMinutes := settings.CacheExpireMinutes
	if cacheExpireMinutes < 0 {
		cacheExpireMinutes = 0
	}

	// 将node_order序列化为JSON
	nodeOrderJSON := "[]"
	if len(settings.NodeOrder) > 0 {
		nodeOrderBytes, err := json.Marshal(settings.NodeOrder)
		if err == nil {
			nodeOrderJSON = string(nodeOrderBytes)
		}
	}

	nodeNameFilter := settings.NodeNameFilter

	const stmt = `
		INSERT INTO user_settings (username, force_sync_external, match_rule, sync_scope, keep_node_name, cache_expire_minutes, sync_traffic, node_name_filter, custom_rules_enabled, enable_short_link, use_new_template_system, enable_proxy_provider, node_order, debug_enabled, debug_log_path, debug_started_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(username) DO UPDATE SET
			force_sync_external = excluded.force_sync_external,
			match_rule = excluded.match_rule,
			sync_scope = excluded.sync_scope,
			keep_node_name = excluded.keep_node_name,
			cache_expire_minutes = excluded.cache_expire_minutes,
			sync_traffic = excluded.sync_traffic,
			node_name_filter = excluded.node_name_filter,
			custom_rules_enabled = excluded.custom_rules_enabled,
			enable_short_link = excluded.enable_short_link,
			use_new_template_system = excluded.use_new_template_system,
			enable_proxy_provider = excluded.enable_proxy_provider,
			node_order = excluded.node_order,
			debug_enabled = excluded.debug_enabled,
			debug_log_path = excluded.debug_log_path,
			debug_started_at = excluded.debug_started_at,
			updated_at = CURRENT_TIMESTAMP
	`

	if _, err := r.db.ExecContext(ctx, stmt, username, forceSyncInt, matchRule, syncScope, keepNodeNameInt, cacheExpireMinutes, syncTrafficInt, nodeNameFilter, customRulesEnabledInt, enableShortLinkInt, useNewTemplateSystemInt, enableProxyProviderInt, nodeOrderJSON, debugEnabledInt, settings.DebugLogPath, settings.DebugStartedAt); err != nil {
		return fmt.Errorf("upsert user settings: %w", err)
	}

	return nil
}

// 返回用户的所有外部订阅。
func (r *TrafficRepository) ListExternalSubscriptions(ctx context.Context, username string) ([]ExternalSubscription, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("username is required")
	}

	const stmt = `SELECT id, username, name, url, COALESCE(user_agent, 'clash-meta/2.4.0'), node_count, last_sync_at, COALESCE(upload, 0), COALESCE(download, 0), COALESCE(total, 0), expire, COALESCE(traffic_mode, 'both'), created_at, updated_at FROM external_subscriptions WHERE username = ? ORDER BY created_at DESC`
	rows, err := r.db.QueryContext(ctx, stmt, username)
	if err != nil {
		return nil, fmt.Errorf("list external subscriptions: %w", err)
	}
	defer rows.Close()

	var subs []ExternalSubscription
	for rows.Next() {
		var sub ExternalSubscription
		var lastSyncAt, expire sql.NullTime
		if err := rows.Scan(&sub.ID, &sub.Username, &sub.Name, &sub.URL, &sub.UserAgent, &sub.NodeCount, &lastSyncAt, &sub.Upload, &sub.Download, &sub.Total, &expire, &sub.TrafficMode, &sub.CreatedAt, &sub.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan external subscription: %w", err)
		}
		if lastSyncAt.Valid {
			sub.LastSyncAt = &lastSyncAt.Time
		}
		if expire.Valid {
			sub.Expire = &expire.Time
		}
		subs = append(subs, sub)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate external subscriptions: %w", err)
	}

	return subs, nil
}

// 按 ID 检索外部订阅。
func (r *TrafficRepository) GetExternalSubscription(ctx context.Context, id int64, username string) (ExternalSubscription, error) {
	var sub ExternalSubscription
	if r == nil || r.db == nil {
		return sub, errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return sub, errors.New("subscription id is required")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return sub, errors.New("username is required")
	}

	const stmt = `SELECT id, username, name, url, COALESCE(user_agent, 'clash-meta/2.4.0'), node_count, last_sync_at, COALESCE(upload, 0), COALESCE(download, 0), COALESCE(total, 0), expire, COALESCE(traffic_mode, 'both'), created_at, updated_at FROM external_subscriptions WHERE id = ? AND username = ? LIMIT 1`
	var lastSyncAt, expire sql.NullTime
	err := r.db.QueryRowContext(ctx, stmt, id, username).Scan(&sub.ID, &sub.Username, &sub.Name, &sub.URL, &sub.UserAgent, &sub.NodeCount, &lastSyncAt, &sub.Upload, &sub.Download, &sub.Total, &expire, &sub.TrafficMode, &sub.CreatedAt, &sub.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return sub, ErrExternalSubscriptionNotFound
		}
		return sub, fmt.Errorf("get external subscription: %w", err)
	}

	if lastSyncAt.Valid {
		sub.LastSyncAt = &lastSyncAt.Time
	}
	if expire.Valid {
		sub.Expire = &expire.Time
	}

	return sub, nil
}

// 创建一个新的外部订阅。
func (r *TrafficRepository) CreateExternalSubscription(ctx context.Context, sub ExternalSubscription) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}

	username := strings.TrimSpace(sub.Username)
	if username == "" {
		return 0, errors.New("username is required")
	}

	name := strings.TrimSpace(sub.Name)
	if name == "" {
		return 0, errors.New("subscription name is required")
	}

	url := strings.TrimSpace(sub.URL)
	if url == "" {
		return 0, errors.New("subscription url is required")
	}

	userAgent := strings.TrimSpace(sub.UserAgent)
	if userAgent == "" {
		userAgent = "clash-meta/2.4.0"
	}

	trafficMode := strings.TrimSpace(sub.TrafficMode)
	if trafficMode == "" {
		trafficMode = "both"
	}

	const stmt = `INSERT INTO external_subscriptions (username, name, url, user_agent, node_count, last_sync_at, upload, download, total, expire, traffic_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	result, err := r.db.ExecContext(ctx, stmt, username, name, url, userAgent, sub.NodeCount, sub.LastSyncAt, sub.Upload, sub.Download, sub.Total, sub.Expire, trafficMode)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return 0, ErrExternalSubscriptionExists
		}
		return 0, fmt.Errorf("create external subscription: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("get last insert id: %w", err)
	}

	return id, nil
}

// 更新现有的外部订阅。
func (r *TrafficRepository) UpdateExternalSubscription(ctx context.Context, sub ExternalSubscription) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if sub.ID <= 0 {
		return errors.New("subscription id is required")
	}

	username := strings.TrimSpace(sub.Username)
	if username == "" {
		return errors.New("username is required")
	}

	name := strings.TrimSpace(sub.Name)
	if name == "" {
		return errors.New("subscription name is required")
	}

	url := strings.TrimSpace(sub.URL)
	if url == "" {
		return errors.New("subscription url is required")
	}

	userAgent := strings.TrimSpace(sub.UserAgent)
	if userAgent == "" {
		userAgent = "clash-meta/2.4.0"
	}

	trafficMode := strings.TrimSpace(sub.TrafficMode)
	if trafficMode == "" {
		trafficMode = "both"
	}

	const stmt = `UPDATE external_subscriptions SET name = ?, url = ?, user_agent = ?, node_count = ?, last_sync_at = ?, upload = ?, download = ?, total = ?, expire = ?, traffic_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?`
	result, err := r.db.ExecContext(ctx, stmt, name, url, userAgent, sub.NodeCount, sub.LastSyncAt, sub.Upload, sub.Download, sub.Total, sub.Expire, trafficMode, sub.ID, username)
	if err != nil {
		return fmt.Errorf("update external subscription: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if rows == 0 {
		return ErrExternalSubscriptionNotFound
	}

	return nil
}

// 删除外部订阅。
func (r *TrafficRepository) DeleteExternalSubscription(ctx context.Context, id int64, username string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("subscription id is required")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	// 先删除关联的代理集合配置
	const deleteProvidersStmt = `DELETE FROM proxy_provider_configs WHERE external_subscription_id = ?`
	if _, err := r.db.ExecContext(ctx, deleteProvidersStmt, id); err != nil {
		return fmt.Errorf("delete related proxy provider configs: %w", err)
	}

	const stmt = `DELETE FROM external_subscriptions WHERE id = ? AND username = ?`
	result, err := r.db.ExecContext(ctx, stmt, id, username)
	if err != nil {
		return fmt.Errorf("delete external subscription: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if rows == 0 {
		return ErrExternalSubscriptionNotFound
	}

	return nil
}

// 自定义规则CRUD操作

var (
	ErrCustomRuleNotFound = errors.New("custom rule not found")
)

// 返回所有自定义规则，可以选择按类型过滤。
func (r *TrafficRepository) ListCustomRules(ctx context.Context, ruleType string) ([]CustomRule, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	var query string
	var args []interface{}

	if ruleType != "" {
		query = `SELECT id, name, type, mode, content, enabled, created_at, updated_at FROM custom_rules WHERE type = ? ORDER BY created_at DESC`
		args = append(args, ruleType)
	} else {
		query = `SELECT id, name, type, mode, content, enabled, created_at, updated_at FROM custom_rules ORDER BY created_at DESC`
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list custom rules: %w", err)
	}
	defer rows.Close()

	var rules []CustomRule
	for rows.Next() {
		var rule CustomRule
		var enabled int
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Type, &rule.Mode, &rule.Content, &enabled, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan custom rule: %w", err)
		}
		rule.Enabled = enabled != 0
		rules = append(rules, rule)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate custom rules: %w", err)
	}

	return rules, nil
}

// 按 ID 返回自定义规则。
func (r *TrafficRepository) GetCustomRule(ctx context.Context, id int64) (*CustomRule, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return nil, errors.New("custom rule id is required")
	}

	const query = `SELECT id, name, type, mode, content, enabled, created_at, updated_at FROM custom_rules WHERE id = ?`

	var rule CustomRule
	var enabled int
	err := r.db.QueryRowContext(ctx, query, id).Scan(&rule.ID, &rule.Name, &rule.Type, &rule.Mode, &rule.Content, &enabled, &rule.CreatedAt, &rule.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrCustomRuleNotFound
		}
		return nil, fmt.Errorf("get custom rule: %w", err)
	}

	rule.Enabled = enabled != 0
	return &rule, nil
}

// 创建新的自定义规则。
func (r *TrafficRepository) CreateCustomRule(ctx context.Context, rule *CustomRule) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if rule == nil {
		return errors.New("custom rule is required")
	}

	rule.Name = strings.TrimSpace(rule.Name)
	if rule.Name == "" {
		return errors.New("custom rule name is required")
	}

	rule.Type = strings.TrimSpace(rule.Type)
	if rule.Type != "dns" && rule.Type != "rules" && rule.Type != "rule-providers" {
		return errors.New("custom rule type must be 'dns', 'rules', or 'rule-providers'")
	}

	rule.Mode = strings.TrimSpace(rule.Mode)
	if rule.Type == "dns" {
		rule.Mode = "replace"
	} else if rule.Type == "rules" {
		// 规则类型支持替换、前置和附加
		if rule.Mode != "replace" && rule.Mode != "prepend" && rule.Mode != "append" {
			return errors.New("custom rule mode must be 'replace', 'prepend', or 'append' for rules type")
		}
	} else if rule.Mode != "replace" && rule.Mode != "prepend" {
		return errors.New("custom rule mode must be 'replace' or 'prepend'")
	}

	rule.Content = strings.TrimSpace(rule.Content)
	if rule.Content == "" {
		return errors.New("custom rule content is required")
	}

	const stmt = `INSERT INTO custom_rules (name, type, mode, content, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`

	enabled := 0
	if rule.Enabled {
		enabled = 1
	}

	result, err := r.db.ExecContext(ctx, stmt, rule.Name, rule.Type, rule.Mode, rule.Content, enabled)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return errors.New("custom rule with this name and type already exists")
		}
		return fmt.Errorf("create custom rule: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("get last insert id: %w", err)
	}

	rule.ID = id
	return nil
}

// 更新现有的自定义规则。
func (r *TrafficRepository) UpdateCustomRule(ctx context.Context, rule *CustomRule) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if rule == nil {
		return errors.New("custom rule is required")
	}

	if rule.ID <= 0 {
		return errors.New("custom rule id is required")
	}

	rule.Name = strings.TrimSpace(rule.Name)
	if rule.Name == "" {
		return errors.New("custom rule name is required")
	}

	rule.Type = strings.TrimSpace(rule.Type)
	if rule.Type != "dns" && rule.Type != "rules" && rule.Type != "rule-providers" {
		return errors.New("custom rule type must be 'dns', 'rules', or 'rule-providers'")
	}

	rule.Mode = strings.TrimSpace(rule.Mode)
	if rule.Type == "dns" {
		rule.Mode = "replace"
	} else if rule.Type == "rules" {
		// 规则类型支持替换、前置和附加
		if rule.Mode != "replace" && rule.Mode != "prepend" && rule.Mode != "append" {
			return errors.New("custom rule mode must be 'replace', 'prepend', or 'append' for rules type")
		}
	} else if rule.Mode != "replace" && rule.Mode != "prepend" {
		return errors.New("custom rule mode must be 'replace' or 'prepend'")
	}

	rule.Content = strings.TrimSpace(rule.Content)
	if rule.Content == "" {
		return errors.New("custom rule content is required")
	}

	const stmt = `UPDATE custom_rules SET name = ?, type = ?, mode = ?, content = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`

	enabled := 0
	if rule.Enabled {
		enabled = 1
	}

	result, err := r.db.ExecContext(ctx, stmt, rule.Name, rule.Type, rule.Mode, rule.Content, enabled, rule.ID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return errors.New("custom rule with this name and type already exists")
		}
		return fmt.Errorf("update custom rule: %w", err)
	}

	rows2, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if rows2 == 0 {
		return ErrCustomRuleNotFound
	}

	return nil
}

// 按 ID 删除自定义规则。
func (r *TrafficRepository) DeleteCustomRule(ctx context.Context, id int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("custom rule id is required")
	}

	const stmt = `DELETE FROM custom_rules WHERE id = ?`
	result, err := r.db.ExecContext(ctx, stmt, id)
	if err != nil {
		return fmt.Errorf("delete custom rule: %w", err)
	}

	rows3, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if rows3 == 0 {
		return ErrCustomRuleNotFound
	}

	return nil
}

// 返回所有启用的自定义规则，可以选择按类型过滤。
func (r *TrafficRepository) ListEnabledCustomRules(ctx context.Context, ruleType string) ([]CustomRule, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	var query string
	var args []interface{}

	if ruleType != "" {
		query = `SELECT id, name, type, mode, content, enabled, created_at, updated_at FROM custom_rules WHERE type = ? AND enabled = 1 ORDER BY created_at DESC`
		args = append(args, ruleType)
	} else {
		query = `SELECT id, name, type, mode, content, enabled, created_at, updated_at FROM custom_rules WHERE enabled = 1 ORDER BY created_at DESC`
	}

	rows4, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list enabled custom rules: %w", err)
	}
	defer rows4.Close()

	var rules []CustomRule
	for rows4.Next() {
		var rule CustomRule
		var enabled int
		if err := rows4.Scan(&rule.ID, &rule.Name, &rule.Type, &rule.Mode, &rule.Content, &enabled, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan custom rule: %w", err)
		}
		rule.Enabled = enabled != 0
		rules = append(rules, rule)
	}

	if err := rows4.Err(); err != nil {
		return nil, fmt.Errorf("iterate custom rules: %w", err)
	}

	return rules, nil
}

// 检索订阅文件的所有自定义规则应用程序。
func (r *TrafficRepository) GetCustomRuleApplications(ctx context.Context, fileID int64) ([]CustomRuleApplication, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	if fileID <= 0 {
		return nil, errors.New("subscribe file id is required")
	}

	const query = `SELECT id, subscribe_file_id, custom_rule_id, rule_type, rule_mode, applied_content, content_hash, applied_at
		FROM custom_rule_applications
		WHERE subscribe_file_id = ?
		ORDER BY applied_at DESC`

	rows, err := r.db.QueryContext(ctx, query, fileID)
	if err != nil {
		return nil, fmt.Errorf("get custom rule applications: %w", err)
	}
	defer rows.Close()

	var applications []CustomRuleApplication
	for rows.Next() {
		var app CustomRuleApplication
		if err := rows.Scan(&app.ID, &app.SubscribeFileID, &app.CustomRuleID, &app.RuleType, &app.RuleMode, &app.AppliedContent, &app.ContentHash, &app.AppliedAt); err != nil {
			return nil, fmt.Errorf("scan custom rule application: %w", err)
		}
		applications = append(applications, app)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate custom rule applications: %w", err)
	}

	return applications, nil
}

// 插入或更新自定义规则应用程序记录。
func (r *TrafficRepository) UpsertCustomRuleApplication(ctx context.Context, app *CustomRuleApplication) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if app.SubscribeFileID <= 0 {
		return errors.New("subscribe file id is required")
	}
	if app.CustomRuleID <= 0 {
		return errors.New("custom rule id is required")
	}
	if app.RuleType == "" {
		return errors.New("rule type is required")
	}

	const stmt = `INSERT INTO custom_rule_applications (subscribe_file_id, custom_rule_id, rule_type, rule_mode, applied_content, content_hash, applied_at)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(subscribe_file_id, custom_rule_id, rule_type)
		DO UPDATE SET
			rule_mode = excluded.rule_mode,
			applied_content = excluded.applied_content,
			content_hash = excluded.content_hash,
			applied_at = CURRENT_TIMESTAMP`

	_, err := r.db.ExecContext(ctx, stmt, app.SubscribeFileID, app.CustomRuleID, app.RuleType, app.RuleMode, app.AppliedContent, app.ContentHash)
	if err != nil {
		return fmt.Errorf("upsert custom rule application: %w", err)
	}

	return nil
}

// 删除自定义规则应用程序记录。
func (r *TrafficRepository) DeleteCustomRuleApplication(ctx context.Context, fileID, ruleID int64, ruleType string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if fileID <= 0 {
		return errors.New("subscribe file id is required")
	}
	if ruleID <= 0 {
		return errors.New("custom rule id is required")
	}
	if ruleType == "" {
		return errors.New("rule type is required")
	}

	const stmt = `DELETE FROM custom_rule_applications WHERE subscribe_file_id = ? AND custom_rule_id = ? AND rule_type = ?`
	_, err := r.db.ExecContext(ctx, stmt, fileID, ruleID, ruleType)
	if err != nil {
		return fmt.Errorf("delete custom rule application: %w", err)
	}

	return nil
}

// 检查是否在任何 user_settings（系统级设置）中启用了sync_traffic。
func (r *TrafficRepository) IsSyncTrafficEnabled(ctx context.Context) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("traffic repository not initialized")
	}

	const query = `SELECT COUNT(*) FROM user_settings WHERE sync_traffic = 1 LIMIT 1`
	var count int
	err := r.db.QueryRowContext(ctx, query).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check sync traffic setting: %w", err)
	}

	return count > 0, nil
}

// 返回所有用户的所有外部订阅。
func (r *TrafficRepository) ListAllExternalSubscriptions(ctx context.Context) ([]ExternalSubscription, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const stmt = `SELECT id, username, name, url, COALESCE(user_agent, 'clash-meta/2.4.0'), node_count, last_sync_at, COALESCE(upload, 0), COALESCE(download, 0), COALESCE(total, 0), expire, COALESCE(traffic_mode, 'both'), created_at, updated_at FROM external_subscriptions ORDER BY created_at DESC`
	rows, err := r.db.QueryContext(ctx, stmt)
	if err != nil {
		return nil, fmt.Errorf("list all external subscriptions: %w", err)
	}
	defer rows.Close()

	var subs []ExternalSubscription
	for rows.Next() {
		var sub ExternalSubscription
		var lastSyncAt sql.NullTime
		var expire sql.NullTime
		if err := rows.Scan(&sub.ID, &sub.Username, &sub.Name, &sub.URL, &sub.UserAgent, &sub.NodeCount, &lastSyncAt, &sub.Upload, &sub.Download, &sub.Total, &expire, &sub.TrafficMode, &sub.CreatedAt, &sub.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan external subscription: %w", err)
		}
		if lastSyncAt.Valid {
			sub.LastSyncAt = &lastSyncAt.Time
		}
		if expire.Valid {
			sub.Expire = &expire.Time
		}
		subs = append(subs, sub)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate external subscriptions: %w", err)
	}

	return subs, nil
}

// 返回所有启用了自动同步的订阅文件。
func (r *TrafficRepository) GetSubscribeFilesWithAutoSync(ctx context.Context) ([]SubscribeFile, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const query = `SELECT id, name, COALESCE(description, ''), url, type, filename, COALESCE(file_short_code, ''), auto_sync_custom_rules, expire_at, created_at, updated_at
		FROM subscribe_files
		WHERE auto_sync_custom_rules = 1
		ORDER BY created_at DESC`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("get subscribe files with auto sync: %w", err)
	}
	defer rows.Close()

	var files []SubscribeFile
	for rows.Next() {
		var file SubscribeFile
		var autoSync int
		var expireAt sql.NullTime
		if err := rows.Scan(&file.ID, &file.Name, &file.Description, &file.URL, &file.Type, &file.Filename, &file.FileShortCode, &autoSync, &expireAt, &file.CreatedAt, &file.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan subscribe file: %w", err)
		}
		file.AutoSyncCustomRules = autoSync != 0
		if expireAt.Valid {
			file.ExpireAt = &expireAt.Time
		}
		files = append(files, file)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscribe files: %w", err)
	}

	return files, nil
}

// 创建一个新的代理提供程序配置
func (r *TrafficRepository) CreateProxyProviderConfig(ctx context.Context, config *ProxyProviderConfig) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}

	healthCheckEnabled := 0
	if config.HealthCheckEnabled {
		healthCheckEnabled = 1
	}
	healthCheckLazy := 0
	if config.HealthCheckLazy {
		healthCheckLazy = 1
	}

	result, err := r.db.ExecContext(ctx, `
		INSERT INTO proxy_provider_configs (
			username, external_subscription_id, name, type, interval, proxy, size_limit, header,
			health_check_enabled, health_check_url, health_check_interval, health_check_timeout,
			health_check_lazy, health_check_expected_status,
			filter, exclude_filter, exclude_type, geo_ip_filter, override, process_mode
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		config.Username, config.ExternalSubscriptionID, config.Name, config.Type,
		config.Interval, config.Proxy, config.SizeLimit, config.Header,
		healthCheckEnabled, config.HealthCheckURL, config.HealthCheckInterval, config.HealthCheckTimeout,
		healthCheckLazy, config.HealthCheckExpectedStatus,
		config.Filter, config.ExcludeFilter, config.ExcludeType, config.GeoIPFilter, config.Override, config.ProcessMode,
	)
	if err != nil {
		return 0, fmt.Errorf("create proxy provider config: %w", err)
	}

	return result.LastInsertId()
}

// 通过 ID 检索代理提供程序配置
func (r *TrafficRepository) GetProxyProviderConfig(ctx context.Context, id int64) (*ProxyProviderConfig, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	row := r.db.QueryRowContext(ctx, `
		SELECT id, username, external_subscription_id, name, type, interval, proxy, size_limit,
			COALESCE(header, ''), health_check_enabled, health_check_url, health_check_interval,
			health_check_timeout, health_check_lazy, health_check_expected_status,
			COALESCE(filter, ''), COALESCE(exclude_filter, ''), COALESCE(exclude_type, ''),
			COALESCE(geo_ip_filter, ''), COALESCE(override, ''), process_mode, created_at, updated_at
		FROM proxy_provider_configs WHERE id = ?
	`, id)

	var config ProxyProviderConfig
	var healthCheckEnabled, healthCheckLazy int
	err := row.Scan(
		&config.ID, &config.Username, &config.ExternalSubscriptionID, &config.Name, &config.Type,
		&config.Interval, &config.Proxy, &config.SizeLimit, &config.Header,
		&healthCheckEnabled, &config.HealthCheckURL, &config.HealthCheckInterval,
		&config.HealthCheckTimeout, &healthCheckLazy, &config.HealthCheckExpectedStatus,
		&config.Filter, &config.ExcludeFilter, &config.ExcludeType,
		&config.GeoIPFilter, &config.Override, &config.ProcessMode, &config.CreatedAt, &config.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get proxy provider config: %w", err)
	}

	config.HealthCheckEnabled = healthCheckEnabled != 0
	config.HealthCheckLazy = healthCheckLazy != 0

	return &config, nil
}

// 按名称检索代理提供程序配置
func (r *TrafficRepository) GetProxyProviderConfigByName(ctx context.Context, name string) (*ProxyProviderConfig, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	row := r.db.QueryRowContext(ctx, `
		SELECT id, username, external_subscription_id, name, type, interval, proxy, size_limit,
			COALESCE(header, ''), health_check_enabled, health_check_url, health_check_interval,
			health_check_timeout, health_check_lazy, health_check_expected_status,
			COALESCE(filter, ''), COALESCE(exclude_filter, ''), COALESCE(exclude_type, ''),
			COALESCE(geo_ip_filter, ''), COALESCE(override, ''), process_mode, created_at, updated_at
		FROM proxy_provider_configs WHERE name = ?
	`, name)

	var config ProxyProviderConfig
	var healthCheckEnabled, healthCheckLazy int
	err := row.Scan(
		&config.ID, &config.Username, &config.ExternalSubscriptionID, &config.Name, &config.Type,
		&config.Interval, &config.Proxy, &config.SizeLimit, &config.Header,
		&healthCheckEnabled, &config.HealthCheckURL, &config.HealthCheckInterval,
		&config.HealthCheckTimeout, &healthCheckLazy, &config.HealthCheckExpectedStatus,
		&config.Filter, &config.ExcludeFilter, &config.ExcludeType,
		&config.GeoIPFilter, &config.Override, &config.ProcessMode, &config.CreatedAt, &config.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get proxy provider config by name: %w", err)
	}

	config.HealthCheckEnabled = healthCheckEnabled != 0
	config.HealthCheckLazy = healthCheckLazy != 0

	return &config, nil
}

// 返回用户的所有代理提供程序配置
func (r *TrafficRepository) ListProxyProviderConfigs(ctx context.Context, username string) ([]ProxyProviderConfig, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, username, external_subscription_id, name, type, interval, proxy, size_limit,
			COALESCE(header, ''), health_check_enabled, health_check_url, health_check_interval,
			health_check_timeout, health_check_lazy, health_check_expected_status,
			COALESCE(filter, ''), COALESCE(exclude_filter, ''), COALESCE(exclude_type, ''),
			COALESCE(geo_ip_filter, ''), COALESCE(override, ''), process_mode, created_at, updated_at
		FROM proxy_provider_configs WHERE username = ? ORDER BY id ASC
	`, username)
	if err != nil {
		return nil, fmt.Errorf("list proxy provider configs: %w", err)
	}
	defer rows.Close()

	var configs []ProxyProviderConfig
	for rows.Next() {
		var config ProxyProviderConfig
		var healthCheckEnabled, healthCheckLazy int
		err := rows.Scan(
			&config.ID, &config.Username, &config.ExternalSubscriptionID, &config.Name, &config.Type,
			&config.Interval, &config.Proxy, &config.SizeLimit, &config.Header,
			&healthCheckEnabled, &config.HealthCheckURL, &config.HealthCheckInterval,
			&config.HealthCheckTimeout, &healthCheckLazy, &config.HealthCheckExpectedStatus,
			&config.Filter, &config.ExcludeFilter, &config.ExcludeType,
			&config.GeoIPFilter, &config.Override, &config.ProcessMode, &config.CreatedAt, &config.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan proxy provider config: %w", err)
		}
		config.HealthCheckEnabled = healthCheckEnabled != 0
		config.HealthCheckLazy = healthCheckLazy != 0
		configs = append(configs, config)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate proxy provider configs: %w", err)
	}

	return configs, nil
}

// 返回外部订阅的所有代理提供程序配置
func (r *TrafficRepository) ListProxyProviderConfigsBySubscription(ctx context.Context, externalSubscriptionID int64) ([]ProxyProviderConfig, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, username, external_subscription_id, name, type, interval, proxy, size_limit,
			COALESCE(header, ''), health_check_enabled, health_check_url, health_check_interval,
			health_check_timeout, health_check_lazy, health_check_expected_status,
			COALESCE(filter, ''), COALESCE(exclude_filter, ''), COALESCE(exclude_type, ''),
			COALESCE(geo_ip_filter, ''), COALESCE(override, ''), process_mode, created_at, updated_at
		FROM proxy_provider_configs WHERE external_subscription_id = ? ORDER BY id ASC
	`, externalSubscriptionID)
	if err != nil {
		return nil, fmt.Errorf("list proxy provider configs by subscription: %w", err)
	}
	defer rows.Close()

	var configs []ProxyProviderConfig
	for rows.Next() {
		var config ProxyProviderConfig
		var healthCheckEnabled, healthCheckLazy int
		err := rows.Scan(
			&config.ID, &config.Username, &config.ExternalSubscriptionID, &config.Name, &config.Type,
			&config.Interval, &config.Proxy, &config.SizeLimit, &config.Header,
			&healthCheckEnabled, &config.HealthCheckURL, &config.HealthCheckInterval,
			&config.HealthCheckTimeout, &healthCheckLazy, &config.HealthCheckExpectedStatus,
			&config.Filter, &config.ExcludeFilter, &config.ExcludeType,
			&config.GeoIPFilter, &config.Override, &config.ProcessMode, &config.CreatedAt, &config.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan proxy provider config: %w", err)
		}
		config.HealthCheckEnabled = healthCheckEnabled != 0
		config.HealthCheckLazy = healthCheckLazy != 0
		configs = append(configs, config)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate proxy provider configs: %w", err)
	}

	return configs, nil
}

// ListMMWProxyProviderConfigs 返回所有妙妙屋模式的代理集合配置
// 该方法用于定时同步器获取需要自动刷新的代理集合列表
func (r *TrafficRepository) ListMMWProxyProviderConfigs(ctx context.Context) ([]ProxyProviderConfig, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, username, external_subscription_id, name, type, interval, proxy, size_limit,
			COALESCE(header, ''), health_check_enabled, health_check_url, health_check_interval,
			health_check_timeout, health_check_lazy, health_check_expected_status,
			COALESCE(filter, ''), COALESCE(exclude_filter, ''), COALESCE(exclude_type, ''),
			COALESCE(geo_ip_filter, ''), COALESCE(override, ''), process_mode, created_at, updated_at
		FROM proxy_provider_configs
		WHERE process_mode = 'mmw'
		ORDER BY id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list mmw proxy provider configs: %w", err)
	}
	defer rows.Close()

	var configs []ProxyProviderConfig
	for rows.Next() {
		var config ProxyProviderConfig
		var healthCheckEnabled, healthCheckLazy int
		err := rows.Scan(
			&config.ID, &config.Username, &config.ExternalSubscriptionID, &config.Name, &config.Type,
			&config.Interval, &config.Proxy, &config.SizeLimit, &config.Header,
			&healthCheckEnabled, &config.HealthCheckURL, &config.HealthCheckInterval,
			&config.HealthCheckTimeout, &healthCheckLazy, &config.HealthCheckExpectedStatus,
			&config.Filter, &config.ExcludeFilter, &config.ExcludeType,
			&config.GeoIPFilter, &config.Override, &config.ProcessMode, &config.CreatedAt, &config.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan mmw proxy provider config: %w", err)
		}
		config.HealthCheckEnabled = healthCheckEnabled != 0
		config.HealthCheckLazy = healthCheckLazy != 0
		configs = append(configs, config)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate mmw proxy provider configs: %w", err)
	}

	return configs, nil
}

// 更新现有的代理提供程序配置
func (r *TrafficRepository) UpdateProxyProviderConfig(ctx context.Context, config *ProxyProviderConfig) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	healthCheckEnabled := 0
	if config.HealthCheckEnabled {
		healthCheckEnabled = 1
	}
	healthCheckLazy := 0
	if config.HealthCheckLazy {
		healthCheckLazy = 1
	}

	result, err := r.db.ExecContext(ctx, `
		UPDATE proxy_provider_configs SET
			name = ?, type = ?, interval = ?, proxy = ?, size_limit = ?, header = ?,
			health_check_enabled = ?, health_check_url = ?, health_check_interval = ?,
			health_check_timeout = ?, health_check_lazy = ?, health_check_expected_status = ?,
			filter = ?, exclude_filter = ?, exclude_type = ?, geo_ip_filter = ?, override = ?, process_mode = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND username = ?
	`,
		config.Name, config.Type, config.Interval, config.Proxy, config.SizeLimit, config.Header,
		healthCheckEnabled, config.HealthCheckURL, config.HealthCheckInterval,
		config.HealthCheckTimeout, healthCheckLazy, config.HealthCheckExpectedStatus,
		config.Filter, config.ExcludeFilter, config.ExcludeType, config.GeoIPFilter, config.Override, config.ProcessMode,
		config.ID, config.Username,
	)
	if err != nil {
		return fmt.Errorf("update proxy provider config: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return errors.New("proxy provider config not found or not owned by user")
	}

	return nil
}

// 删除代理提供程序配置
func (r *TrafficRepository) DeleteProxyProviderConfig(ctx context.Context, id int64, username string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	result, err := r.db.ExecContext(ctx, `DELETE FROM proxy_provider_configs WHERE id = ? AND username = ?`, id, username)
	if err != nil {
		return fmt.Errorf("delete proxy provider config: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return errors.New("proxy provider config not found or not owned by user")
	}

	return nil
}

// GetSystemConfig 检索全局系统配置。
// 如果该行不存在，则返回空的 SystemConfig（迁移后不应发生）。
func (r *TrafficRepository) GetSystemConfig(ctx context.Context) (SystemConfig, error) {
	const query = `
SELECT proxy_groups_source_url, client_compatibility_mode, COALESCE(enable_short_link, 1),
       COALESCE(speed_collect_interval, 3), COALESCE(traffic_collect_interval, 60),
       COALESCE(traffic_check_interval, 120), COALESCE(heartbeat_interval, 30),
       COALESCE(agent_log_enabled, 0),
       COALESCE(notify_enabled, 0), COALESCE(telegram_bot_token, ''), COALESCE(telegram_chat_id, ''),
       COALESCE(notify_login, 0), COALESCE(notify_subscribe_fetch, 0), COALESCE(notify_daily_traffic, 0),
       COALESCE(notify_server_offline, 0), COALESCE(notify_server_online, 0), COALESCE(notify_traffic_threshold, 0),
       COALESCE(notify_daily_traffic_time, '08:00'), COALESCE(notify_traffic_threshold_percent, 80),
       COALESCE(enable_override_scripts, 0),
       COALESCE(silent_mode, 0), COALESCE(silent_mode_timeout, 15)
FROM system_config
WHERE id = 1
`

	var cfg SystemConfig
	var compatibilityMode, enableShortLink, agentLogEnabled int
	var notifyEnabled, notifyLogin, notifySubFetch, notifyDailyTraffic int
	var notifyServerOffline, notifyServerOnline, notifyTrafficThreshold int
	var enableOverrideScripts, silentMode, silentModeTimeout int
	err := r.db.QueryRowContext(ctx, query).Scan(
		&cfg.ProxyGroupsSourceURL, &compatibilityMode, &enableShortLink,
		&cfg.SpeedCollectInterval, &cfg.TrafficCollectInterval,
		&cfg.TrafficCheckInterval, &cfg.HeartbeatInterval,
		&agentLogEnabled,
		&notifyEnabled, &cfg.TelegramBotToken, &cfg.TelegramChatID,
		&notifyLogin, &notifySubFetch, &notifyDailyTraffic,
		&notifyServerOffline, &notifyServerOnline, &notifyTrafficThreshold,
		&cfg.NotifyDailyTrafficTime, &cfg.NotifyTrafficThresholdPercent,
		&enableOverrideScripts,
		&silentMode, &silentModeTimeout,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return SystemConfig{EnableShortLink: true, SpeedCollectInterval: 3, TrafficCollectInterval: 60, TrafficCheckInterval: 120, HeartbeatInterval: 30, NotifyDailyTrafficTime: "08:00", NotifyTrafficThresholdPercent: 80, SilentModeTimeout: 15}, nil
		}
		return SystemConfig{}, fmt.Errorf("query system config: %w", err)
	}

	cfg.ClientCompatibilityMode = compatibilityMode != 0
	cfg.EnableShortLink = enableShortLink != 0
	cfg.AgentLogEnabled = agentLogEnabled != 0
	cfg.NotifyEnabled = notifyEnabled != 0
	cfg.NotifyLogin = notifyLogin != 0
	cfg.NotifySubscribeFetch = notifySubFetch != 0
	cfg.NotifyDailyTraffic = notifyDailyTraffic != 0
	cfg.NotifyServerOffline = notifyServerOffline != 0
	cfg.NotifyServerOnline = notifyServerOnline != 0
	cfg.NotifyTrafficThreshold = notifyTrafficThreshold != 0
	cfg.EnableOverrideScripts = enableOverrideScripts != 0
	cfg.SilentMode = silentMode != 0
	cfg.SilentModeTimeout = silentModeTimeout
	if cfg.SilentModeTimeout <= 0 {
		cfg.SilentModeTimeout = 15
	}
	return cfg, nil
}

// UpdateSystemConfig 更新全局系统配置。
// 如果单例行不存在则创建它（防御性）。
func (r *TrafficRepository) UpdateSystemConfig(ctx context.Context, cfg SystemConfig) error {
	const updateStmt = `
UPDATE system_config
SET proxy_groups_source_url = ?,
    client_compatibility_mode = ?,
    enable_short_link = ?,
    speed_collect_interval = ?,
    traffic_collect_interval = ?,
    traffic_check_interval = ?,
    heartbeat_interval = ?,
    agent_log_enabled = ?,
    notify_enabled = ?,
    telegram_bot_token = ?,
    telegram_chat_id = ?,
    notify_login = ?,
    notify_subscribe_fetch = ?,
    notify_daily_traffic = ?,
    notify_server_offline = ?,
    notify_server_online = ?,
    notify_traffic_threshold = ?,
    notify_daily_traffic_time = ?,
    notify_traffic_threshold_percent = ?,
    enable_override_scripts = ?,
    silent_mode = ?,
    silent_mode_timeout = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1
`

	compatibilityMode := 0
	if cfg.ClientCompatibilityMode {
		compatibilityMode = 1
	}
	enableShortLink := 0
	if cfg.EnableShortLink {
		enableShortLink = 1
	}
	agentLogEnabled := 0
	if cfg.AgentLogEnabled {
		agentLogEnabled = 1
	}

	boolToInt := func(b bool) int {
		if b {
			return 1
		}
		return 0
	}

	silentModeTimeout := cfg.SilentModeTimeout
	if silentModeTimeout <= 0 {
		silentModeTimeout = 15
	}

	result, err := r.db.ExecContext(ctx, updateStmt, cfg.ProxyGroupsSourceURL, compatibilityMode, enableShortLink,
		cfg.SpeedCollectInterval, cfg.TrafficCollectInterval, cfg.TrafficCheckInterval, cfg.HeartbeatInterval,
		agentLogEnabled,
		boolToInt(cfg.NotifyEnabled), cfg.TelegramBotToken, cfg.TelegramChatID,
		boolToInt(cfg.NotifyLogin), boolToInt(cfg.NotifySubscribeFetch), boolToInt(cfg.NotifyDailyTraffic),
		boolToInt(cfg.NotifyServerOffline), boolToInt(cfg.NotifyServerOnline), boolToInt(cfg.NotifyTrafficThreshold),
		cfg.NotifyDailyTrafficTime, cfg.NotifyTrafficThresholdPercent,
		boolToInt(cfg.EnableOverrideScripts),
		boolToInt(cfg.SilentMode), silentModeTimeout)
	if err != nil {
		return fmt.Errorf("update system config: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		const insertStmt = `
INSERT INTO system_config (id, proxy_groups_source_url, client_compatibility_mode, enable_short_link,
    speed_collect_interval, traffic_collect_interval, traffic_check_interval, heartbeat_interval, agent_log_enabled,
    notify_enabled, telegram_bot_token, telegram_chat_id, notify_login, notify_subscribe_fetch,
    notify_daily_traffic, notify_server_offline, notify_server_online, notify_traffic_threshold,
    notify_daily_traffic_time, notify_traffic_threshold_percent, enable_override_scripts,
    silent_mode, silent_mode_timeout)
VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
		if _, err := r.db.ExecContext(ctx, insertStmt, cfg.ProxyGroupsSourceURL, compatibilityMode, enableShortLink,
			cfg.SpeedCollectInterval, cfg.TrafficCollectInterval, cfg.TrafficCheckInterval, cfg.HeartbeatInterval, agentLogEnabled,
			boolToInt(cfg.NotifyEnabled), cfg.TelegramBotToken, cfg.TelegramChatID,
			boolToInt(cfg.NotifyLogin), boolToInt(cfg.NotifySubscribeFetch), boolToInt(cfg.NotifyDailyTraffic),
			boolToInt(cfg.NotifyServerOffline), boolToInt(cfg.NotifyServerOnline), boolToInt(cfg.NotifyTrafficThreshold),
			cfg.NotifyDailyTrafficTime, cfg.NotifyTrafficThresholdPercent,
			boolToInt(cfg.EnableOverrideScripts),
			boolToInt(cfg.SilentMode), silentModeTimeout); err != nil {
			return fmt.Errorf("insert system config: %w", err)
		}
	}

	return nil
}

// Xray 服务器 CRUD 操作

// 返回所有 Xray 服务器。
func (r *TrafficRepository) ListXrayServers(ctx context.Context) ([]XrayServer, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const query = `SELECT id, name, host, port, COALESCE(description, ''), COALESCE(is_primary, 0), process_id, COALESCE(config_path, ''), COALESCE(traffic_limit, 0), COALESCE(traffic_reset_day, 0), COALESCE(traffic_used_offset, 0), created_at, updated_at FROM xray_servers ORDER BY is_primary DESC, created_at DESC`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list xray servers: %w", err)
	}
	defer rows.Close()

	var servers []XrayServer
	for rows.Next() {
		var server XrayServer
		var isPrimary int
		if err := rows.Scan(&server.ID, &server.Name, &server.Host, &server.Port, &server.Description, &isPrimary, &server.ProcessID, &server.ConfigPath, &server.TrafficLimit, &server.TrafficResetDay, &server.TrafficUsedOffset, &server.CreatedAt, &server.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan xray server: %w", err)
		}
		server.IsPrimary = isPrimary != 0
		servers = append(servers, server)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate xray servers: %w", err)
	}

	// 从node_traffic表+偏移量计算每个服务器使用的流量
	for i := range servers {
		aggregated, err := r.GetServerTrafficUsed(ctx, servers[i].ID)
		if err == nil {
			servers[i].TrafficUsed = aggregated + servers[i].TrafficUsedOffset
		}
	}

	return servers, nil
}

// 从node_traffic 表中计算服务器使用的总流量。
func (r *TrafficRepository) GetServerTrafficUsed(ctx context.Context, serverID int64) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}

	// 总结该服务器的nod​​e_traffic的所有上行链路+下行链路
	const query = `SELECT COALESCE(SUM(uplink + downlink), 0) FROM node_traffic WHERE server_id = ?`
	var total int64
	err := r.db.QueryRowContext(ctx, query, serverID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("get server traffic used: %w", err)
	}
	return total, nil
}

// 批量入站 CRUD 操作

// 创建新的批次入站记录。
func (r *TrafficRepository) CreateBatchInbound(ctx context.Context, batch *BatchInbound) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if batch == nil {
		return errors.New("batch inbound is required")
	}

	batch.BatchID = strings.TrimSpace(batch.BatchID)
	if batch.BatchID == "" {
		return errors.New("batch id is required")
	}

	batch.Tag = strings.TrimSpace(batch.Tag)
	if batch.Tag == "" {
		return errors.New("tag is required")
	}

	if batch.ServerID <= 0 {
		return errors.New("server id is required")
	}

	const stmt = `INSERT INTO batch_inbounds (batch_id, tag, server_id, protocol, port, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`

	result, err := r.db.ExecContext(ctx, stmt, batch.BatchID, batch.Tag, batch.ServerID, batch.Protocol, batch.Port)
	if err != nil {
		return fmt.Errorf("create batch inbound: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("get last insert id: %w", err)
	}

	batch.ID = id
	return nil
}

// 返回具有给定批次 ID 的所有批次入站。
func (r *TrafficRepository) GetBatchInboundsByBatchID(ctx context.Context, batchID string) ([]BatchInbound, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	batchID = strings.TrimSpace(batchID)
	if batchID == "" {
		return nil, errors.New("batch id is required")
	}

	const query = `SELECT id, batch_id, tag, server_id, protocol, port, created_at FROM batch_inbounds WHERE batch_id = ?`
	rows, err := r.db.QueryContext(ctx, query, batchID)
	if err != nil {
		return nil, fmt.Errorf("get batch inbounds by batch id: %w", err)
	}
	defer rows.Close()

	var batches []BatchInbound
	for rows.Next() {
		var batch BatchInbound
		if err := rows.Scan(&batch.ID, &batch.BatchID, &batch.Tag, &batch.ServerID, &batch.Protocol, &batch.Port, &batch.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan batch inbound: %w", err)
		}
		batches = append(batches, batch)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate batch inbounds: %w", err)
	}

	return batches, nil
}

// 返回具有给定标签的所有批次入站。
func (r *TrafficRepository) GetBatchInboundsByTag(ctx context.Context, tag string) ([]BatchInbound, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	tag = strings.TrimSpace(tag)
	if tag == "" {
		return nil, errors.New("tag is required")
	}

	const query = `SELECT id, batch_id, tag, server_id, protocol, port, created_at FROM batch_inbounds WHERE tag = ?`
	rows, err := r.db.QueryContext(ctx, query, tag)
	if err != nil {
		return nil, fmt.Errorf("get batch inbounds by tag: %w", err)
	}
	defer rows.Close()

	var batches []BatchInbound
	for rows.Next() {
		var batch BatchInbound
		if err := rows.Scan(&batch.ID, &batch.BatchID, &batch.Tag, &batch.ServerID, &batch.Protocol, &batch.Port, &batch.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan batch inbound: %w", err)
		}
		batches = append(batches, batch)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate batch inbounds: %w", err)
	}

	return batches, nil
}

// 删除具有给定批次 ID 的所有批次入站。
func (r *TrafficRepository) DeleteBatchInboundsByBatchID(ctx context.Context, batchID string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	batchID = strings.TrimSpace(batchID)
	if batchID == "" {
		return errors.New("batch id is required")
	}

	const stmt = `DELETE FROM batch_inbounds WHERE batch_id = ?`
	_, err := r.db.ExecContext(ctx, stmt, batchID)
	if err != nil {
		return fmt.Errorf("delete batch inbounds by batch id: %w", err)
	}

	return nil
}

// 删除具有给定标签的所有批次入站。
func (r *TrafficRepository) DeleteBatchInboundsByTag(ctx context.Context, tag string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	tag = strings.TrimSpace(tag)
	if tag == "" {
		return errors.New("tag is required")
	}

	const stmt = `DELETE FROM batch_inbounds WHERE tag = ?`
	_, err := r.db.ExecContext(ctx, stmt, tag)
	if err != nil {
		return fmt.Errorf("delete batch inbounds by tag: %w", err)
	}

	return nil
}

// 批量出站 CRUD 操作

// CreateBatchOutb​​ound 创建新的批量出站记录。
func (r *TrafficRepository) CreateBatchOutbound(ctx context.Context, batch *BatchOutbound) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if batch == nil {
		return errors.New("batch outbound is required")
	}

	batch.BatchID = strings.TrimSpace(batch.BatchID)
	if batch.BatchID == "" {
		return errors.New("batch id is required")
	}

	batch.Tag = strings.TrimSpace(batch.Tag)
	if batch.Tag == "" {
		return errors.New("tag is required")
	}

	if batch.ServerID <= 0 {
		return errors.New("server id is required")
	}

	const stmt = `INSERT INTO batch_outbounds (batch_id, tag, server_id, protocol, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`

	result, err := r.db.ExecContext(ctx, stmt, batch.BatchID, batch.Tag, batch.ServerID, batch.Protocol)
	if err != nil {
		return fmt.Errorf("create batch outbound: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("get last insert id: %w", err)
	}

	batch.ID = id
	return nil
}

// GetBatchOutb​​oundsByBatchID 返回具有给定批次 ID 的所有批次出站。
func (r *TrafficRepository) GetBatchOutboundsByBatchID(ctx context.Context, batchID string) ([]BatchOutbound, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	batchID = strings.TrimSpace(batchID)
	if batchID == "" {
		return nil, errors.New("batch id is required")
	}

	const query = `SELECT id, batch_id, tag, server_id, protocol, created_at FROM batch_outbounds WHERE batch_id = ?`
	rows, err := r.db.QueryContext(ctx, query, batchID)
	if err != nil {
		return nil, fmt.Errorf("get batch outbounds by batch id: %w", err)
	}
	defer rows.Close()

	var batches []BatchOutbound
	for rows.Next() {
		var batch BatchOutbound
		if err := rows.Scan(&batch.ID, &batch.BatchID, &batch.Tag, &batch.ServerID, &batch.Protocol, &batch.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan batch outbound: %w", err)
		}
		batches = append(batches, batch)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate batch outbounds: %w", err)
	}

	return batches, nil
}

// GetBatchOutb​​oundsByTag 返回具有给定标签的所有批次出站。
func (r *TrafficRepository) GetBatchOutboundsByTag(ctx context.Context, tag string) ([]BatchOutbound, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	tag = strings.TrimSpace(tag)
	if tag == "" {
		return nil, errors.New("tag is required")
	}

	const query = `SELECT id, batch_id, tag, server_id, protocol, created_at FROM batch_outbounds WHERE tag = ?`
	rows, err := r.db.QueryContext(ctx, query, tag)
	if err != nil {
		return nil, fmt.Errorf("get batch outbounds by tag: %w", err)
	}
	defer rows.Close()

	var batches []BatchOutbound
	for rows.Next() {
		var batch BatchOutbound
		if err := rows.Scan(&batch.ID, &batch.BatchID, &batch.Tag, &batch.ServerID, &batch.Protocol, &batch.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan batch outbound: %w", err)
		}
		batches = append(batches, batch)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate batch outbounds: %w", err)
	}

	return batches, nil
}

// DeleteBatchOutb​​oundsByBatchID 删除具有给定批次 ID 的所有批次出站。
func (r *TrafficRepository) DeleteBatchOutboundsByBatchID(ctx context.Context, batchID string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	batchID = strings.TrimSpace(batchID)
	if batchID == "" {
		return errors.New("batch id is required")
	}

	const stmt = `DELETE FROM batch_outbounds WHERE batch_id = ?`
	_, err := r.db.ExecContext(ctx, stmt, batchID)
	if err != nil {
		return fmt.Errorf("delete batch outbounds by batch id: %w", err)
	}

	return nil
}

// DeleteBatchOutb​​oundsByTag 删除具有给定标签的所有批次出站。
func (r *TrafficRepository) DeleteBatchOutboundsByTag(ctx context.Context, tag string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	tag = strings.TrimSpace(tag)
	if tag == "" {
		return errors.New("tag is required")
	}

	const stmt = `DELETE FROM batch_outbounds WHERE tag = ?`
	_, err := r.db.ExecContext(ctx, stmt, tag)
	if err != nil {
		return fmt.Errorf("delete batch outbounds by tag: %w", err)
	}

	return nil
}

// 封装CRUD操作

// 返回所有包模板
func (r *TrafficRepository) ListPackages(ctx context.Context) ([]Package, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const query = `
		SELECT id, name, COALESCE(description, ''), traffic_limit_bytes, cycle_days,
		       is_reset, reset_day, COALESCE(nodes, '[]'), COALESCE(speed_limit_mbps, 0), COALESCE(device_limit, 0),
		       COALESCE(short_code, ''), created_at, updated_at
		FROM packages
		ORDER BY created_at DESC
	`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list packages: %w", err)
	}
	defer rows.Close()

	var packages []Package
	for rows.Next() {
		var pkg Package
		var isReset int
		var nodesJSON string
		err := rows.Scan(&pkg.ID, &pkg.Name, &pkg.Description, &pkg.TrafficLimitBytes,
			&pkg.CycleDays, &isReset, &pkg.ResetDay, &nodesJSON, &pkg.SpeedLimitMbps, &pkg.DeviceLimit,
			&pkg.ShortCode, &pkg.CreatedAt, &pkg.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan package: %w", err)
		}
		pkg.IsReset = isReset != 0
		pkg.TrafficLimitGB = float64(pkg.TrafficLimitBytes) / (1024 * 1024 * 1024)

		// 反序列化节点 JSON
		pkg.Nodes = []int64{}
		if nodesJSON != "" && nodesJSON != "[]" {
			if err := json.Unmarshal([]byte(nodesJSON), &pkg.Nodes); err != nil {
				pkg.Nodes = []int64{}
			}
		}

		packages = append(packages, pkg)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate packages: %w", err)
	}

	return packages, nil
}

// 按 ID 返回包
func (r *TrafficRepository) GetPackage(ctx context.Context, id int64) (*Package, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const query = `
		SELECT id, name, COALESCE(description, ''), traffic_limit_bytes, cycle_days,
		       is_reset, reset_day, COALESCE(nodes, '[]'), COALESCE(speed_limit_mbps, 0), COALESCE(device_limit, 0),
		       COALESCE(short_code, ''), created_at, updated_at
		FROM packages
		WHERE id = ?
	`

	var pkg Package
	var isReset int
	var nodesJSON string
	err := r.db.QueryRowContext(ctx, query, id).Scan(&pkg.ID, &pkg.Name, &pkg.Description,
		&pkg.TrafficLimitBytes, &pkg.CycleDays, &isReset, &pkg.ResetDay, &nodesJSON,
		&pkg.SpeedLimitMbps, &pkg.DeviceLimit, &pkg.ShortCode,
		&pkg.CreatedAt, &pkg.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPackageNotFound
		}
		return nil, fmt.Errorf("get package: %w", err)
	}

	pkg.IsReset = isReset != 0
	pkg.TrafficLimitGB = float64(pkg.TrafficLimitBytes) / (1024 * 1024 * 1024)

	// 反序列化节点 JSON
	pkg.Nodes = []int64{}
	if nodesJSON != "" && nodesJSON != "[]" {
		if err := json.Unmarshal([]byte(nodesJSON), &pkg.Nodes); err != nil {
			pkg.Nodes = []int64{}
		}
	}

	return &pkg, nil
}

// 按名称返回包
func (r *TrafficRepository) GetPackageByName(ctx context.Context, name string) (*Package, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("package name is required")
	}

	const query = `
		SELECT id, name, COALESCE(description, ''), traffic_limit_bytes, cycle_days,
		       is_reset, reset_day, COALESCE(nodes, '[]'), COALESCE(speed_limit_mbps, 0), COALESCE(device_limit, 0),
		       COALESCE(short_code, ''), created_at, updated_at
		FROM packages
		WHERE name = ?
	`

	var pkg Package
	var isReset int
	var nodesJSON string
	err := r.db.QueryRowContext(ctx, query, name).Scan(&pkg.ID, &pkg.Name, &pkg.Description,
		&pkg.TrafficLimitBytes, &pkg.CycleDays, &isReset, &pkg.ResetDay, &nodesJSON,
		&pkg.SpeedLimitMbps, &pkg.DeviceLimit, &pkg.ShortCode,
		&pkg.CreatedAt, &pkg.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPackageNotFound
		}
		return nil, fmt.Errorf("get package by name: %w", err)
	}

	pkg.IsReset = isReset != 0
	pkg.TrafficLimitGB = float64(pkg.TrafficLimitBytes) / (1024 * 1024 * 1024)

	// 反序列化节点 JSON
	pkg.Nodes = []int64{}
	if nodesJSON != "" && nodesJSON != "[]" {
		if err := json.Unmarshal([]byte(nodesJSON), &pkg.Nodes); err != nil {
			pkg.Nodes = []int64{}
		}
	}
	return &pkg, nil
}

// 创建一个新的包模板
func (r *TrafficRepository) CreatePackage(ctx context.Context, pkg Package) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}

	name := strings.TrimSpace(pkg.Name)
	if name == "" {
		return 0, errors.New("package name is required")
	}

	// 检查同名的包是否已经存在
	if existing, err := r.GetPackageByName(ctx, name); err == nil && existing != nil {
		return 0, ErrPackageExists
	}

	// 将节点序列化为 JSON
	nodesJSON, err := json.Marshal(pkg.Nodes)
	if err != nil {
		return 0, fmt.Errorf("serialize nodes: %w", err)
	}

	// 生成短码
	shortCode, err := generatePackageShortCode()
	if err != nil {
		return 0, err
	}

	const query = `
		INSERT INTO packages (name, description, traffic_limit_bytes, cycle_days, is_reset, reset_day, nodes, speed_limit_mbps, device_limit, short_code)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	isReset := 0
	if pkg.IsReset {
		isReset = 1
	}

	result, err := r.db.ExecContext(ctx, query, name, pkg.Description, pkg.TrafficLimitBytes,
		pkg.CycleDays, isReset, pkg.ResetDay, string(nodesJSON), pkg.SpeedLimitMbps, pkg.DeviceLimit, shortCode)
	if err != nil {
		return 0, fmt.Errorf("create package: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("get last insert id: %w", err)
	}

	return id, nil
}

// 更新现有包模板
func (r *TrafficRepository) UpdatePackage(ctx context.Context, pkg Package) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if pkg.ID <= 0 {
		return errors.New("package ID is required")
	}

	name := strings.TrimSpace(pkg.Name)
	if name == "" {
		return errors.New("package name is required")
	}

	// 将节点序列化为 JSON
	nodesJSON, err := json.Marshal(pkg.Nodes)
	if err != nil {
		return fmt.Errorf("serialize nodes: %w", err)
	}

	const query = `
		UPDATE packages
		SET name = ?, description = ?, traffic_limit_bytes = ?, cycle_days = ?,
		    is_reset = ?, reset_day = ?, nodes = ?, speed_limit_mbps = ?, device_limit = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`

	isReset := 0
	if pkg.IsReset {
		isReset = 1
	}

	result, err := r.db.ExecContext(ctx, query, name, pkg.Description, pkg.TrafficLimitBytes,
		pkg.CycleDays, isReset, pkg.ResetDay, string(nodesJSON), pkg.SpeedLimitMbps, pkg.DeviceLimit, pkg.ID)
	if err != nil {
		return fmt.Errorf("update package: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}

	if affected == 0 {
		return ErrPackageNotFound
	}

	return nil
}

// 根据 ID 删除包模板
func (r *TrafficRepository) DeletePackage(ctx context.Context, id int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("package ID is required")
	}

	const query = `DELETE FROM packages WHERE id = ?`

	result, err := r.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("delete package: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}

	if affected == 0 {
		return ErrPackageNotFound
	}

	return nil
}

// 将包分配给用户
func (r *TrafficRepository) AssignPackageToUser(ctx context.Context, username string, packageID int64, startDate time.Time, endDate time.Time, isReset bool, resetDay int) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	// 验证套餐存在
	_, err := r.GetPackage(ctx, packageID)
	if err != nil {
		return err
	}

	var isResetInt int
	if isReset {
		isResetInt = 1
	}

	const query = `
		UPDATE users
		SET package_id = ?, package_start_date = ?, package_end_date = ?, is_reset = ?, reset_day = ?, updated_at = CURRENT_TIMESTAMP
		WHERE username = ?
	`

	result, err := r.db.ExecContext(ctx, query, packageID, startDate, endDate, isResetInt, resetDay, username)
	if err != nil {
		return fmt.Errorf("assign package to user: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}

	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// 删除用户的包分配
func (r *TrafficRepository) RemovePackageFromUser(ctx context.Context, username string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return errors.New("username is required")
	}

	const query = `
		UPDATE users
		SET package_id = NULL, package_start_date = NULL, package_end_date = NULL, is_reset = 0, reset_day = 1, updated_at = CURRENT_TIMESTAMP
		WHERE username = ?
	`

	result, err := r.db.ExecContext(ctx, query, username)
	if err != nil {
		return fmt.Errorf("remove package from user: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}

	if affected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// UserInboundConfig 记录用户绑定套餐时添加到入站的凭据，用于解绑时清理
type UserInboundConfig struct {
	ID             int64
	Username       string
	ServerID       int64
	InboundTag     string
	Protocol       string
	CredentialJSON string
	CreatedAt      time.Time
}

func (r *TrafficRepository) SaveUserInboundConfig(ctx context.Context, cfg UserInboundConfig) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO user_inbound_configs (username, server_id, inbound_tag, protocol, credential_json) VALUES (?, ?, ?, ?, ?)`,
		cfg.Username, cfg.ServerID, cfg.InboundTag, cfg.Protocol, cfg.CredentialJSON)
	return err
}

func (r *TrafficRepository) GetUserInboundConfigs(ctx context.Context, username string) ([]UserInboundConfig, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, username, server_id, inbound_tag, protocol, credential_json, created_at FROM user_inbound_configs WHERE username = ?`, username)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var configs []UserInboundConfig
	for rows.Next() {
		var c UserInboundConfig
		if err := rows.Scan(&c.ID, &c.Username, &c.ServerID, &c.InboundTag, &c.Protocol, &c.CredentialJSON, &c.CreatedAt); err != nil {
			return nil, err
		}
		configs = append(configs, c)
	}
	return configs, rows.Err()
}

func (r *TrafficRepository) GetUserInboundConfigsByServer(ctx context.Context, serverID int64) ([]UserInboundConfig, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, username, server_id, inbound_tag, protocol, credential_json, created_at FROM user_inbound_configs WHERE server_id = ?`, serverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var configs []UserInboundConfig
	for rows.Next() {
		var c UserInboundConfig
		if err := rows.Scan(&c.ID, &c.Username, &c.ServerID, &c.InboundTag, &c.Protocol, &c.CredentialJSON, &c.CreatedAt); err != nil {
			return nil, err
		}
		configs = append(configs, c)
	}
	return configs, rows.Err()
}

func (r *TrafficRepository) DeleteUserInboundConfigs(ctx context.Context, username string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM user_inbound_configs WHERE username = ?`, username)
	return err
}

func (r *TrafficRepository) GetUserInboundConfig(ctx context.Context, username string, serverID int64, inboundTag string) (*UserInboundConfig, error) {
	var c UserInboundConfig
	err := r.db.QueryRowContext(ctx,
		`SELECT id, username, server_id, inbound_tag, protocol, credential_json, created_at FROM user_inbound_configs WHERE username = ? AND server_id = ? AND inbound_tag = ? LIMIT 1`,
		username, serverID, inboundTag).Scan(&c.ID, &c.Username, &c.ServerID, &c.InboundTag, &c.Protocol, &c.CredentialJSON, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// UserOutbound 记录用户添加的出站配置
type UserOutbound struct {
	ID           int64
	Username     string
	ServerID     int64
	InboundTag   string
	OutboundTag  string
	OutboundJSON string
	CreatedAt    time.Time
}

func (r *TrafficRepository) SaveUserOutbound(ctx context.Context, uo UserOutbound) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO user_outbounds (username, server_id, inbound_tag, outbound_tag, outbound_json) VALUES (?, ?, ?, ?, ?)`,
		uo.Username, uo.ServerID, uo.InboundTag, uo.OutboundTag, uo.OutboundJSON)
	return err
}

func (r *TrafficRepository) GetUserOutbounds(ctx context.Context, username string) ([]UserOutbound, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, username, server_id, inbound_tag, outbound_tag, outbound_json, created_at FROM user_outbounds WHERE username = ?`, username)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var outbounds []UserOutbound
	for rows.Next() {
		var o UserOutbound
		if err := rows.Scan(&o.ID, &o.Username, &o.ServerID, &o.InboundTag, &o.OutboundTag, &o.OutboundJSON, &o.CreatedAt); err != nil {
			return nil, err
		}
		outbounds = append(outbounds, o)
	}
	return outbounds, rows.Err()
}

func (r *TrafficRepository) GetUserOutbound(ctx context.Context, username string, serverID int64, outboundTag string) (*UserOutbound, error) {
	var o UserOutbound
	err := r.db.QueryRowContext(ctx,
		`SELECT id, username, server_id, inbound_tag, outbound_tag, outbound_json, created_at FROM user_outbounds WHERE username = ? AND server_id = ? AND outbound_tag = ?`,
		username, serverID, outboundTag).Scan(&o.ID, &o.Username, &o.ServerID, &o.InboundTag, &o.OutboundTag, &o.OutboundJSON, &o.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func (r *TrafficRepository) DeleteUserOutbound(ctx context.Context, username string, serverID int64, outboundTag string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM user_outbounds WHERE username = ? AND server_id = ? AND outbound_tag = ?`,
		username, serverID, outboundTag)
	return err
}

func (r *TrafficRepository) DeleteUserOutboundsByUsername(ctx context.Context, username string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM user_outbounds WHERE username = ?`, username)
	return err
}

func (r *TrafficRepository) ListUsersWithPackage(ctx context.Context) ([]User, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT username, password_hash, COALESCE(email, ''), COALESCE(nickname, ''), COALESCE(avatar_url, ''), COALESCE(role, ''), is_active, COALESCE(remark, ''), COALESCE(package_id, 0), COALESCE(is_reset, 0), COALESCE(reset_day, 1), package_end_date, speed_limit_override, device_limit_override, created_at, updated_at FROM users WHERE package_id IS NOT NULL AND package_id > 0`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []User
	for rows.Next() {
		var u User
		var active, isReset int
		var endDate sql.NullTime
		var speedOverride sql.NullFloat64
		var deviceOverride sql.NullInt64
		if err := rows.Scan(&u.Username, &u.PasswordHash, &u.Email, &u.Nickname, &u.AvatarURL, &u.Role, &active, &u.Remark, &u.PackageID, &isReset, &u.ResetDay, &endDate, &speedOverride, &deviceOverride, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		u.IsActive = active != 0
		u.IsReset = isReset != 0
		if endDate.Valid {
			u.PackageEndDate = &endDate.Time
		}
		if speedOverride.Valid {
			v := speedOverride.Float64
			u.SpeedLimitOverride = &v
		}
		if deviceOverride.Valid {
			v := int(deviceOverride.Int64)
			u.DeviceLimitOverride = &v
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (r *TrafficRepository) GetUserTotalTraffic(ctx context.Context, username string) (int64, error) {
	var total int64
	err := r.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(uplink + downlink), 0) FROM user_traffic WHERE username = ?`, username).Scan(&total)
	return total, err
}

func (r *TrafficRepository) UpdateUserLimitOverrides(ctx context.Context, username string, speedOverride *float64, deviceOverride *int) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET speed_limit_override = ?, device_limit_override = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`,
		speedOverride, deviceOverride, username)
	return err
}

func (r *TrafficRepository) UpdateUserOverLimit(ctx context.Context, username string, isOverLimit bool) error {
	val := 0
	if isOverLimit {
		val = 1
	}
	_, err := r.db.ExecContext(ctx, `UPDATE users SET is_over_limit = ? WHERE username = ?`, val, username)
	return err
}

func (r *TrafficRepository) IsUserOverLimit(ctx context.Context, username string) (bool, error) {
	var val int
	err := r.db.QueryRowContext(ctx, `SELECT COALESCE(is_over_limit, 0) FROM users WHERE username = ?`, username).Scan(&val)
	return val == 1, err
}

// 初始化 API token（如果不存在）
func (r *TrafficRepository) initializeAPIToken() error {
	// 检查 API token 是否已存在
	var exists bool
	err := r.db.QueryRow("SELECT EXISTS(SELECT 1 FROM system_settings WHERE key = 'api_token')").Scan(&exists)
	if err != nil {
		return fmt.Errorf("检查 api token 是否存在: %w", err)
	}

	if !exists {
		// 生成新的 API token
		token := uuid.New().String()
		_, err = r.db.Exec("INSERT INTO system_settings (key, value) VALUES ('api_token', ?)", token)
		if err != nil {
			return fmt.Errorf("插入 api token: %w", err)
		}
	}

	return nil
}

// 返回当前的 API token
func (r *TrafficRepository) GetAPIToken(ctx context.Context) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("流量仓库未初始化")
	}

	var token string
	err := r.db.QueryRowContext(ctx, "SELECT value FROM system_settings WHERE key = 'api_token'").Scan(&token)
	if err == sql.ErrNoRows {
		// 如果 token 不存在，初始化它
		if err := r.initializeAPIToken(); err != nil {
			return "", err
		}
		// 重新获取
		err = r.db.QueryRowContext(ctx, "SELECT value FROM system_settings WHERE key = 'api_token'").Scan(&token)
	}
	if err != nil {
		return "", fmt.Errorf("获取 api token: %w", err)
	}

	return token, nil
}

// 重新生成 API token
func (r *TrafficRepository) RegenerateAPIToken(ctx context.Context) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("流量仓库未初始化")
	}

	token := uuid.New().String()
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO system_settings (key, value, updated_at)
		VALUES ('api_token', ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
	`, token)
	if err != nil {
		return "", fmt.Errorf("重新生成 api token: %w", err)
	}

	return token, nil
}

// 获取是否使用 gRPC 的设置
func (r *TrafficRepository) GetUseGRPC(ctx context.Context) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("流量仓库未初始化")
	}

	var value string
	err := r.db.QueryRowContext(ctx, "SELECT value FROM system_settings WHERE key = 'use_grpc'").Scan(&value)
	if err == sql.ErrNoRows {
		return false, nil // 默认不使用 gRPC
	}
	if err != nil {
		return false, fmt.Errorf("获取 use_grpc 设置: %w", err)
	}

	return value == "true", nil
}

// 设置是否使用 gRPC
func (r *TrafficRepository) SetUseGRPC(ctx context.Context, useGRPC bool) error {
	if r == nil || r.db == nil {
		return errors.New("流量仓库未初始化")
	}

	value := "false"
	if useGRPC {
		value = "true"
	}

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO system_settings (key, value, updated_at)
		VALUES ('use_grpc', ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
	`, value)
	if err != nil {
		return fmt.Errorf("设置 use_grpc: %w", err)
	}

	return nil
}

// 获取系统设置
func (r *TrafficRepository) GetSystemSetting(ctx context.Context, key string) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("traffic repository not initialized")
	}
	var value string
	err := r.db.QueryRowContext(ctx, "SELECT value FROM system_settings WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("获取系统设置 %s: %w", key, err)
	}
	return value, nil
}

// 设置系统设置
func (r *TrafficRepository) SetSystemSetting(ctx context.Context, key, value string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO system_settings (key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
	`, key, value)
	if err != nil {
		return fmt.Errorf("设置系统设置 %s: %w", key, err)
	}
	return nil
}

// 远程服务器CRUD操作

// 返回所有远程服务器。
func (r *TrafficRepository) ListRemoteServers(ctx context.Context) ([]RemoteServer, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const query = `SELECT id, name, token, status, last_heartbeat, COALESCE(ip_address, ''), COALESCE(domain, ''),
		boot_time, xray_boot_time, COALESCE(boot_count, 0), COALESCE(xray_boot_count, 0),
		token_expires_at, last_token_refresh,
		COALESCE(connection_mode, 'push'), COALESCE(pull_address, ''), COALESCE(pull_port, 0), COALESCE(pull_token, ''), last_pull_at,
		COALESCE(push_fail_count, 0), last_push_fail, COALESCE(fallback_to_pull, 0), fallback_at,
		COALESCE(current_upload_speed, 0), COALESCE(current_download_speed, 0), speed_updated_at,
		COALESCE(xray_running, 0), COALESCE(xray_version, ''), xray_scanned_at,
		COALESCE(listen_port, 0), COALESCE(traffic_limit, 0), COALESCE(traffic_reset_day, 0),
		COALESCE(agent_token, ''), agent_token_expires_at, last_agent_token_refresh,
		COALESCE(use_443, 0), COALESCE(steal_mode, 'tunnel'),
		COALESCE(site_type, ''), COALESCE(site_value, ''),
		COALESCE(xray_mode, 'external'),
		COALESCE(time_offset_seconds, 0),
		created_at, updated_at
		FROM remote_servers ORDER BY created_at DESC`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list remote servers: %w", err)
	}
	defer rows.Close()

	var servers []RemoteServer
	for rows.Next() {
		var server RemoteServer
		var lastHeartbeat, tokenExpiresAt, lastTokenRefresh, lastPullAt, lastPushFail, fallbackAt, speedUpdatedAt, xrayScannedAt sql.NullTime
		var bootTime, xrayBootTime sql.NullString
		var agentTokenExpiresAt, lastAgentTokenRefresh sql.NullTime
		var fallbackToPull, xrayRunning int
		var timeOffsetSeconds int64
		if err := rows.Scan(&server.ID, &server.Name, &server.Token, &server.Status, &lastHeartbeat, &server.IPAddress, &server.Domain,
			&bootTime, &xrayBootTime, &server.BootCount, &server.XrayBootCount,
			&tokenExpiresAt, &lastTokenRefresh,
			&server.ConnectionMode, &server.PullAddress, &server.PullPort, &server.PullToken, &lastPullAt,
			&server.PushFailCount, &lastPushFail, &fallbackToPull, &fallbackAt,
			&server.CurrentUploadSpeed, &server.CurrentDownloadSpeed, &speedUpdatedAt,
			&xrayRunning, &server.XrayVersion, &xrayScannedAt,
			&server.ListenPort, &server.TrafficLimit, &server.TrafficResetDay,
			&server.AgentToken, &agentTokenExpiresAt, &lastAgentTokenRefresh,
			&server.Use443, &server.StealMode,
			&server.SiteType, &server.SiteValue,
			&server.XrayMode,
			&timeOffsetSeconds,
			&server.CreatedAt, &server.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan remote server: %w", err)
		}
		if lastHeartbeat.Valid {
			server.LastHeartbeat = &lastHeartbeat.Time
		}
		server.BootTime = parseNullTimeString(bootTime)
		server.XrayBootTime = parseNullTimeString(xrayBootTime)
		if tokenExpiresAt.Valid {
			server.TokenExpiresAt = &tokenExpiresAt.Time
		}
		if lastTokenRefresh.Valid {
			server.LastTokenRefresh = &lastTokenRefresh.Time
		}
		if lastPullAt.Valid {
			server.LastPullAt = &lastPullAt.Time
		}
		if lastPushFail.Valid {
			server.LastPushFail = &lastPushFail.Time
		}
		if fallbackAt.Valid {
			server.FallbackAt = &fallbackAt.Time
		}
		if speedUpdatedAt.Valid {
			server.SpeedUpdatedAt = &speedUpdatedAt.Time
		}
		if xrayScannedAt.Valid {
			server.XrayScannedAt = &xrayScannedAt.Time
		}
		if agentTokenExpiresAt.Valid {
			server.AgentTokenExpiresAt = &agentTokenExpiresAt.Time
		}
		if lastAgentTokenRefresh.Valid {
			server.LastAgentTokenRefresh = &lastAgentTokenRefresh.Time
		}
		server.FallbackToPull = fallbackToPull != 0
		server.XrayRunning = xrayRunning != 0
		if timeOffsetSeconds != 0 {
			server.TimeOffsetSeconds = &timeOffsetSeconds
		}
		servers = append(servers, server)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate remote servers: %w", err)
	}

	return servers, nil
}

// 按 ID 返回远程服务器。
func (r *TrafficRepository) GetRemoteServer(ctx context.Context, id int64) (*RemoteServer, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return nil, errors.New("remote server id is required")
	}

	const query = `SELECT id, name, token, status, last_heartbeat, COALESCE(ip_address, ''), COALESCE(domain, ''),
		boot_time, xray_boot_time, COALESCE(boot_count, 0), COALESCE(xray_boot_count, 0),
		token_expires_at, last_token_refresh,
		COALESCE(connection_mode, 'push'), COALESCE(pull_address, ''), COALESCE(pull_port, 0), COALESCE(pull_token, ''), last_pull_at,
		COALESCE(listen_port, 0),
		COALESCE(agent_token, ''), agent_token_expires_at, last_agent_token_refresh,
		COALESCE(use_443, 0), COALESCE(steal_mode, 'tunnel'),
		COALESCE(site_type, ''), COALESCE(site_value, ''),
		COALESCE(xray_mode, 'external'),
		created_at, updated_at
		FROM remote_servers WHERE id = ?`

	var server RemoteServer
	var lastHeartbeat, tokenExpiresAt, lastTokenRefresh, lastPullAt sql.NullTime
	var bootTime, xrayBootTime sql.NullString
	var agentTokenExpiresAt, lastAgentTokenRefresh sql.NullTime
	err := r.db.QueryRowContext(ctx, query, id).Scan(&server.ID, &server.Name, &server.Token, &server.Status, &lastHeartbeat, &server.IPAddress, &server.Domain,
		&bootTime, &xrayBootTime, &server.BootCount, &server.XrayBootCount,
		&tokenExpiresAt, &lastTokenRefresh,
		&server.ConnectionMode, &server.PullAddress, &server.PullPort, &server.PullToken, &lastPullAt,
		&server.ListenPort,
		&server.AgentToken, &agentTokenExpiresAt, &lastAgentTokenRefresh,
		&server.Use443, &server.StealMode,
		&server.SiteType, &server.SiteValue,
		&server.XrayMode,
		&server.CreatedAt, &server.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrRemoteServerNotFound
		}
		return nil, fmt.Errorf("get remote server: %w", err)
	}

	if lastHeartbeat.Valid {
		server.LastHeartbeat = &lastHeartbeat.Time
	}
	server.BootTime = parseNullTimeString(bootTime)
	server.XrayBootTime = parseNullTimeString(xrayBootTime)
	if tokenExpiresAt.Valid {
		server.TokenExpiresAt = &tokenExpiresAt.Time
	}
	if lastTokenRefresh.Valid {
		server.LastTokenRefresh = &lastTokenRefresh.Time
	}
	if lastPullAt.Valid {
		server.LastPullAt = &lastPullAt.Time
	}
	if agentTokenExpiresAt.Valid {
		server.AgentTokenExpiresAt = &agentTokenExpiresAt.Time
	}
	if lastAgentTokenRefresh.Valid {
		server.LastAgentTokenRefresh = &lastAgentTokenRefresh.Time
	}
	return &server, nil
}

// 通过其令牌返回远程服务器。
func (r *TrafficRepository) GetRemoteServerByToken(ctx context.Context, token string) (*RemoteServer, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	token = strings.TrimSpace(token)
	if token == "" {
		return nil, errors.New("remote server token is required")
	}

	const query = `SELECT id, name, token, status, last_heartbeat, COALESCE(ip_address, ''), COALESCE(domain, ''),
		boot_time, xray_boot_time, COALESCE(boot_count, 0), COALESCE(xray_boot_count, 0),
		token_expires_at, last_token_refresh,
		COALESCE(connection_mode, 'push'), COALESCE(pull_address, ''), COALESCE(pull_port, 0), COALESCE(pull_token, ''), last_pull_at,
		COALESCE(agent_token, ''), agent_token_expires_at, last_agent_token_refresh,
		COALESCE(use_443, 0), COALESCE(steal_mode, 'tunnel'),
		COALESCE(site_type, ''), COALESCE(site_value, ''),
		COALESCE(xray_mode, 'external'),
		created_at, updated_at
		FROM remote_servers WHERE token = ?`

	var server RemoteServer
	var lastHeartbeat, tokenExpiresAt, lastTokenRefresh, lastPullAt sql.NullTime
	var bootTime, xrayBootTime sql.NullString
	var agentTokenExpiresAt, lastAgentTokenRefresh sql.NullTime
	err := r.db.QueryRowContext(ctx, query, token).Scan(&server.ID, &server.Name, &server.Token, &server.Status, &lastHeartbeat, &server.IPAddress, &server.Domain,
		&bootTime, &xrayBootTime, &server.BootCount, &server.XrayBootCount,
		&tokenExpiresAt, &lastTokenRefresh,
		&server.ConnectionMode, &server.PullAddress, &server.PullPort, &server.PullToken, &lastPullAt,
		&server.AgentToken, &agentTokenExpiresAt, &lastAgentTokenRefresh,
		&server.Use443, &server.StealMode,
		&server.SiteType, &server.SiteValue,
		&server.XrayMode,
		&server.CreatedAt, &server.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrRemoteServerNotFound
		}
		return nil, fmt.Errorf("get remote server by token: %w", err)
	}

	if lastHeartbeat.Valid {
		server.LastHeartbeat = &lastHeartbeat.Time
	}
	server.BootTime = parseNullTimeString(bootTime)
	server.XrayBootTime = parseNullTimeString(xrayBootTime)
	if tokenExpiresAt.Valid {
		server.TokenExpiresAt = &tokenExpiresAt.Time
	}
	if lastTokenRefresh.Valid {
		server.LastTokenRefresh = &lastTokenRefresh.Time
	}
	if lastPullAt.Valid {
		server.LastPullAt = &lastPullAt.Time
	}
	if agentTokenExpiresAt.Valid {
		server.AgentTokenExpiresAt = &agentTokenExpiresAt.Time
	}
	if lastAgentTokenRefresh.Valid {
		server.LastAgentTokenRefresh = &lastAgentTokenRefresh.Time
	}
	return &server, nil
}

// 按名称返回远程服务器。
func (r *TrafficRepository) GetRemoteServerByName(ctx context.Context, name string) (*RemoteServer, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("remote server name is required")
	}

	const query = `SELECT id, name, token, status, last_heartbeat, COALESCE(ip_address, ''), COALESCE(domain, ''),
		boot_time, xray_boot_time, COALESCE(boot_count, 0), COALESCE(xray_boot_count, 0),
		token_expires_at, last_token_refresh,
		COALESCE(connection_mode, 'push'), COALESCE(pull_address, ''), COALESCE(pull_port, 0), COALESCE(pull_token, ''), last_pull_at,
		COALESCE(listen_port, 0),
		COALESCE(agent_token, ''), agent_token_expires_at, last_agent_token_refresh,
		COALESCE(use_443, 0), COALESCE(steal_mode, 'tunnel'),
		COALESCE(site_type, ''), COALESCE(site_value, ''),
		COALESCE(xray_mode, 'external'),
		created_at, updated_at
		FROM remote_servers WHERE name = ?`

	var server RemoteServer
	var lastHeartbeat, tokenExpiresAt, lastTokenRefresh, lastPullAt sql.NullTime
	var bootTime, xrayBootTime sql.NullString
	var agentTokenExpiresAt, lastAgentTokenRefresh sql.NullTime
	err := r.db.QueryRowContext(ctx, query, name).Scan(&server.ID, &server.Name, &server.Token, &server.Status, &lastHeartbeat, &server.IPAddress, &server.Domain,
		&bootTime, &xrayBootTime, &server.BootCount, &server.XrayBootCount,
		&tokenExpiresAt, &lastTokenRefresh,
		&server.ConnectionMode, &server.PullAddress, &server.PullPort, &server.PullToken, &lastPullAt,
		&server.ListenPort,
		&server.AgentToken, &agentTokenExpiresAt, &lastAgentTokenRefresh,
		&server.Use443, &server.StealMode,
		&server.SiteType, &server.SiteValue,
		&server.XrayMode,
		&server.CreatedAt, &server.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrRemoteServerNotFound
		}
		return nil, fmt.Errorf("get remote server by name: %w", err)
	}

	if lastHeartbeat.Valid {
		server.LastHeartbeat = &lastHeartbeat.Time
	}
	server.BootTime = parseNullTimeString(bootTime)
	server.XrayBootTime = parseNullTimeString(xrayBootTime)
	if tokenExpiresAt.Valid {
		server.TokenExpiresAt = &tokenExpiresAt.Time
	}
	if lastTokenRefresh.Valid {
		server.LastTokenRefresh = &lastTokenRefresh.Time
	}
	if lastPullAt.Valid {
		server.LastPullAt = &lastPullAt.Time
	}
	if agentTokenExpiresAt.Valid {
		server.AgentTokenExpiresAt = &agentTokenExpiresAt.Time
	}
	if lastAgentTokenRefresh.Valid {
		server.LastAgentTokenRefresh = &lastAgentTokenRefresh.Time
	}
	return &server, nil
}

// 创建一个新的远程服务器。
func (r *TrafficRepository) CreateRemoteServer(ctx context.Context, server *RemoteServer) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if server == nil {
		return errors.New("remote server is required")
	}

	server.Name = strings.TrimSpace(server.Name)
	if server.Name == "" {
		return errors.New("remote server name is required")
	}

	server.Token = strings.TrimSpace(server.Token)
	if server.Token == "" {
		return errors.New("remote server token is required")
	}

	if server.Status == "" {
		server.Status = RemoteServerStatusPending
	}

	// 设置默认连接模式
	if server.ConnectionMode == "" {
		server.ConnectionMode = ConnectionModePush
	}

	// 将令牌有效期设置为从现在起 7 天
	tokenExpiresAt := time.Now().Add(7 * 24 * time.Hour)

	const stmt = `INSERT INTO remote_servers (name, token, status, ip_address, domain, token_expires_at, last_token_refresh, connection_mode, pull_address, pull_port, pull_token, use_443, steal_mode, site_type, site_value, xray_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`

	stealMode := server.StealMode
	if stealMode == "" {
		stealMode = "tunnel"
	}
	xrayMode := server.XrayMode
	if xrayMode == "" {
		xrayMode = "external"
	}
	result, err := r.db.ExecContext(ctx, stmt, server.Name, server.Token, server.Status, server.IPAddress, server.Domain, tokenExpiresAt, server.ConnectionMode, server.PullAddress, server.PullPort, server.PullToken, server.Use443, stealMode, server.SiteType, server.SiteValue, xrayMode)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ErrRemoteServerExists
		}
		return fmt.Errorf("create remote server: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("get last insert id: %w", err)
	}

	server.ID = id
	server.TokenExpiresAt = &tokenExpiresAt
	return nil
}

// HeartbeatUpdate 包含用于更新远程服务器心跳的数据。
type HeartbeatUpdate struct {
	Token             string
	IPAddress         string
	BootTime          *time.Time
	XrayBootTime      *time.Time
	ListenPort        int
	TimeOffsetSeconds *int64
}

// HeartbeatResult 包含心跳更新的结果，包括重新启动检测。
type HeartbeatResult struct {
	ServerID         int64
	ServerName       string
	PreviousStatus   string
	MmwxRestarted    bool
	XrayRestarted    bool
	BootCount        int
	XrayBootCount    int
	TokenExpiresSoon bool
	TokenExpiresAt   *time.Time
}

// 更新远程服务器的检测信号和状态。
func (r *TrafficRepository) UpdateRemoteServerHeartbeat(ctx context.Context, token string, ipAddress string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	token = strings.TrimSpace(token)
	if token == "" {
		return errors.New("remote server token is required")
	}

	const stmt = `UPDATE remote_servers SET status = ?, last_heartbeat = CURRENT_TIMESTAMP, ip_address = ?, updated_at = CURRENT_TIMESTAMP WHERE token = ?`

	result, err := r.db.ExecContext(ctx, stmt, RemoteServerStatusConnected, ipAddress, token)
	if err != nil {
		return fmt.Errorf("update remote server heartbeat: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return ErrRemoteServerNotFound
	}

	return nil
}

// UpdateRemoteServerLastActivity 通过服务器 ID 更新 last_heartbeat。
// 当收到流量数据时会调用此方法，从而无需单独的心跳。
func (r *TrafficRepository) UpdateRemoteServerLastActivity(ctx context.Context, serverID int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	// 首先检查当前状态以记录状态更改
	var currentStatus, serverName string
	checkStmt := `SELECT name, status FROM remote_servers WHERE id = ?`
	if err := r.db.QueryRowContext(ctx, checkStmt, serverID).Scan(&serverName, &currentStatus); err == nil {
		if currentStatus == RemoteServerStatusOffline {
			log.Printf("[Online Detection] Server %s (ID=%d) status changing: OFFLINE -> CONNECTED (received traffic data)",
				serverName, serverID)
		}
	}

	const stmt = `UPDATE remote_servers SET status = ?, last_heartbeat = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`

	_, err := r.db.ExecContext(ctx, stmt, RemoteServerStatusConnected, serverID)
	if err != nil {
		return fmt.Errorf("update remote server last activity: %w", err)
	}

	return nil
}

// UpdateRemoteServerHeartbeatWithRestart 通过重新启动检测来更新心跳。
// 返回 HeartbeatResult 指示 mmwx 或 xray 是否已重新启动。
func (r *TrafficRepository) UpdateRemoteServerHeartbeatWithRestart(ctx context.Context, update HeartbeatUpdate) (*HeartbeatResult, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	token := strings.TrimSpace(update.Token)
	if token == "" {
		return nil, errors.New("remote server token is required")
	}

	// 获取当前服务器状态
	server, err := r.GetRemoteServerByToken(ctx, token)
	if err != nil {
		return nil, err
	}

	result := &HeartbeatResult{
		ServerID:       server.ID,
		ServerName:     server.Name,
		PreviousStatus: server.Status,
		BootCount:      server.BootCount,
		XrayBootCount:  server.XrayBootCount,
	}

	// 检测mmwx重启
	if update.BootTime != nil {
		if server.BootTime != nil && !update.BootTime.Equal(*server.BootTime) {
			result.MmwxRestarted = true
			result.BootCount++
		}
	}

	// 检测 X 射线重启
	if update.XrayBootTime != nil {
		if server.XrayBootTime != nil && !update.XrayBootTime.Equal(*server.XrayBootTime) {
			result.XrayRestarted = true
			result.XrayBootCount++
		}
	}

	// 检查令牌过期（如果在 24 小时内过期则发出警告）
	if server.TokenExpiresAt != nil {
		result.TokenExpiresAt = server.TokenExpiresAt
		if time.Until(*server.TokenExpiresAt) < 24*time.Hour {
			result.TokenExpiresSoon = true
		}
	}

	// 确定 pull_address：如果为空或与旧 ip_​​address 相同，则与 ip_address 同步
	pullAddress := server.PullAddress
	if pullAddress == "" || pullAddress == server.IPAddress {
		pullAddress = update.IPAddress
	}

	// 更新服务器记录
	const stmt = `UPDATE remote_servers SET
		status = ?,
		last_heartbeat = CURRENT_TIMESTAMP,
		ip_address = ?,
		boot_time = ?,
		xray_boot_time = ?,
		boot_count = ?,
		xray_boot_count = ?,
		listen_port = ?,
		pull_address = ?,
		time_offset_seconds = ?,
		updated_at = CURRENT_TIMESTAMP
		WHERE token = ?`

	_, err = r.db.ExecContext(ctx, stmt,
		RemoteServerStatusConnected,
		update.IPAddress,
		update.BootTime,
		update.XrayBootTime,
		result.BootCount,
		result.XrayBootCount,
		update.ListenPort,
		pullAddress,
		update.TimeOffsetSeconds,
		token)
	if err != nil {
		return nil, fmt.Errorf("update remote server heartbeat: %w", err)
	}

	return result, nil
}

// RefreshRemoteServerToken 为远程服务器生成新令牌。
// 如果成功则返回新令牌。
func (r *TrafficRepository) RefreshRemoteServerToken(ctx context.Context, oldToken string) (string, *time.Time, error) {
	if r == nil || r.db == nil {
		return "", nil, errors.New("traffic repository not initialized")
	}

	oldToken = strings.TrimSpace(oldToken)
	if oldToken == "" {
		return "", nil, errors.New("remote server token is required")
	}

	// 验证旧令牌是否存在并检查是否允许刷新
	server, err := r.GetRemoteServerByToken(ctx, oldToken)
	if err != nil {
		return "", nil, err
	}

	// 检查token是否可以刷新（必须是过期24小时内或者已经过期）
	if server.TokenExpiresAt != nil {
		timeUntilExpiry := time.Until(*server.TokenExpiresAt)
		if timeUntilExpiry > 24*time.Hour {
			return "", nil, errors.New("token can only be refreshed within 24 hours of expiration")
		}
	}

	// 生成新令牌
	newToken := uuid.New().String()
	newExpiresAt := time.Now().Add(7 * 24 * time.Hour)

	const stmt = `UPDATE remote_servers SET
		token = ?,
		token_expires_at = ?,
		last_token_refresh = CURRENT_TIMESTAMP,
		updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`

	result, err := r.db.ExecContext(ctx, stmt, newToken, newExpiresAt, server.ID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return "", nil, errors.New("failed to generate unique token, please try again")
		}
		return "", nil, fmt.Errorf("refresh remote server token: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return "", nil, fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return "", nil, ErrRemoteServerNotFound
	}

	return newToken, &newExpiresAt, nil
}

// ResetServerToken 强制重置服务器令牌（代理用于推送到服务器）。
// 无论令牌是否过期，管理员都可以随时调用它。
func (r *TrafficRepository) ResetServerToken(ctx context.Context, serverID int64) (string, *time.Time, error) {
	if r == nil || r.db == nil {
		return "", nil, errors.New("traffic repository not initialized")
	}

	if serverID <= 0 {
		return "", nil, errors.New("remote server id is required")
	}

	// 生成新令牌
	newToken := uuid.New().String()
	newExpiresAt := time.Now().Add(7 * 24 * time.Hour)

	const stmt = `UPDATE remote_servers SET
		token = ?,
		token_expires_at = ?,
		last_token_refresh = CURRENT_TIMESTAMP,
		updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`

	result, err := r.db.ExecContext(ctx, stmt, newToken, newExpiresAt, serverID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return "", nil, errors.New("failed to generate unique token, please try again")
		}
		return "", nil, fmt.Errorf("reset server token: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return "", nil, fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return "", nil, ErrRemoteServerNotFound
	}

	return newToken, &newExpiresAt, nil
}

// ResetAgentToken 强制重置代理令牌（服务器使用该令牌从代理中提取）。
// 管理员可以随时调用此功能。
func (r *TrafficRepository) ResetAgentToken(ctx context.Context, serverID int64) (string, *time.Time, error) {
	if r == nil || r.db == nil {
		return "", nil, errors.New("traffic repository not initialized")
	}

	if serverID <= 0 {
		return "", nil, errors.New("remote server id is required")
	}

	// 生成新令牌
	newToken := uuid.New().String()
	newExpiresAt := time.Now().Add(7 * 24 * time.Hour)

	const stmt = `UPDATE remote_servers SET
		agent_token = ?,
		agent_token_expires_at = ?,
		last_agent_token_refresh = CURRENT_TIMESTAMP,
		updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`

	result, err := r.db.ExecContext(ctx, stmt, newToken, newExpiresAt, serverID)
	if err != nil {
		return "", nil, fmt.Errorf("reset agent token: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return "", nil, fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return "", nil, ErrRemoteServerNotFound
	}

	return newToken, &newExpiresAt, nil
}

// 强制重置服务器令牌和代理令牌。
func (r *TrafficRepository) ResetAllTokens(ctx context.Context, serverID int64) (serverToken string, serverTokenExpiresAt *time.Time, agentToken string, agentTokenExpiresAt *time.Time, err error) {
	if r == nil || r.db == nil {
		return "", nil, "", nil, errors.New("traffic repository not initialized")
	}

	if serverID <= 0 {
		return "", nil, "", nil, errors.New("remote server id is required")
	}

	// 生成新的代币
	newServerToken := uuid.New().String()
	newAgentToken := uuid.New().String()
	newExpiresAt := time.Now().Add(7 * 24 * time.Hour)

	const stmt = `UPDATE remote_servers SET
		token = ?,
		token_expires_at = ?,
		last_token_refresh = CURRENT_TIMESTAMP,
		agent_token = ?,
		agent_token_expires_at = ?,
		last_agent_token_refresh = CURRENT_TIMESTAMP,
		updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`

	result, err := r.db.ExecContext(ctx, stmt, newServerToken, newExpiresAt, newAgentToken, newExpiresAt, serverID)
	if err != nil {
		return "", nil, "", nil, fmt.Errorf("reset all tokens: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return "", nil, "", nil, fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return "", nil, "", nil, ErrRemoteServerNotFound
	}

	return newServerToken, &newExpiresAt, newAgentToken, &newExpiresAt, nil
}

// 更新远程服务器的配置（连接模式、拉取设置等）。
func (r *TrafficRepository) UpdateRemoteServerConfig(ctx context.Context, id int64, connectionMode, pullAddress string, pullPort int, pullToken string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("remote server id is required")
	}

	// 验证连接模式
	if connectionMode != "" && connectionMode != ConnectionModePush && connectionMode != ConnectionModePull && connectionMode != ConnectionModeWebSocket {
		return errors.New("invalid connection mode")
	}

	const stmt = `UPDATE remote_servers SET connection_mode = ?, pull_address = ?, pull_port = ?, pull_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`

	result, err := r.db.ExecContext(ctx, stmt, connectionMode, pullAddress, pullPort, pullToken, id)
	if err != nil {
		return fmt.Errorf("update remote server config: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return ErrRemoteServerNotFound
	}

	return nil
}

// 更新远程服务器的上次拉取时间戳。
func (r *TrafficRepository) UpdateRemoteServerLastPull(ctx context.Context, id int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("remote server id is required")
	}

	const stmt = `UPDATE remote_servers SET last_pull_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`

	result, err := r.db.ExecContext(ctx, stmt, id)
	if err != nil {
		return fmt.Errorf("update remote server last pull: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return ErrRemoteServerNotFound
	}

	return nil
}

// 更新远程服务器的实时速度。
func (r *TrafficRepository) UpdateRemoteServerSpeed(ctx context.Context, id int64, uploadSpeed, downloadSpeed int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("remote server id is required")
	}

	const stmt = `UPDATE remote_servers SET current_upload_speed = ?, current_download_speed = ?, speed_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`

	result, err := r.db.ExecContext(ctx, stmt, uploadSpeed, downloadSpeed, id)
	if err != nil {
		return fmt.Errorf("update remote server speed: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return ErrRemoteServerNotFound
	}

	return nil
}

// 通过令牌更新远程服务器的实时速度。
func (r *TrafficRepository) UpdateRemoteServerSpeedByToken(ctx context.Context, token string, uploadSpeed, downloadSpeed int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if token == "" {
		return errors.New("token is required")
	}

	const stmt = `UPDATE remote_servers SET current_upload_speed = ?, current_download_speed = ?, speed_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE token = ?`

	result, err := r.db.ExecContext(ctx, stmt, uploadSpeed, downloadSpeed, token)
	if err != nil {
		return fmt.Errorf("update remote server speed by token: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return ErrRemoteServerNotFound
	}

	return nil
}

// 在扫描后更新 X 射线状态。
func (r *TrafficRepository) UpdateRemoteServerXrayStatus(ctx context.Context, id int64, running bool, version string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("remote server id is required")
	}

	runningVal := 0
	if running {
		runningVal = 1
	}

	const stmt = `UPDATE remote_servers SET xray_running = ?, xray_version = ?, xray_scanned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`

	result, err := r.db.ExecContext(ctx, stmt, runningVal, version, id)
	if err != nil {
		return fmt.Errorf("update remote server xray status: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return ErrRemoteServerNotFound
	}

	log.Printf("[Remote Server] Updated Xray status for server ID=%d: running=%v, version=%s", id, running, version)

	return nil
}

// IncrementRemoteServerPushFailCount 增加推送失败计数并记录时间。
// 如果失败计数超过阈值，它将触发回退到拉模式。
func (r *TrafficRepository) IncrementRemoteServerPushFailCount(ctx context.Context, id int64, failThreshold int) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return false, errors.New("remote server id is required")
	}

	// 首先，增加失败计数
	const updateStmt = `UPDATE remote_servers SET
		push_fail_count = push_fail_count + 1,
		last_push_fail = CURRENT_TIMESTAMP,
		updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`

	if _, err := r.db.ExecContext(ctx, updateStmt, id); err != nil {
		return false, fmt.Errorf("increment push fail count: %w", err)
	}

	// 检查我们是否应该后退
	var failCount int
	var fallbackToPull bool
	const selectStmt = `SELECT push_fail_count, fallback_to_pull FROM remote_servers WHERE id = ?`
	if err := r.db.QueryRowContext(ctx, selectStmt, id).Scan(&failCount, &fallbackToPull); err != nil {
		return false, fmt.Errorf("get push fail count: %w", err)
	}

	// 如果已经处于后备模式，则返回 true
	if fallbackToPull {
		return true, nil
	}

	// 检查阈值并在超出时触发回退
	if failCount >= failThreshold {
		const fallbackStmt = `UPDATE remote_servers SET
			fallback_to_pull = 1,
			fallback_at = CURRENT_TIMESTAMP,
			updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		if _, err := r.db.ExecContext(ctx, fallbackStmt, id); err != nil {
			return false, fmt.Errorf("set fallback to pull: %w", err)
		}
		return true, nil
	}

	return false, nil
}

// 在推送成功时重置推送失败计数。
func (r *TrafficRepository) ResetRemoteServerPushFailCount(ctx context.Context, id int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("remote server id is required")
	}

	const stmt = `UPDATE remote_servers SET
		push_fail_count = 0,
		fallback_to_pull = 0,
		fallback_at = NULL,
		updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`

	_, err := r.db.ExecContext(ctx, stmt, id)
	if err != nil {
		return fmt.Errorf("reset push fail count: %w", err)
	}

	return nil
}

// 根据连接模式和回退状态确定远程服务器是否应使用拉模式。
func (r *TrafficRepository) ShouldUsePullMode(server RemoteServer) bool {
	// 显式拉模式
	if server.ConnectionMode == ConnectionModePull {
		return true
	}
	// 触发回退的自动模式
	if server.ConnectionMode == ConnectionModeAuto && server.FallbackToPull {
		return true
	}
	// 默认推送/Websocket 模式，触发回退
	if server.FallbackToPull && server.PullAddress != "" && server.PullPort > 0 {
		return true
	}
	return false
}

// 更新远程服务器的基本信息（名称、域、流量设置、连接模式、Xray模式）。
func (r *TrafficRepository) UpdateRemoteServer(ctx context.Context, id int64, name, domain string, trafficLimit int64, trafficResetDay int, connectionMode, xrayMode string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("remote server id is required")
	}

	// 动态构建 SET 子句
	setClauses := []string{"name = ?", "domain = ?", "traffic_limit = ?", "traffic_reset_day = ?"}
	args := []any{name, domain, trafficLimit, trafficResetDay}

	if connectionMode != "" {
		setClauses = append(setClauses, "connection_mode = ?")
		args = append(args, connectionMode)
	}
	if xrayMode != "" {
		setClauses = append(setClauses, "xray_mode = ?")
		args = append(args, xrayMode)
	}
	setClauses = append(setClauses, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id)

	stmt := `UPDATE remote_servers SET ` + strings.Join(setClauses, ", ") + ` WHERE id = ?`

	result, err := r.db.ExecContext(ctx, stmt, args...)
	if err != nil {
		return fmt.Errorf("update remote server: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return ErrRemoteServerNotFound
	}

	return nil
}

func (r *TrafficRepository) UpdateRemoteServerStealMode(ctx context.Context, id int64, stealMode string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}
	result, err := r.db.ExecContext(ctx, `UPDATE remote_servers SET steal_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, stealMode, id)
	if err != nil {
		return fmt.Errorf("update steal_mode: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrRemoteServerNotFound
	}
	return nil
}

func (r *TrafficRepository) DeleteNodesByOriginalServer(ctx context.Context, serverName string) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("traffic repository not initialized")
	}
	result, err := r.db.ExecContext(ctx, `DELETE FROM nodes WHERE original_server = ?`, serverName)
	if err != nil {
		return 0, fmt.Errorf("delete nodes by original_server: %w", err)
	}
	affected, _ := result.RowsAffected()
	return affected, nil
}

// 通过 ID 删除远程服务器。
func (r *TrafficRepository) DeleteRemoteServer(ctx context.Context, id int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if id <= 0 {
		return errors.New("remote server id is required")
	}

	const stmt = `DELETE FROM remote_servers WHERE id = ?`

	result, err := r.db.ExecContext(ctx, stmt, id)
	if err != nil {
		return fmt.Errorf("delete remote server: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if affected == 0 {
		return ErrRemoteServerNotFound
	}

	return nil
}

type OfflineServerInfo struct {
	ID   int64
	Name string
	IP   string
}

// 如果服务器在给定时间内未发送心跳，MarkOfflineRemoteServers 会将服务器标记为离线。
func (r *TrafficRepository) MarkOfflineRemoteServers(ctx context.Context, timeout time.Duration) ([]OfflineServerInfo, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	// 使用 UTC 时间进行比较，因为 SQLite CURRENT_TIMESTAMP 存储的是 UTC 时间
	cutoff := time.Now().UTC().Add(-timeout)

	// 首先，查询哪些服务器将被标记为离线以进行日志记录
	queryStmt := `SELECT id, name, COALESCE(ip_address, ''), last_heartbeat FROM remote_servers WHERE status = ? AND last_heartbeat < ?`
	rows, err := r.db.QueryContext(ctx, queryStmt, RemoteServerStatusConnected, cutoff)
	if err != nil {
		return nil, fmt.Errorf("query servers to mark offline: %w", err)
	}
	defer rows.Close()

	var serversToMarkOffline []struct {
		ID            int64
		Name          string
		IP            string
		LastHeartbeat time.Time
	}
	for rows.Next() {
		var s struct {
			ID            int64
			Name          string
			IP            string
			LastHeartbeat time.Time
		}
		if err := rows.Scan(&s.ID, &s.Name, &s.IP, &s.LastHeartbeat); err != nil {
			continue
		}
		serversToMarkOffline = append(serversToMarkOffline, s)
	}

	// 记录哪些服务器将被标记为离线
	for _, s := range serversToMarkOffline {
		// 使用 UTC 时间计算时间差，因为 LastHeartbeat 是 UTC 时间
		sinceLast := time.Now().UTC().Sub(s.LastHeartbeat)
		log.Printf("[Offline Detection] Marking server %s (ID=%d) as OFFLINE: last_heartbeat was %v ago (threshold: %v)",
			s.Name, s.ID, sinceLast.Round(time.Second), timeout)
	}

	// 现在执行更新
	const stmt = `UPDATE remote_servers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE status = ? AND last_heartbeat < ?`

	result, err := r.db.ExecContext(ctx, stmt, RemoteServerStatusOffline, RemoteServerStatusConnected, cutoff)
	if err != nil {
		return nil, fmt.Errorf("mark offline remote servers: %w", err)
	}

	var offlineServers []OfflineServerInfo
	if affected, _ := result.RowsAffected(); affected > 0 {
		log.Printf("[Offline Detection] Marked %d server(s) as offline", affected)
		for _, s := range serversToMarkOffline {
			offlineServers = append(offlineServers, OfflineServerInfo{ID: s.ID, Name: s.Name, IP: s.IP})
		}
	}

	return offlineServers, nil
}

// ==================== 节点流量 CRUD ====================

// UpsertNodeTraffic 通过重新启动检测来更新或插入节点流量。
// 如果当前值小于上次值，则意味着 Xray 已重新启动，
// 所以我们在更新之前将最后的值累加到总计。
func (r *TrafficRepository) UpsertNodeTraffic(ctx context.Context, serverID int64, tag, trafficType string, uplink, downlink int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if serverID <= 0 {
		return errors.New("server id is required")
	}
	if tag == "" {
		return errors.New("tag is required")
	}
	if trafficType != "inbound" && trafficType != "outbound" {
		return errors.New("type must be 'inbound' or 'outbound'")
	}

	// 首先，尝试获取现有记录
	var existing NodeTraffic
	var exists bool
	row := r.db.QueryRowContext(ctx, `SELECT id, uplink, downlink, total_uplink, total_downlink, last_uplink, last_downlink FROM node_traffic WHERE server_id = ? AND tag = ? AND type = ?`, serverID, tag, trafficType)
	err := row.Scan(&existing.ID, &existing.Uplink, &existing.Downlink, &existing.TotalUplink, &existing.TotalDownlink, &existing.LastUplink, &existing.LastDownlink)
	if err == nil {
		exists = true
	} else if err != sql.ErrNoRows {
		return fmt.Errorf("query existing node traffic: %w", err)
	}

	if !exists {
		// 插入新记录
		const insertStmt = `INSERT INTO node_traffic (server_id, tag, type, uplink, downlink, total_uplink, total_downlink, last_uplink, last_downlink, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
		_, err := r.db.ExecContext(ctx, insertStmt, serverID, tag, trafficType, uplink, downlink, uplink, downlink, uplink, downlink)
		if err != nil {
			return fmt.Errorf("insert node traffic: %w", err)
		}
		return nil
	}

	// 检查 Xray 是否重新启动（当前 < 上次）
	var deltaUplink, deltaDownlink int64
	var newTotalUplink, newTotalDownlink int64

	if uplink < existing.LastUplink || downlink < existing.LastDownlink {
		// Xray 重新启动 - 将最后的值累加到总计
		log.Printf("[Traffic] Detected Xray restart for server %d, %s tag %s: uplink %d -> %d, downlink %d -> %d (accumulating to total)",
			serverID, trafficType, tag, existing.LastUplink, uplink, existing.LastDownlink, downlink)
		newTotalUplink = existing.TotalUplink + existing.LastUplink
		newTotalDownlink = existing.TotalDownlink + existing.LastDownlink
		deltaUplink = uplink
		deltaDownlink = downlink
	} else {
		// 正常情况 - 计算 delta
		deltaUplink = uplink - existing.LastUplink
		deltaDownlink = downlink - existing.LastDownlink
		newTotalUplink = existing.TotalUplink
		newTotalDownlink = existing.TotalDownlink
	}

	// 更新记录
	const updateStmt = `UPDATE node_traffic SET uplink = uplink + ?, downlink = downlink + ?, total_uplink = ?, total_downlink = ?, last_uplink = ?, last_downlink = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
	_, err = r.db.ExecContext(ctx, updateStmt, deltaUplink, deltaDownlink, newTotalUplink, newTotalDownlink, uplink, downlink, existing.ID)
	if err != nil {
		return fmt.Errorf("update node traffic: %w", err)
	}

	return nil
}

// 返回服务器的所有节点流量记录。
func (r *TrafficRepository) GetNodeTrafficByServer(ctx context.Context, serverID int64) ([]NodeTraffic, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const query = `SELECT id, server_id, tag, type, uplink, downlink, total_uplink, total_downlink, last_uplink, last_downlink, updated_at FROM node_traffic WHERE server_id = ? ORDER BY type, tag`
	rows, err := r.db.QueryContext(ctx, query, serverID)
	if err != nil {
		return nil, fmt.Errorf("query node traffic: %w", err)
	}
	defer rows.Close()

	var results []NodeTraffic
	for rows.Next() {
		var t NodeTraffic
		if err := rows.Scan(&t.ID, &t.ServerID, &t.Tag, &t.Type, &t.Uplink, &t.Downlink, &t.TotalUplink, &t.TotalDownlink, &t.LastUplink, &t.LastDownlink, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan node traffic: %w", err)
		}
		results = append(results, t)
	}

	return results, nil
}

// 返回所有节点流量记录。
func (r *TrafficRepository) GetAllNodeTraffic(ctx context.Context) ([]NodeTraffic, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const query = `SELECT id, server_id, tag, type, uplink, downlink, total_uplink, total_downlink, last_uplink, last_downlink, updated_at FROM node_traffic ORDER BY server_id, type, tag`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query all node traffic: %w", err)
	}
	defer rows.Close()

	var results []NodeTraffic
	for rows.Next() {
		var t NodeTraffic
		if err := rows.Scan(&t.ID, &t.ServerID, &t.Tag, &t.Type, &t.Uplink, &t.Downlink, &t.TotalUplink, &t.TotalDownlink, &t.LastUplink, &t.LastDownlink, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan node traffic: %w", err)
		}
		results = append(results, t)
	}

	return results, nil
}

// ==================== 用户流量CRUD ====================

// 通过重新启动检测来更新或插入用户流量。
func (r *TrafficRepository) UpsertUserTraffic(ctx context.Context, serverID int64, username string, uplink, downlink int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if serverID <= 0 {
		return errors.New("server id is required")
	}
	if username == "" {
		return errors.New("username is required")
	}

	// 首先，尝试获取现有记录
	var existing UserTraffic
	var exists bool
	row := r.db.QueryRowContext(ctx, `SELECT id, uplink, downlink, total_uplink, total_downlink, last_uplink, last_downlink FROM user_traffic WHERE server_id = ? AND username = ?`, serverID, username)
	err := row.Scan(&existing.ID, &existing.Uplink, &existing.Downlink, &existing.TotalUplink, &existing.TotalDownlink, &existing.LastUplink, &existing.LastDownlink)
	if err == nil {
		exists = true
	} else if err != sql.ErrNoRows {
		return fmt.Errorf("query existing user traffic: %w", err)
	}

	if !exists {
		// 插入新记录
		const insertStmt = `INSERT INTO user_traffic (server_id, username, uplink, downlink, total_uplink, total_downlink, last_uplink, last_downlink, cycle_start, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
		_, err := r.db.ExecContext(ctx, insertStmt, serverID, username, uplink, downlink, uplink, downlink, uplink, downlink)
		if err != nil {
			return fmt.Errorf("insert user traffic: %w", err)
		}
		return nil
	}

	// 检查 Xray 是否重新启动（当前 < 上次）
	var deltaUplink, deltaDownlink int64
	var newTotalUplink, newTotalDownlink int64

	if uplink < existing.LastUplink || downlink < existing.LastDownlink {
		// Xray 重新启动 - 将最后的值累加到总计
		log.Printf("[Traffic] Detected Xray restart for server %d, user %s: uplink %d -> %d, downlink %d -> %d (accumulating to total)",
			serverID, username, existing.LastUplink, uplink, existing.LastDownlink, downlink)
		newTotalUplink = existing.TotalUplink + existing.LastUplink
		newTotalDownlink = existing.TotalDownlink + existing.LastDownlink
		deltaUplink = uplink
		deltaDownlink = downlink
	} else {
		// 正常情况 - 计算 delta
		deltaUplink = uplink - existing.LastUplink
		deltaDownlink = downlink - existing.LastDownlink
		newTotalUplink = existing.TotalUplink
		newTotalDownlink = existing.TotalDownlink
	}

	// 更新记录
	const updateStmt = `UPDATE user_traffic SET uplink = uplink + ?, downlink = downlink + ?, total_uplink = ?, total_downlink = ?, last_uplink = ?, last_downlink = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
	_, err = r.db.ExecContext(ctx, updateStmt, deltaUplink, deltaDownlink, newTotalUplink, newTotalDownlink, uplink, downlink, existing.ID)
	if err != nil {
		return fmt.Errorf("update user traffic: %w", err)
	}

	return nil
}

// 返回服务器的所有用户流量记录。
func (r *TrafficRepository) GetUserTrafficByServer(ctx context.Context, serverID int64) ([]UserTraffic, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const query = `SELECT id, server_id, username, uplink, downlink, total_uplink, total_downlink, last_uplink, last_downlink, cycle_start, updated_at FROM user_traffic WHERE server_id = ? ORDER BY username`
	rows, err := r.db.QueryContext(ctx, query, serverID)
	if err != nil {
		return nil, fmt.Errorf("query user traffic: %w", err)
	}
	defer rows.Close()

	var results []UserTraffic
	for rows.Next() {
		var t UserTraffic
		if err := rows.Scan(&t.ID, &t.ServerID, &t.Username, &t.Uplink, &t.Downlink, &t.TotalUplink, &t.TotalDownlink, &t.LastUplink, &t.LastDownlink, &t.CycleStart, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan user traffic: %w", err)
		}
		results = append(results, t)
	}

	return results, nil
}

// 返回所有用户流量记录。
func (r *TrafficRepository) GetAllUserTraffic(ctx context.Context) ([]UserTraffic, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	const query = `SELECT id, server_id, username, uplink, downlink, total_uplink, total_downlink, last_uplink, last_downlink, cycle_start, updated_at FROM user_traffic ORDER BY username, server_id`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query all user traffic: %w", err)
	}
	defer rows.Close()

	var results []UserTraffic
	for rows.Next() {
		var t UserTraffic
		if err := rows.Scan(&t.ID, &t.ServerID, &t.Username, &t.Uplink, &t.Downlink, &t.TotalUplink, &t.TotalDownlink, &t.LastUplink, &t.LastDownlink, &t.CycleStart, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan user traffic: %w", err)
		}
		results = append(results, t)
	}

	return results, nil
}

// 返回所有服务器上特定用户的所有流量记录。
func (r *TrafficRepository) GetUserTrafficByUsername(ctx context.Context, username string) ([]UserTraffic, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	if username == "" {
		return nil, errors.New("username is required")
	}

	const query = `SELECT id, server_id, username, uplink, downlink, total_uplink, total_downlink, last_uplink, last_downlink, cycle_start, updated_at FROM user_traffic WHERE username = ? ORDER BY server_id`
	rows, err := r.db.QueryContext(ctx, query, username)
	if err != nil {
		return nil, fmt.Errorf("query user traffic by username: %w", err)
	}
	defer rows.Close()

	var results []UserTraffic
	for rows.Next() {
		var t UserTraffic
		if err := rows.Scan(&t.ID, &t.ServerID, &t.Username, &t.Uplink, &t.Downlink, &t.TotalUplink, &t.TotalDownlink, &t.LastUplink, &t.LastDownlink, &t.CycleStart, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan user traffic: %w", err)
		}
		results = append(results, t)
	}

	return results, nil
}

// 重置用户在所有服务器上的当前周期流量。
func (r *TrafficRepository) ResetUserTrafficCycle(ctx context.Context, username string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if username == "" {
		return errors.New("username is required")
	}

	const stmt = `UPDATE user_traffic SET uplink = 0, downlink = 0, cycle_start = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE username = ?`
	_, err := r.db.ExecContext(ctx, stmt, username)
	if err != nil {
		return fmt.Errorf("reset user traffic cycle: %w", err)
	}

	return nil
}

// ==================== 流量快照 CRUD ====================

// 为服务器创建每日快照。
func (r *TrafficRepository) CreateTrafficSnapshot(ctx context.Context, serverID int64, date string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if serverID <= 0 {
		return errors.New("server id is required")
	}
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	// 根据node_traffic和user_traffic计算总计
	var inboundUplink, inboundDownlink, outboundUplink, outboundDownlink int64
	row := r.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(CASE WHEN type='inbound' THEN uplink ELSE 0 END), 0), COALESCE(SUM(CASE WHEN type='inbound' THEN downlink ELSE 0 END), 0), COALESCE(SUM(CASE WHEN type='outbound' THEN uplink ELSE 0 END), 0), COALESCE(SUM(CASE WHEN type='outbound' THEN downlink ELSE 0 END), 0) FROM node_traffic WHERE server_id = ?`, serverID)
	if err := row.Scan(&inboundUplink, &inboundDownlink, &outboundUplink, &outboundDownlink); err != nil {
		return fmt.Errorf("calculate node traffic totals: %w", err)
	}

	var userUplink, userDownlink int64
	row = r.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(uplink), 0), COALESCE(SUM(downlink), 0) FROM user_traffic WHERE server_id = ?`, serverID)
	if err := row.Scan(&userUplink, &userDownlink); err != nil {
		return fmt.Errorf("calculate user traffic totals: %w", err)
	}

	// 更新插入快照
	const stmt = `INSERT INTO traffic_snapshots (server_id, date, inbound_uplink, inbound_downlink, outbound_uplink, outbound_downlink, user_uplink, user_downlink, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(server_id, date) DO UPDATE SET inbound_uplink = excluded.inbound_uplink, inbound_downlink = excluded.inbound_downlink, outbound_uplink = excluded.outbound_uplink, outbound_downlink = excluded.outbound_downlink, user_uplink = excluded.user_uplink, user_downlink = excluded.user_downlink`
	_, err := r.db.ExecContext(ctx, stmt, serverID, date, inboundUplink, inboundDownlink, outboundUplink, outboundDownlink, userUplink, userDownlink)
	if err != nil {
		return fmt.Errorf("upsert traffic snapshot: %w", err)
	}

	return nil
}

// 返回某个日期范围内服务器的流量快照。
func (r *TrafficRepository) GetTrafficSnapshots(ctx context.Context, serverID int64, days int) ([]TrafficSnapshot, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	if days <= 0 {
		days = 30
	}

	startDate := time.Now().AddDate(0, 0, -days).Format("2006-01-02")

	var query string
	var args []interface{}
	if serverID > 0 {
		query = `SELECT id, server_id, date, inbound_uplink, inbound_downlink, outbound_uplink, outbound_downlink, user_uplink, user_downlink, created_at FROM traffic_snapshots WHERE server_id = ? AND date >= ? ORDER BY date ASC`
		args = []interface{}{serverID, startDate}
	} else {
		query = `SELECT id, server_id, date, inbound_uplink, inbound_downlink, outbound_uplink, outbound_downlink, user_uplink, user_downlink, created_at FROM traffic_snapshots WHERE date >= ? ORDER BY date ASC, server_id ASC`
		args = []interface{}{startDate}
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query traffic snapshots: %w", err)
	}
	defer rows.Close()

	var results []TrafficSnapshot
	for rows.Next() {
		var s TrafficSnapshot
		if err := rows.Scan(&s.ID, &s.ServerID, &s.Date, &s.InboundUplink, &s.InboundDownlink, &s.OutboundUplink, &s.OutboundDownlink, &s.UserUplink, &s.UserDownlink, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan traffic snapshot: %w", err)
		}
		results = append(results, s)
	}

	return results, nil
}

// 删除早于指定天数的快照。
func (r *TrafficRepository) CleanOldSnapshots(ctx context.Context, days int) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if days <= 0 {
		days = 30
	}

	cutoffDate := time.Now().AddDate(0, 0, -days).Format("2006-01-02")
	const stmt = `DELETE FROM traffic_snapshots WHERE date < ?`
	_, err := r.db.ExecContext(ctx, stmt, cutoffDate)
	if err != nil {
		return fmt.Errorf("clean old snapshots: %w", err)
	}

	return nil
}

// 证书状态常量
const (
	CertStatusPending = "pending"
	CertStatusValid   = "valid"
	CertStatusExpired = "expired"
	CertStatusFailed  = "failed"
)

// 证书质询模式常量
const (
	CertChallengeStandalone = "standalone"
	CertChallengeWebroot    = "webroot"
	CertChallengeDNS        = "dns"
)

// 证书表示由 ACME 管理的 SSL/TLS 证书
type Certificate struct {
	ID             int64
	Domain         string
	Email          string
	Provider       string
	CertPath       string
	KeyPath        string
	CertPEM        string
	KeyPEM         string
	Status         string
	ExpiryDate     *time.Time
	IssueDate      *time.Time
	AutoRenew      bool
	ChallengeMode  string
	WebrootPath    string
	RemoteServerID int64
	Message        string
	DNSProviderID  int64
	DeployTarget   string
	DeployCertPath string
	DeployKeyPath  string
	AutoDeploy     bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// DNSProvider 代表可重用的 DNS API 凭证集
type DNSProvider struct {
	ID           int64
	Name         string
	ProviderType string
	Credentials  string // 详见上下文
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func scanCertificate(scanner rowScanner) (Certificate, error) {
	var cert Certificate
	var certPath, keyPath, certPEM, keyPEM, webrootPath, message sql.NullString
	var deployTarget, deployCertPath, deployKeyPath sql.NullString
	var expiryDate, issueDate sql.NullTime
	var autoRenew int
	var autoDeploy int

	if err := scanner.Scan(
		&cert.ID,
		&cert.Domain,
		&cert.Email,
		&cert.Provider,
		&certPath,
		&keyPath,
		&certPEM,
		&keyPEM,
		&cert.Status,
		&expiryDate,
		&issueDate,
		&autoRenew,
		&cert.ChallengeMode,
		&webrootPath,
		&cert.RemoteServerID,
		&message,
		&cert.DNSProviderID,
		&deployTarget,
		&deployCertPath,
		&deployKeyPath,
		&autoDeploy,
		&cert.CreatedAt,
		&cert.UpdatedAt,
	); err != nil {
		return Certificate{}, err
	}

	cert.CertPath = certPath.String
	cert.KeyPath = keyPath.String
	cert.CertPEM = certPEM.String
	cert.KeyPEM = keyPEM.String
	cert.WebrootPath = webrootPath.String
	cert.Message = message.String
	cert.DeployTarget = deployTarget.String
	cert.DeployCertPath = deployCertPath.String
	cert.DeployKeyPath = deployKeyPath.String
	cert.AutoRenew = autoRenew == 1
	cert.AutoDeploy = autoDeploy == 1
	if expiryDate.Valid {
		cert.ExpiryDate = &expiryDate.Time
	}
	if issueDate.Valid {
		cert.IssueDate = &issueDate.Time
	}

	return cert, nil
}

// 返回按创建时间排序的所有证书。
func (r *TrafficRepository) ListCertificates(ctx context.Context) ([]Certificate, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, domain, email, provider, cert_path, key_path, cert_pem, key_pem,
		       status, expiry_date, issue_date, auto_renew, challenge_mode, webroot_path,
		       remote_server_id, message, dns_provider_id, deploy_target, deploy_cert_path, deploy_key_path, auto_deploy,
		       created_at, updated_at
		FROM certificates ORDER BY id DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list certificates: %w", err)
	}
	defer rows.Close()

	var certs []Certificate
	for rows.Next() {
		cert, err := scanCertificate(rows)
		if err != nil {
			return nil, fmt.Errorf("scan certificate: %w", err)
		}
		certs = append(certs, cert)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate certificates: %w", err)
	}

	return certs, nil
}

// 返回特定服务器的证书。
func (r *TrafficRepository) ListCertificatesByServer(ctx context.Context, serverID int64) ([]Certificate, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, domain, email, provider, cert_path, key_path, cert_pem, key_pem,
		       status, expiry_date, issue_date, auto_renew, challenge_mode, webroot_path,
		       remote_server_id, message, dns_provider_id, deploy_target, deploy_cert_path, deploy_key_path, auto_deploy,
		       created_at, updated_at
		FROM certificates WHERE remote_server_id = ? ORDER BY id DESC
	`, serverID)
	if err != nil {
		return nil, fmt.Errorf("list certificates by server: %w", err)
	}
	defer rows.Close()

	var certs []Certificate
	for rows.Next() {
		cert, err := scanCertificate(rows)
		if err != nil {
			return nil, fmt.Errorf("scan certificate: %w", err)
		}
		certs = append(certs, cert)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate certificates: %w", err)
	}

	return certs, nil
}

// 按 ID 返回证书。
func (r *TrafficRepository) GetCertificate(ctx context.Context, id int64) (*Certificate, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	row := r.db.QueryRowContext(ctx, `
		SELECT id, domain, email, provider, cert_path, key_path, cert_pem, key_pem,
		       status, expiry_date, issue_date, auto_renew, challenge_mode, webroot_path,
		       remote_server_id, message, dns_provider_id, deploy_target, deploy_cert_path, deploy_key_path, auto_deploy,
		       created_at, updated_at
		FROM certificates WHERE id = ?
	`, id)

	cert, err := scanCertificate(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrCertificateNotFound
		}
		return nil, fmt.Errorf("get certificate: %w", err)
	}

	return &cert, nil
}

// 按域和服务器 ID 返回证书。
func (r *TrafficRepository) GetCertificateByDomain(ctx context.Context, domain string, serverID int64) (*Certificate, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	row := r.db.QueryRowContext(ctx, `
		SELECT id, domain, email, provider, cert_path, key_path, cert_pem, key_pem,
		       status, expiry_date, issue_date, auto_renew, challenge_mode, webroot_path,
		       remote_server_id, message, dns_provider_id, deploy_target, deploy_cert_path, deploy_key_path, auto_deploy,
		       created_at, updated_at
		FROM certificates WHERE domain = ? AND remote_server_id = ?
	`, domain, serverID)

	cert, err := scanCertificate(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrCertificateNotFound
		}
		return nil, fmt.Errorf("get certificate by domain: %w", err)
	}

	return &cert, nil
}

// 创建新的证书记录。
func (r *TrafficRepository) CreateCertificate(ctx context.Context, cert *Certificate) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	cert.Domain = strings.TrimSpace(cert.Domain)
	if cert.Domain == "" {
		return errors.New("domain is required")
	}
	cert.Email = strings.TrimSpace(cert.Email)
	if cert.Email == "" {
		return errors.New("email is required")
	}
	if cert.Provider == "" {
		cert.Provider = "letsencrypt"
	}
	if cert.Status == "" {
		cert.Status = CertStatusPending
	}
	if cert.ChallengeMode == "" {
		cert.ChallengeMode = CertChallengeStandalone
	}

	autoRenew := 0
	if cert.AutoRenew {
		autoRenew = 1
	}

	if cert.DeployTarget == "" {
		cert.DeployTarget = "none"
	}

	autoDeploy := 0
	if cert.AutoDeploy {
		autoDeploy = 1
	}

	result, err := r.db.ExecContext(ctx, `
		INSERT INTO certificates (domain, email, provider, cert_path, key_path, cert_pem, key_pem,
		                          status, expiry_date, issue_date, auto_renew, challenge_mode, webroot_path,
		                          remote_server_id, message, dns_provider_id, deploy_target, deploy_cert_path, deploy_key_path, auto_deploy)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		cert.Domain,
		cert.Email,
		cert.Provider,
		sql.NullString{String: cert.CertPath, Valid: cert.CertPath != ""},
		sql.NullString{String: cert.KeyPath, Valid: cert.KeyPath != ""},
		sql.NullString{String: cert.CertPEM, Valid: cert.CertPEM != ""},
		sql.NullString{String: cert.KeyPEM, Valid: cert.KeyPEM != ""},
		cert.Status,
		cert.ExpiryDate,
		cert.IssueDate,
		autoRenew,
		cert.ChallengeMode,
		sql.NullString{String: cert.WebrootPath, Valid: cert.WebrootPath != ""},
		cert.RemoteServerID,
		sql.NullString{String: cert.Message, Valid: cert.Message != ""},
		cert.DNSProviderID,
		cert.DeployTarget,
		sql.NullString{String: cert.DeployCertPath, Valid: cert.DeployCertPath != ""},
		sql.NullString{String: cert.DeployKeyPath, Valid: cert.DeployKeyPath != ""},
		autoDeploy,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			return ErrCertificateExists
		}
		return fmt.Errorf("create certificate: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("get last insert id: %w", err)
	}
	cert.ID = id

	return nil
}

// 更新现有证书记录。
func (r *TrafficRepository) UpdateCertificate(ctx context.Context, cert *Certificate) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	if cert.ID <= 0 {
		return errors.New("certificate id is required")
	}

	autoRenew := 0
	if cert.AutoRenew {
		autoRenew = 1
	}
	autoDeploy := 0
	if cert.AutoDeploy {
		autoDeploy = 1
	}

	result, err := r.db.ExecContext(ctx, `
		UPDATE certificates SET
		    domain = ?,
		    email = ?,
		    provider = ?,
		    cert_path = ?,
		    key_path = ?,
		    cert_pem = ?,
		    key_pem = ?,
		    status = ?,
		    expiry_date = ?,
		    issue_date = ?,
		    auto_renew = ?,
		    challenge_mode = ?,
		    webroot_path = ?,
		    remote_server_id = ?,
		    message = ?,
		    dns_provider_id = ?,
		    deploy_target = ?,
		    deploy_cert_path = ?,
		    deploy_key_path = ?,
		    auto_deploy = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		cert.Domain,
		cert.Email,
		cert.Provider,
		sql.NullString{String: cert.CertPath, Valid: cert.CertPath != ""},
		sql.NullString{String: cert.KeyPath, Valid: cert.KeyPath != ""},
		sql.NullString{String: cert.CertPEM, Valid: cert.CertPEM != ""},
		sql.NullString{String: cert.KeyPEM, Valid: cert.KeyPEM != ""},
		cert.Status,
		cert.ExpiryDate,
		cert.IssueDate,
		autoRenew,
		cert.ChallengeMode,
		sql.NullString{String: cert.WebrootPath, Valid: cert.WebrootPath != ""},
		cert.RemoteServerID,
		sql.NullString{String: cert.Message, Valid: cert.Message != ""},
		cert.DNSProviderID,
		cert.DeployTarget,
		sql.NullString{String: cert.DeployCertPath, Valid: cert.DeployCertPath != ""},
		sql.NullString{String: cert.DeployKeyPath, Valid: cert.DeployKeyPath != ""},
		autoDeploy,
		cert.ID,
	)
	if err != nil {
		return fmt.Errorf("update certificate: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if rows == 0 {
		return ErrCertificateNotFound
	}

	return nil
}

// 仅更新证书的状态和消息。
func (r *TrafficRepository) UpdateCertificateStatus(ctx context.Context, id int64, status, message string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	result, err := r.db.ExecContext(ctx, `
		UPDATE certificates SET status = ?, message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
	`, status, sql.NullString{String: message, Valid: message != ""}, id)
	if err != nil {
		return fmt.Errorf("update certificate status: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if rows == 0 {
		return ErrCertificateNotFound
	}

	return nil
}

func (r *TrafficRepository) AppendCertificateLog(ctx context.Context, id int64, line string) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}
	ts := time.Now().Format("15:04:05")
	entry := "[" + ts + "] " + line + "\n"
	_, err := r.db.ExecContext(ctx, `
		UPDATE certificates SET message = COALESCE(message, '') || ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
	`, entry, id)
	return err
}

// 成功颁发后更新证书。
func (r *TrafficRepository) UpdateCertificateIssued(ctx context.Context, id int64, certPath, keyPath, certPEM, keyPEM string, issueDate, expiryDate time.Time) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	result, err := r.db.ExecContext(ctx, `
		UPDATE certificates SET
		    cert_path = ?,
		    key_path = ?,
		    cert_pem = ?,
		    key_pem = ?,
		    status = ?,
		    issue_date = ?,
		    expiry_date = ?,
		    message = NULL,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, certPath, keyPath, certPEM, keyPEM, CertStatusValid, issueDate, expiryDate, id)
	if err != nil {
		return fmt.Errorf("update certificate issued: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if rows == 0 {
		return ErrCertificateNotFound
	}

	return nil
}

// 设置证书的 auto_renew 标志。
func (r *TrafficRepository) SetCertificateAutoRenew(ctx context.Context, id int64, autoRenew bool) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	val := 0
	if autoRenew {
		val = 1
	}

	result, err := r.db.ExecContext(ctx, `
		UPDATE certificates SET auto_renew = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
	`, val, id)
	if err != nil {
		return fmt.Errorf("set certificate auto_renew: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if rows == 0 {
		return ErrCertificateNotFound
	}

	return nil
}

// 更新证书的 auto_deploy 标志。
func (r *TrafficRepository) SetCertificateAutoDeploy(ctx context.Context, id int64, autoDeploy bool) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	val := 0
	if autoDeploy {
		val = 1
	}

	result, err := r.db.ExecContext(ctx, `
		UPDATE certificates SET auto_deploy = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
	`, val, id)
	if err != nil {
		return fmt.Errorf("set certificate auto_deploy: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if rows == 0 {
		return ErrCertificateNotFound
	}

	return nil
}

// 返回启用了 auto_deploy 的所有有效证书。
func (r *TrafficRepository) ListAutoDeployCertificates(ctx context.Context) ([]Certificate, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, domain, email, provider, cert_path, key_path, cert_pem, key_pem,
		       status, expiry_date, issue_date, auto_renew, challenge_mode, webroot_path,
		       remote_server_id, message, dns_provider_id, deploy_target, deploy_cert_path, deploy_key_path, auto_deploy,
		       created_at, updated_at
		FROM certificates
		WHERE auto_deploy = 1 AND status = 'valid' AND cert_pem != '' AND key_pem != ''
		      AND deploy_cert_path != '' AND deploy_key_path != ''
		ORDER BY id
	`)
	if err != nil {
		return nil, fmt.Errorf("list auto_deploy certificates: %w", err)
	}
	defer rows.Close()

	var certs []Certificate
	for rows.Next() {
		cert, err := scanCertificate(rows)
		if err != nil {
			return nil, fmt.Errorf("scan certificate: %w", err)
		}
		certs = append(certs, cert)
	}
	return certs, rows.Err()
}

// 按 ID 删除证书。
func (r *TrafficRepository) DeleteCertificate(ctx context.Context, id int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}

	result, err := r.db.ExecContext(ctx, `DELETE FROM certificates WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete certificate: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if rows == 0 {
		return ErrCertificateNotFound
	}

	return nil
}

// 返回在指定天内过期并启用 auto_renew 的证书。
func (r *TrafficRepository) ListExpiringCertificates(ctx context.Context, days int) ([]Certificate, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	if days <= 0 {
		days = 30
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, domain, email, provider, cert_path, key_path, cert_pem, key_pem,
		       status, expiry_date, issue_date, auto_renew, challenge_mode, webroot_path,
		       remote_server_id, message, dns_provider_id, deploy_target, deploy_cert_path, deploy_key_path, auto_deploy,
		       created_at, updated_at
		FROM certificates
		WHERE auto_renew = 1
		  AND status = 'valid'
		  AND expiry_date IS NOT NULL
		  AND expiry_date <= datetime('now', '+' || ? || ' days')
		ORDER BY expiry_date ASC
	`, days)
	if err != nil {
		return nil, fmt.Errorf("list expiring certificates: %w", err)
	}
	defer rows.Close()

	var certs []Certificate
	for rows.Next() {
		cert, err := scanCertificate(rows)
		if err != nil {
			return nil, fmt.Errorf("scan certificate: %w", err)
		}
		certs = append(certs, cert)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate certificates: %w", err)
	}

	return certs, nil
}

// 返回所有有效证书（用于入站向导选择）。
func (r *TrafficRepository) ListValidCertificates(ctx context.Context) ([]Certificate, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, domain, email, provider, cert_path, key_path, cert_pem, key_pem,
		       status, expiry_date, issue_date, auto_renew, challenge_mode, webroot_path,
		       remote_server_id, message, dns_provider_id, deploy_target, deploy_cert_path, deploy_key_path, auto_deploy,
		       created_at, updated_at
		FROM certificates
		WHERE status = 'valid'
		ORDER BY domain ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list valid certificates: %w", err)
	}
	defer rows.Close()

	var certs []Certificate
	for rows.Next() {
		cert, err := scanCertificate(rows)
		if err != nil {
			return nil, fmt.Errorf("scan certificate: %w", err)
		}
		certs = append(certs, cert)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate certificates: %w", err)
	}

	return certs, nil
}

// --- DNS 提供商 CRUD ---

// 返回所有 DNS 提供商。
func (r *TrafficRepository) ListDNSProviders(ctx context.Context) ([]DNSProvider, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}
	rows, err := r.db.QueryContext(ctx, `SELECT id, name, provider_type, credentials, created_at, updated_at FROM dns_providers ORDER BY id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list dns_providers: %w", err)
	}
	defer rows.Close()

	var providers []DNSProvider
	for rows.Next() {
		var p DNSProvider
		if err := rows.Scan(&p.ID, &p.Name, &p.ProviderType, &p.Credentials, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan dns_provider: %w", err)
		}
		providers = append(providers, p)
	}
	return providers, rows.Err()
}

// 按 ID 返回 DNS 提供商。
func (r *TrafficRepository) GetDNSProvider(ctx context.Context, id int64) (*DNSProvider, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("traffic repository not initialized")
	}
	var p DNSProvider
	err := r.db.QueryRowContext(ctx, `SELECT id, name, provider_type, credentials, created_at, updated_at FROM dns_providers WHERE id = ?`, id).
		Scan(&p.ID, &p.Name, &p.ProviderType, &p.Credentials, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get dns_provider: %w", err)
	}
	return &p, nil
}

// 创建一个新的 DNS 提供商。
func (r *TrafficRepository) CreateDNSProvider(ctx context.Context, p *DNSProvider) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}
	result, err := r.db.ExecContext(ctx, `INSERT INTO dns_providers (name, provider_type, credentials) VALUES (?, ?, ?)`,
		p.Name, p.ProviderType, p.Credentials)
	if err != nil {
		return fmt.Errorf("create dns_provider: %w", err)
	}
	id, _ := result.LastInsertId()
	p.ID = id
	return nil
}

// 更新 DNS 提供商。
func (r *TrafficRepository) UpdateDNSProvider(ctx context.Context, p *DNSProvider) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}
	result, err := r.db.ExecContext(ctx, `UPDATE dns_providers SET name = ?, provider_type = ?, credentials = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		p.Name, p.ProviderType, p.Credentials, p.ID)
	if err != nil {
		return fmt.Errorf("update dns_provider: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return errors.New("dns provider not found")
	}
	return nil
}

// 按 ID 删除 DNS 提供商。
func (r *TrafficRepository) DeleteDNSProvider(ctx context.Context, id int64) error {
	if r == nil || r.db == nil {
		return errors.New("traffic repository not initialized")
	}
	result, err := r.db.ExecContext(ctx, `DELETE FROM dns_providers WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete dns_provider: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return errors.New("dns provider not found")
	}
	return nil
}

func (r *TrafficRepository) CreateNodeTrafficSnapshots(ctx context.Context, serverID int64, date string) error {
	const stmt = `
INSERT INTO node_traffic_snapshots (server_id, tag, date, uplink, downlink)
SELECT server_id, tag, ?, uplink, downlink FROM node_traffic WHERE server_id = ?
ON CONFLICT(server_id, tag, date) DO UPDATE SET uplink=excluded.uplink, downlink=excluded.downlink`
	_, err := r.db.ExecContext(ctx, stmt, date, serverID)
	return err
}

func (r *TrafficRepository) CreateUserTrafficSnapshots(ctx context.Context, serverID int64, date string) error {
	const stmt = `
INSERT INTO user_traffic_snapshots (server_id, username, date, uplink, downlink)
SELECT server_id, username, ?, uplink, downlink FROM user_traffic WHERE server_id = ?
ON CONFLICT(server_id, username, date) DO UPDATE SET uplink=excluded.uplink, downlink=excluded.downlink`
	_, err := r.db.ExecContext(ctx, stmt, date, serverID)
	return err
}

func (r *TrafficRepository) GetNodeTrafficSnapshots(ctx context.Context, date string) ([]NodeTrafficSnapshot, error) {
	const query = `SELECT id, server_id, tag, date, uplink, downlink FROM node_traffic_snapshots WHERE date = ?`
	rows, err := r.db.QueryContext(ctx, query, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []NodeTrafficSnapshot
	for rows.Next() {
		var s NodeTrafficSnapshot
		if err := rows.Scan(&s.ID, &s.ServerID, &s.Tag, &s.Date, &s.Uplink, &s.Downlink); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func (r *TrafficRepository) GetUserTrafficSnapshots(ctx context.Context, date string) ([]UserTrafficSnapshot, error) {
	const query = `SELECT id, server_id, username, date, uplink, downlink FROM user_traffic_snapshots WHERE date = ?`
	rows, err := r.db.QueryContext(ctx, query, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []UserTrafficSnapshot
	for rows.Next() {
		var s UserTrafficSnapshot
		if err := rows.Scan(&s.ID, &s.ServerID, &s.Username, &s.Date, &s.Uplink, &s.Downlink); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func (r *TrafficRepository) IsTrafficThresholdNotified(ctx context.Context, serverID int64) (bool, error) {
	var count int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM traffic_threshold_notified WHERE server_id = ?`, serverID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *TrafficRepository) MarkTrafficThresholdNotified(ctx context.Context, serverID int64) error {
	_, err := r.db.ExecContext(ctx, `INSERT OR REPLACE INTO traffic_threshold_notified (server_id, notified_at) VALUES (?, CURRENT_TIMESTAMP)`, serverID)
	return err
}

func (r *TrafficRepository) ClearTrafficThresholdNotified(ctx context.Context, serverID int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM traffic_threshold_notified WHERE server_id = ?`, serverID)
	return err
}

func (r *TrafficRepository) SetUserTOTPSecret(ctx context.Context, username, secret string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET totp_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, secret, username)
	return err
}

func (r *TrafficRepository) EnableUserTOTP(ctx context.Context, username, recoveryCodes string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET totp_enabled = 1, recovery_codes = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`, recoveryCodes, username)
	return err
}

func (r *TrafficRepository) DisableUserTOTP(ctx context.Context, username string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET totp_enabled = 0, totp_secret = '', recovery_codes = '[]', updated_at = CURRENT_TIMESTAMP WHERE username = ?`, username)
	return err
}

// OverrideScript CRUD

func (r *TrafficRepository) ListOverrideScripts(ctx context.Context, username string, hook string) ([]OverrideScript, error) {
	query := `SELECT id, username, name, hook, content, enabled, sort_order, created_at, updated_at
		FROM override_scripts WHERE username = ?`
	args := []interface{}{username}

	if hook != "" {
		query += " AND hook = ?"
		args = append(args, hook)
	}
	query += " ORDER BY sort_order ASC, id ASC"

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var scripts []OverrideScript
	for rows.Next() {
		var s OverrideScript
		if err := rows.Scan(&s.ID, &s.Username, &s.Name, &s.Hook, &s.Content, &s.Enabled, &s.SortOrder, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		scripts = append(scripts, s)
	}
	return scripts, rows.Err()
}

func (r *TrafficRepository) GetOverrideScript(ctx context.Context, id int64, username string) (*OverrideScript, error) {
	var s OverrideScript
	err := r.db.QueryRowContext(ctx,
		`SELECT id, username, name, hook, content, enabled, sort_order, created_at, updated_at
		FROM override_scripts WHERE id = ? AND username = ?`, id, username).Scan(
		&s.ID, &s.Username, &s.Name, &s.Hook, &s.Content, &s.Enabled, &s.SortOrder, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *TrafficRepository) CreateOverrideScript(ctx context.Context, s *OverrideScript) (int64, error) {
	result, err := r.db.ExecContext(ctx,
		`INSERT INTO override_scripts (username, name, hook, content, enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
		s.Username, s.Name, s.Hook, s.Content, s.Enabled, s.SortOrder)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (r *TrafficRepository) UpdateOverrideScript(ctx context.Context, s *OverrideScript) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE override_scripts SET name = ?, hook = ?, content = ?, enabled = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND username = ?`,
		s.Name, s.Hook, s.Content, s.Enabled, s.SortOrder, s.ID, s.Username)
	return err
}

func (r *TrafficRepository) DeleteOverrideScript(ctx context.Context, id int64, username string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM override_scripts WHERE id = ? AND username = ?`, id, username)
	return err
}
