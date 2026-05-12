import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Bell, CircleHelp, Copy, Eye, EyeOff, Link, RefreshCw, Timer } from 'lucide-react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  const { t } = useTranslation('system')
  const queryClient = useQueryClient()
  const { auth } = useAuthStore()
  const [forceSyncExternal, setForceSyncExternal] = useState(false)
  const [matchRule, setMatchRule] = useState<'node_name' | 'server_port' | 'type_server_port'>('node_name')
  const [syncScope, setSyncScope] = useState<'saved_only' | 'all'>('saved_only')
  const [keepNodeName, setKeepNodeName] = useState(true)
  const [cacheExpireMinutes, setCacheExpireMinutes] = useState(0)
  const [syncTraffic, setSyncTraffic] = useState(false)
  const [nodeNameFilter, setNodeNameFilter] = useState('剩余|流量|到期|订阅|时间|重置')
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
      toast.success(t('masterUrl.updated'))
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
      toast.success(t('apiToken.regenerated'))
    },
    onError: handleServerError,
  })

  const copyApiToken = () => {
    if (apiTokenData?.token) {
      navigator.clipboard.writeText(apiTokenData.token)
      toast.success(t('apiToken.copied'))
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
      toast.success(t('shortLink.updated'))
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
      toast.success(t('intervals.updated'))
    },
    onError: handleServerError,
  })
  const [enableProxyProvider, setEnableProxyProvider] = useState(false)
  const [proxyGroupsSourceUrl, setProxyGroupsSourceUrl] = useState('')
  const [clientCompatibilityMode, setClientCompatibilityMode] = useState(false)

  // 通知配置
  interface NotifyConfig {
    notify_enabled: boolean
    telegram_bot_token: string
    telegram_chat_id: string
    notify_login: boolean
    notify_subscribe_fetch: boolean
    notify_daily_traffic: boolean
    notify_server_offline: boolean
    notify_server_online: boolean
    notify_traffic_threshold: boolean
    notify_daily_traffic_time: string
    notify_traffic_threshold_percent: number
  }
  const [notifyConfig, setNotifyConfig] = useState<NotifyConfig>({
    notify_enabled: false,
    telegram_bot_token: '',
    telegram_chat_id: '',
    notify_login: false,
    notify_subscribe_fetch: false,
    notify_daily_traffic: false,
    notify_server_offline: false,
    notify_server_online: false,
    notify_traffic_threshold: false,
    notify_daily_traffic_time: '08:00',
    notify_traffic_threshold_percent: 80,
  })
  const [showBotToken, setShowBotToken] = useState(false)
  const [editingBotToken, setEditingBotToken] = useState('')

  const { data: notifyData } = useQuery({
    queryKey: ['notify-config'],
    queryFn: async () => {
      const response = await api.get('/api/admin/notify-config')
      return response.data as NotifyConfig
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (notifyData) {
      setNotifyConfig(notifyData)
      setEditingBotToken(notifyData.telegram_bot_token)
    }
  }, [notifyData])

  const updateNotifyMutation = useMutation({
    mutationFn: async (data: NotifyConfig) => {
      await api.put('/api/admin/notify-config', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notify-config'] })
      toast.success(t('telegram.configUpdated'))
    },
    onError: handleServerError,
  })

  const testNotifyMutation = useMutation({
    mutationFn: async () => {
      await api.post('/api/admin/notify-config/test')
    },
    onSuccess: () => {
      toast.success(t('telegram.testSent'))
    },
    onError: handleServerError,
  })

  const saveNotifyConfig = (updates: Partial<NotifyConfig>) => {
    const newConfig = { ...notifyConfig, ...updates }
    setNotifyConfig(newConfig)
    updateNotifyMutation.mutate(newConfig)
  }

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
        node_name_filter: string
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
      setNodeNameFilter(userConfig.node_name_filter || '剩余|流量|到期|订阅|时间|重置')
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
      node_name_filter: string
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
      setNodeNameFilter(variables.node_name_filter)
      setEnableShortLink(variables.enable_short_link)
      setUseNewTemplateSystem(variables.use_new_template_system)
      setEnableProxyProvider(variables.enable_proxy_provider)
      setProxyGroupsSourceUrl(variables.proxy_groups_source_url || '')
      setClientCompatibilityMode(variables.client_compatibility_mode)
      toast.success(t('configUpdated'))
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('configUpdateFailed'))
    },
  })

  const updateConfig = (updates: Partial<{
    force_sync_external: boolean
    match_rule: string
    sync_scope: string
    keep_node_name: boolean
    cache_expire_minutes: number
    sync_traffic: boolean
    node_name_filter: string
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
      node_name_filter: nodeNameFilter,
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
          <h1 className='text-3xl font-semibold tracking-tight'>{t('title')}</h1>
          <p className='text-muted-foreground'>{t('description')}</p>
        </section>

        <div className='mt-8 space-y-6'>
          {/* 外部订阅同步设置 */}
          <Card>
            <CardHeader className='pb-4'>
              <CardTitle>{t('sync.title')}</CardTitle>
              <CardDescription>{t('sync.description')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='sync-traffic' className='cursor-pointer'>
                    {t('sync.syncTraffic')}
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CircleHelp className='h-4 w-4 text-muted-foreground cursor-help' />
                    </TooltipTrigger>
                    <TooltipContent side='right' className='max-w-xs'>
                      <p>{t('sync.syncTrafficHint')}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id='sync-traffic'
                  checked={syncTraffic}
                  onCheckedChange={(checked) => updateConfig({ sync_traffic: checked })}
                  disabled={updateConfigMutation.isPending}
                />
              </div>

              <div className='space-y-2 pt-3 border-t'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='node-name-filter'>{t('sync.nodeNameFilter')}</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CircleHelp className='h-4 w-4 text-muted-foreground cursor-help' />
                    </TooltipTrigger>
                    <TooltipContent side='right' className='max-w-xs'>
                      <p>{t('sync.nodeNameFilterHint')}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id='node-name-filter'
                  value={nodeNameFilter}
                  onChange={(e) => setNodeNameFilter(e.target.value)}
                  onBlur={() => updateConfig({ node_name_filter: nodeNameFilter })}
                  disabled={updateConfigMutation.isPending}
                  placeholder='剩余|流量|到期|订阅|时间|重置'
                />
                <p className='text-xs text-muted-foreground'>{t('sync.nodeNameFilterDesc')}</p>
              </div>

              <div className='flex items-center justify-between pt-3 border-t'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='force-sync-external' className='cursor-pointer'>
                    {t('sync.forceSyncExternal')}
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CircleHelp className='h-4 w-4 text-muted-foreground cursor-help' />
                    </TooltipTrigger>
                    <TooltipContent side='right' className='max-w-xs'>
                      <p>{t('sync.forceSyncExternalHint')}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  id='force-sync-external'
                  checked={forceSyncExternal}
                  onCheckedChange={(checked) => updateConfig({ force_sync_external: checked })}
                  disabled={updateConfigMutation.isPending}
                />
              </div>

              {forceSyncExternal && (
                <div className='space-y-4 pt-3 border-t bg-muted/30 -mx-6 px-6 py-4 rounded-b-lg'>
                  <div className='space-y-2'>
                    <Label>{t('sync.matchRule')}</Label>
                    <RadioGroup
                      value={matchRule}
                      onValueChange={(value: 'node_name' | 'server_port' | 'type_server_port') => {
                        setMatchRule(value)
                        updateConfig({ match_rule: value })
                      }}
                      disabled={updateConfigMutation.isPending}
                      className='flex flex-wrap gap-4'
                    >
                      <div className='flex items-center space-x-2'>
                        <RadioGroupItem value='node_name' id='match-node-name' />
                        <Label htmlFor='match-node-name' className='font-normal cursor-pointer'>
                          {t('sync.matchRuleNodeName')}
                        </Label>
                      </div>
                      <div className='flex items-center space-x-2'>
                        <RadioGroupItem value='server_port' id='match-server-port' />
                        <Label htmlFor='match-server-port' className='font-normal cursor-pointer'>
                          {t('sync.matchRuleServerPort')}
                        </Label>
                      </div>
                      <div className='flex items-center space-x-2'>
                        <RadioGroupItem value='type_server_port' id='match-type-server-port' />
                        <Label htmlFor='match-type-server-port' className='font-normal cursor-pointer'>
                          {t('sync.matchRuleTypeServerPort')}
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className='space-y-2 pt-3 border-t border-border/50'>
                    <Label>{t('sync.syncScope')}</Label>
                    <RadioGroup
                      value={syncScope}
                      onValueChange={(value: 'saved_only' | 'all') => {
                        setSyncScope(value)
                        updateConfig({ sync_scope: value })
                      }}
                      disabled={updateConfigMutation.isPending}
                      className='flex flex-wrap gap-4'
                    >
                      <div className='flex items-center space-x-2'>
                        <RadioGroupItem value='saved_only' id='sync-saved-only' />
                        <Label htmlFor='sync-saved-only' className='font-normal cursor-pointer'>
                          {t('sync.syncScopeSavedOnly')}
                        </Label>
                      </div>
                      <div className='flex items-center space-x-2'>
                        <RadioGroupItem value='all' id='sync-all' />
                        <Label htmlFor='sync-all' className='font-normal cursor-pointer'>
                          {t('sync.syncScopeAll')}
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className='flex items-center justify-between pt-3 border-t border-border/50'>
                    <div className='flex items-center gap-2'>
                      <Label htmlFor='keep-node-name' className='cursor-pointer'>
                        {t('sync.keepNodeName')}
                      </Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <CircleHelp className='h-4 w-4 text-muted-foreground cursor-help' />
                        </TooltipTrigger>
                        <TooltipContent side='right' className='max-w-xs'>
                          <p>{t('sync.keepNodeNameHint')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Switch
                      id='keep-node-name'
                      checked={keepNodeName}
                      onCheckedChange={(checked) => {
                        setKeepNodeName(checked)
                        updateConfig({ keep_node_name: checked })
                      }}
                      disabled={updateConfigMutation.isPending}
                    />
                  </div>

                  <div className='space-y-2 pt-3 border-t border-border/50'>
                    <div className='flex items-center gap-2'>
                      <Label htmlFor='cache-expire-minutes'>{t('sync.cacheExpireMinutes')}</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <CircleHelp className='h-4 w-4 text-muted-foreground cursor-help' />
                        </TooltipTrigger>
                        <TooltipContent side='right' className='max-w-xs'>
                          <p>{t('sync.cacheExpireMinutesHint')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id='cache-expire-minutes'
                      type='number'
                      min='0'
                      value={cacheExpireMinutes}
                      onChange={(e) => setCacheExpireMinutes(parseInt(e.target.value) || 0)}
                      onBlur={() => updateConfig({ cache_expire_minutes: cacheExpireMinutes })}
                      disabled={updateConfigMutation.isPending}
                      placeholder='0'
                      className='w-32'
                    />
                    <p className='text-xs text-destructive'>{t('sync.cacheExpireWarning')}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 短链接全局开关 */}
          <Card>
            <CardHeader className='pb-4'>
              <CardTitle className='flex items-center gap-2'>
                <Link className='h-5 w-5' />
                {t('shortLink.title')}
              </CardTitle>
              <CardDescription>{t('shortLink.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className='flex items-center justify-between'>
                <Label htmlFor='short-link-toggle'>{t('shortLink.enableLabel')}</Label>
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
                {t('intervals.title')}
              </CardTitle>
              <CardDescription>{t('intervals.description')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid grid-cols-2 gap-4'>
                <div className='space-y-2'>
                  <Label htmlFor='speed-interval'>{t('intervals.speedCollect')}</Label>
                  <Input
                    id='speed-interval'
                    type='number'
                    min={1}
                    value={speedCollectInterval}
                    onChange={(e) => setSpeedCollectInterval(Number(e.target.value))}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='traffic-interval'>{t('intervals.trafficCollect')}</Label>
                  <Input
                    id='traffic-interval'
                    type='number'
                    min={10}
                    value={trafficCollectInterval}
                    onChange={(e) => setTrafficCollectInterval(Number(e.target.value))}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='check-interval'>{t('intervals.trafficCheck')}</Label>
                  <Input
                    id='check-interval'
                    type='number'
                    min={10}
                    value={trafficCheckInterval}
                    onChange={(e) => setTrafficCheckInterval(Number(e.target.value))}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='heartbeat-interval'>{t('intervals.heartbeat')}</Label>
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
                {t('actions.save', { ns: 'common' })}
              </Button>
            </CardContent>
          </Card>

          {/* 主服务器地址 */}
          <Card>
            <CardHeader className='pb-4'>
              <CardTitle>{t('masterUrl.title')}</CardTitle>
              <CardDescription>{t('masterUrl.description')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='master-url'>{t('masterUrl.label')}</Label>
                <Input
                  id='master-url'
                  placeholder={t('masterUrl.placeholder')}
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
                  {t('masterUrl.hint')}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Telegram 通知 */}
          <Card>
            <CardHeader className='pb-4'>
              <CardTitle className='flex items-center gap-2'>
                <Bell className='h-5 w-5' />
                {t('telegram.title')}
              </CardTitle>
              <CardDescription>{t('telegram.description')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='notify-enabled'>{t('telegram.enableLabel')}</Label>
                <Switch
                  id='notify-enabled'
                  checked={notifyConfig.notify_enabled}
                  onCheckedChange={(checked) => saveNotifyConfig({ notify_enabled: checked })}
                  disabled={updateNotifyMutation.isPending}
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='bot-token'>{t('telegram.botToken')}</Label>
                <div className='flex items-center gap-2'>
                  <div className='flex-1 relative'>
                    <Input
                      id='bot-token'
                      type={showBotToken ? 'text' : 'password'}
                      placeholder={t('telegram.botTokenPlaceholder')}
                      value={editingBotToken}
                      onChange={(e) => setEditingBotToken(e.target.value)}
                      onBlur={() => {
                        if (editingBotToken !== notifyConfig.telegram_bot_token) {
                          saveNotifyConfig({ telegram_bot_token: editingBotToken })
                        }
                      }}
                      className='pr-10 font-mono text-sm'
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='absolute right-0 top-0 h-full px-3 hover:bg-transparent'
                      onClick={() => setShowBotToken(!showBotToken)}
                    >
                      {showBotToken ? (
                        <EyeOff className='h-4 w-4 text-muted-foreground' />
                      ) : (
                        <Eye className='h-4 w-4 text-muted-foreground' />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='chat-id'>{t('telegram.chatId')}</Label>
                <Input
                  id='chat-id'
                  placeholder={t('telegram.chatIdPlaceholder')}
                  value={notifyConfig.telegram_chat_id}
                  onChange={(e) => setNotifyConfig({ ...notifyConfig, telegram_chat_id: e.target.value })}
                  onBlur={() => {
                    if (notifyConfig.telegram_chat_id !== notifyData?.telegram_chat_id) {
                      saveNotifyConfig({ telegram_chat_id: notifyConfig.telegram_chat_id })
                    }
                  }}
                  className='font-mono text-sm'
                />
              </div>

              <Button
                variant='outline'
                size='sm'
                onClick={() => testNotifyMutation.mutate()}
                disabled={testNotifyMutation.isPending || !notifyConfig.notify_enabled}
              >
                {testNotifyMutation.isPending ? t('actions.sending', { ns: 'common' }) : t('telegram.sendTest')}
              </Button>

              <div className='border-t pt-4 space-y-3'>
                <p className='text-sm font-medium text-muted-foreground'>{t('telegram.events.title')}</p>
                <div className='flex items-center justify-between'>
                  <Label htmlFor='notify-login'>{t('telegram.events.login')}</Label>
                  <Switch
                    id='notify-login'
                    checked={notifyConfig.notify_login}
                    onCheckedChange={(checked) => saveNotifyConfig({ notify_login: checked })}
                    disabled={updateNotifyMutation.isPending}
                  />
                </div>
                <div className='flex items-center justify-between'>
                  <Label htmlFor='notify-subscribe'>{t('telegram.events.subscribe')}</Label>
                  <Switch
                    id='notify-subscribe'
                    checked={notifyConfig.notify_subscribe_fetch}
                    onCheckedChange={(checked) => saveNotifyConfig({ notify_subscribe_fetch: checked })}
                    disabled={updateNotifyMutation.isPending}
                  />
                </div>
                <div className='flex items-center justify-between'>
                  <Label htmlFor='notify-online'>{t('telegram.events.serverOnline')}</Label>
                  <Switch
                    id='notify-online'
                    checked={notifyConfig.notify_server_online}
                    onCheckedChange={(checked) => saveNotifyConfig({ notify_server_online: checked })}
                    disabled={updateNotifyMutation.isPending}
                  />
                </div>
                <div className='flex items-center justify-between'>
                  <Label htmlFor='notify-offline'>{t('telegram.events.serverOffline')}</Label>
                  <Switch
                    id='notify-offline'
                    checked={notifyConfig.notify_server_offline}
                    onCheckedChange={(checked) => saveNotifyConfig({ notify_server_offline: checked })}
                    disabled={updateNotifyMutation.isPending}
                  />
                </div>
                <div className='flex items-center justify-between'>
                  <Label htmlFor='notify-daily'>{t('telegram.events.dailyTraffic')}</Label>
                  <Switch
                    id='notify-daily'
                    checked={notifyConfig.notify_daily_traffic}
                    onCheckedChange={(checked) => saveNotifyConfig({ notify_daily_traffic: checked })}
                    disabled={updateNotifyMutation.isPending}
                  />
                </div>
                {notifyConfig.notify_daily_traffic && (
                  <div className='ml-4 space-y-2'>
                    <Label htmlFor='daily-time'>{t('telegram.events.dailyTrafficTime')}</Label>
                    <Input
                      id='daily-time'
                      type='time'
                      value={notifyConfig.notify_daily_traffic_time}
                      onChange={(e) => setNotifyConfig({ ...notifyConfig, notify_daily_traffic_time: e.target.value })}
                      onBlur={() => saveNotifyConfig({ notify_daily_traffic_time: notifyConfig.notify_daily_traffic_time })}
                      className='w-32'
                    />
                  </div>
                )}
                <div className='flex items-center justify-between'>
                  <Label htmlFor='notify-threshold'>{t('telegram.events.trafficThreshold')}</Label>
                  <Switch
                    id='notify-threshold'
                    checked={notifyConfig.notify_traffic_threshold}
                    onCheckedChange={(checked) => saveNotifyConfig({ notify_traffic_threshold: checked })}
                    disabled={updateNotifyMutation.isPending}
                  />
                </div>
                {notifyConfig.notify_traffic_threshold && (
                  <div className='ml-4 space-y-2'>
                    <Label htmlFor='threshold-pct'>{t('telegram.events.thresholdPercent')}</Label>
                    <Input
                      id='threshold-pct'
                      type='number'
                      min={1}
                      max={100}
                      value={notifyConfig.notify_traffic_threshold_percent}
                      onChange={(e) => setNotifyConfig({ ...notifyConfig, notify_traffic_threshold_percent: Number(e.target.value) })}
                      onBlur={() => saveNotifyConfig({ notify_traffic_threshold_percent: notifyConfig.notify_traffic_threshold_percent })}
                      className='w-32'
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* API Token 设置 */}
          <Card>
            <CardHeader>
              <CardTitle>{t('apiToken.title')}</CardTitle>
              <CardDescription>{t('apiToken.description')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <Label>{t('apiToken.currentLabel')}</Label>
                <div className='flex items-center gap-2'>
                  <div className='flex-1 relative'>
                    <Input
                      type={showApiToken ? 'text' : 'password'}
                      value={loadingApiToken ? t('actions.loading', { ns: 'common' }) : (apiTokenData?.token || '')}
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
                      if (confirm(t('apiToken.regenerateConfirm'))) {
                        regenerateApiTokenMutation.mutate()
                      }
                    }}
                    disabled={loadingApiToken || regenerateApiTokenMutation.isPending}
                  >
                    <RefreshCw className={`h-4 w-4 ${regenerateApiTokenMutation.isPending ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
                <p className='text-sm text-muted-foreground'>
                  {t('apiToken.usageHint')}
                </p>
              </div>
              <div className='rounded-lg border bg-muted/40 p-4'>
                <p className='text-sm text-muted-foreground whitespace-pre-line'>
                  {t('apiToken.warning')}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
