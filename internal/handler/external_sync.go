package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"miaomiaowux/internal/logger"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"miaomiaowux/internal/auth"
	"miaomiaowux/internal/storage"

	"gopkg.in/yaml.v3"
)

const defaultNodeNameFilterPattern = "剩余|流量|到期|订阅|时间|重置"

func applyNodeNameFilterToProxies(proxies []any, filterRegex *regexp.Regexp, filterPattern string) ([]any, int) {
	if filterRegex == nil || len(proxies) == 0 {
		return proxies, 0
	}

	filteredProxies := make([]any, 0, len(proxies))
	filteredCount := 0

	for _, proxy := range proxies {
		if proxyMap, ok := proxy.(map[string]any); ok {
			if proxyName, ok := proxyMap["name"].(string); ok {
				if filterRegex.MatchString(proxyName) {
					filteredCount++
					logger.Info("[外部订阅同步] 过滤节点", "name", proxyName, "pattern", filterPattern)
					continue
				}
			}
		}
		filteredProxies = append(filteredProxies, proxy)
	}

	return filteredProxies, filteredCount
}

// 用于由用户触发的手动同步 - 同步所有外部订阅，无论 ForceSyncExternal 设置如何
func syncExternalSubscriptionsManual(ctx context.Context, repo *storage.TrafficRepository, subscribeDir, username string) error {
	if repo == nil || username == "" {
		return fmt.Errorf("invalid parameters")
	}

	logger.Info("[外部订阅同步-手动] 开始手动同步外部订阅", "user", username)

	// 获取用户设置以检查匹配规则（但忽略 ForceSyncExternal 进行手动同步）
	userSettings, err := repo.GetUserSettings(ctx, username)
	if err != nil {
		logger.Info("[外部订阅同步-手动] 获取用户设置失败，使用默认设置", "error", err)
		userSettings.MatchRule = "node_name"
		userSettings.SyncScope = "saved_only"
		userSettings.KeepNodeName = true
		userSettings.NodeNameFilter = defaultNodeNameFilterPattern
	}

	matchRuleDesc := map[string]string{
		"node_name":        "节点名称",
		"server_port":      "服务器:端口",
		"type_server_port": "类型:服务器:端口",
	}
	syncScopeDesc := map[string]string{
		"saved_only": "仅同步已保存节点",
		"all":        "同步所有节点",
	}

	logger.Info("[外部订阅同步-手动] 同步配置",
		"match_rule", userSettings.MatchRule,
		"match_rule_desc", matchRuleDesc[userSettings.MatchRule],
		"sync_scope", userSettings.SyncScope,
		"sync_scope_desc", syncScopeDesc[userSettings.SyncScope],
		"keep_node_name", userSettings.KeepNodeName)

	// 获取用户的外部订阅
	externalSubs, err := repo.ListExternalSubscriptions(ctx, username)
	if err != nil {
		logger.Info("[外部订阅同步-手动] 获取外部订阅列表失败", "error", err)
		return fmt.Errorf("list external subscriptions: %w", err)
	}

	if len(externalSubs) == 0 {
		logger.Info("[外部订阅同步-手动] 没有配置外部订阅，跳过同步", "user", username)
		return nil
	}

	logger.Info("[外部订阅同步-手动] 外部订阅数量", "user", username, "count", len(externalSubs))

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// 跟踪已同步的节点总数
	totalNodesSynced := 0

	for i, sub := range externalSubs {
		logger.Info("[外部订阅同步-手动] 开始同步订阅", "index", i+1, "total", len(externalSubs), "name", sub.Name)
		nodeCount, updatedSub, err := syncSingleExternalSubscription(ctx, client, repo, subscribeDir, username, sub, userSettings)
		if err != nil {
			logger.Info("[外部订阅同步-手动] 同步订阅失败", "index", i+1, "total", len(externalSubs), "name", sub.Name, "error", err)
			continue
		}

		totalNodesSynced += nodeCount

		// 更新上次同步时间和节点数
		now := time.Now()
		updatedSub.LastSyncAt = &now
		updatedSub.NodeCount = nodeCount
		if err := repo.UpdateExternalSubscription(ctx, updatedSub); err != nil {
			logger.Info("[外部订阅同步-手动] 更新订阅同步时间失败", "name", sub.Name, "error", err)
		}
		logger.Info("[外部订阅同步-手动] 订阅同步完成", "index", i+1, "total", len(externalSubs), "name", sub.Name, "node_count", nodeCount)
	}

	logger.Info("[外部订阅同步-手动] 同步完成", "user", username, "subscription_count", len(externalSubs), "total_nodes", totalNodesSynced)

	return nil
}

// 从所有外部订阅中获取节点并更新节点表
func syncExternalSubscriptions(ctx context.Context, repo *storage.TrafficRepository, subscribeDir, username string) error {
	if repo == nil || username == "" {
		return fmt.Errorf("invalid parameters")
	}

	logger.Info("[外部订阅同步-自动] 用户 开始自动同步外部订阅", "user", username)

	// 获取用户设置以检查匹配规则和 ForceSyncExternal
	userSettings, err := repo.GetUserSettings(ctx, username)
	if err != nil {
		logger.Info("[外部订阅同步-自动] 获取用户设置失败，使用默认设置", "error", err)
		userSettings.MatchRule = "node_name"
		userSettings.SyncScope = "saved_only"
		userSettings.KeepNodeName = true
		userSettings.ForceSyncExternal = false
		userSettings.NodeNameFilter = defaultNodeNameFilterPattern
	}

	matchRuleDesc := map[string]string{
		"node_name":        "节点名称",
		"server_port":      "服务器:端口",
		"type_server_port": "类型:服务器:端口",
	}
	syncScopeDesc := map[string]string{
		"saved_only": "仅同步已保存节点",
		"all":        "同步所有节点",
	}

	logger.Info("[外部订阅同步-自动] 同步配置",
		"match_rule", userSettings.MatchRule,
		"match_rule_desc", matchRuleDesc[userSettings.MatchRule],
		"sync_scope", userSettings.SyncScope,
		"sync_scope_desc", syncScopeDesc[userSettings.SyncScope],
		"keep_node_name", userSettings.KeepNodeName)

	// 获取用户的外部订阅
	externalSubs, err := repo.ListExternalSubscriptions(ctx, username)
	if err != nil {
		logger.Info("[外部订阅同步-自动] 获取外部订阅列表失败", "error", err)
		return fmt.Errorf("list external subscriptions: %w", err)
	}

	if len(externalSubs) == 0 {
		logger.Info("[外部订阅同步-自动] 用户 没有配置外部订阅，跳过同步", "user", username)
		return nil
	}

	// 如果启用 ForceSyncExternal，则仅同步配置文件中使用的订阅
	var subsToSync []storage.ExternalSubscription
	if userSettings.ForceSyncExternal {
		logger.Info("[外部订阅同步-自动] 强制同步已开启，正在筛选配置文件中使用的订阅...")
		usedURLs, err := getUsedExternalSubscriptionURLs(ctx, repo, subscribeDir, username)
		if err != nil {
			logger.Info("[外部订阅同步-自动] 获取配置文件中使用的订阅URL失败，将同步所有订阅", "error", err)
			subsToSync = externalSubs
		} else {
			// 仅过滤配置文件中使用的订阅
			for _, sub := range externalSubs {
				if _, used := usedURLs[sub.URL]; used {
					subsToSync = append(subsToSync, sub)
					logger.Info("[外部订阅同步-自动] 订阅 在配置文件中被使用，将进行同步", "name", sub.Name)
				} else {
					logger.Info("[外部订阅同步-自动] 订阅 未在配置文件中使用，跳过同步", "name", sub.Name)
				}
			}
			logger.Info("[外部订阅同步-自动] 筛选完成", "sync_count", len(subsToSync), "total_count", len(externalSubs))
		}
	} else {
		subsToSync = externalSubs
	}

	if len(subsToSync) == 0 {
		logger.Info("[外部订阅同步-自动] 用户 没有需要同步的订阅", "user", username)
		return nil
	}

	logger.Info("[外部订阅同步-自动] 用户共有外部订阅需要同步", "user", username, "count", len(subsToSync))

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// 跟踪已同步的节点总数
	totalNodesSynced := 0

	for i, sub := range subsToSync {
		logger.Info("[外部订阅同步-自动] 开始同步订阅", "index", i+1, "total", len(subsToSync), "name", sub.Name)
		nodeCount, updatedSub, err := syncSingleExternalSubscription(ctx, client, repo, subscribeDir, username, sub, userSettings)
		if err != nil {
			logger.Info("[外部订阅同步-自动] 同步订阅失败", "index", i+1, "total", len(subsToSync), "name", sub.Name, "error", err)
			continue
		}

		totalNodesSynced += nodeCount

		// 更新上次同步时间和节点数
		// 使用包含来自 parseAndUpdateTrafficInfo 的流量信息的 UpdatedSub
		now := time.Now()
		updatedSub.LastSyncAt = &now
		updatedSub.NodeCount = nodeCount
		if err := repo.UpdateExternalSubscription(ctx, updatedSub); err != nil {
			logger.Info("[外部订阅同步-自动] 更新订阅 的同步时间失败", "name", sub.Name, "error", err)
		}
		logger.Info("[外部订阅同步-自动] 订阅同步完成", "index", i+1, "total", len(subsToSync), "name", sub.Name, "node_count", nodeCount)
	}

	logger.Info("[外部订阅同步-自动] 用户同步完成", "user", username, "subscription_count", len(subsToSync), "total_nodes", totalNodesSynced)

	return nil
}

// 提取用户订阅文件中使用的所有外部订阅 URL
func getUsedExternalSubscriptionURLs(ctx context.Context, repo *storage.TrafficRepository, subscribeDir, username string) (map[string]bool, error) {
	usedURLs := make(map[string]bool)

	if subscribeDir == "" {
		return usedURLs, fmt.Errorf("subscribe directory not configured")
	}

	// 获取该用户的所有订阅文件
	allFiles, err := repo.ListSubscribeFiles(ctx)
	if err != nil {
		return nil, fmt.Errorf("list subscribe files: %w", err)
	}

	// 从订阅目录中读取每个 YAML 文件
	for _, file := range allFiles {
		// 从磁盘读取 YAML 文件
		filePath := fmt.Sprintf("%s/%s", subscribeDir, file.Filename)
		content, err := os.ReadFile(filePath)
		if err != nil {
			logger.Info("[External Sync] Failed to read file", "value", filePath, "error", err)
			continue
		}

		// 解析 YAML 内容
		var yamlContent map[string]any
		if err := yaml.Unmarshal(content, &yamlContent); err != nil {
			logger.Info("[External Sync] Failed to parse YAML for file", "name", file.Name, "error", err)
			continue
		}

		// 提取代理提供商 URL
		if proxyProviders, ok := yamlContent["proxy-providers"].(map[string]any); ok {
			for _, provider := range proxyProviders {
				if providerMap, ok := provider.(map[string]any); ok {
					if url, ok := providerMap["url"].(string); ok && url != "" {
						usedURLs[url] = true
						logger.Info("[External Sync] Found used subscription URL in file", "name", file.Name, "param", url)
					}
				}
			}
		}
	}

	return usedURLs, nil
}

// syncSingleExternalSubscription 从单个外部订阅获取并同步节点
// 返回：节点数、更新的订阅信息、错误
func syncSingleExternalSubscription(ctx context.Context, client *http.Client, repo *storage.TrafficRepository, subscribeDir, username string, sub storage.ExternalSubscription, settings storage.UserSettings) (int, storage.ExternalSubscription, error) {
	matchRule := settings.MatchRule
	syncScope := settings.SyncScope
	keepNodeName := settings.KeepNodeName

	logger.Info("[外部订阅同步] 开始获取订阅内容", "name", sub.Name, "url", sub.URL)

	// 获取订阅内容
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sub.URL, nil)
	if err != nil {
		logger.Info("[外部订阅同步] 创建HTTP请求失败", "error", err)
		return 0, sub, fmt.Errorf("create request: %w", err)
	}

	// 使用订阅保存的 User-Agent，如果为空则使用默认值
	userAgent := sub.UserAgent
	if userAgent == "" {
		userAgent = "clash-meta/2.4.0"
	}
	req.Header.Set("User-Agent", userAgent)
	logger.Info("[外部订阅同步] 使用 User-Agent", "user_agent", userAgent)

	resp, err := client.Do(req)
	if err != nil {
		logger.Info("[外部订阅同步] 请求订阅URL失败", "error", err)
		return 0, sub, fmt.Errorf("fetch subscription: %w", err)
	}
	defer resp.Body.Close()

	logger.Info("[外部订阅同步] HTTP响应状态码", "status_code", resp.StatusCode)

	if resp.StatusCode != http.StatusOK {
		logger.Info("[外部订阅同步] 订阅返回非200状态码", "status_code", resp.StatusCode)
		return 0, sub, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	// 如果启用了sync_traffic，则解析订阅用户信息标头
	if settings.SyncTraffic {
		userInfo := resp.Header.Get("subscription-userinfo")
		if userInfo != "" {
			logger.Info("[外部订阅同步] 发现流量信息头，开始解析...")
			parseAndUpdateTrafficInfo(ctx, repo, &sub, userInfo)
		} else if !strings.Contains(strings.ToLower(userAgent), "clash") {
			logger.Info("[外部订阅同步] 未获取到流量信息，尝试使用 clash-meta UA 获取", "name", sub.Name)
			clashMetaUA := "clash-meta/2.4.0"
			trafficReq, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, sub.URL, nil)
			if reqErr == nil {
				trafficReq.Header.Set("User-Agent", clashMetaUA)
				trafficResp, doErr := client.Do(trafficReq)
				if doErr == nil {
					defer trafficResp.Body.Close()
					if trafficResp.StatusCode == http.StatusOK {
						trafficUserInfo := trafficResp.Header.Get("subscription-userinfo")
						if trafficUserInfo != "" {
							logger.Info("[外部订阅同步] clash-meta UA 获取流量信息成功", "name", sub.Name)
							parseAndUpdateTrafficInfo(ctx, repo, &sub, trafficUserInfo)
						}
					}
				} else {
					logger.Info("[外部订阅同步] clash-meta UA 请求失败", "error", doErr)
				}
			}
		}
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.Info("[外部订阅同步] 读取响应内容失败", "error", err)
		return 0, sub, fmt.Errorf("read response body: %w", err)
	}

	logger.Info("[外部订阅同步] 成功获取订阅内容", "size", len(body))

	var proxies []any

	// 预处理：处理 base64/v2ray 格式
	processedBody, preprocessErr := preprocessSubscriptionContent(body)
	if preprocessErr != nil {
		logger.Info("[外部订阅同步] 预处理订阅内容失败，使用原始内容", "error", preprocessErr)
		processedBody = body
	}

	// 解析 YAML 内容
	var yamlContent map[string]any
	if yamlErr := yaml.Unmarshal(processedBody, &yamlContent); yamlErr == nil {
		if p, ok := yamlContent["proxies"].([]any); ok && len(p) > 0 {
			proxies = p
			logger.Info("[外部订阅同步] 解析为 Clash YAML 格式", "name", sub.Name, "count", len(proxies))
		}
	}

	if len(proxies) == 0 {
		logger.Info("[外部订阅同步] 订阅中未找到节点(proxies)数据")
		return 0, sub, fmt.Errorf("no proxies found in subscription")
	}

	logger.Info("[外部订阅同步] 解析到节点", "name", sub.Name, "count", len(proxies))

	// 应用节点名称过滤
	nodeNameFilter := strings.TrimSpace(settings.NodeNameFilter)
	var filterRegex *regexp.Regexp
	if nodeNameFilter != "" {
		filterRegex, err = regexp.Compile(nodeNameFilter)
		if err != nil {
			logger.Info("[外部订阅同步] 节点名称过滤正则表达式无效，跳过过滤", "pattern", nodeNameFilter, "error", err)
		} else {
			filteredProxies, filteredCount := applyNodeNameFilterToProxies(proxies, filterRegex, nodeNameFilter)
			if filteredCount > 0 {
				logger.Info("[外部订阅同步] 节点过滤完成", "filtered_count", filteredCount, "remaining_count", len(filteredProxies))
			}
			proxies = filteredProxies
		}
	}

	// 转换为storage.Node格式
	nodesToUpdate := make([]storage.Node, 0, len(proxies))

	for _, proxy := range proxies {
		proxyMap, ok := proxy.(map[string]any)
		if !ok {
			continue
		}

		proxyName, ok := proxyMap["name"].(string)
		if !ok || proxyName == "" {
			continue
		}

		// 将代理编组为 JSON 以进行存储
		clashConfigBytes, err := json.Marshal(proxyMap)
		if err != nil {
			continue
		}

		// 也使用冲突配置作为解析配置
		parsedConfigBytes := clashConfigBytes

		// 确定协议类型
		protocol := "unknown"
		if proxyType, ok := proxyMap["type"].(string); ok {
			protocol = proxyType
		}

		node := storage.Node{
			Username:     username,
			RawURL:       sub.URL, // 保存外部订阅 URL 以供跟踪
			NodeName:     proxyName,
			Protocol:     protocol,
			ParsedConfig: string(parsedConfigBytes),
			ClashConfig:  string(clashConfigBytes),
			Enabled:      true,
			Tag:          sub.Name, // 使用外部订阅名称作为标签
			Tags:         []string{sub.Name},
		}

		nodesToUpdate = append(nodesToUpdate, node)
	}

	if len(nodesToUpdate) == 0 {
		logger.Info("[外部订阅同步] 没有有效的节点可以同步")
		return 0, sub, fmt.Errorf("no valid nodes to sync")
	}

	logger.Info("[外部订阅同步] 准备同步节点", "count", len(nodesToUpdate))

	// 获取现有节点一次
	existingNodes, err := repo.ListNodes(ctx, username)
	if err != nil {
		logger.Info("[外部订阅同步] 获取已保存节点列表失败", "error", err)
		return 0, sub, fmt.Errorf("list existing nodes: %w", err)
	}

	logger.Info("[外部订阅同步] 数据库中已有节点", "count", len(existingNodes))

	// 清理此订阅中匹配当前过滤规则的历史节点
	if filterRegex != nil {
		remainingNodes := make([]storage.Node, 0, len(existingNodes))
		removedByFilterCount := 0

		for _, existing := range existingNodes {
			if existing.RawURL == sub.URL && filterRegex.MatchString(existing.NodeName) {
				if delErr := repo.DeleteNodeForSync(ctx, existing.ID, username); delErr != nil {
					logger.Info("[外部订阅同步] 删除已过滤历史节点失败", "node_name", existing.NodeName, "id", existing.ID, "error", delErr)
					remainingNodes = append(remainingNodes, existing)
					continue
				}
				removedByFilterCount++
				logger.Info("[外部订阅同步] 删除已过滤历史节点", "node_name", existing.NodeName, "id", existing.ID)
				continue
			}
			remainingNodes = append(remainingNodes, existing)
		}

		if removedByFilterCount > 0 {
			logger.Info("[外部订阅同步] 清理历史过滤节点完成", "removed_count", removedByFilterCount)
		}
		existingNodes = remainingNodes
	}

	// 将节点同步到数据库（根据匹配规则替换节点）
	syncedCount := 0
	updatedCount := 0
	createdCount := 0
	skippedCount := 0

	for _, node := range nodesToUpdate {
		var existingNode *storage.Node

		// 解析新节点的冲突配置以进行匹配
		var newNodeClashConfig map[string]any
		if err := json.Unmarshal([]byte(node.ClashConfig), &newNodeClashConfig); err != nil {
			continue
		}

		newServer, _ := newNodeClashConfig["server"].(string)
		newPort := newNodeClashConfig["port"]
		newType, _ := newNodeClashConfig["type"].(string)

		// 根据规则进行匹配
		switch matchRule {
		case "type_server_port":
			matchKey := fmt.Sprintf("%s:%s:%v", newType, newServer, newPort)
			if newServer != "" && newPort != nil && newType != "" {
				for i := range existingNodes {
					var existingClashConfig map[string]any
					if err := json.Unmarshal([]byte(existingNodes[i].ClashConfig), &existingClashConfig); err == nil {
						existingServer, _ := existingClashConfig["server"].(string)
						if existingNodes[i].OriginalServer != "" {
							existingServer = existingNodes[i].OriginalServer
						}
						existingPort := existingClashConfig["port"]
						existingType, _ := existingClashConfig["type"].(string)

						if existingType == newType && existingServer == newServer && fmt.Sprintf("%v", existingPort) == fmt.Sprintf("%v", newPort) {
							existingNode = &existingNodes[i]
							logger.Info("[外部订阅同步] 节点 按 type:server:port 匹配成功 -> 已有节点", "node_name", node.NodeName, "param", matchKey, "node_name", existingNode.NodeName)
							break
						}
					}
				}
				if existingNode == nil {
					logger.Info("[外部订阅同步] 节点 按 type:server:port 未找到匹配", "node_name", node.NodeName, "param", matchKey)
				}
			}
		case "server_port":
			matchKey := fmt.Sprintf("%s:%v", newServer, newPort)
			if newServer != "" && newPort != nil {
				for i := range existingNodes {
					var existingClashConfig map[string]any
					if err := json.Unmarshal([]byte(existingNodes[i].ClashConfig), &existingClashConfig); err == nil {
						existingServer, _ := existingClashConfig["server"].(string)
						if existingNodes[i].OriginalServer != "" {
							existingServer = existingNodes[i].OriginalServer
						}
						existingPort := existingClashConfig["port"]

						if existingServer == newServer && fmt.Sprintf("%v", existingPort) == fmt.Sprintf("%v", newPort) {
							existingNode = &existingNodes[i]
							logger.Info("[外部订阅同步] 节点 按 server:port 匹配成功 -> 已有节点", "node_name", node.NodeName, "param", matchKey, "node_name", existingNode.NodeName)
							break
						}
					}
				}
				if existingNode == nil {
					logger.Info("[外部订阅同步] 节点 按 server:port 未找到匹配", "node_name", node.NodeName, "param", matchKey)
				}
			}
		default:
			// 默认：按节点名称匹配
			for i := range existingNodes {
				if existingNodes[i].NodeName == node.NodeName {
					existingNode = &existingNodes[i]
					logger.Info("[外部订阅同步] 节点 按名称匹配成功", "node_name", node.NodeName)
					break
				}
			}
			if existingNode == nil {
				logger.Info("[外部订阅同步] 节点 按名称未找到匹配", "node_name", node.NodeName)
			}
		}

		if existingNode != nil {
			// 更新现有节点
			oldNodeName := existingNode.NodeName

			// 如果节点做过 IP 解析（OriginalServer 非空），保留解析后的 IP
			var preservedIP string
			if existingNode.OriginalServer != "" {
				var currentClash map[string]any
				if err := json.Unmarshal([]byte(existingNode.ClashConfig), &currentClash); err == nil {
					if s, ok := currentClash["server"].(string); ok {
						preservedIP = s
					}
				}
			}

			// 从外部订阅更新节点字段
			existingNode.RawURL = node.RawURL
			existingNode.Protocol = node.Protocol
			existingNode.ParsedConfig = node.ParsedConfig
			existingNode.ClashConfig = node.ClashConfig
			existingNode.Enabled = node.Enabled
			existingNode.Tag = node.Tag

			// 恢复 IP 解析：把解析后的 IP 写回新配置，更新 OriginalServer 为新订阅的域名
			if preservedIP != "" {
				var newClash map[string]any
				if err := json.Unmarshal([]byte(existingNode.ClashConfig), &newClash); err == nil {
					if newDomain, ok := newClash["server"].(string); ok && newDomain != preservedIP {
						existingNode.OriginalServer = newDomain
						newClash["server"] = preservedIP
						if updated, err := json.Marshal(newClash); err == nil {
							existingNode.ClashConfig = string(updated)
						}
					} else {
						existingNode.OriginalServer = ""
					}
				}
				var newParsed map[string]any
				if err := json.Unmarshal([]byte(existingNode.ParsedConfig), &newParsed); err == nil {
					if _, ok := newParsed["server"]; ok && existingNode.OriginalServer != "" {
						newParsed["server"] = preservedIP
						if updated, err := json.Marshal(newParsed); err == nil {
							existingNode.ParsedConfig = string(updated)
						}
					}
				}
			}

			// 根据 keepNodeName 设置处理节点名称
			if !keepNodeName {
				existingNode.NodeName = node.NodeName // 从外部订阅更新为新名称
				if oldNodeName != node.NodeName {
					logger.Info("[外部订阅同步] 更新节点名称 ->", "value", oldNodeName, "node_name", node.NodeName)
				}
			} else {
				logger.Info("[外部订阅同步] 保留原节点名称 (外部订阅名称)", "value", oldNodeName, "node_name", node.NodeName)
				// 更新 ClashConfig 和 ParsedConfig 中的 name 字段为保留的节点名称
				var clashConfig map[string]any
				if err := json.Unmarshal([]byte(existingNode.ClashConfig), &clashConfig); err == nil {
					clashConfig["name"] = oldNodeName
					if updatedClash, err := json.Marshal(clashConfig); err == nil {
						existingNode.ClashConfig = string(updatedClash)
					}
				}
				var parsedConfig map[string]any
				if err := json.Unmarshal([]byte(existingNode.ParsedConfig), &parsedConfig); err == nil {
					parsedConfig["name"] = oldNodeName
					if updatedParsed, err := json.Marshal(parsedConfig); err == nil {
						existingNode.ParsedConfig = string(updatedParsed)
					}
				}
			}

			_, err := repo.UpdateNode(ctx, *existingNode)
			if err != nil {
				logger.Info("[外部订阅同步] 更新节点 失败", "node_name", existingNode.NodeName, "error", err)
				continue
			}

			logger.Info("[外部订阅同步] 成功更新节点 (ID)", "node_name", existingNode.NodeName, "id", existingNode.ID)

			// 同步到 YAML 文件（如果需要，可处理名称更改）
			if subscribeDir != "" {
				if err := syncNodeToYAMLFiles(subscribeDir, oldNodeName, existingNode.NodeName, existingNode.ClashConfig); err != nil {
					logger.Info("[外部订阅同步] 同步节点 到YAML文件失败", "node_name", existingNode.NodeName, "error", err)
				}
			}

			syncedCount++
			updatedCount++
		} else {
			// 在现有节点中未找到新节点
			// 检查同步范围：如果syncScope为“all”，则仅创建新节点
			if syncScope == "all" {
				_, err := repo.CreateNode(ctx, node)
				if err != nil {
					logger.Info("[外部订阅同步] 创建新节点 失败", "node_name", node.NodeName, "error", err)
					continue
				}
				logger.Info("[外部订阅同步] 成功创建新节点", "node_name", node.NodeName)
				syncedCount++
				createdCount++
			} else {
				logger.Info("[外部订阅同步] 跳过新节点 (同步范围: 仅已保存节点)", "node_name", node.NodeName)
				skippedCount++
			}
		}
	}

	logger.Info("[外部订阅同步] 订阅同步完成", "name", sub.Name, "synced_count", syncedCount, "total_count", len(nodesToUpdate), "updated", updatedCount, "created", createdCount, "skipped", skippedCount)

	return syncedCount, sub, nil
}

// ParseTrafficInfoHeader 解析 subscription-userinfo 标头并返回流量信息
// 格式：上传=0；下载=685404160；总计=1073741824；过期=1705276800
// 该函数只解析头部，不更新数据库
func ParseTrafficInfoHeader(userInfo string) (upload, download, total int64, expire *time.Time) {
	parts := strings.Split(userInfo, ";")

	for _, part := range parts {
		part = strings.TrimSpace(part)
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}

		key := strings.TrimSpace(kv[0])
		value := strings.TrimSpace(kv[1])

		switch key {
		case "upload":
			if v, err := strconv.ParseInt(value, 10, 64); err == nil {
				upload = v
			}
		case "download":
			if v, err := strconv.ParseInt(value, 10, 64); err == nil {
				download = v
			}
		case "total":
			if v, err := strconv.ParseInt(value, 10, 64); err == nil {
				total = v
			}
		case "expire":
			if v, err := strconv.ParseInt(value, 10, 64); err == nil && v > 0 {
				expireTime := time.Unix(v, 0)
				expire = &expireTime
			}
		}
	}

	return
}

// parseAndUpdateTrafficInfo 解析订阅用户信息标头并更新流量信息
// 格式：上传=0；下载=685404160；总计=1073741824；过期=1705276800
func parseAndUpdateTrafficInfo(ctx context.Context, repo *storage.TrafficRepository, sub *storage.ExternalSubscription, userInfo string) {
	logger.Info("[External Sync] Parsing traffic info for subscription ()", "name", sub.Name, "url", sub.URL)
	logger.Info("[External Sync] Raw subscription-userinfo", "value", userInfo)

	// 解析订阅用户信息
	// 示例：上传=0；下载=685404160；总计=1073741824；过期=1705276800
	parts := strings.Split(userInfo, ";")

	for _, part := range parts {
		part = strings.TrimSpace(part)
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}

		key := strings.TrimSpace(kv[0])
		value := strings.TrimSpace(kv[1])

		switch key {
		case "upload":
			if v, err := strconv.ParseInt(value, 10, 64); err == nil {
				sub.Upload = v
				logger.Info("[外部订阅同步] 解析上传流量", "bytes", v, "mb", float64(v)/(1024*1024))
			} else if f, err := strconv.ParseFloat(value, 64); err == nil {
				// 支持带小数点的值，取整
				sub.Upload = int64(f)
				logger.Info("[外部订阅同步] 解析上传流量(浮点)", "bytes", sub.Upload, "mb", f/(1024*1024))
			} else {
				logger.Info("[外部订阅同步] 解析上传流量失败", "value", value, "error", err)
			}
		case "download":
			if v, err := strconv.ParseInt(value, 10, 64); err == nil {
				sub.Download = v
				logger.Info("[外部订阅同步] 解析下载流量", "bytes", v, "mb", float64(v)/(1024*1024))
			} else if f, err := strconv.ParseFloat(value, 64); err == nil {
				// 支持带小数点的值，取整
				sub.Download = int64(f)
				logger.Info("[外部订阅同步] 解析下载流量(浮点)", "bytes", sub.Download, "mb", f/(1024*1024))
			} else {
				logger.Info("[外部订阅同步] 解析下载流量失败", "value", value, "error", err)
			}
		case "total":
			if v, err := strconv.ParseInt(value, 10, 64); err == nil {
				sub.Total = v
				logger.Info("[外部订阅同步] 解析总流量", "bytes", v, "gb", float64(v)/(1024*1024*1024))
			} else if f, err := strconv.ParseFloat(value, 64); err == nil {
				// 支持带小数点的值，取整
				sub.Total = int64(f)
				logger.Info("[外部订阅同步] 解析总流量(浮点)", "bytes", sub.Total, "gb", f/(1024*1024*1024))
			} else {
				logger.Info("[外部订阅同步] 解析总流量失败", "value", value, "error", err)
			}
		case "expire":
			if v, err := strconv.ParseInt(value, 10, 64); err == nil && v > 0 {
				expireTime := time.Unix(v, 0)
				sub.Expire = &expireTime
				logger.Info("[外部订阅同步] 解析过期时间", "expire", expireTime.Format("2006-01-02 15:04:05"))
			} else if f, err := strconv.ParseFloat(value, 64); err == nil && int64(f) > 0 {
				expireTime := time.Unix(int64(f), 0)
				sub.Expire = &expireTime
				logger.Info("[外部订阅同步] 解析过期时间(浮点)", "expire", expireTime.Format("2006-01-02 15:04:05"))
			}
		}
	}

	// 更新数据库中的订阅
	if err := repo.UpdateExternalSubscription(ctx, *sub); err != nil {
		logger.Info("[外部订阅同步] 更新订阅流量信息失败", "name", sub.Name, "error", err)
	} else {
		logger.Info("[外部订阅同步] 更新订阅流量信息成功", "name", sub.Name)
		logger.Info("[外部订阅同步] 上传流量", "bytes", sub.Upload, "mb", float64(sub.Upload)/(1024*1024))
		logger.Info("[外部订阅同步] 下载流量", "bytes", sub.Download, "mb", float64(sub.Download)/(1024*1024))
		logger.Info("[外部订阅同步] 总流量", "bytes", sub.Total, "gb", float64(sub.Total)/(1024*1024*1024))
		logger.Info("[外部订阅同步] 已用流量", "bytes", sub.Upload+sub.Download, "gb", float64(sub.Upload+sub.Download)/(1024*1024*1024))
		if sub.Expire != nil {
			logger.Info("[外部订阅同步] 过期时间", "expire", sub.Expire.Format("2006-01-02 15:04:05"))
		}
	}
}

// SyncExternalSubscriptionsHandler 是一个用于手动触发外部订阅同步的 HTTP 处理程序
type SyncExternalSubscriptionsHandler struct {
	repo         *storage.TrafficRepository
	subscribeDir string
}

// 创建用于手动同步的新处理程序
func NewSyncExternalSubscriptionsHandler(repo *storage.TrafficRepository, subscribeDir string) http.Handler {
	return &SyncExternalSubscriptionsHandler{
		repo:         repo,
		subscribeDir: subscribeDir,
	}
}

// SyncSingleExternalSubscriptionHandler 是一个用于同步单个外部订阅的 HTTP 处理程序
type SyncSingleExternalSubscriptionHandler struct {
	repo         *storage.TrafficRepository
	subscribeDir string
}

// 为单个订阅同步创建一个新的处理程序
func NewSyncSingleExternalSubscriptionHandler(repo *storage.TrafficRepository, subscribeDir string) http.Handler {
	return &SyncSingleExternalSubscriptionHandler{
		repo:         repo,
		subscribeDir: subscribeDir,
	}
}

func (h *SyncSingleExternalSubscriptionHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 从上下文中获取用户名（由 auth 中间件设置）
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// 从查询参数获取订阅 ID
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error": "缺少订阅ID参数",
		})
		return
	}

	subID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"error": "无效的订阅ID",
		})
		return
	}

	logger.Info("[Sync API] Single subscription sync triggered by user, subscription ID", "user", username, "param", subID)

	// 获取用户设置
	userSettings, err := h.repo.GetUserSettings(r.Context(), username)
	if err != nil {
		logger.Info("[Sync API] 获取用户设置失败，使用默认设置", "error", err)
		userSettings.MatchRule = "node_name"
		userSettings.SyncScope = "saved_only"
		userSettings.KeepNodeName = true
		userSettings.NodeNameFilter = defaultNodeNameFilterPattern
	}

	// 获取特定订阅
	externalSubs, err := h.repo.ListExternalSubscriptions(r.Context(), username)
	if err != nil {
		logger.Info("[Sync API] Failed to list external subscriptions", "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"error": "获取订阅列表失败",
		})
		return
	}

	// 通过ID查找订阅
	var targetSub *storage.ExternalSubscription
	for i := range externalSubs {
		if externalSubs[i].ID == subID {
			targetSub = &externalSubs[i]
			break
		}
	}

	if targetSub == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{
			"error": "未找到指定订阅",
		})
		return
	}

	logger.Info("[Sync API] 开始同步单个订阅 (ID)", "name", targetSub.Name, "id", targetSub.ID)

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	nodeCount, updatedSub, err := syncSingleExternalSubscription(r.Context(), client, h.repo, h.subscribeDir, username, *targetSub, userSettings)
	if err != nil {
		logger.Info("[Sync API] Failed to sync subscription", "name", targetSub.Name, "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"error": fmt.Sprintf("同步失败: %v", err),
		})
		return
	}

	// 更新上次同步时间和节点数
	now := time.Now()
	updatedSub.LastSyncAt = &now
	updatedSub.NodeCount = nodeCount
	if err := h.repo.UpdateExternalSubscription(r.Context(), updatedSub); err != nil {
		logger.Info("[Sync API] 更新订阅 的同步时间失败", "name", targetSub.Name, "error", err)
	}

	logger.Info("[Sync API] Successfully synced subscription , synced nodes", "name", targetSub.Name, "param", nodeCount)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"message":    fmt.Sprintf("订阅 %s 同步成功", targetSub.Name),
		"node_count": nodeCount,
	})
}

func (h *SyncExternalSubscriptionsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 从上下文中获取用户名（由 auth 中间件设置）
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	logger.Info("[Sync API] Manual sync triggered by user", "user", username)

	// 使用手动同步功能，忽略 ForceSyncExternal 设置
	if err := syncExternalSubscriptionsManual(r.Context(), h.repo, h.subscribeDir, username); err != nil {
		logger.Info("[Sync API] Failed to sync external subscriptions for user", "user", username, "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"error": fmt.Sprintf("同步失败: %v", err),
		})
		return
	}

	logger.Info("[Sync API] Successfully synced external subscriptions for user", "user", username)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "外部订阅同步成功",
	})
}

