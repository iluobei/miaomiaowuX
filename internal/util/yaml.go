package util

import (
	"fmt"
	"strconv"

	"gopkg.in/yaml.v3"
)

// ProxyPriorityFields 定义应首先出现在代理配置中的字段
var ProxyPriorityFields = []string{"name", "type", "server", "port"}

// ReorderProxyFieldsToNode 重新排序代理配置以将关键字段放在第一位
// 返回 yaml.Node 以保留字段顺序
func ReorderProxyFieldsToNode(proxy map[string]any) *yaml.Node {
	node := &yaml.Node{
		Kind: yaml.MappingNode,
	}

	// 首先按顺序添加优先键
	for _, key := range ProxyPriorityFields {
		if val, exists := proxy[key]; exists {
			keyNode := &yaml.Node{Kind: yaml.ScalarNode, Value: key}
			valNode := &yaml.Node{}
			valNode.Encode(val)
			node.Content = append(node.Content, keyNode, valNode)
		}
	}

	// 然后添加剩余的键（按照地图迭代的原始顺序）
	for key, val := range proxy {
		if !isPriorityField(key) {
			keyNode := &yaml.Node{Kind: yaml.ScalarNode, Value: key}
			valNode := &yaml.Node{}
			valNode.Encode(val)
			node.Content = append(node.Content, keyNode, valNode)
		}
	}

	return node
}

// ReorderProxyNode 对现有 yaml.Node 代理中的字段重新排序
// 保留非优先字段的现有字段值和顺序
func ReorderProxyNode(proxyNode *yaml.Node) *yaml.Node {
	if proxyNode == nil || proxyNode.Kind != yaml.MappingNode {
		return proxyNode
	}

	result := &yaml.Node{
		Kind: yaml.MappingNode,
	}

	// 构建键->值节点对的映射
	fieldMap := make(map[string]*yaml.Node)
	for i := 0; i < len(proxyNode.Content)-1; i += 2 {
		keyNode := proxyNode.Content[i]
		valueNode := proxyNode.Content[i+1]
		if keyNode.Kind == yaml.ScalarNode {
			fieldMap[keyNode.Value] = valueNode
		}
	}

	// 首先按顺序添加优先级字段
	for _, key := range ProxyPriorityFields {
		if valNode, exists := fieldMap[key]; exists {
			keyNode := &yaml.Node{Kind: yaml.ScalarNode, Value: key}
			result.Content = append(result.Content, keyNode, valNode)
		}
	}

	// 然后按原始顺序添加剩余字段
	for i := 0; i < len(proxyNode.Content)-1; i += 2 {
		keyNode := proxyNode.Content[i]
		valueNode := proxyNode.Content[i+1]
		if keyNode.Kind == yaml.ScalarNode && !isPriorityField(keyNode.Value) {
			newKeyNode := &yaml.Node{Kind: yaml.ScalarNode, Value: keyNode.Value}
			result.Content = append(result.Content, newKeyNode, valueNode)
		}
	}

	return result
}

// 检查字段名称是否在优先级列表中
func isPriorityField(key string) bool {
	for _, pf := range ProxyPriorityFields {
		if key == pf {
			return true
		}
	}
	return false
}

// 将 Go 值转换为具有正确类型标签的 yaml.Node
func ValueToYAMLNode(value any) *yaml.Node {
	switch v := value.(type) {
	case bool:
		node := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool"}
		if v {
			node.Value = "true"
		} else {
			node.Value = "false"
		}
		return node
	case int:
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: strconv.Itoa(v)}
	case int64:
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: strconv.FormatInt(v, 10)}
	case float64:
		// 检查它是否实际上是一个整数
		if v == float64(int64(v)) {
			return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: strconv.FormatInt(int64(v), 10)}
		}
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!float", Value: strconv.FormatFloat(v, 'f', -1, 64)}
	case string:
		return &yaml.Node{Kind: yaml.ScalarNode, Value: v}
	default:
		// 对于复杂类型，编组和解组以获得正确的节点
		data, _ := yaml.Marshal(value)
		var node yaml.Node
		_ = yaml.Unmarshal(data, &node)
		if node.Kind == yaml.DocumentNode && len(node.Content) > 0 {
			return node.Content[0]
		}
		return &yaml.Node{Kind: yaml.ScalarNode, Value: fmt.Sprintf("%v", value)}
	}
}

// 从映射节点获取字符串字段值
func GetNodeFieldValue(node *yaml.Node, fieldName string) string {
	if node == nil || node.Kind != yaml.MappingNode {
		return ""
	}

	for i := 0; i < len(node.Content)-1; i += 2 {
		keyNode := node.Content[i]
		valueNode := node.Content[i+1]
		if keyNode.Kind == yaml.ScalarNode && keyNode.Value == fieldName {
			if valueNode.Kind == yaml.ScalarNode {
				return valueNode.Value
			}
		}
	}

	return ""
}

// 设置或更新映射节点中的字段
func SetNodeField(node *yaml.Node, fieldName string, value any) {
	if node == nil || node.Kind != yaml.MappingNode {
		return
	}

	// 查找现有字段
	for i := 0; i < len(node.Content)-1; i += 2 {
		keyNode := node.Content[i]
		if keyNode.Kind == yaml.ScalarNode && keyNode.Value == fieldName {
			// 更新现有字段
			node.Content[i+1] = ValueToYAMLNode(value)
			return
		}
	}

	// 添加新字段
	node.Content = append(node.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Value: fieldName},
		ValueToYAMLNode(value),
	)
}
