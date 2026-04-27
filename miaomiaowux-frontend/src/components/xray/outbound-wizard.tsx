// @ts-nocheck
import { useState, useEffect } from 'react'
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

// Security protocol display labels
const getSecurityLabel = (security: string): string => {
  if (security === 'None') return '无'
  if (security.includes('MLKEM768')) return security.replace('MLKEM768', '后量子加密')
  return security
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
  // 移动端 JSON 预览弹窗状态
  const [showMobileJsonPreview, setShowMobileJsonPreview] = useState(false)

  // Check if current protocol is a simple outbound (no transport/security/users)
  const isSimpleOutbound = selectedProtocol === 'Freedom' || selectedProtocol === 'Blackhole'

  // 自动更新tag默认值 for Freedom/Blackhole
  useEffect(() => {
    if (selectedProtocol === 'Freedom') {
      setFormData((prev: any) => ({
        ...prev,
        tag: 'direct',
      }))
    } else if (selectedProtocol === 'Blackhole') {
      setFormData((prev: any) => ({
        ...prev,
        tag: 'block',
      }))
    }
  }, [selectedProtocol])

  const handleProtocolSelect = (protocol: string) => {
    setSelectedProtocol(protocol)
    setIsNodeImported(false) // Clear node imported state when manually selecting
  }

  // Handle node import from node list
  const handleNodeImport = (node: any, clashConfig: any) => {
    // Map Clash proxy type to Xray protocol
    const protocolMap: Record<string, string> = {
      vless: 'VLESS',
      vmess: 'VMess',
      trojan: 'Trojan',
      ss: 'Shadowsocks2022',
      socks5: 'Socks5',
      http: 'HTTP',
    }

    // Map Clash network to Xray transport
    const transportMap: Record<string, string> = {
      ws: 'WebSocket',
      grpc: 'gRPC',
      h2: 'HTTP/2',
      tcp: 'TCP',
      quic: 'QUIC',
      httpupgrade: 'HTTPUpgrade',
      splithttp: 'SplitHTTP',
    }

    const clashType = clashConfig.type?.toLowerCase() || ''
    const protocol = protocolMap[clashType] || 'VLESS'

    // Set protocol first
    setSelectedProtocol(protocol)

    // Determine transport
    const network = clashConfig.network?.toLowerCase() || 'tcp'
    const transport = transportMap[network] || 'TCP'
    setSelectedTransport(transport)

    // Determine security
    let security = 'None'
    if (clashConfig.tls === true || clashConfig.tls === 'true') {
      security = 'TLS'
    } else if (clashConfig.reality === true || clashConfig['reality-opts']) {
      security = 'Reality'
    }
    setSelectedSecurity(security)

    // Build form data from clash config
    const newFormData: any = {
      address: clashConfig.server || '',
      port: clashConfig.port || 443,
      tag: clashConfig.name || node.node_name || 'proxy',
      decryption: 'none',
      encryption: 'none',
      domainStrategy: 'AsIs',
      users: [],
    }

    // Build user/client config based on protocol
    const user: any = {}
    if (protocol === 'VLESS') {
      user.id = clashConfig.uuid || ''
      if (clashConfig.flow) {
        user.flow = clashConfig.flow
      }
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
        newFormData.accounts = [{
          user: clashConfig.username || '',
          pass: clashConfig.password || '',
        }]
      }
    }

    // Transport-specific settings
    if (transport === 'WebSocket') {
      const wsOpts = clashConfig['ws-opts'] || {}
      newFormData.path = wsOpts.path || '/'
      if (wsOpts.headers?.Host) {
        newFormData.host = wsOpts.headers.Host
      }
    } else if (transport === 'gRPC') {
      const grpcOpts = clashConfig['grpc-opts'] || {}
      newFormData.serviceName = grpcOpts['grpc-service-name'] || ''
    } else if (transport === 'HTTP/2') {
      const h2Opts = clashConfig['h2-opts'] || {}
      newFormData.path = h2Opts.path || '/'
      if (h2Opts.host && h2Opts.host.length > 0) {
        newFormData.host = h2Opts.host[0]
      }
    } else if (transport === 'HTTPUpgrade') {
      newFormData.path = clashConfig.path || '/'
      newFormData.host = clashConfig.host || ''
    }

    // TLS settings
    if (security === 'TLS') {
      newFormData.serverNames = clashConfig.sni || clashConfig.servername || clashConfig.server || ''
      newFormData.alpn = clashConfig.alpn?.join(',') || ''
      if (clashConfig['skip-cert-verify']) {
        newFormData.allowInsecure = true
      }
      if (clashConfig.fingerprint) {
        newFormData.fingerprint = clashConfig.fingerprint
      }
    } else if (security === 'Reality') {
      const realityOpts = clashConfig['reality-opts'] || {}
      newFormData.serverNames = realityOpts['server-name'] || clashConfig.sni || ''
      newFormData.publicKey = realityOpts['public-key'] || ''
      newFormData.shortId = realityOpts['short-id'] || ''
      if (clashConfig.fingerprint) {
        newFormData.fingerprint = clashConfig.fingerprint
      }
    }

    setFormData(newFormData)
    setIsNodeImported(true) // Mark as node imported
  }

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData((prev: any) => {
      const next = { ...prev, [fieldName]: value }

      // When dest field (host:port) changes, sync the host part to serverNames
      if (fieldName === 'dest' && value) {
        const host = value.split(':')[0]
        if (host) {
          next.serverNames = host
        }
      }

      return next
    })
  }

  const handleFormSubmit = async () => {
    const outbound = generateOutboundConfig(formData, selectedProtocol, selectedTransport, selectedSecurity)

    // 生成默认tag（如果用户没有填写）
    let tag = formData.tag
    if (!tag) {
      const parts = [selectedProtocol.toLowerCase()]
      if (selectedTransport && selectedTransport !== 'None') {
        parts.push(selectedTransport.toLowerCase())
      }
      if (selectedSecurity && selectedSecurity !== 'None') {
        parts.push(selectedSecurity.toLowerCase())
      }
      parts.push(String(formData.port || 443))
      tag = parts.join('-')
    }

    await onSubmit(selectedServerIds, outbound, tag)
  }

  // 简化的出站配置字段（仅用于 Freedom）
  const simpleOutboundFields = protocolFields[selectedProtocol] || []

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Quick Import from Nodes */}
      <div>
        <Button
          variant="outline"
          onClick={() => setIsNodeSelectOpen(true)}
          type="button"
        >
          <Import className="h-4 w-4 mr-2" />
          从节点创建出站
        </Button>
      </div>

      {/* Simple Outbound Selection - Only Freedom and Blackhole */}
      <div>
        <h3 className="text-lg font-semibold mb-4">或创建特殊出站</h3>
        <div className="flex flex-wrap gap-2 md:gap-3">
          <Button
            variant={selectedProtocol === 'Freedom' ? 'default' : 'secondary'}
            className={selectedProtocol === 'Freedom' ? '' : PROTOCOL_COLORS['Freedom'] || ''}
            onClick={() => handleProtocolSelect('Freedom')}
            type="button"
          >
            Freedom (直连)
          </Button>
          <Button
            variant={selectedProtocol === 'Blackhole' ? 'default' : 'secondary'}
            className={selectedProtocol === 'Blackhole' ? '' : PROTOCOL_COLORS['Blackhole'] || ''}
            onClick={() => handleProtocolSelect('Blackhole')}
            type="button"
          >
            Blackhole (阻止)
          </Button>
        </div>
      </div>

      {/* Form for simple outbound (Freedom/Blackhole) */}
      {selectedProtocol && isSimpleOutbound && (
        <>
          {/* 左右分栏布局：左侧表单展开，右侧JSON预览固定 */}
          <div className="flex gap-6">
            {/* 左侧表单区域 */}
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Tag Field */}
                <Card>
                  <CardHeader>
                    <CardTitle>基础配置</CardTitle>
                    <CardDescription>{selectedProtocol === 'Freedom' ? '直连出站配置' : '阻止出站配置'}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      field={{
                        name: 'tag',
                        label: '标签',
                        type: 'text',
                        required: true,
                        placeholder: selectedProtocol === 'Freedom' ? 'direct' : 'block',
                        description: '出站的唯一标识符',
                      }}
                      value={formData.tag}
                      onChange={(value) => handleFieldChange('tag', value)}
                    />
                  </CardContent>
                </Card>

                {/* Protocol-specific fields for Freedom */}
                {simpleOutboundFields.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>协议配置</CardTitle>
                      <CardDescription>{selectedProtocol} 协议设置</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {simpleOutboundFields.map((field) => (
                        <FormField
                          key={field.name}
                          field={field}
                          value={formData[field.name]}
                          onChange={(value) => handleFieldChange(field.name, value)}
                        />
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {/* 右侧 JSON 预览 - sticky 定位，随滚动固定在可视区域 */}
            <div className="hidden md:block w-[380px] flex-shrink-0 self-start sticky top-4">
              <Card>
                <CardHeader>
                  <CardTitle>JSON 预览</CardTitle>
                  <CardDescription>实时生成的出站配置</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-4 rounded overflow-auto max-h-[60vh]">
                    {JSON.stringify(
                      generateOutboundConfig(formData, selectedProtocol, selectedTransport, selectedSecurity),
                      null,
                      2,
                    )}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* 移动端 JSON 预览浮动按钮 - 固定垂直居中 */}
          <Button
            variant="outline"
            size="icon"
            className="md:hidden fixed right-4 top-1/2 -translate-y-1/2 z-50 h-12 w-12 rounded-full shadow-lg bg-background border-primary"
            onClick={() => setShowMobileJsonPreview(true)}
          >
            <Eye className="h-5 w-5" />
          </Button>

          {/* 移动端 JSON 预览弹窗 */}
          {showMobileJsonPreview && (
            <div className="md:hidden fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
              <div className="fixed inset-4 bg-background border rounded-lg shadow-lg flex flex-col">
                <div className="flex items-center justify-between p-4 border-b">
                  <div>
                    <h3 className="font-semibold">JSON 预览</h3>
                    <p className="text-sm text-muted-foreground">实时生成的出站配置</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowMobileJsonPreview(false)}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-4 rounded">
                    {JSON.stringify(
                      generateOutboundConfig(formData, selectedProtocol, selectedTransport, selectedSecurity),
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Form for node-imported outbound */}
      {isNodeImported && !isSimpleOutbound && (
        <>
          {/* 左右分栏布局：左侧表单展开，右侧JSON预览固定 */}
          <div className="flex gap-6">
            {/* 左侧表单区域 */}
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Imported Node Info */}
                <Card>
                  <CardHeader>
                    <CardTitle>已导入节点配置</CardTitle>
                    <CardDescription>
                      协议: <span className={PROTOCOL_COLORS[selectedProtocol] || ''}>{selectedProtocol}</span>
                      {selectedTransport !== 'TCP' && ` | 传输: ${selectedTransport}`}
                      {selectedSecurity !== 'None' && ` | 安全: ${getSecurityLabel(selectedSecurity)}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      field={{
                        name: 'tag',
                        label: '标签',
                        type: 'text',
                        required: true,
                        placeholder: 'proxy',
                        description: '出站的唯一标识符',
                      }}
                      value={formData.tag}
                      onChange={(value) => handleFieldChange('tag', value)}
                    />
                    <div className="text-sm text-muted-foreground">
                      服务器: {formData.address}:{formData.port}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* 右侧 JSON 预览 - sticky 定位，随滚动固定在可视区域 */}
            <div className="hidden md:block w-[380px] flex-shrink-0 self-start sticky top-4">
              <Card>
                <CardHeader>
                  <CardTitle>JSON 预览</CardTitle>
                  <CardDescription>实时生成的出站配置</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-4 rounded overflow-auto max-h-[60vh]">
                    {JSON.stringify(
                      generateOutboundConfig(formData, selectedProtocol, selectedTransport, selectedSecurity),
                      null,
                      2,
                    )}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* 移动端 JSON 预览浮动按钮 - 固定垂直居中 */}
          <Button
            variant="outline"
            size="icon"
            className="md:hidden fixed right-4 top-1/2 -translate-y-1/2 z-50 h-12 w-12 rounded-full shadow-lg bg-background border-primary"
            onClick={() => setShowMobileJsonPreview(true)}
          >
            <Eye className="h-5 w-5" />
          </Button>

          {/* 移动端 JSON 预览弹窗 */}
          {showMobileJsonPreview && (
            <div className="md:hidden fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
              <div className="fixed inset-4 bg-background border rounded-lg shadow-lg flex flex-col">
                <div className="flex items-center justify-between p-4 border-b">
                  <div>
                    <h3 className="font-semibold">JSON 预览</h3>
                    <p className="text-sm text-muted-foreground">实时生成的出站配置</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowMobileJsonPreview(false)}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-4 rounded">
                    {JSON.stringify(
                      generateOutboundConfig(formData, selectedProtocol, selectedTransport, selectedSecurity),
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button variant="outline" onClick={onCancel} type="button">
          取消
        </Button>
        {((selectedProtocol && isSimpleOutbound) || (isNodeImported && !isSimpleOutbound)) && (
          <Button onClick={handleFormSubmit} type="button">
            提交配置
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
