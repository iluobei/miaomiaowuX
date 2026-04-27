// @ts-nocheck
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Topbar } from '@/components/layout/topbar'
import { DataTable } from '@/components/data-table'
import type { DataTableColumn } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { profileQueryFn } from '@/lib/profile'
import { useAuthStore } from '@/stores/auth-store'
import { Package, Pencil } from 'lucide-react'

// @ts-ignore - retained simple route definition
export const Route = createFileRoute('/users')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: UsersPage,
})

type UserRow = {
  username: string
  email: string
  nickname: string
  role: string
  is_active: boolean
  remark: string
  package_id?: number | null
  package_name?: string
  traffic_limit_gb?: number
  traffic_used?: number
  traffic_limit?: number
  is_over_limit?: boolean
  is_reset?: boolean
  reset_day?: number
  package_end_date?: string
}

type ResetState = {
  username: string
  password: string
}

type CreateState = {
  username: string
  email: string
  nickname: string
  password: string
  remark: string
}

type PackageManageState = {
  username: string
  selectedPackageId: number | null
  isReset: boolean
  resetDay: number
  expireDate: string
  initialized: boolean
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

const defaultExpireDate = () => {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toISOString().split('T')[0]
}

const generatePassword = (length = 12) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

function UsersPage() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()
  const [resetState, setResetState] = useState<ResetState | null>(null)
  const [deleteUsername, setDeleteUsername] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createState, setCreateState] = useState<CreateState>({
    username: '',
    email: '',
    nickname: '',
    password: generatePassword(),
    remark: '',
  })
  const [packageManageState, setPackageManageState] = useState<PackageManageState | null>(null)
  const [remarkEditState, setRemarkEditState] = useState<{ username: string; remark: string } | null>(null)

  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery({
    queryKey: ['profile'],
    queryFn: profileQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const isAdmin = Boolean(profile?.is_admin)

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const response = await api.get('/api/admin/users')
      return response.data as { users: UserRow[] }
    },
    enabled: Boolean(isAdmin && auth.accessToken),
    staleTime: 30 * 1000,
  })

  const packagesQuery = useQuery({
    queryKey: ['packages'],
    queryFn: async () => {
      const response = await api.get('/api/admin/packages')
      return response.data?.packages ?? []
    },
    enabled: Boolean(isAdmin && auth.accessToken),
    staleTime: 60 * 1000,
  })

  const statusMutation = useMutation({
    mutationFn: async (payload: { username: string; is_active: boolean }) => {
      await api.post('/api/admin/users/status', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('用户状态已更新')
    },
    onError: handleServerError,
  })

  const resetMutation = useMutation({
    mutationFn: async (payload: ResetState) => {
      const response = await api.post('/api/admin/users/reset-password', {
        username: payload.username,
        new_password: payload.password,
      })
      return response.data as { username: string; password: string }
    },
    onSuccess: (data) => {
      toast.success('密码已重置')
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setResetState(null)

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(data.password).catch(() => null)
      }
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (username: string) => {
      await api.post('/api/admin/users/delete', { username })
    },
    onSuccess: () => {
      toast.success('用户已删除')
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setDeleteUsername(null)
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  const createMutation = useMutation({
    mutationFn: async (payload: CreateState) => {
      const response = await api.post('/api/admin/users/create', {
        username: payload.username,
        email: payload.email,
        nickname: payload.nickname,
        password: payload.password,
        remark: payload.remark,
      })
      return response.data as { username: string; email: string; nickname: string; role: string; password: string }
    },
    onSuccess: (data) => {
      toast.success('用户已创建，初始密码已复制')
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setCreateOpen(false)
      setCreateState({ username: '', email: '', nickname: '', password: generatePassword(), remark: '' })

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(data.password).catch(() => null)
      }
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  const updatePackageMutation = useMutation({
    mutationFn: async (payload: { username: string; package_id: number | null; start_date?: string; expire_date?: string; is_reset?: boolean; reset_day?: number }) => {
      if (payload.package_id === null) {
        await api.post('/api/admin/packages/unassign', { username: payload.username })
        return { warnings: [] }
      } else {
        const resp = await api.post('/api/admin/packages/assign', {
          username: payload.username,
          package_id: payload.package_id,
          start_date: payload.start_date || new Date().toISOString().split('T')[0],
          expire_date: payload.expire_date,
          is_reset: payload.is_reset ?? false,
          reset_day: payload.reset_day ?? 1,
        })
        return resp.data as { message?: string; warnings?: string[] }
      }
    },
    onSuccess: (data, variables) => {
      if (data?.warnings?.length) {
        toast.warning(`套餐已绑定，但部分节点配置失败：${data.warnings.join('、')}`)
      } else {
        toast.success('套餐已更新')
      }
      queryClient.invalidateQueries({ queryKey: ['user-package', variables.username] })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setPackageManageState(null)
    },
    onError: handleServerError,
  })

  const remarkMutation = useMutation({
    mutationFn: async (payload: { username: string; remark: string }) => {
      await api.post('/api/admin/users/remark', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('备注已更新')
      setRemarkEditState(null)
    },
    onError: handleServerError,
  })

  const users = useMemo(() => usersQuery.data?.users ?? [], [usersQuery.data])

  if (profileLoading) {
    return (
      <div className='min-h-svh bg-background'>
        <Topbar />
        <main className='mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 pt-24'>
          <Card className='shadow-none border-dashed'>
            <CardHeader>
              <CardTitle>加载中…</CardTitle>
              <CardDescription>正在获取管理员信息，请稍候。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                <div className='h-10 w-full rounded-md bg-muted animate-pulse' />
                <div className='h-10 w-full rounded-md bg-muted animate-pulse' />
                <div className='h-10 w-full rounded-md bg-muted animate-pulse' />
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  if (!isAdmin || profileError) {
    return (
      <div className='min-h-svh bg-background'>
        <Topbar />
        <main className='mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-4 px-4 py-20 text-center sm:px-6 pt-24'>
          <Card className='w-full shadow-none border-dashed'>
            <CardHeader>
              <CardTitle>权限不足</CardTitle>
              <CardDescription>只有管理员可以访问用户管理页面。</CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className='min-h-svh bg-background'>
      <Topbar />
      <main className='mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 pt-24'>
        <section className='space-y-3'>
          <h1 className='text-3xl font-semibold tracking-tight'>用户管理</h1>
          <p className='text-muted-foreground'>查看系统用户，调整启用状态并重置密码。</p>
        </section>

        <Card className='mt-8'>
          <CardHeader>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <CardTitle>账号列表</CardTitle>
                <CardDescription>仅管理员可更改用户状态或重置密码。</CardDescription>
              </div>
              <Button
                size='sm'
                onClick={() => {
                  setCreateState({ username: '', email: '', nickname: '', password: generatePassword(), remark: '' })
                  setCreateOpen(true)
                }}
              >
                新增用户
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              data={users}
              getRowKey={(user) => user.username}
              emptyText='当前没有可显示的用户'

              columns={[
                {
                  header: '用户名',
                  cell: (user) => user.username,
                  cellClassName: 'font-medium',
                  width: '120px'
                },
                {
                  header: '昵称',
                  cell: (user) => user.nickname || '—',
                  width: '120px'
                },
                {
                  header: '备注',
                  cell: (user) => (
                    <div className='flex items-center gap-2'>
                      <span className='truncate max-w-[150px]' title={user.remark}>{user.remark || '—'}</span>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-6 w-6 shrink-0'
                        onClick={() => setRemarkEditState({ username: user.username, remark: user.remark || '' })}
                      >
                        <Pencil className='h-3 w-3' />
                      </Button>
                    </div>
                  ),
                  width: '180px'
                },
                {
                  header: '套餐/流量',
                  cell: (user) => {
                    if (!user.package_id) {
                      return (
                        <Button
                          variant='ghost'
                          size='sm'
                          className='text-muted-foreground h-7 px-2'
                          onClick={() =>
                            setPackageManageState({
                              username: user.username,
                              selectedPackageId: null,
                              isReset: user.is_reset ?? false,
                              resetDay: user.reset_day ?? 1,
                              expireDate: user.package_end_date ?? defaultExpireDate(),
                              initialized: true,
                            })
                          }
                        >
                          <Package className='h-3 w-3 mr-1' />
                          绑定套餐
                        </Button>
                      )
                    }
                    const used = user.traffic_used ?? 0
                    const limit = user.traffic_limit ?? 0
                    const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
                    const isOver = user.is_over_limit
                    return (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className='w-full cursor-pointer space-y-1'
                              onClick={() =>
                                setPackageManageState({
                                  username: user.username,
                                  selectedPackageId: user.package_id ?? null,
                                  isReset: user.is_reset ?? false,
                                  resetDay: user.reset_day ?? 1,
                                  expireDate: user.package_end_date ?? defaultExpireDate(),
                                  initialized: true,
                                })
                              }
                            >
                              <div className='flex items-center justify-between text-xs'>
                                <span className='font-medium truncate max-w-[100px]'>{user.package_name}</span>
                                {isOver ? (
                                  <Badge variant='destructive' className='text-[10px] h-4 px-1'>超限</Badge>
                                ) : (
                                  <span className='text-muted-foreground'>{percent.toFixed(0)}%</span>
                                )}
                              </div>
                              <Progress value={percent} className={`h-1.5 ${isOver ? '[&>div]:bg-destructive' : percent > 80 ? '[&>div]:bg-yellow-500' : ''}`} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side='top' className='text-xs'>
                            <p>套餐：{user.package_name}</p>
                            <p>已用：{formatBytes(used)}</p>
                            <p>限额：{user.traffic_limit_gb} GB</p>
                            <p>使用率：{percent.toFixed(1)}%</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )
                  },
                  width: '200px'
                },
                {
                  header: '角色',
                  cell: (user) => {
                    const isAdminRow = user.role === 'admin'
                    return <span className='text-sm font-medium'>{isAdminRow ? '管理员' : '普通用户'}</span>
                  },
                  headerClassName: 'text-center',
                  cellClassName: 'text-center',
                  width: '100px'
                },
                {
                  header: '状态',
                  cell: (user) => {
                    const isSelf = user.username === profile?.username
                    const isAdminRow = user.role === 'admin'
                    return (
                      <Switch
                        checked={user.is_active}
                        disabled={statusMutation.isPending || isSelf || isAdminRow}
                        onCheckedChange={(checked) =>
                          statusMutation.mutate({
                            username: user.username,
                            is_active: checked,
                          })
                        }
                      />
                    )
                  },
                  headerClassName: 'text-center',
                  cellClassName: 'text-center',
                  width: '100px'
                },
                {
                  header: '操作',
                  cell: (user) => {
                    const isAdminRow = user.role === 'admin'
                    return isAdminRow ? (
                      <span className='text-sm text-muted-foreground'>—</span>
                    ) : (
                      <div className='flex items-center justify-end gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={resetMutation.isPending}
                          onClick={() =>
                            setResetState({
                              username: user.username,
                              password: generatePassword(),
                            })
                          }
                        >
                          重置密码
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            setPackageManageState({
                              username: user.username,
                              selectedPackageId: user.package_id ?? null,
                              isReset: user.is_reset ?? false,
                              resetDay: user.reset_day ?? 1,
                              expireDate: user.package_end_date ?? defaultExpireDate(),
                              initialized: true,
                            })
                          }
                        >
                          <Package className='h-3 w-3 mr-1' />
                          管理套餐
                        </Button>
                        <Button
                          size='sm'
                          variant='destructive'
                          disabled={deleteMutation.isPending}
                          onClick={() => setDeleteUsername(user.username)}
                        >
                          删除
                        </Button>
                      </div>
                    )
                  },
                  headerClassName: 'text-right',
                  cellClassName: 'text-right',
                  width: '340px'
                }
              ] as DataTableColumn<UserRow>[]}

              mobileCard={{
                header: (user) => {
                  const isAdminRow = user.role === 'admin'
                  return (
                    <div>
                      <div className='flex items-center justify-between mb-1'>
                        <div className='font-medium text-sm'>{user.username}</div>
                        <Badge variant={isAdminRow ? 'default' : 'secondary'} className='text-xs'>
                          {isAdminRow ? '管理员' : '普通用户'}
                        </Badge>
                      </div>
                      {user.nickname && (
                        <div className='text-xs text-muted-foreground line-clamp-1'>{user.nickname}</div>
                      )}
                    </div>
                  )
                },
                fields: [
                  {
                    label: '邮箱',
                    value: (user) => <span className='break-all'>{user.email || '—'}</span>
                  },
                  {
                    label: '备注',
                    value: (user) => (
                      <div className='flex items-center gap-2'>
                        <span className='truncate'>{user.remark || '—'}</span>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 shrink-0'
                          onClick={() => setRemarkEditState({ username: user.username, remark: user.remark || '' })}
                        >
                          <Pencil className='h-3 w-3' />
                        </Button>
                      </div>
                    )
                  },
                  {
                    label: '状态',
                    value: (user) => {
                      const isSelf = user.username === profile?.username
                      const isAdminRow = user.role === 'admin'
                      return (
                        <div className='flex items-center gap-2'>
                          <Switch
                            checked={user.is_active}
                            disabled={statusMutation.isPending || isSelf || isAdminRow}
                            onCheckedChange={(checked) =>
                              statusMutation.mutate({
                                username: user.username,
                                is_active: checked,
                              })
                            }
                          />
                          <span>{user.is_active ? '启用' : '禁用'}</span>
                        </div>
                      )
                    }
                  }
                ],
                actions: (user) => {
                  const isAdminRow = user.role === 'admin'
                  return isAdminRow ? null : (
                    <>
                      <Button
                        variant='outline'
                        size='sm'
                        className='flex-1'
                        disabled={resetMutation.isPending}
                        onClick={() =>
                          setResetState({
                            username: user.username,
                            password: generatePassword(),
                          })
                        }
                      >
                        重置密码
                      </Button>
                      <Button
                        variant='outline'
                        size='sm'
                        className='flex-1'
                        onClick={() =>
                          setPackageManageState({
                            username: user.username,
                            selectedPackageId: user.package_id ?? null,
                            isReset: user.is_reset ?? false,
                            resetDay: user.reset_day ?? 1,
                            expireDate: user.package_end_date ?? defaultExpireDate(),
                            initialized: true,
                          })
                        }
                      >
                        管理套餐
                      </Button>
                      <Button
                        variant='destructive'
                        size='sm'
                        className='flex-1'
                        disabled={deleteMutation.isPending}
                        onClick={() => setDeleteUsername(user.username)}
                      >
                        删除
                      </Button>
                    </>
                  )
                }
              }}
            />
          </CardContent>
        </Card>
      </main>

      <Dialog open={createOpen} onOpenChange={(open) => setCreateOpen(open)}>
        <DialogContent className='sm:max-w-lg max-h-[90vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>新增用户</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='create-username'>用户名</Label>
              <Input
                id='create-username'
                value={createState.username}
                autoComplete='off'
                onChange={(event) =>
                  setCreateState((prev) => {
                    const value = event.target.value
                    const shouldSyncNickname = prev.nickname === '' || prev.nickname === prev.username
                    return {
                      ...prev,
                      username: value,
                      nickname: shouldSyncNickname ? value : prev.nickname,
                    }
                  })
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-email'>邮箱</Label>
              <Input
                id='create-email'
                type='email'
                value={createState.email}
                autoComplete='off'
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-nickname'>昵称</Label>
              <Input
                id='create-nickname'
                value={createState.nickname}
                autoComplete='off'
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, nickname: event.target.value }))
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-password'>初始密码</Label>
              <Input
                id='create-password'
                type='text'
                value={createState.password}
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, password: event.target.value }))
                }
              />
              <p className='text-xs text-muted-foreground'>默认生成随机密码，可在创建前自行调整。</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-remark'>备注（可选）</Label>
              <Input
                id='create-remark'
                value={createState.remark}
                placeholder='输入备注信息'
                autoComplete='off'
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, remark: event.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={createMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={!createState.username || createMutation.isPending}
              onClick={() => createMutation.mutate(createState)}
            >
              {createMutation.isPending ? '创建中…' : '确认创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetState)} onOpenChange={(open) => (open ? null : setResetState(null))}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>用户名</Label>
              <Input value={resetState?.username ?? ''} readOnly disabled />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='new-password'>新密码</Label>
              <Input
                id='new-password'
                type='text'
                value={resetState?.password ?? ''}
                onChange={(event) =>
                  setResetState((prev) =>
                    prev
                      ? {
                          ...prev,
                          password: event.target.value,
                        }
                      : prev
                  )
                }
              />
              <p className='text-xs text-muted-foreground'>默认生成随机密码，可自行修改后确认。</p>
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={resetMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={!resetState?.password || resetMutation.isPending}
              onClick={() => resetState && resetMutation.mutate(resetState)}
            >
              {resetMutation.isPending ? '重置中…' : '确认重置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteUsername)} onOpenChange={(open) => !open && setDeleteUsername(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>确认删除用户</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <p className='text-sm text-muted-foreground'>
              确定要删除用户 <strong>{deleteUsername}</strong> 吗？此操作将删除该用户的所有数据，包括：
            </p>
            <ul className='list-disc list-inside text-sm text-muted-foreground space-y-1'>
              <li>用户账号信息</li>
              <li>订阅绑定关系</li>
              <li>保存的节点</li>
              <li>外部订阅</li>
              <li>用户设置</li>
            </ul>
            <p className='text-sm text-destructive font-medium'>此操作不可撤销！</p>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={deleteMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              variant='destructive'
              disabled={deleteMutation.isPending}
              onClick={() => deleteUsername && deleteMutation.mutate(deleteUsername)}
            >
              {deleteMutation.isPending ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(packageManageState)} onOpenChange={(open) => !open && setPackageManageState(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>管理套餐</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>用户名</Label>
              <Input value={packageManageState?.username ?? ''} readOnly disabled />
            </div>
            <div className='space-y-3'>
              <Label>选择套餐</Label>
              {packagesQuery.isLoading ? (
                <div className='text-sm text-muted-foreground'>加载套餐列表...</div>
              ) : (packagesQuery.data as any[])?.length > 0 ? (
                <div className='space-y-2 max-h-80 overflow-y-auto border rounded-md p-3'>
                  <div
                    className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition hover:bg-muted ${packageManageState?.selectedPackageId === null ? 'bg-primary/10 border border-primary/30' : ''}`}
                    onClick={() => setPackageManageState((prev) => prev ? { ...prev, selectedPackageId: null } : prev)}
                  >
                    <span className='text-sm font-medium'>无套餐</span>
                  </div>
                  {(packagesQuery.data as any[]).map((pkg: any) => (
                    <div
                      key={pkg.id}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 transition hover:bg-muted ${packageManageState?.selectedPackageId === pkg.id ? 'bg-primary/10 border border-primary/30' : ''}`}
                      onClick={() => setPackageManageState((prev) => prev ? { ...prev, selectedPackageId: pkg.id } : prev)}
                    >
                      <div>
                        <div className='text-sm font-medium'>{pkg.name}</div>
                        {pkg.description && <div className='text-xs text-muted-foreground'>{pkg.description}</div>}
                      </div>
                      <Badge variant='secondary' className='shrink-0'>{pkg.traffic_limit_gb} GB</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className='text-sm text-muted-foreground'>暂无可用套餐</div>
              )}
            </div>
            {packageManageState?.selectedPackageId !== null && (
              <div className='space-y-3'>
                <div className='space-y-2'>
                  <Label htmlFor='pkg-expire-date'>到期时间</Label>
                  <Input
                    id='pkg-expire-date'
                    type='date'
                    value={packageManageState?.expireDate ?? ''}
                    onChange={(e) => setPackageManageState((prev) => prev ? { ...prev, expireDate: e.target.value } : prev)}
                  />
                  <p className='text-xs text-muted-foreground'>到期后将自动移除用户的所有入站配置并解绑套餐</p>
                </div>
                <div className='flex items-center space-x-2'>
                  <Checkbox
                    id='pkg-is-reset'
                    checked={packageManageState?.isReset ?? false}
                    onCheckedChange={(checked) => setPackageManageState((prev) => prev ? { ...prev, isReset: !!checked, ...(checked ? { resetDay: new Date().getDate() } : {}) } : prev)}
                  />
                  <Label htmlFor='pkg-is-reset' className='cursor-pointer'>启用每月流量重置</Label>
                </div>
                {packageManageState?.isReset && (
                  <div className='space-y-2'>
                    <Label htmlFor='pkg-reset-day'>每月重置日期</Label>
                    <Input
                      id='pkg-reset-day'
                      type='number'
                      min={1}
                      max={31}
                      value={packageManageState.resetDay}
                      onChange={(e) => setPackageManageState((prev) => prev ? { ...prev, resetDay: parseInt(e.target.value) || 1 } : prev)}
                    />
                    <p className='text-xs text-muted-foreground'>
                      流量将在每月的这一天重置（1-31）{packageManageState.resetDay > 28 && '，注意：2月仅有28/29天，届时将在月末最后一天重置'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={updatePackageMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={updatePackageMutation.isPending}
              onClick={() => {
                if (packageManageState) {
                  updatePackageMutation.mutate({
                    username: packageManageState.username,
                    package_id: packageManageState.selectedPackageId,
                    expire_date: packageManageState.expireDate,
                    is_reset: packageManageState.isReset,
                    reset_day: packageManageState.resetDay,
                  })
                }
              }}
            >
              {updatePackageMutation.isPending ? '保存中…' : '确认保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(remarkEditState)} onOpenChange={(open) => !open && setRemarkEditState(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>编辑备注</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>用户名</Label>
              <Input value={remarkEditState?.username ?? ''} readOnly disabled />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='edit-remark'>备注</Label>
              <Input
                id='edit-remark'
                value={remarkEditState?.remark ?? ''}
                placeholder='输入备注信息'
                onChange={(event) =>
                  setRemarkEditState((prev) =>
                    prev ? { ...prev, remark: event.target.value } : prev
                  )
                }
              />
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={remarkMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={remarkMutation.isPending}
              onClick={() => remarkEditState && remarkMutation.mutate(remarkEditState)}
            >
              {remarkMutation.isPending ? '保存中…' : '确认保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
