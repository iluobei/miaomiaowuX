package handler

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// 用 2 个空格缩进编组 YAML 节点
func MarshalYAMLWithIndent(node *yaml.Node) ([]byte, error) {
	// 在编码之前清理显式字符串标签以防止 !!str 出现在输出中
	sanitizeExplicitStringTags(node)

	var buf bytes.Buffer
	encoder := yaml.NewEncoder(&buf)
	encoder.SetIndent(2)
	if err := encoder.Encode(node); err != nil {
		return nil, err
	}
	if err := encoder.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// 使用 2 个空格缩进将任何值编组到 YAML
func MarshalWithIndent(v interface{}) ([]byte, error) {
	var buf bytes.Buffer
	encoder := yaml.NewEncoder(&buf)
	encoder.SetIndent(2)
	if err := encoder.Encode(v); err != nil {
		return nil, err
	}
	if err := encoder.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// RemoveUnicodeEscapeQuotes 从包含 Unicode 转义序列的字符串中删除引号
// 并将转义序列转换回实际的 Unicode 字符（如表情符号）。
// 对于已知的数字字段（端口、间隔等），删除引号以确保正确的数字类型。
func RemoveUnicodeEscapeQuotes(yamlContent string) string {
	var nameserverPolicyBlock string
	nameserverPolicyRe := regexp.MustCompile(`(?ms)^(nameserver-policy:\s*\n)((?:[ \t]+.+\n?)*)`)
	yamlContent = nameserverPolicyRe.ReplaceAllStringFunc(yamlContent, func(match string) string {
		nameserverPolicyBlock = match
		return "___NAMESERVER_POLICY_PLACEHOLDER___\n"
	})

	quotedUnicodeRe := regexp.MustCompile(`"([^"]*\\[Uu][0-9A-Fa-f]{4,8}[^"]*)"`)
	result := quotedUnicodeRe.ReplaceAllStringFunc(yamlContent, func(match string) string {
		// 获取不带引号的内容
		content := strings.Trim(match, `"`)

		// 首先将 Unicode 转义转换为实际字符以检查真正的第一个字符
		tempContent := convertUnicodeEscapes(content)

		// 检查不带引号的字符串是否以需要引用的 YAML 特殊字符开头
		// 这些字符在YAML中有特殊含义，需要加引号
		if len(tempContent) > 0 {
			firstChar := tempContent[0]
			// 需要在开头引用的字符： [ ] { } * & ! | > ' " % @ ` # , ? :-
			if firstChar == '[' || firstChar == ']' || firstChar == '{' || firstChar == '}' ||
				firstChar == '*' || firstChar == '&' || firstChar == '!' || firstChar == '|' ||
				firstChar == '>' || firstChar == '\'' || firstChar == '"' || firstChar == '%' ||
				firstChar == '@' || firstChar == '`' || firstChar == '#' || firstChar == ',' ||
				firstChar == '?' || firstChar == ':' || firstChar == '-' {
				// 保留引号，但仍然在内部转换 Unicode 转义符
				return `"` + convertUnicodeEscapes(content) + `"`
			}
		}

		// 安全删除引号
		return content
	})

	// 第 2 步：将所有 Unicode 转义符转换回实际字符​​（带引号或不带引号）
	// \U0001F4B0 -> 💰, \u4E2D -> 中, \U0001F1ED\U0001F1F0 -> 🇭🇰
	result = convertUnicodeEscapes(result)

	// 步骤 3：从已知数字字段的数值中删除引号
	// 仅取消引用预计为数字的字段，以避免更改名称/服务器等字符串类型字段。
	numericFields := []string{
		"port", "socks-port", "redir-port", "tproxy-port", "mixed-port", "dns-port",
		"interval", "timeout", "geo-update-interval", "update-interval",
		"size-limit", "size_limit",
		"health-check-interval", "health-check-timeout",
	}
	numericFieldsPattern := fmt.Sprintf(`(?m)^(\s*)(%s):\s+"(\d+)"`, strings.Join(numericFields, "|"))
	numericQuotesRe := regexp.MustCompile(numericFieldsPattern)
	result = numericQuotesRe.ReplaceAllString(result, `$1$2: $3`)

	if nameserverPolicyBlock != "" {
		result = strings.Replace(result, "___NAMESERVER_POLICY_PLACEHOLDER___\n", nameserverPolicyBlock, 1)
	}

	return result
}

// ConvertUnicodeEscapes 将 Unicode 转义序列转换为实际字符
func convertUnicodeEscapes(s string) string {
	escapeRe := regexp.MustCompile(`\\U([0-9A-Fa-f]{8})|\\u([0-9A-Fa-f]{4})`)
	return escapeRe.ReplaceAllStringFunc(s, func(escapeSeq string) string {
		var codepoint int
		if strings.HasPrefix(escapeSeq, `\U`) {
			fmt.Sscanf(escapeSeq, `\U%X`, &codepoint)
		} else {
			fmt.Sscanf(escapeSeq, `\u%X`, &codepoint)
		}
		return string(rune(codepoint))
	})
}

// yaml.Unmarshal 方法会丢失数字前面的0, 先转为yaml.Node, 再转为map
func yamlNodeToMap(node *yaml.Node) (map[string]interface{}, error) {
	if node.Kind == yaml.DocumentNode {
		if len(node.Content) > 0 {
			return yamlNodeToMap(node.Content[0])
		}
		return nil, nil
	}

	if node.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("expected mapping node, got %v", node.Kind)
	}

	result := make(map[string]interface{})
	for i := 0; i < len(node.Content); i += 2 {
		if i+1 >= len(node.Content) {
			break
		}
		keyNode := node.Content[i]
		valueNode := node.Content[i+1]

		key := keyNode.Value
		value, err := yamlNodeToValue(valueNode)
		if err != nil {
			return nil, err
		}
		result[key] = value
	}
	return result, nil
}

// 转换为对应的 Go 类型值, 0开头的值保留其原始字符串格式
func yamlNodeToValue(node *yaml.Node) (interface{}, error) {
	switch node.Kind {
	case yaml.ScalarNode:
		// 对于带引号的字符串，保持字符串格式
		if node.Tag == "!!str" || node.Style == yaml.DoubleQuotedStyle || node.Style == yaml.SingleQuotedStyle {
			return node.Value, nil
		}
		if looksLikeNumericStringWithLeadingZero(node.Value) {
			return node.Value, nil
		}
		// 对于其他标量，使用标准解析
		var value interface{}
		if err := node.Decode(&value); err != nil {
			return node.Value, nil // 解码失败时返回原始字符串
		}
		return value, nil

	case yaml.SequenceNode:
		var result []interface{}
		for _, child := range node.Content {
			value, err := yamlNodeToValue(child)
			if err != nil {
				return nil, err
			}
			result = append(result, value)
		}
		return result, nil

	case yaml.MappingNode:
		return yamlNodeToMap(node)

	case yaml.AliasNode:
		return yamlNodeToValue(node.Alias)

	default:
		return nil, nil
	}
}

// 判断yaml节点的value是否是0开头的数字
func looksLikeNumericStringWithLeadingZero(s string) bool {
	if len(s) < 2 {
		return false
	}
	// 以 0 开头且后续都是数字的字符串（如 "045678"）
	if s[0] == '0' && len(s) > 1 && s[1] >= '0' && s[1] <= '9' {
		for _, c := range s[1:] {
			if c < '0' || c > '9' {
				return false
			}
		}
		return true
	}
	return false
}

// sanitizeExplicitStringTags 通过清除从标量节点中删除显式 !!str 标签
// TaggedStyle 位。这可以防止 YAML 编码器发出文字 !!str 标签
// 输出中，这可能会导致某些 YAML 客户端出现解析错误。
//
// 该函数递归地遍历整个节点树并标准化所有标量节点
// 具有显式字符串标签（!!str 或 tag:yaml.org,2002:str）。清除后
// TaggedStyle 位，编码器将使用隐式类型并自动添加引号
// 需要时，保持语义正确性，同时提高兼容性。
func sanitizeExplicitStringTags(node *yaml.Node) {
	if node == nil {
		return
	}

	// 清除具有显式字符串标签的标量节点的 TaggedStyle
	if node.Kind == yaml.ScalarNode && isExplicitStringTag(node.Tag) {
		node.Style &^= yaml.TaggedStyle
	}

	// 递归处理所有子节点
	for _, child := range node.Content {
		sanitizeExplicitStringTags(child)
	}
}

// 检查给定的 YAML 标记是否表示显式字符串类型
func isExplicitStringTag(tag string) bool {
	return tag == "!!str" || tag == "tag:yaml.org,2002:str"
}
