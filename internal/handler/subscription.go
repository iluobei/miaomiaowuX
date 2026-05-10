package handler

import (
	"context"
	"errors"
	"fmt"
	"miaomiaowux/internal/logger"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"miaomiaowux/internal/auth"
	"miaomiaowux/internal/storage"
	"miaomiaowux/internal/substore"

	"gopkg.in/yaml.v3"
)

const subscriptionDefaultType = "clash"

// Token失效时返回的YAML内容
const tokenInvalidYAML = `allow-lan: false
dns:
  enable: true
  enhanced-mode: fake-ip
  ipv6: true
  nameserver:
    - https://doh.pub/dns-query
    - https://dns.alidns.com/dns-query
  nameserver-policy:
    geosite:cn,private:
      - https://doh.pub/dns-query
      - https://dns.alidns.com/dns-query
    geosite:geolocation-!cn:
      - https://dns.cloudflare.com/dns-query
      - https://dns.google/dns-query
  proxy-server-nameserver:
    - https://doh.pub/dns-query
    - https://dns.alidns.com/dns-query
  respect-rules: true
geo-auto-update: true
geo-update-interval: 24
geodata-loader: standard
geodata-mode: true
geox-url:
  asn: https://github.com/xishang0128/geoip/releases/download/latest/GeoLite2-ASN.mmdb
  geoip: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat
  geosite: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat
  mmdb: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb
log-level: info
mode: rule
port: 7890
proxies:
  - name: ⚠️ 订阅已过期
    type: ss
    server: test.example.com.cn
    port: 443
    password: J6h6sFZp0Xxv7M8K2RZ6nN8c8ZxQpJZcQ4M2YVtPZ5Q=
    cipher: 2022-blake3-chacha20-poly1305
  - name: ⚠️ 请联系管理员
    type: ss
    server: test.example.com.cn
    port: 443
    password: J6h6sFZp0Xxv7M8K2RZ6nN8c8ZxQpJZcQ4M2YVtPZ5Q=
    cipher: 2022-blake3-chacha20-poly1305
proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - ⚠️ 订阅已过期
      - ⚠️ 请联系管理员
rules:
  - MATCH,DIRECT
socks-port: 7891
`

const tokenInvalidFilename = "token_invalid.yaml"

// 令牌无效标志的上下文键
type ContextKey string

const TokenInvalidKey ContextKey = "token_invalid"

type SubscriptionHandler struct {
	repo     *storage.TrafficRepository
	baseDir  string
	fallback string
}

type subscriptionEndpoint struct {
	tokens *auth.TokenStore
	repo   *storage.TrafficRepository
	inner  *SubscriptionHandler
}

func NewSubscriptionHandler(repo *storage.TrafficRepository, baseDir string) http.Handler {
	if repo == nil {
		panic("subscription handler requires repository")
	}

	return newSubscriptionHandler(repo, baseDir, subscriptionDefaultType)
}

// NewSubscriptionHandlerConcrete 创建订阅处理程序并返回具体类型。
// 当其他处理程序需要直接访问 SubscriptionHandler 时使用此方法。
func NewSubscriptionHandlerConcrete(repo *storage.TrafficRepository, baseDir string) *SubscriptionHandler {
	if repo == nil {
		panic("subscription handler requires repository")
	}

	return newSubscriptionHandler(repo, baseDir, subscriptionDefaultType)
}

// 返回一个提供订阅文件的处理程序，允许通过查询参数使用会话令牌或用户令牌。
func NewSubscriptionEndpoint(tokens *auth.TokenStore, repo *storage.TrafficRepository, baseDir string) http.Handler {
	if tokens == nil {
		panic("subscription endpoint requires token store")
	}
	if repo == nil {
		panic("subscription endpoint requires repository")
	}

	inner := newSubscriptionHandler(repo, baseDir, subscriptionDefaultType)
	return &subscriptionEndpoint{tokens: tokens, repo: repo, inner: inner}
}

func newSubscriptionHandler(repo *storage.TrafficRepository, baseDir, fallback string) *SubscriptionHandler {
	if repo == nil {
		panic("subscription handler requires repository")
	}

	if baseDir == "" {
		baseDir = filepath.FromSlash("subscribes")
	}

	cleanedBase := filepath.Clean(baseDir)
	if fallback == "" {
		fallback = subscriptionDefaultType
	}

	return &SubscriptionHandler{repo: repo, baseDir: cleanedBase, fallback: fallback}
}

func (s *subscriptionEndpoint) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	request, ok := s.authorizeRequest(w, r)
	if !ok {
		return
	}

	s.inner.ServeHTTP(w, request)
}

func (s *subscriptionEndpoint) authorizeRequest(w http.ResponseWriter, r *http.Request) (*http.Request, bool) {
	if r.Method != http.MethodGet {
		// 允许处理程序以方法限制进行响应
		return r, true
	}

	// 检查用户名参数（来自复合短链接 - 已通过短链接处理程序进行身份验证）
	queryUsername := strings.TrimSpace(r.URL.Query().Get("username"))
	if queryUsername != "" {
		ctx := auth.ContextWithUsername(r.Context(), queryUsername)
		return r.WithContext(ctx), true
	}

	// 检查令牌参数（旧版/直接访问）
	queryToken := strings.TrimSpace(r.URL.Query().Get("token"))
	if queryToken != "" && s.repo != nil {
		username, err := s.repo.ValidateUserToken(r.Context(), queryToken)
		if err == nil {
			ctx := auth.ContextWithUsername(r.Context(), username)
			return r.WithContext(ctx), true
		}
		if !errors.Is(err, storage.ErrTokenNotFound) {
			writeError(w, http.StatusInternalServerError, err)
			return nil, false
		}
	}

	// 检查标头令牌（基于会话的访问）
	headerToken := strings.TrimSpace(r.Header.Get(auth.AuthHeader))
	username, ok := s.tokens.Lookup(headerToken)
	if ok {
		ctx := auth.ContextWithUsername(r.Context(), username)
		return r.WithContext(ctx), true
	}

	// 所有认证方式都失败，设置token失效标记
	ctx := context.WithValue(r.Context(), TokenInvalidKey, true)
	return r.WithContext(ctx), true
}

func (h *SubscriptionHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 性能监测：记录总开始时间
	requestStart := time.Now()
	var stepStart time.Time

	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("only GET is supported"))
		return
	}

	// 检查是否是token失效场景
	if tokenInvalid, ok := r.Context().Value(TokenInvalidKey).(bool); ok && tokenInvalid {
		h.serveTokenInvalidResponse(w, r)
		return
	}

	// 从上下文中获取用户名
	username := auth.UsernameFromContext(r.Context())

	filename := strings.TrimSpace(r.URL.Query().Get("filename"))
	var subscribeFile storage.SubscribeFile
	var displayName string
	var err error
	var hasSubscribeFile bool

	if filename != "" {
		subscribeFile, err = h.repo.GetSubscribeFileByFilename(r.Context(), filename)
		if err != nil {
			if errors.Is(err, storage.ErrSubscribeFileNotFound) {
				writeError(w, http.StatusNotFound, errors.New("not found"))
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		displayName = subscribeFile.Name
		hasSubscribeFile = true
	} else {
		// TODO: 订阅链接已经配置到客户端，管理员修改文件名后，原订阅链接无法使用
		// 1.0 版本时改为与表里的ID关联，暂时先不改
		legacyName := strings.TrimSpace(r.URL.Query().Get("t"))
		link, err := h.resolveSubscription(r.Context(), legacyName)
		if err != nil {
			if errors.Is(err, storage.ErrSubscriptionNotFound) {
				writeError(w, http.StatusNotFound, err)
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		filename = link.RuleFilename
		displayName = link.Name
		if h.repo != nil {
			subscribeFile, err = h.repo.GetSubscribeFileByFilename(r.Context(), filename)
			if err == nil {
				hasSubscribeFile = true
			} else if !errors.Is(err, storage.ErrSubscribeFileNotFound) {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
		}
	}
	logger.Info("[⏱️ 耗时监测] 文件查找完成", "step", "file_lookup", "duration_ms", time.Since(stepStart).Milliseconds(), "filename", filename)

	if username != "" {
		clientType := r.Header.Get("User-Agent")
		if clientType == "" {
			clientType = "unknown"
		}
		SendSubscribeFetchNotification(r.Context(), username, clientType, GetClientIP(r))
	}

	cleanedName := filepath.Clean(filename)
	if strings.HasPrefix(cleanedName, "..") || filepath.IsAbs(cleanedName) {
		writeError(w, http.StatusBadRequest, errors.New("invalid rule filename"))
		return
	}

	resolvedPath := filepath.Join(h.baseDir, cleanedName)

	// 验证解析的路径是否在 baseDir 内以防止路径遍历
	absBase, err := filepath.Abs(h.baseDir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	absResolved, err := filepath.Abs(resolvedPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if !strings.HasPrefix(absResolved, absBase+string(filepath.Separator)) && absResolved != absBase {
		writeError(w, http.StatusBadRequest, errors.New("invalid rule filename"))
		return
	}

	if hasSubscribeFile && subscribeFile.ExpireAt != nil {
		now := time.Now()
		if !subscribeFile.ExpireAt.After(now) {
			logger.Info("[Subscription] 订阅已过期", "filename", filename, "expire_at", subscribeFile.ExpireAt.Format("2006-01-02 15:04:05"))
			h.serveTokenInvalidResponse(w, r)
			return
		}
	}

	// 文件读取
	stepStart = time.Now()
	data, err := os.ReadFile(resolvedPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeError(w, http.StatusNotFound, err)
		} else {
			writeError(w, http.StatusInternalServerError, err)
		}
		return
	}
	logger.Info("[⏱️ 耗时监测] 文件读取完成", "step", "file_read", "duration_ms", time.Since(stepStart).Milliseconds(), "bytes", len(data))

	// MMW 同步
	stepStart = time.Now()
	// 同步 MMW 模式代理集合的节点到订阅文件
	// 这样可以确保获取订阅时包含最新的代理集合节点
	if h.repo != nil {
		SyncMMWProxyProvidersToFile(h.repo, h.baseDir, cleanedName)
		// 重新读取更新后的文件
		updatedData, err := os.ReadFile(resolvedPath)
		if err == nil {
			data = updatedData
		}
	}
	logger.Info("[⏱️ 耗时监测] MMW 同步完成", "step", "mmw_sync", "duration_ms", time.Since(stepStart).Milliseconds())

	// 外部订阅同步
	stepStart = time.Now()
	// 检查是否启用强制同步外部订阅并仅同步引用的订阅
	if username != "" && h.repo != nil {
		settings, err := h.repo.GetUserSettings(r.Context(), username)
		if err == nil && settings.ForceSyncExternal {
			logger.Info("[Subscription] 用户启用强制同步", "user", username, "cache_expire_minutes", settings.CacheExpireMinutes)

			// 获取当前文件中引用的外部订阅
			usedExternalSubs, err := GetExternalSubscriptionsFromFile(r.Context(), data, username, h.repo)
			if err != nil {
				logger.Info("[Subscription] 获取文件中的外部订阅失败", "error", err)
			} else if len(usedExternalSubs) > 0 {
				logger.Info("[Subscription] 找到当前文件引用的外部订阅", "count", len(usedExternalSubs))

				// 获取用户的外部订阅以检查缓存并获取 URL
				allExternalSubs, err := h.repo.ListExternalSubscriptions(r.Context(), username)
				if err != nil {
					logger.Info("[Subscription] 获取外部订阅列表失败", "error", err)
				} else {
					// 筛选以仅同步当前文件中引用的订阅
					var subsToSync []storage.ExternalSubscription
					subURLMap := make(map[string]string) // URL -> 名称映射

					for _, sub := range allExternalSubs {
						subURLMap[sub.URL] = sub.Name
						if _, used := usedExternalSubs[sub.URL]; used {
							subsToSync = append(subsToSync, sub)
						}
					}

					logger.Info("[Subscription] 强制同步已启用，将同步引用的外部订阅", "sync_count", len(subsToSync), "total_count", len(allExternalSubs))

					// 检查我们是否需要根据缓存过期进行同步
					shouldSync := false
					if settings.CacheExpireMinutes > 0 {
						// 仅检查引用订阅的上次同步时间
						for _, sub := range subsToSync {
							if sub.LastSyncAt == nil {
								// 以前从未同步过
								logger.Info("[Subscription] 订阅从未同步过，将进行同步", "name", sub.Name, "url", sub.URL)
								shouldSync = true
								break
							}

							// 计算时间差（以分钟为单位）
							elapsed := time.Since(*sub.LastSyncAt).Minutes()
							if elapsed >= float64(settings.CacheExpireMinutes) {
								// 缓存已过期
								logger.Info("[Subscription] 订阅缓存已过期，将进行同步", "name", sub.Name, "url", sub.URL, "elapsed_minutes", elapsed, "expire_minutes", settings.CacheExpireMinutes)
								shouldSync = true
								break
							}
						}
						if !shouldSync {
							logger.Info("[Subscription] All referenced subscriptions are within cache time, skipping sync")
						}
					} else {
						// 缓存过期分钟为0，始终同步
						logger.Info("[Subscription] Cache expire minutes is 0, will always sync referenced subscriptions")
						shouldSync = true
					}

					if shouldSync {
						logger.Info("[Subscription] 开始同步用户的外部订阅(仅引用的订阅)", "user", username)
						// 仅同步引用的外部订阅
						if err := syncReferencedExternalSubscriptions(r.Context(), h.repo, h.baseDir, username, subsToSync); err != nil {
							logger.Info("[Subscription] 同步外部订阅失败", "error", err)
							// 记录错误但不要使请求失败
							// 同步是尽力而为的
						} else {
							logger.Info("[Subscription] External subscriptions sync completed successfully")

							// 同步后重新读取订阅文件以获取更新的节点
							updatedData, err := os.ReadFile(resolvedPath)
							if err != nil {
								logger.Info("[Subscription] 同步后重新读取订阅文件失败", "error", err)
							} else {
								data = updatedData
								logger.Info("[Subscription] 同步后重新读取订阅文件成功", "bytes", len(data))
							}
						}
					}
				}
			} else {
				logger.Info("[Subscription] No external subscriptions referenced in current file, skipping sync")
			}
		}
	}
	logger.Info("[⏱️ 耗时监测] 外部订阅同步完成", "step", "external_sync", "duration_ms", time.Since(stepStart).Milliseconds())

	// 流量信息收集
	stepStart = time.Now()
	externalTrafficLimit, externalTrafficUsed := int64(0), int64(0)

	if username != "" && h.repo != nil {
		settings, err := h.repo.GetUserSettings(r.Context(), username)
		if err == nil && settings.SyncTraffic {
			// 解析 YAML 文件，获取其中使用的节点名称
			var yamlConfig map[string]any
			if err := yaml.Unmarshal(data, &yamlConfig); err == nil {
				if proxies, ok := yamlConfig["proxies"].([]any); ok {
					logger.Info("[Subscription] 找到订阅YAML中的代理节点", "count", len(proxies))
					usedNodeNames := make(map[string]bool)
					for _, proxy := range proxies {
						if proxyMap, ok := proxy.(map[string]any); ok {
							if name, ok := proxyMap["name"].(string); ok && name != "" {
								usedNodeNames[name] = true
							}
						}
					}

					if len(usedNodeNames) > 0 {
						nodes, err := h.repo.ListNodes(r.Context(), username)
						if err == nil {
							usedExternalSubs := make(map[string]bool)
							for _, node := range nodes {
								if usedNodeNames[node.NodeName] {
									if node.Tag != "" && node.Tag != "手动输入" {
										usedExternalSubs[node.Tag] = true
									}
								}
							}

							if len(usedExternalSubs) > 0 {
								logger.Info("[Subscription] 找到使用中的外部订阅", "user", username, "count", len(usedExternalSubs))
								externalSubs, err := h.repo.ListExternalSubscriptions(r.Context(), username)
								if err == nil {
									now := time.Now()
									for _, sub := range externalSubs {
										if usedExternalSubs[sub.Name] {
											if sub.Expire != nil && sub.Expire.Before(now) {
												continue
											}
											externalTrafficLimit += sub.Total
											switch sub.TrafficMode {
											case "download":
												externalTrafficUsed += sub.Download
											case "upload":
												externalTrafficUsed += sub.Upload
											default:
												externalTrafficUsed += sub.Upload + sub.Download
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
	logger.Info("[⏱️ 耗时监测] 流量信息收集完成", "step", "traffic_info", "duration_ms", time.Since(stepStart).Milliseconds())

	// 节点排序
	stepStart = time.Now()
	// 获取用户的节点排序配置，需要在转换之前使用
	var nodeOrder []int64
	if username != "" && h.repo != nil {
		settings, err := h.repo.GetUserSettings(r.Context(), username)
		if err == nil {
			nodeOrder = settings.NodeOrder
			logger.Info("[Subscription] 用户节点排序配置", "user", username, "node_count", len(nodeOrder))
		}
	}

	// 在转换之前根据节点排序配置调整原始 YAML
	// 这样转换后的任何格式都会保持正确的节点顺序
	if len(nodeOrder) > 0 && username != "" && h.repo != nil {
		var yamlNode yaml.Node
		if err := yaml.Unmarshal(data, &yamlNode); err == nil {
			shouldRewrite := false
			if len(yamlNode.Content) > 0 && yamlNode.Content[0].Kind == yaml.MappingNode {
				rootMap := yamlNode.Content[0]
				for i := 0; i < len(rootMap.Content); i += 2 {
					if rootMap.Content[i].Value == "proxies" {
						proxiesNode := rootMap.Content[i+1]
						if proxiesNode.Kind == yaml.SequenceNode {
							if err := sortProxiesByNodeOrder(r.Context(), h.repo, username, proxiesNode, nodeOrder); err != nil {
								logger.Info("[Subscription] 转换前按节点顺序排序失败", "error", err)
							} else {
								shouldRewrite = true
								logger.Info("[Subscription] Successfully sorted proxies by node order before conversion")
							}
						}
						break
					}
				}
			}

			// 如果排序成功，重新序列化YAML并替换data
			if shouldRewrite {
				if reorderedData, err := MarshalYAMLWithIndent(&yamlNode); err == nil {
					fixed := RemoveUnicodeEscapeQuotes(string(reorderedData))
					data = []byte(fixed)
					logger.Info("[Subscription] Rewrote YAML data with sorted proxies")
				}
			}
		}
	}
	logger.Info("[⏱️ 耗时监测] 节点排序完成", "step", "node_order", "duration_ms", time.Since(stepStart).Milliseconds())

	// 格式转换
	stepStart = time.Now()
	// 根据参数t的类型调用substore的转换代码
	clientType := strings.TrimSpace(r.URL.Query().Get("t"))
	// 默认浏览器打开时直接输入文本, 不再下载问卷
	contentType := "text/yaml; charset=utf-8; charset=UTF-8"
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = ".yaml"
	}

	// clash 和 clashmeta 类型直接输出源文件, 不需要转换
	if clientType != "" && clientType != "clash" && clientType != "clashmeta" {
		// 使用子商店生产者转换订阅
		convertedData, err := h.convertSubscription(r.Context(), data, clientType)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("failed to convert subscription for client %s: %w", clientType, err))
			return
		}
		data = convertedData

		// 根据客户端类型设置内容类型和扩展名
		switch clientType {
		case "surge", "surgemac", "loon", "qx", "surfboard", "shadowrocket", "clash-to-surge":
			// 基于文本的格式
			contentType = "text/plain; charset=utf-8"
			ext = ".txt"
		case "sing-box":
			// JSON格式
			contentType = "application/json; charset=utf-8"
			ext = ".json"
		case "v2ray":
			// Base64 格式
			contentType = "text/plain; charset=utf-8"
			ext = ".txt"
		case "uri":
			// 统一资源定位符格式
			contentType = "text/plain; charset=utf-8"
			ext = ".txt"
		default:
			// 基于 YAML 的格式（clash、clashmeta、stash、shadowrocket、egern）
			contentType = "text/yaml; charset=utf-8"
			ext = ".yaml"
		}
	}
	logger.Info("[⏱️ 耗时监测] 格式转换完成", "step", "format_convert", "duration_ms", time.Since(stepStart).Milliseconds(), "client_type", clientType)

	// 使用订阅名称
	attachmentName := url.PathEscape(displayName)

	// YAML 重排序
	stepStart = time.Now()
	// 对于 YAML 格式的数据，重新排序以将 rule-providers 放在最后
	// 注意：节点排序已经在转换之前完成，这里只处理其他的YAML重排需求
	if contentType == "text/yaml; charset=utf-8" || contentType == "text/yaml; charset=utf-8; charset=UTF-8" {
		// 使用 yaml.Node 来保持原始类型信息（避免 563905e2 被解析为科学计数法）
		var yamlNode yaml.Node
		if err := yaml.Unmarshal(data, &yamlNode); err == nil {
			// 检查是否有 rule-providers 需要重新排序
			// yamlNode.Content[0] 是文档节点，yamlNode.Content[0].Content 是根映射的键值对
			if len(yamlNode.Content) > 0 && yamlNode.Content[0].Kind == yaml.MappingNode {
				rootMap := yamlNode.Content[0]

				// 注意：节点排序已经在转换之前完成，这里不再重复排序
				// 只处理 WireGuard 修复和字段重排

				// 重新排序 proxies 中每个节点的字段
				for i := 0; i < len(rootMap.Content); i += 2 {
					if rootMap.Content[i].Value == "proxies" {
						proxiesNode := rootMap.Content[i+1]
						if proxiesNode.Kind == yaml.SequenceNode {
							// 先修复 WireGuard 节点的 allowed-ips 字段
							fixWireGuardAllowedIPs(proxiesNode)
							reorderProxies(proxiesNode)
						}
						break
					}
				}

				// 重新排序 proxy-groups 中每个代理组的字段
				for i := 0; i < len(rootMap.Content); i += 2 {
					if rootMap.Content[i].Value == "proxy-groups" {
						proxyGroupsNode := rootMap.Content[i+1]
						if proxyGroupsNode.Kind == yaml.SequenceNode {
							reorderProxyGroups(proxyGroupsNode)
						}
						break
					}
				}

				// 查找 rule-providers 的位置
				ruleProvidersIdx := -1
				for i := 0; i < len(rootMap.Content); i += 2 {
					if rootMap.Content[i].Value == "rule-providers" {
						ruleProvidersIdx = i
						break
					}
				}

				// 如果找到 rule-providers 且不在最后，则移动到最后
				if ruleProvidersIdx >= 0 && ruleProvidersIdx < len(rootMap.Content)-2 {
					// 提取 rule-providers 的键和值
					keyNode := rootMap.Content[ruleProvidersIdx]
					valueNode := rootMap.Content[ruleProvidersIdx+1]

					// 从原位置删除
					rootMap.Content = append(rootMap.Content[:ruleProvidersIdx], rootMap.Content[ruleProvidersIdx+2:]...)

					// 添加到最后
					rootMap.Content = append(rootMap.Content, keyNode, valueNode)
				}
			}

			// 重新序列化为 YAML (使用2空格缩进)
			if reorderedData, err := MarshalYAMLWithIndent(&yamlNode); err == nil {
				// 修复表情符号转义和引用的数字
				fixed := RemoveUnicodeEscapeQuotes(string(reorderedData))
				data = []byte(fixed)
			}
		}
	}
	logger.Info("[⏱️ 耗时监测] YAML 重排序完成", "step", "yaml_reorder", "duration_ms", time.Since(stepStart).Milliseconds())

	w.Header().Set("Content-Type", contentType)
	if externalTrafficLimit > 0 {
		var expireAt *time.Time
		if hasSubscribeFile {
			expireAt = subscribeFile.ExpireAt
		}
		headerValue := buildSubscriptionHeader(externalTrafficLimit, externalTrafficUsed, expireAt)
		w.Header().Set("subscription-userinfo", headerValue)
	}
	w.Header().Set("profile-update-interval", "24")
	// 只有非浏览器访问时才添加 content-disposition 头（避免浏览器直接下载）
	userAgent := r.Header.Get("User-Agent")
	isBrowser := strings.Contains(userAgent, "Mozilla") || strings.Contains(userAgent, "Chrome") || strings.Contains(userAgent, "Safari") || strings.Contains(userAgent, "Edge")
	if !isBrowser {
		w.Header().Set("content-disposition", "attachment;filename*=UTF-8''"+attachmentName)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
	logger.Info("[⏱️ 耗时监测] 请求处理完成", "total_duration_ms", time.Since(requestStart).Milliseconds(), "username", username, "filename", filename)
}

func (h *SubscriptionHandler) resolveSubscription(ctx context.Context, name string) (storage.SubscriptionLink, error) {
	if h == nil {
		return storage.SubscriptionLink{}, errors.New("subscription handler not initialized")
	}

	if h.repo == nil {
		return storage.SubscriptionLink{}, errors.New("subscription repository not configured")
	}

	trimmed := strings.TrimSpace(name)
	if trimmed != "" {
		return h.repo.GetSubscriptionByName(ctx, trimmed)
	}

	if h.fallback != "" {
		link, err := h.repo.GetSubscriptionByName(ctx, h.fallback)
		if err == nil {
			return link, nil
		}
		if !errors.Is(err, storage.ErrSubscriptionNotFound) {
			return storage.SubscriptionLink{}, err
		}
	}

	return h.repo.GetFirstSubscriptionLink(ctx)
}

func buildSubscriptionHeader(totalLimit, totalUsed int64, expireAt *time.Time) string {
	download := strconv.FormatInt(totalUsed, 10)
	total := strconv.FormatInt(totalLimit, 10)
	expire := ""
	if expireAt != nil {
		expire = strconv.FormatInt(expireAt.Unix(), 10)
	}
	return "upload=0; download=" + download + "; total=" + total + "; expire=" + expire
}

// 将映射的键作为切片返回
func getKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// GetExternalSubscriptionsFromFile 从 YAML 文件内容中提取外部订阅 URL
// 通过分析代理并查询数据库中的 raw_url（外部订阅链接）
// 还检查引用外部订阅的代理提供程序配置的代理提供程序
func GetExternalSubscriptionsFromFile(ctx context.Context, data []byte, username string, repo *storage.TrafficRepository) (map[string]bool, error) {
	usedURLs := make(map[string]bool)

	// 解析 YAML 内容
	var yamlContent map[string]any
	if err := yaml.Unmarshal(data, &yamlContent); err != nil {
		return usedURLs, fmt.Errorf("failed to parse YAML: %w", err)
	}

	// 提取代理并查询数据库以获取其 raw_url
	if proxies, ok := yamlContent["proxies"].([]any); ok {
		logger.Info("[Subscription] 找到订阅文件中的代理节点", "count", len(proxies))

		// 收集所有代理名称
		proxyNames := make(map[string]bool)
		for _, proxy := range proxies {
			if proxyMap, ok := proxy.(map[string]any); ok {
				if name, ok := proxyMap["name"].(string); ok && name != "" {
					proxyNames[name] = true
				}
			}
		}

		if len(proxyNames) > 0 {
			logger.Info("[Subscription] 查询数据库获取外部订阅URL", "proxy_count", len(proxyNames))

			// 查询数据库中具有这些名称的节点
			nodes, err := repo.ListNodes(ctx, username)
			if err != nil {
				logger.Info("[Subscription] 查询节点列表失败", "error", err)
				return usedURLs, fmt.Errorf("failed to list nodes: %w", err)
			}

			// 收集使用到的外部订阅标签（节点的 Tag 字段）
			usedTags := make(map[string]bool)

			// 查找匹配的节点并收集其 raw_url 和标签
			for _, node := range nodes {
				if proxyNames[node.NodeName] {
					// 如果节点有 RawURL，直接使用
					if node.RawURL != "" {
						usedURLs[node.RawURL] = true
						logger.Info("[Subscription] 从节点找到外部订阅URL", "node_name", node.NodeName, "url", node.RawURL)
					}
					// 如果节点有 Tag（外部订阅名称），记录下来
					if node.Tag != "" && node.Tag != "手动输入" {
						usedTags[node.Tag] = true
						logger.Info("[Subscription] 节点来自外部订阅", "node_name", node.NodeName, "tag", node.Tag)
					}
				}
			}

			// 妙妙屋模式：通过节点的 Tag（外部订阅名称）找到外部订阅URL
			if len(usedTags) > 0 {
				logger.Info("[Subscription] 发现使用外部订阅的节点", "tag_count", len(usedTags))

				// 获取所有外部订阅
				externalSubs, err := repo.ListExternalSubscriptions(ctx, username)
				if err != nil {
					logger.Info("[Subscription] 获取外部订阅列表失败", "error", err)
				} else {
					// 根据 Tag（外部订阅名称）找到对应的 URL
					for _, sub := range externalSubs {
						if usedTags[sub.Name] {
							usedURLs[sub.URL] = true
							logger.Info("[Subscription] 从节点Tag找到外部订阅URL", "tag", sub.Name, "url", sub.URL)
						}
					}
				}
			}
		}
	}

	// 另请检查代理组中引用代理提供程序配置的“使用”字段
	// 这处理使用 proxy-providers + use 而不是直接代理的情况
	if proxyGroups, ok := yamlContent["proxy-groups"].([]any); ok {
		logger.Info("[Subscription] 检查 proxy-groups", "group_count", len(proxyGroups))
		providerNames := make(map[string]bool)
		groupNames := make(map[string]bool) // 妙妙屋模式：收集 proxy-group 的名称
		for _, group := range proxyGroups {
			if groupMap, ok := group.(map[string]any); ok {
				// 收集 proxy-group 名称（妙妙屋模式会创建同名的 proxy-group）
				if groupName, ok := groupMap["name"].(string); ok && groupName != "" {
					groupNames[groupName] = true
				}

				// 收集 use 字段中的 provider 名称（客户端模式）
				if useList, ok := groupMap["use"].([]any); ok {
					for _, use := range useList {
						if useName, ok := use.(string); ok && useName != "" {
							providerNames[useName] = true
							logger.Info("[Subscription] 找到 proxy-group 使用的 provider", "provider_name", useName)
						}
					}
				}
			}
		}

		// 合并两种模式的名称
		allNames := make(map[string]bool)
		for name := range providerNames {
			allNames[name] = true
		}
		for name := range groupNames {
			allNames[name] = true
		}

		if len(allNames) > 0 {
			logger.Info("[Subscription] 找到代理集合引用", "count", len(allNames), "from_use", len(providerNames), "from_groups", len(groupNames))

			// 获取该用户的所有代理提供商配置
			configs, err := repo.ListProxyProviderConfigs(ctx, username)
			if err != nil {
				logger.Info("[Subscription] 查询代理集合配置失败", "error", err)
			} else {
				logger.Info("[Subscription] 查询到用户的代理集合配置", "count", len(configs))
				// 获取地图配置 -> URL 的外部订阅
				externalSubs, err := repo.ListExternalSubscriptions(ctx, username)
				if err != nil {
					logger.Info("[Subscription] 获取外部订阅列表失败", "error", err)
				} else {
					logger.Info("[Subscription] 查询到用户的外部订阅", "count", len(externalSubs))
					// 构建外部订阅ID -> URL映射
					subIDToURL := make(map[int64]string)
					for _, sub := range externalSubs {
						subIDToURL[sub.ID] = sub.URL
					}

					// 查找与名称匹配的配置并获取其外部订阅 URL
					for _, config := range configs {
						logger.Info("[Subscription] 检查配置", "config_name", config.Name, "external_sub_id", config.ExternalSubscriptionID, "process_mode", config.ProcessMode)
						if allNames[config.Name] {
							if url, ok := subIDToURL[config.ExternalSubscriptionID]; ok {
								usedURLs[url] = true
								logger.Info("[Subscription] 从代理集合配置找到外部订阅URL", "config_name", config.Name, "mode", config.ProcessMode, "url", url)
							} else {
								logger.Info("[Subscription] 配置的外部订阅ID未找到对应URL", "config_name", config.Name, "external_sub_id", config.ExternalSubscriptionID)
							}
						}
					}
				}
			}
		} else {
			logger.Info("[Subscription] proxy-groups 中未找到引用")
		}
	} else {
		logger.Info("[Subscription] YAML 中未找到 proxy-groups")
	}

	// 检查 proxy-providers 部分（用于客户端模式的代理集合配置）
	// 当处理模式为客户端模式时，YAML 文件中包含 proxy-providers 配置，URL 为内部 API 端点
	if proxyProviders, ok := yamlContent["proxy-providers"].(map[string]any); ok {
		logger.Info("[Subscription] 找到 proxy-providers 配置", "count", len(proxyProviders))

		// 构建配置 ID -> 外部订阅 URL 映射
		configIDToURL := make(map[int64]string)
		configs, err := repo.ListProxyProviderConfigs(ctx, username)
		if err == nil {
			externalSubs, err := repo.ListExternalSubscriptions(ctx, username)
			if err == nil {
				// 构建外部订阅 ID -> URL 映射
				subIDToURL := make(map[int64]string)
				for _, sub := range externalSubs {
					subIDToURL[sub.ID] = sub.URL
				}
				// 将配置 ID 映射到外部订阅 URL
				for _, config := range configs {
					if url, ok := subIDToURL[config.ExternalSubscriptionID]; ok {
						configIDToURL[config.ID] = url
					}
				}
			}
		}

		// 解析每个 provider 的 URL，查找内部 API 端点
		for providerName, provider := range proxyProviders {
			if providerMap, ok := provider.(map[string]any); ok {
				if urlStr, ok := providerMap["url"].(string); ok && urlStr != "" {
					// 检查是否为内部 API 端点：/api/proxy-provider/{id}
					if configIDStr, found := strings.CutPrefix(urlStr, "/api/proxy-provider/"); found {
						if configID, err := strconv.ParseInt(configIDStr, 10, 64); err == nil {
							if url, ok := configIDToURL[configID]; ok {
								usedURLs[url] = true
								logger.Info("[Subscription] 从 proxy-providers 找到外部订阅URL",
									"provider_name", providerName, "config_id", configID, "url", url)
							}
						}
					}
				}
			}
		}
	}

	logger.Info("[Subscription] 找到当前文件引用的外部订阅URL", "count", len(usedURLs))
	return usedURLs, nil
}

// 仅同步指定的外部订阅
func syncReferencedExternalSubscriptions(ctx context.Context, repo *storage.TrafficRepository, subscribeDir, username string, subsToSync []storage.ExternalSubscription) error {
	if repo == nil || username == "" || len(subsToSync) == 0 {
		return fmt.Errorf("invalid parameters")
	}

	// 获取用户设置以检查匹配规则
	userSettings, err := repo.GetUserSettings(ctx, username)
	if err != nil {
		// 如果未找到设置，则使用默认匹配规则
		userSettings.MatchRule = "node_name"
	}

	logger.Info("[Subscription] 用户需要同步的外部订阅", "user", username, "count", len(subsToSync), "match_rule", userSettings.MatchRule)

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// 跟踪已同步的节点总数
	totalNodesSynced := 0

	for _, sub := range subsToSync {
		subSyncStart := time.Now()
		nodeCount, updatedSub, err := syncSingleExternalSubscription(ctx, client, repo, subscribeDir, username, sub, userSettings)
		if err != nil {
			logger.Info("[⏱️ 耗时监测] 同步订阅失败", "name", sub.Name, "url", sub.URL, "error", err, "duration_ms", time.Since(subSyncStart).Milliseconds())
			continue
		}

		totalNodesSynced += nodeCount

		// 更新上次同步时间和节点数
		// 使用包含来自 parseAndUpdateTrafficInfo 的流量信息的 UpdatedSub
		now := time.Now()
		updatedSub.LastSyncAt = &now
		updatedSub.NodeCount = nodeCount
		if err := repo.UpdateExternalSubscription(ctx, updatedSub); err != nil {
			logger.Info("[Subscription] 更新订阅同步时间失败", "name", sub.Name, "error", err)
		}
		logger.Info("[⏱️ 耗时监测] 外部订阅同步完成", "name", sub.Name, "node_count", nodeCount, "duration_ms", time.Since(subSyncStart).Milliseconds())
	}

	logger.Info("[Subscription] 同步完成", "total_nodes", totalNodesSynced, "subscription_count", len(subsToSync))

	// 同步完成后，失效相关缓存：
	// 1. 失效外部订阅内容缓存（proxy_provider_serve.go 中的 5 分钟缓存）
	// 2. 失效代理集合节点缓存
	// 这样下次获取订阅时会使用最新的节点数据
	syncedSubIDs := make(map[int64]bool)
	syncedSubURLs := make(map[string]bool)
	for _, sub := range subsToSync {
		syncedSubIDs[sub.ID] = true
		syncedSubURLs[sub.URL] = true
	}

	// 失效外部订阅内容缓存
	for url := range syncedSubURLs {
		InvalidateSubscriptionContentCache(url)
		logger.Info("[Subscription] 失效外部订阅内容缓存", "url", url)
	}

	// 获取所有代理集合配置，失效引用了这些外部订阅的代理集合缓存
	configs, err := repo.ListProxyProviderConfigs(ctx, username)
	if err == nil {
		cache := GetProxyProviderCache()
		invalidatedCount := 0
		for _, config := range configs {
			// 检查是否引用了刚刚同步的外部订阅
			if syncedSubIDs[config.ExternalSubscriptionID] {
				cache.Delete(config.ID)
				invalidatedCount++
				logger.Info("[Subscription] 失效代理集合缓存", "config_name", config.Name, "config_id", config.ID)
			}
		}
		if invalidatedCount > 0 {
			logger.Info("[Subscription] 代理集合缓存失效完成", "count", invalidatedCount)
		}
	} else {
		logger.Info("[Subscription] 获取代理集合配置失败，无法失效缓存", "error", err)
	}

	return nil
}

func (h *SubscriptionHandler) loadTokenInvalidContent() []byte {
	tokenPath := filepath.Join("data", tokenInvalidFilename)
	data, err := os.ReadFile(tokenPath)
	if err != nil {
		logger.Info("[Token Invalid] 读取data/token_invalid.yaml失败，使用内置默认内容", "path", tokenPath, "error", err)
		return []byte(tokenInvalidYAML)
	}
	if len(data) == 0 {
		logger.Info("[Token Invalid] data/token_invalid.yaml为空，使用内置默认内容", "path", tokenPath)
		return []byte(tokenInvalidYAML)
	}
	logger.Info("[Token Invalid] 使用自定义token_invalid.yaml", "path", tokenPath)
	return data
}

// 通过客户端类型转换提供令牌无效 YAML 内容
func (h *SubscriptionHandler) serveTokenInvalidResponse(w http.ResponseWriter, r *http.Request) {
	data := h.loadTokenInvalidContent()

	// 根据参数t的类型调用substore的转换代码
	clientType := strings.TrimSpace(r.URL.Query().Get("t"))
	contentType := "text/yaml; charset=utf-8"
	ext := ".yaml"

	// 如果指定了客户端类型且不是clash/clashmeta，进行转换
	if clientType != "" && clientType != "clash" && clientType != "clashmeta" {
		convertedData, err := h.convertSubscription(r.Context(), data, clientType)
		if err != nil {
			// 转换失败，记录日志但继续返回YAML
			logger.Info("[Token Invalid] 转换失败", "client_type", clientType, "error", err)
		} else {
			data = convertedData

			// 根据客户端类型设置content type和扩展名
			switch clientType {
			case "surge", "surgemac", "loon", "qx", "surfboard", "shadowrocket", "clash-to-surge":
				contentType = "text/plain; charset=utf-8"
				ext = ".txt"
			case "sing-box":
				contentType = "application/json; charset=utf-8"
				ext = ".json"
			case "v2ray", "uri":
				contentType = "text/plain; charset=utf-8"
				ext = ".txt"
			default:
				contentType = "text/yaml; charset=utf-8"
				ext = ".yaml"
			}
		}
	}

	attachmentName := url.PathEscape("Token已失效" + ext)

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("profile-update-interval", "24")
	if clientType == "" {
		w.Header().Set("content-disposition", "attachment;filename*=UTF-8''"+attachmentName)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)

	logger.Info("[Token Invalid] 返回Token失效响应", "client_type", clientType)
}

// ConvertSubscription 将 YAML 订阅文件转换为指定的客户端格式
func (h *SubscriptionHandler) convertSubscription(ctx context.Context, yamlData []byte, clientType string) ([]byte, error) {
	// 使用 yaml.Node 解析, 解决值前导零的问题
	var rootNode yaml.Node
	if err := yaml.Unmarshal(yamlData, &rootNode); err != nil {
		return nil, fmt.Errorf("failed to parse YAML: %w", err)
	}

	config, err := yamlNodeToMap(&rootNode)
	if err != nil {
		return nil, fmt.Errorf("failed to convert YAML node: %w", err)
	}

	// 读取yaml中proxies属性的节点列表
	proxiesRaw, ok := config["proxies"]
	if !ok {
		return nil, errors.New("no 'proxies' field found in YAML")
	}

	proxiesArray, ok := proxiesRaw.([]interface{})
	if !ok {
		return nil, errors.New("'proxies' field is not an array")
	}

	// 转换成substore的Proxy结构
	var proxies []substore.Proxy
	for _, p := range proxiesArray {
		proxyMap, ok := p.(map[string]interface{})
		if !ok {
			continue
		}
		proxies = append(proxies, substore.Proxy(proxyMap))
	}

	if len(proxies) == 0 {
		return nil, errors.New("no valid proxies found in YAML")
	}

	// clash-to-surge 类型使用 BuildCompleteSurgeConfig 生成完整的 Surge 配置
	if clientType == "clash-to-surge" {
		return h.convertClashToSurge(config, proxies)
	}

	factory := substore.GetDefaultFactory()

	// 根据客户端类型获取Producer
	producer, err := factory.GetProducer(clientType)
	if err != nil {
		return nil, fmt.Errorf("unsupported client type '%s': %w", clientType, err)
	}

	// 调用Produce方法生成转换后的节点, 传入完整配置供需要的 Producer 使用（如 Stash）
	// 获取系统配置以获取客户端兼容模式设置
	systemConfig, _ := h.repo.GetSystemConfig(ctx)
	opts := &substore.ProduceOptions{
		FullConfig:              config,
		ClientCompatibilityMode: systemConfig.ClientCompatibilityMode,
	}
	result, err := producer.Produce(proxies, "", opts)
	if err != nil {
		return nil, fmt.Errorf("failed to produce subscription: %w", err)
	}
	switch v := result.(type) {
	case string:
		return []byte(v), nil
	case []byte:
		return v, nil
	default:
		return nil, fmt.Errorf("unexpected result type from producer: %T, expected string or []byte", result)
	}
}

// ConvertClashToSurge 使用规则将 Clash 配置转换为 Surge 格式
func (h *SubscriptionHandler) convertClashToSurge(config map[string]interface{}, proxies []substore.Proxy) ([]byte, error) {
	// 解析 Clash 配置结构
	clashConfig := &substore.ClashConfig{}

	// 解析基本字段
	if port, ok := config["port"].(int); ok {
		clashConfig.Port = port
	}
	if socksPort, ok := config["socks-port"].(int); ok {
		clashConfig.SocksPort = socksPort
	}
	if allowLan, ok := config["allow-lan"].(bool); ok {
		clashConfig.AllowLan = allowLan
	}
	if mode, ok := config["mode"].(string); ok {
		clashConfig.Mode = mode
	}
	if logLevel, ok := config["log-level"].(string); ok {
		clashConfig.LogLevel = logLevel
	}
	if externalController, ok := config["external-controller"].(string); ok {
		clashConfig.ExternalController = externalController
	}

	// 解析 DNS 配置
	if dnsRaw, ok := config["dns"].(map[string]interface{}); ok {
		if enable, ok := dnsRaw["enable"].(bool); ok {
			clashConfig.DNS.Enable = enable
		}
		if ipv6, ok := dnsRaw["ipv6"].(bool); ok {
			clashConfig.DNS.IPv6 = ipv6
		}
		if enhancedMode, ok := dnsRaw["enhanced-mode"].(string); ok {
			clashConfig.DNS.EnhancedMode = enhancedMode
		}
		if nameservers, ok := dnsRaw["nameserver"].([]interface{}); ok {
			for _, ns := range nameservers {
				if nsStr, ok := ns.(string); ok {
					clashConfig.DNS.Nameserver = append(clashConfig.DNS.Nameserver, nsStr)
				}
			}
		}
		if defaultNS, ok := dnsRaw["default-nameserver"].([]interface{}); ok {
			for _, ns := range defaultNS {
				if nsStr, ok := ns.(string); ok {
					clashConfig.DNS.DefaultNameserver = append(clashConfig.DNS.DefaultNameserver, nsStr)
				}
			}
		}
	}

	// 解析 proxy-groups
	if groupsRaw, ok := config["proxy-groups"].([]interface{}); ok {
		for _, g := range groupsRaw {
			if gMap, ok := g.(map[string]interface{}); ok {
				group := substore.ClashProxyGroup{}
				if name, ok := gMap["name"].(string); ok {
					group.Name = name
				}
				if gType, ok := gMap["type"].(string); ok {
					group.Type = gType
				}
				if url, ok := gMap["url"].(string); ok {
					group.URL = url
				}
				if interval, ok := gMap["interval"].(int); ok {
					group.Interval = interval
				}
				if tolerance, ok := gMap["tolerance"].(int); ok {
					group.Tolerance = tolerance
				}
				if proxiesArr, ok := gMap["proxies"].([]interface{}); ok {
					for _, p := range proxiesArr {
						if pStr, ok := p.(string); ok {
							group.Proxies = append(group.Proxies, pStr)
						}
					}
				}
				clashConfig.ProxyGroups = append(clashConfig.ProxyGroups, group)
			}
		}
	}

	// 解析 rules
	if rulesRaw, ok := config["rules"].([]interface{}); ok {
		for _, r := range rulesRaw {
			if rStr, ok := r.(string); ok {
				clashConfig.Rules = append(clashConfig.Rules, rStr)
			}
		}
	}

	// 解析 rule-providers
	if providersRaw, ok := config["rule-providers"].(map[string]interface{}); ok {
		clashConfig.RuleProviders = make(map[string]substore.ClashRuleProvider)
		for name, p := range providersRaw {
			if pMap, ok := p.(map[string]interface{}); ok {
				provider := substore.ClashRuleProvider{}
				if pType, ok := pMap["type"].(string); ok {
					provider.Type = pType
				}
				if behavior, ok := pMap["behavior"].(string); ok {
					provider.Behavior = behavior
				}
				if url, ok := pMap["url"].(string); ok {
					provider.URL = url
				}
				if path, ok := pMap["path"].(string); ok {
					provider.Path = path
				}
				if interval, ok := pMap["interval"].(int); ok {
					provider.Interval = interval
				}
				if format, ok := pMap["format"].(string); ok {
					provider.Format = format
				}
				clashConfig.RuleProviders[name] = provider
			}
		}
	}

	// 使用 BuildCompleteSurgeConfig 生成完整 Surge 配置
	surgeConfig, err := substore.BuildCompleteSurgeConfig(clashConfig, proxies, nil, false)
	if err != nil {
		return nil, fmt.Errorf("failed to build Surge config: %w", err)
	}

	return []byte(surgeConfig), nil
}

// 修复 WireGuard 节点的 allowed-ips 字段类型
func fixWireGuardAllowedIPs(proxiesNode *yaml.Node) {
	if proxiesNode == nil || proxiesNode.Kind != yaml.SequenceNode {
		return
	}

	for _, proxyNode := range proxiesNode.Content {
		if proxyNode.Kind != yaml.MappingNode {
			continue
		}

		// 检查这是否是 WireGuard 节点
		isWireGuard := false
		for i := 0; i < len(proxyNode.Content); i += 2 {
			if i+1 >= len(proxyNode.Content) {
				break
			}
			if proxyNode.Content[i].Value == "type" && proxyNode.Content[i+1].Value == "wireguard" {
				isWireGuard = true
				break
			}
		}

		if !isWireGuard {
			continue
		}

		// 修复 allowed-ips 字段
		for i := 0; i < len(proxyNode.Content); i += 2 {
			if i+1 >= len(proxyNode.Content) {
				break
			}
			keyNode := proxyNode.Content[i]
			valueNode := proxyNode.Content[i+1]

			if keyNode.Value == "allowed-ips" {
				// 如果它已经是序列节点，只需清除所有字符串标签
				if valueNode.Kind == yaml.SequenceNode {
					valueNode.Tag = ""
					valueNode.Style = 0
					// 还清除子节点的标签
					for _, childNode := range valueNode.Content {
						if childNode.Tag == "!!str" {
							childNode.Tag = ""
						}
					}
				} else if valueNode.Kind == yaml.ScalarNode {
					// 如果它是带有 !!str 标签的标量或看起来像 JSON 数组，请清除该标签
					if valueNode.Tag == "!!str" || valueNode.Tag == "tag:yaml.org,2002:str" {
						valueNode.Tag = ""
						valueNode.Style = 0
					}
				}
				break
			}
		}
	}
}

// 重新排序序列节点中每个代理的字段
func reorderProxies(seqNode *yaml.Node) {
	if seqNode == nil || seqNode.Kind != yaml.SequenceNode {
		return
	}

	// 处理序列中的每个代理
	for _, proxyNode := range seqNode.Content {
		if proxyNode.Kind == yaml.MappingNode {
			reorderProxyNode(proxyNode)
		}
	}
}

// reorderProxyNode 重新排序代理配置字段
// 优先顺序：名称、类型、服务器、端口，然后是所有其他字段
func reorderProxyNode(proxyNode *yaml.Node) {
	if proxyNode == nil || proxyNode.Kind != yaml.MappingNode {
		return
	}

	// 按所需顺序排列优先级字段
	priorityFields := []string{"name", "type", "server", "port"}

	// 创建现有字段的地图
	fieldMap := make(map[string]*yaml.Node)
	fieldKeyNodes := make(map[string]*yaml.Node) // 存储原始关键节点以保留风格
	remainingFields := []*yaml.Node{}

	// 解析现有字段
	for i := 0; i < len(proxyNode.Content); i += 2 {
		if i+1 >= len(proxyNode.Content) {
			break
		}
		keyNode := proxyNode.Content[i]
		valueNode := proxyNode.Content[i+1]

		// 对 allowed-ips 字段进行特殊处理，以确保将其视为数组
		if keyNode.Value == "allowed-ips" && valueNode.Kind == yaml.ScalarNode {
			// 如果它是一个看起来像 JSON 数组的标量字符串，请显式标记它
			if valueNode.Tag == "!!str" || (valueNode.Style == yaml.DoubleQuotedStyle &&
				len(valueNode.Value) > 0 && valueNode.Value[0] == '[') {
				// 删除 !!str 标签并让 YAML 推断类型
				valueNode.Tag = ""
				valueNode.Style = 0
			}
		}

		// 检查这是否是优先字段
		isPriority := false
		for _, pf := range priorityFields {
			if keyNode.Value == pf {
				fieldMap[pf] = valueNode
				fieldKeyNodes[pf] = keyNode
				isPriority = true
				break
			}
		}

		// 如果不是优先级字段，请保存键和值以供以后使用
		if !isPriority {
			remainingFields = append(remainingFields, keyNode, valueNode)
		}
	}

	// 使用有序字段重建内容
	newContent := []*yaml.Node{}

	// 首先添加优先级字段（按顺序）
	for _, fieldName := range priorityFields {
		if valueNode, exists := fieldMap[fieldName]; exists {
			// 如果可用，则使用原始关键节点，否则创建新的
			keyNode := fieldKeyNodes[fieldName]
			if keyNode == nil {
				keyNode = &yaml.Node{
					Kind:  yaml.ScalarNode,
					Value: fieldName,
				}
			}
			newContent = append(newContent, keyNode, valueNode)
		}
	}

	// 添加剩余字段
	newContent = append(newContent, remainingFields...)

	// 替换原来的内容
	proxyNode.Content = newContent
}

// 重新排序序列节点中每个代理组的字段
func reorderProxyGroups(seqNode *yaml.Node) {
	if seqNode == nil || seqNode.Kind != yaml.SequenceNode {
		return
	}

	// 按顺序处理每个代理组
	for _, groupNode := range seqNode.Content {
		if groupNode.Kind == yaml.MappingNode {
			reorderProxyGroupFields(groupNode)
		}
	}
}

// reorderProxyGroupFields 重新排序代理组配置字段
// 优先级顺序：名称、类型、策略、代理、url、间隔、容差、惰性、隐藏
func reorderProxyGroupFields(groupNode *yaml.Node) {
	if groupNode == nil || groupNode.Kind != yaml.MappingNode {
		return
	}

	// 按所需顺序排列优先级字段
	priorityFields := []string{"name", "type", "strategy", "proxies", "url", "interval", "tolerance", "lazy", "hidden"}

	// 创建现有字段的地图
	fieldMap := make(map[string]*yaml.Node)
	remainingFields := []*yaml.Node{}

	// 解析现有字段
	for i := 0; i < len(groupNode.Content); i += 2 {
		if i+1 >= len(groupNode.Content) {
			break
		}
		keyNode := groupNode.Content[i]
		valueNode := groupNode.Content[i+1]

		// 检查这是否是优先字段
		isPriority := false
		for _, pf := range priorityFields {
			if keyNode.Value == pf {
				fieldMap[pf] = valueNode
				isPriority = true
				break
			}
		}

		// 如果不是优先级字段，请保存键和值以供以后使用
		if !isPriority {
			remainingFields = append(remainingFields, keyNode, valueNode)
		}
	}

	// 使用有序字段重建内容
	newContent := []*yaml.Node{}

	// 首先添加优先级字段（按顺序）
	for _, fieldName := range priorityFields {
		if valueNode, exists := fieldMap[fieldName]; exists {
			keyNode := &yaml.Node{
				Kind:  yaml.ScalarNode,
				Value: fieldName,
			}
			newContent = append(newContent, keyNode, valueNode)
		}
	}

	// 添加剩余字段
	newContent = append(newContent, remainingFields...)

	// 替换原来的内容
	groupNode.Content = newContent
}

// sortProxiesByNodeOrder 根据用户配置的节点顺序对 proxies 进行排序
// nodeOrder 是节点 ID 的数组，proxiesNode 是 YAML 中的 proxies 序列节点
func sortProxiesByNodeOrder(ctx context.Context, repo *storage.TrafficRepository, username string, proxiesNode *yaml.Node, nodeOrder []int64) error {
	if proxiesNode == nil || proxiesNode.Kind != yaml.SequenceNode {
		return errors.New("invalid proxies node")
	}

	if len(nodeOrder) == 0 || len(proxiesNode.Content) == 0 {
		return nil
	}

	// 获取用户的所有节点信息
	nodes, err := repo.ListNodes(ctx, username)
	if err != nil {
		return fmt.Errorf("failed to list nodes: %w", err)
	}

	// 创建节点名称 -> 节点ID 的映射
	nodeNameToID := make(map[string]int64)
	for _, node := range nodes {
		nodeNameToID[node.NodeName] = node.ID
	}

	// 创建节点 ID -> 排序位置的映射
	nodeIDToPosition := make(map[int64]int)
	for pos, nodeID := range nodeOrder {
		nodeIDToPosition[nodeID] = pos
	}

	// 创建 proxy 节点的排序信息
	type proxyWithOrder struct {
		node     *yaml.Node
		position int // 在 nodeOrder 中的位置，-1 表示不在 nodeOrder 中
		name     string
	}

	proxiesWithOrder := make([]proxyWithOrder, 0, len(proxiesNode.Content))

	// 解析每个 proxy 节点，获取其名称和排序位置
	for _, proxyNode := range proxiesNode.Content {
		if proxyNode.Kind != yaml.MappingNode {
			continue
		}

		// 查找 proxy 的 name 字段
		var proxyName string
		for i := 0; i < len(proxyNode.Content); i += 2 {
			if proxyNode.Content[i].Value == "name" {
				if i+1 < len(proxyNode.Content) {
					proxyName = proxyNode.Content[i+1].Value
				}
				break
			}
		}

		if proxyName == "" {
			// 如果没有 name 字段，保持原位置（放在最后）
			proxiesWithOrder = append(proxiesWithOrder, proxyWithOrder{
				node:     proxyNode,
				position: -1,
				name:     "",
			})
			continue
		}

		// 查找该节点名称对应的节点 ID
		nodeID, exists := nodeNameToID[proxyName]
		position := -1
		if exists {
			// 查找该节点 ID 在 nodeOrder 中的位置
			if pos, found := nodeIDToPosition[nodeID]; found {
				position = pos
			}
		}

		proxiesWithOrder = append(proxiesWithOrder, proxyWithOrder{
			node:     proxyNode,
			position: position,
			name:     proxyName,
		})
	}

	// 排序：按 position 升序排序，-1 的放在最后
	// 对于 position 相同的节点，保持原有顺序（稳定排序）
	sort.SliceStable(proxiesWithOrder, func(i, j int) bool {
		posI := proxiesWithOrder[i].position
		posJ := proxiesWithOrder[j].position

		// 如果 i 不在 nodeOrder 中，i 应该在 j 之后
		if posI == -1 {
			return false
		}
		// 如果 j 不在 nodeOrder 中，i 应该在 j 之前
		if posJ == -1 {
			return true
		}
		// 都在 nodeOrder 中，按 position 排序
		return posI < posJ
	})

	// 更新 proxiesNode 的内容
	newContent := make([]*yaml.Node, 0, len(proxiesWithOrder))
	for _, p := range proxiesWithOrder {
		newContent = append(newContent, p.node)
	}
	proxiesNode.Content = newContent

	logger.Info("[Subscription] 按节点顺序排序完成", "count", len(proxiesWithOrder), "user", username)
	return nil
}
