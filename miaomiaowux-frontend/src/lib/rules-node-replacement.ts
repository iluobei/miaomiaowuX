export type MissingRuleValueMode = 'node' | 'rule'

const SPECIAL_RULE_TARGETS = [
  'DIRECT',
  'REJECT',
  'PROXY',
  'no-resolve',
] as const

function getRuleTargetName(rule: unknown): string | null {
  if (typeof rule === 'string') {
    const parts = rule.split(',')
    if (parts.length < 2) return null
    return parts[parts.length - 1].trim()
  }

  if (typeof rule === 'object' && rule !== null) {
    const ruleObject = rule as Record<string, unknown>
    const target =
      ruleObject.target ??
      ruleObject.group ??
      ruleObject.proxy ??
      ruleObject.ruleset
    return typeof target === 'string' ? target : null
  }

  return null
}

function normalizeMissingValue(
  rule: unknown,
  mode: MissingRuleValueMode,
  fallbackNodeName: string
): string {
  if (mode === 'node') return fallbackNodeName
  if (typeof rule === 'string') return rule
  if (typeof rule === 'object' && rule !== null) {
    try {
      return JSON.stringify(rule)
    } catch {
      return String(rule)
    }
  }
  return String(rule)
}

function getAvailableTargetSet(parsedConfig: unknown): Set<string> {
  const groupNames = extractProxyGroupNames(parsedConfig)
  const targetSet = new Set<string>(groupNames)
  SPECIAL_RULE_TARGETS.forEach((target) => targetSet.add(target))
  return targetSet
}

export function extractProxyGroupNames(parsedConfig: unknown): string[] {
  if (!parsedConfig || typeof parsedConfig !== 'object') {
    return []
  }

  const configObject = parsedConfig as Record<string, unknown>
  const groups = configObject['proxy-groups']
  if (!Array.isArray(groups)) return []

  return groups
    .map((group) => {
      if (!group || typeof group !== 'object') return null
      const name = (group as Record<string, unknown>).name
      return typeof name === 'string' ? name.trim() : null
    })
    .filter((name): name is string => Boolean(name))
}

export function collectMissingRuleTargets(
  parsedConfig: unknown,
  mode: MissingRuleValueMode = 'node'
): string[] {
  if (!parsedConfig || typeof parsedConfig !== 'object') {
    return []
  }

  const configObject = parsedConfig as Record<string, unknown>
  const rules = Array.isArray(configObject.rules) ? configObject.rules : []
  const availableTargets = getAvailableTargetSet(parsedConfig)
  const missingValues = new Set<string>()

  rules.forEach((rule) => {
    const nodeName = getRuleTargetName(rule)
    if (!nodeName || availableTargets.has(nodeName)) {
      return
    }
    missingValues.add(normalizeMissingValue(rule, mode, nodeName))
  })

  return Array.from(missingValues)
}

export function replaceMissingRuleTargets(
  parsedConfig: unknown,
  replacement: string
): unknown {
  if (!parsedConfig || typeof parsedConfig !== 'object') {
    return parsedConfig
  }

  const configObject = parsedConfig as Record<string, unknown>
  const rules = Array.isArray(configObject.rules) ? configObject.rules : []
  const availableTargets = getAvailableTargetSet(parsedConfig)

  configObject.rules = rules.map((rule) => {
    const nodeName = getRuleTargetName(rule)
    if (!nodeName || availableTargets.has(nodeName)) {
      return rule
    }

    if (typeof rule === 'string') {
      const parts = rule.split(',')
      if (parts.length < 2) return rule
      parts[parts.length - 1] = replacement
      return parts.join(',')
    }

    if (typeof rule === 'object' && rule !== null) {
      const updatedRule = { ...(rule as Record<string, unknown>) }
      if (typeof updatedRule.target === 'string')
        updatedRule.target = replacement
      else if (typeof updatedRule.group === 'string')
        updatedRule.group = replacement
      else if (typeof updatedRule.proxy === 'string')
        updatedRule.proxy = replacement
      else if (typeof updatedRule.ruleset === 'string')
        updatedRule.ruleset = replacement
      return updatedRule
    }

    return rule
  })

  return configObject
}
