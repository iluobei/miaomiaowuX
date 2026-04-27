import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  XrayInbound,
  getProtocolOptions,
  getXrayPresets,
  type XrayPreset,
} from '@/lib/xray-presets'

export interface ComposerServer {
  id: number
  name: string
  host: string
  port: number
}

const DISPLAY_OVERRIDES: Record<string, string> = {
  ws: 'WebSocket (WS)',
  wss: 'WebSocket (WSS)',
  grpc: 'gRPC',
  mkcp: 'mKCP',
  mkcpseed: 'mKCP Seed',
  splithttp: 'SplitHTTP',
  xhttp: 'XHTTP',
  xhttp3: 'XHTTP/3',
  reality: 'REALITY',
  xtls: 'XTLS',
}

const normaliseTransport = (value?: string) => value?.toLowerCase() || 'default'
const normaliseSecurity = (value?: string) => value?.toLowerCase() || 'none'

const toDisplayLabel = (slug: string) => {
  const key = slug.toLowerCase()
  if (DISPLAY_OVERRIDES[key]) {
    return DISPLAY_OVERRIDES[key]
  }
  if (key === 'default') {
    return '默认'
  }
  if (key === 'none') {
    return '不需要'
  }
  return key
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ')
}

interface ProtocolFormProps {
  inbound: XrayInbound
  onInboundChange: (next: XrayInbound) => void
}

interface JsonEditorFieldProps {
  label: string
  value?: Record<string, any>
  onChange: (value?: Record<string, any>) => void
  placeholder?: string
  description?: string
}

function JsonEditorField({
  label,
  value,
  onChange,
  placeholder,
  description,
}: JsonEditorFieldProps) {
  const [text, setText] = useState(() => (value ? JSON.stringify(value, null, 2) : ''))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const next = value ? JSON.stringify(value, null, 2) : ''
    setText(next)
  }, [value])

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextText = event.target.value
    setText(nextText)

    if (!nextText.trim()) {
      onChange(undefined)
      setError(null)
      return
    }

    try {
      const parsed = JSON.parse(nextText)
      onChange(parsed)
      setError(null)
    } catch (err) {
      console.warn('[InboundComposer] Invalid JSON in editor', err)
      setError('JSON 格式不正确')
    }
  }

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Textarea value={text} onChange={handleChange} placeholder={placeholder} rows={6} />
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

interface GenericProtocolFormProps extends ProtocolFormProps {
  settingsLabel: string
  streamLabel?: string
  sniffingLabel?: string
  hints?: string[]
  showSniffing?: boolean
}

function GenericProtocolForm({
  inbound,
  onInboundChange,
  settingsLabel,
  streamLabel = '传输设置',
  sniffingLabel = '流量嗅探',
  hints = [],
  showSniffing = true,
}: GenericProtocolFormProps) {
  const handleSettingsChange = (settings?: Record<string, any>) => {
    const next = { ...inbound }
    if (settings && Object.keys(settings).length > 0) {
      next.settings = settings
    } else {
      delete next.settings
    }
    onInboundChange(next)
  }

  const handleStreamSettingsChange = (stream?: Record<string, any>) => {
    const next = { ...inbound }
    if (stream && Object.keys(stream).length > 0) {
      next.streamSettings = stream
    } else {
      delete next.streamSettings
    }
    onInboundChange(next)
  }

  const handleSniffingChange = (sniffing?: Record<string, any>) => {
    const next = { ...inbound }
    if (sniffing && Object.keys(sniffing).length > 0) {
      next.sniffing = sniffing
    } else {
      delete next.sniffing
    }
    onInboundChange(next)
  }

  return (
    <div className="space-y-4">
      {hints.length > 0 && (
        <div className="space-y-1 rounded-md border border-dashed border-muted bg-muted/40 p-3 text-xs text-muted-foreground">
          {hints.map((hint) => (
            <p key={hint}>{hint}</p>
          ))}
        </div>
      )}

      <JsonEditorField
        label={settingsLabel}
        value={inbound.settings}
        onChange={handleSettingsChange}
        placeholder={inbound.settings ? JSON.stringify(inbound.settings, null, 2) : undefined}
        description="根据示例填写或修改协议核心字段。"
      />

      <JsonEditorField
        label={streamLabel}
        value={inbound.streamSettings}
        onChange={handleStreamSettingsChange}
        placeholder={
          inbound.streamSettings ? JSON.stringify(inbound.streamSettings, null, 2) : undefined
        }
        description="根据需要调整传输层配置，例如 TLS 证书、路径或传输参数。"
      />

      {showSniffing && (
        <JsonEditorField
          label={sniffingLabel}
          value={inbound.sniffing}
          onChange={handleSniffingChange}
          placeholder={
            inbound.sniffing ? JSON.stringify(inbound.sniffing, null, 2) : undefined
          }
          description="可选配置，如无需嗅探可清空。"
        />
      )}
    </div>
  )
}

const createProtocolForm =
  (config: Omit<GenericProtocolFormProps, 'inbound' | 'onInboundChange'>) =>
  (props: ProtocolFormProps) =>
    <GenericProtocolForm {...props} {...config} />

const DefaultProtocolForm = createProtocolForm({
  settingsLabel: '协议设置',
  hints: ['根据示例模板调整 settings 和 streamSettings 内容。', '右侧实时预览会同步展示完整 JSON 配置。'],
})

const ProtocolForms: Record<string, (props: ProtocolFormProps) => JSX.Element> = {
  vless: createProtocolForm({
    settingsLabel: 'VLESS 设置',
    hints: ['clients: 配置用户列表，id 为 UUID。', 'decryption 一般保持为 none。', 'fallbacks 可选，用于回落到其他服务。'],
  }),
  vmess: createProtocolForm({
    settingsLabel: 'VMess 设置',
    hints: ['clients: 用户列表，包含 id、level、email 等字段。', '默认模板包含 default 节点，可按需调整。'],
  }),
  trojan: createProtocolForm({
    settingsLabel: 'Trojan 设置',
    hints: ['clients: 配置密码及用户信息。', '可选的 fallbacks 用于自定义回落。'],
  }),
  shadowsocks: createProtocolForm({
    settingsLabel: 'Shadowsocks 设置',
    hints: ['method/password 为必须字段。', '如需多用户，可在 clients 中追加。'],
  }),
  shadowsocks_2022: createProtocolForm({
    settingsLabel: 'Shadowsocks 2022 设置',
    hints: ['key 字段为 Base64 编码的密钥。', 'clients 中的 key 需要与客户端一致。'],
  }),
  socks: createProtocolForm({
    settingsLabel: 'SOCKS 设置',
    hints: ['auth 可选择 noauth 或 password。', 'accounts 字段在启用密码认证时使用。'],
  }),
  http: createProtocolForm({
    settingsLabel: 'HTTP 代理设置',
    hints: ['accounts 字段用于配置账户（可选）。', 'allowTransparent 控制是否允许透明代理。'],
  }),
  tunnel: createProtocolForm({
    settingsLabel: 'tunnel 设置',
    hints: ['address 与 port 指向目标服务。', 'network 字段决定代理的网络类型。'],
  }),
}

export interface InboundComposerProps {
  servers: ComposerServer[]
  selectionMode?: 'multiple' | 'single' | 'none'
  initialServerIds?: number[]
  onServerIdsChange?: (ids: number[]) => void
  onSubmit: (serverIds: number[], inbound: XrayInbound, tag: string) => void
  onCancel?: () => void
}

export function InboundComposer({
  servers,
  selectionMode = 'multiple',
  initialServerIds,
  onServerIdsChange,
  onSubmit,
  onCancel,
}: InboundComposerProps) {
  const presets = useMemo(() => getXrayPresets(), [])
  const protocolOptions = useMemo(() => getProtocolOptions(), [])

  const resolvedInitialServerIds = useMemo(() => {
    if (initialServerIds && initialServerIds.length > 0) {
      return initialServerIds
    }
    if (servers.length === 1) {
      return [servers[0].id]
    }
    return []
  }, [initialServerIds, servers])

  const [selectedServerIds, setSelectedServerIds] = useState<number[]>(resolvedInitialServerIds)
  const [selectedProtocol, setSelectedProtocol] = useState<string | null>(null)
  const [selectedTransport, setSelectedTransport] = useState<string | null>(null)
  const [selectedSecurity, setSelectedSecurity] = useState<string | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [inboundDraft, setInboundDraft] = useState<XrayInbound | null>(null)
  const [inboundTag, setInboundTag] = useState('')

  useEffect(() => {
    setSelectedServerIds(resolvedInitialServerIds)
  }, [resolvedInitialServerIds])

  useEffect(() => {
    onServerIdsChange?.(selectedServerIds)
  }, [selectedServerIds, onServerIdsChange])

  useEffect(() => {
    if (!selectedProtocol && protocolOptions.length > 0) {
      setSelectedProtocol(protocolOptions[0].value)
    }
  }, [protocolOptions, selectedProtocol])

  const relevantPresets = useMemo(() => {
    if (!selectedProtocol) {
      return [] as XrayPreset[]
    }
    return presets.filter((preset) => preset.protocol === selectedProtocol)
  }, [presets, selectedProtocol])

  const transportOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>()
    relevantPresets.forEach((preset) => {
      const transportKey = normaliseTransport(preset.transport)
      if (!map.has(transportKey)) {
        map.set(transportKey, { value: transportKey, label: toDisplayLabel(transportKey) })
      }
    })
    return Array.from(map.values())
  }, [relevantPresets])

  useEffect(() => {
    if (transportOptions.length === 0) {
      setSelectedTransport(null)
      return
    }
    if (!selectedTransport || !transportOptions.some((option) => option.value === selectedTransport)) {
      setSelectedTransport(transportOptions[0].value)
    }
  }, [transportOptions, selectedTransport])

  const securityOptions = useMemo(() => {
    if (!selectedTransport) {
      return [] as { value: string; label: string }[]
    }
    const map = new Map<string, { value: string; label: string }>()
    relevantPresets
      .filter((preset) => normaliseTransport(preset.transport) === selectedTransport)
      .forEach((preset) => {
        const securityKey = normaliseSecurity(preset.security)
        if (!map.has(securityKey)) {
          map.set(securityKey, { value: securityKey, label: toDisplayLabel(securityKey) })
        }
      })
    return Array.from(map.values())
  }, [relevantPresets, selectedTransport])

  useEffect(() => {
    if (!selectedTransport) {
      setSelectedSecurity(null)
      return
    }
    if (securityOptions.length === 0) {
      setSelectedSecurity('none')
      return
    }
    if (!selectedSecurity || !securityOptions.some((option) => option.value === selectedSecurity)) {
      setSelectedSecurity(securityOptions[0].value)
    }
  }, [securityOptions, selectedTransport, selectedSecurity])

  const variantPresets = useMemo(() => {
    if (!selectedProtocol || !selectedTransport) {
      return [] as XrayPreset[]
    }
    const securityKey = selectedSecurity ?? 'none'
    return relevantPresets.filter(
      (preset) =>
        normaliseTransport(preset.transport) === selectedTransport &&
        normaliseSecurity(preset.security) === securityKey,
    )
  }, [relevantPresets, selectedProtocol, selectedTransport, selectedSecurity])

  useEffect(() => {
    if (variantPresets.length === 0) {
      setSelectedPresetId(null)
      return
    }
    if (!selectedPresetId || !variantPresets.some((preset) => preset.id === selectedPresetId)) {
      setSelectedPresetId(variantPresets[0].id)
    }
  }, [variantPresets, selectedPresetId])

  const selectedPreset = useMemo<XrayPreset | null>(() => {
    if (!selectedPresetId) {
      return null
    }
    return presets.find((preset) => preset.id === selectedPresetId) ?? null
  }, [presets, selectedPresetId])

  useEffect(() => {
    if (selectedPreset) {
      const clone = JSON.parse(JSON.stringify(selectedPreset.inbound)) as XrayInbound
      setInboundDraft(clone)
      setInboundTag(clone.tag || '')
    } else {
      setInboundDraft(null)
      setInboundTag('')
    }
  }, [selectedPreset])

  const handleServerToggle = (id: number) => {
    setSelectedServerIds((prev) => {
      if (selectionMode === 'none') {
        return prev
      }
      if (selectionMode === 'single') {
        return prev.includes(id) ? prev : [id]
      }
      return prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    })
  }

  const handleInboundChange = (nextInbound: XrayInbound) => {
    setInboundDraft(nextInbound)
  }

  const handleSubmit = () => {
    if (!selectedPreset || !inboundDraft) {
      toast.error('请先选择完整的模板')
      return
    }

    if (selectedServerIds.length === 0) {
      toast.error('请选择至少一个服务器')
      return
    }

    const trimmedTag = inboundTag.trim()
    if (!trimmedTag) {
      toast.error('请填写标签')
      return
    }

    const port = inboundDraft.port ?? 0
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      toast.error('请输入有效的端口号 (1-65535)')
      return
    }

    const payload: XrayInbound = {
      ...inboundDraft,
      protocol: selectedPreset.inbound.protocol,
      tag: trimmedTag,
    }

    onSubmit(selectedServerIds, payload, trimmedTag)
  }

  const ProtocolFormComponent =
    selectedPreset && ProtocolForms[selectedPreset.protocol]
      ? ProtocolForms[selectedPreset.protocol]
      : DefaultProtocolForm

  const previewObject = inboundDraft
    ? {
        ...inboundDraft,
        protocol: selectedPreset?.inbound.protocol || inboundDraft.protocol,
        tag: inboundTag.trim() || undefined,
      }
    : null

  const previewContent = previewObject
    ? JSON.stringify({ inbounds: [previewObject] }, null, 2)
    : '请选择协议并根据模板填写配置'

  const showServerPicker = selectionMode !== 'none' && servers.length > 1

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="space-y-6">
        {showServerPicker && (
          <div className="space-y-2">
            <Label>选择服务器</Label>
            <div className="grid gap-2 rounded-md border p-3">
              {servers.map((server) => {
                const checked = selectedServerIds.includes(server.id)
                return (
                  <label key={server.id} className="flex cursor-pointer items-center gap-3 text-sm">
                    <input
                      type={selectionMode === 'single' ? 'radio' : 'checkbox'}
                      name="composer-servers"
                      value={server.id}
                      checked={checked}
                      onChange={() => handleServerToggle(server.id)}
                      className="h-4 w-4"
                    />
                    <span className="flex-1 truncate">
                      {server.name}{' '}
                      <span className="text-muted-foreground">
                        ({server.host}:{server.port})
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>入站协议</Label>
            <div className="flex flex-wrap gap-2">
              {protocolOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={selectedProtocol === option.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setSelectedProtocol(option.value)
                    setSelectedTransport(null)
                    setSelectedSecurity(null)
                    setSelectedPresetId(null)
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          {transportOptions.length > 0 && (
            <div className="space-y-2">
              <Label>传输协议</Label>
              <div className="flex flex-wrap gap-2">
                {transportOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={selectedTransport === option.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSelectedTransport(option.value)
                      setSelectedSecurity(null)
                      setSelectedPresetId(null)
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {securityOptions.length > 0 && (
            <div className="space-y-2">
              <Label>安全协议</Label>
              <div className="flex flex-wrap gap-2">
                {securityOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={selectedSecurity === option.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSelectedSecurity(option.value)
                      setSelectedPresetId(null)
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {variantPresets.length > 1 && (
            <div className="space-y-2">
              <Label>模板变体</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedPresetId ?? ''}
                onChange={(event) => setSelectedPresetId(event.target.value)}
              >
                {variantPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.variantLabel}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedPreset && (
            <p className="text-xs text-muted-foreground">当前模板: {selectedPreset.folderName}</p>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="inbound-tag">入站标签</Label>
            <Input
              id="inbound-tag"
              value={inboundTag}
              onChange={(event) => setInboundTag(event.target.value)}
              placeholder="例如: vless-main"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="inbound-listen">监听地址</Label>
              <Input
                id="inbound-listen"
                value={inboundDraft?.listen ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  setInboundDraft((prev) => (prev ? { ...prev, listen: value } : prev))
                }}
                placeholder="0.0.0.0 或 127.0.0.1"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inbound-port">监听端口</Label>
              <Input
                id="inbound-port"
                type="number"
                value={inboundDraft?.port ?? ''}
                onChange={(event) => {
                  const numeric = parseInt(event.target.value, 10)
                  setInboundDraft((prev) =>
                    prev ? { ...prev, port: Number.isNaN(numeric) ? undefined : numeric } : prev,
                  )
                }}
                placeholder="443"
                min={1}
                max={65535}
              />
            </div>
          </div>
        </div>

        {inboundDraft && (
          <ProtocolFormComponent inbound={inboundDraft} onInboundChange={handleInboundChange} />
        )}

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              取消
            </Button>
          )}
          <Button onClick={handleSubmit}>保存入站配置</Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <Label>实时预览</Label>
          <div className="max-h-[540px] overflow-auto rounded-md border bg-muted/20 p-3">
            <pre className="text-xs leading-relaxed">
              <code>{previewContent}</code>
            </pre>
          </div>
        </div>

        {selectedPreset?.requiresExternal && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-400/60 dark:bg-amber-900/20 dark:text-amber-200">
            <p>
              模板提示:{' '}
              {selectedPreset.requiresExternal === 'nginx'
                ? '需要额外配置 Nginx 反向代理。'
                : '需要额外配置 Caddy 以对接入站。'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
