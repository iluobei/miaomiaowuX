package proxygroups

import (
	"encoding/json"
	"testing"
	"time"
)

func TestNormalizeConfigAppliesDefaults(t *testing.T) {
	input := []byte(`[
		{
			"name": "ai",
			"label": "AI 服务",
			"emoji": "🤖",
			"site_rules": [
				{"key": "openai"}
			]
		}
	]`)

	normalized, err := NormalizeConfig(input)
	if err != nil {
		t.Fatalf("NormalizeConfig failed: %v", err)
	}

	var got []ProxyGroupCategory
	if err := json.Unmarshal(normalized, &got); err != nil {
		t.Fatalf("unmarshal normalized config failed: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 category, got %d", len(got))
	}

	cat := got[0]
	if cat.Icon != "🤖" {
		t.Fatalf("expected icon to default to emoji, got %q", cat.Icon)
	}
	if cat.RuleName != "ai" {
		t.Fatalf("expected rule_name default to name, got %q", cat.RuleName)
	}
	if cat.GroupLabel != "🤖 AI 服务" {
		t.Fatalf("expected group_label default, got %q", cat.GroupLabel)
	}
	if len(cat.Presets) != 1 || cat.Presets[0] != "comprehensive" {
		t.Fatalf("expected default presets, got %#v", cat.Presets)
	}
	if cat.IPRules == nil || len(cat.IPRules) != 0 {
		t.Fatalf("expected empty ip_rules array, got %#v", cat.IPRules)
	}
	if len(cat.SiteRules) != 1 {
		t.Fatalf("expected 1 site rule, got %d", len(cat.SiteRules))
	}

	rule := cat.SiteRules[0]
	if rule.Behavior != "domain" {
		t.Fatalf("expected default behavior=domain, got %q", rule.Behavior)
	}
	if rule.Type != "http" {
		t.Fatalf("expected default type=http, got %q", rule.Type)
	}
	if rule.Format != "mrs" {
		t.Fatalf("expected default format=mrs, got %q", rule.Format)
	}
	if rule.Interval != 86400 {
		t.Fatalf("expected default interval=86400, got %d", rule.Interval)
	}
	if rule.Path != "./ruleset/openai.mrs" {
		t.Fatalf("expected default path, got %q", rule.Path)
	}
	if rule.URL != "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/openai.mrs" {
		t.Fatalf("expected default url, got %q", rule.URL)
	}
}

func TestNormalizeConfigInfersKeyAndFormatFromURL(t *testing.T) {
	input := []byte(`[
		{
			"name": "pt",
			"label": "PT",
			"emoji": "📦",
			"site_rules": [
				{"url": "https://example.com/rules/ptdomain.yaml"}
			]
		}
	]`)

	normalized, err := NormalizeConfig(input)
	if err != nil {
		t.Fatalf("NormalizeConfig failed: %v", err)
	}

	var got []ProxyGroupCategory
	if err := json.Unmarshal(normalized, &got); err != nil {
		t.Fatalf("unmarshal normalized config failed: %v", err)
	}
	rule := got[0].SiteRules[0]

	if rule.Key != "ptdomain" {
		t.Fatalf("expected inferred key=ptdomain, got %q", rule.Key)
	}
	if rule.Format != "yaml" {
		t.Fatalf("expected inferred format=yaml, got %q", rule.Format)
	}
	if rule.Path != "./ruleset/ptdomain.yaml" {
		t.Fatalf("expected inferred path, got %q", rule.Path)
	}
	if rule.URL != "https://example.com/rules/ptdomain.yaml" {
		t.Fatalf("expected original url, got %q", rule.URL)
	}
}

func TestStoreUpdateNormalizesData(t *testing.T) {
	store, err := NewStore([]byte(`[]`), "test")
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}

	err = store.Update([]byte(`[
		{
			"name": "google",
			"label": "谷歌服务",
			"emoji": "🔍",
			"ip_rules": [
				{"key": "google"}
			]
		}
	]`), "test-update", time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	data, _, _ := store.Snapshot()
	var got []ProxyGroupCategory
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal snapshot failed: %v", err)
	}

	if len(got) != 1 || len(got[0].IPRules) != 1 {
		t.Fatalf("unexpected normalized snapshot: %#v", got)
	}
	if got[0].IPRules[0].Behavior != "ipcidr" {
		t.Fatalf("expected ip_rules default behavior=ipcidr, got %q", got[0].IPRules[0].Behavior)
	}
}

func TestNormalizeConfigPreservesExplicitEmptyPresets(t *testing.T) {
	input := []byte(`[
		{
			"name": "proxy",
			"label": "代理服务",
			"emoji": "🔀",
			"presets": []
		}
	]`)

	normalized, err := NormalizeConfig(input)
	if err != nil {
		t.Fatalf("NormalizeConfig failed: %v", err)
	}

	var got []ProxyGroupCategory
	if err := json.Unmarshal(normalized, &got); err != nil {
		t.Fatalf("unmarshal normalized config failed: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 category, got %d", len(got))
	}
	if got[0].Presets == nil {
		t.Fatalf("expected explicit empty presets to remain non-nil empty slice")
	}
	if len(got[0].Presets) != 0 {
		t.Fatalf("expected explicit empty presets, got %#v", got[0].Presets)
	}
}

func TestNormalizeConfigEmojiIconCanUseEitherOne(t *testing.T) {
	input := []byte(`[
		{
			"name": "only-emoji",
			"label": "仅 Emoji",
			"emoji": "😀"
		},
		{
			"name": "only-icon",
			"label": "仅 Icon",
			"icon": "🧩"
		}
	]`)

	normalized, err := NormalizeConfig(input)
	if err != nil {
		t.Fatalf("NormalizeConfig failed: %v", err)
	}

	var got []ProxyGroupCategory
	if err := json.Unmarshal(normalized, &got); err != nil {
		t.Fatalf("unmarshal normalized config failed: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 categories, got %d", len(got))
	}

	if got[0].Emoji != "😀" || got[0].Icon != "😀" {
		t.Fatalf("expected only-emoji item to fill icon from emoji, got emoji=%q icon=%q", got[0].Emoji, got[0].Icon)
	}
	if got[1].Emoji != "🧩" || got[1].Icon != "🧩" {
		t.Fatalf("expected only-icon item to fill emoji from icon, got emoji=%q icon=%q", got[1].Emoji, got[1].Icon)
	}
}
