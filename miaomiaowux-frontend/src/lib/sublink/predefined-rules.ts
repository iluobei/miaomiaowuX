// Predefined rule categories for custom selection
// Converted from sublink-worker's UNIFIED_RULES

import i18n from '@/lib/i18n'

export interface RuleCategory {
  name: string
  label: string
  icon: string
  site_rules: string[]  // GeoSite rules
  ip_rules: string[]    // GeoIP rules
}

function rc(name: string, icon: string, site_rules: string[], ip_rules: string[]): RuleCategory {
  return {
    name,
    get label() { return i18n.t(`subscribe:ruleCategories.${name}` as any) as string },
    icon,
    site_rules,
    ip_rules,
  }
}

export const RULE_CATEGORIES: RuleCategory[] = [
  rc('ads', '🔴', ['category-ads-all'], []),
  rc('ai', '🤖', ['category-ai-!cn'], []),
  rc('bilibili', '📺', ['bilibili'], []),
  rc('youtube', '📺', ['youtube'], []),
  rc('google', '🔍', ['google'], ['google']),
  rc('private', '🏠', [], ['private']),
  rc('domestic', '🔒', ['geolocation-cn', 'cn'], ['cn']),
  rc('telegram', '📱', [], ['telegram']),
  rc('github', '🐱', ['github', 'gitlab'], []),
  rc('microsoft', '🪟', ['microsoft'], []),
  rc('apple', '🍎', ['apple'], []),
  rc('social', '🌐', ['facebook', 'instagram', 'twitter', 'tiktok', 'linkedin'], []),
  rc('streaming', '📺', ['netflix', 'hulu', 'disney', 'hbo', 'amazon', 'bahamut'], []),
  rc('gaming', '🎮', ['steam', 'epicgames', 'ea', 'ubisoft', 'blizzard'], []),
  rc('education', '📚', ['coursera', 'edx', 'udemy', 'khanacademy', 'category-scholar-!cn'], []),
  rc('finance', '💰', ['paypal', 'visa', 'mastercard', 'stripe', 'wise'], []),
  rc('cloud', '☁️', ['aws', 'azure', 'digitalocean', 'heroku', 'dropbox'], []),
  rc('overseas', '🌍', ['geolocation-!cn'], []),
]

/**
 * Build Clash rules from selected categories
 * Converts GeoSite and GeoIP rules to Clash format
 */
export function buildCustomRulesFromCategories(selectedCategories: string[]): string[] {
  const rules: string[] = []

  for (const categoryName of selectedCategories) {
    const category = RULE_CATEGORIES.find((c) => c.name === categoryName)
    if (!category) continue

    // Add GeoSite rules (GEOSITE format for Clash)
    for (const siteRule of category.site_rules) {
      rules.push(`GEOSITE,${siteRule},PROXY`)
    }

    // Add GeoIP rules (GEOIP format for Clash)
    for (const ipRule of category.ip_rules) {
      if (ipRule === 'cn') {
        // Special handling for China IP - direct connection
        rules.push(`GEOIP,CN,DIRECT`)
      } else if (ipRule === 'private') {
        // Private network - direct connection
        rules.push(`GEOIP,PRIVATE,DIRECT`)
      } else {
        rules.push(`GEOIP,${ipRule.toUpperCase()},PROXY`)
      }
    }
  }

  // Add final fallback rule if "overseas" category is selected
  if (selectedCategories.includes('overseas')) {
    // geolocation-!cn already added as GEOSITE rule
    // Add final MATCH rule
    if (!rules.some((r) => r.startsWith('MATCH,'))) {
      rules.push('MATCH,PROXY')
    }
  }

  return rules
}

/**
 * Predefined rule set combinations
 * 注意：顺序必须与 RULE_CATEGORIES 中的定义顺序一致
 */
export const PREDEFINED_RULE_SETS = {
  // 按 RULE_CATEGORIES 顺序：ads, ai, bilibili, youtube, google, private, domestic, telegram, github...
  minimal: ['private', 'domestic', 'overseas'],
  balanced: ['ai', 'youtube', 'google', 'private', 'domestic', 'telegram', 'github', 'overseas'],
  comprehensive: RULE_CATEGORIES.map((rule) => rule.name),
}
