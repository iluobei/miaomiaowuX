package substore

import (
	"testing"
)

func TestAnalyzeSubscription(t *testing.T) {
	// Sample subscription YAML content
	content := `
proxies:
  - name: 🇭🇰 香港 01
    type: vmess
    server: hk1.example.com
    port: 443
  - name: 🇭🇰 香港 02
    type: vmess
    server: hk2.example.com
    port: 443
  - name: 🇺🇸 美国 01
    type: vmess
    server: us1.example.com
    port: 443
  - name: 🇯🇵 日本 01
    type: vmess
    server: jp1.example.com
    port: 443
  - name: 🇸🇬 新加坡 01
    type: vmess
    server: sg1.example.com
    port: 443

proxy-groups:
  - name: 🚀 节点选择
    type: select
    proxies:
      - 🎯 全球直连
      - ♻️ 自动选择
      - 🇭🇰 香港节点
      - 🇺🇸 美国节点
  - name: ♻️ 自动选择
    type: url-test
    proxies:
      - 🇭🇰 香港 01
      - 🇭🇰 香港 02
      - 🇺🇸 美国 01
      - 🇯🇵 日本 01
      - 🇸🇬 新加坡 01
    url: http://www.gstatic.com/generate_204
    interval: 300
  - name: 🇭🇰 香港节点
    type: url-test
    proxies:
      - 🇭🇰 香港 01
      - 🇭🇰 香港 02
    url: http://www.gstatic.com/generate_204
    interval: 300
  - name: 🇺🇸 美国节点
    type: url-test
    proxies:
      - 🇺🇸 美国 01
    url: http://www.gstatic.com/generate_204
    interval: 300
  - name: 🎯 全球直连
    type: select
    proxies:
      - DIRECT

rules:
  - GEOIP,CN,🎯 全球直连
  - MATCH,🚀 节点选择
`

	allNodeNames := []string{
		"🇭🇰 香港 01", "🇭🇰 香港 02",
		"🇺🇸 美国 01",
		"🇯🇵 日本 01",
		"🇸🇬 新加坡 01",
	}

	result, err := AnalyzeSubscription(content, allNodeNames)
	if err != nil {
		t.Fatalf("AnalyzeSubscription failed: %v", err)
	}

	t.Logf("Analyzed %d proxy groups", len(result.ProxyGroups))
	t.Logf("All proxy names: %v", result.AllProxyNames)
	t.Logf("Matched region counts: %v", result.MatchedRegionCounts)
	t.Logf("Add region groups: %v", result.AddRegionGroups)

	for i, pg := range result.ProxyGroups {
		t.Logf("Proxy Group[%d]: Name='%s', Type='%s'", i, pg.Name, pg.Type)
		t.Logf("  IncludeAllProxies=%v, InferredFilter='%s', MatchedRegion='%s'",
			pg.IncludeAllProxies, pg.InferredFilter, pg.MatchedRegion)
		t.Logf("  ReferencedGroups=%v", pg.ReferencedGroups)
	}

	// Verify proxy names were extracted
	if len(result.AllProxyNames) != 5 {
		t.Errorf("Expected 5 proxy names, got %d", len(result.AllProxyNames))
	}

	// Verify region counts
	if result.MatchedRegionCounts["🇭🇰 香港节点"] != 2 {
		t.Errorf("Expected 2 Hong Kong nodes, got %d", result.MatchedRegionCounts["🇭🇰 香港节点"])
	}

	// Generate template
	templateContent := GenerateV3TemplateFromAnalysis(result)
	t.Logf("Generated template:\n%s", templateContent)

	if templateContent == "" {
		t.Error("Generated template is empty")
	}
}

func TestMatchesFilter(t *testing.T) {
	tests := []struct {
		name     string
		filter   string
		expected bool
	}{
		{"🇭🇰 香港 01", "港|HK|Hong Kong", true},
		{"🇺🇸 美国 01", "美|US|USA", true},
		{"🇯🇵 日本 01", "日|JP|Japan", true},
		{"🇸🇬 新加坡 01", "新加坡|SG|Singapore", true},
		{"xxx JP xxx", "🇯🇵|日本|(?<!尼|-)日|\\bJP(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Japan", true},
		{"印尼节点", "🇯🇵|日本|(?<!尼|-)日|\\bJP(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Japan", false},
		{"🇭🇰 香港 01", "美|US|USA", false},
		{"Random Node", "港|HK|Hong Kong", false},
	}

	for _, tt := range tests {
		result := matchesFilter(tt.name, tt.filter)
		if result != tt.expected {
			t.Errorf("matchesFilter(%q, %q) = %v, expected %v", tt.name, tt.filter, result, tt.expected)
		}
	}
}
