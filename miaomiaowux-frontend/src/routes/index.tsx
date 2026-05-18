// @ts-nocheck
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  HardDrive,
  Maximize2,
  PieChart,
  QrCode,
  Server,
  TrendingUp,
  Users,
} from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { toast } from 'sonner'
import clashIcon from '@/assets/icons/clash_color.png'
import egernIcon from '@/assets/icons/egern_color.png'
import loonIcon from '@/assets/icons/loon_color.png'
import quanxIcon from '@/assets/icons/quanx_color.png'
import shadowrocketIcon from '@/assets/icons/shadowrocket_color.png'
import singboxIcon from '@/assets/icons/sing-box_color.png'
import stashIcon from '@/assets/icons/stash_color.png'
import surfboardIcon from '@/assets/icons/surfboard_color.png'
import surgeIcon from '@/assets/icons/surge_color.png'
import surgeMacIcon from '@/assets/icons/surgeformac_icon_color.png'
import uriIcon from '@/assets/icons/uri-color.svg'
import v2rayIcon from '@/assets/icons/v2ray_color.png'
import { Topbar } from '@/components/layout/topbar'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'

// @ts-ignore - retained simple route definition
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/login' })
    }
  },
  component: DashboardPage,
})

interface UserProfile {
  username: string
  email: string
  nickname: string
  avatar: string
  role: string
  is_admin: boolean
}

type NodeTrafficItem = {
  tag: string
  server_id: number
  server_name: string
  server_names: string[]
  display_name: string
  uplink: number
  downlink: number
  total_uplink: number
  total_downlink: number
  last_uplink: number
  last_downlink: number
  updated_at: string
}

type UserTrafficItem = {
  username: string
  cycle_uplink: number
  cycle_downlink: number
  total_uplink: number
  total_downlink: number
  last_uplink: number
  last_downlink: number
  updated_at: string
}

type DrilldownItem = {
  label: string
  uplink: number
  downlink: number
  last_uplink: number
  last_downlink: number
}

type SubscribeFile = {
  id: number
  name: string
  description: string
  type: string
  filename: string
  file_short_code?: string
  expire_at?: string | null
  created_at: string
  updated_at: string
  latest_version?: number
}

const CLIENT_TYPES = [
  { type: 'clash', name: 'Clash', icon: clashIcon },
  { type: 'stash', name: 'Stash', icon: stashIcon },
  { type: 'shadowrocket', name: 'Shadowrocket', icon: shadowrocketIcon },
  { type: 'surfboard', name: 'Surfboard', icon: surfboardIcon },
  { type: 'surge', name: 'Surge', icon: surgeIcon },
  { type: 'surgemac', name: 'Surge Mac', icon: surgeMacIcon },
  { type: 'clash-to-surge', name: 'Clash→Surge', icon: surgeIcon },
  { type: 'loon', name: 'Loon', icon: loonIcon },
  { type: 'qx', name: 'QuantumultX', icon: quanxIcon },
  { type: 'egern', name: 'Egern', icon: egernIcon },
  { type: 'sing-box', name: 'sing-box', icon: singboxIcon },
  { type: 'v2ray', name: 'V2Ray', icon: v2rayIcon },
  { type: 'uri', name: 'URI', icon: uriIcon },
] as const

const PAGE_SIZE = 20
const PREVIEW_COUNT = 5

function DashboardPage() {
  const { auth } = useAuthStore()

  const { data: profileData, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['user-profile'],
    queryFn: async () => {
      const response = await api.get('/api/user/profile')
      return response.data as UserProfile
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(auth.accessToken),
  })

  if (isLoadingProfile) {
    return (
      <div className="min-h-svh bg-background">
        <Topbar />
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 pt-24">
          <div className="flex items-center justify-center h-64">
            <Skeleton className="h-32 w-full max-w-3xl" />
          </div>
        </main>
      </div>
    )
  }

  const isAdmin = profileData?.is_admin ?? false
  return isAdmin ? <AdminDashboard /> : <UserDashboard />
}

function UserDashboard() {
  const { t } = useTranslation('dashboard')
  const { auth } = useAuthStore()

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 0 }),
    []
  )

  const { data, isLoading, isError } = useQuery({
    queryKey: ['traffic-summary'],
    queryFn: async () => {
      const response = await api.get('/api/traffic/summary')
      return response.data
    },
    staleTime: 5_000,
    refetchInterval: 5_000,
    enabled: Boolean(auth.accessToken),
  })

  const { data: subscribeFilesData } = useQuery({
    queryKey: ['user-subscriptions'],
    queryFn: async () => {
      const response = await api.get('/api/subscriptions')
      return response.data as { subscriptions: SubscribeFile[]; user_short_code: string }
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 60 * 1000,
  })

  const subscribeFiles = subscribeFilesData?.subscriptions ?? []
  const userShortCode = subscribeFilesData?.user_short_code ?? ''

  const { data: tokenData } = useQuery({
    queryKey: ['user-token'],
    queryFn: async () => {
      const response = await api.get('/api/user/token')
      return response.data as { token: string }
    },
    enabled: Boolean(auth.accessToken) && subscribeFilesData !== undefined && !userShortCode,
    staleTime: 5 * 60 * 1000,
  })

  const userToken = tokenData?.token ?? ''
  const [qrValue, setQrValue] = useState<string | null>(null)
  const [displayURLs, setDisplayURLs] = useState<Record<number, string>>({})

  const baseURL =
    api.defaults.baseURL ??
    (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : 'http://localhost:12889')

  const buildSubscriptionURL = (filename: string, fileShortCode: string | undefined, clientType?: string, fileType?: string) => {
    if (fileShortCode && userShortCode) {
      const url = new URL(`/x/${fileShortCode + userShortCode}`, baseURL)
      if (clientType) url.searchParams.set('t', clientType)
      return url.toString()
    }
    if (fileType === 'package') {
      const url = new URL('/api/user/package-subscribe', baseURL)
      if (clientType) url.searchParams.set('t', clientType)
      if (userToken) url.searchParams.set('token', userToken)
      return url.toString()
    }
    const url = new URL('/api/clash/subscribe', baseURL)
    url.searchParams.set('filename', filename)
    if (clientType) url.searchParams.set('t', clientType)
    if (userToken) url.searchParams.set('token', userToken)
    return url.toString()
  }

  const handleCopy = async (fileId: number, urlText: string, clientName: string) => {
    setDisplayURLs((prev) => ({ ...prev, [fileId]: urlText }))
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(urlText)
        toast.success(t('user.subscribe.linkCopied', { client: clientName }))
        return
      } catch (_) { /* fall through */ }
    }
    toast.error(t('user.subscribe.copyFailed'))
  }

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }),
    []
  )

  const metrics = useMemo(() => data?.metrics ?? {}, [data?.metrics])

  const cards = useMemo(() => [
    { title: t('user.stats.totalQuota'), description: t('user.stats.totalQuotaDesc'), value: formatMetric(metrics.total_limit_gb, numberFormatter), icon: TrendingUp },
    { title: t('user.stats.usedTraffic'), description: t('user.stats.usedTrafficDesc'), value: formatMetric(metrics.total_used_gb, numberFormatter), icon: Activity },
    { title: t('user.stats.remainingTraffic'), description: t('user.stats.remainingTrafficDesc'), value: formatMetric(metrics.total_remaining_gb, numberFormatter), icon: HardDrive },
    { title: t('user.stats.usageRate'), description: t('user.stats.usageRateDesc'), value: formatPercentage(metrics.usage_percentage, numberFormatter), progress: Number(metrics.usage_percentage ?? 0), icon: PieChart },
  ], [metrics, numberFormatter, t])

  const chartData = useMemo(() => {
    return (data?.history ?? []).map((item: any) => ({
      date: item.date,
      label: item.date.slice(5),
      used: Number(item.used_gb ?? 0),
    }))
  }, [data])

  const hasHistory = chartData.length > 0

  return (
    <div className="min-h-svh bg-background">
      <Topbar />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 pt-24">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {isLoading
            ? Array.from({ length: 4 }).map((_, index) => (
                <Card key={index}>
                  <CardHeader className="space-y-2">
                    <CardTitle className="flex flex-row items-center justify-between text-base">
                      <Skeleton className="h-5 w-24" />
                      <Skeleton className="h-10 w-10 rounded-full" />
                    </CardTitle>
                    <CardDescription><Skeleton className="h-4 w-32" /></CardDescription>
                  </CardHeader>
                  <CardContent><Skeleton className="h-9 w-28" /></CardContent>
                </Card>
              ))
            : cards.map(({ title, description, value, icon: Icon, progress }) => (
                <Card key={title}>
                  <CardHeader className="space-y-2">
                    <CardTitle className="flex flex-row items-center justify-between text-base">
                      {title}
                      <Icon className="size-8 text-primary" />
                    </CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-semibold">{value}</div>
                    {typeof progress === 'number' && !Number.isNaN(progress) ? (
                      <div className="mt-4 space-y-2">
                        <Progress value={Math.min(Math.max(progress, 0), 100)} max={100} />
                        <div className="text-xs text-muted-foreground">{t('user.stats.usedPercent', { percent: numberFormatter.format(progress) })}</div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
        </section>

        <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {subscribeFiles.length === 0 ? (
            <Card className="col-span-full border-dashed shadow-none">
              <CardHeader className="py-4">
                <CardTitle className="text-base">{t('user.subscribe.noSubscriptions')}</CardTitle>
                <CardDescription>{t('user.subscribe.noSubscriptionsDesc')}</CardDescription>
              </CardHeader>
            </Card>
          ) : subscribeFiles.map((file) => {
            const subscribeURL = buildSubscriptionURL(file.filename, file.file_short_code, undefined, file.type)
            const displayURL = displayURLs[file.id] || subscribeURL
            const clashURL = `clash://install-config?url=${encodeURIComponent(subscribeURL)}`
            return (
              <Card key={file.id} className="sm:col-span-2 lg:col-span-4">
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                  <button
                    onClick={() => setQrValue(displayURL)}
                    className="bg-primary/10 text-primary hover:bg-primary/20 flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-all hover:scale-110 active:scale-95"
                    title={t('user.subscribe.showQrCode')}
                  >
                    <QrCode className="size-5" />
                  </button>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold" title={file.name}>{file.name}</span>
                      {file.expire_at ? (
                        new Date(file.expire_at) < new Date()
                          ? <span className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold bg-destructive text-destructive-foreground">{t('user.subscribe.expired')}</span>
                          : <span className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold">{t('user.subscribe.expireAt', { date: dateFormatter.format(new Date(file.expire_at)) })}</span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{t('user.subscribe.permanent')}</span>
                      )}
                    </div>
                    <div className="bg-muted/40 rounded-md border px-2 py-1 font-mono text-xs break-all">{displayURL}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" className="transition-transform hover:-translate-y-0.5 hover:shadow-md active:translate-y-0.5 active:scale-95">
                          <Copy className="mr-1 size-3.5" />{t('user.subscribe.copy')}<ChevronDown className="ml-1 size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {CLIENT_TYPES.map((client) => {
                          const clientURL = buildSubscriptionURL(file.filename, file.file_short_code, client.type, file.type)
                          return (
                            <DropdownMenuItem key={client.type} onClick={() => handleCopy(file.id, clientURL, client.name)} className="cursor-pointer">
                              <img src={client.icon} alt={client.name} className="mr-2 size-4" />{client.name}
                            </DropdownMenuItem>
                          )
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button size="sm" variant="secondary" className="transition-transform hover:-translate-y-0.5 hover:shadow-md active:translate-y-0.5 active:scale-95" asChild>
                      <a href={clashURL}><Download className="mr-1 size-3.5" />{t('user.subscribe.import')}</a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </section>

        <TrafficChart isLoading={isLoading} isError={isError} hasHistory={hasHistory} chartData={chartData} numberFormatter={numberFormatter} />

        <Dialog open={Boolean(qrValue)} onOpenChange={(open) => { if (!open) setQrValue(null) }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('user.qrDialog.title')}</DialogTitle>
              <DialogDescription>{t('user.qrDialog.description')}</DialogDescription>
            </DialogHeader>
            {qrValue ? (
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-xl border bg-white p-4 shadow-inner">
                  <QRCodeCanvas value={qrValue} size={220} level="M" includeMargin />
                </div>
                <div className="text-muted-foreground text-center font-mono text-xs break-all">{qrValue}</div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  )
}

function TrafficChart({ isLoading, isError, hasHistory, chartData, numberFormatter }: {
  isLoading: boolean; isError: boolean; hasHistory: boolean; chartData: any[]; numberFormatter: Intl.NumberFormat
}) {
  const { t } = useTranslation('dashboard')
  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>{t('chart.title')}</CardTitle>
        <CardDescription>{t('chart.description')}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-80">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Skeleton className="h-32 w-full max-w-3xl" />
            </div>
          ) : !hasHistory ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {isError ? t('chart.loadFailed') : t('chart.noHistory')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ left: 16, right: 16, top: 24, bottom: 8 }}>
                <defs>
                  <linearGradient id="dailyUsageGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d97757" stopOpacity={0.7} />
                    <stop offset="100%" stopColor="#d97757" stopOpacity={0.2} />
                  </linearGradient>
                  <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#d97757" floodOpacity="0.3" />
                  </filter>
                </defs>
                <XAxis dataKey="label" tickLine={false} axisLine={false} className="fill-foreground" stroke="#a1a1aa" />
                <YAxis tickLine={false} axisLine={false} tickFormatter={(value: number) => `${numberFormatter.format(value)}`} className="fill-foreground" stroke="#a1a1aa" />
                <Tooltip
                  cursor={{ stroke: '#d97757', strokeWidth: 2 }}
                  labelFormatter={(label: string) => t('chart.tooltipDate', { date: chartData.find((item) => item.label === label)?.date ?? label })}
                  formatter={(value: number) => [`${numberFormatter.format(value)} GB`, t('chart.dailyUsage')]}
                  contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)' }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Area type="monotone" dataKey="used" stroke="#d97757" fill="url(#dailyUsageGradient)" strokeWidth={3} name={t('chart.dailyUsage')} filter="url(#shadow)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AdminDashboard() {
  const { t } = useTranslation('dashboard')
  const { auth } = useAuthStore()

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 0 }),
    []
  )

  const { data, isLoading, isError } = useQuery({
    queryKey: ['traffic-summary'],
    queryFn: async () => {
      const response = await api.get('/api/traffic/summary')
      return response.data
    },
    staleTime: 5_000,
    refetchInterval: 5_000,
    enabled: Boolean(auth.accessToken),
  })

  const { data: remoteServersData } = useQuery({
    queryKey: ['remote-servers-speed'],
    queryFn: async () => {
      const response = await api.get('/api/admin/remote-servers')
      return response.data as { success: boolean; servers: Array<{ name: string; current_upload_speed?: number; current_download_speed?: number; traffic_limit: number; traffic_used: number }> }
    },
    staleTime: 3000,
    refetchInterval: 3000,
    enabled: Boolean(auth.accessToken),
  })

  const { data: trafficData, isLoading: isTrafficLoading } = useQuery({
    queryKey: ['admin-traffic-overview'],
    queryFn: async () => {
      const response = await api.get('/api/admin/traffic')
      return response.data as {
        success: boolean
        servers: Array<{ server_id: number; server_name: string; inbounds: any[]; users: any[] }>
      }
    },
    staleTime: 10_000,
    refetchInterval: 5_000,
    enabled: Boolean(auth.accessToken),
  })

  const { data: nodesData } = useQuery({
    queryKey: ['nodes'],
    queryFn: async () => {
      const response = await api.get('/api/admin/nodes')
      return response.data as { nodes: Array<{ node_name: string; inbound_tag: string }> }
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(auth.accessToken),
  })

  const { data: usersData } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const response = await api.get('/api/admin/users')
      return response.data as { users: Array<{ username: string }> }
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(auth.accessToken),
  })

  const validUsernames = useMemo(() => {
    return new Set((usersData?.users ?? []).map(u => u.username))
  }, [usersData])

  const nodeNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of nodesData?.nodes ?? []) {
      if (node.inbound_tag) map.set(node.inbound_tag, node.node_name)
    }
    return map
  }, [nodesData])

  const [fullscreenView, setFullscreenView] = useState<'nodes' | 'users' | null>(null)
  const [fullscreenPage, setFullscreenPage] = useState(0)
  const [drilldown, setDrilldown] = useState<{ type: 'node' | 'user'; key: string; label?: string } | null>(null)
  const [drilldownPage, setDrilldownPage] = useState(0)
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month'>('month')

  const snapshotDate = useMemo(() => {
    if (timeRange === 'month') return ''
    const now = new Date()
    if (timeRange === 'today') return now.toISOString().slice(0, 10)
    const day = now.getDay()
    const diff = day === 0 ? 6 : day - 1
    const monday = new Date(now)
    monday.setDate(now.getDate() - diff)
    return monday.toISOString().slice(0, 10)
  }, [timeRange])

  const { data: snapshotData } = useQuery({
    queryKey: ['traffic-snapshots', snapshotDate],
    queryFn: async () => {
      const [nodeRes, userRes] = await Promise.all([
        api.get(`/api/admin/traffic/node-snapshots?date=${snapshotDate}`),
        api.get(`/api/admin/traffic/user-snapshots?date=${snapshotDate}`),
      ])
      return {
        nodeSnapshots: nodeRes.data.snapshots as Array<{ server_id: number; tag: string; uplink: number; downlink: number }>,
        userSnapshots: userRes.data.snapshots as Array<{ server_id: number; username: string; uplink: number; downlink: number }>,
      }
    },
    staleTime: 60_000,
    enabled: Boolean(auth.accessToken && snapshotDate),
  })

  const aggregatedSpeed = useMemo(() => {
    let totalUpload = 0
    let totalDownload = 0
    for (const server of remoteServersData?.servers ?? []) {
      totalUpload += server.current_upload_speed ?? 0
      totalDownload += server.current_download_speed ?? 0
    }
    return { upload: totalUpload, download: totalDownload }
  }, [remoteServersData])

  const serverOverviewList = useMemo(() => {
    const list: Array<{ name: string; upload: number; download: number; used: number; limit: number }> = []
    const trafficByServerName = new Map<string, { server_id: number; used: number }>()
    if (trafficData?.servers) {
      for (const server of trafficData.servers) {
        let used = 0
        for (const ib of server.inbounds ?? []) {
          used += (ib.uplink ?? 0) + (ib.downlink ?? 0)
        }
        trafficByServerName.set(server.server_name, { server_id: server.server_id, used })
      }
    }
    const snapshotByServerId = new Map<number, number>()
    if (timeRange !== 'month' && snapshotData?.nodeSnapshots) {
      for (const s of snapshotData.nodeSnapshots) {
        snapshotByServerId.set(s.server_id, (snapshotByServerId.get(s.server_id) ?? 0) + s.uplink + s.downlink)
      }
    }
    for (const s of remoteServersData?.servers ?? []) {
      const traffic = trafficByServerName.get(s.name)
      let used = traffic?.used ?? s.traffic_used ?? 0
      if (timeRange !== 'month' && traffic) {
        const snap = snapshotByServerId.get(traffic.server_id) ?? 0
        used = Math.max(0, used - snap)
      }
      list.push({ name: s.name, upload: s.current_upload_speed ?? 0, download: s.current_download_speed ?? 0, used, limit: s.traffic_limit ?? 0 })
    }
    return list
  }, [remoteServersData, trafficData, timeRange, snapshotData])

  const nodeTrafficList = useMemo<NodeTrafficItem[]>(() => {
    if (!nodesData?.nodes) return []
    const trafficByTag = new Map<string, { uplink: number; downlink: number; last_uplink: number; last_downlink: number; server_names: string[] }>()
    if (trafficData?.servers) {
      for (const server of trafficData.servers) {
        for (const ib of server.inbounds ?? []) {
          const existing = trafficByTag.get(ib.tag)
          if (existing) {
            existing.uplink += ib.uplink ?? 0
            existing.downlink += ib.downlink ?? 0
            existing.last_uplink += ib.last_uplink ?? 0
            existing.last_downlink += ib.last_downlink ?? 0
            if (!existing.server_names.includes(server.server_name)) existing.server_names.push(server.server_name)
          } else {
            trafficByTag.set(ib.tag, { uplink: ib.uplink ?? 0, downlink: ib.downlink ?? 0, last_uplink: ib.last_uplink ?? 0, last_downlink: ib.last_downlink ?? 0, server_names: [server.server_name] })
          }
        }
      }
    }
    const nodeSnapshotByTag = new Map<string, { uplink: number; downlink: number }>()
    if (timeRange !== 'month' && snapshotData?.nodeSnapshots) {
      for (const s of snapshotData.nodeSnapshots) {
        const existing = nodeSnapshotByTag.get(s.tag)
        if (existing) { existing.uplink += s.uplink; existing.downlink += s.downlink }
        else nodeSnapshotByTag.set(s.tag, { uplink: s.uplink, downlink: s.downlink })
      }
    }
    return nodesData.nodes.filter(n => n.inbound_tag).map(n => {
      const t = trafficByTag.get(n.inbound_tag)
      let uplink = t?.uplink ?? 0
      let downlink = t?.downlink ?? 0
      if (timeRange !== 'month') {
        const snap = nodeSnapshotByTag.get(n.inbound_tag)
        if (snap) { uplink = Math.max(0, uplink - snap.uplink); downlink = Math.max(0, downlink - snap.downlink) }
      }
      return { tag: n.inbound_tag, server_id: 0, server_name: '', server_names: t?.server_names ?? [], display_name: n.node_name, uplink, downlink, total_uplink: 0, total_downlink: 0, last_uplink: t?.last_uplink ?? 0, last_downlink: t?.last_downlink ?? 0, updated_at: '' }
    }).sort((a, b) => (b.uplink + b.downlink) - (a.uplink + a.downlink))
  }, [nodesData, trafficData, timeRange, snapshotData])

  const userTrafficList = useMemo<UserTrafficItem[]>(() => {
    if (!trafficData?.servers) return []
    const map = new Map<string, UserTrafficItem>()
    for (const server of trafficData.servers) {
      for (const u of server.users ?? []) {
        if (validUsernames.size > 0 && !validUsernames.has(u.username)) continue
        const existing = map.get(u.username)
        if (existing) {
          existing.cycle_uplink += u.uplink ?? 0; existing.cycle_downlink += u.downlink ?? 0
          existing.last_uplink += u.last_uplink ?? 0; existing.last_downlink += u.last_downlink ?? 0
        } else {
          map.set(u.username, { username: u.username, cycle_uplink: u.uplink ?? 0, cycle_downlink: u.downlink ?? 0, total_uplink: (u.total_uplink ?? 0) + (u.uplink ?? 0), total_downlink: (u.total_downlink ?? 0) + (u.downlink ?? 0), last_uplink: u.last_uplink ?? 0, last_downlink: u.last_downlink ?? 0, updated_at: u.updated_at ?? '' })
        }
      }
    }
    if (timeRange !== 'month' && snapshotData?.userSnapshots) {
      const snapByUser = new Map<string, { uplink: number; downlink: number }>()
      for (const s of snapshotData.userSnapshots) {
        const existing = snapByUser.get(s.username)
        if (existing) { existing.uplink += s.uplink; existing.downlink += s.downlink }
        else snapByUser.set(s.username, { uplink: s.uplink, downlink: s.downlink })
      }
      for (const item of map.values()) {
        const snap = snapByUser.get(item.username)
        if (snap) { item.cycle_uplink = Math.max(0, item.cycle_uplink - snap.uplink); item.cycle_downlink = Math.max(0, item.cycle_downlink - snap.downlink) }
      }
    }
    return [...map.values()].sort((a, b) => (b.cycle_uplink + b.cycle_downlink) - (a.cycle_uplink + a.cycle_downlink))
  }, [trafficData, validUsernames, timeRange, snapshotData])

  const drilldownData = useMemo<DrilldownItem[]>(() => {
    if (!drilldown || !trafficData?.servers) return []
    if (drilldown.type === 'node') {
      const userMap = new Map<string, DrilldownItem>()
      for (const server of trafficData.servers) {
        const hasTag = (server.inbounds ?? []).some((ib: any) => ib.tag === drilldown.key)
        if (!hasTag) continue
        for (const u of server.users ?? []) {
          const existing = userMap.get(u.username)
          if (existing) { existing.uplink += u.uplink ?? 0; existing.downlink += u.downlink ?? 0; existing.last_uplink += u.last_uplink ?? 0; existing.last_downlink += u.last_downlink ?? 0 }
          else userMap.set(u.username, { label: u.username, uplink: u.uplink ?? 0, downlink: u.downlink ?? 0, last_uplink: u.last_uplink ?? 0, last_downlink: u.last_downlink ?? 0 })
        }
      }
      return [...userMap.values()].sort((a, b) => (b.uplink + b.downlink) - (a.uplink + a.downlink))
    } else {
      const items: DrilldownItem[] = []
      for (const server of trafficData.servers) {
        const hasUser = (server.users ?? []).some((u: any) => u.username === drilldown.key)
        if (hasUser) {
          for (const ib of server.inbounds ?? []) {
            if (!nodeNameMap.has(ib.tag)) continue
            items.push({ label: nodeNameMap.get(ib.tag)!, uplink: ib.uplink ?? 0, downlink: ib.downlink ?? 0, last_uplink: ib.last_uplink ?? 0, last_downlink: ib.last_downlink ?? 0 })
          }
        }
      }
      return items.sort((a, b) => (b.uplink + b.downlink) - (a.uplink + a.downlink))
    }
  }, [drilldown, trafficData, nodeNameMap])

  const metrics = useMemo(() => data?.metrics ?? {}, [data?.metrics])

  const cards = useMemo(() => [
    { title: t('admin.stats.totalQuota'), description: t('admin.stats.totalQuotaDesc'), value: formatMetric(metrics.total_limit_gb, numberFormatter), icon: TrendingUp },
    { title: t('admin.stats.usedTraffic'), description: t('admin.stats.usedTrafficDesc'), value: formatMetric(metrics.total_used_gb, numberFormatter), icon: Activity },
    { title: t('admin.stats.remainingTraffic'), description: t('admin.stats.remainingTrafficDesc'), value: formatMetric(metrics.total_remaining_gb, numberFormatter), icon: HardDrive },
    { title: t('admin.stats.realtimeSpeed'), description: t('admin.stats.realtimeSpeedDesc'), value: '', speedData: { upload: aggregatedSpeed.upload, download: aggregatedSpeed.download }, icon: Activity },
  ], [metrics, numberFormatter, aggregatedSpeed, t])

  const chartData = useMemo(() => {
    return (data?.history ?? []).map((item: any) => ({ date: item.date, label: item.date.slice(5), used: Number(item.used_gb ?? 0) }))
  }, [data])

  const hasHistory = chartData.length > 0

  return (
    <div className="min-h-svh bg-background">
      <Topbar />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 pt-24">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {isLoading
            ? Array.from({ length: 4 }).map((_, index) => (
                <Card key={index}>
                  <CardHeader className="space-y-2">
                    <CardTitle className="flex flex-row items-center justify-between text-base"><Skeleton className="h-5 w-24" /><Skeleton className="h-10 w-10 rounded-full" /></CardTitle>
                    <CardDescription><Skeleton className="h-4 w-32" /></CardDescription>
                  </CardHeader>
                  <CardContent><Skeleton className="h-9 w-28" /></CardContent>
                </Card>
              ))
            : cards.map(({ title, description, value, icon: Icon, speedData }) => (
                <Card key={title}>
                  <CardHeader className="space-y-2">
                    <CardTitle className="flex flex-row items-center justify-between text-base">{title}<Icon className="size-8 text-primary" /></CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {speedData ? (
                      <div className="flex justify-between text-2xl font-semibold">
                        <span>↑ {formatSpeed(speedData.upload)}</span>
                        <span>↓ {formatSpeed(speedData.download)}</span>
                      </div>
                    ) : (
                      <div className="text-3xl font-semibold">{value}</div>
                    )}
                  </CardContent>
                </Card>
              ))}
        </section>

        <TrafficChart isLoading={isLoading} isError={isError} hasHistory={hasHistory} chartData={chartData} numberFormatter={numberFormatter} />

        <div className="flex items-center gap-2 mt-4 mb-2">
          {(['today', 'week', 'month'] as const).map((range) => (
            <Button key={range} variant={timeRange === range ? 'default' : 'outline'} size="sm" onClick={() => setTimeRange(range)}>
              {range === 'today' ? t('admin.timeRange.today') : range === 'week' ? t('admin.timeRange.week') : t('admin.timeRange.month')}
            </Button>
          ))}
        </div>
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><Server className="size-4" />{t('admin.nodeView.title')}</CardTitle>
                <CardDescription>{t('admin.nodeView.sortDesc')}</CardDescription>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setFullscreenView('nodes'); setFullscreenPage(0) }}><Maximize2 className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent>
              {isTrafficLoading ? (
                <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : nodeTrafficList.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">{t('admin.nodeView.noData')}</div>
              ) : (
                <div className="space-y-1">
                  {nodeTrafficList.slice(0, PREVIEW_COUNT).map((node) => (
                    <div key={node.tag} className="flex items-center justify-between rounded-md px-3 py-2 text-sm cursor-pointer transition hover:bg-muted"
                      onClick={() => { setDrilldown({ type: 'node', key: node.tag, label: node.display_name }); setDrilldownPage(0) }}>
                      <div className="truncate flex-1 min-w-0 mr-3 font-medium" title={`${node.display_name}\n${t('admin.nodeView.serverTooltip', { servers: node.server_names.join(', ') })}`}>{node.display_name}</div>
                      <div className="shrink-0 text-muted-foreground text-xs">↑{formatBytes(node.uplink)} ↓{formatBytes(node.downlink)}</div>
                    </div>
                  ))}
                  {nodeTrafficList.length > PREVIEW_COUNT && <div className="text-xs text-muted-foreground text-center pt-2">{t('admin.nodeView.totalNodes', { count: nodeTrafficList.length })}</div>}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><Users className="size-4" />{t('admin.userView.title')}</CardTitle>
                <CardDescription>{t('admin.userView.sortDesc')}</CardDescription>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setFullscreenView('users'); setFullscreenPage(0) }}><Maximize2 className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent>
              {isTrafficLoading ? (
                <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : userTrafficList.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">{t('admin.userView.noData')}</div>
              ) : (
                <div className="space-y-1">
                  {userTrafficList.slice(0, PREVIEW_COUNT).map((user) => {
                    const upSpeed = estimateSpeed(user.cycle_uplink, user.last_uplink)
                    const downSpeed = estimateSpeed(user.cycle_downlink, user.last_downlink)
                    return (
                      <div key={user.username} className="flex items-center justify-between rounded-md px-3 py-2 text-sm cursor-pointer transition hover:bg-muted"
                        onClick={() => { setDrilldown({ type: 'user', key: user.username }); setDrilldownPage(0) }}>
                        <div className="truncate flex-1 min-w-0 mr-3 font-medium">{user.username}</div>
                        <div className="flex items-center gap-3 shrink-0 text-muted-foreground text-xs">
                          <span>↑{formatBytes(user.cycle_uplink)} ↓{formatBytes(user.cycle_downlink)}</span>
                          {(upSpeed > 0 || downSpeed > 0) && <span className="text-primary">↑{formatSpeed(upSpeed)} ↓{formatSpeed(downSpeed)}</span>}
                        </div>
                      </div>
                    )
                  })}
                  {userTrafficList.length > PREVIEW_COUNT && <div className="text-xs text-muted-foreground text-center pt-2">{t('admin.userView.totalUsers', { count: userTrafficList.length })}</div>}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Server className="size-4" />{t('admin.serverOverview.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {serverOverviewList.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">{t('admin.serverOverview.noServers')}</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.serverOverview.columns.server')}</TableHead>
                    <TableHead>{t('admin.serverOverview.columns.speed')}</TableHead>
                    <TableHead className="text-right">{t('admin.serverOverview.columns.used')}</TableHead>
                    <TableHead className="text-right">{t('admin.serverOverview.columns.total')}</TableHead>
                    <TableHead className="text-right">{t('admin.serverOverview.columns.remaining')}</TableHead>
                    <TableHead className="text-right">{t('admin.serverOverview.columns.usageRate')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {serverOverviewList.map((s) => {
                    const remaining = s.limit > 0 ? s.limit - s.used : -1
                    const pct = s.limit > 0 ? (s.used / s.limit) * 100 : -1
                    return (
                      <TableRow key={s.name}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">↑{formatSpeed(s.upload)} ↓{formatSpeed(s.download)}</TableCell>
                        <TableCell className="text-right">{formatBytes(s.used)}</TableCell>
                        <TableCell className="text-right">{s.limit > 0 ? formatBytes(s.limit) : t('admin.serverOverview.unlimited')}</TableCell>
                        <TableCell className="text-right">{remaining >= 0 ? formatBytes(remaining) : '--'}</TableCell>
                        <TableCell className="text-right">{pct >= 0 ? `${pct.toFixed(1)}%` : '--'}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={fullscreenView !== null} onOpenChange={(open) => !open && setFullscreenView(null)}>
          <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {fullscreenView === 'nodes' ? <><Server className="size-4" /> {t('admin.dialog.nodeTraffic')}</> : <><Users className="size-4" /> {t('admin.dialog.userTraffic')}</>}
              </DialogTitle>
            </DialogHeader>
            {fullscreenView === 'nodes' ? (
              <FullscreenNodeList items={nodeTrafficList} page={fullscreenPage} onPageChange={setFullscreenPage}
                onDrilldown={(key, label) => { setDrilldown({ type: 'node', key, label }); setDrilldownPage(0) }} />
            ) : fullscreenView === 'users' ? (
              <FullscreenUserList items={userTrafficList} page={fullscreenPage} onPageChange={setFullscreenPage}
                onDrilldown={(key) => { setDrilldown({ type: 'user', key }); setDrilldownPage(0) }} />
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog open={drilldown !== null} onOpenChange={(open) => !open && setDrilldown(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {drilldown?.type === 'node' ? t('admin.dialog.nodeUserTraffic', { name: drilldown.label ?? drilldown.key }) : drilldown?.type === 'user' ? t('admin.dialog.userNodeTraffic', { name: drilldown.key }) : ''}
              </DialogTitle>
            </DialogHeader>
            <DrilldownList items={drilldownData} page={drilldownPage} onPageChange={setDrilldownPage} />
          </DialogContent>
        </Dialog>
      </main>
    </div>
  )
}

function PaginationControls({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  const { t } = useTranslation('dashboard')
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 pt-4">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPageChange(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
      <span className="text-sm text-muted-foreground">{t('pagination.page', { current: page + 1, total: totalPages })}</span>
      <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
    </div>
  )
}

function TrafficRow({ label, tooltip, uplink, downlink, lastUplink, lastDownlink, showSpeed = true, onClick }: {
  label: string; tooltip?: string; uplink: number; downlink: number; lastUplink: number; lastDownlink: number; showSpeed?: boolean; onClick?: () => void
}) {
  const upSpeed = showSpeed ? estimateSpeed(uplink, lastUplink) : 0
  const downSpeed = showSpeed ? estimateSpeed(downlink, lastDownlink) : 0
  return (
    <div className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition hover:bg-muted ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
      <div className="truncate flex-1 min-w-0 mr-3 font-medium" title={tooltip ?? label}>{label}</div>
      <div className="flex items-center gap-3 shrink-0 text-muted-foreground text-xs">
        <span>↑{formatBytes(uplink)} ↓{formatBytes(downlink)}</span>
        {(upSpeed > 0 || downSpeed > 0) && <span className="text-primary">↑{formatSpeed(upSpeed)} ↓{formatSpeed(downSpeed)}</span>}
      </div>
    </div>
  )
}

function FullscreenNodeList({ items, page, onPageChange, onDrilldown }: {
  items: NodeTrafficItem[]; page: number; onPageChange: (p: number) => void; onDrilldown: (key: string, label: string) => void
}) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const paged = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const { t } = useTranslation('dashboard')
  if (items.length === 0) return <div className="text-sm text-muted-foreground text-center py-6">{t('admin.nodeView.noData')}</div>
  return (
    <div>
      <div className="space-y-1">
        {paged.map((node) => (
          <TrafficRow key={node.tag} label={node.display_name} tooltip={`${node.display_name}\n${t('admin.nodeView.serverTooltip', { servers: node.server_names.join(', ') })}`}
            uplink={node.uplink} downlink={node.downlink} lastUplink={node.last_uplink} lastDownlink={node.last_downlink} showSpeed={false}
            onClick={() => onDrilldown(node.tag, node.display_name)} />
        ))}
      </div>
      <PaginationControls page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  )
}

function FullscreenUserList({ items, page, onPageChange, onDrilldown }: {
  items: UserTrafficItem[]; page: number; onPageChange: (p: number) => void; onDrilldown: (key: string) => void
}) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const paged = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const { t } = useTranslation('dashboard')
  if (items.length === 0) return <div className="text-sm text-muted-foreground text-center py-6">{t('admin.userView.noData')}</div>
  return (
    <div>
      <div className="space-y-1">
        {paged.map((user) => (
          <TrafficRow key={user.username} label={user.username} uplink={user.cycle_uplink} downlink={user.cycle_downlink}
            lastUplink={user.last_uplink} lastDownlink={user.last_downlink} onClick={() => onDrilldown(user.username)} />
        ))}
      </div>
      <PaginationControls page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  )
}

function DrilldownList({ items, page, onPageChange }: { items: DrilldownItem[]; page: number; onPageChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const paged = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const { t } = useTranslation('dashboard')
  if (items.length === 0) return <div className="text-sm text-muted-foreground text-center py-6">{t('admin.nodeView.noData')}</div>
  return (
    <div>
      <div className="space-y-1">
        {paged.map((item) => (
          <TrafficRow key={item.label} label={item.label} uplink={item.uplink} downlink={item.downlink} lastUplink={item.last_uplink} lastDownlink={item.last_downlink} />
        ))}
      </div>
      <PaginationControls page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  )
}

function formatMetric(value: number | undefined, formatter: Intl.NumberFormat) {
  if (value === undefined || value === null) return '--'
  let unit = 'GB'
  let displayValue = value
  if (value >= 1024) { displayValue = value / 1024; unit = 'TB' }
  return `${formatter.format(displayValue)} ${unit}`
}

function formatPercentage(value: number | undefined, formatter: Intl.NumberFormat) {
  if (value === undefined || value === null) return '--'
  return `${formatter.format(value)} %`
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0 || bytesPerSec === undefined) return '0 B/s'
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${Math.round(bytesPerSec / 1024)} K/s`
  if (bytesPerSec < 1024 * 1024 * 1024) return `${Math.round(bytesPerSec / 1024 / 1024)} M/s`
  return `${Math.round(bytesPerSec / 1024 / 1024 / 1024)} G/s`
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes < 1024 ** 4) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(bytes / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`
}

function estimateSpeed(current: number, last: number): number {
  const delta = current - last
  return delta > 0 ? delta / 5 : 0
}
