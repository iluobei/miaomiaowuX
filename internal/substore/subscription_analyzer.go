package substore

import (
	"log"
	"strings"

	"gopkg.in/yaml.v3"
)

// RegionFilter defines a region with its filter pattern
type RegionFilter struct {
	Name   string `json:"name"`
	Filter string `json:"filter"`
}

// AnalyzedProxyGroup represents an analyzed proxy group with inferred V3 config
type AnalyzedProxyGroup struct {
	Name                     string   `json:"name"`
	Type                     string   `json:"type"`
	OriginalProxies          []string `json:"original_proxies,omitempty"`
	InferredFilter           string   `json:"inferred_filter,omitempty"`
	InferredExcludeFilter    string   `json:"inferred_exclude_filter,omitempty"`
	IncludeAll               bool     `json:"include_all,omitempty"`
	IncludeAllProxies        bool     `json:"include_all_proxies,omitempty"`
	IncludeAllProviders      bool     `json:"include_all_providers,omitempty"`
	IncludeRegionProxyGroups bool     `json:"include_region_proxy_groups,omitempty"`
	MatchedRegion            string   `json:"matched_region,omitempty"`
	ReferencedGroups         []string `json:"referenced_groups,omitempty"`
	URL                      string   `json:"url,omitempty"`
	Interval                 int      `json:"interval,omitempty"`
	Tolerance                int      `json:"tolerance,omitempty"`
}

// SubscriptionAnalysisResult contains the analysis result
type SubscriptionAnalysisResult struct {
	ProxyGroups         []AnalyzedProxyGroup `json:"proxy_groups"`
	AllProxyNames       []string             `json:"all_proxy_names"`
	Rules               []string             `json:"rules,omitempty"`
	RuleProviders       map[string]any       `json:"rule_providers,omitempty"`
	AddRegionGroups     bool                 `json:"add_region_groups"`
	MatchedRegionCounts map[string]int       `json:"matched_region_counts"`
}

// ExtendedRegionFilters contains comprehensive region filters
var ExtendedRegionFilters = []RegionFilter{
	{Name: "🇭🇰 香港节点", Filter: "🇭🇰|港|\\bHK(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|hk|Hong Kong|HongKong|hongkong|HONG KONG|HONGKONG|深港|HKG|九龙|Kowloon|新界|沙田|荃湾|葵涌"},
	{Name: "🇺🇸 美国节点", Filter: "🇺🇸|美|波特兰|达拉斯|俄勒冈|凤凰城|费利蒙|硅谷|拉斯维加斯|洛杉矶|圣何塞|圣克拉拉|西雅图|芝加哥|纽约|纽纽|亚特兰大|迈阿密|华盛顿|\\bUS(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|United States|UnitedStates|UNITED STATES|USA|America|AMERICA|JFK|EWR|IAD|ATL|ORD|MIA|NYC|LAX|SFO|SEA|DFW|SJC"},
	{Name: "🇯🇵 日本节点", Filter: "🇯🇵|日本|川日|东京|大阪|泉日|埼玉|沪日|深日|(?<!尼|-)日|\\bJP(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Japan|JAPAN|JPN|NRT|HND|KIX|TYO|OSA|关西|Kansai|KANSAI"},
	{Name: "🇸🇬 新加坡节点", Filter: "🇸🇬|新加坡|坡|狮城|\\bSG(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Singapore|SINGAPORE|SIN"},
	{Name: "🇼🇸 台湾节点", Filter: "🇹🇼|🇼🇸|台|新北|彰化|\\bTW(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Taiwan|TAIWAN|TWN|TPE|ROC"},
	{Name: "🇰🇷 韩国节点", Filter: "🇰🇷|\\bKR(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Korea|KOREA|KOR|首尔|韩|韓|春川|Chuncheon|ICN"},
	{Name: "🇨🇦 加拿大节点", Filter: "🇨🇦|加拿大|\\bCA(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Canada|CANADA|CAN|渥太华|温哥华|卡尔加里|蒙特利尔|Montreal|YVR|YYZ|YUL"},
	{Name: "🇬🇧 英国节点", Filter: "🇬🇧|英国|Britain|United Kingdom|UNITED KINGDOM|England|伦敦|曼彻斯特|Manchester|\\bUK(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|GBR|LHR|MAN"},
	{Name: "🇫🇷 法国节点", Filter: "🇫🇷|法国|\\bFR(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|France|FRANCE|FRA|巴黎|马赛|Marseille|CDG|MRS"},
	{Name: "🇩🇪 德国节点", Filter: "🇩🇪|德国|Germany|GERMANY|\\bDE(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|DEU|柏林|法兰克福|慕尼黑|Munich|MUC"},
	{Name: "🇳🇱 荷兰节点", Filter: "🇳🇱|荷兰|Netherlands|NETHERLANDS|\\bNL(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|NLD|阿姆斯特丹|AMS"},
	{Name: "🇹🇷 土耳其节点", Filter: "🇹🇷|土耳其|Turkey|TURKEY|Türkiye|\\bTR(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|TUR|IST|ANK"},
}

// OtherRegionExcludeFilter is the exclude filter for "Other regions" group
const OtherRegionExcludeFilter = "(^(?!.*(港|\\bHK(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|hk|Hong Kong|HongKong|hongkong|HONG KONG|HONGKONG|深港|HKG|🇭🇰|九龙|Kowloon|新界|沙田|荃湾|葵涌|美|波特兰|达拉斯|俄勒冈|凤凰城|费利蒙|硅谷|拉斯维加斯|洛杉矶|圣何塞|圣克拉拉|西雅图|芝加哥|纽约|纽纽|亚特兰大|迈阿密|华盛顿|\\bUS(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|United States|UnitedStates|UNITED STATES|USA|America|AMERICA|JFK|EWR|IAD|ATL|ORD|MIA|NYC|LAX|SFO|SEA|DFW|SJC|🇺🇸|日本|川日|东京|大阪|泉日|埼玉|沪日|深日|(?<!尼|-)日|\\bJP(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Japan|JAPAN|JPN|NRT|HND|KIX|TYO|OSA|🇯🇵|关西|Kansai|KANSAI|新加坡|坡|狮城|\\bSG(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Singapore|SINGAPORE|SIN|🇸🇬|台|新北|彰化|\\bTW(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Taiwan|TAIWAN|TWN|TPE|ROC|🇹🇼|\\bKR(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Korea|KOREA|KOR|首尔|韩|韓|春川|Chuncheon|ICN|🇰🇷|加拿大|\\bCA(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|Canada|CANADA|CAN|渥太华|温哥华|卡尔加里|蒙特利尔|Montreal|YVR|YYZ|YUL|🇨🇦|英国|Britain|United Kingdom|UNITED KINGDOM|England|伦敦|曼彻斯特|Manchester|\\bUK(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|GBR|LHR|MAN|🇬🇧|法国|\\bFR(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|France|FRANCE|FRA|巴黎|马赛|Marseille|CDG|MRS|🇫🇷|德国|Germany|GERMANY|\\bDE(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|DEU|柏林|法兰克福|慕尼黑|Munich|MUC|🇩🇪|荷兰|Netherlands|NETHERLANDS|\\bNL(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|NLD|阿姆斯特丹|AMS|🇳🇱|土耳其|Turkey|TURKEY|Türkiye|\\bTR(?:[-_ ]?\\d+(?:[-_ ]?[A-Za-z]{2,})?)?\\b|TUR|IST|ANK|🇹🇷)).*)"

// AnalyzeSubscription analyzes a subscription YAML content and infers V3 template config
func AnalyzeSubscription(content string, allNodeNames []string) (*SubscriptionAnalysisResult, error) {
	log.Printf("[订阅分析] 开始分析订阅，内容长度: %d 字节，节点数: %d", len(content), len(allNodeNames))

	var yamlConfig map[string]any
	if err := yaml.Unmarshal([]byte(content), &yamlConfig); err != nil {
		log.Printf("[订阅分析] YAML解析失败: %v", err)
		return nil, err
	}

	result := &SubscriptionAnalysisResult{
		ProxyGroups:         []AnalyzedProxyGroup{},
		AllProxyNames:       []string{},
		MatchedRegionCounts: make(map[string]int),
	}

	// Extract proxy names from subscription
	if proxies, ok := yamlConfig["proxies"].([]any); ok {
		for _, proxy := range proxies {
			if proxyMap, ok := proxy.(map[string]any); ok {
				if name, ok := proxyMap["name"].(string); ok && name != "" {
					result.AllProxyNames = append(result.AllProxyNames, name)
				}
			}
		}
	}
	log.Printf("[订阅分析] 从订阅中提取到 %d 个代理节点", len(result.AllProxyNames))

	// Use allNodeNames if provided, otherwise use extracted names
	nodeNames := allNodeNames
	if len(nodeNames) == 0 {
		nodeNames = result.AllProxyNames
	}

	// Calculate region matches for all nodes
	for _, region := range ExtendedRegionFilters {
		count := countMatchingNodes(nodeNames, region.Filter)
		result.MatchedRegionCounts[region.Name] = count
		log.Printf("[订阅分析] 区域 '%s' 匹配到 %d 个节点", region.Name, count)
	}

	// Extract and analyze proxy groups
	if proxyGroups, ok := yamlConfig["proxy-groups"].([]any); ok {
		for _, pg := range proxyGroups {
			if pgMap, ok := pg.(map[string]any); ok {
				analyzed := analyzeProxyGroup(pgMap, nodeNames, result.AllProxyNames)
				result.ProxyGroups = append(result.ProxyGroups, analyzed)
			}
		}
	}
	log.Printf("[订阅分析] 分析了 %d 个代理组", len(result.ProxyGroups))

	// Extract rules
	if rules, ok := yamlConfig["rules"].([]any); ok {
		for _, rule := range rules {
			if ruleStr, ok := rule.(string); ok {
				result.Rules = append(result.Rules, ruleStr)
			}
		}
	}

	// Extract rule-providers
	if ruleProviders, ok := yamlConfig["rule-providers"].(map[string]any); ok {
		result.RuleProviders = ruleProviders
	}

	// Determine if we should add region groups
	result.AddRegionGroups = shouldAddRegionGroups(result.ProxyGroups, result.MatchedRegionCounts)

	return result, nil
}

// analyzeProxyGroup analyzes a single proxy group and infers V3 config
func analyzeProxyGroup(pgMap map[string]any, allNodeNames, subscriptionProxies []string) AnalyzedProxyGroup {
	name := getString(pgMap, "name")
	groupType := getString(pgMap, "type")

	log.Printf("[分析代理组] 开始分析: '%s' (类型: %s)", name, groupType)

	analyzed := AnalyzedProxyGroup{
		Name:      name,
		Type:      groupType,
		URL:       getString(pgMap, "url"),
		Interval:  getInt(pgMap, "interval"),
		Tolerance: getInt(pgMap, "tolerance"),
	}

	// Get original proxies list
	if proxies, ok := pgMap["proxies"].([]any); ok {
		for _, p := range proxies {
			if pStr, ok := p.(string); ok {
				analyzed.OriginalProxies = append(analyzed.OriginalProxies, pStr)
			}
		}
	}

	// Check if it already has V3-style config
	if getBool(pgMap, "include-all") {
		analyzed.IncludeAll = true
		analyzed.InferredFilter = getString(pgMap, "filter")
		analyzed.InferredExcludeFilter = getString(pgMap, "exclude-filter")
		log.Printf("[分析代理组] '%s' 已有 include-all 配置", name)
		return analyzed
	}

	if getBool(pgMap, "include-all-proxies") {
		analyzed.IncludeAllProxies = true
		analyzed.InferredFilter = getString(pgMap, "filter")
		analyzed.InferredExcludeFilter = getString(pgMap, "exclude-filter")
		log.Printf("[分析代理组] '%s' 已有 include-all-proxies 配置", name)
		return analyzed
	}

	// Analyze proxies to infer config
	if len(analyzed.OriginalProxies) == 0 {
		log.Printf("[分析代理组] '%s' 没有代理列表", name)
		return analyzed
	}

	// Separate proxy references from group references
	var actualProxies []string
	var groupRefs []string
	proxyGroupNames := getProxyGroupNames(allNodeNames, subscriptionProxies)

	for _, proxy := range analyzed.OriginalProxies {
		if proxy == "DIRECT" || proxy == "REJECT" {
			groupRefs = append(groupRefs, proxy)
		} else if isProxyGroupName(proxy, proxyGroupNames) {
			groupRefs = append(groupRefs, proxy)
		} else {
			actualProxies = append(actualProxies, proxy)
		}
	}

	analyzed.ReferencedGroups = groupRefs
	log.Printf("[分析代理组] '%s' 引用了 %d 个代理组, %d 个实际代理", name, len(groupRefs), len(actualProxies))

	// Check if all proxies are included
	if len(actualProxies) >= len(allNodeNames)*9/10 && len(allNodeNames) > 0 {
		analyzed.IncludeAllProxies = true
		log.Printf("[分析代理组] '%s' 包含了大部分节点，推断为 include-all-proxies", name)
		return analyzed
	}

	// Try to match region filter
	if len(actualProxies) > 0 {
		matchedRegion, filter := inferRegionFilter(actualProxies, allNodeNames)
		if matchedRegion != "" {
			analyzed.MatchedRegion = matchedRegion
			analyzed.InferredFilter = filter
			analyzed.IncludeAllProxies = true
			log.Printf("[分析代理组] '%s' 匹配区域 '%s', filter: %s", name, matchedRegion, filter)
		}
	}

	return analyzed
}

// inferRegionFilter tries to match proxies to a region filter
func inferRegionFilter(proxies []string, allNodeNames []string) (string, string) {
	if len(proxies) == 0 {
		return "", ""
	}

	bestMatch := ""
	bestFilter := ""
	bestScore := 0.0

	for _, region := range ExtendedRegionFilters {
		matchCount := 0
		for _, proxy := range proxies {
			if matchesFilter(proxy, region.Filter) {
				matchCount++
			}
		}

		if matchCount == 0 {
			continue
		}

		// Calculate match score: how well does this filter match the proxies?
		// Score = (matched / total proxies) * (matched / total matching nodes in all)
		totalMatching := countMatchingNodes(allNodeNames, region.Filter)
		if totalMatching == 0 {
			continue
		}

		precision := float64(matchCount) / float64(len(proxies))
		recall := float64(matchCount) / float64(totalMatching)

		// F1 score
		if precision+recall > 0 {
			score := 2 * precision * recall / (precision + recall)
			if score > bestScore && precision > 0.8 {
				bestScore = score
				bestMatch = region.Name
				bestFilter = region.Filter
			}
		}
	}

	return bestMatch, bestFilter
}

// countMatchingNodes counts how many nodes match a filter
func countMatchingNodes(nodeNames []string, filter string) int {
	count := 0
	for _, name := range nodeNames {
		if matchesFilter(name, filter) {
			count++
		}
	}
	return count
}

// matchesFilter checks if a name matches a filter pattern
func matchesFilter(name, filter string) bool {
	re, err := compileCompatibleRegex("(?i)" + filter)
	if err != nil {
		// Fallback to simple contains check
		parts := strings.Split(filter, "|")
		for _, part := range parts {
			if strings.Contains(strings.ToLower(name), strings.ToLower(part)) {
				return true
			}
		}
		return false
	}
	return re.MatchString(name)
}

// shouldAddRegionGroups determines if region groups should be added
func shouldAddRegionGroups(groups []AnalyzedProxyGroup, regionCounts map[string]int) bool {
	// Check if any existing group already uses region filters
	for _, g := range groups {
		if g.MatchedRegion != "" || g.IncludeRegionProxyGroups {
			return false
		}
	}

	// Check if we have nodes in multiple regions
	regionsWithNodes := 0
	for _, count := range regionCounts {
		if count > 0 {
			regionsWithNodes++
		}
	}

	return regionsWithNodes >= 2
}

// Helper functions
func getString(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func getInt(m map[string]any, key string) int {
	if v, ok := m[key].(int); ok {
		return v
	}
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return 0
}

func getBool(m map[string]any, key string) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return false
}

func getProxyGroupNames(allNodeNames, subscriptionProxies []string) map[string]bool {
	nodeSet := make(map[string]bool)
	for _, n := range allNodeNames {
		nodeSet[n] = true
	}
	for _, n := range subscriptionProxies {
		nodeSet[n] = true
	}
	return nodeSet
}

func isProxyGroupName(name string, nodeNames map[string]bool) bool {
	// If it's a known node name, it's NOT a proxy group
	if nodeNames[name] {
		return false
	}

	// DIRECT and REJECT are special built-in groups
	if name == "DIRECT" || name == "REJECT" {
		return true
	}

	// Common group name patterns (only match if NOT a node)
	groupPatterns := []string{
		"节点选择", "自动选择", "全球直连", "广告拦截", "漏网之鱼",
		"手动选择", "故障转移", "负载均衡", "PROXY", "Proxy", "proxy",
		"SELECT", "Select", "select", "AUTO", "Auto", "auto",
	}

	for _, pattern := range groupPatterns {
		if strings.Contains(name, pattern) {
			return true
		}
	}

	return false
}

// GenerateV3TemplateFromAnalysis generates a V3 template from analysis result
func GenerateV3TemplateFromAnalysis(analysis *SubscriptionAnalysisResult) string {
	var lines []string

	lines = append(lines, "mode: rule")
	lines = append(lines, "")

	// DNS config
	lines = append(lines, "dns:")
	lines = append(lines, "  enable: true")
	lines = append(lines, "  enhanced-mode: fake-ip")
	lines = append(lines, "  fake-ip-range: 198.18.0.1/16")
	lines = append(lines, "  nameserver:")
	lines = append(lines, "    - https://doh.pub/dns-query")
	lines = append(lines, "  ipv6: false")
	lines = append(lines, "")

	lines = append(lines, "proxies:")
	lines = append(lines, "")

	// Add region groups flag if needed
	if analysis.AddRegionGroups {
		lines = append(lines, "add-region-proxy-groups: true")
		lines = append(lines, "")
	}

	// Proxy groups
	lines = append(lines, "proxy-groups:")
	for _, pg := range analysis.ProxyGroups {
		lines = append(lines, "  - name: "+pg.Name)
		lines = append(lines, "    type: "+pg.Type)

		if pg.IncludeAll {
			lines = append(lines, "    include-all: true")
		} else if pg.IncludeAllProxies {
			lines = append(lines, "    include-all-proxies: true")
		}

		if pg.InferredFilter != "" {
			lines = append(lines, "    filter: "+pg.InferredFilter)
		}

		if pg.InferredExcludeFilter != "" {
			lines = append(lines, "    exclude-filter: "+pg.InferredExcludeFilter)
		}

		if pg.IncludeRegionProxyGroups {
			lines = append(lines, "    include-region-proxy-groups: true")
		}

		if len(pg.ReferencedGroups) > 0 {
			lines = append(lines, "    proxies:")
			for _, ref := range pg.ReferencedGroups {
				lines = append(lines, "      - "+ref)
			}
		}

		if pg.URL != "" {
			lines = append(lines, "    url: "+pg.URL)
		}
		if pg.Interval > 0 {
			lines = append(lines, "    interval: "+intToStr(pg.Interval))
		}
		if pg.Tolerance > 0 {
			lines = append(lines, "    tolerance: "+intToStr(pg.Tolerance))
		}
	}

	// Rules
	if len(analysis.Rules) > 0 {
		lines = append(lines, "")
		lines = append(lines, "rules:")
		for _, rule := range analysis.Rules {
			lines = append(lines, "  - "+rule)
		}
	}

	return strings.Join(lines, "\n")
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	var result []byte
	for n > 0 {
		result = append([]byte{byte('0' + n%10)}, result...)
		n /= 10
	}
	return string(result)
}
