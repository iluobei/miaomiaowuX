package substore

import (
	"strings"
	"testing"
)

func TestGenerateClashProxyGroups_SelectGroupRegexMatchesNodeNames(t *testing.T) {
	aclContent := "custom_proxy_group=🚀 手动选择`select`[]♻️ 自动选择`[]🇭🇰 香港节点`my.*\n"
	_, groups := ParseACLConfig(aclContent)
	if len(groups) != 1 {
		t.Fatalf("expected 1 proxy group, got %d", len(groups))
	}

	allProxyNames := []string{"my-hk-01", "my-us-02", "other-node"}
	got := GenerateClashProxyGroups(groups, allProxyNames)

	expectedContains := []string{
		"  - name: 🚀 手动选择",
		"      - ♻️ 自动选择",
		"      - 🇭🇰 香港节点",
		"      - my-hk-01",
		"      - my-us-02",
	}
	for _, expected := range expectedContains {
		if !strings.Contains(got, expected) {
			t.Errorf("generated output missing %q\noutput:\n%s", expected, got)
		}
	}

	if strings.Contains(got, "      - my.*") {
		t.Errorf("regex literal should not appear in generated proxies list\noutput:\n%s", got)
	}
}

func TestGenerateClashProxyGroups_SelectGroupParenthesizedRegexWithWildcard(t *testing.T) {
	aclContent := "custom_proxy_group=🚀 手动选择`select`(my)`[]♻️ 自动选择`[]🇭🇰 香港节点`.*\n"
	_, groups := ParseACLConfig(aclContent)
	if len(groups) != 1 {
		t.Fatalf("expected 1 proxy group, got %d", len(groups))
	}

	allProxyNames := []string{"my-hk-01", "other-node"}
	got := GenerateClashProxyGroups(groups, allProxyNames)

	expectedContains := []string{
		"  - name: 🚀 手动选择",
		"      - ♻️ 自动选择",
		"      - 🇭🇰 香港节点",
		"      - my-hk-01",
		"      - other-node",
	}
	for _, expected := range expectedContains {
		if !strings.Contains(got, expected) {
			t.Errorf("generated output missing %q\noutput:\n%s", expected, got)
		}
	}

	if strings.Contains(got, "      - (my)") {
		t.Errorf("regex literal should not appear in generated proxies list\noutput:\n%s", got)
	}
}

func TestGenerateClashProxyGroups_JapanRegexWithLookbehindAndJPWordBoundary(t *testing.T) {
	aclContent := "custom_proxy_group=🇯🇵 日本节点`url-test`(🇯🇵|日本|川日|东京|大阪|泉日|埼玉|沪日|深日|(?<!尼|-)日|\\bJP(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Japan|JAPAN|JPN|NRT|HND|KIX|TYO|OSA|关西|Kansai|KANSAI)`https://cp.cloudflare.com/generate_204`300,,50\n"
	_, groups := ParseACLConfig(aclContent)
	if len(groups) != 1 {
		t.Fatalf("expected 1 proxy group, got %d", len(groups))
	}

	allProxyNames := []string{
		"xxx JP xxx",
		"Tokyo Japan 01",
		"深日 IEPL",
		"印尼节点",
		"雅加达尼日专线",
	}
	got := GenerateClashProxyGroups(groups, allProxyNames)

	expectedContains := []string{
		"  - name: 🇯🇵 日本节点",
		"      - xxx JP xxx",
		"      - Tokyo Japan 01",
		"      - 深日 IEPL",
	}
	for _, expected := range expectedContains {
		if !strings.Contains(got, expected) {
			t.Errorf("generated output missing %q\noutput:\n%s", expected, got)
		}
	}

	notExpected := []string{
		"      - 印尼节点",
		"      - 雅加达尼日专线",
		"      - (🇯🇵|日本|川日|东京|大阪|泉日|埼玉|沪日|深日|(?<!尼|-)日|\\bJP(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Japan|JAPAN|JPN|NRT|HND|KIX|TYO|OSA|关西|Kansai|KANSAI)",
	}
	for _, item := range notExpected {
		if strings.Contains(got, item) {
			t.Errorf("generated output should not contain %q\noutput:\n%s", item, got)
		}
	}
}

func TestGenerateClashProxyGroups_LegacyModeRegexUsesFilterInsteadOfLiteralProxy(t *testing.T) {
	aclContent := "custom_proxy_group=🇯🇵 日本节点`url-test`(🇯🇵|日本|(?<!尼|-)日|\\bJP(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Japan)`https://cp.cloudflare.com/generate_204`300,,50\n"
	_, groups := ParseACLConfig(aclContent)
	if len(groups) != 1 {
		t.Fatalf("expected 1 proxy group, got %d", len(groups))
	}

	got := GenerateClashProxyGroups(groups, nil)

	if !strings.Contains(got, "    include-all: true") {
		t.Errorf("legacy mode should emit include-all for regex groups\noutput:\n%s", got)
	}
	if !strings.Contains(got, "    filter: ") {
		t.Errorf("legacy mode should emit filter for regex groups\noutput:\n%s", got)
	}
	if strings.Contains(got, "      - (🇯🇵|日本|(?<!尼|-)日|\\bJP(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Japan)") {
		t.Errorf("regex literal should not appear as proxy in legacy mode\noutput:\n%s", got)
	}
}
