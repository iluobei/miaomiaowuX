// @ts-nocheck
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Edit2, RefreshCw, Trash2, Eye, Plus, Server, GripVertical, Cloud } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { OutboundWizard } from '@/components/xray/outbound-wizard'
import { ServerSelector } from '@/components/server-selector'
import { useServerStore } from '@/stores/server-store'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyStateCard } from '@/components/ui/empty-state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TableCard } from '@/components/ui/table-card'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import type { XrayOutbound } from '@/lib/xray-presets'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'

export const Route = createFileRoute('/xray-outbounds/')({
  component: XrayOutboundsPage,
})

interface OutboundItem {
  server_id: number
  server_name: string
  outbound: XrayOutbound
}

// Sortable Outbound Card Component
interface SortableOutboundCardProps {
  item: OutboundItem
  isSimpleOutbound: (protocol: string) => boolean
  getUserCount: (outbound: XrayOutbound) => number
  onEditFreedom: (item: OutboundItem) => void
  onView: (outbound: XrayOutbound) => void
  onDelete: (item: OutboundItem) => void
  isDraggingEnabled: boolean
  t: (key: string) => string
  tc: (key: string) => string
}

function SortableOutboundCard({
  item,
  isSimpleOutbound,
  getUserCount,
  onEditFreedom,
  onView,
  onDelete,
  isDraggingEnabled,
  t,
  tc,
}: SortableOutboundCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `${item.server_id}-${item.outbound.tag}`,
    disabled: !isDraggingEnabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const outbound = item.outbound
  const serverName = item.server_name
  const userCount = getUserCount(outbound)

  // Extract address and port from outbound settings
  let address = '-'
  let port = '-'

  if (outbound.settings?.vnext && Array.isArray(outbound.settings.vnext) && outbound.settings.vnext.length > 0) {
    const vnext = outbound.settings.vnext[0]
    address = vnext.address || '-'
    port = vnext.port || '-'
  } else if (outbound.settings?.servers && Array.isArray(outbound.settings.servers) && outbound.settings.servers.length > 0) {
    const server = outbound.settings.servers[0]
    address = server.address || '-'
    port = server.port || '-'
  }

  return (
    <Card ref={setNodeRef} style={style}>
      <CardHeader className="pb-3">
        {/* Top center drag handle */}
        {isDraggingEnabled && (
          <div className="flex justify-center -mt-2 mb-2">
            <div
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing hover:bg-accent rounded-md px-3 py-1 transition-colors group"
              style={{ touchAction: 'none' }}
            >
              <GripVertical className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{outbound.tag}</CardTitle>
            <CardDescription className="mt-1">
              {serverName}
            </CardDescription>
          </div>
          <Badge variant="secondary">{outbound.protocol}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isSimpleOutbound(outbound.protocol) ? (
          // Freedom/Blackhole: show domainStrategy if available
          <>
            {outbound.settings?.domainStrategy && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('outbounds.domainStrategy')}</span>
                <span className="text-sm font-medium">{outbound.settings.domainStrategy}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t('outbounds.type')}</span>
              <span className="text-sm font-medium">
                {outbound.protocol === 'freedom' ? t('outbounds.directOutbound') : t('outbounds.blockOutbound')}
              </span>
            </div>
          </>
        ) : (
          // Regular outbounds: show address, port, user count
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t('outbounds.address')}</span>
              <span className="text-sm font-medium truncate max-w-[200px]" title={address as string}>{address}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t('outbounds.portLabel')}</span>
              <span className="text-sm font-medium">{port}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t('outbounds.userCount')}</span>
              <span className="text-sm font-medium">{userCount}</span>
            </div>
          </>
        )}
      </CardContent>
      <CardFooter className="flex gap-2 flex-wrap">
        {outbound.protocol === 'freedom' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditFreedom(item)}
          >
            <Edit2 className="h-4 w-4 mr-1" />
            {tc('actions.edit')}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onView(outbound)}
        >
          <Eye className="h-4 w-4 mr-1" />
          {tc('actions.view')}
        </Button>
        {!isSimpleOutbound(outbound.protocol) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDelete(item)}
            className="text-red-600 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {tc('actions.delete')}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

function XrayOutboundsPage() {
  const { t } = useTranslation('xray')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const search = useSearch({ from: '/xray-outbounds/' })
  const { selectedRemoteServerId, setSelectedServer } = useServerStore()
  const isRemoteMode = selectedRemoteServerId !== null

  // Read remote server from URL params on first load
  useEffect(() => {
    if (search.remote_server_id) {
      setSelectedServer(search.remote_server_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [editingFreedomOutbound, setEditingFreedomOutbound] = useState<OutboundItem | null>(null)
  const [freedomDomainStrategy, setFreedomDomainStrategy] = useState<string>('AsIs')
  const [viewingOutbound, setViewingOutbound] = useState<XrayOutbound | null>(null)
  const [isWizardDialogOpen, setIsWizardDialogOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [hideDefaultOutbounds, setHideDefaultOutbounds] = useState(true)
  // Drag and drop state
  const [activeId, setActiveId] = useState<string | null>(null)

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 100,
        tolerance: 5,
      },
    })
  )

  // Fetch remote server info
  const { data: remoteServerData } = useQuery({
    queryKey: ['remote-server', selectedRemoteServerId],
    queryFn: async () => {
      const response = await api.get('/api/admin/remote-servers')
      const servers = response.data.servers || []
      return servers.find((s: any) => s.id === selectedRemoteServerId)
    },
    enabled: isRemoteMode,
  })

  // Fetch outbound data - remote server only
  const { data: outboundsData, isLoading } = useQuery({
    queryKey: ['remote-outbounds', selectedRemoteServerId],
    queryFn: async () => {
      if (!selectedRemoteServerId) return { success: true, outbounds: [] }
      const response = await api.get(`/api/admin/remote/outbounds?server_id=${selectedRemoteServerId}`)
      const outbounds = response.data.outbounds || []
      return {
        success: true,
        outbounds: outbounds.map((outbound: any) => ({
          server_id: selectedRemoteServerId,
          server_name: remoteServerData?.name || '',
          outbound,
        })),
      }
    },
    enabled: isRemoteMode,
  })

  // Fetch remote server list
  const { data: remoteServersData } = useQuery({
    queryKey: ['remote-servers'],
    queryFn: async () => {
      const response = await api.get('/api/admin/remote-servers')
      return response.data
    },
  })

  // Remote server mutations
  const remoteUpdateOutboundMutation = useMutation({
    mutationFn: async ({ outbound }: { outbound: XrayOutbound }) => {
      await api.post(`/api/admin/remote/outbounds?server_id=${selectedRemoteServerId}`, {
        action: 'remove',
        tag: outbound.tag,
      })
      const response = await api.post(`/api/admin/remote/outbounds?server_id=${selectedRemoteServerId}`, {
        action: 'add',
        outbound,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remote-outbounds', selectedRemoteServerId] })
      toast.success(t('outbounds.outboundUpdated'))
      setEditingFreedomOutbound(null)
    },
    onError: handleServerError,
  })

  const remoteDeleteMutation = useMutation({
    mutationFn: async ({ outbound }: { outbound: XrayOutbound }) => {
      const response = await api.post(`/api/admin/remote/outbounds?server_id=${selectedRemoteServerId}`, {
        action: 'remove',
        tag: outbound.tag,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remote-outbounds', selectedRemoteServerId] })
      toast.success(t('outbounds.outboundDeleted'))
    },
    onError: handleServerError,
  })

  const remoteAddOutboundMutation = useMutation({
    mutationFn: async ({ outbound }: { outbound: XrayOutbound }) => {
      const response = await api.post(`/api/admin/remote/outbounds?server_id=${selectedRemoteServerId}`, {
        action: 'add',
        outbound,
      })
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['remote-outbounds', selectedRemoteServerId] })
      if (data.success) {
        toast.success(data.message || t('outbounds.outboundAdded'))
      } else {
        toast.error(data.message || t('outbounds.outboundAddFailed'), {
          description: data.error,
        })
      }
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

    // Update domainStrategy - only include if not AsIs
    if (freedomDomainStrategy && freedomDomainStrategy !== 'AsIs') {
      updatedSettings.domainStrategy = freedomDomainStrategy
    } else {
      delete updatedSettings.domainStrategy
    }

    const updatedOutbound = {
      ...outbound,
      settings: updatedSettings,
    }

    remoteUpdateOutboundMutation.mutate({ outbound: updatedOutbound })
    setEditingFreedomOutbound(null)
  }

  const handleOutboundSubmit = async (serverIds: number[], outbound: XrayOutbound, tag: string) => {
    const trimmedTag = tag?.trim() || outbound.tag || ''
    if (!trimmedTag) {
      toast.error(t('outbounds.fillTag'))
      return
    }

    const baseOutbound: XrayOutbound = {
      ...outbound,
      tag: trimmedTag,
    }

    try {
      await remoteAddOutboundMutation.mutateAsync({ outbound: baseOutbound })
      toast.success(t('outbounds.outboundAddedToRemote'))
      setIsWizardDialogOpen(false)
    } catch (error) {
      // Error handled by handleServerError
    }
  }

  const outbounds = outboundsData?.outbounds || []

  // Filter outbounds based on hideDefaultOutbounds
  const filteredOutbounds = useMemo(() => {
    let result: OutboundItem[] = outbounds

    // Filter default outbounds
    if (hideDefaultOutbounds) {
      result = result.filter((item) => {
        const tag = item.outbound.tag?.toLowerCase()
        return tag !== 'block' && tag !== 'direct'
      })
    }

    return result
  }, [outbounds, hideDefaultOutbounds])

  const getUserCount = (outbound: XrayOutbound) => {
    if (!outbound.settings) return 0

    // Freedom and Blackhole don't have users
    if (outbound.protocol === 'freedom' || outbound.protocol === 'blackhole') {
      return -1 // Use -1 to indicate no user concept
    }

    // For outbounds using vnext structure (VLESS, VMess, Trojan)
    if (Array.isArray(outbound.settings.vnext) && outbound.settings.vnext.length > 0) {
      const vnext = outbound.settings.vnext[0]
      if (Array.isArray(vnext.users)) {
        return vnext.users.length
      }
    }

    // For outbounds using servers structure (Shadowsocks, Socks5)
    if (Array.isArray(outbound.settings.servers)) {
      return outbound.settings.servers.length
    }

    return 0
  }

  // Check if outbound is a simple type (Freedom/Blackhole)
  const isSimpleOutbound = (protocol: string) => {
    return protocol === 'freedom' || protocol === 'blackhole'
  }

  // Get sortable IDs for the current server's outbounds
  const sortableIds = useMemo(() => {
    return filteredOutbounds.map((item: OutboundItem) => `${item.server_id}-${item.outbound.tag}`)
  }, [filteredOutbounds])

  // Drag and drop handlers (disabled for now)
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
  }

  // Get the active item for drag overlay
  const activeItem = useMemo(() => {
    if (!activeId) return null
    return filteredOutbounds.find(
      (item: OutboundItem) => `${item.server_id}-${item.outbound.tag}` === activeId
    )
  }, [activeId, filteredOutbounds])

  return (
    <div className="container mx-auto py-8 px-4 pt-24">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">{t('outbounds.title')}</h1>
          <p className="text-gray-600 flex items-center gap-2">
            <Cloud className="h-4 w-4 text-green-500" />
            {isRemoteMode
              ? t('outbounds.remoteServerConfig', { name: remoteServerData?.name || '', count: filteredOutbounds.length })
              : t('outbounds.selectServerFirst')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ServerSelector />
          <Button
            variant={hideDefaultOutbounds ? 'default' : 'outline'}
            size="sm"
            onClick={() => setHideDefaultOutbounds(!hideDefaultOutbounds)}
          >
            {hideDefaultOutbounds ? t('outbounds.hideDefaultOutbounds') : t('outbounds.showDefaultOutbounds')}
          </Button>
          <ViewToggle view={viewMode} onViewChange={setViewMode} />
          <Button
            disabled={!isRemoteMode}
            onClick={() => {
              setIsWizardDialogOpen(true)
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('outbounds.addOutbound')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p className="text-gray-600">{tc('actions.loading')}</p>
        </div>
      ) : filteredOutbounds.length === 0 ? (
        <EmptyStateCard
          title={t('outbounds.noOutbounds')}
          description={t('outbounds.noOutboundsDesc')}
        />
      ) : viewMode === 'card' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredOutbounds.map((item: OutboundItem) => (
                <SortableOutboundCard
                  key={`${item.server_id}-${item.outbound.tag}`}
                  item={item}
                  isSimpleOutbound={isSimpleOutbound}
                  getUserCount={getUserCount}
                  onEditFreedom={handleEditFreedom}
                  onView={setViewingOutbound}
                  onDelete={handleDelete}
                  isDraggingEnabled={false}
                  t={t}
                  tc={tc}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeItem && (
              <Card className="shadow-lg opacity-90">
                <CardHeader className="pb-3">
                  <div className="flex justify-center -mt-2 mb-2">
                    <div className="bg-accent rounded-md px-3 py-1">
                      <GripVertical className="h-4 w-4 text-foreground" />
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">{activeItem.outbound.tag}</CardTitle>
                      <CardDescription className="mt-1">
                        {activeItem.server_name}
                      </CardDescription>
                    </div>
                    <Badge variant="secondary">{activeItem.outbound.protocol}</Badge>
                  </div>
                </CardHeader>
              </Card>
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('fields.tag')}</TableHead>
                <TableHead>{t('outbounds.serverInfo')}</TableHead>
                <TableHead>{t('inbounds.protocolLabel')}</TableHead>
                <TableHead>{t('outbounds.address')}</TableHead>
                <TableHead>{t('outbounds.portLabel')}</TableHead>
                <TableHead className="text-right">{tc('actions.edit')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOutbounds.map((item: OutboundItem) => {
                const outbound = item.outbound
                const serverName = item.server_name
                let address = '-'
                let port = '-'
                if (outbound.settings?.vnext && Array.isArray(outbound.settings.vnext) && outbound.settings.vnext.length > 0) {
                  const vnext = outbound.settings.vnext[0]
                  address = vnext.address || '-'
                  port = vnext.port || '-'
                } else if (outbound.settings?.servers && Array.isArray(outbound.settings.servers) && outbound.settings.servers.length > 0) {
                  const server = outbound.settings.servers[0]
                  address = server.address || '-'
                  port = server.port || '-'
                }
                return (
                  <TableRow key={`${item.server_id}-${outbound.tag}`}>
                    <TableCell className="font-medium">{outbound.tag}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Server className="h-3 w-3 text-blue-500" />
                        {serverName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{outbound.protocol}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{address}</TableCell>
                    <TableCell>{port}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {outbound.protocol === 'freedom' && (
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleEditFreedom(item)} title={tc('actions.edit')}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setViewingOutbound(outbound)} title={tc('actions.view')}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {!isSimpleOutbound(outbound.protocol) && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-red-500 hover:text-red-600" onClick={() => handleDelete(item)} title={tc('actions.delete')}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableCard>
      )}

      {/* Freedom Edit Dialog */}
      <Dialog open={!!editingFreedomOutbound} onOpenChange={(open) => !open && setEditingFreedomOutbound(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('outbounds.editFreedomOutbound')} - {editingFreedomOutbound?.outbound.tag}</DialogTitle>
            <DialogDescription>
              {t('outbounds.configDomainStrategy')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('outbounds.serverInfo')}</label>
              <div className="text-sm text-muted-foreground">{editingFreedomOutbound?.server_name}</div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">{t('outbounds.domainStrategy')}</label>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  {t('outbounds.domainStrategyWhenTarget')}
                </p>
              </div>

              {/* AsIs option */}
              <div className="space-y-2">
                <Button
                  variant={freedomDomainStrategy === 'AsIs' ? 'default' : 'outline'}
                  className="w-full justify-start"
                  onClick={() => setFreedomDomainStrategy('AsIs')}
                >
                  {t('outbounds.asIsDefault')}
                </Button>
                <p className="text-xs text-muted-foreground pl-4">
                  {t('outbounds.asIsDesc')}
                </p>
              </div>

              {/* UseIP options */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">{t('outbounds.useIpSeries')} ({t('outbounds.useIpFallbackDesc')})</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {['UseIP', 'UseIPv6v4', 'UseIPv6', 'UseIPv4v6', 'UseIPv4'].map((value) => (
                    <Button
                      key={value}
                      variant={freedomDomainStrategy === value ? 'default' : 'outline'}
                      size="sm"
                      className="justify-start"
                      onClick={() => setFreedomDomainStrategy(value)}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground pl-4">
                  {t('outbounds.useIpDesc')}
                </p>
              </div>

              {/* ForceIP options */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">{t('outbounds.forceIpSeries')} ({t('outbounds.forceIpFailDesc')})</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {['ForceIP', 'ForceIPv6v4', 'ForceIPv6', 'ForceIPv4v6', 'ForceIPv4'].map((value) => (
                    <Button
                      key={value}
                      variant={freedomDomainStrategy === value ? 'default' : 'outline'}
                      size="sm"
                      className="justify-start"
                      onClick={() => setFreedomDomainStrategy(value)}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground pl-4">
                  {t('outbounds.forceIpDesc')}
                </p>
              </div>

              {/* Current selection display */}
              <div className="mt-4 p-3 bg-muted rounded-lg">
                <p className="text-sm">
                  {t('outbounds.currentSelection')}: <span className="font-medium">{freedomDomainStrategy}</span>
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingFreedomOutbound(null)}
            >
              {tc('actions.cancel')}
            </Button>
            <Button onClick={handleFreedomSubmit} disabled={remoteUpdateOutboundMutation.isPending}>
              {remoteUpdateOutboundMutation.isPending ? tc('actions.saving') : tc('actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewingOutbound} onOpenChange={(open) => !open && setViewingOutbound(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{t('outbounds.viewOutbound')} - {viewingOutbound?.tag}</DialogTitle>
            <DialogDescription>
              {t('outbounds.viewOutboundJson')}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg text-xs">
              {JSON.stringify(viewingOutbound, null, 2)}
            </pre>
          </div>
          <DialogFooter>
            <Button onClick={() => setViewingOutbound(null)}>{tc('actions.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Outbound Wizard Dialog */}
      <Dialog
        open={isWizardDialogOpen}
        onOpenChange={(open) => {
          setIsWizardDialogOpen(open)
        }}
      >
        <DialogContent className="w-[95vw] !max-w-none md:w-[90vw] lg:w-[80vw] max-h-[90vh] overflow-hidden sm:max-w-none flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('outbounds.addOutboundWizard')}</DialogTitle>
            <DialogDescription>
              {t('outbounds.addOutboundWizardDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <OutboundWizard
              servers={[]}
              selectedServerIds={[]}
              onCancel={() => setIsWizardDialogOpen(false)}
              onSubmit={handleOutboundSubmit}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
