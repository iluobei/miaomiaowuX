package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"miaomiaowu/internal/logger"
	"net/http"
	"strings"

	"miaomiaowu/internal/auth"
	"miaomiaowu/internal/storage"
	"miaomiaowu/internal/validator"

	"gopkg.in/yaml.v3"
)

type applyCustomRulesRequest struct {
	YamlContent string `json:"yaml_content"`
}

type applyCustomRulesResponse struct {
	YamlContent      string   `json:"yaml_content"`
	AddedProxyGroups []string `json:"added_proxy_groups,omitempty"`
}

// 返回将自定义规则应用于 YAML 内容的处理程序
func NewApplyCustomRulesHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("apply custom rules handler requires repository")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
			return
		}

		username := auth.UsernameFromContext(r.Context())
		if strings.TrimSpace(username) == "" {
			writeError(w, http.StatusUnauthorized, errors.New("unauthorized"))
			return
		}

		// 检查自定义规则是否启用
		settings, err := repo.GetUserSettings(r.Context(), username)
		if err != nil || !settings.CustomRulesEnabled {
			// 如果未启用，则返回原始YAML
			var payload applyCustomRulesRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}

			resp := applyCustomRulesResponse{
				YamlContent: payload.YamlContent,
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(resp)
			return
		}

		var payload applyCustomRulesRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if strings.TrimSpace(payload.YamlContent) == "" {
			writeError(w, http.StatusBadRequest, errors.New("yaml_content is required"))
			return
		}

		// 应用自定义规则
		modifiedYaml, addedGroups, err := applyCustomRulesToYaml(r.Context(), repo, []byte(payload.YamlContent))
		if err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Errorf("failed to apply custom rules: %w", err))
			return
		}

		resp := applyCustomRulesResponse{
			YamlContent:      string(modifiedYaml),
			AddedProxyGroups: addedGroups,
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})
}

// applyCustomRulesToYaml 将启用的自定义规则应用于 YAML 数据
// 返回修改后的 YAML 和添加的代理组列表
func applyCustomRulesToYaml(ctx context.Context, repo *storage.TrafficRepository, yamlData []byte) ([]byte, []string, error) {
	rules, err := repo.ListEnabledCustomRules(ctx, "")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get custom rules: %w", err)
	}

	if len(rules) == 0 {
		return yamlData, nil, nil
	}

	// 将 YAML 数据解析为 Node 以保留结构和顺序
	var rootNode yaml.Node
	if err := yaml.Unmarshal(yamlData, &rootNode); err != nil {
		return nil, nil, fmt.Errorf("failed to parse YAML: %w", err)
	}

	// 获取文档节点
	if rootNode.Kind != yaml.DocumentNode || len(rootNode.Content) == 0 {
		return yamlData, nil, nil
	}

	docNode := rootNode.Content[0]
	if docNode.Kind != yaml.MappingNode {
		return yamlData, nil, nil
	}

	// 使用 Node API 根据其类型应用每个规则
	for _, rule := range rules {
		switch rule.Type {
		case "dns":
			applyDNSRuleToNode(docNode, rule)
		case "rules":
			applyRulesRuleToNode(docNode, rule)
		case "rule-providers":
			applyRuleProvidersRuleToNode(docNode, rule)
		}
	}

	// 自动添加规则中引用的缺失代理组
	addedGroups := autoAddMissingProxyGroups(docNode)

	// 校验应用规则后的配置
	var configMap map[string]interface{}
	var tempBuf bytes.Buffer
	tempEncoder := yaml.NewEncoder(&tempBuf)
	tempEncoder.SetIndent(2)
	if err := tempEncoder.Encode(&rootNode); err != nil {
		return nil, nil, fmt.Errorf("编码配置用于校验失败: %w", err)
	}
	if err := yaml.Unmarshal(tempBuf.Bytes(), &configMap); err != nil {
		return nil, nil, fmt.Errorf("解析配置用于校验失败: %w", err)
	}

	validationResult := validator.ValidateClashConfig(configMap)
	if !validationResult.Valid {
		logger.Info("[应用自定义规则] [配置校验] 校验失败")
		var errorMessages []string
		for _, issue := range validationResult.Issues {
			if issue.Level == validator.ErrorLevel {
				errorMsg := issue.Message
				if issue.Location != "" {
					errorMsg = fmt.Sprintf("%s (位置: %s)", errorMsg, issue.Location)
				}
				errorMessages = append(errorMessages, errorMsg)
				logger.Info("[应用自定义规则] [配置校验] 错误", "message", errorMsg)
			}
		}
		return nil, nil, fmt.Errorf("配置校验失败: %s", strings.Join(errorMessages, "; "))
	}

	// 如果有自动修复，使用修复后的配置
	if validationResult.FixedConfig != nil {
		fixedYAML, err := yaml.Marshal(validationResult.FixedConfig)
		if err != nil {
			return nil, nil, fmt.Errorf("序列化修复配置失败: %w", err)
		}
		if err := yaml.Unmarshal(fixedYAML, &rootNode); err != nil {
			return nil, nil, fmt.Errorf("解析修复配置失败: %w", err)
		}

		// 记录自动修复的警告
		for _, issue := range validationResult.Issues {
			if issue.Level == validator.WarningLevel && issue.AutoFixed {
				logger.Info("[应用自定义规则] [配置校验] 警告(已修复)", "message", issue.Message, "location", issue.Location)
			}
		}
	}

	// 修复短 ID 字段以在封送之前使用双引号
	fixShortIdStyleInNode(&rootNode)

	// Marshal the modified node (使用2空格缩进)
	modifiedData, err := MarshalYAMLWithIndent(&rootNode)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to marshal modified YAML: %w", err)
	}

	// 后处理以从带有 Unicode 字符（表情符号）的字符串中删除引号
	result := RemoveUnicodeEscapeQuotes(string(modifiedData))

	return []byte(result), addedGroups, nil
}

// applyCustomRulesToYamlSmart 通过智能重复数据删除应用自定义规则
// 此功能用于自动同步，以避免前置模式下重复内容
func applyCustomRulesToYamlSmart(ctx context.Context, repo *storage.TrafficRepository, yamlData []byte, subscribeFileID int64) ([]byte, []string, error) {
	// 获取启用的自定义规则
	rules, err := repo.ListEnabledCustomRules(ctx, "")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get custom rules: %w", err)
	}

	if len(rules) == 0 {
		return yamlData, nil, nil
	}

	// 获取历史申请记录
	applications, err := repo.GetCustomRuleApplications(ctx, subscribeFileID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get custom rule applications: %w", err)
	}

	// 构建历史应用地图以便快速查找
	historyMap := make(map[string]*storage.CustomRuleApplication)
	for i := range applications {
		key := fmt.Sprintf("%d-%s", applications[i].CustomRuleID, applications[i].RuleType)
		historyMap[key] = &applications[i]
	}

	// 使用 Node API 解析 YAML 以保留顺序
	var rootNode yaml.Node
	if err := yaml.Unmarshal(yamlData, &rootNode); err != nil {
		return nil, nil, fmt.Errorf("failed to parse YAML: %w", err)
	}

	// 获取文档节点
	if rootNode.Kind != yaml.DocumentNode || len(rootNode.Content) == 0 {
		return yamlData, nil, nil
	}

	docNode := rootNode.Content[0]
	if docNode.Kind != yaml.MappingNode {
		return yamlData, nil, nil
	}

	// 使用 Node API 应用每个规则并进行重复数据删除
	for _, rule := range rules {
		key := fmt.Sprintf("%d-%s", rule.ID, rule.Type)
		prevApp := historyMap[key]

		// 计算内容哈希以进行更改检测
		contentHash := fmt.Sprintf("%x", sha256.Sum256([]byte(rule.Content)))

		// 如果内容没有改变并且模式被替换，则跳过
		if prevApp != nil && prevApp.ContentHash == contentHash && rule.Mode == "replace" {
			continue
		}

		switch rule.Type {
		case "dns":
			applyDNSRuleToNodeSmart(docNode, rule, prevApp, ctx, repo, subscribeFileID, contentHash)

		case "rules":
			applyRulesRuleToNodeSmart(docNode, rule, prevApp, ctx, repo, subscribeFileID, contentHash)

		case "rule-providers":
			applyRuleProvidersRuleToNodeSmart(docNode, rule, prevApp, ctx, repo, subscribeFileID, contentHash)
		}
	}

	// 自动添加规则中引用的缺失代理组
	addedGroups := autoAddMissingProxyGroups(docNode)

	// 修复短 ID 字段以在封送之前使用双引号
	fixShortIdStyleInNode(&rootNode)

	// Marshal the modified node (使用2空格缩进)
	modifiedData, err := MarshalYAMLWithIndent(&rootNode)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to marshal modified YAML: %w", err)
	}

	// 后处理以从带有 Unicode 字符（表情符号）的字符串中删除引号
	result := RemoveUnicodeEscapeQuotes(string(modifiedData))

	return []byte(result), addedGroups, nil
}

// 应用 DNS 自定义规则
func applyDNSRule(config map[string]interface{}, rule storage.CustomRule, prevApp *storage.CustomRuleApplication) error {
	var parsedContent map[string]interface{}
	if err := yaml.Unmarshal([]byte(rule.Content), &parsedContent); err != nil {
		return err
	}

	if dnsValue, hasDnsKey := parsedContent["dns"]; hasDnsKey {
		config["dns"] = dnsValue
	} else {
		config["dns"] = parsedContent
	}

	return nil
}

// 应用具有重复数据删除功能的自定义规则
func applyRulesRule(config map[string]interface{}, rule storage.CustomRule, prevApp *storage.CustomRuleApplication) (string, error) {
	// 解析规则内容
	var newRules []interface{}

	// 尝试首先解析为地图（使用“rules:”键）
	var parsedAsMap map[string]interface{}
	if err := yaml.Unmarshal([]byte(rule.Content), &parsedAsMap); err == nil {
		if rulesValue, hasRulesKey := parsedAsMap["rules"]; hasRulesKey {
			if rulesArray, ok := rulesValue.([]interface{}); ok {
				newRules = rulesArray
			}
		}
	}

	// 尝试解析为 YAML 数组
	if len(newRules) == 0 {
		if err := yaml.Unmarshal([]byte(rule.Content), &newRules); err != nil {
			// 解析为纯文本
			lines := strings.Split(rule.Content, "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line != "" && !strings.HasPrefix(line, "#") {
					newRules = append(newRules, line)
				}
			}
		}
	}

	if len(newRules) == 0 {
		return "", errors.New("no rules parsed")
	}

	// 获取现有规则
	existingRules, ok := config["rules"].([]interface{})
	if !ok {
		existingRules = []interface{}{}
	}

	if rule.Mode == "replace" {
		config["rules"] = newRules
	} else if rule.Mode == "prepend" {
		// 删除历史内容（如果存在）
		if prevApp != nil && prevApp.AppliedContent != "" {
			var historicalRules []interface{}
			if err := json.Unmarshal([]byte(prevApp.AppliedContent), &historicalRules); err == nil {
				existingRules = removeRulesFromList(existingRules, historicalRules)
			}
		}
		// 前置新规则
		config["rules"] = append(newRules, existingRules...)
	} else if rule.Mode == "append" {
		// 删除历史内容（如果存在）
		if prevApp != nil && prevApp.AppliedContent != "" {
			var historicalRules []interface{}
			if err := json.Unmarshal([]byte(prevApp.AppliedContent), &historicalRules); err == nil {
				existingRules = removeRulesFromList(existingRules, historicalRules)
			}
		}
		// 从现有规则中删除与新规则匹配的任何规则（不区分大小写，基于第二个逗号之前的文本）
		existingRules = removeDuplicateRulesCaseInsensitive(existingRules, newRules)
		// 追加新规则
		config["rules"] = append(existingRules, newRules...)
	}

	// 序列化应用的内容以进行跟踪
	appliedJSON, _ := json.Marshal(newRules)
	return string(appliedJSON), nil
}

// 应用具有重复数据删除功能的规则提供者自定义规则
func applyRuleProvidersRule(config map[string]interface{}, rule storage.CustomRule, prevApp *storage.CustomRuleApplication) (string, error) {
	var parsedContent map[string]interface{}
	if err := yaml.Unmarshal([]byte(rule.Content), &parsedContent); err != nil {
		return "", err
	}

	// 提取提供商地图
	var providersMap map[string]interface{}
	if providersValue, hasProvidersKey := parsedContent["rule-providers"]; hasProvidersKey {
		var ok bool
		providersMap, ok = providersValue.(map[string]interface{})
		if !ok {
			return "", errors.New("invalid rule-providers format")
		}
	} else {
		providersMap = parsedContent
	}

	if len(providersMap) == 0 {
		return "", errors.New("no providers parsed")
	}

	existingProviders, ok := config["rule-providers"].(map[string]interface{})
	if !ok {
		existingProviders = make(map[string]interface{})
	}

	if rule.Mode == "replace" {
		config["rule-providers"] = providersMap
	} else if rule.Mode == "prepend" {
		// 删除历史提供程序（如果存在）
		if prevApp != nil && prevApp.AppliedContent != "" {
			var historicalProviders map[string]interface{}
			if err := json.Unmarshal([]byte(prevApp.AppliedContent), &historicalProviders); err == nil {
				for key := range historicalProviders {
					delete(existingProviders, key)
				}
			}
		}
		// 合并新提供商（新提供商优先）
		for k, v := range providersMap {
			existingProviders[k] = v
		}
		config["rule-providers"] = existingProviders
	}

	// 序列化应用的内容以进行跟踪
	appliedJSON, _ := json.Marshal(providersMap)
	return string(appliedJSON), nil
}

// 从列表中删除规则
func removeRulesFromList(existing []interface{}, toRemove []interface{}) []interface{} {
	// 构建一组要删除的规则以进行 O(n) 查找
	removeSet := make(map[string]bool)
	for _, rule := range toRemove {
		if ruleStr, ok := rule.(string); ok {
			removeSet[ruleStr] = true
		}
	}

	// 过滤掉删除集中的规则
	var filtered []interface{}
	for _, rule := range existing {
		if ruleStr, ok := rule.(string); ok {
			if !removeSet[ruleStr] {
				filtered = append(filtered, rule)
			}
		} else {
			// 保持非字符串规则不变
			filtered = append(filtered, rule)
		}
	}

	return filtered
}

// 从现有列表中删除与 newRules 匹配的规则（不区分大小写）
func removeDuplicateRulesCaseInsensitive(existing []interface{}, newRules []interface{}) []interface{} {
	// 为 O(n) 查找构建一组小写新规则
	// 提取第二个逗号之前的文本进行比较
	newRulesSet := make(map[string]bool)
	hasMatchRule := false
	for _, rule := range newRules {
		if ruleStr, ok := rule.(string); ok {
			// 提取第二个逗号之前的文本
			key := extractRuleKey(ruleStr)
			newRulesSet[strings.ToLower(key)] = true

			// 检查newRules中是否有MATCH规则（处理带有“-”前缀的YAML格式）
			if isMatchRule(ruleStr) {
				hasMatchRule = true
			}
		}
	}

	// 过滤掉与新规则匹配的现有规则（不区分大小写）
	var filtered []interface{}
	for _, rule := range existing {
		if ruleStr, ok := rule.(string); ok {
			// 提取第二个逗号之前的文本进行比较
			key := extractRuleKey(ruleStr)

			// 如果 newRules 包含 MATCH 规则，则从现有规则中删除所有 MATCH 规则
			if hasMatchRule && isMatchRule(ruleStr) {
				logger.Info("删除重复的MATCH规则", "rule", ruleStr)
				continue
			}

			// 仅保留不重复的内容（不区分大小写）
			if !newRulesSet[strings.ToLower(key)] {
				filtered = append(filtered, rule)
			} else {
				logger.Info("删除重复规则", "rule", ruleStr)
			}
		} else {
			// 保持非字符串规则不变
			filtered = append(filtered, rule)
		}
	}

	return filtered
}

// 从规则字符串中提取第二个逗号之前的文本
func extractRuleKey(ruleStr string) string {
	// 计算逗号并提取第二个逗号之前的文本
	commaCount := 0
	for i, ch := range ruleStr {
		if ch == ',' {
			commaCount++
			if commaCount == 2 {
				return ruleStr[:i]
			}
		}
	}
	// 如果少于 2 个逗号，则返回整个字符串
	return ruleStr
}

// 检查规则字符串是否为 MATCH 规则（处理带“-”前缀的 YAML 格式）
func isMatchRule(ruleStr string) bool {
	// 修剪空格并删除 YAML 列表前缀“-”（如果存在）
	trimmed := strings.TrimSpace(ruleStr)
	if strings.HasPrefix(trimmed, "- ") {
		trimmed = strings.TrimSpace(trimmed[2:])
	}
	// 检查是否以 MATCH 开头（不区分大小写）
	return strings.HasPrefix(strings.ToUpper(trimmed), "MATCH")
}

// removeDuplicateNodesBasedOnNewRules 根据 newRules 从现有的 yaml 节点中删除重复的 yaml 节点
// 使用与removeDuplicateRulesCaseInsensitive相同的逻辑，但与yaml.Node一起使用
func removeDuplicateNodesBasedOnNewRules(existing []*yaml.Node, newRules []*yaml.Node) []*yaml.Node {
	// 为 O(n) 查找构建一组小写新规则
	newRulesSet := make(map[string]bool)
	hasMatchRule := false

	for _, node := range newRules {
		if node.Kind == yaml.ScalarNode {
			ruleStr := node.Value
			key := extractRuleKey(ruleStr)
			newRulesSet[strings.ToLower(key)] = true

			if isMatchRule(ruleStr) {
				hasMatchRule = true
			}
		}
	}

	// 过滤掉与新规则匹配的现有规则
	var filtered []*yaml.Node

	for _, node := range existing {
		if node.Kind == yaml.ScalarNode {
			ruleStr := node.Value

			// 始终保留规则集规则
			trimmed := strings.TrimSpace(ruleStr)
			if strings.HasPrefix(trimmed, "- ") {
				trimmed = strings.TrimSpace(trimmed[2:])
			}
			if strings.HasPrefix(strings.ToUpper(trimmed), "RULE-SET") {
				filtered = append(filtered, node)
				continue
			}

			key := extractRuleKey(ruleStr)

			// 如果 newRules 包含 MATCH 规则，则从现有规则中删除所有 MATCH 规则
			if hasMatchRule && isMatchRule(ruleStr) {
				logger.Info("删除重复的MATCH规则", "rule", ruleStr)
				continue
			}

			// 仅保留（如果不重复）
			if !newRulesSet[strings.ToLower(key)] {
				filtered = append(filtered, node)
			} else {
				logger.Info("删除重复规则", "rule", ruleStr)
			}
		} else {
			// 保持非标量节点不变
			filtered = append(filtered, node)
		}
	}

	return filtered
}

// recordApplication记录了将来重复数据删除所应用的内容
func recordApplication(ctx context.Context, repo *storage.TrafficRepository, fileID int64, rule storage.CustomRule, appliedContent string, contentHash string) error {
	app := &storage.CustomRuleApplication{
		SubscribeFileID: fileID,
		CustomRuleID:    rule.ID,
		RuleType:        rule.Type,
		RuleMode:        rule.Mode,
		AppliedContent:  appliedContent,
		ContentHash:     contentHash,
	}

	return repo.UpsertCustomRuleApplication(ctx, app)
}

// 从规则节点中提取 RULE-SET 类型规则
func extractRuleSetRules(rulesNode *yaml.Node) []*yaml.Node {
	var ruleSetRules []*yaml.Node
	if rulesNode == nil || rulesNode.Kind != yaml.SequenceNode {
		return ruleSetRules
	}

	for _, node := range rulesNode.Content {
		if node.Kind == yaml.ScalarNode {
			trimmed := strings.TrimSpace(node.Value)
			if strings.HasPrefix(trimmed, "- ") {
				trimmed = strings.TrimSpace(trimmed[2:])
			}
			// 检查这是否是 RULE-SET 规则（不区分大小写）
			if strings.HasPrefix(strings.ToUpper(trimmed), "RULE-SET") {
				ruleSetRules = append(ruleSetRules, node)
			}
		}
	}
	return ruleSetRules
}

// autoAddMissingProxyGroups 检查规则并自动添加缺少的代理组
// 返回已添加的代理组名称的列表
func autoAddMissingProxyGroups(docNode *yaml.Node) []string {
	// 获取规则节点
	rulesNode, _ := findFieldNode(docNode, "rules")
	if rulesNode == nil || rulesNode.Kind != yaml.SequenceNode {
		return []string{}
	}

	// 获取代理组节点
	proxyGroupsNode, proxyGroupsIdx := findFieldNode(docNode, "proxy-groups")
	if proxyGroupsNode == nil || proxyGroupsNode.Kind != yaml.SequenceNode {
		return []string{}
	}

	// 收集现有代理组名称
	existingGroups := make(map[string]bool)
	for _, groupNode := range proxyGroupsNode.Content {
		if groupNode.Kind == yaml.MappingNode {
			nameNode, _ := findFieldNode(groupNode, "name")
			if nameNode != nil && nameNode.Kind == yaml.ScalarNode {
				existingGroups[nameNode.Value] = true
			}
		}
	}

	// 收集规则中引用的代理组
	referencedGroups := make(map[string]bool)
	for _, ruleNode := range rulesNode.Content {
		if ruleNode.Kind == yaml.ScalarNode {
			// 解析规则：TYPE,PARAM,POLICY 或 TYPE,PARAM,POLICY,no-resolve
			parts := strings.Split(ruleNode.Value, ",")
			if len(parts) >= 3 {
				var policy string
				// 检查最后一部分是否“无法解决”
				lastPart := strings.TrimSpace(parts[len(parts)-1])
				if lastPart == "no-resolve" && len(parts) >= 4 {
					// 策略在“no-resolve”之前：TYPE、PARAM、POLICY、no-resolve
					policy = strings.TrimSpace(parts[len(parts)-2])
				} else {
					// 策略是最后一部分：TYPE,PARAM,POLICY
					policy = lastPart
				}
				// 跳过内置策略
				if policy != "DIRECT" && policy != "REJECT" && policy != "PROXY" && policy != "" {
					referencedGroups[policy] = true
				}
			} else if len(parts) == 2 {
				// 匹配、策略格式
				policy := strings.TrimSpace(parts[1])
				if policy != "DIRECT" && policy != "REJECT" && policy != "PROXY" && policy != "" {
					referencedGroups[policy] = true
				}
			}
		}
	}

	// 查找缺失的组
	var missingGroups []string
	for group := range referencedGroups {
		if !existingGroups[group] {
			missingGroups = append(missingGroups, group)
		}
	}

	// 添加缺失的组
	if len(missingGroups) > 0 {
		for _, groupName := range missingGroups {
			logger.Info("自动添加缺失的代理组", "group_name", groupName)

			// 根据组名称确定默认代理顺序
			// 对于家政服务团体，DIRECT应该是第一位的
			var defaultProxies []*yaml.Node
			if groupName == "🔒 国内服务" {
				defaultProxies = []*yaml.Node{
					{Kind: yaml.ScalarNode, Value: "DIRECT"},
					{Kind: yaml.ScalarNode, Value: "🚀 节点选择"},
				}
			} else {
				defaultProxies = []*yaml.Node{
					{Kind: yaml.ScalarNode, Value: "🚀 节点选择"},
					{Kind: yaml.ScalarNode, Value: "DIRECT"},
				}
			}

			// 创建新的代理组节点
			newGroupNode := &yaml.Node{
				Kind: yaml.MappingNode,
				Content: []*yaml.Node{
					{Kind: yaml.ScalarNode, Value: "name"},
					{Kind: yaml.ScalarNode, Value: groupName},
					{Kind: yaml.ScalarNode, Value: "type"},
					{Kind: yaml.ScalarNode, Value: "select"},
					{Kind: yaml.ScalarNode, Value: "proxies"},
					{
						Kind:    yaml.SequenceNode,
						Content: defaultProxies,
					},
				},
			}

			// 附加到代理组
			proxyGroupsNode.Content = append(proxyGroupsNode.Content, newGroupNode)
		}

		// 更新 docNode 中的 proxy-groups 节点
		if proxyGroupsIdx >= 0 {
			docNode.Content[proxyGroupsIdx] = proxyGroupsNode
		}
	}

	return missingGroups
}

// 从规则内容中提取代理组名称
func extractProxyGroupsFromRulesContent(content string) []string {
	var groups []string
	groupSet := make(map[string]bool)

	// 将内容解析为 YAML 以获取规则列表
	var rulesData interface{}
	if err := yaml.Unmarshal([]byte(content), &rulesData); err != nil {
		return groups
	}

	// 处理不同格式
	var rulesList []string
	switch v := rulesData.(type) {
	case []interface{}:
		for _, rule := range v {
			if ruleStr, ok := rule.(string); ok {
				rulesList = append(rulesList, ruleStr)
			}
		}
	case map[string]interface{}:
		if rules, ok := v["rules"].([]interface{}); ok {
			for _, rule := range rules {
				if ruleStr, ok := rule.(string); ok {
					rulesList = append(rulesList, ruleStr)
				}
			}
		}
	}

	// 从规则中提取代理组
	for _, ruleStr := range rulesList {
		parts := strings.Split(ruleStr, ",")
		if len(parts) >= 3 {
			var policy string
			lastPart := strings.TrimSpace(parts[len(parts)-1])
			if lastPart == "no-resolve" && len(parts) >= 4 {
				policy = strings.TrimSpace(parts[len(parts)-2])
			} else {
				policy = lastPart
			}
			// 跳过内置策略
			if policy != "DIRECT" && policy != "REJECT" && policy != "PROXY" && policy != "" {
				if !groupSet[policy] {
					groupSet[policy] = true
					groups = append(groups, policy)
				}
			}
		} else if len(parts) == 2 {
			policy := strings.TrimSpace(parts[1])
			if policy != "DIRECT" && policy != "REJECT" && policy != "PROXY" && policy != "" {
				if !groupSet[policy] {
					groupSet[policy] = true
					groups = append(groups, policy)
				}
			}
		}
	}

	return groups
}

// 在映射节点中通过键查找字段节点
func findFieldNode(mappingNode *yaml.Node, key string) (*yaml.Node, int) {
	if mappingNode.Kind != yaml.MappingNode {
		return nil, -1
	}

	for i := 0; i < len(mappingNode.Content); i += 2 {
		keyNode := mappingNode.Content[i]
		if keyNode.Value == key {
			return mappingNode.Content[i+1], i + 1
		}
	}
	return nil, -1
}

// 将 DNS 规则应用到 YAML 节点
func applyDNSRuleToNode(docNode *yaml.Node, rule storage.CustomRule) {
	var parsedContent yaml.Node
	if err := yaml.Unmarshal([]byte(rule.Content), &parsedContent); err != nil {
		return
	}

	// 检查解析的内容是否是文档节点
	var contentNode *yaml.Node
	if parsedContent.Kind == yaml.DocumentNode && len(parsedContent.Content) > 0 {
		contentNode = parsedContent.Content[0]
	} else {
		contentNode = &parsedContent
	}

	// 检查用户输入是否包含“dns:”键
	if dnsNode, _ := findFieldNode(contentNode, "dns"); dnsNode != nil {
		// 替换整个 dns 块
		setFieldNode(docNode, "dns", dnsNode)
	} else {
		// 否则，替换为全部内容
		setFieldNode(docNode, "dns", contentNode)
	}
}

// 将规则应用到 YAML 节点
func applyRulesRuleToNode(docNode *yaml.Node, rule storage.CustomRule) {
	var parsedContent yaml.Node
	if err := yaml.Unmarshal([]byte(rule.Content), &parsedContent); err != nil {
		return
	}

	// 获取内容节点
	var contentNode *yaml.Node
	if parsedContent.Kind == yaml.DocumentNode && len(parsedContent.Content) > 0 {
		contentNode = parsedContent.Content[0]
	} else {
		contentNode = &parsedContent
	}

	// 检查它是否包含“rules:”键
	var newRulesNode *yaml.Node
	if contentNode.Kind == yaml.MappingNode {
		if rulesNode, _ := findFieldNode(contentNode, "rules"); rulesNode != nil {
			newRulesNode = rulesNode
		}
	}

	// 如果没有找到映射，则将内容视为规则数组
	if newRulesNode == nil {
		if contentNode.Kind == yaml.SequenceNode {
			newRulesNode = contentNode
		} else {
			return
		}
	}

	// 获取现有规则节点
	existingRulesNode, idx := findFieldNode(docNode, "rules")

	if rule.Mode == "replace" {
		// 从现有规则中提取 RULE-SET 规则以保留它们
		ruleSetRules := extractRuleSetRules(existingRulesNode)

		// 如果我们有 RULE-SET 规则，请将它们附加到新规则中
		if len(ruleSetRules) > 0 && newRulesNode.Kind == yaml.SequenceNode {
			combined := &yaml.Node{
				Kind:    yaml.SequenceNode,
				Style:   newRulesNode.Style,
				Tag:     newRulesNode.Tag,
				Content: append(newRulesNode.Content, ruleSetRules...),
			}
			if idx >= 0 {
				docNode.Content[idx] = combined
			} else {
				setFieldNode(docNode, "rules", combined)
			}
		} else {
			if idx >= 0 {
				docNode.Content[idx] = newRulesNode
			} else {
				setFieldNode(docNode, "rules", newRulesNode)
			}
		}
	} else if rule.Mode == "prepend" {
		if existingRulesNode == nil || existingRulesNode.Kind != yaml.SequenceNode {
			// 没有现有规则，只需设置新规则
			setFieldNode(docNode, "rules", newRulesNode)
		} else {
			// 通过重复数据删除将新规则添加到现有规则之前
			if newRulesNode.Kind == yaml.SequenceNode {
				// 在添加之前从现有规则中删除重复项
				filteredExisting := removeDuplicateNodesBasedOnNewRules(existingRulesNode.Content, newRulesNode.Content)

				combined := &yaml.Node{
					Kind:    yaml.SequenceNode,
					Style:   existingRulesNode.Style,
					Tag:     existingRulesNode.Tag,
					Content: append(newRulesNode.Content, filteredExisting...),
				}
				docNode.Content[idx] = combined
			}
		}
	} else if rule.Mode == "append" {
		if existingRulesNode == nil || existingRulesNode.Kind != yaml.SequenceNode {
			// 没有现有规则，只需设置新规则
			setFieldNode(docNode, "rules", newRulesNode)
		} else {
			// 通过重复数据删除将新规则附加到现有规则
			if newRulesNode.Kind == yaml.SequenceNode {
				// 在追加之前从现有规则中删除重复项
				filteredExisting := removeDuplicateNodesBasedOnNewRules(existingRulesNode.Content, newRulesNode.Content)

				combined := &yaml.Node{
					Kind:    yaml.SequenceNode,
					Style:   existingRulesNode.Style,
					Tag:     existingRulesNode.Tag,
					Content: append(filteredExisting, newRulesNode.Content...),
				}
				docNode.Content[idx] = combined
			}
		}
	}
}

// 将规则提供程序应用到 YAML 节点
func applyRuleProvidersRuleToNode(docNode *yaml.Node, rule storage.CustomRule) {
	var parsedContent yaml.Node
	if err := yaml.Unmarshal([]byte(rule.Content), &parsedContent); err != nil {
		return
	}

	// 获取内容节点
	var contentNode *yaml.Node
	if parsedContent.Kind == yaml.DocumentNode && len(parsedContent.Content) > 0 {
		contentNode = parsedContent.Content[0]
	} else {
		contentNode = &parsedContent
	}

	// 检查它是否包含“rule-providers:”键
	var newProvidersNode *yaml.Node
	if contentNode.Kind == yaml.MappingNode {
		if providersNode, _ := findFieldNode(contentNode, "rule-providers"); providersNode != nil {
			newProvidersNode = providersNode
		} else {
			newProvidersNode = contentNode
		}
	} else {
		return
	}

	existingProvidersNode, idx := findFieldNode(docNode, "rule-providers")

	if rule.Mode == "replace" {
		// 在替换模式下，将新提供程序与现有提供程序合并（新提供程序优先）
		if existingProvidersNode != nil && existingProvidersNode.Kind == yaml.MappingNode && newProvidersNode.Kind == yaml.MappingNode {
			mergeMapNodes(existingProvidersNode, newProvidersNode)
		} else {
			// 没有现有的提供程序或类型错误，只需设置新的提供程序
			if idx >= 0 {
				docNode.Content[idx] = newProvidersNode
			} else {
				setFieldNode(docNode, "rule-providers", newProvidersNode)
			}
		}
	} else if rule.Mode == "prepend" {
		if existingProvidersNode == nil || existingProvidersNode.Kind != yaml.MappingNode {
			// 没有现有的提供商，只需设置新的提供商
			setFieldNode(docNode, "rule-providers", newProvidersNode)
		} else {
			// 合并：新提供商优先
			if newProvidersNode.Kind == yaml.MappingNode {
				mergeMapNodes(existingProvidersNode, newProvidersNode)
			}
		}
	}
}

// 在映射节点中设置或添加字段
func setFieldNode(mappingNode *yaml.Node, key string, valueNode *yaml.Node) {
	if mappingNode.Kind != yaml.MappingNode {
		return
	}

	// 检查密钥是否已经存在
	for i := 0; i < len(mappingNode.Content); i += 2 {
		keyNode := mappingNode.Content[i]
		if keyNode.Value == key {
			// 替换值
			mappingNode.Content[i+1] = valueNode
			return
		}
	}

	// 添加新的键值对
	keyNode := &yaml.Node{
		Kind:  yaml.ScalarNode,
		Value: key,
	}
	mappingNode.Content = append(mappingNode.Content, keyNode, valueNode)
}

// mergeMapNodes将newNode合并到existingNode中（新值优先）
func mergeMapNodes(existingNode *yaml.Node, newNode *yaml.Node) {
	if existingNode.Kind != yaml.MappingNode || newNode.Kind != yaml.MappingNode {
		return
	}

	// 迭代新节点的键值对
	for i := 0; i < len(newNode.Content); i += 2 {
		newKeyNode := newNode.Content[i]
		newValueNode := newNode.Content[i+1]

		// 查找现有节点中是否存在 key
		found := false
		for j := 0; j < len(existingNode.Content); j += 2 {
			existingKeyNode := existingNode.Content[j]
			if existingKeyNode.Value == newKeyNode.Value {
				// 替换值
				existingNode.Content[j+1] = newValueNode
				found = true
				break
			}
		}

		// 如果没有找到，则追加
		if !found {
			existingNode.Content = append(existingNode.Content, newKeyNode, newValueNode)
		}
	}
}

// 将 DNS 规则应用于 YAML 节点（用于自动同步的智能版本）
func applyDNSRuleToNodeSmart(docNode *yaml.Node, rule storage.CustomRule, prevApp *storage.CustomRuleApplication, ctx context.Context, repo *storage.TrafficRepository, subscribeFileID int64, contentHash string) {
	// DNS 规则总是替换，无需重复数据删除
	applyDNSRuleToNode(docNode, rule)

	// 记录申请
	_ = recordApplication(ctx, repo, subscribeFileID, rule, "", contentHash)
}

// 将规则应用到具有重复数据删除功能的 YAML 节点（用于自动同步的智能版本）
func applyRulesRuleToNodeSmart(docNode *yaml.Node, rule storage.CustomRule, prevApp *storage.CustomRuleApplication, ctx context.Context, repo *storage.TrafficRepository, subscribeFileID int64, contentHash string) {
	var parsedContent yaml.Node
	if err := yaml.Unmarshal([]byte(rule.Content), &parsedContent); err != nil {
		return
	}

	// 获取内容节点
	var contentNode *yaml.Node
	if parsedContent.Kind == yaml.DocumentNode && len(parsedContent.Content) > 0 {
		contentNode = parsedContent.Content[0]
	} else {
		contentNode = &parsedContent
	}

	// 检查它是否包含“rules:”键
	var newRulesNode *yaml.Node
	if contentNode.Kind == yaml.MappingNode {
		if rulesNode, _ := findFieldNode(contentNode, "rules"); rulesNode != nil {
			newRulesNode = rulesNode
		}
	}

	// 如果没有找到映射，则将内容视为规则数组
	if newRulesNode == nil {
		if contentNode.Kind == yaml.SequenceNode {
			newRulesNode = contentNode
		} else {
			return
		}
	}

	// 获取现有规则节点
	existingRulesNode, idx := findFieldNode(docNode, "rules")

	if rule.Mode == "replace" {
		// 从现有规则中提取 RULE-SET 规则以保留它们
		ruleSetRules := extractRuleSetRules(existingRulesNode)

		// 如果我们有 RULE-SET 规则，请将它们附加到新规则中
		if len(ruleSetRules) > 0 && newRulesNode.Kind == yaml.SequenceNode {
			combined := &yaml.Node{
				Kind:    yaml.SequenceNode,
				Style:   newRulesNode.Style,
				Tag:     newRulesNode.Tag,
				Content: append(newRulesNode.Content, ruleSetRules...),
			}
			if idx >= 0 {
				docNode.Content[idx] = combined
			} else {
				setFieldNode(docNode, "rules", combined)
			}
		} else {
			if idx >= 0 {
				docNode.Content[idx] = newRulesNode
			} else {
				setFieldNode(docNode, "rules", newRulesNode)
			}
		}
	} else if rule.Mode == "prepend" {
		if existingRulesNode == nil || existingRulesNode.Kind != yaml.SequenceNode {
			// 没有现有规则，只需设置新规则
			setFieldNode(docNode, "rules", newRulesNode)
		} else {
			// 删除历史内容（如果存在）
			if prevApp != nil && prevApp.AppliedContent != "" {
				var historicalRules []interface{}
				if err := json.Unmarshal([]byte(prevApp.AppliedContent), &historicalRules); err == nil {
					existingRulesNode.Content = removeNodesFromSequence(existingRulesNode.Content, historicalRules)
				}
			}
			// 通过重复数据删除将新规则添加到现有规则之前
			if newRulesNode.Kind == yaml.SequenceNode {
				// 在添加之前从现有规则中删除重复项
				filteredExisting := removeDuplicateNodesBasedOnNewRules(existingRulesNode.Content, newRulesNode.Content)

				combined := &yaml.Node{
					Kind:    yaml.SequenceNode,
					Style:   existingRulesNode.Style,
					Tag:     existingRulesNode.Tag,
					Content: append(newRulesNode.Content, filteredExisting...),
				}
				docNode.Content[idx] = combined
			}
		}
	} else if rule.Mode == "append" {
		if existingRulesNode == nil || existingRulesNode.Kind != yaml.SequenceNode {
			// 没有现有规则，只需设置新规则
			setFieldNode(docNode, "rules", newRulesNode)
		} else {
			// 删除历史内容（如果存在）
			if prevApp != nil && prevApp.AppliedContent != "" {
				var historicalRules []interface{}
				if err := json.Unmarshal([]byte(prevApp.AppliedContent), &historicalRules); err == nil {
					existingRulesNode.Content = removeNodesFromSequence(existingRulesNode.Content, historicalRules)
				}
			}
			// 将新规则附加到现有规则
			if newRulesNode.Kind == yaml.SequenceNode {
				combined := &yaml.Node{
					Kind:    yaml.SequenceNode,
					Style:   existingRulesNode.Style,
					Tag:     existingRulesNode.Tag,
					Content: append(existingRulesNode.Content, newRulesNode.Content...),
				}
				docNode.Content[idx] = combined
			}
		}
	}

	// 序列化应用的内容以进行跟踪（将节点转换为 JSON 的接口{}）
	var appliedRules []interface{}
	for _, node := range newRulesNode.Content {
		var val interface{}
		if err := node.Decode(&val); err == nil {
			appliedRules = append(appliedRules, val)
		}
	}
	appliedJSON, _ := json.Marshal(appliedRules)
	_ = recordApplication(ctx, repo, subscribeFileID, rule, string(appliedJSON), contentHash)
}

// 将规则提供程序应用到具有重复数据删除功能的 YAML 节点（用于自动同步的智能版本）
func applyRuleProvidersRuleToNodeSmart(docNode *yaml.Node, rule storage.CustomRule, prevApp *storage.CustomRuleApplication, ctx context.Context, repo *storage.TrafficRepository, subscribeFileID int64, contentHash string) {
	var parsedContent yaml.Node
	if err := yaml.Unmarshal([]byte(rule.Content), &parsedContent); err != nil {
		return
	}

	// 获取内容节点
	var contentNode *yaml.Node
	if parsedContent.Kind == yaml.DocumentNode && len(parsedContent.Content) > 0 {
		contentNode = parsedContent.Content[0]
	} else {
		contentNode = &parsedContent
	}

	// 检查它是否包含“rule-providers:”键
	var newProvidersNode *yaml.Node
	if contentNode.Kind == yaml.MappingNode {
		if providersNode, _ := findFieldNode(contentNode, "rule-providers"); providersNode != nil {
			newProvidersNode = providersNode
		} else {
			newProvidersNode = contentNode
		}
	} else {
		return
	}

	existingProvidersNode, idx := findFieldNode(docNode, "rule-providers")

	if rule.Mode == "replace" {
		if idx >= 0 {
			docNode.Content[idx] = newProvidersNode
		} else {
			setFieldNode(docNode, "rule-providers", newProvidersNode)
		}
	} else if rule.Mode == "prepend" {
		if existingProvidersNode == nil || existingProvidersNode.Kind != yaml.MappingNode {
			// 没有现有的提供商，只需设置新的提供商
			setFieldNode(docNode, "rule-providers", newProvidersNode)
		} else {
			// 删除历史提供程序（如果存在）
			if prevApp != nil && prevApp.AppliedContent != "" {
				var historicalProviders map[string]interface{}
				if err := json.Unmarshal([]byte(prevApp.AppliedContent), &historicalProviders); err == nil {
					removeKeysFromMapNode(existingProvidersNode, historicalProviders)
				}
			}
			// 合并：新提供商优先
			if newProvidersNode.Kind == yaml.MappingNode {
				mergeMapNodes(existingProvidersNode, newProvidersNode)
			}
		}
	}

	// 序列化应用的内容以进行跟踪
	var appliedProviders map[string]interface{}
	if err := newProvidersNode.Decode(&appliedProviders); err == nil {
		appliedJSON, _ := json.Marshal(appliedProviders)
		_ = recordApplication(ctx, repo, subscribeFileID, rule, string(appliedJSON), contentHash)
	}
}

// 从序列中删除与给定值匹配的节点
func removeNodesFromSequence(nodes []*yaml.Node, toRemove []interface{}) []*yaml.Node {
	// 构建一组要删除的值
	removeSet := make(map[string]bool)
	for _, val := range toRemove {
		if str, ok := val.(string); ok {
			removeSet[str] = true
		}
	}

	// 过滤掉匹配的节点
	var filtered []*yaml.Node
	for _, node := range nodes {
		var val interface{}
		if err := node.Decode(&val); err == nil {
			if str, ok := val.(string); ok {
				if !removeSet[str] {
					filtered = append(filtered, node)
				}
				continue
			}
		}
		// 保留非字符串节点
		filtered = append(filtered, node)
	}
	return filtered
}

// 从地图节点中删除键
func removeKeysFromMapNode(mapNode *yaml.Node, keysToRemove map[string]interface{}) {
	if mapNode.Kind != yaml.MappingNode {
		return
	}

	// 创建一个新的内容切片，无需删除键
	var newContent []*yaml.Node
	for i := 0; i < len(mapNode.Content); i += 2 {
		if i+1 < len(mapNode.Content) {
			keyNode := mapNode.Content[i]
			valueNode := mapNode.Content[i+1]

			// 检查是否应删除此密钥
			if _, shouldRemove := keysToRemove[keyNode.Value]; !shouldRemove {
				newContent = append(newContent, keyNode, valueNode)
			}
		}
	}
	mapNode.Content = newContent
}
