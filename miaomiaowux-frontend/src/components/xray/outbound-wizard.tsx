// @ts-nocheck
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from './form-field'
import { NodeSelectDialog } from './node-select-dialog'
import { Import, Eye, X } from 'lucide-react'
import { protocolFields } from '@/lib/xray-form-fields'
import { generateOutboundConfig } from '@/lib/xray-config-generator'

// Protocol colors matching node management
const PROTOCOL_COLORS: Record<string, string> = {
  VLESS: 'text-purple-700 dark:text-purple-400',
  VMess: 'text-blue-700 dark:text-blue-400',
  Trojan: 'text-red-700 dark:text-red-400',
  Shadowsocks2022: 'text-green-700 dark:text-green-400',
  Socks5: 'text-yellow-700 dark:text-yellow-400',
  HTTP: 'text-cyan-700 dark:text-cyan-400',
  Tunnel: 'text-orange-700 dark:text-orange-400',
  Freedom: 'text-emerald-700 dark:text-emerald-400',
  Blackhole: 'text-gray-700 dark:text-gray-400',
}

interface Server {
  id: number
  name: string
  host: string
  port: number
}

interface OutboundWizardProps {
  servers: Server[]
  selectedServerIds: number[]
  onCancel: () => void
  onSubmit: (serverIds: number[], outbound: any, tag: string) => Promise<void>
}

export function OutboundWizard({ servers, selectedServerIds, onCancel, onSubmit }: OutboundWizardProps) {
  const { t } = useTranslation('xray')
  const { t: tc } = useTranslation('common')
  const [selectedProtocol, setSelectedProtocol] = useState<string>('')
  const [selectedTransport, setSelectedTransport] = useState<string>('TCP')
  const [selectedSecurity, setSelectedSecurity] = useState<string>('None')
  const [formData, setFormData] = useState<any>({
    address: '',
    port: 443,
    tag: '',
    users: [],
    decryption: 'none',
    encryption: 'none',
    domainStrategy: 'AsIs',
  })

  // Node selection dialog state
  const [isNodeSelectOpen, setIsNodeSelectOpen] = useState(false)
  // Track if current config was imported from a node
  const [isNodeImported, setIsNodeImported] = useState(false)
  const [showMobileJsonPreview, setShowMobileJsonPreview] = useState(false)

  // Check if current protocol is a simple outbound (no transport/security/users)
  const isSimpleOutbound = selectedProtocol === 'Freedom' || selectedProtocol === 'Blackhole'

  useEffect(() => {
    if (selectedProtocol === 'Freedom') {
      setFormData((prev: any) => ({ ...prev, tag: 'direct' }))
    } else if (selectedProtocol === 'Blackhole') {
      setFormData((prev: any) => ({ ...prev, tag: 'block' }))
    }
  }, [selectedProtocol])

  const handleProtocolSelect = (protocol: string) => {
    setSelectedProtocol(protocol)
    setIsNodeImported(false)
  }

  // Handle node import from node list
  const handleNodeImport = (node: any, clashConfig: any) => {
    const protocolMap: Record<string, string> = {
      vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan',
      ss: 'Shadowsocks2022', socks5: 'Socks5', http: 'HTTP',
    }
    const transportMap: Record<string, string> = {
      ws: 'WebSocket', grpc: 'gRPC', h2: 'HTTP/2', tcp: 'TCP',
      quic: 'QUIC', httpupgrade: 'HTTPUpgrade', splithttp: 'SplitHTTP',
    }

    const clashType = clashConfig.type?.toLowerCase() || ''
    const protocol = protocolMap[clashType] || 'VLESS'
    setSelectedProtocol(protocol)

    const network = clashConfig.network?.toLowerCase() || 'tcp'
    const transport = transportMap[network] || 'TCP'
    setSelectedTransport(transport)

    let security = 'None'
    if (clashConfig.tls === true || clashConfig.tls === 'true') security = 'TLS'
    else if (clashConfig.reality === true || clashConfig['reality-opts']) security = 'Reality'
    setSelectedSecurity(security)

    const newFormData: any = {
      address: clashConfig.server || '', port: clashConfig.port || 443,
      tag: clashConfig.name || node.node_name || 'proxy',
      decryption: 'none', encryption: 'none', domainStrategy: 'AsIs', users: [],
    }

    const user: any = {}
    if (protocol === 'VLESS') {
      user.id = clashConfig.uuid || ''
      if (clashConfig.flow) user.flow = clashConfig.flow
      newFormData.users = [user]
    } else if (protocol === 'VMess') {
      user.id = clashConfig.uuid || ''
      user.alterId = clashConfig.alterId || 0
      user.security = clashConfig.cipher || 'auto'
      newFormData.users = [user]
    } else if (protocol === 'Trojan') {
      user.password = clashConfig.password || ''
      newFormData.users = [user]
    } else if (protocol === 'Shadowsocks2022') {
      newFormData.method = clashConfig.cipher || '2022-blake3-aes-128-gcm'
      newFormData.password = clashConfig.password || ''
    } else if (protocol === 'Socks5' || protocol === 'HTTP') {
      if (clashConfig.username || clashConfig.password) {
        newFormData.accounts = [{ user: clashConfig.username || '', pass: clashConfig.password || '' }]
      }
    }

    if (transport === 'WebSocket') {
      const wsOpts = clashConfig['ws-opts'] || {}
      newFormData.path = wsOpts.path || '/'
      if (wsOpts.headers?.Host) newFormData.host = wsOpts.headers.Host
    } else if (transport === 'gRPC') {
      const grpcOpts = clashConfig['grpc-opts'] || {}
      newFormData.serviceName = grpcOpts['grpc-service-name'] || ''
    } else if (transport === 'HTTP/2') {
      const h2Opts = clashConfig['h2-opts'] || {}
      newFormData.path = h2Opts.path || '/'
      if (h2Opts.host && h2Opts.host.length > 0) newFormData.host = h2Opts.host[0]
    } else if (transport === 'HTTPUpgrade') {
      newFormData.path = clashConfig.path || '/'
      newFormData.host = clashConfig.host || ''
    }

    if (security === 'TLS') {
      newFormData.serverNames = clashConfig.sni || clashConfig.servername || clashConfig.server || ''
      newFormData.alpn = clashConfig.alpn?.join(',') || ''
      if (clashConfig['skip-cert-verify']) newFormData.allowInsecure = true
      if (clashConfig.fingerprint) newFormData.fingerprint = clashConfig.fingerprint
    } else if (security === 'Reality') {
      const realityOpts = clashConfig['reality-opts'] || {}
      newFormData.serverNames = realityOpts['server-name'] || clashConfig.sni || ''
      newFormData.publicKey = realityOpts['public-key'] || ''
      newFormData.shortId = realityOpts['short-id'] || ''
      if (clashConfig.fingerprint) newFormData.fingerprint = clashConfig.fingerprint
    }

    setFormData(newFormData)
    setIsNodeImported(true)
  }

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData((prev: any) => {
      const next = { ...prev, [fieldName]: value }
      if (fieldName === 'dest' && value) {
        const host = value.split(':')[0]
        if (host) next.serverNames = host
      }
      return next
    })
  }

  const handleFormSubmit = async () => {
    const outbound = generateOutboundConfig(formData, selectedProtocol, selectedTransport, selectedSecurity)
    let tag = formData.tag
    if (!tag) {
      const parts = [selectedProtocol.toLowerCase()]
      if (selectedTransport && selectedTransport !== 'None') parts.push(selectedTransport.toLowerCase())
      if (selectedSecurity && selectedSecurity !== 'None') parts.push(selectedSecurity.toLowerCase())
      parts.push(String(formData.port || 443))
      tag = parts.join('-')
    }
    await onSubmit(selectedServerIds, outbound, tag)
  }

  const simpleOutboundFields = protocolFields[selectedProtocol] || []

  const jsonPreviewContent = JSON.stringify(
    generateOutboundConfig(formData, selectedProtocol, selectedTransport, selectedSecurity),
    null, 2,
  )

  const renderJsonPreview = (sticky = false) => (
    <Card className={sticky ? '' : undefined}>
      <CardHeader>
        <CardTitle>{t('outbounds.jsonPreview')}</CardTitle>
        <CardDescription>{t('outbounds.realtimeOutboundConfig')}</CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-4 rounded overflow-auto max-h-[60vh]">
          {jsonPreviewContent}
        </pre>
      </CardContent>
    </Card>
  )

  const renderMobileJsonPreview = () => showMobileJsonPreview && (
    <div className="md:hidden fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed inset-4 bg-background border rounded-lg shadow-lg flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold">{t('outbounds.jsonPreview')}</h3>
            <p className="text-sm text-muted-foreground">{t('outbounds.realtimeOutboundConfig')}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setShowMobileJsonPreview(false)}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-4 rounded">{jsonPreviewContent}</pre>
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Quick Import from Nodes */}
      <div>
        <Button variant="outline" onClick={() => setIsNodeSelectOpen(true)} type="button">
          <Import className="h-4 w-4 mr-2" />
          {t('outbounds.createFromNode')}
        </Button>
      </div>

      {/* Simple Outbound Selection */}
      <div>
        <h3 className="text-lg font-semibold mb-4">{t('outbounds.orCreateSpecial')}</h3>
        <div className="flex flex-wrap gap-2 md:gap-3">
          <Button
            variant={selectedProtocol === 'Freedom' ? 'default' : 'secondary'}
            className={selectedProtocol === 'Freedom' ? '' : PROTOCOL_COLORS['Freedom'] || ''}
            onClick={() => handleProtocolSelect('Freedom')}
            type="button"
          >
            Freedom ({t('outbounds.directOutbound')})
          </Button>
          <Button
            variant={selectedProtocol === 'Blackhole' ? 'default' : 'secondary'}
            className={selectedProtocol === 'Blackhole' ? '' : PROTOCOL_COLORS['Blackhole'] || ''}
            onClick={() => handleProtocolSelect('Blackhole')}
            type="button"
          >
            Blackhole ({t('outbounds.blockOutbound')})
          </Button>
        </div>
      </div>

      {/* Form for simple outbound (Freedom/Blackhole) */}
      {selectedProtocol && isSimpleOutbound && (
        <>
          <div className="flex gap-6">
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('outbounds.basicConfig')}</CardTitle>
                    <CardDescription>{selectedProtocol === 'Freedom' ? t('outbounds.directOutboundConfig') : t('outbounds.blockOutboundConfig')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      field={{
                        name: 'tag', label: 'fields.labelField', type: 'text', required: true,
                        placeholder: selectedProtocol === 'Freedom' ? 'direct' : 'block',
                        description: 'fields.outboundUniqueId',
                      }}
                      value={formData.tag}
                      onChange={(value) => handleFieldChange('tag', value)}
                    />
                  </CardContent>
                </Card>
                {simpleOutboundFields.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('outbounds.protocolConfig')}</CardTitle>
                      <CardDescription>{selectedProtocol}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {simpleOutboundFields.map((field) => (
                        <FormField key={field.name} field={field} value={formData[field.name]} onChange={(value) => handleFieldChange(field.name, value)} />
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
            <div className="hidden md:block w-[380px] flex-shrink-0 self-start sticky top-4">
              {renderJsonPreview(true)}
            </div>
          </div>
          <Button variant="outline" size="icon" className="md:hidden fixed right-4 top-1/2 -translate-y-1/2 z-50 h-12 w-12 rounded-full shadow-lg bg-background border-primary" onClick={() => setShowMobileJsonPreview(true)}>
            <Eye className="h-5 w-5" />
          </Button>
          {renderMobileJsonPreview()}
        </>
      )}

      {/* Form for node-imported outbound */}
      {isNodeImported && !isSimpleOutbound && (
        <>
          <div className="flex gap-6">
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('outbounds.importedNodeConfig')}</CardTitle>
                    <CardDescription>
                      {t('inbounds.protocolLabel')}: <span className={PROTOCOL_COLORS[selectedProtocol] || ''}>{selectedProtocol}</span>
                      {selectedTransport !== 'TCP' && ` | ${t('composer.transportProtocol')}: ${selectedTransport}`}
                      {selectedSecurity !== 'None' && ` | ${t('composer.securityProtocol')}: ${selectedSecurity}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      field={{
                        name: 'tag', label: 'fields.labelField', type: 'text', required: true,
                        placeholder: 'proxy', description: 'fields.outboundUniqueId',
                      }}
                      value={formData.tag}
                      onChange={(value) => handleFieldChange('tag', value)}
                    />
                    <div className="text-sm text-muted-foreground">
                      {t('outbounds.serverInfo')}: {formData.address}:{formData.port}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
            <div className="hidden md:block w-[380px] flex-shrink-0 self-start sticky top-4">
              {renderJsonPreview(true)}
            </div>
          </div>
          <Button variant="outline" size="icon" className="md:hidden fixed right-4 top-1/2 -translate-y-1/2 z-50 h-12 w-12 rounded-full shadow-lg bg-background border-primary" onClick={() => setShowMobileJsonPreview(true)}>
            <Eye className="h-5 w-5" />
          </Button>
          {renderMobileJsonPreview()}
        </>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button variant="outline" onClick={onCancel} type="button">
          {tc('actions.cancel')}
        </Button>
        {((selectedProtocol && isSimpleOutbound) || (isNodeImported && !isSimpleOutbound)) && (
          <Button onClick={handleFormSubmit} type="button">
            {t('outbounds.submitConfig')}
          </Button>
        )}
      </div>

      {/* Node Select Dialog */}
      <NodeSelectDialog
        open={isNodeSelectOpen}
        onOpenChange={setIsNodeSelectOpen}
        onSelect={handleNodeImport}
        protocolFilter={['vless', 'vmess', 'trojan', 'ss', 'socks5', 'http']}
      />
    </div>
  )
}
