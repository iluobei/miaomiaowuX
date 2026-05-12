// @ts-nocheck
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Edit2, RefreshCw, Trash2, Eye, Plus, Cloud } from 'lucide-react'

import { InboundWizard } from '@/components/xray/inbound-wizard'
import { ServerSelector } from '@/components/server-selector'
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
import { TableCard } from '@/components/ui/table-card'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { ArrayField } from '@/components/xray/array-field'
import { clientFields } from '@/lib/xray-form-fields'
import type { XrayInbound } from '@/lib/xray-presets'
import { useServerStore } from '@/stores/server-store'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'

export const Route = createFileRoute('/xray-inbounds/')({
  component: XrayInboundsPage,
})

interface InboundItem {
  server_id: number
  server_name: string
  inbound: XrayInbound
}

function XrayInboundsPage() {
  const { t } = useTranslation('xray')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const search = useSearch({ from: '/xray-inbounds/' })
  const { selectedRemoteServerId, setSelectedServer } = useServerStore()
  const isRemoteMode = selectedRemoteServerId !== null

  // Read remote server from URL params on first load
  useEffect(() => {
    if (search.remote_server_id) {
      setSelectedServer(search.remote_server_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [editingInbound, setEditingInbound] = useState<InboundItem | null>(null)
  const [viewingInbound, setViewingInbound] = useState<XrayInbound | null>(null)
  const [editedUsers, setEditedUsers] = useState<any[]>([])
  const [isWizardDialogOpen, setIsWizardDialogOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('card')

  // Delete confirm dialog state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deletingInbound, setDeletingInbound] = useState<InboundItem | null>(null)

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

  // Fetch inbound data - remote server only
  const { data: inboundsData, isLoading } = useQuery({
    queryKey: ['remote-inbounds', selectedRemoteServerId, remoteServerData?.name],
    queryFn: async () => {
      if (!selectedRemoteServerId) return { success: true, inbounds: [] }
      const response = await api.get(`/api/admin/remote/inbounds?server_id=${selectedRemoteServerId}`)
      const inbounds = response.data.inbounds || []
      return {
        success: true,
        inbounds: inbounds.map((inbound: any) => ({
          server_id: selectedRemoteServerId,
          server_name: remoteServerData?.name || '',
          inbound,
        })),
      }
    },
    enabled: isRemoteMode && !!remoteServerData,
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
  const remoteUpdateInboundMutation = useMutation({
    mutationFn: async ({ inbound }: { inbound: XrayInbound }) => {
      await api.post(`/api/admin/remote/inbounds?server_id=${selectedRemoteServerId}`, {
        action: 'remove',
        tag: inbound.tag,
      })
      const response = await api.post(`/api/admin/remote/inbounds?server_id=${selectedRemoteServerId}`, {
        action: 'add',
        inbound,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remote-inbounds', selectedRemoteServerId] })
      toast.success(t('inbounds.inboundUpdated'))
      setEditingInbound(null)
    },
    onError: handleServerError,
  })

  const remoteDeleteMutation = useMutation({
    mutationFn: async ({ inbound }: { inbound: XrayInbound }) => {
      const response = await api.post(`/api/admin/remote/inbounds?server_id=${selectedRemoteServerId}`, {
        action: 'remove',
        tag: inbound.tag,
      })
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['remote-inbounds', selectedRemoteServerId] })
      if (data.success) {
        toast.success(data.message || t('inbounds.inboundDeleted'))
      } else {
        toast.error(data.message || t('inbounds.inboundDeleteFailed'), {
          description: data.error,
        })
      }
    },
    onError: handleServerError,
  })

  const remoteAddInboundMutation = useMutation({
    mutationFn: async ({ inbound }: { inbound: XrayInbound }) => {
      const response = await api.post(`/api/admin/remote/inbounds?server_id=${selectedRemoteServerId}`, {
        action: 'add',
        inbound,
      })
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['remote-inbounds', selectedRemoteServerId] })
      if (data.success) {
        toast.success(data.message || t('inbounds.inboundAdded'))
      } else {
        toast.error(data.message || t('inbounds.inboundAddFailed'), {
          description: data.error,
        })
      }
    },
    onError: handleServerError,
  })

  const handleEdit = (item: InboundItem) => {
    setEditingInbound(item)
    const inbound = item.inbound

    // Extract users based on protocol
    let users = []
    if (inbound.settings?.clients) {
      users = inbound.settings.clients
    } else if (inbound.settings?.accounts) {
      users = inbound.settings.accounts
    }
    setEditedUsers(users)
  }

  const handleDelete = (item: InboundItem) => {
    setDeletingInbound(item)
    setIsDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (deletingInbound) {
      remoteDeleteMutation.mutate({ inbound: deletingInbound.inbound })
    }
    setIsDeleteDialogOpen(false)
    setDeletingInbound(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingInbound) return

    const inbound = editingInbound.inbound

    // Update settings with edited users
    const updatedSettings = { ...inbound.settings }
    if (inbound.settings?.clients) {
      updatedSettings.clients = editedUsers
    } else if (inbound.settings?.accounts) {
      updatedSettings.accounts = editedUsers
    }

    const updatedInbound = {
      ...inbound,
      settings: updatedSettings,
    }

    remoteUpdateInboundMutation.mutate({ inbound: updatedInbound })
  }

  const handleInboundSubmit = async (serverIds: number[], inbound: XrayInbound, tag: string) => {
    const trimmedTag = tag?.trim() || inbound.tag || ''
    if (!trimmedTag) {
      toast.error(t('inbounds.fillTag'))
      return
    }

    const baseInbound: XrayInbound = {
      ...inbound,
      tag: trimmedTag,
    }

    try {
      await remoteAddInboundMutation.mutateAsync({ inbound: baseInbound })
      toast.success(t('inbounds.inboundAddedToRemote'))
      setIsWizardDialogOpen(false)
    } catch (error) {
      // Error handled by handleServerError
    }
  }

  const inbounds = inboundsData?.inbounds || []
  const usedPorts = useMemo(() => inbounds.map((item: InboundItem) => Number(item.inbound.port)).filter(Boolean), [inbounds])

  // Filter inbounds to exclude api inbound
  const filteredInbounds = useMemo(() => {
    return inbounds.filter((item: InboundItem) => item.inbound.tag !== 'api')
  }, [inbounds])

  const getUserCount = (inbound: XrayInbound) => {
    if (!inbound.settings) return 0

    // Check for clients array (VLESS, VMess, Trojan, Shadowsocks2022)
    if (Array.isArray(inbound.settings.clients)) {
      return inbound.settings.clients.length
    }

    // Check for accounts array (Socks5, HTTP)
    if (Array.isArray(inbound.settings.accounts)) {
      return inbound.settings.accounts.length
    }

    return 0
  }

  // Get user fields based on protocol
  const getUserFields = (protocol: string) => {
    const protocolKey = protocol === 'shadowsocks' ? 'Shadowsocks2022' :
                       protocol === 'socks' ? 'Socks5' :
                       protocol === 'http' ? 'HTTP' :
                       protocol === 'tunnel' ? 'Dokodemo' :
                       protocol.charAt(0).toUpperCase() + protocol.slice(1)

    return clientFields[protocolKey] || []
  }

  return (
    <div className="container mx-auto py-8 px-4 pt-24">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">{t('inbounds.title')}</h1>
          <p className="text-gray-600 flex items-center gap-2">
            <Cloud className="h-4 w-4 text-green-500" />
            {isRemoteMode
              ? t('inbounds.remoteServerConfig', { name: remoteServerData?.name || '', count: filteredInbounds.length })
              : t('inbounds.selectServerFirst')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ServerSelector />
          <ViewToggle view={viewMode} onViewChange={setViewMode} />
          <Button
            disabled={!isRemoteMode}
            onClick={() => {
              setIsWizardDialogOpen(true)
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('inbounds.addInbound')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p className="text-gray-600">{tc('actions.loading')}</p>
        </div>
      ) : filteredInbounds.length === 0 ? (
        <EmptyStateCard
          title={t('inbounds.noInbounds')}
          description={t('inbounds.noInboundsDesc')}
        />
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredInbounds.map((item: InboundItem) => {
            const inbound = item.inbound
            const serverName = item.server_name
            const serverId = item.server_id
            const userCount = getUserCount(inbound)

            return (
              <Card key={`${serverId}-${inbound.tag}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">{inbound.tag}</CardTitle>
                      <CardDescription className="mt-1 flex items-center gap-1">
                        <Cloud className="h-3 w-3 text-green-500" />
                        {serverName}
                      </CardDescription>
                    </div>
                    <Badge variant="secondary">{inbound.protocol}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t('inbounds.portLabel')}</span>
                    <span className="text-sm font-medium">{inbound.port}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t('inbounds.userCount')}</span>
                    <span className="text-sm font-medium">{userCount}</span>
                  </div>
                  {inbound.listen && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{t('inbounds.listenAddress')}</span>
                      <span className="text-sm font-medium">{inbound.listen}</span>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(item)}
                  >
                    <Edit2 className="h-4 w-4 mr-1" />
                    {tc('actions.edit')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewingInbound(inbound)}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    {tc('actions.view')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(item)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    {tc('actions.delete')}
                  </Button>
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
                <TableHead>{t('fields.tag')}</TableHead>
                <TableHead>{t('inbounds.serverLabel')}</TableHead>
                <TableHead>{t('inbounds.protocolLabel')}</TableHead>
                <TableHead>{t('inbounds.portLabel')}</TableHead>
                <TableHead>{t('inbounds.listenAddress')}</TableHead>
                <TableHead>{t('inbounds.userCount')}</TableHead>
                <TableHead className="text-right">{tc('actions.edit')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInbounds.map((item: InboundItem) => {
                const inbound = item.inbound
                const serverName = item.server_name
                const serverId = item.server_id
                const userCount = getUserCount(inbound)

                return (
                  <TableRow key={`${serverId}-${inbound.tag}`}>
                    <TableCell className="font-medium">{inbound.tag}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Cloud className="h-3 w-3 text-green-500" />
                        {serverName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{inbound.protocol}</Badge>
                    </TableCell>
                    <TableCell>{inbound.port}</TableCell>
                    <TableCell className="text-muted-foreground">{inbound.listen || '-'}</TableCell>
                    <TableCell>{userCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleEdit(item)} title={tc('actions.edit')}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setViewingInbound(inbound)} title={tc('actions.view')}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-red-500 hover:text-red-600" onClick={() => handleDelete(item)} title={tc('actions.delete')}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableCard>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingInbound} onOpenChange={(open) => !open && setEditingInbound(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('inbounds.editInbound')} - {editingInbound?.inbound.tag}</DialogTitle>
            <DialogDescription>
              {t('inbounds.editInboundUsers')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('inbounds.serverLabel')}</label>
                <div className="text-sm text-muted-foreground">{editingInbound?.server_name}</div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('inbounds.protocolLabel')}</label>
                <div className="text-sm text-muted-foreground">{editingInbound?.inbound.protocol}</div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('inbounds.portLabel')}</label>
                <div className="text-sm text-muted-foreground">{editingInbound?.inbound.port}</div>
              </div>
              {editingInbound && (
                <ArrayField
                  label={editingInbound.inbound.protocol === 'socks' || editingInbound.inbound.protocol === 'http' ? t('inbounds.accounts') : t('inbounds.users')}
                  fields={getUserFields(editingInbound.inbound.protocol)}
                  values={editedUsers}
                  onChange={setEditedUsers}
                  addButtonText={editingInbound.inbound.protocol === 'socks' || editingInbound.inbound.protocol === 'http' ? t('inbounds.addAccount') : t('inbounds.addUser')}
                  showUserSelect={true}
                  required
                />
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingInbound(null)}
              >
                {tc('actions.cancel')}
              </Button>
              <Button type="submit" disabled={remoteUpdateInboundMutation.isPending}>
                {remoteUpdateInboundMutation.isPending ? tc('actions.saving') : tc('actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewingInbound} onOpenChange={(open) => !open && setViewingInbound(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{t('inbounds.viewInbound')} - {viewingInbound?.tag}</DialogTitle>
            <DialogDescription>
              {t('inbounds.viewInboundJson')}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg text-xs">
              {JSON.stringify(viewingInbound, null, 2)}
            </pre>
          </div>
          <DialogFooter>
            <Button onClick={() => setViewingInbound(null)}>{tc('actions.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Inbound Wizard Dialog */}
      <Dialog
        open={isWizardDialogOpen}
        onOpenChange={(open) => {
          setIsWizardDialogOpen(open)
        }}
      >
        <DialogContent className="w-[95vw] !max-w-none md:w-[90vw] lg:w-[80vw] max-h-[90vh] overflow-hidden sm:max-w-none flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('inbounds.addInboundWizard')}</DialogTitle>
            <DialogDescription>
              {t('inbounds.addInboundWizardDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <InboundWizard
              servers={[]}
              selectedServerIds={selectedRemoteServerId ? [selectedRemoteServerId] : []}
              onCancel={() => setIsWizardDialogOpen(false)}
              onSubmit={handleInboundSubmit}
              skipServerSelection={true}
              usedPorts={usedPorts}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('inbounds.confirmDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('inbounds.confirmDeleteDesc', { tag: deletingInbound?.inbound.tag })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingInbound(null)}>{tc('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              {tc('actions.confirmDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
