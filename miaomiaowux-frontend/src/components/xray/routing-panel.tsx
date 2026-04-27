// @ts-nocheck
import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RefreshCw, Trash2, Plus, ChevronDown, GripVertical } from 'lucide-react'
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { EmptyStateCard } from '@/components/ui/empty-state'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'

const QUICK_RULES = {
  ban_bt: { name: '禁止 BT', rule: { type: 'field', protocol: ['bittorrent'], marktag: 'ban_bt', outboundTag: 'block' }, needSelectOutbound: false },
  ban_geoip_cn: { name: '禁止访问大陆 IP', rule: { type: 'field', ip: ['geoip:cn'], marktag: 'ban_geoip_cn', outboundTag: 'block' }, needSelectOutbound: false },
  fix_openai: { name: 'OpenAI 直连', rule: { type: 'field', domain: ['geosite:openai'], marktag: 'fix_openai', outboundTag: 'direct' }, needSelectOutbound: false },
  ban_private: { name: '禁止内网访问', rule: { type: 'field', ip: ['geoip:private'], marktag: 'ban_private', outboundTag: 'block' }, needSelectOutbound: false },
  rfc_emby: { name: 'RFC EMBY', rule: { type: 'field', domain: ['rfc.uhdnow.com'], network: 'tcp', marktag: 'rfc_emby' }, needSelectOutbound: true },
  tiktok_unlock: { name: '抖音解锁', rule: { type: 'field', domain: ['geosite:tiktok'], marktag: 'tiktok_unlock' }, needSelectOutbound: true },
}

interface RoutingRule {
  type?: string; domain?: string[]; ip?: string[]; protocol?: string[]
  port?: string | number; sourcePort?: string | number; network?: string
  source?: string[]; user?: string[]; inboundTag?: string[]
  outboundTag?: string; marktag?: string; attrs?: string
}

interface RoutingPanelProps {
  serverId: number
  serverName: string
  isRemote: boolean
}

function getRuleDisplayInfo(rule: RoutingRule) {
  if (rule.protocol?.length) return { ruleType: 'protocol', matchCondition: rule.protocol.join(', ') }
  if (rule.domain?.length) return { ruleType: 'domain', matchCondition: rule.domain.length > 2 ? `${rule.domain.slice(0, 2).join(', ')} 等 ${rule.domain.length} 项` : rule.domain.join(', ') }
  if (rule.ip?.length) return { ruleType: 'ip', matchCondition: rule.ip.length > 2 ? `${rule.ip.slice(0, 2).join(', ')} 等 ${rule.ip.length} 项` : rule.ip.join(', ') }
  if (rule.inboundTag?.length) return { ruleType: 'inboundTag', matchCondition: rule.inboundTag.join(', ') }
  if (rule.port) return { ruleType: 'port', matchCondition: String(rule.port) }
  if (rule.sourcePort) return { ruleType: 'sourcePort', matchCondition: String(rule.sourcePort) }
  if (rule.network) return { ruleType: 'network', matchCondition: rule.network }
  return { ruleType: '未知', matchCondition: '' }
}

function getRuleFriendlyName(rule: RoutingRule) {
  if (!rule.marktag) return null
  const preset = Object.values(QUICK_RULES).find(p => p.rule.marktag === rule.marktag)
  return preset ? preset.name : rule.marktag
}

function outboundBadgeVariant(tag: string) {
  if (tag === 'block') return 'destructive' as const
  if (tag === 'direct' || tag === 'freedom') return 'default' as const
  return 'secondary' as const
}

function SortableRuleItem({ rule, index, isSelected, onClick }: {
  rule: RoutingRule; index: number; isSelected: boolean; onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `rule-${index}` })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const { ruleType, matchCondition } = getRuleDisplayInfo(rule)
  const friendlyName = getRuleFriendlyName(rule)
  return (
    <div
      ref={setNodeRef} style={style}
      className={`flex items-center gap-1.5 py-2 px-2 rounded-md border text-sm cursor-pointer transition-colors ${isSelected ? 'border-primary bg-primary/5' : 'bg-card hover:bg-accent/50'}`}
      onClick={onClick}
    >
      <button className='shrink-0 cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground' {...attributes} {...listeners}>
        <GripVertical className='size-3.5' />
      </button>
      <Badge variant='outline' className='shrink-0 text-xs'>{ruleType}</Badge>
      <span className='flex-1 min-w-0 truncate text-xs' title={matchCondition}>
        {friendlyName ? <span className='font-medium'>{friendlyName}: </span> : null}
        {matchCondition || '-'}
      </span>
      <span className='text-muted-foreground text-xs'>→</span>
      <Badge variant={outboundBadgeVariant(rule.outboundTag || '')} className='shrink-0 text-xs'>
        {rule.outboundTag || '未设置'}
      </Badge>
    </div>
  )
}

export function RoutingPanel({ serverId, serverName, isRemote }: RoutingPanelProps) {
  const queryClient = useQueryClient()

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null)
  const [isOutboundSelectDialogOpen, setIsOutboundSelectDialogOpen] = useState(false)
  const [pendingRule, setPendingRule] = useState<{ rule: any } | null>(null)
  const [selectedOutbound, setSelectedOutbound] = useState('')
  const [isCustomRuleDialogOpen, setIsCustomRuleDialogOpen] = useState(false)
  const [customDomain, setCustomDomain] = useState('')
  const [customIp, setCustomIp] = useState('')
  const [customProtocol, setCustomProtocol] = useState('')
  const [customPort, setCustomPort] = useState('')
  const [customSourcePort, setCustomSourcePort] = useState('')
  const [customNetwork, setCustomNetwork] = useState('')
  const [customSource, setCustomSource] = useState('')
  const [customUser, setCustomUser] = useState('')
  const [customInboundTag, setCustomInboundTag] = useState('')
  const [customAttrs, setCustomAttrs] = useState('')
  const [customOutbound, setCustomOutbound] = useState('')
  const [customMarktag, setCustomMarktag] = useState('')

  const routingQueryKey = isRemote ? ['remote-routing', serverId] : ['xray-routing', serverId]
  const outboundsQueryKey = isRemote ? ['remote-outbounds', serverId] : ['xray-outbounds']

  const { data: localServersData } = useQuery({
    queryKey: ['xray-servers'],
    queryFn: async () => (await api.get('/api/admin/xray-servers')).data,
    enabled: !isRemote,
  })
  const localServer = !isRemote ? (localServersData?.servers?.find((s: any) => s.is_primary) || localServersData?.servers?.[0]) : null
  const localServerId = localServer?.id ?? null

  const { data: routingData, isLoading: routingLoading } = useQuery({
    queryKey: routingQueryKey,
    queryFn: async () => {
      if (isRemote) {
        const res = await api.get(`/api/admin/remote/routing?server_id=${serverId}`)
        return res.data as { success: boolean; routing: { domainStrategy?: string; rules?: RoutingRule[] } }
      }
      if (!localServerId) return { rules: [] }
      return (await api.get(`/api/admin/xray-servers/routing?server_id=${localServerId}`)).data
    },
    enabled: isRemote || localServerId !== null,
  })

  const { data: outboundsData, isLoading: outboundsLoading } = useQuery({
    queryKey: outboundsQueryKey,
    queryFn: async () => {
      if (isRemote) {
        const res = await api.get(`/api/admin/remote/outbounds?server_id=${serverId}`)
        return res.data as { success: boolean; outbounds: any[] }
      }
      return (await api.get('/api/admin/xray-servers/outbounds')).data
    },
    enabled: isRemote || localServerId !== null,
  })

  const rawRules: RoutingRule[] = useMemo(() => {
    if (isRemote) return routingData?.routing?.rules || []
    return routingData?.rules || []
  }, [routingData, isRemote])

  const rules = useMemo(() => rawRules.filter(r => r.outboundTag !== 'api' && !r.inboundTag?.includes('api')), [rawRules])

  const outbounds = useMemo(() => {
    if (isRemote) return outboundsData?.outbounds || []
    if (!outboundsData?.outbounds || !localServerId) return []
    return outboundsData.outbounds.filter((item: any) => item.server_id === localServerId).map((item: any) => item.outbound)
  }, [outboundsData, isRemote, localServerId])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const sortableIds = useMemo(() => rules.map((_, i) => `rule-${i}`), [rules])

  const restartXray = async () => {
    if (!isRemote) return
    try { await api.post(`/api/admin/remote/services/control?server_id=${serverId}`, { service: 'xray', action: 'restart' }) } catch {}
  }

  const findRawIndex = useCallback((filteredIndex: number) => {
    const rule = rules[filteredIndex]
    return rawRules.indexOf(rule)
  }, [rules, rawRules])

  const addRuleMutation = useMutation({
    mutationFn: async (rule: any) => {
      if (isRemote) return (await api.post(`/api/admin/remote/routing?server_id=${serverId}`, { action: 'add_rule', rule })).data
      return (await api.post('/api/admin/xray-servers/routing', { action: 'add', server_id: localServerId, rule })).data
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: routingQueryKey })
      if (data.success) { await restartXray(); toast.success(isRemote ? '路由规则已添加并重启 Xray' : (data.message || '路由规则已添加')) }
      else toast.error(data.message || '添加失败')
    },
    onError: handleServerError,
  })

  const removeRuleMutation = useMutation({
    mutationFn: async ({ index, rule }: { index: number; rule: RoutingRule }) => {
      if (isRemote) return (await api.post(`/api/admin/remote/routing?server_id=${serverId}`, { action: 'remove_rule', index: findRawIndex(index) })).data
      return (await api.post('/api/admin/xray-servers/routing', { action: 'remove', server_id: localServerId, marktag: rule.marktag, rule })).data
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: routingQueryKey })
      if (data.success) { await restartXray(); toast.success(isRemote ? '路由规则已删除并重启 Xray' : (data.message || '路由规则已删除')) }
      else toast.error(data.message || '删除失败')
      setSelectedIndex(null)
    },
    onError: handleServerError,
  })

  const reorderMutation = useMutation({
    mutationFn: async (newRules: RoutingRule[]) => {
      if (!isRemote) return { success: false, message: '本地服务器暂不支持排序' }
      const apiRules = rawRules.filter(r => r.outboundTag === 'api' || r.inboundTag?.includes('api'))
      return (await api.post(`/api/admin/remote/routing?server_id=${serverId}`, { action: 'set', routing: { ...routingData?.routing, rules: [...apiRules, ...newRules] } })).data
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: routingQueryKey })
      if (data.success) { await restartXray(); toast.success('规则顺序已更新并重启 Xray') }
      else toast.error(data.message || '排序失败')
    },
    onError: handleServerError,
  })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = sortableIds.indexOf(String(active.id))
    const newIdx = sortableIds.indexOf(String(over.id))
    if (oldIdx === -1 || newIdx === -1) return
    reorderMutation.mutate(arrayMove([...rules], oldIdx, newIdx))
    if (selectedIndex === oldIdx) setSelectedIndex(newIdx)
    else if (selectedIndex !== null) {
      if (oldIdx < selectedIndex && newIdx >= selectedIndex) setSelectedIndex(selectedIndex - 1)
      else if (oldIdx > selectedIndex && newIdx <= selectedIndex) setSelectedIndex(selectedIndex + 1)
    }
  }

  const handleQuickAdd = (key: string) => {
    const preset = QUICK_RULES[key as keyof typeof QUICK_RULES]
    if (!preset) return
    if (preset.needSelectOutbound) {
      setPendingRule({ rule: { ...preset.rule } }); setSelectedOutbound(''); setIsOutboundSelectDialogOpen(true)
    } else addRuleMutation.mutate(preset.rule)
  }

  const handleConfirmOutbound = () => {
    if (!pendingRule || !selectedOutbound) return
    addRuleMutation.mutate({ ...pendingRule.rule, outboundTag: selectedOutbound })
    setIsOutboundSelectDialogOpen(false); setPendingRule(null)
  }

  const resetCustomForm = () => {
    setCustomDomain(''); setCustomIp(''); setCustomProtocol(''); setCustomPort('')
    setCustomSourcePort(''); setCustomNetwork(''); setCustomSource(''); setCustomUser('')
    setCustomInboundTag(''); setCustomAttrs(''); setCustomOutbound(''); setCustomMarktag('')
  }

  const handleAddCustomRule = () => {
    if (!customOutbound) { toast.error('请选择出站'); return }
    const rule: any = { type: 'field', outboundTag: customOutbound }
    const split = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean)
    if (customDomain.trim()) rule.domain = split(customDomain)
    if (customIp.trim()) rule.ip = split(customIp)
    if (customProtocol.trim()) rule.protocol = split(customProtocol)
    if (customPort.trim()) rule.port = customPort.trim()
    if (customSourcePort.trim()) rule.sourcePort = customSourcePort.trim()
    if (customNetwork.trim()) rule.network = customNetwork.trim()
    if (customSource.trim()) rule.source = split(customSource)
    if (customUser.trim()) rule.user = split(customUser)
    if (customInboundTag.trim()) rule.inboundTag = split(customInboundTag)
    if (customAttrs.trim()) rule.attrs = customAttrs.trim()
    if (customMarktag.trim()) rule.marktag = customMarktag.trim()
    if (!rule.domain && !rule.ip && !rule.protocol && !rule.port && !rule.sourcePort && !rule.network && !rule.source && !rule.user && !rule.inboundTag && !rule.attrs) {
      toast.error('请至少填写一个匹配条件'); return
    }
    addRuleMutation.mutate(rule)
    setIsCustomRuleDialogOpen(false); resetCustomForm()
  }

  const isLoading = routingLoading || outboundsLoading
  const selectedRule = selectedIndex !== null ? rules[selectedIndex] : null

  return (
    <>
      <div className='space-y-3'>
        <div className='flex items-center justify-between'>
          <p className='text-sm text-muted-foreground'>路由规则（共 {rules.length} 个）{isRemote && ' · 可拖拽排序'}</p>
          <div className='flex items-center gap-2'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size='sm'><Plus className='size-4 mr-1' />快捷添加<ChevronDown className='size-4 ml-1' /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-56'>
                <DropdownMenuItem onClick={() => handleQuickAdd('ban_bt')}>禁止 BT</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleQuickAdd('ban_geoip_cn')}>禁止访问大陆 IP</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleQuickAdd('fix_openai')}>OpenAI 直连</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleQuickAdd('ban_private')}>禁止内网访问</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleQuickAdd('rfc_emby')}>RFC EMBY (需选择出站)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleQuickAdd('tiktok_unlock')}>抖音解锁 (需选择出站)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant='outline' size='sm' onClick={() => { resetCustomForm(); setIsCustomRuleDialogOpen(true) }}>
              <Plus className='size-4 mr-1' />自定义规则
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className='text-center py-8'>
            <RefreshCw className='size-6 animate-spin mx-auto mb-2' />
            <p className='text-sm text-muted-foreground'>加载中...</p>
          </div>
        ) : rules.length === 0 ? (
          <EmptyStateCard title='暂无路由规则' description='点击"快捷添加"或"自定义规则"添加' />
        ) : (
          <div className='flex gap-3' style={{ minHeight: 300 }}>
            {/* 左侧：规则列表 */}
            <div className='w-[40%] shrink-0 space-y-1.5 overflow-y-auto max-h-[60vh] pr-1'>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                  {rules.map((rule, i) => (
                    <SortableRuleItem key={`rule-${i}`} rule={rule} index={i} isSelected={selectedIndex === i} onClick={() => setSelectedIndex(i)} />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
            {/* 右侧：规则详情 */}
            <div className='flex-1 min-w-0 border rounded-lg p-4 bg-card overflow-y-auto max-h-[60vh]'>
              {selectedRule ? (
                <div className='space-y-4'>
                  <div className='flex items-center justify-between'>
                    <h4 className='font-medium text-sm'>{getRuleFriendlyName(selectedRule) || `规则 ${selectedIndex! + 1}`}</h4>
                    <Button variant='outline' size='sm' className='h-7 text-xs text-red-600 hover:text-red-700' onClick={() => setDeletingIndex(selectedIndex)}>
                      <Trash2 className='size-3 mr-1' />删除
                    </Button>
                  </div>
                  <div className='space-y-2 text-sm'>
                    {selectedRule.domain?.length && <div><span className='text-muted-foreground'>domain: </span><span className='break-all'>{selectedRule.domain.join(', ')}</span></div>}
                    {selectedRule.ip?.length && <div><span className='text-muted-foreground'>ip: </span><span className='break-all'>{selectedRule.ip.join(', ')}</span></div>}
                    {selectedRule.protocol?.length && <div><span className='text-muted-foreground'>protocol: </span>{selectedRule.protocol.join(', ')}</div>}
                    {selectedRule.port && <div><span className='text-muted-foreground'>port: </span>{String(selectedRule.port)}</div>}
                    {selectedRule.sourcePort && <div><span className='text-muted-foreground'>sourcePort: </span>{String(selectedRule.sourcePort)}</div>}
                    {selectedRule.network && <div><span className='text-muted-foreground'>network: </span>{selectedRule.network}</div>}
                    {selectedRule.source?.length && <div><span className='text-muted-foreground'>source: </span>{selectedRule.source.join(', ')}</div>}
                    {selectedRule.user?.length && <div><span className='text-muted-foreground'>user: </span>{selectedRule.user.join(', ')}</div>}
                    {selectedRule.inboundTag?.length && <div><span className='text-muted-foreground'>inboundTag: </span>{selectedRule.inboundTag.join(', ')}</div>}
                    {selectedRule.attrs && <div><span className='text-muted-foreground'>attrs: </span>{selectedRule.attrs}</div>}
                    <div><span className='text-muted-foreground'>outboundTag: </span><Badge variant={outboundBadgeVariant(selectedRule.outboundTag || '')} className='text-xs'>{selectedRule.outboundTag || '未设置'}</Badge></div>
                    {selectedRule.marktag && <div><span className='text-muted-foreground'>marktag: </span>{selectedRule.marktag}</div>}
                  </div>
                  <div>
                    <p className='text-xs text-muted-foreground mb-1'>JSON</p>
                    <pre className='bg-muted p-3 rounded-md text-xs overflow-auto max-h-48'>{JSON.stringify(selectedRule, null, 2)}</pre>
                  </div>
                </div>
              ) : (
                <div className='flex items-center justify-center h-full text-sm text-muted-foreground'>点击左侧规则查看详情</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 选择出站 */}
      <Dialog open={isOutboundSelectDialogOpen} onOpenChange={setIsOutboundSelectDialogOpen}>
        <DialogContent className='max-w-md'>
          <DialogHeader><DialogTitle>选择出站</DialogTitle></DialogHeader>
          <Select value={selectedOutbound} onValueChange={setSelectedOutbound}>
            <SelectTrigger><SelectValue placeholder='选择出站' /></SelectTrigger>
            <SelectContent>
              {outbounds.map((o: any) => <SelectItem key={o.tag} value={o.tag}>{o.tag} ({o.protocol})</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant='outline' onClick={() => setIsOutboundSelectDialogOpen(false)}>取消</Button>
            <Button onClick={handleConfirmOutbound} disabled={!selectedOutbound}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 自定义规则 */}
      <Dialog open={isCustomRuleDialogOpen} onOpenChange={setIsCustomRuleDialogOpen}>
        <DialogContent className='max-w-lg max-h-[85vh] flex flex-col'>
          <DialogHeader><DialogTitle>添加自定义规则</DialogTitle><DialogDescription>支持 Xray 所有路由字段，空字段不提交</DialogDescription></DialogHeader>
          <div className='flex-1 overflow-y-auto space-y-3 py-2'>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-1'>
                <Label className='text-xs'>domain</Label>
                <Textarea placeholder='geosite:openai, example.com' value={customDomain} onChange={e => setCustomDomain(e.target.value)} className='text-xs min-h-[60px]' />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>ip</Label>
                <Textarea placeholder='geoip:cn, 10.0.0.0/8' value={customIp} onChange={e => setCustomIp(e.target.value)} className='text-xs min-h-[60px]' />
              </div>
            </div>
            <div className='grid grid-cols-3 gap-3'>
              <div className='space-y-1'>
                <Label className='text-xs'>protocol</Label>
                <Input placeholder='bittorrent, http' value={customProtocol} onChange={e => setCustomProtocol(e.target.value)} className='text-xs' />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>port</Label>
                <Input placeholder='80, 443, 1000-2000' value={customPort} onChange={e => setCustomPort(e.target.value)} className='text-xs' />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>sourcePort</Label>
                <Input placeholder='来源端口' value={customSourcePort} onChange={e => setCustomSourcePort(e.target.value)} className='text-xs' />
              </div>
            </div>
            <div className='grid grid-cols-3 gap-3'>
              <div className='space-y-1'>
                <Label className='text-xs'>network</Label>
                <Select value={customNetwork} onValueChange={setCustomNetwork}>
                  <SelectTrigger className='text-xs'><SelectValue placeholder='不限' /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='tcp'>tcp</SelectItem>
                    <SelectItem value='udp'>udp</SelectItem>
                    <SelectItem value='tcp,udp'>tcp,udp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>source</Label>
                <Input placeholder='来源 IP' value={customSource} onChange={e => setCustomSource(e.target.value)} className='text-xs' />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>user</Label>
                <Input placeholder='用户' value={customUser} onChange={e => setCustomUser(e.target.value)} className='text-xs' />
              </div>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-1'>
                <Label className='text-xs'>inboundTag</Label>
                <Input placeholder='入站标签' value={customInboundTag} onChange={e => setCustomInboundTag(e.target.value)} className='text-xs' />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>attrs</Label>
                <Input placeholder='属性匹配' value={customAttrs} onChange={e => setCustomAttrs(e.target.value)} className='text-xs' />
              </div>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-1'>
                <Label className='text-xs'>出站 *</Label>
                <Select value={customOutbound} onValueChange={setCustomOutbound}>
                  <SelectTrigger className='text-xs'><SelectValue placeholder='选择出站' /></SelectTrigger>
                  <SelectContent>
                    {outbounds.map((o: any) => <SelectItem key={o.tag} value={o.tag}>{o.tag} ({o.protocol})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>标记 (可选)</Label>
                <Input placeholder='marktag' value={customMarktag} onChange={e => setCustomMarktag(e.target.value)} className='text-xs' />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setIsCustomRuleDialogOpen(false)}>取消</Button>
            <Button onClick={handleAddCustomRule} disabled={!customOutbound}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deletingIndex !== null} onOpenChange={o => !o && setDeletingIndex(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除规则</AlertDialogTitle>
            <AlertDialogDescription>确定要删除此路由规则吗？{isRemote ? '删除后将自动重启 Xray 生效。' : '此操作无法撤销。'}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className='bg-red-600 hover:bg-red-700' onClick={() => {
              if (deletingIndex !== null) removeRuleMutation.mutate({ index: deletingIndex, rule: rules[deletingIndex] })
              setDeletingIndex(null)
            }}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

