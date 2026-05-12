import { parse } from 'jsonc-parser'
import i18n from '@/lib/i18n'

export type XrayInbound = {
  tag?: string
  listen?: string
  port?: number
  protocol: string
  settings?: Record<string, any>
  streamSettings?: Record<string, any>
  sniffing?: Record<string, any>
  [key: string]: any
}

export interface XrayPreset {
  id: string
  folderName: string
  protocol: string
  transport: string | undefined
  security: string | undefined
  requiresExternal: 'nginx' | 'caddy' | undefined
  variantLabel: string
  inbound: XrayInbound
}

type RawGlob = Record<string, string>

const configServerGlobs: RawGlob = import.meta.glob('../../Xray-examples/**/config_server.jsonc', {
  as: 'raw',
  eager: true,
})

const serverGlobs: RawGlob = import.meta.glob('../../Xray-examples/**/server.jsonc', {
  as: 'raw',
  eager: true,
})

const rawFiles: RawGlob = {
  ...configServerGlobs,
  ...serverGlobs,
}

const sanitizeLabel = (value: string | undefined) => value?.trim() || undefined

const normaliseName = (value: string | undefined) =>
  value?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '') || undefined

const getRequiresExternal = (folderName: string): 'nginx' | 'caddy' | undefined => {
  const lower = folderName.toLowerCase()
  if (lower.includes('nginx')) {
    return 'nginx'
  }
  if (lower.includes('caddy')) {
    return 'caddy'
  }
  return undefined
}

const extractVariantLabel = (folderName: string, protocol: string, transport: string | undefined, security: string | undefined) => {
  const normalised = folderName.replace(/\s+/g, ' ').trim()
  const title = normalised.startsWith(protocol.toUpperCase())
    ? normalised.substring(protocol.length).replace(/^[\s\-]+/, '')
    : normalised

  const transportLabel = transport ? transport.toUpperCase() : ''
  const securityLabel = security ? security.toUpperCase() : ''

  if (title) {
    return title
  }

  const pieces = [transportLabel, securityLabel].filter(Boolean)
  return pieces.length > 0 ? pieces.join(' + ') : i18n.t('xray:presets.defaultLabel')
}

const toPreset = (entry: [string, string]): XrayPreset | null => {
  const [path, rawContent] = entry
  try {
    const parsed = parse(rawContent) as { inbounds?: XrayInbound[] }
    const inbound = parsed.inbounds?.[0]
    if (!inbound || !inbound.protocol) {
      return null
    }

    const folderName = path.split('/').slice(-2, -1)[0] || ''
    const transportFromConfig = sanitizeLabel((inbound.streamSettings as any)?.network)
    const securityFromConfig = sanitizeLabel((inbound.streamSettings as any)?.security)

    const requiresExternal = getRequiresExternal(folderName)

    const preset: XrayPreset = {
      id: path,
      folderName,
      protocol: inbound.protocol.toLowerCase(),
      transport: transportFromConfig?.toLowerCase(),
      security: securityFromConfig?.toLowerCase(),
      requiresExternal,
      variantLabel: extractVariantLabel(
        folderName,
        inbound.protocol,
        transportFromConfig,
        securityFromConfig,
      ),
      inbound,
    }

    if (!preset.transport) {
      const parts = folderName.split('-')
      if (parts.length > 1) {
        preset.transport = normaliseName(parts[1])
      }
    }

    if (!preset.security && requiresExternal) {
      preset.security = requiresExternal
    }

    return preset
  } catch (error) {
    console.warn('[xray-presets] Failed to parse preset', path, error)
    return null
  }
}

const presets = Object.entries(rawFiles)
  .map(toPreset)
  .filter((preset): preset is XrayPreset => Boolean(preset))

export const getXrayPresets = () => presets

export const getPresetsByProtocol = (protocol: string) =>
  presets.filter((preset) => preset.protocol === protocol.toLowerCase())

export const getProtocolOptions = () => {
  const map = new Map<string, string>()
  presets.forEach((preset) => {
    const key = preset.protocol
    if (!map.has(key)) {
      map.set(key, key.toUpperCase())
    }
  })
  return Array.from(map.entries()).map(([value, label]) => ({ value, label }))
}
