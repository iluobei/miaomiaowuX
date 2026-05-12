import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
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

function useToDisplayLabel() {
  const { t } = useTranslation('xray')
  return (slug: string) => {
    const key = slug.toLowerCase()
    if (DISPLAY_OVERRIDES[key]) {
      return DISPLAY_OVERRIDES[key]
    }
    if (key === 'default') {
      return t('composer.default')
    }
    if (key === 'none') {
      return t('composer.notRequired')
    }
    return key
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) =>
        part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1),
      )
      .join(' ')
  }
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
  const { t } = useTranslation('xray')
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
      setError(t('composer.jsonInvalid'))
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
  streamLabel,
  sniffingLabel,
  hints = [],
  showSniffing = true,
}: GenericProtocolFormProps) {
  const { t } = useTranslation('xray')

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
        description={t('composer.settingsDesc')}
      />

      <JsonEditorField
        label={streamLabel || t('composer.streamSettings')}
        value={inbound.streamSettings}
        onChange={handleStreamSettingsChange}
        placeholder={
          inbound.streamSettings ? JSON.stringify(inbound.streamSettings, null, 2) : undefined
        }
        description={t('composer.streamSettingsDesc')}
      />

      {showSniffing && (
        <JsonEditorField
          label={sniffingLabel || t('composer.sniffingSettings')}
          value={inbound.sniffing}
          onChange={handleSniffingChange}
          placeholder={
            inbound.sniffing ? JSON.stringify(inbound.sniffing, null, 2) : undefined
          }
          description={t('composer.sniffingSettingsDesc')}
        />
      )}
    </div>
  )
}

function useProtocolForms() {
  const { t } = useTranslation('xray')

  return useMemo(() => {
    const createProtocolForm =
      (config: Omit<GenericProtocolFormProps, 'inbound' | 'onInboundChange'>) =>
      (props: ProtocolFormProps) =>
        <GenericProtocolForm {...props} {...config} />

    const DefaultProtocolForm = createProtocolForm({
      settingsLabel: t('composer.protocolSettings'),
      hints: t('composer.defaultHints', { returnObjects: true }) as string[],
    })

    const forms: Record<string, (props: ProtocolFormProps) => JSX.Element> = {
      vless: createProtocolForm({
        settingsLabel: 'VLESS ' + t('composer.protocolSettings'),
        hints: t('composer.vlessHints', { returnObjects: true }) as string[],
      }),
      vmess: createProtocolForm({
        settingsLabel: 'VMess ' + t('composer.protocolSettings'),
        hints: t('composer.vmessHints', { returnObjects: true }) as string[],
      }),
      trojan: createProtocolForm({
        settingsLabel: 'Trojan ' + t('composer.protocolSettings'),
        hints: t('composer.trojanHints', { returnObjects: true }) as string[],
      }),
      shadowsocks: createProtocolForm({
        settingsLabel: 'Shadowsocks ' + t('composer.protocolSettings'),
        hints: t('composer.shadowsocksHints', { returnObjects: true }) as string[],
      }),
      shadowsocks_2022: createProtocolForm({
        settingsLabel: 'Shadowsocks 2022 ' + t('composer.protocolSettings'),
        hints: t('composer.shadowsocks2022Hints', { returnObjects: true }) as string[],
      }),
      socks: createProtocolForm({
        settingsLabel: 'SOCKS ' + t('composer.protocolSettings'),
        hints: t('composer.socksHints', { returnObjects: true }) as string[],
      }),
      http: createProtocolForm({
        settingsLabel: 'HTTP ' + t('composer.protocolSettings'),
        hints: t('composer.httpHints', { returnObjects: true }) as string[],
      }),
      tunnel: createProtocolForm({
        settingsLabel: 'tunnel ' + t('composer.protocolSettings'),
        hints: t('composer.tunnelHints', { returnObjects: true }) as string[],
      }),
    }

    return { forms, DefaultProtocolForm }
  }, [t])
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
  const { t } = useTranslation('xray')
  const { t: tc } = useTranslation('common')
  const toDisplayLabel = useToDisplayLabel()
  const { forms: ProtocolForms, DefaultProtocolForm } = useProtocolForms()

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
  }, [relevantPresets, toDisplayLabel])

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
  }, [relevantPresets, selectedTransport, toDisplayLabel])

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
      toast.error(t('wizard.selectTemplate'))
      return
    }

    if (selectedServerIds.length === 0) {
      toast.error(t('wizard.selectAtLeastOneServer'))
      return
    }

    const trimmedTag = inboundTag.trim()
    if (!trimmedTag) {
      toast.error(t('inbounds.fillTag'))
      return
    }

    const port = inboundDraft.port ?? 0
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      toast.error(t('wizard.validPort'))
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
    : t('composer.selectProtocolPrompt')

  const showServerPicker = selectionMode !== 'none' && servers.length > 1

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="space-y-6">
        {showServerPicker && (
          <div className="space-y-2">
            <Label>{t('composer.selectServer')}</Label>
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
            <Label>{t('composer.inboundProtocol')}</Label>
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
              <Label>{t('composer.transportProtocol')}</Label>
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
              <Label>{t('composer.securityProtocol')}</Label>
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
              <Label>{t('composer.templateVariant')}</Label>
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
            <p className="text-xs text-muted-foreground">{t('composer.currentTemplate')}: {selectedPreset.folderName}</p>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="inbound-tag">{t('composer.inboundTag')}</Label>
            <Input
              id="inbound-tag"
              value={inboundTag}
              onChange={(event) => setInboundTag(event.target.value)}
              placeholder={t('composer.inboundTagPlaceholder')}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="inbound-listen">{t('composer.listenAddress')}</Label>
              <Input
                id="inbound-listen"
                value={inboundDraft?.listen ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  setInboundDraft((prev) => (prev ? { ...prev, listen: value } : prev))
                }}
                placeholder="0.0.0.0 / 127.0.0.1"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="inbound-port">{t('composer.listenPort')}</Label>
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
              {tc('actions.cancel')}
            </Button>
          )}
          <Button onClick={handleSubmit}>{t('composer.saveInbound')}</Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <Label>{t('composer.livePreview')}</Label>
          <div className="max-h-[540px] overflow-auto rounded-md border bg-muted/20 p-3">
            <pre className="text-xs leading-relaxed">
              <code>{previewContent}</code>
            </pre>
          </div>
        </div>

        {selectedPreset?.requiresExternal && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-400/60 dark:bg-amber-900/20 dark:text-amber-200">
            <p>
              {t('composer.templateHint')}:{' '}
              {selectedPreset.requiresExternal === 'nginx'
                ? t('composer.needsNginx')
                : t('composer.needsCaddy')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
