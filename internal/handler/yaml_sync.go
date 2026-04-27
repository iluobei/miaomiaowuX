package handler

import (
	"encoding/json"
	"fmt"
	"miaomiaowu/internal/logger"
	"os"
	"path/filepath"

	"miaomiaowu/internal/util"

	"gopkg.in/yaml.v3"
)

// 使用新字段值更新现有代理节点，同时保留原始节点样式
func updateProxyNodeFields(proxyNode *yaml.Node, newConfig map[string]any) {
	if proxyNode == nil || proxyNode.Kind != yaml.MappingNode {
		return
	}

	// 构建现有领域关键节点图
	existingFields := make(map[string]*yaml.Node) // 字段名 -> 值节点
	for i := 0; i < len(proxyNode.Content); i += 2 {
		if i+1 >= len(proxyNode.Content) {
			break
		}
		keyNode := proxyNode.Content[i]
		valueNode := proxyNode.Content[i+1]
		existingFields[keyNode.Value] = valueNode
	}

	// 使用新值更新现有值节点，保留其样式
	for key, newValue := range newConfig {
		if valueNode, exists := existingFields[key]; exists {
			// 更新现有值节点的值，保留其 Kind 和 Style
			updateValueNode(valueNode, newValue)
		}
	}
}

// 对代理节点中的字段就地重新排序
func reorderProxyNodeFieldsInPlace(proxyNode *yaml.Node) {
	if proxyNode == nil || proxyNode.Kind != yaml.MappingNode {
		return
	}
	reordered := util.ReorderProxyNode(proxyNode)
	proxyNode.Content = reordered.Content
}

// 更新 yaml.Node 的值，同时尝试保留其原始类型/样式
func updateValueNode(node *yaml.Node, newValue any) {
	if node == nil {
		return
	}

	switch v := newValue.(type) {
	case string:
		// 如果节点已经是标量，则保留节点的种类和标签
		if node.Kind == yaml.ScalarNode {
			node.Value = v
			// 如果值看起来像数字，请清除 !!str 标记，以防止引用
			// 只保留空字符串的 !!str 标签
			if v != "" && node.Tag == "!!str" {
				node.Tag = ""
			}
		} else {
			node.Kind = yaml.ScalarNode
			node.Value = v
		}
	case int:
		if node.Kind == yaml.ScalarNode {
			node.SetString(fmt.Sprintf("%d", v))
		} else {
			node.Kind = yaml.ScalarNode
			node.SetString(fmt.Sprintf("%d", v))
		}
	case int64:
		if node.Kind == yaml.ScalarNode {
			node.SetString(fmt.Sprintf("%d", v))
		} else {
			node.Kind = yaml.ScalarNode
			node.SetString(fmt.Sprintf("%d", v))
		}
	case float64:
		if node.Kind == yaml.ScalarNode {
			node.SetString(fmt.Sprintf("%v", v))
		} else {
			node.Kind = yaml.ScalarNode
			node.SetString(fmt.Sprintf("%v", v))
		}
	case bool:
		if node.Kind == yaml.ScalarNode {
			if v {
				node.Value = "true"
			} else {
				node.Value = "false"
			}
		} else {
			node.Kind = yaml.ScalarNode
			if v {
				node.Value = "true"
			} else {
				node.Value = "false"
			}
		}
	case map[string]any:
		// 对于嵌套对象，递归更新
		if node.Kind == yaml.MappingNode {
			updateProxyNodeFields(node, v)
		}
		// 否则，我们需要重建整个结构
	case []any:
		// 对于数组，我们需要重建
		if node.Kind != yaml.SequenceNode {
			node.Kind = yaml.SequenceNode
			node.Content = nil
		}
		// 清除并重建内容
		node.Content = nil
		for _, item := range v {
			node.Content = append(node.Content, encodeValue(item))
		}
	}
}

// 将 Go 值转换为 yaml.Node
func encodeValue(value any) *yaml.Node {
	node := &yaml.Node{}

	// 处理历史BUG把short-id: "" 保存成short-id: null, 导致short-id输出为 <nil>
	if value == nil {
		node.Kind = yaml.ScalarNode
		node.Tag = "!!str"
		node.Value = ""
		node.Style = yaml.DoubleQuotedStyle // 强制空字符串使用双引号
		return node
	}

	switch v := value.(type) {
	case string:
		node.Kind = yaml.ScalarNode
		// 仅对空值设置!!str标签, 防止给数值类型加上双引号
		if v == "" {
			node.Tag = "!!str"
			node.Style = yaml.DoubleQuotedStyle // 强制空字符串使用双引号
		}
		node.Value = v
	case int:
		node.Kind = yaml.ScalarNode
		node.SetString(fmt.Sprintf("%d", v))
	case int64:
		node.Kind = yaml.ScalarNode
		node.SetString(fmt.Sprintf("%d", v))
	case float64:
		node.Kind = yaml.ScalarNode
		node.SetString(fmt.Sprintf("%v", v))
	case bool:
		node.Kind = yaml.ScalarNode
		if v {
			node.Value = "true"
		} else {
			node.Value = "false"
		}
	case []any:
		node.Kind = yaml.SequenceNode
		for _, item := range v {
			node.Content = append(node.Content, encodeValue(item))
		}
	case map[string]any:
		node.Kind = yaml.MappingNode
		for k, val := range v {
			keyNode := &yaml.Node{
				Kind:  yaml.ScalarNode,
				Value: k,
			}
			node.Content = append(node.Content, keyNode)

			// 特殊处理 short-id 字段，始终当作字符串处理并加引号
			if k == "short-id" {
				strVal := ""
				switch typedVal := val.(type) {
				case string:
					strVal = typedVal
				case int:
					// 数字类型转为字符串，保持原值
					strVal = fmt.Sprintf("%d", typedVal)
				case int64:
					strVal = fmt.Sprintf("%d", typedVal)
				case float64:
					// 浮点数转为字符串，保持原值
					if typedVal == float64(int64(typedVal)) {
						strVal = fmt.Sprintf("%d", int64(typedVal))
					} else {
						strVal = fmt.Sprintf("%g", typedVal)
					}
				case nil:
					strVal = ""
				default:
					strVal = fmt.Sprintf("%v", typedVal)
				}

				// 创建带引号的字符串节点，强制使用 !!str 标签和双引号
				valueNode := &yaml.Node{
					Kind:  yaml.ScalarNode,
					Tag:   "!!str",
					Value: strVal,
					Style: yaml.DoubleQuotedStyle,
				}
				node.Content = append(node.Content, valueNode)
			} else {
				node.Content = append(node.Content, encodeValue(val))
			}
		}
	default:
		// 后备：编码为字符串
		node.Kind = yaml.ScalarNode
		node.SetString(fmt.Sprintf("%v", v))
	}

	return node
}

// ConvertNilToEmptyString 在映射中递归地将 nil 值转换为空字符串
func convertNilToEmptyString(m map[string]any) {
	for k, v := range m {
		if v == nil {
			m[k] = ""
		} else if subMap, ok := v.(map[string]any); ok {
			convertNilToEmptyString(subMap)
		} else if slice, ok := v.([]any); ok {
			for i, item := range slice {
				if item == nil {
					slice[i] = ""
				} else if itemMap, ok := item.(map[string]any); ok {
					convertNilToEmptyString(itemMap)
				}
			}
		}
	}
}

// 将映射编组到 YAML，确保引用空字符串
func MarshalYAMLWithQuotedEmptyStrings(data map[string]any) ([]byte, error) {
	// 首先将 nil 值转换为空字符串
	convertNilToEmptyString(data)

	// 使用我们的自定义encodeValue构建根YAML节点
	rootNode := encodeValue(data)

	// 创建 YAML 文档
	doc := &yaml.Node{
		Kind:    yaml.DocumentNode,
		Content: []*yaml.Node{rootNode},
	}

	// 封送至字节
	return yaml.Marshal(doc)
}

// 递归修复短 id 字段以使用双引号
func fixShortIdStyleInNode(node *yaml.Node) {
	if node == nil {
		return
	}

	// 流程图节点（对象）
	if node.Kind == yaml.MappingNode {
		for i := 0; i < len(node.Content); i += 2 {
			if i+1 < len(node.Content) {
				keyNode := node.Content[i]
				valueNode := node.Content[i+1]

				// 如果这是一个短 ID 字段，请确保该值使用双引号
				if keyNode.Value == "short-id" {
					if valueNode.Kind == yaml.ScalarNode {
						valueNode.Tag = "!!str"
						valueNode.Style = yaml.DoubleQuotedStyle
						// 确保该值是字符串
						if valueNode.Value == "" || valueNode.Value == "null" {
							valueNode.Value = ""
						}
					}
				}

				// 递归处理值节点
				fixShortIdStyleInNode(valueNode)
			}
		}
	}

	// 处理序列节点（数组）
	if node.Kind == yaml.SequenceNode {
		for _, child := range node.Content {
			fixShortIdStyleInNode(child)
		}
	}

	// 流程文档节点
	if node.Kind == yaml.DocumentNode {
		for _, child := range node.Content {
			fixShortIdStyleInNode(child)
		}
	}
}

// 更新所有 YAML 订阅文件中的节点信息
func syncNodeToYAMLFiles(subscribeDir, oldNodeName, newNodeName string, clashConfigJSON string) error {
	if subscribeDir == "" {
		return fmt.Errorf("subscribe directory is empty")
	}

	// 解析新的冲突配置
	var newClashConfig map[string]any
	if err := json.Unmarshal([]byte(clashConfigJSON), &newClashConfig); err != nil {
		return fmt.Errorf("parse new clash config: %w", err)
	}

	// 将 nil 值转换为空字符串（例如，对于短 id 字段）
	convertNilToEmptyString(newClashConfig)

	// 获取订阅目录中的所有 YAML 文件
	entries, err := os.ReadDir(subscribeDir)
	if err != nil {
		return fmt.Errorf("read subscribe directory: %w", err)
	}

	// 处理每个 YAML 文件
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()
		// 跳过非 YAML 文件和 .keep.yaml 占位符
		if filepath.Ext(filename) != ".yaml" && filepath.Ext(filename) != ".yml" {
			continue
		}
		if filename == ".keep.yaml" {
			continue
		}

		filePath := filepath.Join(subscribeDir, filename)

		// 读取 YAML 文件
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue // 跳过我们无法读取的文件
		}

		// 解析 YAML
		var yamlContent map[string]any
		if err := yaml.Unmarshal(data, &yamlContent); err != nil {
			continue // 跳过无效的 YAML 文件
		}

		// 检查文件是否有代理字段
		proxies, ok := yamlContent["proxies"].([]any)
		if !ok || len(proxies) == 0 {
			continue
		}

		modified := false
		nameChanged := oldNodeName != newNodeName

		// 更新或删除匹配的节点
		newProxies := make([]any, 0, len(proxies))
		for _, proxy := range proxies {
			proxyMap, ok := proxy.(map[string]any)
			if !ok {
				newProxies = append(newProxies, proxy)
				continue
			}

			proxyName, ok := proxyMap["name"].(string)
			if !ok {
				newProxies = append(newProxies, proxy)
				continue
			}

			// 如果姓名与旧姓名相符
			if proxyName == oldNodeName {
				if nameChanged {
					// 名称已更改：在当前位置替换为新配置
					newProxies = append(newProxies, newClashConfig)
					modified = true
				} else {
					// 名称不变：更新节点配置
					for key, value := range newClashConfig {
						proxyMap[key] = value
					}
					newProxies = append(newProxies, proxyMap)
					modified = true
				}
			} else {
				newProxies = append(newProxies, proxyMap)
			}
		}

		// 如果没有任何改变，则跳过该文件
		if !modified {
			continue
		}

		// 使用有序字段更新 YAML 内容中的代理
		orderedProxiesForMap := make([]any, 0, len(newProxies))
		for _, proxy := range newProxies {
			orderedProxiesForMap = append(orderedProxiesForMap, proxy)
		}
		yamlContent["proxies"] = orderedProxiesForMap

		// 如果代理组引用旧名称，则还要更新它们
		if proxyGroups, ok := yamlContent["proxy-groups"].([]any); ok {
			for _, group := range proxyGroups {
				groupMap, ok := group.(map[string]any)
				if !ok {
					continue
				}

				// 更新组中的代理列表
				if groupProxies, ok := groupMap["proxies"].([]any); ok {
					updatedGroupProxies := make([]any, 0, len(groupProxies))
					for _, groupProxy := range groupProxies {
						proxyName, ok := groupProxy.(string)
						if !ok {
							updatedGroupProxies = append(updatedGroupProxies, groupProxy)
							continue
						}

						if proxyName == oldNodeName && nameChanged {
							// 用新名称替换旧名称
							updatedGroupProxies = append(updatedGroupProxies, newNodeName)
						} else {
							updatedGroupProxies = append(updatedGroupProxies, groupProxy)
						}
					}
					groupMap["proxies"] = updatedGroupProxies
				}
			}
		}

		// 如果规则引用旧名称，也更新规则
		if rules, ok := yamlContent["rules"].([]any); ok {
			updatedRules := make([]any, 0, len(rules))
			for _, rule := range rules {
				ruleStr, ok := rule.(string)
				if !ok {
					updatedRules = append(updatedRules, rule)
					continue
				}

				// 检查规则是否引用旧节点名称
				if nameChanged && containsNodeName(ruleStr, oldNodeName) {
					// 将规则中的旧名称替换为新名称
					updatedRules = append(updatedRules, replaceNodeNameInRule(ruleStr, oldNodeName, newNodeName))
				} else {
					updatedRules = append(updatedRules, rule)
				}
			}
			yamlContent["rules"] = updatedRules
		}

		// 将文件重新读取为 yaml.Node 以保留结构
		var rootNode yaml.Node
		if err := yaml.Unmarshal(data, &rootNode); err != nil {
			continue
		}

		// 查找并更新代理部分，保留原始节点样式
		if rootNode.Kind == yaml.DocumentNode && len(rootNode.Content) > 0 {
			docNode := rootNode.Content[0]
			if docNode.Kind == yaml.MappingNode {
				// 找到代理密钥
				for i := 0; i < len(docNode.Content); i += 2 {
					if i+1 >= len(docNode.Content) {
						break
					}
					keyNode := docNode.Content[i]
					if keyNode.Value == "proxies" {
						proxiesNode := docNode.Content[i+1]
						if proxiesNode.Kind == yaml.SequenceNode {
							// 就地更新代理以保留节点样式
							for j, proxyNode := range proxiesNode.Content {
								if proxyNode.Kind != yaml.MappingNode {
									continue
								}

								// 找到这个代理节点中的name字段
								var proxyName string
								for k := 0; k < len(proxyNode.Content); k += 2 {
									if k+1 >= len(proxyNode.Content) {
										break
									}
									if proxyNode.Content[k].Value == "name" {
										proxyName = proxyNode.Content[k+1].Value
										break
									}
								}

								// 如果此代理与正在更新的代理匹配
								if proxyName == oldNodeName {
									if nameChanged {
										// 用新配置替换整个代理节点
										proxiesNode.Content[j] = util.ReorderProxyFieldsToNode(newClashConfig)
									} else {
										// 就地更新字段，保留原始节点样式
										updateProxyNodeFields(proxyNode, newClashConfig)
										// 重新排序字段以将优先字段放在第一位
										reorderProxyNodeFieldsInPlace(proxyNode)
									}
								}
							}
						}
						break
					}
				}

				// 如果名称更改则更新代理组
				if nameChanged {
					for i := 0; i < len(docNode.Content); i += 2 {
						if i+1 >= len(docNode.Content) {
							break
						}
						keyNode := docNode.Content[i]
						if keyNode.Value == "proxy-groups" {
							updateProxyGroupsNode(docNode.Content[i+1], oldNodeName, newNodeName)
							break
						}
					}

					// 如果名称更改则更新规则
					for i := 0; i < len(docNode.Content); i += 2 {
						if i+1 >= len(docNode.Content) {
							break
						}
						keyNode := docNode.Content[i]
						if keyNode.Value == "rules" {
							updateRulesNode(docNode.Content[i+1], oldNodeName, newNodeName)
							break
						}
					}
				}

				// 重新排序代理组字段
				for i := 0; i < len(docNode.Content); i += 2 {
					if i+1 >= len(docNode.Content) {
						break
					}
					if docNode.Content[i].Value == "proxy-groups" {
						proxyGroupsNode := docNode.Content[i+1]
						if proxyGroupsNode.Kind == yaml.SequenceNode {
							// 对每个代理组中的字段重新排序
							for _, groupNode := range proxyGroupsNode.Content {
								if groupNode.Kind == yaml.MappingNode {
									reorderProxyGroupFields(groupNode)
								}
							}
						}
						break
					}
				}

				// 重新排序顶级字段，将 dns、代理、代理组放在规则提供者之前
				reorderTopLevelFields(docNode)
			}
		}

		// 修复短 ID 字段以在封送之前使用双引号
		fixShortIdStyleInNode(&rootNode)

		// Encode to YAML using yaml.Marshal on the node (使用2空格缩进)
		output, err := MarshalYAMLWithIndent(&rootNode)
		if err != nil {
			continue // 跳过我们无法封送的文件
		}

		// 修复表情符号转义和引用的数字
		fixed := RemoveUnicodeEscapeQuotes(string(output))

		if err := os.WriteFile(filePath, []byte(fixed), 0644); err != nil {
			continue // 跳过我们无法写入的文件
		}
	}

	return nil
}

// 批量同步多个节点更新到 YAML 文件，只读写每个文件一次，避免大量节点时耗时特别高
func batchSyncNodesToYAMLFiles(subscribeDir string, updates []NodeUpdate) error {
	if subscribeDir == "" || len(updates) == 0 {
		return nil
	}

	// 预解析所有更新的 clash config
	type parsedUpdate struct {
		oldName     string
		newName     string
		clashConfig map[string]any
	}
	parsedUpdates := make([]parsedUpdate, 0, len(updates))
	for _, update := range updates {
		var clashConfig map[string]any
		if err := json.Unmarshal([]byte(update.ClashConfigJSON), &clashConfig); err != nil {
			continue // 跳过无法解析的
		}
		convertNilToEmptyString(clashConfig)
		parsedUpdates = append(parsedUpdates, parsedUpdate{
			oldName:     update.OldName,
			newName:     update.NewName,
			clashConfig: clashConfig,
		})
	}

	if len(parsedUpdates) == 0 {
		return nil
	}

	// 构建旧名称到更新的映射，方便快速查找
	updateMap := make(map[string]parsedUpdate)
	for _, u := range parsedUpdates {
		updateMap[u.oldName] = u
	}

	// 获取所有 YAML 文件
	entries, err := os.ReadDir(subscribeDir)
	if err != nil {
		return fmt.Errorf("read subscribe directory: %w", err)
	}

	// 处理每个 YAML 文件
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()
		if filepath.Ext(filename) != ".yaml" && filepath.Ext(filename) != ".yml" {
			continue
		}
		if filename == ".keep.yaml" {
			continue
		}

		filePath := filepath.Join(subscribeDir, filename)

		// 读取 YAML 文件
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		// 解析为 yaml.Node 以保留格式
		var rootNode yaml.Node
		if err := yaml.Unmarshal(data, &rootNode); err != nil {
			continue
		}

		modified := false

		// 找到 proxies 部分并更新
		if rootNode.Kind == yaml.DocumentNode && len(rootNode.Content) > 0 {
			docNode := rootNode.Content[0]
			if docNode.Kind == yaml.MappingNode {
				// 找到 proxies key
				for i := 0; i < len(docNode.Content); i += 2 {
					if i+1 >= len(docNode.Content) {
						break
					}
					keyNode := docNode.Content[i]
					if keyNode.Value == "proxies" {
						proxiesNode := docNode.Content[i+1]
						if proxiesNode.Kind == yaml.SequenceNode {
							// 遍历每个 proxy 节点
							for j, proxyNode := range proxiesNode.Content {
								if proxyNode.Kind != yaml.MappingNode {
									continue
								}

								// 找到 name 字段
								var proxyName string
								for k := 0; k < len(proxyNode.Content); k += 2 {
									if k+1 >= len(proxyNode.Content) {
										break
									}
									if proxyNode.Content[k].Value == "name" {
										proxyName = proxyNode.Content[k+1].Value
										break
									}
								}

								// 检查是否需要更新此节点
								if update, exists := updateMap[proxyName]; exists {
									nameChanged := update.oldName != update.newName
									if nameChanged {
										// 名称改变：替换整个节点
										proxiesNode.Content[j] = util.ReorderProxyFieldsToNode(update.clashConfig)
									} else {
										// 名称不变：就地更新字段
										updateProxyNodeFields(proxyNode, update.clashConfig)
										reorderProxyNodeFieldsInPlace(proxyNode)
									}
									modified = true
								}
							}
						}
						break
					}
				}

				// 更新 proxy-groups 中的名称引用
				for _, update := range parsedUpdates {
					if update.oldName != update.newName {
						for i := 0; i < len(docNode.Content); i += 2 {
							if i+1 >= len(docNode.Content) {
								break
							}
							if docNode.Content[i].Value == "proxy-groups" {
								updateProxyGroupsNode(docNode.Content[i+1], update.oldName, update.newName)
								modified = true
								break
							}
						}

						// 更新 rules 中的名称引用
						for i := 0; i < len(docNode.Content); i += 2 {
							if i+1 >= len(docNode.Content) {
								break
							}
							if docNode.Content[i].Value == "rules" {
								updateRulesNode(docNode.Content[i+1], update.oldName, update.newName)
								modified = true
								break
							}
						}
					}
				}

				// 重排序 proxy-groups 字段
				for i := 0; i < len(docNode.Content); i += 2 {
					if i+1 >= len(docNode.Content) {
						break
					}
					if docNode.Content[i].Value == "proxy-groups" {
						proxyGroupsNode := docNode.Content[i+1]
						if proxyGroupsNode.Kind == yaml.SequenceNode {
							for _, groupNode := range proxyGroupsNode.Content {
								if groupNode.Kind == yaml.MappingNode {
									reorderProxyGroupFields(groupNode)
								}
							}
						}
						break
					}
				}

				// 重排序顶层字段
				reorderTopLevelFields(docNode)
			}
		}

		// 如果没有修改，跳过此文件
		if !modified {
			continue
		}

		// 修复 short-id 字段样式
		fixShortIdStyleInNode(&rootNode)

		// 编码为 YAML
		output, err := MarshalYAMLWithIndent(&rootNode)
		if err != nil {
			continue
		}

		// 修复 emoji 转义和引号数字
		fixed := RemoveUnicodeEscapeQuotes(string(output))

		if err := os.WriteFile(filePath, []byte(fixed), 0644); err != nil {
			continue
		}

		logger.Info("[YAML同步] 批量更新文件", "filename", filename)
	}

	return nil
}

// 更新代理组节点以用新名称替换旧节点名称
func updateProxyGroupsNode(groupsNode *yaml.Node, oldName, newName string) {
	if groupsNode.Kind != yaml.SequenceNode {
		return
	}

	for _, groupNode := range groupsNode.Content {
		if groupNode.Kind != yaml.MappingNode {
			continue
		}

		// 在该组中找到“代理”键
		for i := 0; i < len(groupNode.Content); i += 2 {
			if i+1 >= len(groupNode.Content) {
				break
			}
			keyNode := groupNode.Content[i]
			if keyNode.Value == "proxies" {
				valueNode := groupNode.Content[i+1]
				if valueNode.Kind == yaml.SequenceNode {
					// 更新序列中的代理名称
					for _, proxyNode := range valueNode.Content {
						if proxyNode.Kind == yaml.ScalarNode && proxyNode.Value == oldName {
							proxyNode.Value = newName
						}
					}
				}
				break
			}
		}
	}
}

// 更新规则节点以用新名称替换旧节点名称
func updateRulesNode(rulesNode *yaml.Node, oldName, newName string) {
	if rulesNode.Kind != yaml.SequenceNode {
		return
	}

	for _, ruleNode := range rulesNode.Content {
		if ruleNode.Kind == yaml.ScalarNode {
			if containsNodeName(ruleNode.Value, oldName) {
				ruleNode.Value = replaceNodeNameInRule(ruleNode.Value, oldName, newName)
			}
		}
	}
}

// 检查规则字符串是否引用节点名称
func containsNodeName(rule, nodeName string) bool {
	// 规则格式：TYPE,PARAM,NODE_NAME
	// Example: DOMAIN-SUFFIX,google.com,节点名称
	parts := splitRule(rule)
	if len(parts) >= 3 {
		return parts[len(parts)-1] == nodeName
	}
	return false
}

// ReplaceNodeNameInRule 替换规则字符串中的节点名称
func replaceNodeNameInRule(rule, oldName, newName string) string {
	parts := splitRule(rule)
	if len(parts) >= 3 && parts[len(parts)-1] == oldName {
		parts[len(parts)-1] = newName
		result := ""
		for i, part := range parts {
			if i > 0 {
				result += ","
			}
			result += part
		}
		return result
	}
	return rule
}

// 用逗号分割规则字符串，处理转义逗号
func splitRule(rule string) []string {
	var parts []string
	var current string
	escaped := false

	for _, ch := range rule {
		if escaped {
			current += string(ch)
			escaped = false
			continue
		}

		if ch == '\\' {
			escaped = true
			continue
		}

		if ch == ',' {
			parts = append(parts, current)
			current = ""
			continue
		}

		current += string(ch)
	}

	if current != "" {
		parts = append(parts, current)
	}

	return parts
}

// 重新排序顶级 YAML 字段，将重要部分放在前面
func reorderTopLevelFields(docNode *yaml.Node) {
	if docNode.Kind != yaml.MappingNode {
		return
	}

	// 定义字段对结构
	type fieldPair struct {
		key   *yaml.Node
		value *yaml.Node
	}

	// yaml属性指定排序
	priorityFields := []string{
		"port",
		"socks-port",
		"allow-lan",
		"mode",
		"log-level",
		"dns",
		"proxies",
		"proxy-groups",
		"rules",
		"rule-providers",
		"geodata-mode",
		"geo-auto-update",
		"geodata-loader",
		"geo-update-interval",
		"geox-url",
	}

	// 创建一个map来存储所有的键值对
	fieldMap := make(map[string]*fieldPair)
	var otherFields []*fieldPair

	// 提取所有字段
	for i := 0; i < len(docNode.Content); i += 2 {
		if i+1 >= len(docNode.Content) {
			break
		}
		keyNode := docNode.Content[i]
		valueNode := docNode.Content[i+1]

		pair := &fieldPair{key: keyNode, value: valueNode}

		// 检查这是否是优先字段
		isPriority := false
		for _, pf := range priorityFields {
			if keyNode.Value == pf {
				fieldMap[pf] = pair
				isPriority = true
				break
			}
		}

		if !isPriority {
			otherFields = append(otherFields, pair)
		}
	}

	// 首先使用优先字段重建内容
	newContent := make([]*yaml.Node, 0, len(docNode.Content))

	// 按顺序添加优先级字段
	for _, fieldName := range priorityFields {
		if pair, ok := fieldMap[fieldName]; ok {
			newContent = append(newContent, pair.key, pair.value)
		}
	}

	// 按原始顺序添加剩余字段
	for _, pair := range otherFields {
		newContent = append(newContent, pair.key, pair.value)
	}

	// 替换内容
	docNode.Content = newContent
}

// 从所有 YAML 订阅文件中删除节点并返回受影响的文件
func deleteNodeFromYAMLFilesWithLog(subscribeDir, nodeName string) ([]string, error) {
	affectedFiles := []string{}
	if subscribeDir == "" {
		return affectedFiles, fmt.Errorf("subscribe directory is empty")
	}

	// 获取订阅目录中的所有 YAML 文件
	entries, err := os.ReadDir(subscribeDir)
	if err != nil {
		return affectedFiles, fmt.Errorf("read subscribe directory: %w", err)
	}

	// 处理每个 YAML 文件
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()
		// 跳过非 YAML 文件和 .keep.yaml 占位符
		if filepath.Ext(filename) != ".yaml" && filepath.Ext(filename) != ".yml" {
			continue
		}
		if filename == ".keep.yaml" {
			continue
		}

		filePath := filepath.Join(subscribeDir, filename)

		// 读取 YAML 文件
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue // 跳过我们无法读取的文件
		}

		// 解析 YAML
		var yamlContent map[string]any
		if err := yaml.Unmarshal(data, &yamlContent); err != nil {
			continue // 跳过无效的 YAML 文件
		}

		// 检查文件是否有代理字段
		proxies, ok := yamlContent["proxies"].([]any)
		if !ok || len(proxies) == 0 {
			continue
		}

		modified := false

		// 删除匹配的节点
		newProxies := make([]any, 0, len(proxies))
		for _, proxy := range proxies {
			proxyMap, ok := proxy.(map[string]any)
			if !ok {
				newProxies = append(newProxies, proxy)
				continue
			}

			proxyName, ok := proxyMap["name"].(string)
			if !ok {
				newProxies = append(newProxies, proxy)
				continue
			}

			// 如果名称匹配，则跳过此代理（将其删除）
			if proxyName == nodeName {
				modified = true
				continue
			}

			newProxies = append(newProxies, proxyMap)
		}

		// 如果没有任何改变，则跳过该文件
		if !modified {
			continue
		}

		// 将此文件标记为受影响
		affectedFiles = append(affectedFiles, filename)

		// 更新 YAML 内容中的代理
		yamlContent["proxies"] = newProxies

		// 如果代理组引用该节点，也从代理组中删除
		if proxyGroups, ok := yamlContent["proxy-groups"].([]any); ok {
			for _, group := range proxyGroups {
				groupMap, ok := group.(map[string]any)
				if !ok {
					continue
				}

				// 从组中的代理列表中删除
				if groupProxies, ok := groupMap["proxies"].([]any); ok {
					updatedGroupProxies := make([]any, 0, len(groupProxies))
					for _, groupProxy := range groupProxies {
						proxyName, ok := groupProxy.(string)
						if !ok {
							updatedGroupProxies = append(updatedGroupProxies, groupProxy)
							continue
						}

						// 如果这是要删除的节点则跳过
						if proxyName != nodeName {
							updatedGroupProxies = append(updatedGroupProxies, groupProxy)
						}
					}
					groupMap["proxies"] = updatedGroupProxies
				}
			}
		}

		// 如果规则引用了该节点，也从规则中删除
		if rules, ok := yamlContent["rules"].([]any); ok {
			updatedRules := make([]any, 0, len(rules))
			for _, rule := range rules {
				ruleStr, ok := rule.(string)
				if !ok {
					updatedRules = append(updatedRules, rule)
					continue
				}

				// 跳过引用该节点的规则
				if !containsNodeName(ruleStr, nodeName) {
					updatedRules = append(updatedRules, rule)
				}
			}
			yamlContent["rules"] = updatedRules
		}

		// 将文件重新读取为 yaml.Node 以保留结构
		var rootNode yaml.Node
		if err := yaml.Unmarshal(data, &rootNode); err != nil {
			continue
		}

		// 查找并更新部分
		if rootNode.Kind == yaml.DocumentNode && len(rootNode.Content) > 0 {
			docNode := rootNode.Content[0]
			if docNode.Kind == yaml.MappingNode {
				// 更新代理部分 - 删除具有匹配名称的节点
				for i := 0; i < len(docNode.Content); i += 2 {
					if i+1 >= len(docNode.Content) {
						break
					}
					keyNode := docNode.Content[i]
					if keyNode.Value == "proxies" {
						proxiesNode := docNode.Content[i+1]
						if proxiesNode.Kind == yaml.SequenceNode {
							// 过滤掉名称匹配的代理，保留其他代理
							newContent := []*yaml.Node{}
							for _, proxyNode := range proxiesNode.Content {
								if proxyNode.Kind != yaml.MappingNode {
									newContent = append(newContent, proxyNode)
									continue
								}

								// 找到这个代理节点中的name字段
								var proxyName string
								for k := 0; k < len(proxyNode.Content); k += 2 {
									if k+1 >= len(proxyNode.Content) {
										break
									}
									if proxyNode.Content[k].Value == "name" {
										proxyName = proxyNode.Content[k+1].Value
										break
									}
								}

								// 如果名称不匹配，则保留代理
								if proxyName != nodeName {
									newContent = append(newContent, proxyNode)
								}
							}
							proxiesNode.Content = newContent
						}
						break
					}
				}

				// 更新代理组以删除节点引用
				for i := 0; i < len(docNode.Content); i += 2 {
					if i+1 >= len(docNode.Content) {
						break
					}
					keyNode := docNode.Content[i]
					if keyNode.Value == "proxy-groups" {
						removeNodeFromProxyGroupsNode(docNode.Content[i+1], nodeName)
						break
					}
				}

				// 更新规则以删除节点引用
				for i := 0; i < len(docNode.Content); i += 2 {
					if i+1 >= len(docNode.Content) {
						break
					}
					keyNode := docNode.Content[i]
					if keyNode.Value == "rules" {
						removeNodeFromRulesNode(docNode.Content[i+1], nodeName)
						break
					}
				}

				// 重新排序顶级字段
				reorderTopLevelFields(docNode)
			}
		}

		// 修复短 ID 字段以在封送之前使用双引号
		fixShortIdStyleInNode(&rootNode)

		// Encode to YAML (使用2空格缩进)
		output, err := MarshalYAMLWithIndent(&rootNode)
		if err != nil {
			continue // 跳过我们无法封送的文件
		}

		// 后处理以修复表情符号和短 ID 格式
		result := RemoveUnicodeEscapeQuotes(string(output))

		if err := os.WriteFile(filePath, []byte(result), 0644); err != nil {
			continue // 跳过我们无法写入的文件
		}
	}

	return affectedFiles, nil
}

// 从所有 YAML 订阅文件中删除节点（传统包装器以实现兼容性）
func deleteNodeFromYAMLFiles(subscribeDir, nodeName string) error {
	_, err := deleteNodeFromYAMLFilesWithLog(subscribeDir, nodeName)
	return err
}

// 从代理组中删除节点引用
func removeNodeFromProxyGroupsNode(groupsNode *yaml.Node, nodeName string) {
	if groupsNode.Kind != yaml.SequenceNode {
		return
	}

	for _, groupNode := range groupsNode.Content {
		if groupNode.Kind != yaml.MappingNode {
			continue
		}

		// 在该组中找到“代理”键
		for i := 0; i < len(groupNode.Content); i += 2 {
			if i+1 >= len(groupNode.Content) {
				break
			}
			keyNode := groupNode.Content[i]
			if keyNode.Value == "proxies" {
				valueNode := groupNode.Content[i+1]
				if valueNode.Kind == yaml.SequenceNode {
					// 删除与nodeName匹配的代理节点
					newContent := make([]*yaml.Node, 0, len(valueNode.Content))
					for _, proxyNode := range valueNode.Content {
						if proxyNode.Kind == yaml.ScalarNode && proxyNode.Value != nodeName {
							newContent = append(newContent, proxyNode)
						}
					}
					valueNode.Content = newContent
				}
				break
			}
		}
	}
}

// 删除引用该节点的规则
func removeNodeFromRulesNode(rulesNode *yaml.Node, nodeName string) {
	if rulesNode.Kind != yaml.SequenceNode {
		return
	}

	// 过滤掉引用该节点的规则
	newContent := make([]*yaml.Node, 0, len(rulesNode.Content))
	for _, ruleNode := range rulesNode.Content {
		if ruleNode.Kind == yaml.ScalarNode {
			if !containsNodeName(ruleNode.Value, nodeName) {
				newContent = append(newContent, ruleNode)
			}
		} else {
			newContent = append(newContent, ruleNode)
		}
	}
	rulesNode.Content = newContent
}
