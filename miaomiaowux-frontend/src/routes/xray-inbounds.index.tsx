// @ts-nocheck
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
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
  const queryClient = useQueryClient()
  const search = useSearch({ from: '/xray-inbounds/' })
  const { selectedRemoteServerId, setSelectedServer } = useServerStore()
  const isRemoteMode = selectedRemoteServerId !== null

  // 从 URL 参数读取并设置选中的远程服务器（仅在首次加载时）
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

  // 删除确认对话框状态
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deletingInbound, setDeletingInbound] = useState<InboundItem | null>(null)

  // 获取远程服务器信息
  const { data: remoteServerData } = useQuery({
    queryKey: ['remote-server', selectedRemoteServerId],
    queryFn: async () => {
      const response = await api.get('/api/admin/remote-servers')
      const servers = response.data.servers || []
      return servers.find((s: any) => s.id === selectedRemoteServerId)
    },
    enabled: isRemoteMode,
  })

  // 获取入站数据 - 仅远程服务器
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
          server_name: remoteServerData?.name || '远程服务器',
          inbound,
        })),
      }
    },
    enabled: isRemoteMode && !!remoteServerData,
  })

  // 获取远程服务器列表
  const { data: remoteServersData } = useQuery({
    queryKey: ['remote-servers'],
    queryFn: async () => {
      const response = await api.get('/api/admin/remote-servers')
      return response.data
    },
  })

  // 远程服务器 mutations
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
      toast.success('入站已更新')
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
        toast.success(data.message || '入站已删除')
      } else {
        toast.error(data.message || '删除入站失败', {
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
        toast.success(data.message || '入站已添加')
      } else {
        toast.error(data.message || '添加入站失败', {
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
      toast.error('请填写标签')
      return
    }

    const baseInbound: XrayInbound = {
      ...inbound,
      tag: trimmedTag,
    }

    try {
      await remoteAddInboundMutation.mutateAsync({ inbound: baseInbound })
      toast.success('入站已添加到远程服务器')
      setIsWizardDialogOpen(false)
    } catch (error) {
      // 错误已通过 handleServerError 处理
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
          <h1 className="text-3xl font-bold mb-2">Xray 入站管理</h1>
          <p className="text-gray-600 flex items-center gap-2">
            <Cloud className="h-4 w-4 text-green-500" />
            {isRemoteMode
              ? `远程服务器 ${remoteServerData?.name || '远程服务器'} 的入站配置（共 ${filteredInbounds.length} 个）`
              : '请先选择一个远程服务器'}
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
            添加入站
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p className="text-gray-600">加载中...</p>
        </div>
      ) : filteredInbounds.length === 0 ? (
        <EmptyStateCard
          title="暂无入站配置"
          description='点击"添加入站"按钮添加入站配置'
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
                    <span className="text-sm text-muted-foreground">端口</span>
                    <span className="text-sm font-medium">{inbound.port}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">用户数</span>
                    <span className="text-sm font-medium">{userCount}</span>
                  </div>
                  {inbound.listen && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">监听地址</span>
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
                    编辑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewingInbound(inbound)}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    查看
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(item)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    删除
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
                <TableHead>标签</TableHead>
                <TableHead>服务器</TableHead>
                <TableHead>协议</TableHead>
                <TableHead>端口</TableHead>
                <TableHead>监听地址</TableHead>
                <TableHead>用户数</TableHead>
                <TableHead className="text-right">操作</TableHead>
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
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => handleEdit(item)} title="编辑">
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setViewingInbound(inbound)} title="查看">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-red-500 hover:text-red-600" onClick={() => handleDelete(item)} title="删除">
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
            <DialogTitle>编辑入站 - {editingInbound?.inbound.tag}</DialogTitle>
            <DialogDescription>
              编辑入站的用户配置
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">服务器</label>
                <div className="text-sm text-muted-foreground">{editingInbound?.server_name}</div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">协议</label>
                <div className="text-sm text-muted-foreground">{editingInbound?.inbound.protocol}</div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">端口</label>
                <div className="text-sm text-muted-foreground">{editingInbound?.inbound.port}</div>
              </div>
              {editingInbound && (
                <ArrayField
                  label={editingInbound.inbound.protocol === 'socks' || editingInbound.inbound.protocol === 'http' ? '账户' : '用户'}
                  fields={getUserFields(editingInbound.inbound.protocol)}
                  values={editedUsers}
                  onChange={setEditedUsers}
                  addButtonText={editingInbound.inbound.protocol === 'socks' || editingInbound.inbound.protocol === 'http' ? '添加账户' : '添加用户'}
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
                取消
              </Button>
              <Button type="submit" disabled={remoteUpdateInboundMutation.isPending}>
                {remoteUpdateInboundMutation.isPending ? '保存中...' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewingInbound} onOpenChange={(open) => !open && setViewingInbound(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>查看入站配置 - {viewingInbound?.tag}</DialogTitle>
            <DialogDescription>
              完整的入站配置 JSON
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg text-xs">
              {JSON.stringify(viewingInbound, null, 2)}
            </pre>
          </div>
          <DialogFooter>
            <Button onClick={() => setViewingInbound(null)}>关闭</Button>
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
            <DialogTitle>添加入站 - 向导模式</DialogTitle>
            <DialogDescription>
              基于 Xray 官方示例配置，通过向导快速生成入站配置
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

      {/* 删除确认对话框 */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除入站</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除入站 "{deletingInbound?.inbound.tag}" 吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingInbound(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
