// @ts-nocheck
import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Eye,
  Loader2,
  X,
  ShieldCheck,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { generateInboundConfig } from '@/lib/xray-config-generator'
import {
  getAllProtocols,
  getTransportOptions,
  getSecurityOptions,
} from '@/lib/xray-config-structure'
import {
  commonFields,
  transportFields,
  securityFields,
  protocolFields,
  clientFields,
  requiresFlow,
  getFlowField,
} from '@/lib/xray-form-fields'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrayField } from './array-field'
import { FormField } from './form-field'
import { VlessDecryptionField } from './vless-decryption-field'

// Protocol colors matching node management
const PROTOCOL_COLORS: Record<string, string> = {
  VLESS: 'text-purple-700 dark:text-purple-400',
  VMess: 'text-blue-700 dark:text-blue-400',
  Trojan: 'text-red-700 dark:text-red-400',
  Shadowsocks2022: 'text-green-700 dark:text-green-400',
  Socks5: 'text-yellow-700 dark:text-yellow-400',
  Hysteria2: 'text-teal-700 dark:text-teal-400',
  HTTP: 'text-cyan-700 dark:text-cyan-400',
  Tunnel: 'text-orange-700 dark:text-orange-400',
}

// Security protocol display labels
const getSecurityLabel = (security: string): string => {
  if (security === 'None') return '无'
  if (security.includes('MLKEM768'))
    return security.replace('MLKEM768', '后量子加密')
  return security
}

type WizardMode = 'simple' | 'expert'

const pickSimpleTransport = (
  protocol: string,
  transportNames: string[]
): string => {
  if (transportNames.length === 0) return ''

  // 优先选择支持 XTLS-Vision-REALITY 的传输协议
  for (const transport of transportNames) {
    const securities = getSecurityOptions(protocol, transport)
    if (securities.includes('XTLS-Vision-REALITY')) {
      return transport
    }
  }

  for (const transport of transportNames) {
    const securities = getSecurityOptions(protocol, transport)
    if (securities.some((security) => security.includes('REALITY'))) {
      return transport
    }
  }

  for (const transport of transportNames) {
    const securities = getSecurityOptions(protocol, transport)
    if (securities.length === 0 || securities.includes('None')) {
      return transport
    }
  }

  return transportNames[0]
}

const pickSimpleSecurity = (securities: string[]): string => {
  if (securities.length === 0) return ''
  if (securities.includes('XTLS-Vision-REALITY')) return 'XTLS-Vision-REALITY'

  const realitySecurity = securities.find((security) =>
    security.includes('REALITY')
  )
  if (realitySecurity) return realitySecurity

  if (securities.includes('None')) return 'None'
  return securities[0]
}

const generateBase64Key = (byteLength: number): string => {
  const array = new Uint8Array(byteLength)
  crypto.getRandomValues(array)
  let binary = ''
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i])
  }
  return btoa(binary)
}

interface Server {
  id: number
  name: string
  host: string
  port: number
}

interface InboundWizardProps {
  servers: Server[]
  selectedServerIds: number[]
  onCancel: () => void
  onSubmit: (serverIds: number[], inbound: any, tag: string) => Promise<void>
  /** 是否跳过服务器选择（远程模式时为 true） */
  skipServerSelection?: boolean
  /** 已被占用的端口列表 */
  usedPorts?: number[]
}

interface RealityDomainOption {
  domain: string
  target?: string
  success: boolean
  latency_ms?: number
  error?: string
  nginx_ssl_port?: number
}

interface DomainServerInfo {
  server_id: number
  server_name: string
  domain: string
}

type SSLSetupState = 'idle' | 'loading' | 'success' | 'error'

export function InboundWizard({
  servers,
  selectedServerIds,
  onCancel,
  onSubmit,
  skipServerSelection = false,
  usedPorts = [],
}: InboundWizardProps) {
  const [wizardMode, setWizardMode] = useState<WizardMode>('simple')
  const isSimpleMode = wizardMode === 'simple'

  // 是否需要显示服务器选择步骤
  const needsServerSelection =
    !skipServerSelection && selectedServerIds.length === 0 && servers.length > 0

  // 内部维护的已选服务器（当外部没有预选时使用，单选）
  const [internalSelectedServerId, setInternalSelectedServerId] = useState<
    number | null
  >(null)

  // 最终使用的服务器ID（单选）
  const effectiveServerId =
    selectedServerIds.length > 0
      ? selectedServerIds[0]
      : internalSelectedServerId
  const effectiveServerIds = effectiveServerId ? [effectiveServerId] : []

  const { data: fetchedPorts } = useQuery({
    queryKey: ['inbound-ports', effectiveServerId],
    queryFn: async () => {
      if (!effectiveServerId) return []
      const res = await api.get(`/api/admin/remote/inbounds?server_id=${effectiveServerId}`)
      const inbounds = res.data.inbounds || []
      return inbounds.map((item: any) => Number(item.port)).filter(Boolean)
    },
    enabled: !!effectiveServerId && usedPorts.length === 0,
  })
  const resolvedUsedPorts = usedPorts.length > 0 ? usedPorts : (fetchedPorts || [])

  const [selectedProtocol, setSelectedProtocol] = useState<string>('VLESS')
  const [selectedTransport, setSelectedTransport] = useState<string>('TCP')
  const [selectedSecurity, setSelectedSecurity] = useState<string>(
    'XTLS-Vision-REALITY'
  )
  const [formData, setFormData] = useState<any>({
    port: 443,
    listen: '0.0.0.0',
    sniffing: true,
    clients: [],
    accounts: [],
    decryption: 'none',
    encryption: 'none',
  })

  // 移动端 JSON 预览弹窗状态
  const [showMobileJsonPreview, setShowMobileJsonPreview] = useState(false)
  const [realityDomainsLoading, setRealityDomainsLoading] = useState(false)
  const [realityDomainOptions, setRealityDomainOptions] = useState<
    RealityDomainOption[]
  >([])
  const [selectedRealityDomain, setSelectedRealityDomain] = useState<string>('')
  const [showSSLSetupDialog, setShowSSLSetupDialog] = useState(false)
  const [domainServers, setDomainServers] = useState<
    Record<string, DomainServerInfo>
  >({})
  const [sslSetupStatus, setSSLSetupStatus] = useState<
    Record<number, SSLSetupState>
  >({})
  const [manualRealityDomain, setManualRealityDomain] = useState('')
  const [customDomainInput, setCustomDomainInput] = useState('')
  const [customDomainProbing, setCustomDomainProbing] = useState(false)
  const simpleRealityAutoLoaded = useRef(false)

  // 切换服务器选择（单选）
  const toggleServerSelection = (serverId: number) => {
    setInternalSelectedServerId((prev) => (prev === serverId ? null : serverId))
  }

  // Get available protocols
  const protocols = getAllProtocols()

  // Get available transports for selected protocol
  const [transports, setTransports] = useState<string[]>([])
  const [securityOptions, setSecurityOptions] = useState<string[]>([])

  useEffect(() => {
    if (selectedProtocol) {
      const transportOpts = getTransportOptions(selectedProtocol)
      const transportNames: string[] = []

      transportOpts.forEach((item) => {
        if (typeof item === 'string') {
          transportNames.push(item)
        } else {
          transportNames.push(...Object.keys(item))
        }
      })

      setTransports(transportNames)

      if (isSimpleMode) {
        setSelectedTransport(
          pickSimpleTransport(selectedProtocol, transportNames)
        )
      } else if (transportNames.length === 1) {
        // Auto-select if only one transport option
        setSelectedTransport(transportNames[0])
      } else if (!transportNames.includes(selectedTransport)) {
        // Or if current selection is invalid
        setSelectedTransport(transportNames[0] || '')
      }
    }
  }, [isSimpleMode, selectedProtocol])

  useEffect(() => {
    if (selectedProtocol && selectedTransport) {
      const securities = getSecurityOptions(selectedProtocol, selectedTransport)
      setSecurityOptions(securities)

      // Auto-select security
      if (securities.length > 0 && !securities.includes(selectedSecurity)) {
        setSelectedSecurity(
          isSimpleMode ? pickSimpleSecurity(securities) : securities[0]
        )
      } else if (securities.length === 0) {
        setSelectedSecurity('')
      }
    }
  }, [isSimpleMode, selectedProtocol, selectedTransport])

  useEffect(() => {
    if (
      selectedSecurity !== 'REALITY' &&
      selectedSecurity !== 'XTLS-Vision-REALITY'
    ) {
      setRealityDomainOptions([])
      setSelectedRealityDomain('')
      setManualRealityDomain('')
      simpleRealityAutoLoaded.current = false
    }
  }, [selectedSecurity])

  // 简易模式下 REALITY 安全协议自动触发"偷自己"
  useEffect(() => {
    const isRealitySecurity =
      selectedSecurity === 'REALITY' ||
      selectedSecurity === 'XTLS-Vision-REALITY'
    if (
      isSimpleMode &&
      isRealitySecurity &&
      effectiveServerId &&
      !simpleRealityAutoLoaded.current &&
      !realityDomainsLoading &&
      realityDomainOptions.length === 0
    ) {
      simpleRealityAutoLoaded.current = true
      handleLoadRealityDomains()
    }
  }, [isSimpleMode, selectedSecurity, effectiveServerId])

  useEffect(() => {
    const isRealitySecurity =
      selectedSecurity === 'REALITY' ||
      selectedSecurity === 'XTLS-Vision-REALITY'
    if (!isRealitySecurity) return

    setFormData((prev: any) => {
      let changed = false
      const next = { ...prev }

      if (!next.dest) {
        next.dest = 'www.microsoft.com:443'
        changed = true
      }
      if (!next.serverNames) {
        next.serverNames = 'www.microsoft.com'
        changed = true
      }
      if (next.shortIds === undefined) {
        next.shortIds = ''
        changed = true
      }

      return changed ? next : prev
    })

    if (formData.privateKey && formData.publicKey) return

    let cancelled = false
    const autoGenerateRealityKeyPair = async () => {
      try {
        const response = await api.post('/api/admin/xray/generate-x25519')
        if (cancelled) return

        setFormData((prev: any) => {
          if (prev.privateKey && prev.publicKey) return prev
          return {
            ...prev,
            privateKey: prev.privateKey || response.data.privateKey,
            publicKey: prev.publicKey || response.data.publicKey,
          }
        })
      } catch {
        if (!cancelled) {
          toast.error('自动生成 REALITY 公私钥失败，请点击生成按钮手动生成')
        }
      }
    }

    autoGenerateRealityKeyPair()
    return () => {
      cancelled = true
    }
  }, [selectedSecurity, formData.privateKey, formData.publicKey])

  useEffect(() => {
    // 简易模式下，Socks5/HTTP 默认使用密码认证，便于直接选择用户
    if (!isSimpleMode) return
    if (selectedProtocol !== 'Socks5' && selectedProtocol !== 'HTTP') return

    setFormData((prev: any) => ({
      ...prev,
      auth: prev.auth === 'noauth' ? 'password' : prev.auth || 'password',
    }))
  }, [isSimpleMode, selectedProtocol])

  // SS2022 进入协议或切换加密方法时自动生成服务器密码和用户密码
  const prevSS2022MethodRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (selectedProtocol !== 'Shadowsocks2022') {
      prevSS2022MethodRef.current = undefined
      return
    }
    const method = formData.method || '2022-blake3-aes-128-gcm'
    if (prevSS2022MethodRef.current === method) return
    prevSS2022MethodRef.current = method

    const byteLength = method.includes('128') ? 16 : 32
    setFormData((prev: any) => ({
      ...prev,
      method,
      serverPassword: generateBase64Key(byteLength),
      clients: (prev.clients || []).map((client: any) => ({
        ...client,
        password: generateBase64Key(byteLength),
      })),
    }))
  }, [selectedProtocol, formData.method])

  // 自动更新tag默认值
  const buildDefaultTag = (port: number | string | undefined) => {
    const parts = [selectedProtocol.toLowerCase()]

    // Shadowsocks2022 直接使用 协议-端口 格式（没有传输协议和安全协议）
    if (selectedProtocol !== 'Shadowsocks2022') {
      // 只在传输协议不是None时添加
      if (selectedTransport && selectedTransport !== 'None') {
        parts.push(selectedTransport.toLowerCase())
      }

      // 只在安全协议存在且不是None时添加
      if (selectedSecurity && selectedSecurity !== 'None') {
        parts.push(selectedSecurity.toLowerCase())
      }
    }

    // 最后添加端口
    parts.push(String(port || 443))

    return parts.join('-')
  }

  useEffect(() => {
    const defaultTag = buildDefaultTag(formData.port)

    // 只在用户还没有手动修改tag时更新
    setFormData((prev: any) => ({
      ...prev,
      tag: defaultTag,
    }))
  }, [selectedProtocol, selectedTransport, selectedSecurity, formData.port])

  const handleProtocolSelect = (protocol: string) => {
    setSelectedProtocol(protocol)
  }

  const handleTransportSelect = (transport: string) => {
    setSelectedTransport(transport)
  }

  const handleSecuritySelect = (security: string) => {
    setSelectedSecurity(security)
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

  const getLocalDest = (domain: string, domainOpts?: RealityDomainOption[]) => {
    const opts = domainOpts || realityDomainOptions
    const opt = opts.find((o) => o.domain === domain)
    const port = opt?.nginx_ssl_port || 58443
    return `127.0.0.1:${port}`
  }

  const applyRealityDomain = (
    domain: string,
    serverMap?: Record<string, DomainServerInfo>,
    domainOpts?: RealityDomainOption[]
  ) => {
    const servers = serverMap || domainServers
    const isLocal = servers[domain]?.server_id === effectiveServerId
    handleFieldChange(
      'dest',
      isLocal ? getLocalDest(domain, domainOpts) : `${domain}:443`
    )
    handleFieldChange('serverNames', domain)
    handleFieldChange('xver', isLocal ? 1 : 0)
  }

  const handleSelectRealityDomain = (domain: string) => {
    setSelectedRealityDomain(domain)
    setManualRealityDomain('')
    applyRealityDomain(domain)
  }

  const handleManualRealityDomain = (domain: string) => {
    setManualRealityDomain(domain)
    setSelectedRealityDomain('')
    if (domain) {
      applyRealityDomain(domain)
    }
  }

  const handleAddCustomDomain = async () => {
    const domain = customDomainInput.trim()
    if (!domain || !effectiveServerId) return
    setCustomDomainProbing(true)
    try {
      const res = await api.post('/api/admin/remote/reality-domains/custom', {
        domain,
        server_id: effectiveServerId,
      })
      const data = res.data
      const newOpt: RealityDomainOption = {
        domain: data.domain || domain,
        target: data.target || `${domain}:443`,
        success: data.success !== false && !data.error,
        latency_ms: data.latency_ms,
        error: data.error,
        nginx_ssl_port: data.nginx_ssl_port,
      }
      setRealityDomainOptions((prev) => {
        const filtered = prev.filter((d) => d.domain !== newOpt.domain)
        const updated = [...filtered, newOpt].sort(
          (a, b) => (a.latency_ms ?? 9999) - (b.latency_ms ?? 9999)
        )
        return updated
      })
      setCustomDomainInput('')
      if (newOpt.success) {
        toast.success(`${newOpt.domain} 延迟 ${newOpt.latency_ms ?? '-'}ms`)
        handleSelectRealityDomain(newOpt.domain)
      } else {
        toast.error(`${newOpt.domain} 探测失败: ${newOpt.error || '未知错误'}`)
      }
    } catch {
      toast.error('探测请求失败')
    } finally {
      setCustomDomainProbing(false)
    }
  }

  const handleLoadRealityDomains = async () => {
    if (!effectiveServerId) {
      toast.error('请先选择服务器')
      return
    }

    setRealityDomainsLoading(true)
    try {
      const response = await api.get(
        `/api/admin/remote/reality-domains?server_id=${effectiveServerId}`
      )
      const domains = Array.isArray(response.data?.domains)
        ? response.data.domains
        : []
      const serverMap = response.data?.domain_servers || {}
      setRealityDomainOptions(domains)
      setDomainServers(serverMap)

      if (domains.length === 0) {
        toast.error(response.data?.message || '未找到可用域名')
        return
      }

      const successCount = domains.filter(
        (item: RealityDomainOption) => item.success
      ).length

      if (successCount === 0) {
        // Check if any failed domains have server info (can setup SSL)
        const failedWithServer = domains.filter(
          (d: RealityDomainOption) => !d.success && serverMap[d.domain]
        )
        if (failedWithServer.length > 0) {
          setSSLSetupStatus({})
          setShowSSLSetupDialog(true)
        } else {
          const errors = [
            ...new Set(
              domains.map((d: RealityDomainOption) => d.error).filter(Boolean)
            ),
          ]
          const warning = response.data?.warning
          toast.error(
            warning ||
              `所有 ${domains.length} 个域名探测失败: ${errors.join('; ')}`
          )
        }
        return
      }

      const firstAvailable =
        domains
          .filter(
            (item: RealityDomainOption) =>
              item.success && item.latency_ms != null
          )
          .sort(
            (a: RealityDomainOption, b: RealityDomainOption) =>
              (a.latency_ms ?? Infinity) - (b.latency_ms ?? Infinity)
          )[0] || domains.find((item: RealityDomainOption) => item.success)
      if (firstAvailable?.domain) {
        setSelectedRealityDomain(firstAvailable.domain)
        setManualRealityDomain('')
        applyRealityDomain(firstAvailable.domain, serverMap, domains)
      }

      toast.success(`已获取 ${domains.length} 个域名，${successCount} 个可用`)
    } catch (error: any) {
      toast.error(error?.response?.data?.error || '读取域名延迟失败')
    } finally {
      setRealityDomainsLoading(false)
    }
  }

  const handleSetupSSL = async (serverId: number) => {
    setSSLSetupStatus((prev) => ({ ...prev, [serverId]: 'loading' }))
    try {
      await api.post(`/api/admin/remote/setup-ssl?server_id=${serverId}`)
      setSSLSetupStatus((prev) => ({ ...prev, [serverId]: 'success' }))
    } catch {
      setSSLSetupStatus((prev) => ({ ...prev, [serverId]: 'error' }))
    }
  }

  const handleSetupAllSSL = async () => {
    const failedDomains = realityDomainOptions.filter(
      (d) => !d.success && domainServers[d.domain]
    )
    const serverIds = [
      ...new Set(failedDomains.map((d) => domainServers[d.domain].server_id)),
    ]
    for (const sid of serverIds) {
      await handleSetupSSL(sid)
    }
  }

  const handleSSLSetupDone = () => {
    setShowSSLSetupDialog(false)
    // Re-probe after SSL setup
    handleLoadRealityDomains()
  }

  // Check if all SSL setups are finished (success or error)
  const allSSLSetupDone = (() => {
    const failedDomains = realityDomainOptions.filter(
      (d) => !d.success && domainServers[d.domain]
    )
    const serverIds = [
      ...new Set(failedDomains.map((d) => domainServers[d.domain].server_id)),
    ]
    return (
      serverIds.length > 0 &&
      serverIds.every(
        (sid) =>
          sslSetupStatus[sid] === 'success' || sslSetupStatus[sid] === 'error'
      )
    )
  })()

  const anySSLSetupLoading = Object.values(sslSetupStatus).some(
    (s) => s === 'loading'
  )

  const handleFormSubmit = async () => {
    let submitData = { ...formData }

    const port = Number(submitData.port)
    if (port && resolvedUsedPorts.includes(port)) {
      toast.error(`端口 ${port} 已被其他入站占用，请更换端口`)
      return
    }

    if (isSimpleMode) {
      const requiresCertFiles =
        selectedSecurity.includes('TLS') &&
        !selectedSecurity.includes('REALITY')
      if (requiresCertFiles) {
        toast.error('该安全协议需要证书文件，请切换到专家模式配置')
        return
      }

      // 通用默认值
      if (!submitData.port) submitData.port = 443
      if (resolvedUsedPorts.includes(Number(submitData.port))) {
        let nextPort = Number(submitData.port) + 1
        while (resolvedUsedPorts.includes(nextPort) && nextPort <= 65535) nextPort++
        submitData.port = nextPort
      }
      if (!submitData.listen) submitData.listen = '0.0.0.0'
      if (submitData.sniffing === undefined) submitData.sniffing = true

      // 协议默认值
      if (selectedProtocol === 'Shadowsocks2022') {
        if (!submitData.method) submitData.method = '2022-blake3-aes-128-gcm'
        if (!submitData.network) submitData.network = 'tcp,udp'
        if (!submitData.serverPassword) {
          const byteLength = submitData.method.includes('128') ? 16 : 32
          submitData.serverPassword = generateBase64Key(byteLength)
        }
      }

      if (
        (selectedProtocol === 'Socks5' || selectedProtocol === 'HTTP') &&
        !submitData.auth
      ) {
        submitData.auth = 'password'
      }

      if (selectedProtocol === 'Dokodemo') {
        if (!submitData.address) submitData.address = '127.0.0.1'
        if (!submitData.forwardPort) submitData.forwardPort = 443
        if (!submitData.network) submitData.network = 'tcp'
      }

      // 传输默认值
      if (
        (selectedTransport === 'HTTP' || selectedTransport === 'HTTP2') &&
        !submitData.path
      ) {
        submitData.path = '/'
      }
      if (selectedTransport === 'Websocket' && !submitData.path)
        submitData.path = '/ws'
      if (selectedTransport === 'WSS' && !submitData.path)
        submitData.path = '/wss'
      if (selectedTransport === 'XHTTP' && !submitData.path)
        submitData.path = '/xhttp'
      if (selectedTransport === 'XHTTP' && !submitData.mode)
        submitData.mode = 'auto'
      if (selectedTransport === 'GRPC' && !submitData.serviceName)
        submitData.serviceName = 'grpc'

      // REALITY 自动填充
      if (selectedSecurity.includes('REALITY')) {
        if (!submitData.dest) submitData.dest = 'www.microsoft.com:443'
        if (!submitData.serverNames)
          submitData.serverNames = 'www.microsoft.com'
        if (submitData.shortIds === undefined) submitData.shortIds = ''

        if (!submitData.privateKey) {
          try {
            const response = await api.post('/api/admin/xray/generate-x25519')
            submitData.privateKey = response.data.privateKey
            submitData.publicKey = response.data.publicKey
          } catch {
            toast.error('自动生成 REALITY 私钥失败，请切换到专家模式手动填写')
            return
          }
        }
      }
    }

    const accountBasedProtocol =
      selectedProtocol === 'Socks5' || selectedProtocol === 'HTTP'
    const selectedUsers = accountBasedProtocol
      ? submitData.accounts || []
      : submitData.clients || []
    if (shouldShowUserManagement && selectedUsers.length === 0) {
      toast.error('请至少选择一个用户')
      return
    }

    const inbound = generateInboundConfig(
      submitData,
      selectedProtocol,
      selectedTransport,
      selectedSecurity
    )

    // 生成默认tag（如果用户没有填写）
    let tag = submitData.tag
    if (!tag) {
      tag = buildDefaultTag(submitData.port)
    }

    await onSubmit(effectiveServerIds, inbound, tag)
  }

  // Get current field sets based on selections
  const currentTransportFields = transportFields[selectedTransport] || []
  const currentSecurityFields = securityFields[selectedSecurity] || []
  const currentProtocolFields = protocolFields[selectedProtocol] || []
  const currentClientFields = clientFields[selectedProtocol] || []

  // Add flow field for XTLS protocols
  const needsFlow = requiresFlow(selectedProtocol, selectedSecurity)
  const clientFieldsWithFlow = needsFlow
    ? [...currentClientFields, getFlowField()]
    : currentClientFields

  // Determine if user management should be shown
  // For HTTP/Socks5, only show when password auth is selected
  const effectiveAuth =
    (selectedProtocol === 'HTTP' || selectedProtocol === 'Socks5') &&
    isSimpleMode
      ? formData.auth || 'password'
      : formData.auth

  const shouldShowUserManagement =
    currentClientFields.length > 0 &&
    !(
      (selectedProtocol === 'HTTP' || selectedProtocol === 'Socks5') &&
      effectiveAuth === 'noauth'
    )

  return (
    <div className='space-y-6 md:space-y-8'>
      {/* Server Selection - Show when no server is pre-selected and there are multiple servers */}
      {needsServerSelection && (
        <div>
          <h3 className='mb-4 text-lg font-semibold'>选择目标服务器</h3>
          <p className='text-muted-foreground mb-4 text-sm'>
            请选择要添加入站的服务器（单选）
          </p>
          <div className='flex flex-wrap gap-2 md:gap-3'>
            {servers.map((server) => (
              <Button
                key={server.id}
                variant={
                  internalSelectedServerId === server.id ? 'default' : 'outline'
                }
                onClick={() => toggleServerSelection(server.id)}
                type='button'
              >
                {server.name}
              </Button>
            ))}
          </div>
          {internalSelectedServerId === null && (
            <p className='mt-3 text-sm text-amber-600 dark:text-amber-400'>
              请选择一台服务器
            </p>
          )}
        </div>
      )}

      {/* Protocol Selection - Always visible */}
      <div>
        <h3 className='mb-4 text-lg font-semibold'>选择协议</h3>
        <div className='flex flex-wrap gap-2 md:gap-3'>
          {protocols.map((protocol) => (
            <Button
              key={protocol}
              variant={selectedProtocol === protocol ? 'default' : 'secondary'}
              className={
                selectedProtocol === protocol
                  ? ''
                  : PROTOCOL_COLORS[protocol] || ''
              }
              onClick={() => handleProtocolSelect(protocol)}
              type='button'
            >
              {protocol === 'Dokodemo'
                ? 'Tunnel (任意门)'
                : protocol.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      {/* Transport Selection - Show only when protocol has multiple transport options */}
      {selectedProtocol && transports.length > 1 && (
        <div>
          <h3 className='mb-4 text-lg font-semibold'>传输协议</h3>
          <div className='flex flex-wrap gap-2 md:gap-3'>
            {transports.map((transport) => (
              <Button
                key={transport}
                variant={
                  selectedTransport === transport ? 'default' : 'outline'
                }
                onClick={() => handleTransportSelect(transport)}
                type='button'
              >
                {transport.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Security Selection - Show when transport is selected and has security options */}
      {selectedProtocol && selectedTransport && securityOptions.length > 0 && (
        <div>
          <h3 className='mb-4 text-lg font-semibold'>安全协议</h3>
          <div className='flex flex-wrap gap-2 md:gap-3'>
            {securityOptions.map((security) => (
              <Button
                key={security}
                variant={selectedSecurity === security ? 'default' : 'outline'}
                onClick={() => handleSecuritySelect(security)}
                type='button'
                className='h-auto min-h-[2.5rem] py-2 whitespace-normal'
              >
                {getSecurityLabel(security)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Mode Selection - under security section */}
      {selectedProtocol &&
        selectedTransport &&
        (securityOptions.length === 0 || selectedSecurity) && (
          <div>
            <h3 className='mb-4 text-lg font-semibold'>配置模式</h3>
            <ButtonGroup mode='adaptive-full' className='w-full' gap='md'>
              <Button
                type='button'
                variant={isSimpleMode ? 'default' : 'outline'}
                className='w-full min-w-0'
                onClick={() => setWizardMode('simple')}
              >
                简易模式
              </Button>
              <Button
                type='button'
                variant={isSimpleMode ? 'outline' : 'default'}
                className='w-full min-w-0'
                onClick={() => setWizardMode('expert')}
              >
                专家模式
              </Button>
            </ButtonGroup>
          </div>
        )}

      {/* Form - Show when ready */}
      {selectedProtocol &&
        selectedTransport &&
        (securityOptions.length === 0 || selectedSecurity) && (
          <>
            {isSimpleMode ? (
              (() => {
                const isRealitySecurity =
                  selectedSecurity === 'REALITY' ||
                  selectedSecurity === 'XTLS-Vision-REALITY'
                const hasAvailableDomains = realityDomainOptions.some(
                  (d) => d.success
                )
                return (
                  <>
                    {/* 简易模式也使用左右分栏：左侧表单，右侧JSON预览 */}
                    <div className='flex gap-6'>
                      <div className='min-w-0 flex-1 space-y-6'>
                        {/* REALITY 域名选择 */}
                        {isRealitySecurity && (
                          <Card>
                            <CardHeader>
                              <CardTitle>REALITY 域名</CardTitle>
                              <CardDescription>
                                {realityDomainsLoading
                                  ? '正在探测域名延迟...'
                                  : hasAvailableDomains
                                    ? '已自动选择延迟最低的域名'
                                    : realityDomainOptions.length > 0
                                      ? '所有域名探测失败，请手动输入'
                                      : effectiveServerId
                                        ? '正在获取可用域名...'
                                        : '请先选择服务器'}
                              </CardDescription>
                            </CardHeader>
                            <CardContent className='space-y-3'>
                              {realityDomainsLoading && (
                                <div className='text-muted-foreground flex items-center gap-2 text-sm'>
                                  <Loader2 className='h-4 w-4 animate-spin' />
                                  探测中...
                                </div>
                              )}

                              {/* 有可用域名时显示下拉选择 */}
                              {hasAvailableDomains && (
                                <div className='space-y-2'>
                                  <Select
                                    value={selectedRealityDomain}
                                    onValueChange={handleSelectRealityDomain}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder='选择域名（已按延迟排序）' />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {realityDomainOptions.map((item) => (
                                        <SelectItem
                                          key={item.domain}
                                          value={item.domain}
                                          disabled={!item.success}
                                        >
                                          {item.success
                                            ? `${item.domain} (${item.latency_ms ?? '-'}ms)`
                                            : `${item.domain} (探测失败)`}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Button
                                    type='button'
                                    variant='ghost'
                                    size='sm'
                                    onClick={handleLoadRealityDomains}
                                    disabled={realityDomainsLoading}
                                  >
                                    {realityDomainsLoading && (
                                      <Loader2 className='mr-2 h-3 w-3 animate-spin' />
                                    )}
                                    重新探测
                                  </Button>
                                </div>
                              )}

                              {/* 没有可用域名时显示手动输入 */}
                              {!realityDomainsLoading &&
                                !hasAvailableDomains && (
                                  <div className='space-y-2'>
                                    <Label>目标域名</Label>
                                    <Input
                                      placeholder='例如: www.microsoft.com'
                                      value={manualRealityDomain}
                                      onChange={(e) =>
                                        handleManualRealityDomain(
                                          e.target.value
                                        )
                                      }
                                    />
                                    {effectiveServerId && (
                                      <Button
                                        type='button'
                                        variant='outline'
                                        size='sm'
                                        onClick={() => {
                                          simpleRealityAutoLoaded.current = false
                                          handleLoadRealityDomains()
                                        }}
                                        disabled={realityDomainsLoading}
                                      >
                                        {realityDomainsLoading && (
                                          <Loader2 className='mr-2 h-3 w-3 animate-spin' />
                                        )}
                                        重新探测域名
                                      </Button>
                                    )}
                                  </div>
                                )}

                              <div className='space-y-2'>
                                <Label>自定义域名</Label>
                                <div className='flex gap-2'>
                                  <Input
                                    placeholder='输入域名，如 www.microsoft.com'
                                    value={customDomainInput}
                                    onChange={(e) =>
                                      setCustomDomainInput(e.target.value)
                                    }
                                    onKeyDown={(e) =>
                                      e.key === 'Enter' &&
                                      handleAddCustomDomain()
                                    }
                                  />
                                  <Button
                                    type='button'
                                    variant='outline'
                                    size='sm'
                                    onClick={handleAddCustomDomain}
                                    disabled={
                                      !customDomainInput.trim() ||
                                      customDomainProbing ||
                                      !effectiveServerId
                                    }
                                  >
                                    {customDomainProbing ? (
                                      <Loader2 className='h-4 w-4 animate-spin' />
                                    ) : (
                                      '探测'
                                    )}
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {shouldShowUserManagement ? (
                          <Card>
                            <CardHeader>
                              <CardTitle>用户管理</CardTitle>
                              <CardDescription>
                                {selectedProtocol === 'Socks5' ||
                                selectedProtocol === 'HTTP'
                                  ? '账户配置'
                                  : '客户端配置'}
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <ArrayField
                                label={
                                  selectedProtocol === 'Socks5' ||
                                  selectedProtocol === 'HTTP'
                                    ? '账户'
                                    : '用户'
                                }
                                fields={clientFieldsWithFlow}
                                values={
                                  selectedProtocol === 'Socks5' ||
                                  selectedProtocol === 'HTTP'
                                    ? formData.accounts || []
                                    : formData.clients || []
                                }
                                onChange={(values) =>
                                  handleFieldChange(
                                    selectedProtocol === 'Socks5' ||
                                      selectedProtocol === 'HTTP'
                                      ? 'accounts'
                                      : 'clients',
                                    values
                                  )
                                }
                                addButtonText={
                                  selectedProtocol === 'Socks5' ||
                                  selectedProtocol === 'HTTP'
                                    ? '添加账户'
                                    : '添加用户'
                                }
                                showUserSelect={
                                  selectedProtocol === 'VLESS' ||
                                  selectedProtocol === 'VMess' ||
                                  selectedProtocol === 'Trojan' ||
                                  selectedProtocol === 'Shadowsocks2022' ||
                                  selectedProtocol === 'Socks5' ||
                                  selectedProtocol === 'HTTP'
                                }
                                required
                                ss2022Method={
                                  selectedProtocol === 'Shadowsocks2022'
                                    ? formData.method
                                    : undefined
                                }
                              />
                            </CardContent>
                          </Card>
                        ) : (
                          <Card>
                            <CardHeader>
                              <CardTitle>简易模式</CardTitle>
                              <CardDescription>
                                当前协议无需用户配置，使用默认参数即可提交
                              </CardDescription>
                            </CardHeader>
                          </Card>
                        )}
                      </div>

                      {/* 右侧 JSON 预览 */}
                      <div className='sticky top-4 hidden w-[380px] flex-shrink-0 self-start md:block'>
                        <Card>
                          <CardHeader>
                            <CardTitle>JSON 预览</CardTitle>
                            <CardDescription>
                              实时生成的入站配置
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <pre className='max-h-[60vh] overflow-auto rounded bg-gray-50 p-4 text-xs dark:bg-gray-900'>
                              {JSON.stringify(
                                generateInboundConfig(
                                  formData,
                                  selectedProtocol,
                                  selectedTransport,
                                  selectedSecurity
                                ),
                                null,
                                2
                              )}
                            </pre>
                          </CardContent>
                        </Card>
                      </div>
                    </div>

                    {/* 移动端 JSON 预览浮动按钮 */}
                    <Button
                      variant='outline'
                      size='icon'
                      className='bg-background border-primary fixed top-1/2 right-4 z-50 h-12 w-12 -translate-y-1/2 rounded-full shadow-lg md:hidden'
                      onClick={() => setShowMobileJsonPreview(true)}
                    >
                      <Eye className='h-5 w-5' />
                    </Button>

                    {/* 移动端 JSON 预览弹窗 */}
                    {showMobileJsonPreview && (
                      <div className='bg-background/80 fixed inset-0 z-50 backdrop-blur-sm md:hidden'>
                        <div className='bg-background fixed inset-4 flex flex-col rounded-lg border shadow-lg'>
                          <div className='flex items-center justify-between border-b p-4'>
                            <div>
                              <h3 className='font-semibold'>JSON 预览</h3>
                              <p className='text-muted-foreground text-sm'>
                                实时生成的入站配置
                              </p>
                            </div>
                            <Button
                              variant='ghost'
                              size='icon'
                              onClick={() => setShowMobileJsonPreview(false)}
                            >
                              <X className='h-5 w-5' />
                            </Button>
                          </div>
                          <div className='flex-1 overflow-auto p-4'>
                            <pre className='rounded bg-gray-50 p-4 text-xs dark:bg-gray-900'>
                              {JSON.stringify(
                                generateInboundConfig(
                                  formData,
                                  selectedProtocol,
                                  selectedTransport,
                                  selectedSecurity
                                ),
                                null,
                                2
                              )}
                            </pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()
            ) : (
              <>
                {/* 左右分栏布局：左侧表单展开，右侧JSON预览固定 */}
                <div className='flex gap-6'>
                  {/* 左侧表单区域 */}
                  <div className='min-w-0 flex-1'>
                    <div className='grid grid-cols-1 gap-6 xl:grid-cols-2'>
                      {/* Common Fields */}
                      <Card>
                        <CardHeader>
                          <CardTitle>通用配置</CardTitle>
                          <CardDescription>
                            适用于所有入站的基础配置
                          </CardDescription>
                        </CardHeader>
                        <CardContent className='space-y-4'>
                          {commonFields.map((field) => (
                            <FormField
                              key={field.name}
                              field={field}
                              value={formData[field.name]}
                              onChange={(value) =>
                                handleFieldChange(field.name, value)
                              }
                            />
                          ))}
                        </CardContent>
                      </Card>

                      {/* Client/User Management */}
                      {shouldShowUserManagement && (
                        <Card>
                          <CardHeader>
                            <CardTitle>用户管理</CardTitle>
                            <CardDescription>
                              {selectedProtocol === 'Socks5' ||
                              selectedProtocol === 'HTTP'
                                ? '账户配置'
                                : '客户端配置'}
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <ArrayField
                              label={
                                selectedProtocol === 'Socks5' ||
                                selectedProtocol === 'HTTP'
                                  ? '账户'
                                  : '用户'
                              }
                              fields={clientFieldsWithFlow}
                              values={
                                selectedProtocol === 'Socks5' ||
                                selectedProtocol === 'HTTP'
                                  ? formData.accounts || []
                                  : formData.clients || []
                              }
                              onChange={(values) =>
                                handleFieldChange(
                                  selectedProtocol === 'Socks5' ||
                                    selectedProtocol === 'HTTP'
                                    ? 'accounts'
                                    : 'clients',
                                  values
                                )
                              }
                              addButtonText={
                                selectedProtocol === 'Socks5' ||
                                selectedProtocol === 'HTTP'
                                  ? '添加账户'
                                  : '添加用户'
                              }
                              showUserSelect={
                                selectedProtocol === 'VLESS' ||
                                selectedProtocol === 'VMess' ||
                                selectedProtocol === 'Trojan' ||
                                selectedProtocol === 'Shadowsocks2022' ||
                                selectedProtocol === 'Socks5' ||
                                selectedProtocol === 'HTTP'
                              }
                              required
                              ss2022Method={
                                selectedProtocol === 'Shadowsocks2022'
                                  ? formData.method
                                  : undefined
                              }
                            />
                          </CardContent>
                        </Card>
                      )}

                      {/* Security Fields */}
                      {currentSecurityFields.length > 0 && (
                        <Card>
                          <CardHeader>
                            <CardTitle>安全协议配置</CardTitle>
                            <CardDescription>
                              {selectedSecurity} 安全设置
                            </CardDescription>
                          </CardHeader>
                          <CardContent className='space-y-4'>
                            {(selectedSecurity === 'REALITY' ||
                              selectedSecurity === 'XTLS-Vision-REALITY') && (
                              <div className='space-y-3 rounded-lg border p-3'>
                                <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
                                  <Button
                                    type='button'
                                    variant='outline'
                                    onClick={handleLoadRealityDomains}
                                    disabled={
                                      realityDomainsLoading ||
                                      !effectiveServerId
                                    }
                                  >
                                    {realityDomainsLoading && (
                                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                                    )}
                                    我要偷自己
                                  </Button>
                                  <p className='text-muted-foreground text-xs'>
                                    读取所有服务器配置域名，并由当前服务器探测延迟
                                  </p>
                                </div>

                                {realityDomainOptions.length > 0 && (
                                  <Select
                                    value={selectedRealityDomain}
                                    onValueChange={handleSelectRealityDomain}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder='选择低延迟域名（已按延迟排序）' />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {realityDomainOptions.map((item) => (
                                        <SelectItem
                                          key={item.domain}
                                          value={item.domain}
                                          disabled={!item.success}
                                        >
                                          {item.success
                                            ? `${item.domain} (${item.latency_ms ?? '-'}ms)`
                                            : `${item.domain} (探测失败)`}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}

                                <div className='space-y-1'>
                                  <Label className='text-xs'>自定义域名</Label>
                                  <div className='flex gap-2'>
                                    <Input
                                      placeholder='输入域名，如 www.microsoft.com'
                                      value={customDomainInput}
                                      onChange={(e) =>
                                        setCustomDomainInput(e.target.value)
                                      }
                                      onKeyDown={(e) =>
                                        e.key === 'Enter' &&
                                        handleAddCustomDomain()
                                      }
                                    />
                                    <Button
                                      type='button'
                                      variant='outline'
                                      size='sm'
                                      onClick={handleAddCustomDomain}
                                      disabled={
                                        !customDomainInput.trim() ||
                                        customDomainProbing ||
                                        !effectiveServerId
                                      }
                                    >
                                      {customDomainProbing ? (
                                        <Loader2 className='h-4 w-4 animate-spin' />
                                      ) : (
                                        '探测'
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}

                            {currentSecurityFields.map((field) => (
                              <FormField
                                key={field.name}
                                field={field}
                                value={formData[field.name]}
                                onChange={(value) =>
                                  handleFieldChange(field.name, value)
                                }
                                onPublicKeyGenerated={
                                  field.name === 'privateKey'
                                    ? (publicKey) =>
                                        handleFieldChange(
                                          'publicKey',
                                          publicKey
                                        )
                                    : undefined
                                }
                              />
                            ))}
                          </CardContent>
                        </Card>
                      )}

                      {/* Protocol-Specific Fields */}
                      {(currentProtocolFields.length > 0 ||
                        selectedProtocol === 'VLESS') && (
                        <Card>
                          <CardHeader>
                            <CardTitle>协议特定配置</CardTitle>
                            <CardDescription>
                              {selectedProtocol} 协议设置
                            </CardDescription>
                          </CardHeader>
                          <CardContent className='space-y-4'>
                            {selectedProtocol === 'VLESS' ? (
                              <>
                                <VlessDecryptionField
                                  value={formData.decryption}
                                  onChange={(value) =>
                                    handleFieldChange('decryption', value)
                                  }
                                  onEncryptionGenerated={(encryption) =>
                                    handleFieldChange('encryption', encryption)
                                  }
                                />
                                {currentProtocolFields
                                  .filter(
                                    (field) =>
                                      field.name !== 'decryption' &&
                                      field.name !== 'encryption'
                                  )
                                  .map((field) => (
                                    <FormField
                                      key={field.name}
                                      field={field}
                                      value={formData[field.name]}
                                      onChange={(value) =>
                                        handleFieldChange(field.name, value)
                                      }
                                    />
                                  ))}
                              </>
                            ) : (
                              currentProtocolFields.map((field) => (
                                <FormField
                                  key={field.name}
                                  field={field}
                                  value={formData[field.name]}
                                  onChange={(value) =>
                                    handleFieldChange(field.name, value)
                                  }
                                  ss2022Method={
                                    selectedProtocol === 'Shadowsocks2022'
                                      ? formData.method
                                      : undefined
                                  }
                                />
                              ))
                            )}
                          </CardContent>
                        </Card>
                      )}

                      {/* Transport Fields */}
                      {currentTransportFields.length > 0 && (
                        <Card>
                          <CardHeader>
                            <CardTitle>传输协议配置</CardTitle>
                            <CardDescription>
                              {selectedTransport} 传输协议设置
                            </CardDescription>
                          </CardHeader>
                          <CardContent className='space-y-4'>
                            {currentTransportFields.map((field) => (
                              <FormField
                                key={field.name}
                                field={field}
                                value={formData[field.name]}
                                onChange={(value) =>
                                  handleFieldChange(field.name, value)
                                }
                              />
                            ))}
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>

                  {/* 右侧 JSON 预览 - sticky 定位，随滚动固定在可视区域 */}
                  <div className='sticky top-4 hidden w-[380px] flex-shrink-0 self-start md:block'>
                    <Card>
                      <CardHeader>
                        <CardTitle>JSON 预览</CardTitle>
                        <CardDescription>实时生成的入站配置</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <pre className='max-h-[60vh] overflow-auto rounded bg-gray-50 p-4 text-xs dark:bg-gray-900'>
                          {JSON.stringify(
                            generateInboundConfig(
                              formData,
                              selectedProtocol,
                              selectedTransport,
                              selectedSecurity
                            ),
                            null,
                            2
                          )}
                        </pre>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                {/* 移动端 JSON 预览浮动按钮 - 固定垂直居中 */}
                <Button
                  variant='outline'
                  size='icon'
                  className='bg-background border-primary fixed top-1/2 right-4 z-50 h-12 w-12 -translate-y-1/2 rounded-full shadow-lg md:hidden'
                  onClick={() => setShowMobileJsonPreview(true)}
                >
                  <Eye className='h-5 w-5' />
                </Button>

                {/* 移动端 JSON 预览弹窗 */}
                {showMobileJsonPreview && (
                  <div className='bg-background/80 fixed inset-0 z-50 backdrop-blur-sm md:hidden'>
                    <div className='bg-background fixed inset-4 flex flex-col rounded-lg border shadow-lg'>
                      <div className='flex items-center justify-between border-b p-4'>
                        <div>
                          <h3 className='font-semibold'>JSON 预览</h3>
                          <p className='text-muted-foreground text-sm'>
                            实时生成的入站配置
                          </p>
                        </div>
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() => setShowMobileJsonPreview(false)}
                        >
                          <X className='h-5 w-5' />
                        </Button>
                      </div>
                      <div className='flex-1 overflow-auto p-4'>
                        <pre className='rounded bg-gray-50 p-4 text-xs dark:bg-gray-900'>
                          {JSON.stringify(
                            generateInboundConfig(
                              formData,
                              selectedProtocol,
                              selectedTransport,
                              selectedSecurity
                            ),
                            null,
                            2
                          )}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

      {/* Action Buttons */}
      <div className='flex justify-end gap-3 border-t pt-4'>
        <Button variant='outline' onClick={onCancel} type='button'>
          取消
        </Button>
        {selectedProtocol &&
          selectedTransport &&
          (securityOptions.length === 0 || selectedSecurity) && (
            <Button
              onClick={handleFormSubmit}
              type='button'
              disabled={
                needsServerSelection && internalSelectedServerId === null
              }
            >
              提交配置
            </Button>
          )}
      </div>

      {/* SSL Setup Dialog */}
      <Dialog open={showSSLSetupDialog} onOpenChange={setShowSSLSetupDialog}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>SSL 配置</DialogTitle>
            <DialogDescription>
              以下服务器 443 端口不可用，需要配置 SSL 证书与 Nginx 443 端口
            </DialogDescription>
          </DialogHeader>
          <div className='max-h-[40vh] space-y-3 overflow-auto'>
            {realityDomainOptions
              .filter((d) => !d.success && domainServers[d.domain])
              .reduce<DomainServerInfo[]>((acc, d) => {
                const info = domainServers[d.domain]
                if (!acc.some((i) => i.server_id === info.server_id))
                  acc.push(info)
                return acc
              }, [])
              .map((info) => {
                const status = sslSetupStatus[info.server_id] || 'idle'
                return (
                  <div
                    key={info.server_id}
                    className='flex items-center justify-between rounded-lg border p-3'
                  >
                    <div className='min-w-0'>
                      <p className='truncate font-medium'>{info.server_name}</p>
                      <p className='text-muted-foreground truncate text-xs'>
                        {info.domain}
                      </p>
                    </div>
                    <div className='ml-3 flex-shrink-0'>
                      {status === 'idle' && (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => handleSetupSSL(info.server_id)}
                          disabled={anySSLSetupLoading}
                        >
                          <ShieldCheck className='mr-1 h-3.5 w-3.5' />
                          配置
                        </Button>
                      )}
                      {status === 'loading' && (
                        <Button size='sm' variant='outline' disabled>
                          <Loader2 className='mr-1 h-3.5 w-3.5 animate-spin' />
                          配置中
                        </Button>
                      )}
                      {status === 'success' && (
                        <span className='inline-flex items-center text-sm text-green-600'>
                          <CheckCircle className='mr-1 h-3.5 w-3.5' />
                          完成
                        </span>
                      )}
                      {status === 'error' && (
                        <span className='inline-flex items-center text-sm text-red-600'>
                          <XCircle className='mr-1 h-3.5 w-3.5' />
                          失败
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
          <DialogFooter className='gap-2'>
            {!allSSLSetupDone ? (
              <Button onClick={handleSetupAllSSL} disabled={anySSLSetupLoading}>
                {anySSLSetupLoading && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                一键配置全部
              </Button>
            ) : (
              <Button onClick={handleSSLSetupDone}>重新探测</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
