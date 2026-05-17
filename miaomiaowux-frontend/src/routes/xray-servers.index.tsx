// @ts-nocheck
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, RefreshCw, Search, Trash2, Download, Cog, ChevronDown, Terminal, Play, Square, RotateCcw, Copy, Pencil, X, Settings, Wifi, Radio, Eye, ArrowUpCircle, Globe, CheckCircle, XCircle, Loader2, AlertTriangle, Lock, LockOpen } from 'lucide-react'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useLicenseUsage } from '@/hooks/use-license'

import { InboundPanel } from '@/components/xray/inbound-panel'
import { OutboundPanel } from '@/components/xray/outbound-panel'
import { RoutingPanel } from '@/components/xray/routing-panel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { TableCard } from '@/components/ui/table-card'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

interface XraySystemConfig {
  metrics_enabled: boolean
  metrics_listen: string
  stats_enabled: boolean
  grpc_enabled: boolean
  grpc_port: number
}

interface RemoteServerInboundInfo {
  tag: string
  protocol: string
  port: number
  uplink: number
  downlink: number
}

interface RemoteServer {
  id: number
  name: string
  token: string
  status: 'pending' | 'connected' | 'offline'
  last_heartbeat?: string
  ip_address?: string
  domain?: string
  connection_mode: 'push' | 'pull' | 'websocket' | 'http' | 'auto'
  pull_address?: string
  pull_port?: number
  pull_token?: string
  last_pull_at?: string
  push_fail_count?: number
  fallback_to_pull?: boolean
  fallback_at?: string
  ws_connected?: boolean
  traffic_limit?: number
  traffic_used?: number
  traffic_reset_day?: number
  steal_mode?: string
  xray_mode?: 'external' | 'embedded'
  time_offset_seconds?: number
  inbounds?: RemoteServerInboundInfo[]
  current_upload_speed?: number
  current_download_speed?: number
  speed_updated_at?: string
  encrypted?: boolean
  created_at: string
  updated_at: string
}

function formatTraffic(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0 || bytesPerSec === undefined) return '0 B/s'
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MB/s`
  return `${(bytesPerSec / 1024 / 1024 / 1024).toFixed(2)} GB/s`
}

function getTrafficPercent(used: number, limit: number): number {
  if (limit === 0) return 0
  return (used / limit) * 100
}

export const Route = createFileRoute('/xray-servers/')({
  component: XrayServersPage,
})

function XrayServersPage() {
  const { t } = useTranslation('xray')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: licenseUsage } = useLicenseUsage()
  const serversAtLimit = Boolean(licenseUsage?.usage?.servers && licenseUsage.usage.servers.current >= licenseUsage.usage.servers.max)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [formData, setFormData] = useState({
    name: '',
    traffic_limit_gb: '',
    traffic_used_gb: '',
    traffic_reset_day: '',
  })
  const [isXrayRawConfigDialogOpen, setIsXrayRawConfigDialogOpen] = useState(false)
  const [xrayRawConfig, setXrayRawConfig] = useState('')
  const [xrayRawConfigLoading, setXrayRawConfigLoading] = useState(false)
  const [xrayRawConfigServerId, setXrayRawConfigServerId] = useState<number | null>(null)
  const [xrayRawConfigServerName, setXrayRawConfigServerName] = useState('')
  const [isTerminalDialogOpen, setIsTerminalDialogOpen] = useState(false)
  const [terminalTitle, setTerminalTitle] = useState('')
  const [terminalOutput, setTerminalOutput] = useState('')
  const [terminalRunning, setTerminalRunning] = useState(false)
  const terminalRef = useRef<HTMLDivElement>(null)
  const [remoteServerName, setRemoteServerName] = useState('')
  const [generatedToken, setGeneratedToken] = useState('')
  const [installCommand, setInstallCommand] = useState('')
  const [isGeneratingToken, setIsGeneratingToken] = useState(false)
  const [pullAddress, setPullAddress] = useState('')
  const [pullPort, setPullPort] = useState('23889')
  const [pullToken, setPullToken] = useState('')
  const [createStealSelf, setCreateStealSelf] = useState(false)
  const [createFrontService, setCreateFrontService] = useState<'xray' | 'nginx'>('xray')
  const [createStealMode, setCreateStealMode] = useState<'tunnel' | 'fallback'>('tunnel')
  const [createUse443, setCreateUse443] = useState(false)
  const [createDomain, setCreateDomain] = useState('')
  const [domainAutoFilled, setDomainAutoFilled] = useState(false)
  const [createXrayMode, setCreateXrayMode] = useState<'external' | 'embedded'>('external')
  const [createSiteType, setCreateSiteType] = useState<'static' | 'proxy'>('static')
  const [createSiteValue, setCreateSiteValue] = useState('')
  const [isAddWebsiteDialogOpen, setIsAddWebsiteDialogOpen] = useState(false)
  const [addWebsiteServerId, setAddWebsiteServerId] = useState<number | null>(null)
  const [addWebsiteDomain, setAddWebsiteDomain] = useState('')
  const [addWebsiteSiteType, setAddWebsiteSiteType] = useState<'static' | 'proxy'>('static')
  const [addWebsiteSiteValue, setAddWebsiteSiteValue] = useState('')
  const [addWebsiteValidating, setAddWebsiteValidating] = useState(false)
  const [addWebsiteValidResult, setAddWebsiteValidResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [addWebsiteSubmitting, setAddWebsiteSubmitting] = useState(false)
  const [isDeleteRemoteServerDialogOpen, setIsDeleteRemoteServerDialogOpen] = useState(false)
  const [deletingRemoteServerId, setDeletingRemoteServerId] = useState<number | null>(null)
  const [selectedRemoteServer, setSelectedRemoteServer] = useState<RemoteServer | null>(null)
  const [isRemoteServerDetailDialogOpen, setIsRemoteServerDetailDialogOpen] = useState(false)
  const [isRemoteManageDialogOpen, setIsRemoteManageDialogOpen] = useState(false)
  const [managingRemoteServer, setManagingRemoteServer] = useState<RemoteServer | null>(null)
  const [remoteServicesStatus, setRemoteServicesStatus] = useState<{
    xray?: { installed: boolean; running: boolean; version?: string };
    nginx?: { installed: boolean; running: boolean; version?: string };
  } | null>(null)
  const [remoteServicesLoading, setRemoteServicesLoading] = useState(false)
  const [remoteServicesStatusMap, setRemoteServicesStatusMap] = useState<Record<number, {
    xray?: { installed: boolean; running: boolean; version?: string };
    nginx?: { installed: boolean; running: boolean; version?: string };
    loading?: boolean;
    loaded?: boolean;
  }>>({})
  const [isEditRemoteServerDialogOpen, setIsEditRemoteServerDialogOpen] = useState(false)
  const [editingRemoteServer, setEditingRemoteServer] = useState<RemoteServer | null>(null)
  const [remoteFormData, setRemoteFormData] = useState({
    name: '',
    domain: '',
    traffic_limit_gb: '',
    traffic_reset_day: '',
    steal_mode: 'tunnel',
    xray_mode: 'external',
  })
  const [configServer, setConfigServer] = useState<{ type: 'remote'; server: RemoteServer } | null>(null)
  const [remoteXraySystemConfig, setRemoteXraySystemConfig] = useState<XraySystemConfig>({
    metrics_enabled: false,
    metrics_listen: '127.0.0.1:38889',
    stats_enabled: false,
    grpc_enabled: false,
    grpc_port: 46736,
  })
  const [remoteXraySystemConfigLoading, setRemoteXraySystemConfigLoading] = useState(false)
  const [isSyncNodesDialogOpen, setIsSyncNodesDialogOpen] = useState(false)
  const [syncingServerId, setSyncingServerId] = useState<number | null>(null)
  const [syncServerHost, setSyncServerHost] = useState('')
  const [syncForceOverride, setSyncForceOverride] = useState(false)

  const getAuthToken = () => useAuthStore.getState().auth.accessToken

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [terminalOutput])

  const { data: remoteServersData, isLoading } = useQuery({
    queryKey: ['remote-servers'],
    queryFn: async () => {
      const response = await api.get('/api/admin/remote-servers')
      return response.data
    },
    refetchInterval: 3000,
  })

  const { data: masterUrlData } = useQuery({
    queryKey: ['master-url'],
    queryFn: async () => {
      const response = await api.get('/api/admin/system-settings/master-url')
      return response.data as { success: boolean; master_url: string }
    },
    staleTime: 5 * 60 * 1000,
  })

  const masterOrigin = masterUrlData?.master_url || window.location.origin

  const { data: masterCertData } = useQuery({
    queryKey: ['master-cert-status'],
    queryFn: async () => {
      const response = await api.get('/api/admin/master-cert-status')
      return response.data as { success: boolean; domain: string; https_enabled: boolean }
    },
    staleTime: 5 * 60 * 1000,
  })

  const saveXrayRawConfigMutation = useMutation({
    mutationFn: async ({ serverId, config }: { serverId: number; config: string }) => {
      const response = await api.post(`/api/admin/remote/xray/config?server_id=${serverId}`, { config })
      return response.data
    },
    onSuccess: (data) => { data.success ? toast.success(t('servers.xrayConfigSaved')) : toast.error(data.message || t('servers.saveFailed')) },
    onError: handleServerError,
  })

  const createRemoteServerMutation = useMutation({
    mutationFn: async (data: { name: string; traffic_limit?: number; traffic_used_offset?: number; traffic_reset_day?: number; connection_mode?: string; pull_address?: string; pull_port?: number; pull_token?: string; steal_self?: boolean; front_service?: 'xray' | 'nginx'; domain?: string; use_443?: boolean }) => {
      const response = await api.post('/api/admin/remote-servers/create', data)
      return response.data
    },
    onSuccess: (data) => {
      if (data.success) {
        setGeneratedToken(data.server?.token || '')
        setPullToken(data.server?.pull_token || '')
        setInstallCommand(data.install_command || '')
        queryClient.invalidateQueries({ queryKey: ['remote-servers'] })
        if (data.is_local) {
          toast.success(t('servers.localServerDetected'))
        } else {
          toast.success(t('servers.serverCreated'))
        }
      } else { toast.error(data.message || t('servers.createFailed')) }
      setIsGeneratingToken(false)
    },
    onError: (error) => { setIsGeneratingToken(false); handleServerError(error) },
  })

  const deleteRemoteServerMutation = useMutation({
    mutationFn: async (id: number) => { const response = await api.post('/api/admin/remote-servers/delete', { id }); return response.data },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['remote-servers'] }); toast.success(t('servers.serverDeleted')) },
    onError: handleServerError,
  })

  const updateRemoteServerMutation = useMutation({
    mutationFn: async (data: { id: number; name: string; domain?: string; traffic_limit: number; traffic_reset_day: number; connection_mode?: string }) => {
      const response = await api.put('/api/admin/remote-servers/update', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remote-servers'] })
      setIsEditRemoteServerDialogOpen(false)
      setEditingRemoteServer(null)
      setRemoteFormData({ name: '', domain: '', traffic_limit_gb: '', traffic_reset_day: '', steal_mode: 'tunnel' })
      toast.success(t('servers.serverUpdated'))
    },
    onError: handleServerError,
  })

  const updateConnectionModeMutation = useMutation({
    mutationFn: async (data: { id: number; connection_mode: string }) => {
      const servers = remoteServersData?.servers || []
      const server = servers.find((s: RemoteServer) => s.id === data.id)
      if (!server) throw new Error(t('servers.serverNotFound'))
      const response = await api.put('/api/admin/remote-servers/update', { id: data.id, name: server.name, traffic_limit: server.traffic_limit || 0, traffic_reset_day: server.traffic_reset_day || 0, connection_mode: data.connection_mode })
      return response.data
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['remote-servers'] }); toast.success(t('servers.connectionModeUpdated')) },
    onError: handleServerError,
  })

  const remoteServiceControlMutation = useMutation({
    mutationFn: async ({ serverId, service, action }: { serverId: number, service: 'xray' | 'nginx', action: 'start' | 'stop' | 'restart' }) => {
      const response = await api.post(`/api/admin/remote/services/control?server_id=${serverId}`, { service, action })
      return response.data
    },
    onSuccess: (data, variables) => {
      if (managingRemoteServer) loadRemoteServicesStatus(managingRemoteServer.id)
      const actionText = variables.action === 'start' ? t('servers.actionStart') : variables.action === 'stop' ? t('servers.actionStop') : t('servers.actionRestart')
      toast.success(t('servers.serviceStarted', { service: variables.service === 'xray' ? 'Xray' : 'Nginx', action: actionText }))
    },
    onError: handleServerError,
  })

  const updateRemoteXraySystemConfigMutation = useMutation({
    mutationFn: async (config: XraySystemConfig & { server_id: number }) => {
      const response = await api.post(`/api/admin/remote/xray/system-config?server_id=${config.server_id}`, config)
      return response.data
    },
    onSuccess: (data) => {
      if (data.success) { toast.success(t('servers.remoteXrayConfigUpdated')); setIsXrayRawConfigDialogOpen(false); setConfigServer(null) }
      else { toast.error(data.message || t('servers.configUpdateFailed')) }
    },
    onError: handleServerError,
  })

  const syncNodesMutation = useMutation({
    mutationFn: async ({ serverId, serverHost, forceOverride }: { serverId: number, serverHost: string, forceOverride: boolean }) => {
      const response = await api.post(`/api/admin/remote/sync-nodes?server_id=${serverId}`, { server_host: serverHost, force_override: forceOverride })
      return response.data
    },
    onSuccess: (data) => {
      setIsSyncNodesDialogOpen(false); setSyncingServerId(null); setSyncServerHost(''); setSyncForceOverride(false)
      if (data.synced_count > 0) { toast.success(data.message || t('servers.nodeSyncSuccess')); if (data.synced_tags?.length > 0) toast.info(t('servers.syncedTags', { tags: data.synced_tags.join(', ') })) }
      else if (data.skipped_count > 0) { toast.warning(data.message || t('servers.nodeSyncNoNew')) }
      else { toast.info(t('servers.noSyncableInbound')) }
      if (data.errors?.length > 0) { data.errors.slice(0, 3).forEach((err: string) => toast.error(err)); if (data.errors.length > 3) toast.error(t('servers.moreErrors', { count: data.errors.length - 3 })) }
    },
    onError: handleServerError,
  })

  const deployStealSelfMutation = useMutation({
    mutationFn: async (serverId: number) => { const response = await api.post(`/api/admin/remote/deploy-steal-self?server_id=${serverId}`); return response.data },
    onSuccess: () => { toast.success(t('servers.configDeployed')) },
    onError: handleServerError,
  })

  const switchStealModeMutation = useMutation({
    mutationFn: async ({ serverId, stealMode }: { serverId: number; stealMode: string }) => {
      const response = await api.post(`/api/admin/remote/switch-steal-mode?server_id=${serverId}`, { steal_mode: stealMode })
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['remote-servers'] })
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      toast.success(data.message || t('servers.modeSwitch'))
    },
    onError: handleServerError,
  })

  const remoteScanMutation = useMutation({
    mutationFn: async (serverId: number) => { const response = await api.post(`/api/admin/remote/scan?server_id=${serverId}`); return { ...response.data, serverId } },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['remote-servers'] }); queryClient.invalidateQueries({ queryKey: ['nodes'] })
      loadRemoteServerStatusToCache(data.serverId, true)
      if (data.xray_running) {
        let message = data.message || t('servers.scanComplete')
        if (data.synced_count > 0 && data.synced_tags?.length > 0) message = t('servers.scanSynced', { count: data.synced_count, tags: data.synced_tags.join(', ') })
        else if (data.synced_count === 0 && data.skipped_count > 0) message = t('servers.scanSkipped', { count: data.skipped_count })
        toast.success(message)
      } else { toast.info(data.message || t('servers.scanComplete')) }
    },
    onError: handleServerError,
  })

  // --- END MUTATIONS ---

  const streamRemoteOp = async (url: string, title: string, onComplete?: () => void) => {
    setTerminalTitle(title); setTerminalOutput(''); setTerminalRunning(true); setIsTerminalDialogOpen(true)
    try {
      const token = getAuthToken()
      const response = await fetch(url, { method: 'POST', headers: { 'MM-Authorization': token || '', 'Content-Type': 'application/json' } })
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No reader available')
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'output') { setTerminalOutput(prev => prev + data.data.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '') + '\n') }
            else if (data.type === 'complete') { setTerminalRunning(false); setTerminalOutput(prev => prev + '\n✅ ' + data.message); toast.success(data.message); onComplete?.() }
            else if (data.type === 'error') { setTerminalRunning(false); setTerminalOutput(prev => prev + '\n❌ ' + data.message); toast.error(data.message) }
          } catch { /* incomplete JSON chunk */ }
        }
      }
    } catch (error: any) { setTerminalRunning(false); setTerminalOutput(prev => prev + '\n❌ ' + t('servers.requestFailed', { error: error?.message || t('servers.unknownError') })); toast.error(t('servers.failedSuffix', { title })) }
  }

  const handleRemoteInstallXray = (serverId: number) => streamRemoteOp(`/api/admin/remote/xray/install-stream?server_id=${serverId}`, t('servers.installXray'), () => { loadRemoteServerStatusToCache(serverId, true); if (managingRemoteServer) loadRemoteServicesStatus(managingRemoteServer.id) })
  const handleRemoteRemoveXray = (serverId: number) => streamRemoteOp(`/api/admin/remote/xray/remove-stream?server_id=${serverId}`, t('servers.removeXray'), () => { loadRemoteServerStatusToCache(serverId, true); if (managingRemoteServer) loadRemoteServicesStatus(managingRemoteServer.id) })
  const handleRemoteInstallNginx = (serverId: number) => streamRemoteOp(`/api/admin/remote/nginx/install-stream?server_id=${serverId}`, t('servers.installNginx'), () => { loadRemoteServerStatusToCache(serverId, true); if (managingRemoteServer) loadRemoteServicesStatus(managingRemoteServer.id) })
  const handleRemoteRemoveNginx = (serverId: number) => streamRemoteOp(`/api/admin/remote/nginx/remove-stream?server_id=${serverId}`, t('servers.removeNginx'), () => { loadRemoteServerStatusToCache(serverId, true); if (managingRemoteServer) loadRemoteServicesStatus(managingRemoteServer.id) })
  const handleAgentUpgrade = (serverId: number) => streamRemoteOp(`/api/admin/remote/agent/upgrade-stream?server_id=${serverId}`, t('servers.upgradeAgentAction'))
  const handleAgentUninstall = (serverId: number) => streamRemoteOp(`/api/admin/remote/agent/uninstall-stream?server_id=${serverId}`, t('servers.uninstallAgentAction'))

  const resetAddWebsiteDialog = () => { setAddWebsiteDomain(''); setAddWebsiteSiteType('static'); setAddWebsiteSiteValue(''); setAddWebsiteValidating(false); setAddWebsiteValidResult(null); setAddWebsiteSubmitting(false) }
  const validateWebsite = async () => {
    if (!addWebsiteServerId || !addWebsiteSiteValue.trim()) return
    setAddWebsiteValidating(true); setAddWebsiteValidResult(null)
    try {
      const res = await api.post('/api/admin/remote/website/validate', { server_id: addWebsiteServerId, site_type: addWebsiteSiteType, site_value: addWebsiteSiteValue.trim() })
      setAddWebsiteValidResult({ ok: res.data.success, msg: res.data.message })
    } catch { setAddWebsiteValidResult({ ok: false, msg: t('servers.validateFailed') }) }
    finally { setAddWebsiteValidating(false) }
  }
  const submitAddWebsite = async () => {
    if (!addWebsiteServerId || !addWebsiteDomain.trim() || !addWebsiteSiteValue.trim()) { toast.error(t('servers.fillComplete')); return }
    setAddWebsiteSubmitting(true)
    try {
      const res = await api.post('/api/admin/remote/website/add', { server_id: addWebsiteServerId, domain: addWebsiteDomain.trim(), site_type: addWebsiteSiteType, site_value: addWebsiteSiteValue.trim() })
      if (res.data.success) { toast.success(t('servers.websiteAdded')); setIsAddWebsiteDialogOpen(false); resetAddWebsiteDialog() }
      else { toast.error(res.data.message || t('servers.websiteAddFailed')) }
    } catch (error) { handleServerError(error) }
    finally { setAddWebsiteSubmitting(false) }
  }

  const checkSameIP = async (address: string) => {
    if (!address.trim()) return
    try {
      const res = await api.get(`/api/admin/check-same-ip?address=${encodeURIComponent(address.trim())}`)
      if (res.data.same_ip && res.data.https_enabled) {
        setCreateDomain(res.data.master_domain)
        setDomainAutoFilled(true)
        setCreateSiteType('proxy')
        setCreateSiteValue('http://127.0.0.1:12889')
      }
    } catch {}
  }

  const handleSmartInstall = async (serverId: number, withNginx: boolean) => {
    const status = remoteServicesStatusMap[serverId]
    const xrayInstalled = status?.xray?.installed
    const nginxInstalled = status?.nginx?.installed
    if (withNginx) {
      if (!xrayInstalled && !nginxInstalled) { await handleRemoteInstallXray(serverId); await handleRemoteInstallNginx(serverId) }
      else if (xrayInstalled && !nginxInstalled) { await handleRemoteInstallNginx(serverId) }
      else if (!xrayInstalled && nginxInstalled) { await handleRemoteInstallXray(serverId) }
      else { toast.info(t('servers.bothInstalled')) }
    } else {
      if (!xrayInstalled) { await handleRemoteInstallXray(serverId) } else { toast.info(t('servers.xrayInstalled')) }
    }
  }

  const handleSmartUninstall = async (serverId: number) => {
    const status = remoteServicesStatusMap[serverId]
    if (status?.nginx?.installed) await handleRemoteRemoveNginx(serverId)
    if (status?.xray?.installed) await handleRemoteRemoveXray(serverId)
  }

  const loadXrayRawConfig = async (serverId: number) => {
    setXrayRawConfigLoading(true)
    try {
      const response = await api.get(`/api/admin/remote/xray/config?server_id=${serverId}`)
      if (response.data.success) { try { setXrayRawConfig(JSON.stringify(JSON.parse(response.data.config), null, 2)) } catch { setXrayRawConfig(response.data.config || '') } }
      else { toast.error(response.data.message || t('servers.configLoadFailed')) }
    } catch (error) { handleServerError(error) } finally { setXrayRawConfigLoading(false) }
  }

  const handleOpenXrayRawConfig = (server: { id: number; name: string }) => {
    setXrayRawConfigServerId(server.id); setXrayRawConfigServerName(server.name); setIsXrayRawConfigDialogOpen(true); loadXrayRawConfig(server.id)
  }

  const loadRemoteXraySystemConfig = async (serverId: number) => {
    setRemoteXraySystemConfigLoading(true)
    try { const response = await api.get(`/api/admin/remote/xray/system-config?server_id=${serverId}`); if (response.data.success && response.data.config) setRemoteXraySystemConfig(response.data.config) }
    catch (error) { handleServerError(error) } finally { setRemoteXraySystemConfigLoading(false) }
  }

  const handleOpenRemoteXrayConfig = (server: RemoteServer) => {
    setConfigServer({ type: 'remote', server }); setXrayRawConfigServerId(server.id); setXrayRawConfigServerName(server.name)
    setIsXrayRawConfigDialogOpen(true); loadXrayRawConfig(server.id); loadRemoteServicesStatus(server.id); loadRemoteXraySystemConfig(server.id)
  }

  const handleSaveXrayConfig = () => {
    if (!configServer) return
    updateRemoteXraySystemConfigMutation.mutate({ server_id: configServer.server.id, ...remoteXraySystemConfig })
  }

  const loadRemoteServicesStatus = async (serverId: number) => {
    setRemoteServicesLoading(true)
    try { const response = await api.get(`/api/admin/remote/services/status?server_id=${serverId}`); if (response.data.success) setRemoteServicesStatus({ xray: response.data.xray, nginx: response.data.nginx }) }
    catch (error) { handleServerError(error) } finally { setRemoteServicesLoading(false) }
  }

  const handleEditRemoteServer = (server: RemoteServer) => {
    setEditingRemoteServer(server)
    setRemoteFormData({ name: server.name, domain: server.domain || '', traffic_limit_gb: server.traffic_limit ? (server.traffic_limit / 1024 / 1024 / 1024).toFixed(2) : '', traffic_reset_day: server.traffic_reset_day?.toString() || '', steal_mode: server.steal_mode || 'tunnel', xray_mode: server.xray_mode || 'external' })
    setIsEditRemoteServerDialogOpen(true)
  }

  const handleSubmitRemoteServerEdit = () => {
    if (!editingRemoteServer) return
    const oldMode = editingRemoteServer.steal_mode || 'tunnel'
    const newMode = remoteFormData.steal_mode
    if (oldMode !== newMode && editingRemoteServer.status === 'connected') {
      switchStealModeMutation.mutate({ serverId: editingRemoteServer.id, stealMode: newMode })
    }
    const trafficLimitGb = parseFloat(remoteFormData.traffic_limit_gb) || 0
    updateRemoteServerMutation.mutate({ id: editingRemoteServer.id, name: remoteFormData.name, domain: remoteFormData.domain, traffic_limit: trafficLimitGb > 0 ? Math.floor(trafficLimitGb * 1024 * 1024 * 1024) : 0, traffic_reset_day: parseInt(remoteFormData.traffic_reset_day) || 0, xray_mode: remoteFormData.xray_mode })
  }

  const loadRemoteServerStatusToCache = async (serverId: number, forceReload = false) => {
    if (!forceReload && (remoteServicesStatusMap[serverId]?.loaded || remoteServicesStatusMap[serverId]?.loading)) return
    setRemoteServicesStatusMap(prev => ({ ...prev, [serverId]: { ...prev[serverId], loading: true, loaded: false } }))
    try {
      const response = await api.get(`/api/admin/remote/services/status?server_id=${serverId}`)
      if (response.data.success) setRemoteServicesStatusMap(prev => ({ ...prev, [serverId]: { xray: response.data.xray, nginx: response.data.nginx, loading: false, loaded: true } }))
    } catch { setRemoteServicesStatusMap(prev => ({ ...prev, [serverId]: { loading: false, loaded: true } })) }
  }

  useEffect(() => {
    const servers: RemoteServer[] = remoteServersData?.servers || []
    servers.filter((s: RemoteServer) => s.status === 'connected').forEach((server: RemoteServer) => { loadRemoteServerStatusToCache(server.id) })
  }, [remoteServersData])

  const remoteServers: RemoteServer[] = remoteServersData?.servers || []

  const handleGenerateToken = () => {
    if (!remoteServerName.trim()) { toast.error(t('servers.enterServerName')); return }
    if (createUse443 && !createDomain.trim()) { toast.error(t('servers.use443NeedsDomain')); return }
    const trafficLimitBytes = formData.traffic_limit_gb ? Math.round(parseFloat(formData.traffic_limit_gb) * 1024 * 1024 * 1024) : 0
    const trafficUsedOffsetBytes = formData.traffic_used_gb ? Math.round(parseFloat(formData.traffic_used_gb) * 1024 * 1024 * 1024) : 0
    const trafficResetDay = formData.traffic_reset_day ? parseInt(formData.traffic_reset_day) : 0
    setIsGeneratingToken(true)
    createRemoteServerMutation.mutate({ name: remoteServerName, traffic_limit: trafficLimitBytes, traffic_used_offset: trafficUsedOffsetBytes, traffic_reset_day: trafficResetDay, connection_mode: 'auto', pull_address: pullAddress || undefined, pull_port: pullPort ? parseInt(pullPort) : undefined, pull_token: pullToken || undefined, steal_self: createStealSelf, front_service: createFrontService, domain: createDomain.trim() || undefined, use_443: createUse443 || undefined, steal_mode: createStealSelf ? createStealMode : undefined, site_type: createStealSelf ? createSiteType : undefined, site_value: createStealSelf ? createSiteValue : undefined, xray_mode: createXrayMode })
  }

  const copyToClipboard = (text: string, label: string) => { navigator.clipboard.writeText(text).then(() => toast.success(t('servers.copied', { label }))).catch(() => toast.error(t('servers.copyFailed'))) }

  const resetAddDialog = () => {
    setRemoteServerName(''); setGeneratedToken(''); setInstallCommand(''); setIsGeneratingToken(false)
    setPullAddress(''); setPullPort('23889'); setPullToken(''); setCreateStealSelf(false); setCreateFrontService('xray'); setCreateStealMode('tunnel'); setCreateUse443(false); setCreateDomain(''); setDomainAutoFilled(false); setCreateSiteType('static'); setCreateSiteValue(''); setCreateXrayMode('external')
    setFormData({ ...formData, traffic_limit_gb: '', traffic_used_gb: '', traffic_reset_day: '' })
  }

  const handleDeleteRemoteServer = (id: number) => { setDeletingRemoteServerId(id); setIsDeleteRemoteServerDialogOpen(true) }
  const confirmDeleteRemoteServer = () => { if (deletingRemoteServerId !== null) deleteRemoteServerMutation.mutate(deletingRemoteServerId); setIsDeleteRemoteServerDialogOpen(false); setDeletingRemoteServerId(null) }

  // --- END HELPERS ---

  const RemoteServerStatusBadge = ({ status }: { status: string }) => {
    const statusConfig = { pending: { label: t('servers.pending'), variant: 'secondary' as const }, connected: { label: t('servers.online'), variant: 'default' as const }, offline: { label: t('servers.offline'), variant: 'destructive' as const } }
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  const RemoteServiceStatusIndicator = ({ status, name, serverId }: { status?: { installed: boolean; running: boolean; version?: string }, name: string, serverId: number }) => {
    const [open, setOpen] = useState(false)
    const timeoutRef = useRef<ReturnType<typeof setTimeout>>()
    const serviceName = name.toLowerCase() as 'xray' | 'nginx'
    const handleOpen = () => { clearTimeout(timeoutRef.current); if (status?.installed) setOpen(true) }
    const handleClose = () => { timeoutRef.current = setTimeout(() => setOpen(false), 150) }
    const handleControl = (action: 'start' | 'stop' | 'restart') => {
      setOpen(false)
      remoteServiceControlMutation.mutate({ serverId, service: serviceName, action }, { onSuccess: () => loadRemoteServerStatusToCache(serverId, true) })
    }
    if (!status?.installed) {
      return (<div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400"><X className="w-3 h-3" />{name}</div>)
    }
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded cursor-pointer transition-colors", status.running ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700")} onMouseEnter={handleOpen} onMouseLeave={handleClose}>
            <div className={cn("w-2 h-2 rounded-full", status.running ? "bg-green-500" : "bg-gray-400")} />{name}
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" side="top" sideOffset={6} onMouseEnter={handleOpen} onMouseLeave={handleClose} onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => handleControl('restart')} disabled={remoteServiceControlMutation.isPending}><RotateCcw className="w-3 h-3 mr-1" />{t('servers.restartBtn')}</Button>
            {status.running ? (
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-red-600 hover:text-red-700" onClick={() => handleControl('stop')} disabled={remoteServiceControlMutation.isPending}><Square className="w-3 h-3 mr-1" />{t('servers.stopBtn')}</Button>
            ) : (
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-green-600 hover:text-green-700" onClick={() => handleControl('start')} disabled={remoteServiceControlMutation.isPending}><Play className="w-3 h-3 mr-1" />{t('servers.startBtn')}</Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  const InstallPopover = ({ serverId, compact }: { serverId: number; compact?: boolean }) => {
    const [open, setOpen] = useState(false)
    const [withNginx, setWithNginx] = useState('yes')
    const status = remoteServicesStatusMap[serverId]
    const xrayInstalled = status?.xray?.installed
    const nginxInstalled = status?.nginx?.installed
    const bothInstalled = xrayInstalled && nginxInstalled
    const getInstallDesc = () => {
      if (withNginx === 'yes') {
        if (!xrayInstalled && !nginxInstalled) return t('servers.willInstallBoth')
        if (xrayInstalled && !nginxInstalled) return t('servers.willInstallNginx')
        if (!xrayInstalled && nginxInstalled) return t('servers.willInstallXray')
        return t('servers.bothInstalled')
      }
      return !xrayInstalled ? t('servers.willInstallXray') : t('servers.xrayInstalled')
    }
    const canInstall = withNginx === 'yes' ? !bothInstalled : !xrayInstalled
    const canUninstall = xrayInstalled || nginxInstalled
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {compact ? (
            <Button variant="outline" size="sm" className="h-7 px-2"><Download className="h-3.5 w-3.5" /><ChevronDown className="h-3 w-3 ml-1" /></Button>
          ) : (
            <Button variant="outline" size="sm" className="flex-1 min-w-0"><Download className="mr-1 h-3.5 w-3.5 shrink-0" /><span className="truncate">{t('servers.install')}</span><ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0" /></Button>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3" align="start">
          <div className="space-y-3">
            <div className="text-sm font-medium">{t('servers.installService')}</div>
            <RadioGroup value={withNginx} onValueChange={setWithNginx}>
              <div className="flex items-center gap-2"><RadioGroupItem value="yes" id={`nginx-yes-${serverId}`} /><Label htmlFor={`nginx-yes-${serverId}`} className="text-sm cursor-pointer">{t('servers.iWantStealSelf')}</Label></div>
              <div className="flex items-center gap-2"><RadioGroupItem value="no" id={`nginx-no-${serverId}`} /><Label htmlFor={`nginx-no-${serverId}`} className="text-sm cursor-pointer">{t('servers.xrayOnly')}</Label></div>
            </RadioGroup>
            <div className="text-xs text-muted-foreground">{getInstallDesc()}</div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 h-7 text-xs" disabled={terminalRunning || !canInstall} onClick={() => { setOpen(false); handleSmartInstall(serverId, withNginx === 'yes') }}><Download className="h-3 w-3 mr-1" />{t('servers.install')}</Button>
              {canUninstall && (<Button variant="outline" size="sm" className="h-7 text-xs text-red-600 hover:text-red-700" disabled={terminalRunning} onClick={() => { setOpen(false); handleSmartUninstall(serverId) }}><Trash2 className="h-3 w-3 mr-1" />{t('servers.uninstall')}</Button>)}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  // --- END SUB-COMPONENTS ---

  return (
    <div className="container mx-auto py-8 px-4 pt-24">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('servers.title')}</h1>
        <p className="text-gray-600">{t('servers.desc')}</p>
      </div>
      <div className="flex flex-wrap gap-4 mb-6">
        <ViewToggle view={viewMode} onViewChange={setViewMode} />
        <Dialog open={isAddDialogOpen} onOpenChange={(open) => { setIsAddDialogOpen(open); if (!open) resetAddDialog() }}>
          <DialogTrigger asChild><Button disabled={serversAtLimit} title={serversAtLimit ? t('license.serverLimitReached', { current: licenseUsage?.usage?.servers?.current, max: licenseUsage?.usage?.servers?.max, ns: 'common' }) : undefined}><Plus className="mr-2 h-4 w-4" />{t('servers.addServer')}</Button></DialogTrigger>
          <DialogContent className="w-[90vw] md:w-[60vw] max-w-none max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('servers.addRemoteServer')}</DialogTitle>
              <DialogDescription>{t('servers.addRemoteServerDesc')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="remote-name">{t('servers.serverName')}</Label>
                <div className="flex gap-2">
                  <Input id="remote-name" value={remoteServerName} onChange={(e) => setRemoteServerName(e.target.value)} placeholder={t('servers.serverNamePlaceholder')} disabled={!!generatedToken} />
                  <Button onClick={handleGenerateToken} disabled={!remoteServerName.trim() || isGeneratingToken || !!generatedToken}>{isGeneratingToken ? t('servers.generating') : t('servers.generateToken')}</Button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="grid gap-2"><Label htmlFor="pull-address">{t('servers.serverAddress')}</Label><Input id="pull-address" value={pullAddress} onChange={(e) => setPullAddress(e.target.value)} onBlur={(e) => { if (createStealSelf) checkSameIP(e.target.value) }} placeholder={t('servers.serverAddressPlaceholder')} disabled={!!generatedToken} /></div>
                <div className="grid gap-2"><Label htmlFor="pull-port">{t('servers.agentPort')}</Label><Input id="pull-port" type="number" value={pullPort} onChange={(e) => setPullPort(e.target.value)} placeholder="23889" disabled={!!generatedToken} /></div>
                <div className="grid gap-2"><Label htmlFor="pull-token">{t('servers.agentAuthToken')}</Label><Input id="pull-token" value={pullToken} onChange={(e) => setPullToken(e.target.value)} placeholder={t('servers.autoGenerated')} disabled={!!generatedToken} readOnly={!!generatedToken} /></div>
                <div className="grid gap-2"><Label htmlFor="add-traffic-limit">{t('servers.trafficLimit')}</Label><Input id="add-traffic-limit" type="number" step="0.01" placeholder={t('servers.trafficLimitPlaceholder')} value={formData.traffic_limit_gb} onChange={(e) => setFormData({ ...formData, traffic_limit_gb: e.target.value })} disabled={!!generatedToken} /></div>
                <div className="grid gap-2"><Label htmlFor="add-traffic-used">{t('servers.usedTraffic')}</Label><Input id="add-traffic-used" type="number" step="0.01" placeholder={t('servers.usedTrafficPlaceholder')} value={formData.traffic_used_gb} onChange={(e) => setFormData({ ...formData, traffic_used_gb: e.target.value })} disabled={!!generatedToken} /></div>
                <div className="grid gap-2"><Label htmlFor="add-reset-day">{t('servers.resetDay')}</Label><Input id="add-reset-day" type="number" min="1" max="31" placeholder={t('servers.resetDayPlaceholder')} value={formData.traffic_reset_day} onChange={(e) => setFormData({ ...formData, traffic_reset_day: e.target.value })} disabled={!!generatedToken} /></div>
              </div>
              <div className="grid gap-2 p-4 border rounded-lg">
                <Label>{t('servers.xrayMode')}</Label>
                <RadioGroup value={createXrayMode} onValueChange={(value) => setCreateXrayMode(value as 'external' | 'embedded')} className="flex gap-4">
                  <div className="flex items-center gap-2"><RadioGroupItem value="external" id="create-xray-mode-external" disabled={!!generatedToken} /><Label htmlFor="create-xray-mode-external" className="text-sm cursor-pointer">{t('servers.xrayModeExternal')}</Label></div>
                  <div className="flex items-center gap-2"><RadioGroupItem value="embedded" id="create-xray-mode-embedded" disabled={!!generatedToken} /><Label htmlFor="create-xray-mode-embedded" className="text-sm cursor-pointer">{t('servers.xrayModeEmbedded')}</Label></div>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">{createXrayMode === 'external' ? t('servers.xrayModeExternalDesc') : t('servers.xrayModeEmbeddedDesc')}</p>
              </div>
              <div className="grid gap-3 p-4 border rounded-lg">
                <div className="flex items-center justify-between"><Label htmlFor="create-steal-self" className="cursor-pointer">{t('servers.stealSelf')}</Label><Switch id="create-steal-self" checked={createStealSelf} onCheckedChange={(checked) => { setCreateStealSelf(checked); if (checked) { setCreateUse443(true); if (pullAddress.trim()) checkSameIP(pullAddress) } else { setCreateUse443(false); setCreateDomain('') } }} disabled={!!generatedToken} /></div>
                <div className="grid gap-2">
                  <Label>{t('servers.frontSelect')}</Label>
                  <RadioGroup value={createFrontService} onValueChange={(value) => setCreateFrontService(value as 'xray' | 'nginx')} className="flex gap-4">
                    <div className="flex items-center gap-2"><RadioGroupItem value="xray" id="create-front-xray" disabled={!!generatedToken || !createStealSelf} /><Label htmlFor="create-front-xray" className="text-sm cursor-pointer">xray</Label></div>
                    <div className="flex items-center gap-2 opacity-60"><RadioGroupItem value="nginx" id="create-front-nginx" disabled /><Label htmlFor="create-front-nginx" className="text-sm cursor-not-allowed">{t('servers.frontSelectNginxUnavailable')}</Label></div>
                  </RadioGroup>
                  <p className="text-xs text-muted-foreground">{t('servers.stealSelfDesc')}</p>
                </div>
                <div className="grid gap-2">
                  <Label>{t('servers.deployMode')}</Label>
                  <RadioGroup value={createStealMode} onValueChange={(value) => setCreateStealMode(value as 'tunnel' | 'fallback')} className="flex gap-4">
                    <div className="flex items-center gap-2"><RadioGroupItem value="tunnel" id="steal-mode-tunnel" disabled={!!generatedToken || !createStealSelf} /><Label htmlFor="steal-mode-tunnel" className="text-sm cursor-pointer">{t('servers.tunnelMode')}</Label></div>
                    <div className="flex items-center gap-2"><RadioGroupItem value="fallback" id="steal-mode-fallback" disabled={!!generatedToken || !createStealSelf} /><Label htmlFor="steal-mode-fallback" className="text-sm cursor-pointer">{t('servers.fallbackMode')}</Label></div>
                  </RadioGroup>
                  <p className="text-xs text-muted-foreground">{createStealMode === 'tunnel' ? t('servers.tunnelModeDesc') : t('servers.fallbackModeDesc')}</p>
                </div>
                {createStealSelf && (
                  <>
                    <div className="flex items-center justify-between"><Label htmlFor="create-use-443" className="cursor-pointer">{t('servers.use443')}</Label><Switch id="create-use-443" checked={createUse443} onCheckedChange={(checked) => { setCreateUse443(checked); if (!checked) setCreateDomain('') }} disabled={!!generatedToken || createStealSelf} /></div>
                    {createUse443 && (
                      <div className="grid gap-2">
                        <Label htmlFor="create-domain">{t('servers.domain')} <span className="text-destructive">*</span></Label>
                        <Input id="create-domain" value={createDomain} onChange={(e) => { setCreateDomain(e.target.value); setDomainAutoFilled(false) }} placeholder="e.g. us1.example.com" disabled={!!generatedToken} />
                        {domainAutoFilled ? (
                          <p className="text-xs text-blue-600">{t('servers.domainAutoFilled')}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">{t('servers.domainDesc')}</p>
                        )}
                      </div>
                    )}
                    <div className="grid gap-2">
                      <Label>{t('servers.siteType')}</Label>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant={createSiteType === 'static' ? 'default' : 'outline'} onClick={() => setCreateSiteType('static')} disabled={!!generatedToken} className="flex-1">{t('servers.staticPage')}</Button>
                        <Button type="button" size="sm" variant={createSiteType === 'proxy' ? 'default' : 'outline'} onClick={() => setCreateSiteType('proxy')} disabled={!!generatedToken} className="flex-1">{t('servers.reverseProxy')}</Button>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="create-site-value">{createSiteType === 'static' ? t('servers.staticPath') : t('servers.reverseProxyAddress')}</Label>
                      <Input id="create-site-value" value={createSiteValue} onChange={(e) => setCreateSiteValue(e.target.value)} placeholder={createSiteType === 'static' ? t('servers.staticPathPlaceholder') : t('servers.reverseProxyPlaceholder')} disabled={!!generatedToken} />
                    </div>
                  </>
                )}
              </div>
              {generatedToken && (
                <>
                  <div className="grid gap-2"><Label>{t('servers.masterToken')}</Label><div className="flex gap-2"><Input value={generatedToken} readOnly className="font-mono text-sm" /><Button variant="outline" size="icon" onClick={() => copyToClipboard(generatedToken, t('servers.masterToken'))}><Copy className="h-4 w-4" /></Button></div></div>
                  <div className="grid gap-2"><Label>{t('servers.childToken')}</Label><div className="flex gap-2"><Input value={pullToken} readOnly className="font-mono text-sm" /><Button variant="outline" size="icon" onClick={() => copyToClipboard(pullToken, t('servers.childToken'))}><Copy className="h-4 w-4" /></Button></div></div>
                  <div className="grid gap-2"><Label htmlFor="install-command">{t('servers.installCommand')}</Label><div className="flex gap-2"><Textarea id="install-command" value={installCommand} readOnly className="font-mono text-xs h-[80px] resize-none" /><Button variant="outline" size="icon" className="shrink-0" onClick={() => copyToClipboard(installCommand, t('servers.installCommand'))}><Copy className="h-4 w-4" /></Button></div></div>
                  <p className="text-xs text-muted-foreground">{t('servers.tokenDesc')}</p>
                </>
              )}
            </div>
            <DialogFooter><Button variant="outline" onClick={() => { setIsAddDialogOpen(false); resetAddDialog() }}>{generatedToken ? t('servers.complete') : tc('actions.cancel')}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* --- VIEWS --- */}
      {isLoading ? (
        <div className="text-center py-8"><RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" /><p className="text-gray-600">{tc('actions.loading')}</p></div>
      ) : remoteServers.length === 0 ? (
        <EmptyStateCard title={t('servers.noServers')} description={t('servers.noServersDesc')} />
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {remoteServers.map((server: RemoteServer) => {
            const remoteStatus = remoteServicesStatusMap[server.id]
            return (
              <Card key={`remote-${server.id}`} className={server.status !== 'connected' ? 'cursor-pointer hover:border-primary/50 transition-colors' : ''} onClick={() => { if (server.status !== 'connected') { setSelectedRemoteServer(server); setIsRemoteServerDetailDialogOpen(true) } }}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn("w-3 h-3 rounded-full flex-shrink-0", server.status === 'connected' ? "bg-green-500" : server.status === 'pending' ? "bg-yellow-500" : "bg-red-500")} title={server.status === 'connected' ? t('servers.online') : server.status === 'pending' ? t('servers.pending') : t('servers.offline')} />
                      <CardTitle className="text-lg truncate">{server.name}</CardTitle>
                      <RemoteServerStatusBadge status={server.status} />
                      {server.status === 'connected' && (
                        server.encrypted
                          ? <Lock className="h-3.5 w-3.5 text-green-500 flex-shrink-0" title={t('servers.encrypted')} />
                          : <LockOpen className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" title={t('servers.unencrypted')} />
                      )}
                      {Math.abs(server.time_offset_seconds ?? 0) > 10 && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="h-4 w-4 text-yellow-500 cursor-help flex-shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>{t('servers.timeOffsetWarning')}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {server.fallback_to_pull && (<Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 shrink-0">{t('servers.degraded')}</Badge>)}
                      {server.steal_mode && server.steal_mode !== 'tunnel' && (<Badge variant="outline" className="text-xs shrink-0">{server.steal_mode === 'fallback' ? t('servers.fallbackLabel') : t('servers.stealModeDefault')}</Badge>)}
                      {server.xray_mode === 'embedded' && (<Badge variant="outline" className="text-xs shrink-0 border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400">{t('servers.xrayModeEmbedded')}</Badge>)}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {server.status === 'connected' && (<Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleOpenXrayRawConfig(server) }} className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-muted" title={t('servers.viewXrayConfig')}><Eye className="h-4 w-4" /></Button>)}
                      {server.status === 'connected' && (<Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); remoteScanMutation.mutate(server.id) }} disabled={remoteScanMutation.isPending} className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-muted" title={t('servers.scan')}><Search className={cn("h-4 w-4", remoteScanMutation.isPending && "animate-spin")} /></Button>)}
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleEditRemoteServer(server) }} className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-muted" title={t('servers.editServer')}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDeleteRemoteServer(server.id) }} className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950" title={t('servers.deleteServer')}><X className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground ml-5 flex items-center gap-2">
                    <span>{server.ip_address || t('servers.waitConnection')}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-xs gap-1" onClick={(e) => e.stopPropagation()}>
                          {server.connection_mode === 'websocket' && <Wifi className="h-3 w-3" />}
                          {server.connection_mode === 'http' && <Radio className="h-3 w-3" />}
                          {server.connection_mode === 'pull' && <RefreshCw className="h-3 w-3" />}
                          {(server.connection_mode === 'auto' || !server.connection_mode) && <Settings className="h-3 w-3" />}
                          <span className="hidden sm:inline">{server.connection_mode === 'websocket' ? t('servers.websocketMode') : server.connection_mode === 'http' ? t('servers.httpMode') : server.connection_mode === 'pull' ? t('servers.pullMode') : t('servers.autoMode')}</span>
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-40">
                        {(['auto', 'websocket', 'http', 'pull'] as const).map(mode => (
                          <DropdownMenuItem key={mode} onClick={(e) => { e.stopPropagation(); updateConnectionModeMutation.mutate({ id: server.id, connection_mode: mode }) }}>
                            {mode === 'auto' && <Settings className="mr-2 h-4 w-4" />}{mode === 'websocket' && <Wifi className="mr-2 h-4 w-4" />}{mode === 'http' && <Radio className="mr-2 h-4 w-4" />}{mode === 'pull' && <RefreshCw className="mr-2 h-4 w-4" />}
                            {mode === 'auto' ? t('servers.autoMode') : mode === 'websocket' ? t('servers.websocketMode') : mode === 'http' ? t('servers.httpMode') : t('servers.pullMode')}
                            {(server.connection_mode === mode || (!server.connection_mode && mode === 'auto')) && <span className="ml-auto">✓</span>}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardDescription>
                  <div className="flex items-center gap-4 mt-3">
                    <RemoteServiceStatusIndicator status={remoteStatus?.xray} name="Xray" serverId={server.id} />
                    {remoteStatus?.nginx?.installed && (<RemoteServiceStatusIndicator status={remoteStatus?.nginx} name="Nginx" serverId={server.id} />)}
                    {remoteStatus?.loading && (<span className="text-xs text-muted-foreground">{t('servers.loadingStatus')}</span>)}
                  </div>
                  <div className="mt-4 flex gap-3">
                    <div className="flex-1 bg-muted/50 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20M7 7l5-5 5 5M7 17l5 5 5-5" /></svg>
                        <span>{t('servers.realtimeSpeed')}</span>
                      </div>
                      {(server.current_upload_speed !== undefined && server.current_upload_speed > 0) || (server.current_download_speed !== undefined && server.current_download_speed > 0) ? (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{t('servers.upload')}</span><span className="text-sm font-mono font-medium text-green-600 dark:text-green-400">↑ {formatSpeed(server.current_upload_speed || 0)}</span></div>
                          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{t('servers.download')}</span><span className="text-sm font-mono font-medium text-blue-600 dark:text-blue-400">↓ {formatSpeed(server.current_download_speed || 0)}</span></div>
                        </div>
                      ) : server.status === 'connected' ? (<p className="text-sm font-mono text-muted-foreground">{t('servers.waitingData')}</p>) : server.status === 'pending' ? (<p className="text-sm font-mono text-muted-foreground">{t('servers.pendingShort')}</p>) : (<p className="text-sm font-mono text-muted-foreground">{t('servers.offline')}</p>)}
                    </div>
                    <div className="flex-1 bg-muted/50 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path d="M9 12l2 2 4-4" /></svg>
                        <span>{t('servers.trafficStats')}</span>
                      </div>
                      {server.traffic_limit && server.traffic_limit > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{t('servers.usedTotal')}</span><span className="text-sm font-mono font-medium">{formatTraffic(server.traffic_used || 0)}/{formatTraffic(server.traffic_limit)}</span></div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className={cn("h-full rounded-full transition-all", getTrafficPercent(server.traffic_used || 0, server.traffic_limit) > 90 ? "bg-red-500" : getTrafficPercent(server.traffic_used || 0, server.traffic_limit) > 70 ? "bg-yellow-500" : "bg-primary")} style={{ width: `${Math.min(getTrafficPercent(server.traffic_used || 0, server.traffic_limit), 100)}%` }} /></div>
                          {server.traffic_reset_day && server.traffic_reset_day > 0 && (<div className="flex items-center justify-between text-xs text-muted-foreground"><span>{t('servers.resetLabel')}</span><span>{t('servers.monthlyReset', { day: server.traffic_reset_day })}</span></div>)}
                        </div>
                      ) : (
                        <div className="space-y-1"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{t('servers.used')}</span><span className="text-sm font-mono font-medium">{formatTraffic(server.traffic_used || 0)}</span></div><div className="text-xs text-muted-foreground">{t('servers.unlimited')}</div></div>
                      )}
                    </div>
                  </div>
                  {server.last_heartbeat && (<div className="mt-3 text-xs text-muted-foreground">{t('servers.lastHeartbeat')}: {new Date(server.last_heartbeat).toLocaleString()}</div>)}
                </CardHeader>
                <CardFooter className="flex gap-2 pt-4">
                  {server.status === 'connected' && (
                    <>
                      <InstallPopover serverId={server.id} />
                      {remoteStatus?.xray?.installed && (<Button variant="outline" size="sm" className="flex-1 min-w-0" onClick={(e) => { e.stopPropagation(); handleOpenRemoteXrayConfig(server) }}><Cog className="h-4 w-4 mr-1" />{t('servers.xrayConfig')}</Button>)}
                      {remoteStatus?.xray?.installed && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="flex-1 min-w-0"><Settings className="mr-1 h-3.5 w-3.5 shrink-0" />{t('servers.agentManagement')}<ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSyncingServerId(server.id); setSyncServerHost(server.ip_address || ''); setIsSyncNodesDialogOpen(true) }}><RefreshCw className="mr-2 h-4 w-4" />{t('servers.syncNodes')}</DropdownMenuItem>
                            {server.domain && (<><DropdownMenuSeparator /><DropdownMenuItem onClick={(e) => { e.stopPropagation(); deployStealSelfMutation.mutate(server.id) }} disabled={deployStealSelfMutation.isPending}><Download className="mr-2 h-4 w-4" />{deployStealSelfMutation.isPending ? t('servers.deploying') : t('servers.deployConfig')}</DropdownMenuItem></>)}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setAddWebsiteServerId(server.id); setIsAddWebsiteDialogOpen(true) }}><Globe className="mr-2 h-4 w-4" />{t('servers.addWebsite')}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleAgentUpgrade(server.id) }}><ArrowUpCircle className="mr-2 h-4 w-4" />{t('servers.upgradeAgent')}</DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleAgentUninstall(server.id) }} className="text-red-600"><Trash2 className="mr-2 h-4 w-4" />{t('servers.uninstallAgent')}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </>
                  )}
                </CardFooter>
              </Card>
            )
          })}
        </div>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('servers.nameCol')}</TableHead>
                <TableHead>{t('servers.connectionMode')}</TableHead>
                <TableHead>{t('servers.ipAddress')}</TableHead>
                <TableHead>{t('servers.speedCol')}</TableHead>
                <TableHead>{t('servers.trafficCol')}</TableHead>
                <TableHead>{t('servers.serviceCol')}</TableHead>
                <TableHead className="text-right">{t('servers.actionsCol')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {remoteServers.map((server: RemoteServer) => {
                const remoteStatus = remoteServicesStatusMap[server.id]
                return (
                  <TableRow key={`remote-${server.id}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", server.status === 'connected' ? "bg-green-500" : server.status === 'pending' ? "bg-yellow-500" : "bg-red-500")} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn("truncate", server.status !== 'connected' && 'cursor-pointer hover:text-primary')} onClick={() => { if (server.status !== 'connected') { setSelectedRemoteServer(server); setIsRemoteServerDetailDialogOpen(true) } }}>{server.name}</span>
                            <RemoteServerStatusBadge status={server.status} />
                            {server.status === 'connected' && (
                              server.encrypted
                                ? <Lock className="h-3 w-3 text-green-500 flex-shrink-0" title={t('servers.encrypted')} />
                                : <LockOpen className="h-3 w-3 text-muted-foreground flex-shrink-0" title={t('servers.unencrypted')} />
                            )}
                            {Math.abs(server.time_offset_seconds ?? 0) > 10 && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertTriangle className="h-4 w-4 text-yellow-500 cursor-help flex-shrink-0" />
                                  </TooltipTrigger>
                                  <TooltipContent>{t('servers.timeOffsetWarning')}</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            {server.fallback_to_pull && (<Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">{t('servers.degraded')}</Badge>)}
                            {server.steal_mode && server.steal_mode !== 'tunnel' && (<Badge variant="outline" className="text-xs">{server.steal_mode === 'fallback' ? t('servers.fallbackLabel') : t('servers.stealModeDefault')}</Badge>)}
                          </div>
                          {server.last_heartbeat && (<div className="text-xs text-muted-foreground mt-0.5">{t('servers.heartbeatLabel')}: {new Date(server.last_heartbeat).toLocaleString()}</div>)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                            {server.connection_mode === 'websocket' && <Wifi className="h-3 w-3" />}{server.connection_mode === 'http' && <Radio className="h-3 w-3" />}{server.connection_mode === 'pull' && <RefreshCw className="h-3 w-3" />}{(server.connection_mode === 'auto' || !server.connection_mode) && <Settings className="h-3 w-3" />}
                            <span>{server.connection_mode === 'websocket' ? 'WS' : server.connection_mode === 'http' ? 'HTTP' : server.connection_mode === 'pull' ? t('servers.pullMode') : t('servers.autoMode')}</span><ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-40">
                          {(['auto', 'websocket', 'http', 'pull'] as const).map(mode => (
                            <DropdownMenuItem key={mode} onClick={() => updateConnectionModeMutation.mutate({ id: server.id, connection_mode: mode })}>
                              {mode === 'auto' && <Settings className="mr-2 h-4 w-4" />}{mode === 'websocket' && <Wifi className="mr-2 h-4 w-4" />}{mode === 'http' && <Radio className="mr-2 h-4 w-4" />}{mode === 'pull' && <RefreshCw className="mr-2 h-4 w-4" />}
                              {mode === 'auto' ? t('servers.autoMode') : mode === 'websocket' ? t('servers.websocketMode') : mode === 'http' ? t('servers.httpMode') : t('servers.pullMode')}
                              {(server.connection_mode === mode || (!server.connection_mode && mode === 'auto')) && <span className="ml-auto">✓</span>}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{server.ip_address || '-'}</TableCell>
                    <TableCell>
                      {server.status === 'connected' && ((server.current_upload_speed || server.current_download_speed) ? (
                        <div className="text-xs space-y-0.5">
                          <div className="text-green-600 dark:text-green-400">↑ {formatSpeed(server.current_upload_speed || 0)}</div>
                          <div className="text-blue-600 dark:text-blue-400">↓ {formatSpeed(server.current_download_speed || 0)}</div>
                        </div>
                      ) : (<span className="text-xs text-muted-foreground">-</span>))}
                      {server.status !== 'connected' && <span className="text-xs text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      {server.traffic_limit && server.traffic_limit > 0 ? (
                        <div className="min-w-[100px]">
                          <div className="text-xs text-muted-foreground mb-1">{formatTraffic(server.traffic_used || 0)} / {formatTraffic(server.traffic_limit)}</div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden"><div className={cn("h-full rounded-full", getTrafficPercent(server.traffic_used || 0, server.traffic_limit) > 90 ? "bg-red-500" : getTrafficPercent(server.traffic_used || 0, server.traffic_limit) > 70 ? "bg-yellow-500" : "bg-green-500")} style={{ width: `${Math.min(getTrafficPercent(server.traffic_used || 0, server.traffic_limit), 100)}%` }} /></div>
                          {server.traffic_reset_day && server.traffic_reset_day > 0 && (<div className="text-xs text-muted-foreground mt-0.5">{t('servers.monthlyResetFull', { day: server.traffic_reset_day })}</div>)}
                        </div>
                      ) : (<span className="text-xs text-muted-foreground">{t('servers.noLimit')}</span>)}
                    </TableCell>
                    <TableCell>
                      {server.status === 'connected' ? (remoteStatus?.loading ? (<span className="text-xs text-muted-foreground">{t('servers.loadingStatus')}</span>) : (
                        <div className="flex items-center gap-3">
                          <RemoteServiceStatusIndicator status={remoteStatus?.xray} name="Xray" serverId={server.id} />
                          {remoteStatus?.nginx?.installed && (<RemoteServiceStatusIndicator status={remoteStatus?.nginx} name="Nginx" serverId={server.id} />)}
                        </div>
                      )) : (<span className="text-xs text-muted-foreground">{t('servers.notConnected')}</span>)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {server.status === 'connected' && (
                          <>
                            <InstallPopover serverId={server.id} compact />
                            {remoteStatus?.xray?.installed && (<Button variant="outline" size="sm" className="h-7 px-2" onClick={() => handleOpenRemoteXrayConfig(server)} title={t('servers.xrayConfig')}><Cog className="h-3.5 w-3.5" /></Button>)}
                            {remoteStatus?.xray?.installed && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-7 px-2" title={t('servers.agentManagement')}><Settings className="h-3.5 w-3.5" /><ChevronDown className="h-3 w-3 ml-1" /></Button></DropdownMenuTrigger>
                                <DropdownMenuContent>
                                  <DropdownMenuItem onClick={() => { setSyncingServerId(server.id); setSyncServerHost(server.ip_address || ''); setIsSyncNodesDialogOpen(true) }}><RefreshCw className="mr-2 h-4 w-4" />{t('servers.syncNodes')}</DropdownMenuItem>
                                  {server.domain && (<><DropdownMenuSeparator /><DropdownMenuItem onClick={() => deployStealSelfMutation.mutate(server.id)} disabled={deployStealSelfMutation.isPending}><Download className="mr-2 h-4 w-4" />{deployStealSelfMutation.isPending ? t('servers.deploying') : t('servers.deployConfig')}</DropdownMenuItem></>)}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => { setAddWebsiteServerId(server.id); setIsAddWebsiteDialogOpen(true) }}><Globe className="mr-2 h-4 w-4" />{t('servers.addWebsite')}</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => handleAgentUpgrade(server.id)}><ArrowUpCircle className="mr-2 h-4 w-4" />{t('servers.upgradeAgent')}</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleAgentUninstall(server.id)} className="text-red-600"><Trash2 className="mr-2 h-4 w-4" />{t('servers.uninstallAgent')}</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleOpenXrayRawConfig(server)} title={t('servers.viewXrayConfig')}><Eye className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => remoteScanMutation.mutate(server.id)} disabled={remoteScanMutation.isPending} title={t('servers.scan')}><Search className={cn("h-3.5 w-3.5", remoteScanMutation.isPending && "animate-spin")} /></Button>
                          </>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleEditRemoteServer(server)} title={t('servers.editServer')}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => handleDeleteRemoteServer(server.id)} title={t('servers.deleteServer')}><X className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableCard>
      )}

      {/* Terminal Dialog */}
      <Dialog open={isTerminalDialogOpen} onOpenChange={(open) => { if (!terminalRunning) setIsTerminalDialogOpen(open) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Terminal className="h-5 w-5" />{terminalTitle}</DialogTitle>
            <DialogDescription>{terminalRunning ? t('servers.executing') : t('servers.executionDone')}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div ref={terminalRef} className="bg-zinc-900 text-zinc-100 p-4 rounded-lg text-sm font-mono overflow-auto max-h-[400px] whitespace-pre-wrap break-all">
              {terminalOutput}{terminalRunning && <span className="animate-pulse">▌</span>}
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setIsTerminalDialogOpen(false)} disabled={terminalRunning}>{terminalRunning ? t('servers.executingBtn') : tc('actions.close')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Xray Config Dialog */}
      <Dialog open={isXrayRawConfigDialogOpen} onOpenChange={(open) => { setIsXrayRawConfigDialogOpen(open); if (!open) setConfigServer(null) }}>
        <DialogContent className="w-[50vw] h-[85vh] flex flex-col overflow-hidden sm:max-w-none">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{t('servers.xrayManagement')} - {xrayRawConfigServerName}</DialogTitle>
            <DialogDescription>{t('servers.xrayManagementDesc')}</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="config" className="flex-1 flex flex-col min-h-0">
            <TabsList className="flex-shrink-0 w-full justify-start">
              <TabsTrigger value="config">{t('servers.configManagement')}</TabsTrigger>
              <TabsTrigger value="inbounds">{t('servers.inboundManagement')}</TabsTrigger>
              <TabsTrigger value="outbounds">{t('servers.outboundManagement')}</TabsTrigger>
              <TabsTrigger value="routing">{t('servers.routingManagement')}</TabsTrigger>
            </TabsList>
            <TabsContent value="config" className="flex-1 flex flex-col min-h-0 mt-2">
              {configServer?.type === 'remote' && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pb-3 border-b mb-3 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{t('servers.serviceControl')}</span>
                    <Button variant="outline" size="sm" onClick={() => remoteServiceControlMutation.mutate({ serverId: configServer.server.id, service: 'xray', action: 'start' })} disabled={remoteServiceControlMutation.isPending || remoteServicesStatus?.xray?.running}><Play className="h-4 w-4 mr-1" />{t('servers.startBtn')}</Button>
                    <Button variant="outline" size="sm" onClick={() => remoteServiceControlMutation.mutate({ serverId: configServer.server.id, service: 'xray', action: 'stop' })} disabled={remoteServiceControlMutation.isPending || !remoteServicesStatus?.xray?.running}><Square className="h-4 w-4 mr-1" />{t('servers.stopBtn')}</Button>
                    <Button variant="outline" size="sm" onClick={() => remoteServiceControlMutation.mutate({ serverId: configServer.server.id, service: 'xray', action: 'restart' })} disabled={remoteServiceControlMutation.isPending}><RotateCcw className="h-4 w-4 mr-1" />{t('servers.restartBtn')}</Button>
                  </div>
                  {remoteServicesLoading ? (<RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />) : (
                    <Badge variant={remoteServicesStatus?.xray?.running ? 'default' : 'secondary'}>
                      {remoteServicesStatus?.xray?.installed ? (remoteServicesStatus?.xray?.running ? t('servers.running') : t('servers.stopped')) : t('servers.notInstalled')}
                      {remoteServicesStatus?.xray?.version ? ` (${remoteServicesStatus.xray.version})` : ''}
                    </Badge>
                  )}
                  <div className="flex items-center gap-4 flex-wrap">
                    {!remoteXraySystemConfigLoading && (
                      <>
                        <label className="flex items-center gap-1.5 text-sm"><Switch checked={remoteXraySystemConfig.metrics_enabled} onCheckedChange={(checked) => setRemoteXraySystemConfig(prev => ({ ...prev, metrics_enabled: checked }))} />{t('servers.metricsStats')}</label>
                        <label className="flex items-center gap-1.5 text-sm"><Switch checked={remoteXraySystemConfig.stats_enabled} onCheckedChange={(checked) => setRemoteXraySystemConfig(prev => ({ ...prev, stats_enabled: checked }))} />{t('servers.trafficStatsConfig')}</label>
                        <label className="flex items-center gap-1.5 text-sm"><Switch checked={remoteXraySystemConfig.grpc_enabled} onCheckedChange={(checked) => setRemoteXraySystemConfig(prev => ({ ...prev, grpc_enabled: checked }))} />gRPC</label>
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className="flex-1 flex flex-col min-h-0">
                {xrayRawConfigLoading ? (<div className="flex items-center justify-center flex-1 bg-muted rounded-lg"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>) : (
                  <Textarea value={xrayRawConfig} onChange={(e) => setXrayRawConfig(e.target.value)} className="font-mono text-sm flex-1 resize-none" placeholder={t('servers.xrayConfigPlaceholder')} />
                )}
              </div>
              <div className="flex justify-end gap-2 pt-3 flex-shrink-0">
                <Button onClick={() => { if (xrayRawConfigServerId === null) return; try { JSON.parse(xrayRawConfig) } catch { toast.error(t('servers.jsonFormatError')); return }; saveXrayRawConfigMutation.mutate({ serverId: xrayRawConfigServerId, config: xrayRawConfig }); if (configServer?.type === 'remote') handleSaveXrayConfig() }} disabled={saveXrayRawConfigMutation.isPending || updateRemoteXraySystemConfigMutation.isPending || xrayRawConfigLoading}>
                  {(saveXrayRawConfigMutation.isPending || updateRemoteXraySystemConfigMutation.isPending) ? t('servers.saving') : t('servers.saveConfig')}
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="inbounds" className="flex-1 overflow-y-auto mt-2">
              {xrayRawConfigServerId !== null && (<InboundPanel serverId={xrayRawConfigServerId} serverName={xrayRawConfigServerName} />)}
            </TabsContent>
            <TabsContent value="outbounds" className="flex-1 overflow-y-auto mt-2">
              {xrayRawConfigServerId !== null && (<OutboundPanel serverId={xrayRawConfigServerId} serverName={xrayRawConfigServerName} />)}
            </TabsContent>
            <TabsContent value="routing" className="flex-1 overflow-y-auto mt-2">
              {xrayRawConfigServerId !== null && (<RoutingPanel serverId={xrayRawConfigServerId} serverName={xrayRawConfigServerName} isRemote={true} />)}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Delete Remote Server Confirm */}
      <AlertDialog open={isDeleteRemoteServerDialogOpen} onOpenChange={setIsDeleteRemoteServerDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t('servers.confirmDeleteServer')}</AlertDialogTitle><AlertDialogDescription>{t('servers.deleteServerTokenWarning')}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel onClick={() => setDeletingRemoteServerId(null)}>{tc('actions.cancel')}</AlertDialogCancel><AlertDialogAction onClick={confirmDeleteRemoteServer} className="bg-red-600 hover:bg-red-700">{tc('actions.confirmDelete')}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* REMAINING_DIALOGS */}

      {/* Remote Server Detail Dialog */}
      <Dialog open={isRemoteServerDetailDialogOpen} onOpenChange={setIsRemoteServerDetailDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedRemoteServer?.status === 'offline' ? t('servers.serverOffline') : t('servers.serverInstallInfo')}</DialogTitle>
            <DialogDescription>{selectedRemoteServer?.status === 'offline' ? t('servers.serverOfflineDesc') : t('servers.serverOfflineDescDetailed')}</DialogDescription>
          </DialogHeader>
          {selectedRemoteServer && (
            <div className="space-y-4">
              {selectedRemoteServer.status === 'offline' && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-lg">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-medium mb-2"><div className="w-3 h-3 rounded-full bg-red-500" />{t('servers.serverOffline')}</div>
                  <p className="text-sm text-red-600 dark:text-red-400">{t('servers.lastHeartbeatTime', { time: selectedRemoteServer.last_heartbeat ? new Date(selectedRemoteServer.last_heartbeat).toLocaleString() : t('servers.neverConnected') })}</p>
                </div>
              )}
              <div className="space-y-2"><Label>{t('servers.serverName')}</Label><div className="text-sm font-medium">{selectedRemoteServer.name}</div></div>
              {selectedRemoteServer.status === 'offline' && (
                <div className="space-y-2">
                  <Label className="text-base font-semibold">{t('servers.startService')}</Label>
                  <div className="bg-muted p-3 rounded-md"><pre className="text-xs font-mono whitespace-pre-wrap">{`# Check service status\nsystemctl status mmwx\n\n# Start service\nsystemctl start mmwx\n\n# View logs\njournalctl -u mmwx -f`}</pre></div>
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard('systemctl start mmwx', t('servers.copyStartCommand'))}><Copy className="h-4 w-4 mr-2" />{t('servers.copyStartCommand')}</Button>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="detail-token">Token</Label>
                <div className="flex gap-2"><Input id="detail-token" value={selectedRemoteServer.token} readOnly className="font-mono text-sm" /><Button variant="outline" size="icon" onClick={() => copyToClipboard(selectedRemoteServer.token, 'Token')}><Copy className="h-4 w-4" /></Button></div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="detail-install-command">{selectedRemoteServer.status === 'offline' ? t('servers.reinstallCommand') : t('servers.oneClickInstall')}</Label>
                <div className="flex gap-2"><Input id="detail-install-command" value={`curl -fsSL '${masterOrigin}/api/remote/install.sh?token=${selectedRemoteServer.token}' | bash`} readOnly className="font-mono text-xs" /><Button variant="outline" size="icon" onClick={() => copyToClipboard(`curl -fsSL '${masterOrigin}/api/remote/install.sh?token=${selectedRemoteServer.token}' | bash`, t('servers.installCommand'))}><Copy className="h-4 w-4" /></Button></div>
                <p className="text-xs text-muted-foreground">{selectedRemoteServer.status === 'offline' ? t('servers.offlineReinstallHint') : t('servers.onlineInstallHint')}</p>
              </div>
              <div className="space-y-2">
                <Label>{t('servers.manualConfig')}</Label>
                <div className="bg-muted p-3 rounded-md"><pre className="text-xs font-mono whitespace-pre-wrap">{`# Config file: /etc/mmwx/config.yaml\nmode: remote\nmaster_server: ${window.location.origin}\nremote_token: ${selectedRemoteServer.token}`}</pre></div>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(`mode: remote\nmaster_server: ${window.location.origin}\nremote_token: ${selectedRemoteServer.token}`, t('servers.manualConfig'))}><Copy className="h-4 w-4 mr-2" />{t('servers.copyConfig')}</Button>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setIsRemoteServerDetailDialogOpen(false)}>{tc('actions.close')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Remote Server Dialog */}
      <Dialog open={isEditRemoteServerDialogOpen} onOpenChange={(open) => { setIsEditRemoteServerDialogOpen(open); if (!open) { setEditingRemoteServer(null); setRemoteFormData({ name: '', domain: '', traffic_limit_gb: '', traffic_reset_day: '', steal_mode: 'tunnel', xray_mode: 'external' }) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('servers.editRemoteServer')}</DialogTitle><DialogDescription>{t('servers.editRemoteServerDesc')}</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2"><Label htmlFor="edit-remote-name">{t('servers.serverName')}</Label><Input id="edit-remote-name" value={remoteFormData.name} onChange={(e) => setRemoteFormData({ ...remoteFormData, name: e.target.value })} placeholder={t('servers.serverNamePlaceholder')} /></div>
            <div className="grid gap-2"><Label htmlFor="edit-remote-domain">{t('servers.domainOptional')}</Label><Input id="edit-remote-domain" value={remoteFormData.domain} onChange={(e) => setRemoteFormData({ ...remoteFormData, domain: e.target.value })} placeholder="example.com" /><p className="text-xs text-muted-foreground">{t('servers.domainHint')}</p></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label htmlFor="edit-remote-traffic-limit">{t('servers.trafficLimit')}</Label><Input id="edit-remote-traffic-limit" type="number" step="0.01" placeholder={t('servers.trafficLimitPlaceholder')} value={remoteFormData.traffic_limit_gb} onChange={(e) => setRemoteFormData({ ...remoteFormData, traffic_limit_gb: e.target.value })} /></div>
              <div className="grid gap-2"><Label htmlFor="edit-remote-reset-day">{t('servers.resetDay')}</Label><Input id="edit-remote-reset-day" type="number" min="1" max="31" placeholder={t('servers.resetDayPlaceholder')} value={remoteFormData.traffic_reset_day} onChange={(e) => setRemoteFormData({ ...remoteFormData, traffic_reset_day: e.target.value })} /></div>
            </div>
            <div className="grid gap-2">
              <Label>{t('servers.xrayMode')}</Label>
              <RadioGroup value={remoteFormData.xray_mode} onValueChange={(value) => setRemoteFormData({ ...remoteFormData, xray_mode: value })} className="flex gap-4">
                <div className="flex items-center gap-2"><RadioGroupItem value="external" id="edit-xray-mode-external" /><Label htmlFor="edit-xray-mode-external" className="text-sm cursor-pointer">{t('servers.xrayModeExternal')}</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="embedded" id="edit-xray-mode-embedded" /><Label htmlFor="edit-xray-mode-embedded" className="text-sm cursor-pointer">{t('servers.xrayModeEmbedded')}</Label></div>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">{remoteFormData.xray_mode === 'external' ? t('servers.xrayModeExternalDesc') : t('servers.xrayModeEmbeddedDesc')}</p>
            </div>
            {editingRemoteServer?.status === 'connected' && (
              <div className="grid gap-2">
                <Label>{t('servers.deployMode')}</Label>
                <RadioGroup value={remoteFormData.steal_mode} onValueChange={(value) => setRemoteFormData({ ...remoteFormData, steal_mode: value })} className="flex gap-4">
                  <div className="flex items-center gap-2"><RadioGroupItem value="tunnel" id="edit-steal-tunnel" /><Label htmlFor="edit-steal-tunnel" className="text-sm cursor-pointer">Tunnel</Label></div>
                  <div className="flex items-center gap-2"><RadioGroupItem value="fallback" id="edit-steal-fallback" /><Label htmlFor="edit-steal-fallback" className="text-sm cursor-pointer">{t('servers.fallbackLabel')}</Label></div>
                  <div className="flex items-center gap-2"><RadioGroupItem value="default" id="edit-steal-default" /><Label htmlFor="edit-steal-default" className="text-sm cursor-pointer">{t('servers.stealModeDefault')}</Label></div>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">{remoteFormData.steal_mode === 'tunnel' ? t('servers.tunnelModeDesc') : remoteFormData.steal_mode === 'fallback' ? t('servers.fallbackModeDesc') : t('servers.stealModeDefaultDesc')}</p>
                {remoteFormData.steal_mode !== (editingRemoteServer?.steal_mode || 'tunnel') && (<p className="text-xs text-yellow-600 dark:text-yellow-400">{t('servers.stealModeSwitchWarning')}</p>)}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditRemoteServerDialogOpen(false)} disabled={updateRemoteServerMutation.isPending || switchStealModeMutation.isPending}>{tc('actions.cancel')}</Button>
            <Button onClick={handleSubmitRemoteServerEdit} disabled={updateRemoteServerMutation.isPending || switchStealModeMutation.isPending || !remoteFormData.name.trim()}>{(updateRemoteServerMutation.isPending || switchStealModeMutation.isPending) ? tc('actions.saving') : tc('actions.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remote Manage Dialog */}
      <Dialog open={isRemoteManageDialogOpen} onOpenChange={(open) => { setIsRemoteManageDialogOpen(open); if (!open) { setManagingRemoteServer(null); setRemoteServicesStatus(null) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('servers.remoteServerManagement')}</DialogTitle><DialogDescription>{t('servers.manageRemoteService', { name: managingRemoteServer?.name || '' })}</DialogDescription></DialogHeader>
          {remoteServicesLoading ? (<div className="flex items-center justify-center py-8"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>) : (
            <div className="space-y-6 py-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><h4 className="font-medium">Xray</h4>{remoteServicesStatus?.xray?.installed ? (<Badge variant={remoteServicesStatus.xray.running ? 'default' : 'secondary'}>{remoteServicesStatus.xray.running ? t('servers.running') : t('servers.stopped')}</Badge>) : (<Badge variant="outline">{t('servers.notInstalled')}</Badge>)}</div>
                  {remoteServicesStatus?.xray?.version && (<span className="text-xs text-muted-foreground">{remoteServicesStatus.xray.version}</span>)}
                </div>
                <div className="flex flex-wrap gap-2">
                  {remoteServicesStatus?.xray?.installed ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => managingRemoteServer && remoteServiceControlMutation.mutate({ serverId: managingRemoteServer.id, service: 'xray', action: 'start' })} disabled={remoteServiceControlMutation.isPending || remoteServicesStatus?.xray?.running}><Play className="h-4 w-4 mr-1" />{t('servers.startBtn')}</Button>
                      <Button variant="outline" size="sm" onClick={() => managingRemoteServer && remoteServiceControlMutation.mutate({ serverId: managingRemoteServer.id, service: 'xray', action: 'stop' })} disabled={remoteServiceControlMutation.isPending || !remoteServicesStatus?.xray?.running}><Square className="h-4 w-4 mr-1" />{t('servers.stopBtn')}</Button>
                      <Button variant="outline" size="sm" onClick={() => managingRemoteServer && remoteServiceControlMutation.mutate({ serverId: managingRemoteServer.id, service: 'xray', action: 'restart' })} disabled={remoteServiceControlMutation.isPending}><RotateCcw className="h-4 w-4 mr-1" />{t('servers.restartBtn')}</Button>
                      <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => managingRemoteServer && handleRemoteRemoveXray(managingRemoteServer.id)} disabled={terminalRunning}><Trash2 className="h-4 w-4 mr-1" />{t('servers.uninstall')}</Button>
                    </>
                  ) : (<Button variant="outline" size="sm" onClick={() => managingRemoteServer && handleRemoteInstallXray(managingRemoteServer.id)} disabled={terminalRunning}><Download className="h-4 w-4 mr-1" />{t('servers.installXray')}</Button>)}
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><h4 className="font-medium">Nginx</h4>{remoteServicesStatus?.nginx?.installed ? (<Badge variant={remoteServicesStatus.nginx.running ? 'default' : 'secondary'}>{remoteServicesStatus.nginx.running ? t('servers.running') : t('servers.stopped')}</Badge>) : (<Badge variant="outline">{t('servers.notInstalled')}</Badge>)}</div>
                  {remoteServicesStatus?.nginx?.version && (<span className="text-xs text-muted-foreground">{remoteServicesStatus.nginx.version}</span>)}
                </div>
                <div className="flex flex-wrap gap-2">
                  {remoteServicesStatus?.nginx?.installed ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => managingRemoteServer && remoteServiceControlMutation.mutate({ serverId: managingRemoteServer.id, service: 'nginx', action: 'start' })} disabled={remoteServiceControlMutation.isPending || remoteServicesStatus?.nginx?.running}><Play className="h-4 w-4 mr-1" />{t('servers.startBtn')}</Button>
                      <Button variant="outline" size="sm" onClick={() => managingRemoteServer && remoteServiceControlMutation.mutate({ serverId: managingRemoteServer.id, service: 'nginx', action: 'stop' })} disabled={remoteServiceControlMutation.isPending || !remoteServicesStatus?.nginx?.running}><Square className="h-4 w-4 mr-1" />{t('servers.stopBtn')}</Button>
                      <Button variant="outline" size="sm" onClick={() => managingRemoteServer && remoteServiceControlMutation.mutate({ serverId: managingRemoteServer.id, service: 'nginx', action: 'restart' })} disabled={remoteServiceControlMutation.isPending}><RotateCcw className="h-4 w-4 mr-1" />{t('servers.restartBtn')}</Button>
                      <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => managingRemoteServer && handleRemoteRemoveNginx(managingRemoteServer.id)} disabled={terminalRunning}><Trash2 className="h-4 w-4 mr-1" />{t('servers.uninstall')}</Button>
                    </>
                  ) : (<Button variant="outline" size="sm" onClick={() => managingRemoteServer && handleRemoteInstallNginx(managingRemoteServer.id)} disabled={terminalRunning}><Download className="h-4 w-4 mr-1" />{t('servers.installNginx')}</Button>)}
                </div>
              </div>
              {managingRemoteServer && (
                <div className="border-t pt-4 space-y-2">
                  <h4 className="font-medium text-sm">{t('servers.serverInfo')}</h4>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>IP: {managingRemoteServer.ip_address || t('servers.unknown')}</p>
                    {managingRemoteServer.last_heartbeat && (<p>{t('servers.lastHeartbeat')}: {new Date(managingRemoteServer.last_heartbeat).toLocaleString()}</p>)}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => managingRemoteServer && loadRemoteServicesStatus(managingRemoteServer.id)} disabled={remoteServicesLoading}><RefreshCw className={cn("h-4 w-4 mr-1", remoteServicesLoading && "animate-spin")} />{t('servers.refreshStatus')}</Button>
            <Button variant="outline" onClick={() => setIsRemoteManageDialogOpen(false)}>{tc('actions.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Nodes Dialog */}
      <Dialog open={isSyncNodesDialogOpen} onOpenChange={setIsSyncNodesDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('servers.syncToNodes')}</DialogTitle><DialogDescription>{t('servers.syncToNodesDesc')}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sync-server-host">{t('servers.serverHost')}</Label>
              <Input id="sync-server-host" placeholder={t('servers.syncServerHostPlaceholder')} value={syncServerHost} onChange={(e) => setSyncServerHost(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('servers.syncServerHostHint')}</p>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5"><Label htmlFor="sync-force-override">{t('servers.forceOverrideLabel')}</Label><p className="text-xs text-muted-foreground">{t('servers.forceOverrideDesc')}</p></div>
              <Switch id="sync-force-override" checked={syncForceOverride} onCheckedChange={setSyncForceOverride} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsSyncNodesDialogOpen(false); setSyncingServerId(null); setSyncServerHost(''); setSyncForceOverride(false) }}>{tc('actions.cancel')}</Button>
            <Button onClick={() => { if (syncingServerId && syncServerHost) syncNodesMutation.mutate({ serverId: syncingServerId, serverHost: syncServerHost, forceOverride: syncForceOverride }) }} disabled={!syncServerHost || syncNodesMutation.isPending}>{syncNodesMutation.isPending ? t('servers.syncing') : t('servers.startSync')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddWebsiteDialogOpen} onOpenChange={(open) => { if (!open) { setIsAddWebsiteDialogOpen(false); resetAddWebsiteDialog() } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Globe className="h-5 w-5" />{t('servers.addWebsiteDialog')}</DialogTitle>
            <DialogDescription>{t('servers.addWebsiteDesc')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="add-website-domain">{t('servers.websiteDomain')} <span className="text-destructive">*</span></Label>
              <Input id="add-website-domain" value={addWebsiteDomain} onChange={(e) => setAddWebsiteDomain(e.target.value)} placeholder={t('servers.domainPlaceholder')} />
            </div>
            <div className="grid gap-2">
              <Label>{t('servers.siteType')}</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={addWebsiteSiteType === 'static' ? 'default' : 'outline'} onClick={() => { setAddWebsiteSiteType('static'); setAddWebsiteValidResult(null) }} className="flex-1">{t('servers.staticPage')}</Button>
                <Button type="button" size="sm" variant={addWebsiteSiteType === 'proxy' ? 'default' : 'outline'} onClick={() => { setAddWebsiteSiteType('proxy'); setAddWebsiteValidResult(null) }} className="flex-1">{t('servers.reverseProxy')}</Button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-website-value">{addWebsiteSiteType === 'static' ? t('servers.staticPath') : t('servers.reverseProxyAddress')} <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                <Input id="add-website-value" value={addWebsiteSiteValue} onChange={(e) => { setAddWebsiteSiteValue(e.target.value); setAddWebsiteValidResult(null) }} placeholder={addWebsiteSiteType === 'static' ? t('servers.staticPathPlaceholder') : t('servers.reverseProxyPlaceholder')} className="flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={validateWebsite} disabled={addWebsiteValidating || !addWebsiteSiteValue.trim()}>
                  {addWebsiteValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : t('servers.validate')}
                </Button>
              </div>
              {addWebsiteValidResult && (
                <div className={`flex items-center gap-1.5 text-xs ${addWebsiteValidResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {addWebsiteValidResult.ok ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {addWebsiteValidResult.msg}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsAddWebsiteDialogOpen(false); resetAddWebsiteDialog() }}>{tc('actions.cancel')}</Button>
            <Button onClick={submitAddWebsite} disabled={addWebsiteSubmitting || !addWebsiteDomain.trim() || !addWebsiteSiteValue.trim()}>{addWebsiteSubmitting ? t('servers.adding') : tc('actions.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}