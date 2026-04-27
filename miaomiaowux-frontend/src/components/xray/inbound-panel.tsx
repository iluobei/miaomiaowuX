// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Edit2, RefreshCw, Trash2, Eye, Plus } from 'lucide-react'

import { InboundWizard } from '@/components/xray/inbound-wizard'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card'
import { EmptyStateCard } from '@/components/ui/empty-state'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { ArrayField } from '@/components/xray/array-field'
import { clientFields } from '@/lib/xray-form-fields'
import type { XrayInbound } from '@/lib/xray-presets'

interface InboundItem {
  server_id: number
  server_name: string
  inbound: XrayInbound
}

interface InboundPanelProps {
  serverId: number
  serverName: string
}

export function InboundPanel({ serverId, serverName }: InboundPanelProps) {
  const queryClient = useQueryClient()

  const [editingInbound, setEditingInbound] = useState<InboundItem | null>(null)
  const [viewingInbound, setViewingInbound] = useState<XrayInbound | null>(null)
  const [editedUsers, setEditedUsers] = useState<any[]>([])
  const [isWizardDialogOpen, setIsWizardDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deletingInbound, setDeletingInbound] = useState<InboundItem | null>(null)

  const { data: inboundsData, isLoading } = useQuery({
    queryKey: ['remote-inbounds', serverId, serverName],
    queryFn: async () => {
      const response = await api.get(`/api/admin/remote/inbounds?server_id=${serverId}`)
      const inbounds = response.data.inbounds || []
      return {
        success: true,
        inbounds: inbounds.map((inbound: any) => ({
          server_id: serverId,
          server_name: serverName,
          inbound,
        })),
      }
    },
  })

  const remoteUpdateInboundMutation = useMutation({
    mutationFn: async ({ inbound }: { inbound: XrayInbound }) => {
      await api.post(`/api/admin/remote/inbounds?server_id=${serverId}`, {
        action: 'remove', tag: inbound.tag,
      })
      const response = await api.post(`/api/admin/remote/inbounds?server_id=${serverId}`, {
        action: 'add', inbound,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remote-inbounds', serverId] })
      toast.success('入站已更新')
      setEditingInbound(null)
    },
    onError: handleServerError,
  })

  const remoteDeleteMutation = useMutation({
    mutationFn: async ({ inbound }: { inbound: XrayInbound }) => {
      const response = await api.post(`/api/admin/remote/inbounds?server_id=${serverId}`, {
        action: 'remove', tag: inbound.tag,
      })
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['remote-inbounds', serverId] })
      data.success ? toast.success(data.message || '入站已删除') : toast.error(data.message || '删除入站失败')
    },
    onError: handleServerError,
  })

  const remoteAddInboundMutation = useMutation({
    mutationFn: async ({ inbound }: { inbound: XrayInbound }) => {
      const response = await api.post(`/api/admin/remote/inbounds?server_id=${serverId}`, {
        action: 'add', inbound,
      })
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['remote-inbounds', serverId] })
      data.success ? toast.success(data.message || '入站已添加') : toast.error(data.message || '添加入站失败')
    },
    onError: handleServerError,
  })

  const handleEdit = (item: InboundItem) => {
    setEditingInbound(item)
    const inbound = item.inbound
    let users = []
    if (inbound.settings?.clients) users = inbound.settings.clients
    else if (inbound.settings?.accounts) users = inbound.settings.accounts
    setEditedUsers(users)
  }

  const handleDelete = (item: InboundItem) => {
    setDeletingInbound(item)
    setIsDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (deletingInbound) remoteDeleteMutation.mutate({ inbound: deletingInbound.inbound })
    setIsDeleteDialogOpen(false)
    setDeletingInbound(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingInbound) return
    const inbound = editingInbound.inbound
    const updatedSettings = { ...inbound.settings }
    if (inbound.settings?.clients) updatedSettings.clients = editedUsers
    else if (inbound.settings?.accounts) updatedSettings.accounts = editedUsers
    remoteUpdateInboundMutation.mutate({ inbound: { ...inbound, settings: updatedSettings } })
  }

  const handleInboundSubmit = async (serverIds: number[], inbound: XrayInbound, tag: string) => {
    const trimmedTag = tag?.trim() || inbound.tag || ''
    if (!trimmedTag) { toast.error('请填写标签'); return }
    try {
      await remoteAddInboundMutation.mutateAsync({ inbound: { ...inbound, tag: trimmedTag } })
      toast.success('入站已添加到远程服务器')
      setIsWizardDialogOpen(false)
    } catch {}
  }

  const inbounds = inboundsData?.inbounds || []
  const filteredInbounds = useMemo(() => inbounds.filter((item: InboundItem) => item.inbound.tag !== 'api'), [inbounds])
  const usedPorts = useMemo(() => inbounds.map((item: InboundItem) => Number(item.inbound.port)).filter(Boolean), [inbounds])

  const getUserCount = (inbound: XrayInbound) => {
    if (Array.isArray(inbound.settings?.clients)) return inbound.settings.clients.length
    if (Array.isArray(inbound.settings?.accounts)) return inbound.settings.accounts.length
    return 0
  }

  const getUserFields = (protocol: string) => {
    const protocolKey = protocol === 'shadowsocks' ? 'Shadowsocks2022' :
      protocol === 'socks' ? 'Socks5' : protocol === 'http' ? 'HTTP' :
      protocol === 'tunnel' ? 'Dokodemo' : protocol === 'hysteria' ? 'Hysteria2' :
      protocol.charAt(0).toUpperCase() + protocol.slice(1)
    return clientFields[protocolKey] || []
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {serverName} 的入站配置（共 {filteredInbounds.length} 个）
        </p>
        <Button size="sm" onClick={() => setIsWizardDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />添加入站
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      ) : filteredInbounds.length === 0 ? (
        <EmptyStateCard title="暂无入站配置" description='点击"添加入站"按钮添加' />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredInbounds.map((item: InboundItem) => (
            <Card key={`${item.server_id}-${item.inbound.tag}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base truncate">{item.inbound.tag}</CardTitle>
                  <Badge variant="secondary" className="text-xs">{item.inbound.protocol}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">端口</span><span>{item.inbound.port}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">用户数</span><span>{getUserCount(item.inbound)}</span></div>
                {item.inbound.listen && <div className="flex justify-between"><span className="text-muted-foreground">监听</span><span>{item.inbound.listen}</span></div>}
              </CardContent>
              <CardFooter className="flex gap-1.5 pt-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleEdit(item)}><Edit2 className="h-3 w-3 mr-1" />编辑</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setViewingInbound(item.inbound)}><Eye className="h-3 w-3 mr-1" />查看</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs text-red-600 hover:text-red-700" onClick={() => handleDelete(item)}><Trash2 className="h-3 w-3 mr-1" />删除</Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingInbound} onOpenChange={(open) => !open && setEditingInbound(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑入站 - {editingInbound?.inbound.tag}</DialogTitle>
            <DialogDescription>编辑入站的用户配置</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><label className="text-sm font-medium">协议</label><div className="text-sm text-muted-foreground">{editingInbound?.inbound.protocol}</div></div>
              <div className="space-y-2"><label className="text-sm font-medium">端口</label><div className="text-sm text-muted-foreground">{editingInbound?.inbound.port}</div></div>
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
              <Button type="button" variant="outline" onClick={() => setEditingInbound(null)}>取消</Button>
              <Button type="submit" disabled={remoteUpdateInboundMutation.isPending}>{remoteUpdateInboundMutation.isPending ? '保存中...' : '保存'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewingInbound} onOpenChange={(open) => !open && setViewingInbound(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>查看入站配置 - {viewingInbound?.tag}</DialogTitle>
            <DialogDescription>完整的入站配置 JSON</DialogDescription>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg text-xs">{JSON.stringify(viewingInbound, null, 2)}</pre>
          </div>
          <DialogFooter><Button onClick={() => setViewingInbound(null)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Inbound Wizard Dialog */}
      <Dialog open={isWizardDialogOpen} onOpenChange={setIsWizardDialogOpen}>
        <DialogContent className="w-[95vw] !max-w-none md:w-[90vw] lg:w-[80vw] max-h-[90vh] overflow-hidden sm:max-w-none flex flex-col">
          <DialogHeader>
            <DialogTitle>添加入站 - 向导模式</DialogTitle>
            <DialogDescription>通过向导快速生成入站配置</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <InboundWizard servers={[]} selectedServerIds={[serverId]} onCancel={() => setIsWizardDialogOpen(false)} onSubmit={handleInboundSubmit} skipServerSelection={true} usedPorts={usedPorts} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除入站</AlertDialogTitle>
            <AlertDialogDescription>确定要删除入站 "{deletingInbound?.inbound.tag}" 吗？此操作无法撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingInbound(null)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
