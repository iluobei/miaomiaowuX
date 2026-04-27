package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"miaomiaowu/internal/agentlog"
	"miaomiaowu/internal/auth"
	"miaomiaowu/internal/child"
	"miaomiaowu/internal/event"
	"miaomiaowu/internal/handler"
	"miaomiaowu/internal/logger"
	"miaomiaowu/internal/proxygroups"
	"miaomiaowu/internal/storage"
	"miaomiaowu/internal/traffic"
	"miaomiaowu/internal/version"
	"miaomiaowu/internal/web"
	ruletemplates "miaomiaowu/rule_templates"
	"miaomiaowu/subscribes"

	"gopkg.in/yaml.v3"
)

// ServerConfig表示配置文件结构
type ServerConfig struct {
	Mode           string `yaml:"mode"`            // "主控"或"远程"
	MasterServer   string `yaml:"master_server"`   // 主服务器 URL（用于远程模式）
	RemoteToken    string `yaml:"remote_token"`    // 用于远程服务器身份验证的令牌
	ConnectionMode string `yaml:"connection_mode"` // "websocket"、"http"、"pull"、"auto"
	Port           string `yaml:"port"`            // 服务器端口
	ChildAPIToken  string `yaml:"child_api_token"` // 用于子 API 身份验证的令牌
}

// 从 YAML 文件加载配置
func loadConfig(path string) (*ServerConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var config ServerConfig
	if err := yaml.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	return &config, nil
}

func main() {
	// 初始化logger
	logger.Init()
	logger.Info("喵喵屋服务器启动中", "version", version.Version)

	// 启动日志清理任务（每天凌晨3点清理7天前的日志）
	go startLogCleanup()

	// 解析命令行标志
	configPath := flag.String("c", "", "Path to configuration file")
	flag.Parse()

	// 从文件加载配置（如果指定）
	var config *ServerConfig
	if *configPath != "" {
		var err error
		config, err = loadConfig(*configPath)
		if err != nil {
			log.Fatalf("Failed to load config file: %v", err)
		}
		log.Printf("Loaded configuration from %s", *configPath)
	}

	addr := getAddr(config)

	repo, err := storage.NewTrafficRepository(filepath.Join("data", "mmwx.db"))
	if err != nil {
		logger.Error("流量数据库初始化失败", "error", err)
		os.Exit(1)
	}
	defer repo.Close()

	authManager, err := auth.NewManager(repo)
	if err != nil {
		logger.Error("认证管理器加载失败", "error", err)
		os.Exit(1)
	}

	tokenStore := auth.NewTokenStore(24 * time.Hour)
	if jwtSecret := os.Getenv("JWT_SECRET"); jwtSecret != "" {
		tokenStore.SetSecret(jwtSecret)
		logger.Info("JWT_SECRET 已配置，会话令牌将使用 HMAC 签名")
	}

	// 从数据库加载持久会话
	ctx := context.Background()
	sessions, err := repo.LoadSessions(ctx)
	if err != nil {
		logger.Warn("从数据库加载会话失败", "error", err)
	} else {
		for _, session := range sessions {
			tokenStore.LoadSession(session.Token, session.Username, session.ExpiresAt)
		}
		logger.Info("会话加载完成", "count", len(sessions))
	}

	// 从数据库中清理过期会话
	if err := repo.CleanupExpiredSessions(ctx); err != nil {
		logger.Warn("清理过期会话失败", "error", err)
	}

	subscribeDir := filepath.Join("subscribes")
	if err := subscribes.Ensure(subscribeDir); err != nil {
		logger.Error("订阅文件准备失败", "error", err)
		os.Exit(1)
	}

	ruleTemplatesDir := filepath.Join("rule_templates")
	if err := ruletemplates.Ensure(ruleTemplatesDir); err != nil {
		logger.Error("规则模板文件准备失败", "error", err)
		os.Exit(1)
	}

	// 初始化代理组配置 Store（纯内存存储）
	// 优先从系统配置的远程地址拉取，失败时使用空配置
	var proxyGroupsStore *proxygroups.Store

	// 获取系统配置中的远程地址
	systemConfig, err := repo.GetSystemConfig(ctx)
	if err != nil {
		logger.Warn("加载系统配置失败", "error", err)
	}

	agentlog.SetEnabled(systemConfig.AgentLogEnabled)

	// 从远程拉取配置
	data, resolvedURL, fetchErr := proxygroups.FetchConfig(systemConfig.ProxyGroupsSourceURL)
	if fetchErr != nil {
		logger.Warn("拉取代理组配置失败", "error", fetchErr)
		// 远程拉取失败时使用空配置初始化
		proxyGroupsStore, err = proxygroups.NewStore([]byte("[]"), "empty-fallback")
		if err != nil {
			logger.Error("创建代理组存储失败", "error", err)
			os.Exit(1)
		}
		logger.Info("代理组存储已使用空配置初始化", "reason", "远程拉取失败")
	} else {
		// 远程拉取成功
		proxyGroupsStore, err = proxygroups.NewStore(data, resolvedURL)
		if err != nil {
			logger.Error("代理组配置无效", "source", resolvedURL, "error", err)
			os.Exit(1)
		}
		logger.Info("代理组配置加载成功", "source", resolvedURL)
	}

	syncSubscribeFilesToDatabase(repo, subscribeDir)

	// 启动时初始化代理集合缓存
	go handler.InitProxyProviderCacheOnStartup(repo)

	// 启动代理集合定时同步器
	proxySyncCtx, stopProxySync := context.WithCancel(context.Background())
	go handler.StartProxyProviderCacheSync(proxySyncCtx, repo)

	trafficHandler := handler.NewTrafficSummaryHandler(repo)
	packageSubscribeHandler := handler.NewPackageSubscribeHandler(repo)
	userRepo := auth.NewRepositoryAdapter(repo)

	mux := http.NewServeMux()
	mux.Handle("/api/setup/status", handler.NewSetupStatusHandler(repo))
	mux.Handle("/api/setup/init", handler.NewInitialSetupHandler(repo))
	mux.Handle("/api/setup/verify-domain", handler.NewVerifyDomainHandler())
	mux.Handle("/api/setup/restore-backup", handler.NewSetupRestoreBackupHandler(repo))
	loginRateLimiter := handler.NewLoginRateLimiter()
	mux.Handle("/api/login", handler.NewLoginHandler(authManager, tokenStore, repo, loginRateLimiter))

	// 仅限管理端点
	mux.Handle("/api/admin/credentials", auth.RequireAdmin(tokenStore, userRepo, handler.NewCredentialsHandler(authManager, tokenStore)))
	mux.Handle("/api/admin/users", auth.RequireAdmin(tokenStore, userRepo, handler.NewUserListHandler(repo)))
	mux.Handle("/api/admin/users/create", auth.RequireAdmin(tokenStore, userRepo, handler.NewUserCreateHandler(repo)))
	mux.Handle("/api/admin/users/delete", auth.RequireAdmin(tokenStore, userRepo, handler.NewUserDeleteHandler(repo)))
	mux.Handle("/api/admin/users/status", auth.RequireAdmin(tokenStore, userRepo, handler.NewUserStatusHandler(repo)))
	mux.Handle("/api/admin/users/reset-password", auth.RequireAdmin(tokenStore, userRepo, handler.NewUserResetPasswordHandler(repo)))
	mux.Handle("/api/admin/users/remark", auth.RequireAdmin(tokenStore, userRepo, handler.NewUserRemarkHandler(repo)))
	mux.Handle("/api/admin/users/update-email", auth.RequireAdmin(tokenStore, userRepo, handler.NewUserUpdateEmailHandler(repo)))
	mux.Handle("/api/admin/users/", auth.RequireAdmin(tokenStore, userRepo, handler.NewUserSubscriptionsHandler(repo)))
	mux.Handle("/api/admin/subscriptions", auth.RequireAdmin(tokenStore, userRepo, handler.NewSubscriptionAdminHandler(subscribeDir, repo)))
	mux.Handle("/api/admin/subscriptions/", auth.RequireAdmin(tokenStore, userRepo, handler.NewSubscriptionAdminHandler(subscribeDir, repo)))
	mux.Handle("/api/admin/subscribe-files", auth.RequireAdmin(tokenStore, userRepo, handler.NewSubscribeFilesHandler(repo)))
	mux.Handle("/api/admin/subscribe-files/", auth.RequireAdmin(tokenStore, userRepo, handler.NewSubscribeFilesHandler(repo)))
	mux.Handle("/api/admin/rules/", auth.RequireAdmin(tokenStore, userRepo, http.StripPrefix("/api/admin/rules/", handler.NewRuleEditorHandler(subscribeDir, repo))))
	mux.Handle("/api/admin/rule-templates", auth.RequireAdmin(tokenStore, userRepo, handler.NewRuleTemplatesHandler()))
	mux.Handle("/api/admin/rule-templates/", auth.RequireAdmin(tokenStore, userRepo, handler.NewRuleTemplatesHandler()))
	// 在remoteManageHandler之后注册的节点处理程序（见下文）
	mux.Handle("/api/admin/sync-external-subscriptions", auth.RequireAdmin(tokenStore, userRepo, handler.NewSyncExternalSubscriptionsHandler(repo, subscribeDir)))
	mux.Handle("/api/admin/sync-external-subscription", auth.RequireAdmin(tokenStore, userRepo, handler.NewSyncSingleExternalSubscriptionHandler(repo, subscribeDir)))
	mux.Handle("/api/admin/rules/latest", auth.RequireAdmin(tokenStore, userRepo, handler.NewRuleMetadataHandler(subscribeDir, repo)))
	mux.Handle("/api/admin/custom-rules", auth.RequireAdmin(tokenStore, userRepo, handler.NewCustomRulesHandler(repo)))
	mux.Handle("/api/admin/custom-rules/", auth.RequireAdmin(tokenStore, userRepo, handler.NewCustomRuleHandler(repo)))
	mux.Handle("/api/admin/apply-custom-rules", auth.RequireAdmin(tokenStore, userRepo, handler.NewApplyCustomRulesHandler(repo)))
	mux.Handle("/api/admin/templates", auth.RequireAdmin(tokenStore, userRepo, handler.NewTemplatesHandler(repo)))
	mux.Handle("/api/admin/templates/", auth.RequireAdmin(tokenStore, userRepo, handler.NewTemplateHandler(repo)))
	mux.Handle("/api/admin/templates/convert", auth.RequireAdmin(tokenStore, userRepo, handler.NewTemplateConvertHandler()))
	mux.Handle("/api/admin/templates/fetch-source", auth.RequireAdmin(tokenStore, userRepo, handler.NewTemplateFetchSourceHandler()))
	mux.Handle("/api/admin/backup/download", auth.RequireAdmin(tokenStore, userRepo, handler.NewBackupDownloadHandler(repo)))
	mux.Handle("/api/admin/backup/restore", auth.RequireAdmin(tokenStore, userRepo, handler.NewBackupRestoreHandler(repo)))
	mux.Handle("/api/admin/update/check", auth.RequireAdmin(tokenStore, userRepo, handler.NewUpdateCheckHandler()))
	mux.Handle("/api/admin/update/apply", auth.RequireAdmin(tokenStore, userRepo, handler.NewUpdateApplyHandler()))
	mux.Handle("/api/admin/update/apply-sse", auth.RequireAdmin(tokenStore, userRepo, handler.NewUpdateApplySSEHandler()))
	mux.Handle("/api/admin/proxy-groups/sync", auth.RequireAdmin(tokenStore, userRepo, handler.NewProxyGroupsSyncHandler(repo, proxyGroupsStore)))

	// Template V3 端点（仅限管理员）
	templateV3Handler := handler.NewTemplateV3Handler(repo)
	mux.Handle("/api/admin/template-v3", auth.RequireAdmin(tokenStore, userRepo, templateV3Handler))
	mux.Handle("/api/admin/template-v3/", auth.RequireAdmin(tokenStore, userRepo, templateV3Handler))

	// 包管理端点（仅限管理员）
	mux.Handle("/api/admin/packages", auth.RequireAdmin(tokenStore, userRepo, handler.NewPackageListHandler(repo)))
	mux.Handle("/api/admin/packages/create", auth.RequireAdmin(tokenStore, userRepo, handler.NewPackageCreateHandler(repo)))
	mux.Handle("/api/admin/packages/update", auth.RequireAdmin(tokenStore, userRepo, handler.NewPackageUpdateHandler(repo)))
	mux.Handle("/api/admin/packages/", auth.RequireAdmin(tokenStore, userRepo, handler.NewPackageDeleteHandler(repo)))

	// 用户端点（所有经过身份验证的用户）
	mux.Handle("/api/proxy-groups", auth.RequireToken(tokenStore, userRepo, handler.NewProxyGroupsHandler(proxyGroupsStore)))
	mux.Handle("/api/user/password", auth.RequireToken(tokenStore, userRepo, handler.NewPasswordHandler(authManager)))
	mux.Handle("/api/user/profile", auth.RequireToken(tokenStore, userRepo, handler.NewProfileHandler(repo)))
	mux.Handle("/api/user/settings", auth.RequireToken(tokenStore, userRepo, handler.NewUserSettingsHandler(repo, tokenStore)))
	mux.Handle("/api/user/config", auth.RequireToken(tokenStore, userRepo, handler.NewUserConfigHandler(repo)))
	mux.Handle("/api/user/token", auth.RequireToken(tokenStore, userRepo, handler.NewUserTokenHandler(repo)))
	mux.Handle("/api/user/external-subscriptions", auth.RequireToken(tokenStore, userRepo, handler.NewExternalSubscriptionsHandler(repo)))
	mux.Handle("/api/user/external-subscriptions/nodes", auth.RequireToken(tokenStore, userRepo, handler.NewExternalSubscriptionNodesHandler(repo)))
	mux.Handle("/api/user/external-subscriptions/check-filter", auth.RequireToken(tokenStore, userRepo, handler.NewExternalSubscriptionCheckFilterHandler(repo)))
	mux.Handle("/api/user/proxy-provider-configs", auth.RequireToken(tokenStore, userRepo, handler.NewProxyProviderConfigsHandler(repo)))
	mux.Handle("/api/user/proxy-provider-cache/refresh", auth.RequireToken(tokenStore, userRepo, handler.NewProxyProviderCacheRefreshHandler(repo)))
	mux.Handle("/api/user/proxy-provider-cache/status", auth.RequireToken(tokenStore, userRepo, handler.NewProxyProviderCacheStatusHandler(repo)))
	mux.Handle("/api/user/proxy-provider-nodes", auth.RequireToken(tokenStore, userRepo, handler.NewProxyProviderNodesHandler(repo)))
	mux.Handle("/api/proxy-provider/", handler.NewProxyProviderServeHandler(repo))

	// Debug日志相关endpoint
	mux.Handle("/api/user/debug/", auth.RequireToken(tokenStore, userRepo, handler.NewDebugHandler(repo)))

	mux.Handle("/api/traffic/summary", auth.RequireToken(tokenStore, userRepo, trafficHandler))
	mux.Handle("/api/traffic/summary/aggregated", auth.RequireToken(tokenStore, userRepo, trafficHandler))
	mux.Handle("/api/subscriptions", auth.RequireToken(tokenStore, userRepo, handler.NewSubscriptionListHandler(repo)))
	mux.Handle("/api/user/package-subscribe", auth.RequireToken(tokenStore, userRepo, packageSubscribeHandler))
	mux.Handle("/api/dns/resolve", auth.RequireToken(tokenStore, userRepo, handler.NewDNSHandler()))
	mux.Handle("/api/subscribe-files", auth.RequireToken(tokenStore, userRepo, handler.NewSubscribeFilesListHandler(repo)))
	mux.Handle("/api/clash/subscribe", handler.NewSubscriptionEndpoint(tokenStore, repo, subscribeDir))

	// Xray 管理端点（经过身份验证的用户）
	xrayHandler := handler.NewXrayHandler(repo)
	mux.Handle("/api/xray/outbound/add", auth.RequireToken(tokenStore, userRepo, http.HandlerFunc(xrayHandler.AddOutbound)))
	mux.Handle("/api/xray/outbound/remove", auth.RequireToken(tokenStore, userRepo, http.HandlerFunc(xrayHandler.RemoveOutbound)))
	mux.Handle("/api/xray/outbound/list", auth.RequireToken(tokenStore, userRepo, http.HandlerFunc(xrayHandler.ListOutbounds)))
	mux.Handle("/api/xray/stats", auth.RequireToken(tokenStore, userRepo, http.HandlerFunc(xrayHandler.GetStats)))
	mux.Handle("/api/xray/stats/system", auth.RequireToken(tokenStore, userRepo, http.HandlerFunc(xrayHandler.GetSystemStats)))

	// 流量收集器（早期创建，以便可以与处理程序共享）
	trafficCollector := traffic.NewCollector(repo)
	if systemConfig.TrafficCollectInterval > 0 {
		trafficCollector.SetInterval(time.Duration(systemConfig.TrafficCollectInterval) * time.Second)
	}
	if systemConfig.SpeedCollectInterval > 0 {
		trafficCollector.SetSpeedInterval(time.Duration(systemConfig.SpeedCollectInterval) * time.Second)
	}

	// Xray 服务器处理程序（远程服务器管理复用）
	xrayServerHandler := handler.NewXrayServerHandler(repo, trafficCollector)

	// 远程服务器管理端点（仅限管理员）
	mux.Handle("/api/admin/remote-servers", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(xrayServerHandler.ListRemoteServers)))
	mux.Handle("/api/admin/remote-servers/create", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(xrayServerHandler.CreateRemoteServer)))
	mux.Handle("/api/admin/remote-servers/update", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(xrayServerHandler.UpdateRemoteServer)))
	mux.Handle("/api/admin/remote-servers/delete", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(xrayServerHandler.DeleteRemoteServer)))

	// 远程服务器公共端点（无管理员身份验证，基于令牌）
	mux.Handle("/api/remote/heartbeat", http.HandlerFunc(xrayServerHandler.RemoteHeartbeat))
	mux.Handle("/api/remote/token/refresh", http.HandlerFunc(xrayServerHandler.RefreshRemoteToken))
	mux.Handle("/api/remote/install.sh", http.HandlerFunc(xrayServerHandler.GetRemoteInstallScript))

	// 流量采集与统计
	trafficApiHandler := handler.NewTrafficHandler(repo, trafficCollector)
	remoteTrafficHandler := handler.NewRemoteTrafficHandler(repo, trafficCollector)
	mux.Handle("/api/admin/traffic", auth.RequireAdmin(tokenStore, userRepo, trafficApiHandler))
	mux.Handle("/api/admin/traffic/", auth.RequireAdmin(tokenStore, userRepo, trafficApiHandler))
	mux.Handle("/api/remote/traffic", remoteTrafficHandler)

	// 远程速度处理程序（来自子服务器的 HTTP 推送）
	remoteSpeedHandler := handler.NewRemoteSpeedHandler(repo)
	mux.Handle("/api/remote/speed", remoteSpeedHandler)

	// 远程服务器的 WebSocket 处理程序
	remoteWSHandler := handler.NewRemoteWSHandler(repo, trafficCollector)
	mux.Handle("/api/remote/ws", remoteWSHandler)

	// 远程服务器管理代理（将命令转发到子服务器）
	remoteManageHandler := handler.NewRemoteManageHandler(repo, remoteWSHandler)

	// 套餐绑定/解绑（需要remoteManageHandler操作远程入站）
	mux.Handle("/api/admin/packages/assign", auth.RequireAdmin(tokenStore, userRepo, handler.NewPackageAssignHandler(repo, remoteManageHandler)))
	mux.Handle("/api/admin/packages/unassign", auth.RequireAdmin(tokenStore, userRepo, handler.NewPackageUnassignHandler(repo, remoteManageHandler)))

	// 注册节点处理程序（需要remoteManageHandler进行远程入站清理）
	mux.Handle("/api/admin/nodes", auth.RequireAdmin(tokenStore, userRepo, handler.NewNodesHandler(repo, subscribeDir, remoteManageHandler)))
	mux.Handle("/api/admin/nodes/", auth.RequireAdmin(tokenStore, userRepo, handler.NewNodesHandler(repo, subscribeDir, remoteManageHandler)))

	// 初始化事件系统以进行入站同步
	eventBus := event.GetBus()
	nodeSyncListener := event.NewNodeSyncListener(repo, remoteManageHandler.InboundToClashProxyByServerID)
	eventBus.Subscribe(event.EventInboundAdded, nodeSyncListener)
	eventBus.Subscribe(event.EventInboundRemoved, nodeSyncListener)
	eventBus.Subscribe(event.EventInboundUpdated, nodeSyncListener)
	log.Println("[Event] Inbound event listeners registered")

	mux.Handle("/api/admin/remote/services/status", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleServicesStatus)))
	mux.Handle("/api/admin/remote/services/control", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleServiceControl)))
	mux.Handle("/api/admin/remote/xray/install", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleXrayInstall)))
	mux.Handle("/api/admin/remote/xray/remove", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleXrayRemove)))
	mux.Handle("/api/admin/remote/xray/config", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleXrayConfig)))
	mux.Handle("/api/admin/remote/xray/config/files", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleXrayConfigFiles)))
	mux.Handle("/api/admin/remote/nginx/install", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleNginxInstall)))
	mux.Handle("/api/admin/remote/nginx/remove", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleNginxRemove)))
	// SSE 流安装/删除
	mux.Handle("/api/admin/remote/xray/install-stream", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleXrayInstallStream)))
	mux.Handle("/api/admin/remote/xray/remove-stream", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleXrayRemoveStream)))
	mux.Handle("/api/admin/remote/nginx/install-stream", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleNginxInstallStream)))
	mux.Handle("/api/admin/remote/nginx/remove-stream", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleNginxRemoveStream)))
	mux.Handle("/api/admin/remote/nginx/config", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleNginxConfig)))
	mux.Handle("/api/admin/remote/nginx/config/files", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleNginxConfigFiles)))
	mux.Handle("/api/admin/remote/system/info", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleSystemInfo)))
	// 远程服务器Xray入站/出站/路由管理
	mux.Handle("/api/admin/remote/inbounds", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleInbounds)))
	mux.Handle("/api/admin/remote/outbounds", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleOutbounds)))
	mux.Handle("/api/admin/remote/routing", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleRouting)))
	mux.Handle("/api/admin/remote/scan", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleScan)))
	mux.Handle("/api/admin/remote/xray/system-config", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleXraySystemConfig)))
	mux.Handle("/api/admin/remote/reality-domains", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleRealityDomains)))
	mux.Handle("/api/admin/remote/setup-ssl", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleSetupSSL)))
	mux.Handle("/api/admin/remote/deploy-steal-self", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleDeployStealSelfConfig)))
	mux.Handle("/api/admin/remote/sync-nodes", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleSyncInboundsToNodes)))
	mux.Handle("/api/admin/remote/switch-steal-mode", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleSwitchStealMode)))
	// 令牌重置端点
	mux.Handle("/api/admin/remote-servers/reset-server-token", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleResetServerToken)))
	mux.Handle("/api/admin/remote-servers/reset-agent-token", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleResetAgentToken)))
	mux.Handle("/api/admin/remote-servers/reset-all-tokens", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(remoteManageHandler.HandleResetAllTokens)))

	// TCPing 端点
	mux.Handle("/api/admin/tcping", auth.RequireAdmin(tokenStore, userRepo, handler.NewTCPingHandler()))
	mux.Handle("/api/admin/tcping/batch", auth.RequireAdmin(tokenStore, userRepo, handler.NewTCPingBatchHandler()))

	// 子服务器模式配置
	// 确定我们是否处于儿童/远程模式：
	// 1. 配置文件设置了remote_token，或者
	// 2.环境变量MMWX_MODE=child
	var childClient *child.Client
	isChildMode := false
	var masterURL, masterToken, connectionMode, childAPIToken string

	// 首先检查配置文件
	if config != nil && config.RemoteToken != "" {
		isChildMode = true
		masterURL = config.MasterServer
		masterToken = config.RemoteToken
		connectionMode = config.ConnectionMode
		childAPIToken = config.ChildAPIToken
		log.Printf("[Child Mode] Detected from config file (remote_token present)")
	}

	// 环境变量可以覆盖或补充配置
	if os.Getenv("MMWX_MODE") == "child" {
		isChildMode = true
	}
	if envMasterURL := os.Getenv("MMWX_MASTER_URL"); envMasterURL != "" {
		masterURL = envMasterURL
	}
	if envMasterToken := os.Getenv("MMWX_MASTER_TOKEN"); envMasterToken != "" {
		masterToken = envMasterToken
	}
	if envConnectionMode := os.Getenv("MMWX_CONNECTION_MODE"); envConnectionMode != "" {
		connectionMode = envConnectionMode
	}
	if envChildAPIToken := os.Getenv("MMWX_CHILD_API_TOKEN"); envChildAPIToken != "" {
		childAPIToken = envChildAPIToken
	}

	// 默认连接模式 - 使用"auto"进行自动回退（websocket -> http -> pull）
	if connectionMode == "" {
		connectionMode = "auto"
	}

	if isChildMode {
		if masterURL != "" && masterToken != "" {
			childConfig := child.Config{
				MasterURL:             masterURL,
				Token:                 masterToken,
				ConnectionMode:        connectionMode,
				TrafficReportInterval: time.Duration(systemConfig.TrafficCollectInterval) * time.Second,
				SpeedReportInterval:   time.Duration(systemConfig.SpeedCollectInterval) * time.Second,
				HeartbeatInterval:     time.Duration(systemConfig.HeartbeatInterval) * time.Second,
			}
			childClient = child.NewClient(childConfig, trafficCollector, repo)
			log.Printf("[Child Mode] Configured: master=%s, mode=%s", masterURL, connectionMode)
		} else {
			log.Printf("[Child Mode] Warning: master_server or remote_token not set")
		}

		// 为pull模式注册子 API
		if childClient != nil {
			childAPIHandler := handler.NewChildAPIHandler(childClient, childAPIToken)
			mux.Handle("/api/child/traffic", childAPIHandler)
			mux.Handle("/api/child/speed", http.HandlerFunc(childAPIHandler.ServeSpeedHTTP))
			log.Printf("[Child Mode] Child API registered at /api/child/traffic and /api/child/speed")
		}

		// 注册子管理API（用于主机远程控制）
		childManageHandler := handler.NewChildManageHandler(masterToken)

		// 启动时检查并补全 Xray 配置
		go func() {
			// 延迟 2 秒，等待服务稳定
			time.Sleep(2 * time.Second)
			result := childManageHandler.EnsureXrayConfig()
			if result.Modified {
				log.Printf("[Child Mode] Xray config auto-completed: added %v", result.AddedSections)
				// 尝试重启 Xray 使配置生效
				cmd := exec.Command("systemctl", "restart", "xray")
				if err := cmd.Run(); err != nil {
					log.Printf("[Child Mode] Failed to restart xray: %v", err)
				} else {
					log.Printf("[Child Mode] Xray restarted after config update")
				}
			} else if result.Error != "" {
				log.Printf("[Child Mode] Xray config check: %s", result.Error)
			} else {
				log.Printf("[Child Mode] Xray config OK, no changes needed")
			}
		}()

		mux.Handle("/api/child/services/status", http.HandlerFunc(childManageHandler.HandleServicesStatus))
		mux.Handle("/api/child/services/control", http.HandlerFunc(childManageHandler.HandleServiceControl))
		mux.Handle("/api/child/xray/install", http.HandlerFunc(childManageHandler.HandleXrayInstall))
		mux.Handle("/api/child/xray/remove", http.HandlerFunc(childManageHandler.HandleXrayRemove))
		mux.Handle("/api/child/xray/config", http.HandlerFunc(childManageHandler.HandleXrayConfig))
		mux.Handle("/api/child/xray/config/files", http.HandlerFunc(childManageHandler.HandleXrayConfigFiles))
		mux.Handle("/api/child/xray/system-config", http.HandlerFunc(childManageHandler.HandleXraySystemConfig))
		mux.Handle("/api/child/nginx/install", http.HandlerFunc(childManageHandler.HandleNginxInstall))
		mux.Handle("/api/child/nginx/remove", http.HandlerFunc(childManageHandler.HandleNginxRemove))
		mux.Handle("/api/child/nginx/config", http.HandlerFunc(childManageHandler.HandleNginxConfig))
		mux.Handle("/api/child/nginx/config/files", http.HandlerFunc(childManageHandler.HandleNginxConfigFiles))
		mux.Handle("/api/child/system/info", http.HandlerFunc(childManageHandler.HandleSystemInfo))
		// X射线入站/出站/路由管理
		mux.Handle("/api/child/inbounds", http.HandlerFunc(childManageHandler.HandleInbounds))
		mux.Handle("/api/child/outbounds", http.HandlerFunc(childManageHandler.HandleOutbounds))
		mux.Handle("/api/child/routing", http.HandlerFunc(childManageHandler.HandleRouting))
		mux.Handle("/api/child/scan", http.HandlerFunc(childManageHandler.HandleScan))
		mux.Handle("/api/child/domains/latency", http.HandlerFunc(childManageHandler.HandleDomainLatencyProbe))
		log.Printf("[Child Mode] Management API registered at /api/child/*")
	}

	// Xray 示例 API（仅限管理员）
	xrayExamplesHandler := handler.NewXrayExamplesHandler("Xray-examples")
	mux.Handle("/api/admin/xray-examples", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(xrayExamplesHandler.HandleGetProtocolCombinations)))

	// Xray 密钥生成 API（仅限管理员）
	xrayKeyGenHandler := handler.NewXrayKeyGeneratorHandler()
	mux.Handle("/api/admin/xray/generate-keys", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(xrayKeyGenHandler.GenerateKeys)))
	mux.Handle("/api/admin/xray/generate-x25519", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(xrayKeyGenHandler.GenerateX25519)))

	// 系统设置 API（仅限管理员）
	systemSettingsHandler := handler.NewSystemSettingsHandler(repo)
	mux.Handle("/api/admin/system-settings/api-token", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(systemSettingsHandler.GetAPIToken)))
	mux.Handle("/api/admin/system-settings/api-token/regenerate", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(systemSettingsHandler.RegenerateAPIToken)))
	mux.Handle("/api/admin/system-settings/master-url", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			systemSettingsHandler.GetMasterURL(w, r)
		case http.MethodPut:
			systemSettingsHandler.SetMasterURL(w, r)
		default:
			http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		}
	})))
	mux.Handle("/api/admin/system-settings/short-link", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			systemSettingsHandler.GetShortLinkEnabled(w, r)
		case http.MethodPut:
			systemSettingsHandler.SetShortLinkEnabled(w, r)
		default:
			http.Error(w, "��法不允许", http.StatusMethodNotAllowed)
		}
	})))
	mux.Handle("/api/admin/system-settings/intervals", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			systemSettingsHandler.GetIntervals(w, r)
		case http.MethodPut:
			systemSettingsHandler.SetIntervals(w, r)
		default:
			http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		}
	})))
	mux.Handle("/api/admin/system-settings/agent-log", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			systemSettingsHandler.GetAgentLogEnabled(w, r)
		case http.MethodPut:
			systemSettingsHandler.SetAgentLogEnabled(w, r)
		default:
			http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		}
	})))

	// 证书管理 API（仅限管理员）
	certHandler := handler.NewCertificateHandler(repo, remoteWSHandler)
	remoteManageHandler.SetCertificateHandler(certHandler)
	remoteWSHandler.SetScanResultHandler(remoteManageHandler.HandleScanResult)
	remoteWSHandler.SetStealSelfDeployer(remoteManageHandler.DeployStealSelfConfig)
	mux.Handle("/api/admin/certificates", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(certHandler.ListCertificates)))
	mux.Handle("/api/admin/certificates/valid", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(certHandler.ListValidCertificates)))
	mux.Handle("/api/admin/certificates/create", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(certHandler.CreateCertificate)))
	mux.Handle("/api/admin/certificates/renew", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(certHandler.RenewCertificate)))
	mux.Handle("/api/admin/certificates/auto-renew", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(certHandler.SetAutoRenew)))
	mux.Handle("/api/admin/certificates/auto-deploy", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(certHandler.SetAutoDeploy)))
	mux.Handle("/api/admin/certificates/deploy", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(certHandler.DeployCertificate)))
	mux.Handle("/api/admin/certificates/delete", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(certHandler.DeleteCertificate)))
	mux.Handle("/api/admin/certificates/", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(certHandler.GetCertificate)))

	// DNS 提供商管理 API（仅限管理员）
	mux.Handle("/api/admin/dns-providers", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(certHandler.ListDNSProviders)))
	mux.Handle("/api/admin/dns-providers/create", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(certHandler.CreateDNSProvider)))
	mux.Handle("/api/admin/dns-providers/", auth.RequireAdmin(tokenStore, userRepo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPut:
			certHandler.UpdateDNSProvider(w, r)
		case http.MethodDelete:
			certHandler.DeleteDNSProvider(w, r)
		default:
			http.NotFound(w, r)
		}
	})))

	// 创建订阅处理程序（在端点和短链接之间共享）
	subscriptionHandler := handler.NewSubscriptionHandlerConcrete(repo, subscribeDir)

	// 短链接重置端点（已验证）
	mux.Handle("/api/user/short-link", auth.RequireToken(tokenStore, userRepo, handler.NewShortLinkResetHandler(repo)))
	mux.Handle("/api/user/custom-short-code", auth.RequireToken(tokenStore, userRepo, handler.NewUserCustomShortCodeSelfHandler(repo)))

	// 临时订阅端点
	mux.Handle("/api/admin/temp-subscription", auth.RequireAdmin(tokenStore, userRepo, handler.NewTempSubscriptionHandler()))
	tempSubAccessHandler := handler.NewTempSubscriptionAccessHandler()

	// 短链接和 Web 应用程序的组合处理程序
	// 这会捕获任何 6 字符路径（如 /AbC123）并将它们路由到短链接处理程序
	// /t/{id} 路径路由到临时订阅处理程序
	// 所有其他路径都转到 Web 处理程序
	shortLinkHandler := handler.NewShortLinkHandler(repo, subscriptionHandler, packageSubscribeHandler)
	bruteForceProtector := handler.NewBruteForceProtector()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.Trim(r.URL.Path, "/")
		clientIP := handler.GetClientIP(r)

		if bruteForceProtector.IsBlocked(clientIP, r.URL.Path) {
			http.NotFound(w, r)
			return
		}

		// 检查这是否是临时订阅访问（以"t/"开头，后跟 8 个十六进制字符）
		if strings.HasPrefix(path, "t/") && len(path) == 10 {
			rec := &handler.StatusRecorder{ResponseWriter: w, StatusCode: 200}
			tempSubAccessHandler.ServeHTTP(rec, r)
			if rec.StatusCode == http.StatusNotFound || rec.StatusCode == http.StatusForbidden {
				bruteForceProtector.RecordFailure(clientIP, r.URL.Path)
			}
			return
		}
		// 可变长度短链接匹配（/x/{fileCode}{userCode} 格式）
		if strings.HasPrefix(path, "x/") {
			code := path[2:]
			if len(code) >= 2 && isAlphanumeric(code) {
				if shortLinkHandler.TryServe(w, r) {
					return
				}
				bruteForceProtector.RecordFailure(clientIP, r.URL.Path)
				http.NotFound(w, r)
				return
			}
		}
		// 否则，传递给 Web 处理程序
		web.Handler().ServeHTTP(w, r)
	})

	allowedOrigins := getAllowedOrigins()
	handlerWithCORS := withCORS(mux, allowedOrigins)

	srv := &http.Server{
		Addr:              addr,
		Handler:           handlerWithCORS,
		ReadHeaderTimeout: 5 * time.Second,
	}

	collectorCtx, stopCollector := context.WithCancel(context.Background())

	// 启动 Xray 流量收集器（每 1 分钟）
	go trafficCollector.Start(collectorCtx)
	// 启动拉模式服务器的速度收集（每 3 秒）
	go trafficCollector.StartSpeedCollection(collectorCtx)
	// 启动每日快照和清理任务
	go startDailySnapshotTask(collectorCtx, trafficHandler)
	// 启动流量超限检查（每 2 分钟）
	trafficEnforcer := handler.NewTrafficLimitEnforcer(repo, remoteManageHandler)
	go trafficEnforcer.Start(collectorCtx, time.Duration(systemConfig.TrafficCheckInterval)*time.Second)
	// 启动 WebSocket 陈旧连接清理
	remoteWSHandler.StartCleanupLoop(collectorCtx, 1*time.Minute)
	// 启动证书自动续订检查程序（每 24 小时检查一次是否有 30 天内过期的证书）
	certHandler.StartRenewalChecker(collectorCtx)
	// TODO: 启动远程服务器离线检测任务（功能尚未实现）
	// 开始离线检测任务（collectorCtx，repo）

	// 如果处于子模式，则启动子客户端
	if childClient != nil {
		childClient.Start(collectorCtx)
		log.Printf("[Child Mode] Client started")
	}

	// 在启动时打印 API token
	apiToken, err := repo.GetAPIToken(context.Background())
	if err != nil {
		log.Printf("警告: 获取 API token 失败: %v", err)
	} else {
		log.Printf("=================================================")
		log.Printf("API Token: %s", apiToken)
		log.Printf("在请求头 MM-Authorization 中使用此 token 可无需认证访问 API")
		log.Printf("=================================================")
	}

	go func() {
		logger.Info("妙妙屋 HTTP 服务器启动", "version", version.Version, "address", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("HTTP服务器运行失败", "error", err)
			os.Exit(1)
		}
	}()

	waitForShutdown(srv, stopCollector, stopProxySync)
}

func getAddr(config *ServerConfig) string {
	// 优先级：配置文件 > 环境变量 > 默认值
	if config != nil && config.Port != "" {
		return "0.0.0.0:" + config.Port
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "12889"
	}
	return "0.0.0.0:" + port
}

// 检查字符串是否仅包含字母数字字符
func isAlphanumeric(s string) bool {
	for _, r := range s {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

func waitForShutdown(srv *http.Server, cancels ...context.CancelFunc) {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	<-sigCh
	logger.Info("收到关闭信号，开始优雅关闭")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 停止所有后台任务
	for _, cancelFunc := range cancels {
		if cancelFunc != nil {
			cancelFunc()
		}
	}

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("优雅关闭失败", "error", err)
	} else {
		logger.Info("服务器已安全关闭")
	}
}

// 创建每日快照并清理旧数据
func startDailySnapshotTask(ctx context.Context, trafficHandler *handler.TrafficSummaryHandler) {
	if trafficHandler == nil {
		return
	}

	// 带重试的流量收集函数
	runWithRetry := func() {
		logger.Info("[流量收集器] 开始每日流量收集", "start_time", time.Now().Format("2006-01-02 15:04:05"))

		maxRetries := 3
		retryDelay := 30 * time.Second

		for attempt := 1; attempt <= maxRetries; attempt++ {
			runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			err := trafficHandler.RecordDailyUsage(runCtx)
			cancel()

			if err == nil {
				logger.Info("[流量收集器] 每日流量收集成功")
				return
			}

			logger.Warn("[流量收集器] 每日流量收集失败", "attempt", attempt, "max_retries", maxRetries, "error", err)

			if attempt < maxRetries {
				logger.Info("[流量收集器] 准备重试", "delay", retryDelay)
				select {
				case <-ctx.Done():
					logger.Info("[流量收集器] 重试已取消（服务器关闭）")
					return
				case <-time.After(retryDelay):
					// 继续重试
				}
			}
		}

		logger.Error("[流量收集器] 达到最大重试次数后仍失败", "max_retries", maxRetries)
	}

	runWithRetry()

	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	logger.Info("[流量收集器] 定时调度器已启动", "interval", "24小时")

	for {
		select {
		case <-ctx.Done():
			logger.Info("[流量收集器] 定时调度器已停止")
			return
		case <-ticker.C:
			runWithRetry()
		}
	}
}

// syncSubscribeFilesToDatabase 扫描订阅目录并确保
// 每个 YAML 文件在 subscribe_files 表中都有相应的记录。
// 这有助于从旧版本升级时向后兼容。
func syncSubscribeFilesToDatabase(repo *storage.TrafficRepository, subscribeDir string) {
	if repo == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 读取订阅目录中的所有文件
	entries, err := os.ReadDir(subscribeDir)
	if err != nil {
		logger.Warn("读取订阅目录失败", "dir", subscribeDir, "error", err)
		return
	}

	synced := 0
	for _, entry := range entries {
		// 跳过目录和非 YAML 文件
		if entry.IsDir() {
			continue
		}
		filename := entry.Name()
		if filepath.Ext(filename) != ".yaml" && filepath.Ext(filename) != ".yml" {
			continue
		}

		// 跳过 .keep.yaml 占位符文件
		if filename == ".keep.yaml" {
			continue
		}

		// 检查该文件是否已有数据库记录
		if _, err := repo.GetSubscribeFileByFilename(ctx, filename); err == nil {
			// 文件已存在于数据库中，跳过
			continue
		} else if !errors.Is(err, storage.ErrSubscribeFileNotFound) {
			logger.Warn("检查订阅文件失败", "filename", filename, "error", err)
			continue
		}

		// 数据库中不存在文件，创建一条新记录
		// 使用不带扩展名的文件名作为名称
		name := filename[:len(filename)-len(filepath.Ext(filename))]

		file := storage.SubscribeFile{
			Name:        name,
			Description: "自动同步的订阅文件",
			URL:         "",                          // 没有旧文件的 URL
			Type:        storage.SubscribeTypeUpload, // 标记为上传类型
			Filename:    filename,
		}

		if _, err := repo.CreateSubscribeFile(ctx, file); err != nil {
			logger.Warn("同步订阅文件到数据库失败", "filename", filename, "error", err)
			continue
		}

		synced++
	}

	if synced > 0 {
		logger.Info("订阅文件同步完成", "count", synced)
	}
}

// 启动日志清理任务
func startLogCleanup() {
	logManager := logger.NewLogManager("data/logs")

	// 启动时立即清理一次
	if err := logManager.CleanupOldLogs(); err != nil {
		logger.Error("[日志清理] 启动时清理失败", "error", err)
	}

	// 每天凌晨3点清理
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	logger.Info("[日志清理] 定时清理任务已启动", "interval", "24小时", "max_age", "7天")

	for range ticker.C {
		if err := logManager.CleanupOldLogs(); err != nil {
			logger.Error("[日志清理] 定时清理失败", "error", err)
		}
	}
}
