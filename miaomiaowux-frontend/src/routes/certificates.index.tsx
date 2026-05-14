// @ts-nocheck
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Shield,
  ShieldCheck,
  ShieldX,
  Clock,
  Server,
  Upload,
  KeyRound,
  Globe,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { TableCard } from '@/components/ui/table-card'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/certificates/')({
  component: CertificatesPage,
})

interface Certificate {
  id: number
  domain: string
  email: string
  provider: string
  cert_path: string
  key_path: string
  status: 'pending' | 'valid' | 'expired' | 'failed'
  expiry_date: string
  issue_date: string
  auto_renew: boolean
  challenge_mode: string
  webroot_path: string
  remote_server_id: number
  remote_server_name?: string
  message: string
  dns_provider_id: number
  deploy_target: string
  deploy_cert_path: string
  deploy_key_path: string
  auto_deploy: boolean
  created_at: string
  updated_at: string
}

interface RemoteServer {
  id: number
  name: string
  token: string
  status: string
}

interface DNSProvider {
  ID: number
  Name: string
  ProviderType: string
  Credentials: string
  CreatedAt: string
  UpdatedAt: string
}

const DNS_PROVIDER_TYPES = [
  { value: 'cloudflare', label: 'Cloudflare', fields: ['CF_DNS_API_TOKEN'] },
  { value: 'alidns', labelKey: 'dnsProviderTypes.alidns', fields: ['ALICLOUD_ACCESS_KEY', 'ALICLOUD_SECRET_KEY'] },
  { value: 'tencentcloud', labelKey: 'dnsProviderTypes.tencentcloud', fields: ['TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY'] },
  { value: 'dnspod', label: 'DNSPod', fields: ['DNSPOD_API_KEY'] },
  { value: 'namesilo', label: 'NameSilo', fields: ['NAMESILO_API_KEY'] },
  { value: 'godaddy', label: 'GoDaddy', fields: ['GODADDY_API_KEY', 'GODADDY_API_SECRET'] },
]

const CA_PROVIDERS = [
  { value: 'letsencrypt', label: "Let's Encrypt" },
]

function CertificatesPage() {
  const queryClient = useQueryClient()
  const { auth } = useAuthStore()
  const { t } = useTranslation('certificates')

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [deleteDialogCert, setDeleteDialogCert] = useState<Certificate | null>(null)
  const [isDNSProviderDialogOpen, setIsDNSProviderDialogOpen] = useState(false)
  const [isDeployDialogOpen, setIsDeployDialogOpen] = useState(false)
  const [isEnableHTTPSDialogOpen, setIsEnableHTTPSDialogOpen] = useState(false)
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false)
  const [deployTarget, setDeployTarget] = useState<Certificate | null>(null)

  const [formData, setFormData] = useState({
    domain: '',
    email: '',
    remote_server_id: 0,
    provider: 'letsencrypt',
    challenge_mode: 'dns', // 默认 dns 申请泛域名证书
    webroot_path: '',
    auto_renew: true,
    dns_provider_id: 0,
    deploy_target: 'none',
    deploy_cert_path: '',
    deploy_key_path: '',
    auto_deploy: false,
  })

  const [dnsProviderForm, setDnsProviderForm] = useState({
    name: '',
    provider_type: 'cloudflare',
    credentials: '',
  })

  const [deployForm, setDeployForm] = useState({
    deploy_cert_path: '/etc/nginx/ssl/cert.pem',
    deploy_key_path: '/etc/nginx/ssl/key.pem',
  })

  const [uploadForm, setUploadForm] = useState({
    domain: '',
    cert_pem: '',
    key_pem: '',
  })

  const getDnsProviderLabel = (value: string) => {
    const provider = DNS_PROVIDER_TYPES.find(p => p.value === value)
    if (!provider) return value
    return provider.labelKey ? t(provider.labelKey) : provider.label
  }

  // Fetch certificates
  const { data: certificates, isLoading } = useQuery({
    queryKey: ['certificates'],
    queryFn: async () => {
      const response = await api.get('/api/admin/certificates')
      return response.data.certificates as Certificate[]
    },
    enabled: Boolean(auth.accessToken),
    refetchInterval: (query) => {
      const certs = query.state.data
      return certs?.some((c) => c.status === 'pending') ? 3000 : false
    },
  })

  // Fetch remote servers
  const { data: remoteServers } = useQuery({
    queryKey: ['remote-servers-list'],
    queryFn: async () => {
      const response = await api.get('/api/admin/remote-servers')
      return response.data.servers as RemoteServer[]
    },
    enabled: Boolean(auth.accessToken),
  })

  const { data: masterCertStatus } = useQuery({
    queryKey: ['master-cert-status'],
    queryFn: async () => {
      const res = await api.get('/api/admin/master-cert-status')
      return res.data as { success: boolean; pending: boolean; domain: string; https_enabled: boolean }
    },
    enabled: Boolean(auth.accessToken),
    refetchInterval: 10000,
  })

  const deployMasterCert = useMutation({
    mutationFn: () => api.post('/api/admin/deploy-master-cert'),
    onSuccess: (res) => {
      const data = res.data
      if (data.success) {
        toast.success(t('masterCert.deploySuccess'))
        queryClient.invalidateQueries({ queryKey: ['master-cert-status'] })
        setTimeout(() => { window.location.href = data.new_master_url }, 2000)
      } else {
        toast.error(data.message || t('masterCert.deployFailed'))
      }
    },
    onError: handleServerError,
  })

  const enableHTTPS = useMutation({
    mutationFn: () => api.post('/api/admin/enable-https'),
    onSuccess: (res) => {
      const data = res.data
      if (data.success) {
        toast.success(t('https.enableSuccess'))
        queryClient.invalidateQueries({ queryKey: ['master-cert-status'] })
        setTimeout(() => { window.location.href = data.new_master_url }, 2000)
      } else {
        toast.error(data.message || t('https.enableFailed'))
      }
    },
    onError: handleServerError,
  })

  // Fetch DNS providers
  const { data: dnsProviders } = useQuery({
    queryKey: ['dns-providers'],
    queryFn: async () => {
      const response = await api.get('/api/admin/dns-providers')
      return response.data.providers as DNSProvider[]
    },
    enabled: Boolean(auth.accessToken),
  })

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await api.post('/api/admin/certificates/create', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] })
      setIsCreateDialogOpen(false)
      resetForm()
      toast.success(t('toast.certSubmitted'))
    },
    onError: handleServerError,
  })

  const renewMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post('/api/admin/certificates/renew', { id })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] })
      toast.success(t('toast.certRenewSubmitted'))
    },
    onError: handleServerError,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await api.delete('/api/admin/certificates/delete', { data: { id } })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] })
      setDeleteDialogCert(null)
      toast.success(t('toast.certDeleted'))
    },
    onError: handleServerError,
  })

  const toggleAutoRenewMutation = useMutation({
    mutationFn: async ({ id, auto_renew }: { id: number; auto_renew: boolean }) => {
      const response = await api.patch('/api/admin/certificates/auto-renew', { id, auto_renew })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] })
    },
    onError: handleServerError,
  })

  const toggleAutoDeployMutation = useMutation({
    mutationFn: async ({ id, auto_deploy }: { id: number; auto_deploy: boolean }) => {
      const response = await api.patch('/api/admin/certificates/auto-deploy', { id, auto_deploy })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] })
    },
    onError: handleServerError,
  })

  const createDNSProviderMutation = useMutation({
    mutationFn: async (data: typeof dnsProviderForm) => {
      const response = await api.post('/api/admin/dns-providers/create', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns-providers'] })
      setIsDNSProviderDialogOpen(false)
      setDnsProviderForm({ name: '', provider_type: 'cloudflare', credentials: '' })
      toast.success(t('toast.dnsProviderAdded'))
    },
    onError: handleServerError,
  })

  const deleteDNSProviderMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await api.delete(`/api/admin/dns-providers/${id}`)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns-providers'] })
      toast.success(t('toast.dnsProviderDeleted'))
    },
    onError: handleServerError,
  })

  const deployMutation = useMutation({
    mutationFn: async (data: { id: number; deploy_target: string; deploy_cert_path: string; deploy_key_path: string }) => {
      const response = await api.post('/api/admin/certificates/deploy', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] })
      setIsDeployDialogOpen(false)
      setDeployTarget(null)
      toast.success(t('toast.certDeployed'))
    },
    onError: handleServerError,
  })

  const uploadMutation = useMutation({
    mutationFn: async (data: { domain: string; cert_pem: string; key_pem: string }) => {
      const response = await api.post('/api/admin/certificates/upload', {
        domain: data.domain,
        cert_pem: btoa(data.cert_pem),
        key_pem: btoa(data.key_pem),
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] })
      setIsUploadDialogOpen(false)
      setUploadForm({ domain: '', cert_pem: '', key_pem: '' })
      toast.success(t('toast.certUploaded'))
    },
    onError: handleServerError,
  })

  const resetForm = () => {
    setFormData({
      domain: '',
      email: '',
      remote_server_id: 0,
      provider: 'letsencrypt',
      challenge_mode: 'standalone',
      webroot_path: '',
      auto_renew: true,
      dns_provider_id: 0,
      deploy_target: 'none',
      deploy_cert_path: '',
      deploy_key_path: '',
    })
  }

  const handleCreateSubmit = () => {
    if (!formData.domain || !formData.email) {
      toast.error(t('toast.fillDomainEmail'))
      return
    }
    if (formData.challenge_mode === 'dns' && formData.dns_provider_id === 0) {
      toast.error(t('toast.dnsProviderRequired'))
      return
    }
    createMutation.mutate(formData)
  }

  const handleDNSProviderSubmit = () => {
    if (!dnsProviderForm.name || !dnsProviderForm.credentials) {
      toast.error(t('toast.fillNameCredentials'))
      return
    }
    // Validate JSON
    try {
      JSON.parse(dnsProviderForm.credentials)
    } catch {
      toast.error(t('toast.invalidJson'))
      return
    }
    createDNSProviderMutation.mutate(dnsProviderForm)
  }

  const getStatusBadge = (status: string, message?: string) => {
    switch (status) {
      case 'valid':
        return <Badge variant="default" className="bg-green-500"><ShieldCheck className="h-3 w-3 mr-1" />{t('status.valid')}</Badge>
      case 'pending':
        return message ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="cursor-help"><Clock className="h-3 w-3 mr-1 animate-spin" />{t('status.pending')}</Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm">
                <pre className="text-xs whitespace-pre-wrap font-mono">{message}</pre>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Badge variant="secondary"><Clock className="h-3 w-3 mr-1 animate-spin" />{t('status.pending')}</Badge>
        )
      case 'expired':
        return <Badge variant="destructive"><ShieldX className="h-3 w-3 mr-1" />{t('status.expired')}</Badge>
      case 'failed':
        return message ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="cursor-help"><ShieldX className="h-3 w-3 mr-1" />{t('status.failed')}</Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-xs break-all">{message}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Badge variant="destructive"><ShieldX className="h-3 w-3 mr-1" />{t('status.failed')}</Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  const getDaysUntilExpiry = (expiryDate: string) => {
    if (!expiryDate) return null
    const expiry = new Date(expiryDate)
    const now = new Date()
    return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  }

  const getExpiryBadge = (expiryDate: string) => {
    const days = getDaysUntilExpiry(expiryDate)
    if (days === null) return null
    if (days < 0) return <Badge variant="destructive">{t('expiry.expired')}</Badge>
    if (days <= 7) return <Badge variant="destructive">{t('expiry.daysLeft', { days })}</Badge>
    if (days <= 30) return <Badge variant="outline" className="border-yellow-500 text-yellow-600">{t('expiry.daysLeft', { days })}</Badge>
    return <Badge variant="outline" className="border-green-500 text-green-600">{t('expiry.daysLeft', { days })}</Badge>
  }

  const getProviderLabel = (value: string) => {
    return CA_PROVIDERS.find(p => p.value === value)?.label || value
  }

  const getSelectedDNSProviderFields = () => {
    return DNS_PROVIDER_TYPES.find(p => p.value === dnsProviderForm.provider_type)?.fields || []
  }

  const generateCredentialsTemplate = (providerType: string) => {
    const provider = DNS_PROVIDER_TYPES.find(p => p.value === providerType)
    if (!provider) return '{}'
    const obj: Record<string, string> = {}
    provider.fields.forEach(f => { obj[f] = '' })
    return JSON.stringify(obj, null, 2)
  }

  return (
    <div className="space-y-6">
      {masterCertStatus?.pending && (
        <div className="p-4 border rounded-lg bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">
                {t('masterCert.detected', { domain: masterCertStatus.domain })}
              </p>
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {t('masterCert.deployDesc')}
              </p>
            </div>
            <Button onClick={() => deployMasterCert.mutate()} disabled={deployMasterCert.isPending}>
              {deployMasterCert.isPending ? t('masterCert.deploying') : t('masterCert.deployToMaster')}
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6" />
            {t('page.title')}
          </h1>
          <p className="text-muted-foreground">
            {t('page.description')}
          </p>
        </div>
        <div className="flex gap-2">
          {masterCertStatus?.domain && !masterCertStatus?.https_enabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEnableHTTPSDialogOpen(true)}
            >
              <Globe className="h-4 w-4 mr-2" />
              {t('https.enable')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['certificates'] })}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('actions.refresh', { ns: 'common' })}
          </Button>
          <Button size="sm" onClick={() => {
            if (dnsProviders?.length === 1) {
              setFormData(prev => ({ ...prev, dns_provider_id: dnsProviders[0].ID }))
            }
            setIsCreateDialogOpen(true)
          }}>
            <Plus className="h-4 w-4 mr-2" />
            {t('buttons.applyCert')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsUploadDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {t('buttons.uploadCert')}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="certificates">
        <TabsList>
          <TabsTrigger value="certificates">{t('tabs.certList')}</TabsTrigger>
          <TabsTrigger value="dns-providers">{t('tabs.dnsProviders')}</TabsTrigger>
        </TabsList>

        <TabsContent value="certificates">
          <TableCard
            title={t('certTable.title')}
            description={t('certTable.description')}
            isLoading={isLoading}
            isEmpty={!isLoading && !certificates?.length}
            contentClassName="px-6"
            emptyState={<EmptyState className="py-8" title={t('certTable.empty')} />}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('certTable.columns.domain')}</TableHead>
                  <TableHead>{t('certTable.columns.ca')}</TableHead>
                  <TableHead>{t('certTable.columns.server')}</TableHead>
                  <TableHead>{t('certTable.columns.challenge')}</TableHead>
                  <TableHead>{t('certTable.columns.status')}</TableHead>
                  <TableHead>{t('certTable.columns.expiry')}</TableHead>
                  <TableHead>{t('certTable.columns.deploy')}</TableHead>
                  <TableHead>{t('certTable.columns.autoRenew')}</TableHead>
                  <TableHead>{t('certTable.columns.autoDeploy')}</TableHead>
                  <TableHead className="text-right">{t('certTable.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {certificates?.map((cert) => (
                  <TableRow key={cert.id}>
                    <TableCell className="font-medium">{cert.domain}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{getProviderLabel(cert.provider)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Server className="h-3 w-3 text-muted-foreground" />
                        {cert.remote_server_id === 0 ? 'Master' : cert.remote_server_name || `#${cert.remote_server_id}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{cert.challenge_mode}</Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(cert.status, cert.message)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm">{formatDate(cert.expiry_date)}</span>
                        {cert.status === 'valid' && getExpiryBadge(cert.expiry_date)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {cert.deploy_target && cert.deploy_target !== 'none' ? (
                        <Badge variant="outline" className="border-blue-500 text-blue-600">{cert.deploy_target}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={cert.auto_renew}
                        onCheckedChange={(checked) =>
                          toggleAutoRenewMutation.mutate({ id: cert.id, auto_renew: checked })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={cert.auto_deploy}
                        onCheckedChange={(checked) =>
                          toggleAutoDeployMutation.mutate({ id: cert.id, auto_deploy: checked })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {cert.status === 'failed' && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => renewMutation.mutate(cert.id)}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('tooltips.reapply')}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {cert.status !== 'failed' && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  disabled={cert.status === 'pending'}
                                  onClick={() => renewMutation.mutate(cert.id)}
                                >
                                  <RefreshCw className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('tooltips.manualRenew')}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {cert.status === 'valid' && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => {
                                    setDeployTarget(cert)
                                    const filename = cert.domain.startsWith('*.') ? `_.${cert.domain.slice(2)}` : cert.domain
                                    setDeployForm({
                                      deploy_cert_path: cert.deploy_cert_path || `/usr/local/nginx/cert/${filename}.pem`,
                                      deploy_key_path: cert.deploy_key_path || `/usr/local/nginx/cert/${filename}.key`,
                                    })
                                    setIsDeployDialogOpen(true)
                                  }}
                                >
                                  <Upload className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('tooltips.deployCert')}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteDialogCert(cert)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('actions.delete', { ns: 'common' })}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </TabsContent>

        <TabsContent value="dns-providers">
          <TableCard
            title={t('dnsProviderTable.title')}
            description={t('dnsProviderTable.description')}
            actions={(
              <Button size="sm" onClick={() => {
                setDnsProviderForm({
                  name: '',
                  provider_type: 'cloudflare',
                  credentials: generateCredentialsTemplate('cloudflare'),
                })
                setIsDNSProviderDialogOpen(true)
              }}>
                <Plus className="h-4 w-4 mr-2" />
                {t('dnsProviderTable.addProvider')}
              </Button>
            )}
            isEmpty={!dnsProviders?.length}
            contentClassName="px-6"
            emptyState={<EmptyState className="py-8" title={t('dnsProviderTable.empty')} />}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('dnsProviderTable.columns.name')}</TableHead>
                  <TableHead>{t('dnsProviderTable.columns.type')}</TableHead>
                  <TableHead>{t('dnsProviderTable.columns.createdAt')}</TableHead>
                  <TableHead className="text-right">{t('dnsProviderTable.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dnsProviders?.map((provider) => (
                  <TableRow key={provider.ID}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <KeyRound className="h-4 w-4 text-muted-foreground" />
                        {provider.Name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {getDnsProviderLabel(provider.ProviderType)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(provider.CreatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => deleteDNSProviderMutation.mutate(provider.ID)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </TabsContent>
      </Tabs>

      {/* Create Certificate Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('createDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('createDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="domain">{t('createDialog.domain')}</Label>
              <Input
                id="domain"
                placeholder="example.com / *.example.com"
                value={formData.domain}
                onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t('createDialog.domainHint')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t('createDialog.email')}</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('createDialog.caProvider')}</Label>
              <Select
                value={formData.provider}
                onValueChange={(v) => setFormData({ ...formData, provider: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CA_PROVIDERS.map((ca) => (
                    <SelectItem key={ca.value} value={ca.value}>{ca.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('createDialog.targetServer')}</Label>
              <Select
                value={String(formData.remote_server_id)}
                onValueChange={(v) => setFormData({ ...formData, remote_server_id: parseInt(v) })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('createDialog.selectServer')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t('createDialog.masterLocal')}</SelectItem>
                  {remoteServers?.map((server) => (
                    <SelectItem key={server.id} value={String(server.id)}>
                      {server.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('createDialog.challengeMode')}</Label>
              <Select
                value={formData.challenge_mode}
                onValueChange={(v) => {
                  const updates: any = { challenge_mode: v }
                  if (v === 'dns' && formData.domain && !formData.domain.startsWith('*.')) {
                    // Auto-suggest wildcard for DNS mode
                  }
                  setFormData({ ...formData, ...updates })
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dns">{t('createDialog.challengeDns')}</SelectItem>
                  <SelectItem value="standalone">{t('createDialog.challengeStandalone')}</SelectItem>
                  <SelectItem value="webroot">{t('createDialog.challengeWebroot')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.challenge_mode === 'webroot' && (
              <div className="space-y-2">
                <Label htmlFor="webroot_path">{t('createDialog.webrootPath')}</Label>
                <Input
                  id="webroot_path"
                  placeholder="/var/www/html"
                  value={formData.webroot_path}
                  onChange={(e) => setFormData({ ...formData, webroot_path: e.target.value })}
                />
              </div>
            )}
            {formData.challenge_mode === 'dns' && (
              <div className="space-y-2">
                <Label>{t('createDialog.dnsProvider')}</Label>
                <Select
                  value={String(formData.dns_provider_id)}
                  onValueChange={(v) => setFormData({ ...formData, dns_provider_id: parseInt(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('createDialog.selectDnsProvider')} />
                  </SelectTrigger>
                  <SelectContent>
                    {dnsProviders?.map((p) => (
                      <SelectItem key={p.ID} value={String(p.ID)}>
                        {p.Name} ({getDnsProviderLabel(p.ProviderType)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(!dnsProviders || dnsProviders.length === 0) && (
                  <p className="text-xs text-muted-foreground">
                    {t('createDialog.dnsProviderHint')}
                  </p>
                )}
              </div>
            )}
            {/* <div className="space-y-2">
              <Label>证书部署</Label>
              <Select
                value={formData.deploy_target}
                onValueChange={(v) => {
                  const updates: any = { deploy_target: v }
                  if (v !== 'none' && !formData.deploy_cert_path && formData.domain) {
                    const filename = formData.domain.startsWith('*.') ? `_.${formData.domain.slice(2)}` : formData.domain
                    updates.deploy_cert_path = `/usr/local/nginx/cert/${filename}.pem`
                    updates.deploy_key_path = `/usr/local/nginx/cert/${filename}.key`
                  }
                  setFormData({ ...formData, ...updates })
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不自动部署</SelectItem>
                  <SelectItem value="nginx">部署到 Nginx</SelectItem>
                  <SelectItem value="xray">部署到 Xray</SelectItem>
                  <SelectItem value="both">部署到 Nginx + Xray</SelectItem>
                </SelectContent>
              </Select>
            </div> */}
            {formData.deploy_target !== 'none' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="deploy_cert_path">{t('createDialog.certFilePath')}</Label>
                  <Input
                    id="deploy_cert_path"
                    placeholder="/usr/local/nginx/cert/example.com.pem"
                    value={formData.deploy_cert_path}
                    onChange={(e) => setFormData({ ...formData, deploy_cert_path: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="deploy_key_path">{t('createDialog.keyFilePath')}</Label>
                  <Input
                    id="deploy_key_path"
                    placeholder="/usr/local/nginx/cert/example.com.key"
                    value={formData.deploy_key_path}
                    onChange={(e) => setFormData({ ...formData, deploy_key_path: e.target.value })}
                  />
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <Label htmlFor="auto_renew">{t('createDialog.autoRenew')}</Label>
              <Switch
                id="auto_renew"
                checked={formData.auto_renew}
                onCheckedChange={(checked) => setFormData({ ...formData, auto_renew: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="auto_deploy">{t('createDialog.autoDeploy')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('createDialog.autoDeployDesc')}
                </p>
              </div>
              <Switch
                id="auto_deploy"
                checked={formData.auto_deploy}
                onCheckedChange={(checked) => setFormData({ ...formData, auto_deploy: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button onClick={handleCreateSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? t('createDialog.applying') : t('createDialog.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DNS Provider Dialog */}
      <Dialog open={isDNSProviderDialogOpen} onOpenChange={setIsDNSProviderDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('dnsProviderDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('dnsProviderDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dns_name">{t('dnsProviderDialog.name')}</Label>
              <Input
                id="dns_name"
                placeholder={t('dnsProviderDialog.namePlaceholder')}
                value={dnsProviderForm.name}
                onChange={(e) => setDnsProviderForm({ ...dnsProviderForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('dnsProviderDialog.providerType')}</Label>
              <Select
                value={dnsProviderForm.provider_type}
                onValueChange={(v) => setDnsProviderForm({
                  ...dnsProviderForm,
                  provider_type: v,
                  credentials: generateCredentialsTemplate(v),
                })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DNS_PROVIDER_TYPES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{getDnsProviderLabel(p.value)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('dnsProviderDialog.apiCredentials')}</Label>
              <Textarea
                rows={5}
                className="font-mono text-sm"
                placeholder='{"CF_DNS_API_TOKEN": "your-token"}'
                value={dnsProviderForm.credentials}
                onChange={(e) => setDnsProviderForm({ ...dnsProviderForm, credentials: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t('dnsProviderDialog.requiredFields', { fields: getSelectedDNSProviderFields().join(', ') })}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDNSProviderDialogOpen(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button onClick={handleDNSProviderSubmit} disabled={createDNSProviderMutation.isPending}>
              {createDNSProviderMutation.isPending ? t('dnsProviderDialog.adding') : t('actions.add', { ns: 'common' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteDialogCert} onOpenChange={() => setDeleteDialogCert(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              <span dangerouslySetInnerHTML={{ __html: t('deleteDialog.description', { domain: deleteDialogCert?.domain }) }} />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel', { ns: 'common' })}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteDialogCert && deleteMutation.mutate(deleteDialogCert.id)}
            >
              {t('actions.delete', { ns: 'common' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isEnableHTTPSDialogOpen} onOpenChange={setIsEnableHTTPSDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('https.enableTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('https.enableDesc', { domain: masterCertStatus?.domain })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel', { ns: 'common' })}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => enableHTTPS.mutate()}
              disabled={enableHTTPS.isPending}
            >
              {enableHTTPS.isPending ? t('https.configuring') : t('https.confirmEnable')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deploy Certificate Dialog */}
      <Dialog open={isDeployDialogOpen} onOpenChange={(open) => {
        setIsDeployDialogOpen(open)
        if (!open) setDeployTarget(null)
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('deployDialog.title')}</DialogTitle>
            <DialogDescription>
              <span dangerouslySetInnerHTML={{ __html: t('deployDialog.description', { domain: deployTarget?.domain }) }} />
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deploy_cert">{t('deployDialog.certFilePath')}</Label>
              <Input
                id="deploy_cert"
                value={deployForm.deploy_cert_path}
                onChange={(e) => setDeployForm({ ...deployForm, deploy_cert_path: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deploy_key">{t('deployDialog.keyFilePath')}</Label>
              <Input
                id="deploy_key"
                value={deployForm.deploy_key_path}
                onChange={(e) => setDeployForm({ ...deployForm, deploy_key_path: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeployDialogOpen(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button
              onClick={() => {
                if (!deployTarget) return
                deployMutation.mutate({
                  id: deployTarget.id,
                  deploy_target: 'both',
                  deploy_cert_path: deployForm.deploy_cert_path,
                  deploy_key_path: deployForm.deploy_key_path,
                })
              }}
              disabled={deployMutation.isPending}
            >
              {deployMutation.isPending ? t('deployDialog.deploying') : t('deployDialog.confirmDeploy')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Certificate Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={(open) => {
        setIsUploadDialogOpen(open)
        if (!open) setUploadForm({ domain: '', cert_pem: '', key_pem: '' })
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('uploadDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('uploadDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 p-3 text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium mb-1">{t('uploadDialog.apiUploadTitle')}</p>
              <p className="text-xs">
                {t('uploadDialog.apiUploadDesc')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload_domain">{t('uploadDialog.domain')}</Label>
              <Input
                id="upload_domain"
                placeholder="example.com / *.example.com"
                value={uploadForm.domain}
                onChange={(e) => setUploadForm({ ...uploadForm, domain: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload_cert">{t('uploadDialog.certContent')}</Label>
              <Textarea
                id="upload_cert"
                rows={6}
                className="font-mono text-xs"
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                value={uploadForm.cert_pem}
                onChange={(e) => setUploadForm({ ...uploadForm, cert_pem: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload_key">{t('uploadDialog.keyContent')}</Label>
              <Textarea
                id="upload_key"
                rows={6}
                className="font-mono text-xs"
                placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                value={uploadForm.key_pem}
                onChange={(e) => setUploadForm({ ...uploadForm, key_pem: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUploadDialogOpen(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button
              onClick={() => {
                if (!uploadForm.domain || !uploadForm.cert_pem || !uploadForm.key_pem) {
                  toast.error(t('toast.fillDomainCertKey'))
                  return
                }
                uploadMutation.mutate(uploadForm)
              }}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? t('uploadDialog.uploading') : t('uploadDialog.uploadCert')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
