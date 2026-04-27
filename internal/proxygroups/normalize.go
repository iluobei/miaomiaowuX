package proxygroups

import (
	"encoding/json"
	"fmt"
	"net/url"
	"path"
	"strings"
)

const (
	defaultRuleProviderType     = "http"
	defaultRuleProviderFormat   = "mrs"
	defaultRuleProviderInterval = 86400
	defaultPreset               = "comprehensive"
	metaRulesBaseURL            = "https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta"
)

// RuleProviderConfig 表示一个规则提供者配置
type RuleProviderConfig struct {
	Key      string `json:"key"`
	Behavior string `json:"behavior"`
	Type     string `json:"type"`
	Format   string `json:"format"`
	URL      string `json:"url"`
	Path     string `json:"path"`
	Interval int    `json:"interval"`
}

// ProxyGroupCategory 表示一个预置代理组分类
type ProxyGroupCategory struct {
	Name       string               `json:"name"`
	Label      string               `json:"label"`
	Emoji      string               `json:"emoji"`
	Icon       string               `json:"icon"`
	RuleName   string               `json:"rule_name"`
	GroupLabel string               `json:"group_label"`
	Presets    []string             `json:"presets"`
	SiteRules  []RuleProviderConfig `json:"site_rules"`
	IPRules    []RuleProviderConfig `json:"ip_rules"`
}

// NormalizeConfig 规范化代理组配置并补齐默认值
func NormalizeConfig(data []byte) ([]byte, error) {
	if len(strings.TrimSpace(string(data))) == 0 {
		data = []byte("[]")
	}

	var categories []ProxyGroupCategory
	if err := json.Unmarshal(data, &categories); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidConfig, err)
	}

	for i := range categories {
		normalizeCategory(&categories[i])
	}

	normalized, err := json.Marshal(categories)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidConfig, err)
	}
	return normalized, nil
}

func normalizeCategory(category *ProxyGroupCategory) {
	category.Name = strings.TrimSpace(category.Name)
	category.Label = strings.TrimSpace(category.Label)
	category.Emoji = strings.TrimSpace(category.Emoji)
	category.Icon = strings.TrimSpace(category.Icon)
	category.RuleName = strings.TrimSpace(category.RuleName)
	category.GroupLabel = strings.TrimSpace(category.GroupLabel)

	if category.Emoji == "" {
		category.Emoji = category.Icon
	}
	if category.Icon == "" {
		category.Icon = category.Emoji
	}

	if category.RuleName == "" {
		switch {
		case category.Name != "":
			category.RuleName = category.Name
		case category.Label != "":
			category.RuleName = category.Label
		}
	}

	if category.GroupLabel == "" {
		switch {
		case category.Emoji != "" && category.Label != "":
			category.GroupLabel = category.Emoji + " " + category.Label
		case category.Label != "":
			category.GroupLabel = category.Label
		default:
			category.GroupLabel = category.RuleName
		}
	}

	if category.Presets == nil {
		category.Presets = []string{defaultPreset}
	}
	if category.SiteRules == nil {
		category.SiteRules = []RuleProviderConfig{}
	}
	if category.IPRules == nil {
		category.IPRules = []RuleProviderConfig{}
	}

	for i := range category.SiteRules {
		normalizeRuleProvider(&category.SiteRules[i], "domain", "geosite")
	}
	for i := range category.IPRules {
		normalizeRuleProvider(&category.IPRules[i], "ipcidr", "geoip")
	}
}

func normalizeRuleProvider(rule *RuleProviderConfig, defaultBehavior, remoteCategory string) {
	rule.Key = strings.TrimSpace(rule.Key)
	rule.Behavior = strings.TrimSpace(rule.Behavior)
	rule.Type = strings.TrimSpace(rule.Type)
	rule.Format = strings.TrimSpace(rule.Format)
	rule.URL = strings.TrimSpace(rule.URL)
	rule.Path = strings.TrimSpace(rule.Path)

	if rule.Key == "" {
		rule.Key = inferRuleKey(rule.URL, rule.Path)
	}
	if rule.Behavior == "" {
		rule.Behavior = defaultBehavior
	}
	if rule.Type == "" {
		rule.Type = defaultRuleProviderType
	}
	if rule.Format == "" {
		rule.Format = inferRuleFormat(rule.URL, rule.Path)
	}
	if rule.Interval <= 0 {
		rule.Interval = defaultRuleProviderInterval
	}
	if rule.Path == "" && rule.Key != "" {
		rule.Path = fmt.Sprintf("./ruleset/%s.%s", rule.Key, rule.Format)
	}
	if rule.URL == "" && rule.Key != "" && rule.Format == defaultRuleProviderFormat {
		rule.URL = fmt.Sprintf("%s/geo/%s/%s.mrs", metaRulesBaseURL, remoteCategory, rule.Key)
	}
}

func inferRuleFormat(urlValue, pathValue string) string {
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(pathValue), "."))
	if ext == "" {
		if parsed, err := url.Parse(urlValue); err == nil {
			ext = strings.ToLower(strings.TrimPrefix(path.Ext(parsed.Path), "."))
		}
	}
	switch ext {
	case "yaml", "yml":
		return "yaml"
	case "txt", "text":
		return "text"
	case "mrs":
		return "mrs"
	default:
		return defaultRuleProviderFormat
	}
}

func inferRuleKey(urlValue, pathValue string) string {
	extractBaseName := func(value string) string {
		if value == "" {
			return ""
		}
		base := path.Base(value)
		ext := path.Ext(base)
		if ext != "" {
			base = strings.TrimSuffix(base, ext)
		}
		return strings.TrimSpace(base)
	}

	if key := extractBaseName(pathValue); key != "" {
		return key
	}
	if parsed, err := url.Parse(urlValue); err == nil {
		if key := extractBaseName(parsed.Path); key != "" {
			return key
		}
	}
	return ""
}
