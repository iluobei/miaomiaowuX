// @ts-nocheck
import { useCallback, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RefreshCw, Trash2, Eye, Plus, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Twemoji } from '@/components/twemoji'
import { api } from '@/lib/api'

interface RoutingRule {
  type?: string; domain?: string[]; ip?: string[]; protocol?: string[]
  port?: string | number; network?: string; source?: string[]; user?: string[]
  inboundTag?: string[]; outboundTag?: string; marktag?: string
}

interface ParsedNode {
  id: number; raw_url: string; node_name: string; protocol: string
  parsed_config: string; clash_config: string; enabled: boolean
  tag: string; original_server: string; inbound_tag: string
  created_at: string; updated_at: string
}

interface NodeRoutingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  node: ParsedNode
  serverId: number
  serverName: string
  allNodes?: Array<{ node_name: string; clash_config: string }>
}

const QUICK_RULES = {
  ban_bt: { name: '禁止 BT', rule: { type: 'field', protocol: ['bittorrent'], marktag: 'ban_bt', outboundTag: 'block' }, needOutbound: false },
  ban_geoip_cn: { name: '禁止访问大陆 IP', rule: { type: 'field', ip: ['geoip:cn'], marktag: 'ban_geoip_cn', outboundTag: 'block' }, needOutbound: false },
  fix_openai: { name: 'OpenAI 直连', rule: { type: 'field', domain: ['geosite:openai'], marktag: 'fix_openai', outboundTag: 'direct' }, needOutbound: false },
  ban_private: { name: '禁止内网访问', rule: { type: 'field', ip: ['geoip:private'], marktag: 'ban_private', outboundTag: 'block' }, needOutbound: false },
  rfc_emby: { name: 'RFC EMBY', rule: { type: 'field', domain: ['rfc.uhdnow.com'], network: 'tcp', marktag: 'rfc_emby' }, needOutbound: true },
  tiktok_unlock: { name: '抖音解锁', rule: { type: 'field', domain: ['geosite:tiktok'], marktag: 'tiktok_unlock' }, needOutbound: true },
}

function getRuleDisplayInfo(rule: RoutingRule) {
  if (rule.protocol?.length) return { ruleType: 'protocol', matchCondition: rule.protocol.join(', ') }
  if (rule.domain?.length) return { ruleType: 'domain', matchCondition: rule.domain.length > 3 ? `${rule.domain.slice(0, 3).join(', ')} 等 ${rule.domain.length} 项` : rule.domain.join(', ') }
  if (rule.ip?.length) return { ruleType: 'ip', matchCondition: rule.ip.length > 3 ? `${rule.ip.slice(0, 3).join(', ')} 等 ${rule.ip.length} 项` : rule.ip.join(', ') }
  if (rule.port) return { ruleType: 'port', matchCondition: String(rule.port) }
  if (rule.inboundTag?.length) return { ruleType: '入站匹配', matchCondition: '全部流量' }
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

function getOutboundAddress(outbound: any): { address: string; port: number | string } | null {
  const vnext = outbound.settings?.vnext?.[0]
  if (vnext?.address) return { address: vnext.address, port: vnext.port || '' }
  const server = outbound.settings?.servers?.[0]
  if (server?.address) return { address: server.address, port: server.port || '' }
  return null
}

function RuleRow({ rule, index, allRulesCount, onView, onDelete, outboundDisplayName }: {
  rule: RoutingRule; index: number; allRulesCount: number
  onView: () => void; onDelete: () => void
  outboundDisplayName?: string
}) {
  const { ruleType, matchCondition } = getRuleDisplayInfo(rule)
  const friendlyName = getRuleFriendlyName(rule)
  const displayTag = outboundDisplayName || rule.outboundTag || '未设置'
  return (
    <div className='flex items-center gap-2 py-2 px-3 rounded-md border bg-card text-sm'>
      <Badge variant='outline' className='shrink-0 text-xs'>{ruleType}</Badge>
      <span className='flex-1 min-w-0 truncate' title={matchCondition}>
        {friendlyName ? <span className='font-medium'>{friendlyName}: </span> : null}
        {matchCondition || '-'}
      </span>
      <span className='text-muted-foreground mx-1'>→</span>
      <Badge variant={outboundBadgeVariant(rule.outboundTag || '')} className='shrink-0 text-xs' title={rule.outboundTag}>
        {displayTag}
      </Badge>
      <Button variant='ghost' size='icon' className='size-6 shrink-0' onClick={onView}><Eye className='size-3' /></Button>
      <Button variant='ghost' size='icon' className='size-6 shrink-0 text-red-600 hover:text-red-700' onClick={onDelete}><Trash2 className='size-3' /></Button>
    </div>
  )
}

export function NodeRoutingDialog({ open, onOpenChange, node, serverId, serverName, allNodes }: NodeRoutingDialogProps) {
  const queryClient = useQueryClient()
  const inboundTag = node.inbound_tag

  const [dedicatedOpen, setDedicatedOpen] = useState(true)
  const [globalOpen, setGlobalOpen] = useState(true)
  const [viewingRule, setViewingRule] = useState<RoutingRule | null>(null)
  const [deletingRule, setDeletingRule] = useState<{ rule: RoutingRule; index: number } | null>(null)
  const [outboundSelectOpen, setOutboundSelectOpen] = useState(false)
  const [pendingRule, setPendingRule] = useState<{ rule: any } | null>(null)
  const [selectedOutbound, setSelectedOutbound] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [customType, setCustomType] = useState<'domain' | 'ip' | 'protocol'>('domain')
  const [customValue, setCustomValue] = useState('')
  const [customOutbound, setCustomOutbound] = useState('')
  const [customMarktag, setCustomMarktag] = useState('')
  const [customScope, setCustomScope] = useState<'dedicated' | 'global'>('dedicated')

  const { data: routingData, isLoading: routingLoading } = useQuery({
    queryKey: ['remote-routing', serverId],
    queryFn: async () => {
      const res = await api.get(`/api/admin/remote/routing?server_id=${serverId}`)
      return res.data as { success: boolean; routing: { domainStrategy?: string; rules?: RoutingRule[] } }
    },
    enabled: open,
  })

  const { data: outboundsData, isLoading: outboundsLoading } = useQuery({
    queryKey: ['remote-outbounds', serverId],
    queryFn: async () => {
      const res = await api.get(`/api/admin/remote/outbounds?server_id=${serverId}`)
      return res.data as { success: boolean; outbounds: Array<{ tag?: string; protocol?: string; [k: string]: any }> }
    },
    enabled: open,
  })

  const allRules: RoutingRule[] = useMemo(() => {
    return (routingData?.routing?.rules || []).filter(r => r.outboundTag !== 'api' && !r.inboundTag?.includes('api'))
  }, [routingData])

  const outbounds = useMemo(() => outboundsData?.outbounds || [], [outboundsData])
  const defaultOutbound = outbounds[0]

  const outboundTagToName = useMemo(() => {
    const map: Record<string, string> = {}
    if (!allNodes?.length || !outbounds.length) return map
    const nodeByAddr: Record<string, string> = {}
    for (const n of allNodes) {
      try {
        const clash = JSON.parse(n.clash_config)
        if (clash?.server) nodeByAddr[`${clash.server}:${clash.port || ''}`] = n.node_name
      } catch {}
    }
    for (const ob of outbounds) {
      const addr = getOutboundAddress(ob)
      if (addr && ob.tag) {
        const key = `${addr.address}:${addr.port}`
        if (nodeByAddr[key]) map[ob.tag] = nodeByAddr[key]
      }
    }
    return map
  }, [allNodes, outbounds])

  const resolveOutboundName = useCallback((tag: string) => {
    return outboundTagToName[tag] || undefined
  }, [outboundTagToName])

  const isCatchAllRule = (rule: RoutingRule) => {
    return !rule.domain?.length && !rule.ip?.length && !rule.protocol?.length &&
      !rule.port && !rule.network && !rule.source?.length && !rule.user?.length
  }

  const { dedicatedRules, globalRules, hasCatchAll, catchAllOutbound } = useMemo(() => {
    const dedicated: Array<{ rule: RoutingRule; originalIndex: number }> = []
    const global: Array<{ rule: RoutingRule; originalIndex: number }> = []
    const rawRules = routingData?.routing?.rules || []
    rawRules.forEach((rule, i) => {
      if (rule.outboundTag === 'api' || rule.inboundTag?.includes('api')) return
      if (rule.inboundTag?.includes(inboundTag)) {
        dedicated.push({ rule, originalIndex: i })
      } else if (!rule.inboundTag || rule.inboundTag.length === 0) {
        global.push({ rule, originalIndex: i })
      }
    })
    const catchAll = dedicated.find(({ rule }) => isCatchAllRule(rule))
    return {
      dedicatedRules: dedicated,
      globalRules: global,
      hasCatchAll: !!catchAll,
      catchAllOutbound: catchAll?.rule.outboundTag || '',
    }
  }, [routingData, inboundTag])

  const restartXray = async () => {
    try {
      await api.post(`/api/admin/remote/services/control?server_id=${serverId}`, { service: 'xray', action: 'restart' })
    } catch {}
  }

  const addRuleMutation = useMutation({
    mutationFn: async (rule: any) => {
      const res = await api.post(`/api/admin/remote/routing?server_id=${serverId}`, { action: 'add_rule', rule })
      return res.data
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['remote-routing', serverId] })
      if (data.success) {
        await restartXray()
        toast.success('路由规则已添加并重启 Xray')
      } else {
        toast.error(data.message || '添加失败')
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '添加失败'),
  })

  const removeRuleMutation = useMutation({
    mutationFn: async (index: number) => {
      const res = await api.post(`/api/admin/remote/routing?server_id=${serverId}`, { action: 'remove_rule', index })
      return res.data
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['remote-routing', serverId] })
      if (data.success) {
        await restartXray()
        toast.success('路由规则已删除并重启 Xray')
      } else {
        toast.error(data.message || '删除失败')
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error || '删除失败'),
  })

  const handleQuickAdd = (key: string) => {
    const preset = QUICK_RULES[key as keyof typeof QUICK_RULES]
    if (!preset) return
    const rule = { ...preset.rule, inboundTag: [inboundTag] }
    if (preset.needOutbound) {
      setPendingRule({ rule })
      setSelectedOutbound('')
      setOutboundSelectOpen(true)
    } else {
      addRuleMutation.mutate(rule)
    }
  }

  const handleConfirmOutbound = () => {
    if (!pendingRule || !selectedOutbound) return
    addRuleMutation.mutate({ ...pendingRule.rule, outboundTag: selectedOutbound })
    setOutboundSelectOpen(false)
    setPendingRule(null)
  }

  const handleAddCustom = () => {
    if (!customValue.trim()) { toast.error('请输入匹配条件'); return }
    if (!customOutbound) { toast.error('请选择出站'); return }
    const rule: any = { type: 'field', outboundTag: customOutbound }
    const values = customValue.split(',').map(v => v.trim()).filter(Boolean)
    if (customType === 'domain') rule.domain = values
    else if (customType === 'ip') rule.ip = values
    else rule.protocol = values
    if (customMarktag.trim()) rule.marktag = customMarktag.trim()
    if (customScope === 'dedicated') rule.inboundTag = [inboundTag]
    addRuleMutation.mutate(rule)
    setCustomOpen(false)
    setCustomType('domain'); setCustomValue(''); setCustomOutbound(''); setCustomMarktag('')
  }

  const isLoading = routingLoading || outboundsLoading

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-w-2xl max-h-[80vh] flex flex-col'>
          <DialogHeader>
            <DialogTitle>
              节点路由 — <Twemoji>{node.node_name}</Twemoji>
            </DialogTitle>
            <DialogDescription>
              服务器: {serverName} | 入站: {inboundTag}
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className='flex items-center justify-center py-12'>
              <RefreshCw className='size-5 animate-spin mr-2' />
              <span className='text-sm text-muted-foreground'>加载路由配置...</span>
            </div>
          ) : (
            <div className='flex-1 overflow-y-auto space-y-4 py-2'>
              {/* 专属规则 */}
              <Collapsible open={dedicatedOpen} onOpenChange={setDedicatedOpen}>
                <CollapsibleTrigger className='flex items-center gap-1 text-sm font-medium w-full hover:text-primary transition-colors'>
                  {dedicatedOpen ? <ChevronDown className='size-4' /> : <ChevronRight className='size-4' />}
                  专属路由规则 ({dedicatedRules.length})
                  <span className='text-xs text-muted-foreground font-normal ml-1'>针对此入站</span>
                </CollapsibleTrigger>
                <CollapsibleContent className='space-y-1.5 mt-2'>
                  {dedicatedRules.length === 0 ? (
                    <div className='text-xs text-muted-foreground py-3 text-center border rounded-md'>
                      无专属规则，流量将按全局规则处理
                    </div>
                  ) : (
                    dedicatedRules.map(({ rule, originalIndex }) => (
                      <RuleRow
                        key={originalIndex}
                        rule={rule}
                        index={originalIndex}
                        allRulesCount={allRules.length}
                        onView={() => setViewingRule(rule)}
                        onDelete={() => setDeletingRule({ rule, index: originalIndex })}
                        outboundDisplayName={resolveOutboundName(rule.outboundTag || '')}
                      />
                    ))
                  )}
                  {hasCatchAll && (
                    <div className='text-xs text-amber-600 dark:text-amber-400 py-2 px-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950'>
                      ⚠ 全部流量已被路由到 <Badge variant={outboundBadgeVariant(catchAllOutbound)} className='text-xs mx-0.5'>{resolveOutboundName(catchAllOutbound) || catchAllOutbound}</Badge>，后续全局规则和默认出站不再生效
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>

              {!hasCatchAll && (
                <>
                  {/* 全局规则 */}
                  <Collapsible open={globalOpen} onOpenChange={setGlobalOpen}>
                    <CollapsibleTrigger className='flex items-center gap-1 text-sm font-medium w-full hover:text-primary transition-colors'>
                      {globalOpen ? <ChevronDown className='size-4' /> : <ChevronRight className='size-4' />}
                      全局路由规则 ({globalRules.length})
                      <span className='text-xs text-muted-foreground font-normal ml-1'>对所有入站生效</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className='space-y-1.5 mt-2'>
                      {globalRules.length === 0 ? (
                        <div className='text-xs text-muted-foreground py-3 text-center border rounded-md'>
                          无全局规则
                        </div>
                      ) : (
                        globalRules.map(({ rule, originalIndex }) => (
                          <RuleRow
                            key={originalIndex}
                            rule={rule}
                            index={originalIndex}
                            allRulesCount={allRules.length}
                            onView={() => setViewingRule(rule)}
                            onDelete={() => setDeletingRule({ rule, index: originalIndex })}
                            outboundDisplayName={resolveOutboundName(rule.outboundTag || '')}
                          />
                        ))
                      )}
                    </CollapsibleContent>
                  </Collapsible>

                  {/* 默认出站 */}
                  <div>
                    <div className='text-sm font-medium mb-2'>默认出站 <span className='text-xs text-muted-foreground font-normal'>无规则匹配时</span></div>
                    {defaultOutbound ? (
                      <div className='flex items-center gap-2 py-2 px-3 rounded-md border bg-card text-sm'>
                        <Badge variant='outline' className='text-xs'>{defaultOutbound.protocol || 'unknown'}</Badge>
                        <span className='font-medium'>{defaultOutbound.tag || '(无tag)'}</span>
                      </div>
                    ) : (
                      <div className='text-xs text-muted-foreground py-3 text-center border rounded-md'>无出站配置</div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 底部操作 */}
          {!isLoading && (
            <div className='flex items-center gap-2 pt-3 border-t'>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size='sm'><Plus className='size-4 mr-1' />快捷添加<ChevronDown className='size-4 ml-1' /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' className='w-56'>
                  <DropdownMenuItem onClick={() => handleQuickAdd('ban_bt')}>禁止 BT</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleQuickAdd('ban_geoip_cn')}>禁止访问大陆 IP</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleQuickAdd('fix_openai')}>OpenAI 直连</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleQuickAdd('ban_private')}>禁止内网访问</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleQuickAdd('rfc_emby')}>RFC EMBY (需选择出站)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleQuickAdd('tiktok_unlock')}>抖音解锁 (需选择出站)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant='outline' size='sm' onClick={() => { setCustomScope('dedicated'); setCustomOpen(true) }}>
                <Plus className='size-4 mr-1' />自定义规则
              </Button>
              <div className='flex-1' />
              <Button variant='outline' size='sm' onClick={() => onOpenChange(false)}>关闭</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 查看规则 JSON */}
      <Dialog open={!!viewingRule} onOpenChange={o => !o && setViewingRule(null)}>
        <DialogContent className='max-w-3xl max-h-[80vh]'>
          <DialogHeader><DialogTitle>路由规则详情</DialogTitle></DialogHeader>
          <div className='overflow-auto max-h-[60vh]'>
            <pre className='bg-muted p-4 rounded-lg text-xs'>{JSON.stringify(viewingRule, null, 2)}</pre>
          </div>
          <DialogFooter><Button onClick={() => setViewingRule(null)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deletingRule} onOpenChange={o => !o && setDeletingRule(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除规则</AlertDialogTitle>
            <AlertDialogDescription>确定要删除此路由规则吗？删除后将自动重启 Xray 生效。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className='bg-red-600 hover:bg-red-700' onClick={() => {
              if (deletingRule) removeRuleMutation.mutate(deletingRule.index)
              setDeletingRule(null)
            }}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 选择出站 */}
      <Dialog open={outboundSelectOpen} onOpenChange={setOutboundSelectOpen}>
        <DialogContent className='max-w-md'>
          <DialogHeader><DialogTitle>选择出站</DialogTitle></DialogHeader>
          <Select value={selectedOutbound} onValueChange={setSelectedOutbound}>
            <SelectTrigger><SelectValue placeholder='选择出站' /></SelectTrigger>
            <SelectContent>
              {outbounds.map((o: any) => <SelectItem key={o.tag} value={o.tag}>{o.tag} ({o.protocol})</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOutboundSelectOpen(false)}>取消</Button>
            <Button onClick={handleConfirmOutbound} disabled={!selectedOutbound}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 自定义规则 */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className='max-w-md'>
          <DialogHeader><DialogTitle>添加自定义规则</DialogTitle><DialogDescription>为入站 {inboundTag} 添加路由规则</DialogDescription></DialogHeader>
          <div className='space-y-4 py-2'>
            <div className='space-y-2'>
              <Label>作用范围</Label>
              <Select value={customScope} onValueChange={(v: any) => setCustomScope(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='dedicated'>仅此入站 ({inboundTag})</SelectItem>
                  <SelectItem value='global'>全局 (所有入站)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label>规则类型</Label>
              <Select value={customType} onValueChange={(v: any) => setCustomType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='domain'>域名 (domain)</SelectItem>
                  <SelectItem value='ip'>IP 地址 (ip)</SelectItem>
                  <SelectItem value='protocol'>协议 (protocol)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label>匹配条件</Label>
              <Input placeholder='多个条件用逗号分隔' value={customValue} onChange={e => setCustomValue(e.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label>出站</Label>
              <Select value={customOutbound} onValueChange={setCustomOutbound}>
                <SelectTrigger><SelectValue placeholder='选择出站' /></SelectTrigger>
                <SelectContent>
                  {outbounds.map((o: any) => <SelectItem key={o.tag} value={o.tag}>{o.tag} ({o.protocol})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label>标记 (可选)</Label>
              <Input placeholder='规则标记' value={customMarktag} onChange={e => setCustomMarktag(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCustomOpen(false)}>取消</Button>
            <Button onClick={handleAddCustom} disabled={!customValue || !customOutbound}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
