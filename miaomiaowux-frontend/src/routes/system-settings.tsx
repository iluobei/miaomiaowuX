import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Copy, Eye, EyeOff, Link, RefreshCw, Timer } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/system-settings')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: SystemSettingsPage,
})

function SystemSettingsPage() {
  const queryClient = useQueryClient()
  const { auth } = useAuthStore()
  const [forceSyncExternal, setForceSyncExternal] = useState(false)
  const [matchRule, setMatchRule] = useState<'node_name' | 'server_port' | 'type_server_port'>('node_name')
  const [syncScope, setSyncScope] = useState<'saved_only' | 'all'>('saved_only')
  const [keepNodeName, setKeepNodeName] = useState(true)
  const [cacheExpireMinutes, setCacheExpireMinutes] = useState(0)
  const [syncTraffic, setSyncTraffic] = useState(false)
  const [_customRulesEnabled, _setCustomRulesEnabled] = useState(false)
  const [showApiToken, setShowApiToken] = useState(false)
  const [masterUrl, setMasterUrl] = useState('')

  // Master URL query
  const { data: masterUrlData } = useQuery({
    queryKey: ['master-url'],
    queryFn: async () => {
      const response = await api.get('/api/admin/system-settings/master-url')
      return response.data as { success: boolean; master_url: string }
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (masterUrlData?.master_url !== undefined) {
      setMasterUrl(masterUrlData.master_url)
    }
  }, [masterUrlData])

  const updateMasterUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      await api.put('/api/admin/system-settings/master-url', { master_url: url })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-url'] })
      toast.success('主服务器地址已更新')
    },
    onError: handleServerError,
  })

  // API Token query
  const { data: apiTokenData, isLoading: loadingApiToken } = useQuery({
    queryKey: ['api-token'],
    queryFn: async () => {
      const response = await api.get('/api/admin/system-settings/api-token')
      return response.data as { success: boolean; token: string }
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  // Regenerate API Token mutation
  const regenerateApiTokenMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/api/admin/system-settings/api-token/regenerate')
      return response.data as { success: boolean; token: string; message: string }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-token'] })
      toast.success('API Token 已重新生成')
    },
    onError: handleServerError,
  })

  const copyApiToken = () => {
    if (apiTokenData?.token) {
      navigator.clipboard.writeText(apiTokenData.token)
      toast.success('API Token 已复制到剪贴板')
    }
  }
  // 短链接全局开关（系统级设置）
  const { data: shortLinkData } = useQuery({
    queryKey: ['short-link-enabled'],
    queryFn: async () => {
      const response = await api.get('/api/admin/system-settings/short-link')
      return response.data as { success: boolean; enable_short_link: boolean }
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const toggleShortLinkMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await api.put('/api/admin/system-settings/short-link', { enable_short_link: enabled })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['short-link-enabled'] })
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions'] })
      toast.success('短链接设置已更新')
    },
    onError: handleServerError,
  })

  useEffect(() => {
    if (shortLinkData?.enable_short_link !== undefined) {
      setEnableShortLink(shortLinkData.enable_short_link)
    }
  }, [shortLinkData])

  const [enableShortLink, setEnableShortLink] = useState(true)
  const [useNewTemplateSystem, setUseNewTemplateSystem] = useState(true)

  // 定时配置
  const [speedCollectInterval, setSpeedCollectInterval] = useState(3)
  const [trafficCollectInterval, setTrafficCollectInterval] = useState(60)
  const [trafficCheckInterval, setTrafficCheckInterval] = useState(120)
  const [heartbeatInterval, setHeartbeatInterval] = useState(30)

  const { data: intervalsData } = useQuery({
    queryKey: ['system-intervals'],
    queryFn: async () => {
      const response = await api.get('/api/admin/system-settings/intervals')
      return response.data as {
        success: boolean
        speed_collect_interval: number
        traffic_collect_interval: number
        traffic_check_interval: number
        heartbeat_interval: number
      }
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (intervalsData) {
      setSpeedCollectInterval(intervalsData.speed_collect_interval)
      setTrafficCollectInterval(intervalsData.traffic_collect_interval)
      setTrafficCheckInterval(intervalsData.traffic_check_interval)
      setHeartbeatInterval(intervalsData.heartbeat_interval)
    }
  }, [intervalsData])

  const updateIntervalsMutation = useMutation({
    mutationFn: async (data: {
      speed_collect_interval: number
      traffic_collect_interval: number
      traffic_check_interval: number
      heartbeat_interval: number
    }) => {
      await api.put('/api/admin/system-settings/intervals', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-intervals'] })
      toast.success('定时配置已更新，重启服务后生效')
    },
    onError: handleServerError,
  })
  const [enableProxyProvider, setEnableProxyProvider] = useState(false)
  const [proxyGroupsSourceUrl, setProxyGroupsSourceUrl] = useState('')
  const [clientCompatibilityMode, setClientCompatibilityMode] = useState(false)

  const { data: userConfig, isLoading: _loadingConfig } = useQuery({
    queryKey: ['user-config'],
    queryFn: async () => {
      const response = await api.get('/api/user/config')
      return response.data as {
        force_sync_external: boolean
        match_rule: string
        sync_scope: string
        keep_node_name: boolean
        cache_expire_minutes: number
        sync_traffic: boolean
        enable_short_link: boolean
        use_new_template_system: boolean
        enable_proxy_provider: boolean
        proxy_groups_source_url: string
        client_compatibility_mode: boolean
      }
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (userConfig) {
      setForceSyncExternal(userConfig.force_sync_external)
      setMatchRule(userConfig.match_rule as 'node_name' | 'server_port' | 'type_server_port')
      setSyncScope((userConfig.sync_scope as 'saved_only' | 'all') || 'saved_only')
      setKeepNodeName(userConfig.keep_node_name !== false) // 默认为 true
      setCacheExpireMinutes(userConfig.cache_expire_minutes)
      setSyncTraffic(userConfig.sync_traffic)
      setEnableShortLink(userConfig.enable_short_link || false)
      setUseNewTemplateSystem(userConfig.use_new_template_system !== false) // 默认为 true
      setEnableProxyProvider(userConfig.enable_proxy_provider || false)
      setProxyGroupsSourceUrl(userConfig.proxy_groups_source_url || '')
      setClientCompatibilityMode(userConfig.client_compatibility_mode || false)
    }
  }, [userConfig])

  const updateConfigMutation = useMutation({
    mutationFn: async (data: {
      force_sync_external: boolean
      match_rule: string
      sync_scope: string
      keep_node_name: boolean
      cache_expire_minutes: number
      sync_traffic: boolean
      enable_short_link: boolean
      use_new_template_system: boolean
      enable_proxy_provider: boolean
      proxy_groups_source_url: string
      client_compatibility_mode: boolean
    }) => {
      await api.put('/api/user/config', data)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['user-config'] })
      // 当短链接开关状态改变时，刷新订阅列表以更新链接显示
      if (variables.enable_short_link !== enableShortLink) {
        queryClient.invalidateQueries({ queryKey: ['user-subscriptions'] })
      }
      setForceSyncExternal(variables.force_sync_external)
      setMatchRule(variables.match_rule as 'node_name' | 'server_port' | 'type_server_port')
      setSyncScope(variables.sync_scope as 'saved_only' | 'all')
      setKeepNodeName(variables.keep_node_name)
      setCacheExpireMinutes(variables.cache_expire_minutes)
      setSyncTraffic(variables.sync_traffic)
      setEnableShortLink(variables.enable_short_link)
      setUseNewTemplateSystem(variables.use_new_template_system)
      setEnableProxyProvider(variables.enable_proxy_provider)
      setProxyGroupsSourceUrl(variables.proxy_groups_source_url || '')
      setClientCompatibilityMode(variables.client_compatibility_mode)
      toast.success('设置已更新')
    },
    onError: (error) => {
      handleServerError(error)
      toast.error('更新设置失败')
    },
  })

  // 通用的更新配置方法
  // @ts-ignore - temporarily unused while cards are commented out
  const updateConfig = (updates: Partial<{
    force_sync_external: boolean
    match_rule: string
    sync_scope: string
    keep_node_name: boolean
    cache_expire_minutes: number
    sync_traffic: boolean
    enable_short_link: boolean
    use_new_template_system: boolean
    enable_proxy_provider: boolean
    proxy_groups_source_url: string
    client_compatibility_mode: boolean
  }>) => {
    updateConfigMutation.mutate({
      force_sync_external: forceSyncExternal,
      match_rule: matchRule,
      sync_scope: syncScope,
      keep_node_name: keepNodeName,
      cache_expire_minutes: cacheExpireMinutes,
      sync_traffic: syncTraffic,
      enable_short_link: enableShortLink,
      use_new_template_system: useNewTemplateSystem,
      enable_proxy_provider: enableProxyProvider,
      proxy_groups_source_url: proxyGroupsSourceUrl,
      client_compatibility_mode: clientCompatibilityMode,
      ...updates,
    })
  }

  return (
    <div className='min-h-svh bg-background'>
      <Topbar />
      <main className='mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 pt-24'>
        <section className='space-y-2'>
          <h1 className='text-3xl font-semibold tracking-tight'>系统设置</h1>
          <p className='text-muted-foreground'>管理订阅同步和功能开关</p>
        </section>

        <div className='mt-8 space-y-6'>
          {/* 外部订阅同步设置 - 暂时隐藏
          <Card>
            <CardHeader className='pb-4'>
              <CardTitle>外部订阅同步设置</CardTitle>
              <CardDescription>配置外部订阅的同步行为</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              ...
            </CardContent>
          </Card>
          */}

          {/* 功能开关 - 暂时隐藏
          <Card>
            <CardHeader className='pb-4'>
              <CardTitle>功能开关</CardTitle>
              <CardDescription>管理系统功能的启用状态</CardDescription>
            </CardHeader>
            <CardContent className='space-y-0'>
              ...
            </CardContent>
          </Card>
          */}

          {/* 代理组配置同步 - 暂时隐藏
          <Card>
            <CardHeader className='pb-4'>
              <CardTitle>代理组配置同步</CardTitle>
              <CardDescription>从远程同步最新的预设代理组配置</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              ...
            </CardContent>
          </Card>
          */}

          {/* 短链接全局开关 */}
          <Card>
            <CardHeader className='pb-4'>
              <CardTitle className='flex items-center gap-2'>
                <Link className='h-5 w-5' />
                短链接
              </CardTitle>
              <CardDescription>开启后，订阅链接将使用短码格式，隐藏 token 信息</CardDescription>
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-between'>
                <Label htmlFor='short-link-toggle'>启用短链接</Label>
                <Switch
                  id='short-link-toggle'
                  checked={enableShortLink}
                  onCheckedChange={(checked) => {
                    setEnableShortLink(checked)
                    toggleShortLinkMutation.mutate(checked)
                  }}
                  disabled={toggleShortLinkMutation.isPending}
                />
              </div>
            </CardContent>
          </Card>

          {/* 定时配置 */}
          <Card>
            <CardHeader className='pb-4'>
              <CardTitle className='flex items-center gap-2'>
                <Timer className='h-5 w-5' />
                定时配置
              </CardTitle>
              <CardDescription>配置各项定时任务的执行间隔，修改后需重启服务生效</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid grid-cols-2 gap-4'>
                <div className='space-y-2'>
                  <Label htmlFor='speed-interval'>网速采集间隔（秒）</Label>
                  <Input
                    id='speed-interval'
                    type='number'
                    min={1}
                    value={speedCollectInterval}
                    onChange={(e) => setSpeedCollectInterval(Number(e.target.value))}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='traffic-interval'>流量采集间隔（秒）</Label>
                  <Input
                    id='traffic-interval'
                    type='number'
                    min={10}
                    value={trafficCollectInterval}
                    onChange={(e) => setTrafficCollectInterval(Number(e.target.value))}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='check-interval'>流量限额检查间隔（秒）</Label>
                  <Input
                    id='check-interval'
                    type='number'
                    min={10}
                    value={trafficCheckInterval}
                    onChange={(e) => setTrafficCheckInterval(Number(e.target.value))}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='heartbeat-interval'>心跳间隔（秒）</Label>
                  <Input
                    id='heartbeat-interval'
                    type='number'
                    min={5}
                    value={heartbeatInterval}
                    onChange={(e) => setHeartbeatInterval(Number(e.target.value))}
                  />
                </div>
              </div>
              <Button
                onClick={() => updateIntervalsMutation.mutate({
                  speed_collect_interval: speedCollectInterval,
                  traffic_collect_interval: trafficCollectInterval,
                  traffic_check_interval: trafficCheckInterval,
                  heartbeat_interval: heartbeatInterval,
                })}
                disabled={updateIntervalsMutation.isPending}
              >
                保存
              </Button>
            </CardContent>
          </Card>

          {/* 主服务器地址 */}
          <Card>
            <CardHeader className='pb-4'>
              <CardTitle>主服务器地址</CardTitle>
              <CardDescription>设置后，添加远程服务器时生成的安装命令将使用此地址</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='master-url'>服务器地址</Label>
                <Input
                  id='master-url'
                  placeholder='https://example.com 或 http://1.2.3.4:12889'
                  value={masterUrl}
                  onChange={(e) => setMasterUrl(e.target.value)}
                  onBlur={() => {
                    const trimmed = masterUrl.trim().replace(/\/+$/, '')
                    setMasterUrl(trimmed)
                    if (trimmed !== (masterUrlData?.master_url || '')) {
                      updateMasterUrlMutation.mutate(trimmed)
                    }
                  }}
                  disabled={updateMasterUrlMutation.isPending}
                />
                <p className='text-xs text-muted-foreground'>
                  格式：协议 + 域名或 IP（含端口），例如 https://panel.example.com 或 http://1.2.3.4:12889。留空则自动使用当前访问地址。
                </p>
              </div>
            </CardContent>
          </Card>

          {/* API Token 设置 */}
          <Card>
            <CardHeader>
              <CardTitle>API Token</CardTitle>
              <CardDescription>用于无需登录直接访问所有后台 API 接口</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <Label>当前 API Token</Label>
                <div className='flex items-center gap-2'>
                  <div className='flex-1 relative'>
                    <Input
                      type={showApiToken ? 'text' : 'password'}
                      value={loadingApiToken ? '加载中...' : (apiTokenData?.token || '')}
                      readOnly
                      className='pr-10 font-mono text-sm'
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='absolute right-0 top-0 h-full px-3 hover:bg-transparent'
                      onClick={() => setShowApiToken(!showApiToken)}
                    >
                      {showApiToken ? (
                        <EyeOff className='h-4 w-4 text-muted-foreground' />
                      ) : (
                        <Eye className='h-4 w-4 text-muted-foreground' />
                      )}
                    </Button>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    onClick={copyApiToken}
                    disabled={loadingApiToken || !apiTokenData?.token}
                  >
                    <Copy className='h-4 w-4' />
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    onClick={() => {
                      if (confirm('确定要重新生成 API Token 吗？旧的 Token 将失效。')) {
                        regenerateApiTokenMutation.mutate()
                      }
                    }}
                    disabled={loadingApiToken || regenerateApiTokenMutation.isPending}
                  >
                    <RefreshCw className={`h-4 w-4 ${regenerateApiTokenMutation.isPending ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
                <p className='text-sm text-muted-foreground'>
                  使用此 Token 在请求头 <code className='bg-muted px-1 py-0.5 rounded'>MM-Authorization</code> 中访问 API
                </p>
              </div>
              <div className='rounded-lg border bg-muted/40 p-4'>
                <p className='text-sm text-muted-foreground'>
                  • 携带此 Token 可以不需要登录直接访问所有后台 API
                  <br />
                  • 请妥善保管此 Token，泄露可能导致数据安全问题
                  <br />
                  • 服务启动时会在日志中打印此 Token
                  <br />
                  • 点击刷新按钮可重新生成 Token，旧 Token 立即失效
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
