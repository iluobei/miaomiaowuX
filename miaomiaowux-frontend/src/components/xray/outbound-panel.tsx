// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Edit2, RefreshCw, Trash2, Eye, Plus } from 'lucide-react'

import { OutboundWizard } from '@/components/xray/outbound-wizard'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card'
import { EmptyStateCard } from '@/components/ui/empty-state'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import type { XrayOutbound } from '@/lib/xray-presets'

interface OutboundItem {
  server_id: number
  server_name: string
  outbound: XrayOutbound
}

interface OutboundPanelProps {
  serverId: number
  serverName: string
}

export function OutboundPanel({ serverId, serverName }: OutboundPanelProps) {
  const { t } = useTranslation('xray')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()

  const [editingFreedomOutbound, setEditingFreedomOutbound] = useState<OutboundItem | null>(null)
  const [freedomDomainStrategy, setFreedomDomainStrategy] = useState<string>('AsIs')
  const [viewingOutbound, setViewingOutbound] = useState<XrayOutbound | null>(null)
  const [isWizardDialogOpen, setIsWizardDialogOpen] = useState(false)
  const [hideDefaultOutbounds, setHideDefaultOutbounds] = useState(true)

  const { data: outboundsData, isLoading } = useQuery({
    queryKey: ['remote-outbounds', serverId, serverName],
    queryFn: async () => {
      const response = await api.get(`/api/admin/remote/outbounds?server_id=${serverId}`)
      const outbounds = response.data.outbounds || []
      return {
        success: true,
        outbounds: outbounds.map((outbound: any) => ({
          server_id: serverId,
          server_name: serverName,
          outbound,
        })),
      }
    },
  })

  const remoteUpdateOutboundMutation = useMutation({
    mutationFn: async ({ outbound }: { outbound: XrayOutbound }) => {
      await api.post(`/api/admin/remote/outbounds?server_id=${serverId}`, {
        action: 'remove', tag: outbound.tag,
      })
      const response = await api.post(`/api/admin/remote/outbounds?server_id=${serverId}`, {
        action: 'add', outbound,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remote-outbounds', serverId] })
      toast.success(t('outbounds.outboundUpdated'))
      setEditingFreedomOutbound(null)
    },
    onError: handleServerError,
  })

  const remoteDeleteMutation = useMutation({
    mutationFn: async ({ outbound }: { outbound: XrayOutbound }) => {
      const response = await api.post(`/api/admin/remote/outbounds?server_id=${serverId}`, {
        action: 'remove', tag: outbound.tag,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remote-outbounds', serverId] })
      toast.success(t('outbounds.outboundDeleted'))
    },
    onError: handleServerError,
  })

  const remoteAddOutboundMutation = useMutation({
    mutationFn: async ({ outbound }: { outbound: XrayOutbound }) => {
      const response = await api.post(`/api/admin/remote/outbounds?server_id=${serverId}`, {
        action: 'add', outbound,
      })
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['remote-outbounds', serverId] })
      data.success ? toast.success(data.message || t('outbounds.outboundAdded')) : toast.error(data.message || t('outbounds.outboundAddFailed'))
    },
    onError: handleServerError,
  })

  const handleDelete = (item: OutboundItem) => {
    if (confirm(t('outbounds.confirmDeletePrompt', { tag: item.outbound.tag }))) {
      remoteDeleteMutation.mutate({ outbound: item.outbound })
    }
  }

  const handleEditFreedom = (item: OutboundItem) => {
    setEditingFreedomOutbound(item)
    setFreedomDomainStrategy(item.outbound.settings?.domainStrategy || 'AsIs')
  }

  const handleFreedomSubmit = () => {
    if (!editingFreedomOutbound) return
    const outbound = editingFreedomOutbound.outbound
    const updatedSettings = { ...outbound.settings }
    if (freedomDomainStrategy && freedomDomainStrategy !== 'AsIs') {
      updatedSettings.domainStrategy = freedomDomainStrategy
    } else {
      delete updatedSettings.domainStrategy
    }
    remoteUpdateOutboundMutation.mutate({ outbound: { ...outbound, settings: updatedSettings } })
    setEditingFreedomOutbound(null)
  }

  const handleOutboundSubmit = async (serverIds: number[], outbound: XrayOutbound, tag: string) => {
    const trimmedTag = tag?.trim() || outbound.tag || ''
    if (!trimmedTag) { toast.error(t('outbounds.fillTag')); return }
    try {
      await remoteAddOutboundMutation.mutateAsync({ outbound: { ...outbound, tag: trimmedTag } })
      toast.success(t('outbounds.outboundAddedToRemote'))
      setIsWizardDialogOpen(false)
    } catch {}
  }

  const outbounds = outboundsData?.outbounds || []
  const filteredOutbounds = useMemo(() => {
    if (!hideDefaultOutbounds) return outbounds
    return outbounds.filter((item: OutboundItem) => {
      const tag = item.outbound.tag?.toLowerCase()
      return tag !== 'block' && tag !== 'direct'
    })
  }, [outbounds, hideDefaultOutbounds])

  const getUserCount = (outbound: XrayOutbound) => {
    if (!outbound.settings) return 0
    if (outbound.protocol === 'freedom' || outbound.protocol === 'blackhole') return -1
    if (Array.isArray(outbound.settings.vnext) && outbound.settings.vnext.length > 0) {
      return Array.isArray(outbound.settings.vnext[0].users) ? outbound.settings.vnext[0].users.length : 0
    }
    if (Array.isArray(outbound.settings.servers)) return outbound.settings.servers.length
    return 0
  }

  const isSimpleOutbound = (protocol: string) => protocol === 'freedom' || protocol === 'blackhole'

  const getOutboundAddress = (outbound: XrayOutbound) => {
    let address = '-', port = '-'
    if (outbound.settings?.vnext?.[0]) {
      address = outbound.settings.vnext[0].address || '-'
      port = outbound.settings.vnext[0].port || '-'
    } else if (outbound.settings?.servers?.[0]) {
      address = outbound.settings.servers[0].address || '-'
      port = outbound.settings.servers[0].port || '-'
    }
    return { address, port }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t('outbounds.remoteServerConfig', { name: serverName, count: filteredOutbounds.length })}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant={hideDefaultOutbounds ? 'default' : 'outline'}
            size="sm"
            onClick={() => setHideDefaultOutbounds(!hideDefaultOutbounds)}
          >
            {hideDefaultOutbounds ? t('outbounds.hideDefault') : t('outbounds.showDefault')}
          </Button>
          <Button size="sm" onClick={() => setIsWizardDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />{t('outbounds.addOutbound')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{tc('actions.loading')}</p>
        </div>
      ) : filteredOutbounds.length === 0 ? (
        <EmptyStateCard title={t('outbounds.noOutbounds')} description={t('outbounds.noOutboundsDescShort')} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredOutbounds.map((item: OutboundItem) => {
            const outbound = item.outbound
            const { address, port } = getOutboundAddress(outbound)
            return (
              <Card key={`${item.server_id}-${outbound.tag}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base truncate">{outbound.tag}</CardTitle>
                    <Badge variant="secondary" className="text-xs">{outbound.protocol}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  {isSimpleOutbound(outbound.protocol) ? (
                    <>
                      {outbound.settings?.domainStrategy && (
                        <div className="flex justify-between"><span className="text-muted-foreground">{t('outbounds.domainStrategy')}</span><span>{outbound.settings.domainStrategy}</span></div>
                      )}
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('outbounds.type')}</span><span>{outbound.protocol === 'freedom' ? t('outbounds.directOutbound') : t('outbounds.blockOutbound')}</span></div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('outbounds.address')}</span><span className="truncate max-w-[180px]" title={address as string}>{address}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('outbounds.portLabel')}</span><span>{port}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('outbounds.userCount')}</span><span>{getUserCount(outbound)}</span></div>
                    </>
                  )}
                </CardContent>
                <CardFooter className="flex gap-1.5 pt-2">
                  {outbound.protocol === 'freedom' && (
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleEditFreedom(item)}><Edit2 className="h-3 w-3 mr-1" />{tc('actions.edit')}</Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setViewingOutbound(outbound)}><Eye className="h-3 w-3 mr-1" />{tc('actions.view')}</Button>
                  {!isSimpleOutbound(outbound.protocol) && (
                    <Button variant="outline" size="sm" className="h-7 text-xs text-red-600 hover:text-red-700" onClick={() => handleDelete(item)}><Trash2 className="h-3 w-3 mr-1" />{tc('actions.delete')}</Button>
                  )}
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}

      {/* Freedom Edit Dialog */}
      <Dialog open={!!editingFreedomOutbound} onOpenChange={(open) => !open && setEditingFreedomOutbound(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('outbounds.editFreedomOutbound')} - {editingFreedomOutbound?.outbound.tag}</DialogTitle>
            <DialogDescription>{t('outbounds.configDomainStrategy')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Button variant={freedomDomainStrategy === 'AsIs' ? 'default' : 'outline'} className="w-full justify-start" onClick={() => setFreedomDomainStrategy('AsIs')}>{t('outbounds.asIsDefault')}</Button>
              <p className="text-xs text-muted-foreground pl-4">{t('outbounds.domainStrategyNotSpecial')}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('outbounds.useIpSeries')}</p>
              <div className="grid grid-cols-2 gap-2">
                {['UseIP', 'UseIPv6v4', 'UseIPv6', 'UseIPv4v6', 'UseIPv4'].map((v) => (
                  <Button key={v} variant={freedomDomainStrategy === v ? 'default' : 'outline'} size="sm" className="justify-start" onClick={() => setFreedomDomainStrategy(v)}>{v}</Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('outbounds.forceIpSeries')}</p>
              <div className="grid grid-cols-2 gap-2">
                {['ForceIP', 'ForceIPv6v4', 'ForceIPv6', 'ForceIPv4v6', 'ForceIPv4'].map((v) => (
                  <Button key={v} variant={freedomDomainStrategy === v ? 'default' : 'outline'} size="sm" className="justify-start" onClick={() => setFreedomDomainStrategy(v)}>{v}</Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditingFreedomOutbound(null)}>{tc('actions.cancel')}</Button>
            <Button onClick={handleFreedomSubmit} disabled={remoteUpdateOutboundMutation.isPending}>{remoteUpdateOutboundMutation.isPending ? tc('actions.saving') : tc('actions.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewingOutbound} onOpenChange={(open) => !open && setViewingOutbound(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{t('outbounds.viewOutbound')} - {viewingOutbound?.tag}</DialogTitle>
            <DialogDescription>{t('outbounds.viewOutboundJson')}</DialogDescription>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg text-xs">{JSON.stringify(viewingOutbound, null, 2)}</pre>
          </div>
          <DialogFooter><Button onClick={() => setViewingOutbound(null)}>{tc('actions.close')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Outbound Wizard Dialog */}
      <Dialog open={isWizardDialogOpen} onOpenChange={setIsWizardDialogOpen}>
        <DialogContent className="w-[95vw] !max-w-none md:w-[90vw] lg:w-[80vw] max-h-[90vh] overflow-hidden sm:max-w-none flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('outbounds.addOutboundWizard')}</DialogTitle>
            <DialogDescription>{t('outbounds.addOutboundWizardDescShort')}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <OutboundWizard servers={[]} selectedServerIds={[]} onCancel={() => setIsWizardDialogOpen(false)} onSubmit={handleOutboundSubmit} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
