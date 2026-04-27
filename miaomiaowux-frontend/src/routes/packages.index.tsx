// @ts-nocheck
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Edit2, RefreshCw, Trash2, Plus, Package } from 'lucide-react'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'

export const Route = createFileRoute('/packages/')({
  component: PackagesPage,
})

interface PackageTemplate {
  id: number
  name: string
  description: string
  traffic_limit_gb: number
  cycle_days: number
  is_reset: boolean
  reset_day: number
  nodes: number[]
  created_at: string
  updated_at: string
}

interface PackageFormData {
  id?: number
  name: string
  description: string
  traffic_limit_gb: number
  cycle_days: number
  nodes: number[]
}

function PackagesPage() {
  const queryClient = useQueryClient()
  const [editingPackage, setEditingPackage] = useState<PackageTemplate | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [formData, setFormData] = useState<PackageFormData>({
    name: '',
    description: '',
    traffic_limit_gb: 100,
    cycle_days: 30,
    nodes: [],
  })

  const { data: packagesData, isLoading } = useQuery({
    queryKey: ['packages'],
    queryFn: async () => {
      const response = await api.get('/api/admin/packages')
      return response.data
    },
  })

  const { data: nodesData } = useQuery({
    queryKey: ['nodes'],
    queryFn: async () => {
      const response = await api.get('/api/admin/nodes')
      return response.data
    },
  })

  const nodes = nodesData?.nodes || []

  const createMutation = useMutation({
    mutationFn: async (data: PackageFormData) => {
      const response = await api.post('/api/admin/packages/create', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages'] })
      toast.success('套餐模板创建成功')
      setIsCreateDialogOpen(false)
      resetForm()
    },
    onError: handleServerError,
  })

  const updateMutation = useMutation({
    mutationFn: async (data: PackageFormData) => {
      const response = await api.post('/api/admin/packages/update', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages'] })
      toast.success('套餐模板更新成功')
      setEditingPackage(null)
      resetForm()
    },
    onError: handleServerError,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await api.post('/api/admin/packages/' + id, { id })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages'] })
      toast.success('套餐模板删除成功')
    },
    onError: handleServerError,
  })

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      traffic_limit_gb: 100,
      cycle_days: 30,
      is_reset: false,
      reset_day: 1,
      nodes: [],
    })
  }

  const handleCreate = () => {
    setIsCreateDialogOpen(true)
    resetForm()
  }

  const handleEdit = (pkg: PackageTemplate) => {
    setEditingPackage(pkg)
    setFormData({
      id: pkg.id,
      name: pkg.name,
      description: pkg.description || '',
      traffic_limit_gb: pkg.traffic_limit_gb,
      cycle_days: pkg.cycle_days,
      nodes: pkg.nodes || [],
    })
  }

  const handleDelete = (id: number, name: string) => {
    if (confirm(`确定要删除套餐模板 "${name}" 吗？`)) {
      deleteMutation.mutate(id)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name) {
      toast.error('请输入套餐名称')
      return
    }

    if (formData.traffic_limit_gb <= 0) {
      toast.error('流量额度必须大于0')
      return
    }

    if (formData.cycle_days <= 0) {
      toast.error('计量周期必须大于0')
      return
    }

    const hasExternalNode = formData.nodes.length > 0 && formData.nodes.some((id) => {
      const node = nodes.find((n: any) => n.id === id)
      return node && !node.inbound_tag
    })
    if (hasExternalNode) {
      toast.warning('请注意，外部节点流量不在套餐流量统计内！！！')
    }

    if (editingPackage) {
      updateMutation.mutate(formData)
    } else {
      createMutation.mutate(formData)
    }
  }

  const packages = packagesData?.packages || []

  return (
    <div className="container mx-auto py-8 px-4 pt-24">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">套餐模板管理</h1>
          <p className="text-gray-600">
            管理流量套餐模板,可在用户管理中为用户分配套餐
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          创建套餐模板
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p className="text-gray-600">加载中...</p>
        </div>
      ) : packages.length === 0 ? (
        <EmptyStateCard
          icon={<Package className="h-12 w-12 text-gray-400" />}
          title="暂无套餐模板"
          actions={(
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              创建第一个套餐模板
            </Button>
          )}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {packages.map((pkg: PackageTemplate) => (
            <Card key={pkg.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg truncate">
                      {pkg.name}
                    </CardTitle>
                    {pkg.description && (
                      <CardDescription className="mt-1">
                        {pkg.description}
                      </CardDescription>
                    )}
                  </div>
                  <Badge variant="secondary">{pkg.traffic_limit_gb} GB</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">流量额度</span>
                  <span className="text-sm font-medium">{pkg.traffic_limit_gb} GB</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">计量周期</span>
                  <span className="text-sm font-medium">{pkg.cycle_days} 天</span>
                </div>
              </CardContent>
              <CardFooter className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEdit(pkg)}
                >
                  <Edit2 className="h-4 w-4 mr-1" />
                  编辑
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(pkg.id, pkg.name)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  删除
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog
        open={isCreateDialogOpen || !!editingPackage}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateDialogOpen(false)
            setEditingPackage(null)
            resetForm()
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPackage ? '编辑套餐模板' : '创建套餐模板'}</DialogTitle>
            <DialogDescription>
              {editingPackage ? '修改套餐模板配置' : '创建新的流量套餐模板'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">套餐名称 *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如: 基础套餐"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">描述</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="套餐说明（可选）"
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="traffic_limit_gb">流量额度 (GB) *</Label>
                <Input
                  id="traffic_limit_gb"
                  type="number"
                  min="1"
                  step="0.1"
                  value={formData.traffic_limit_gb}
                  onChange={(e) => setFormData({ ...formData, traffic_limit_gb: parseFloat(e.target.value) })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cycle_days">计量周期 (天) *</Label>
                <Input
                  id="cycle_days"
                  type="number"
                  min="1"
                  value={formData.cycle_days}
                  onChange={(e) => setFormData({ ...formData, cycle_days: parseInt(e.target.value) })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>关联节点</Label>
                <div className="border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
                  {nodes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无可用节点</p>
                  ) : (
                    nodes.map((node: any) => {
                      const isInternal = Boolean(node.inbound_tag)
                      return (
                        <div key={node.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`node-${node.id}`}
                            checked={formData.nodes.includes(node.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setFormData({ ...formData, nodes: [...formData.nodes, node.id] })
                              } else {
                                setFormData({ ...formData, nodes: formData.nodes.filter((id) => id !== node.id) })
                              }
                            }}
                          />
                          <Label htmlFor={`node-${node.id}`} className="cursor-pointer flex-1 flex items-center gap-1.5">
                            <Badge variant={isInternal ? 'default' : 'outline'} className={`text-[10px] px-1 py-0 shrink-0 ${isInternal ? '' : 'border-amber-500 text-amber-600 dark:text-amber-400'}`}>
                              {isInternal ? '内部' : '外部'}
                            </Badge>
                            {node.node_name}
                          </Label>
                        </div>
                      )
                    })
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  选择该套餐可以使用的节点（不选择表示可以使用所有节点）
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCreateDialogOpen(false)
                  setEditingPackage(null)
                  resetForm()
                }}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) ? '保存中...' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
