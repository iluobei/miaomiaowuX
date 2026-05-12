// @ts-nocheck
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('users')
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
      toast.success(t('toast.statusUpdated'))
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
      toast.success(t('toast.passwordReset'))
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
      toast.success(t('toast.userDeleted'))
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
      toast.success(t('toast.userCreated'))
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
        toast.warning(t('toast.packageWarning', { warnings: data.warnings.join(', ') }))
      } else {
        toast.success(t('toast.packageUpdated'))
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
      toast.success(t('toast.remarkUpdated'))
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
              <CardTitle>{t('loading.title')}</CardTitle>
              <CardDescription>{t('loading.description')}</CardDescription>
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
              <CardTitle>{t('noPermission.title')}</CardTitle>
              <CardDescription>{t('noPermission.description')}</CardDescription>
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
          <h1 className='text-3xl font-semibold tracking-tight'>{t('page.title')}</h1>
          <p className='text-muted-foreground'>{t('page.description')}</p>
        </section>

        <Card className='mt-8'>
          <CardHeader>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <CardTitle>{t('accountList.title')}</CardTitle>
                <CardDescription>{t('accountList.description')}</CardDescription>
              </div>
              <Button
                size='sm'
                onClick={() => {
                  setCreateState({ username: '', email: '', nickname: '', password: generatePassword(), remark: '' })
                  setCreateOpen(true)
                }}
              >
                {t('accountList.addUser')}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              data={users}
              getRowKey={(user) => user.username}
              emptyText={t('accountList.empty')}

              columns={[
                {
                  header: t('columns.username'),
                  cell: (user) => user.username,
                  cellClassName: 'font-medium',
                  width: '120px'
                },
                {
                  header: t('columns.nickname'),
                  cell: (user) => user.nickname || '—',
                  width: '120px'
                },
                {
                  header: t('columns.remark'),
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
                  header: t('columns.packageTraffic'),
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
                          {t('package.bind')}
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
                                  <Badge variant='destructive' className='text-[10px] h-4 px-1'>{t('package.overLimit')}</Badge>
                                ) : (
                                  <span className='text-muted-foreground'>{percent.toFixed(0)}%</span>
                                )}
                              </div>
                              <Progress value={percent} className={`h-1.5 ${isOver ? '[&>div]:bg-destructive' : percent > 80 ? '[&>div]:bg-yellow-500' : ''}`} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side='top' className='text-xs'>
                            <p>{t('package.tooltipPackage', { name: user.package_name })}</p>
                            <p>{t('package.tooltipUsed', { used: formatBytes(used) })}</p>
                            <p>{t('package.tooltipLimit', { limit: user.traffic_limit_gb })}</p>
                            <p>{t('package.tooltipPercent', { percent: percent.toFixed(1) })}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )
                  },
                  width: '200px'
                },
                {
                  header: t('columns.role'),
                  cell: (user) => {
                    const isAdminRow = user.role === 'admin'
                    return <span className='text-sm font-medium'>{isAdminRow ? t('roles.admin') : t('roles.user')}</span>
                  },
                  headerClassName: 'text-center',
                  cellClassName: 'text-center',
                  width: '100px'
                },
                {
                  header: t('columns.status'),
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
                  header: t('columns.actions'),
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
                          {t('actions.resetPassword')}
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
                          {t('package.manage')}
                        </Button>
                        <Button
                          size='sm'
                          variant='destructive'
                          disabled={deleteMutation.isPending}
                          onClick={() => setDeleteUsername(user.username)}
                        >
                          {t('actions.deleteUser')}
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
                          {isAdminRow ? t('roles.admin') : t('roles.user')}
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
                    label: t('columns.email'),
                    value: (user) => <span className='break-all'>{user.email || '—'}</span>
                  },
                  {
                    label: t('columns.remark'),
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
                    label: t('columns.status'),
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
                          <span>{user.is_active ? t('status.enabled') : t('status.disabled')}</span>
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
                        {t('actions.resetPassword')}
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
                        {t('package.manage')}
                      </Button>
                      <Button
                        variant='destructive'
                        size='sm'
                        className='flex-1'
                        disabled={deleteMutation.isPending}
                        onClick={() => setDeleteUsername(user.username)}
                      >
                        {t('actions.deleteUser')}
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
            <DialogTitle>{t('createDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='create-username'>{t('createDialog.username')}</Label>
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
              <Label htmlFor='create-email'>{t('createDialog.email')}</Label>
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
              <Label htmlFor='create-nickname'>{t('createDialog.nickname')}</Label>
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
              <Label htmlFor='create-password'>{t('createDialog.password')}</Label>
              <Input
                id='create-password'
                type='text'
                value={createState.password}
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, password: event.target.value }))
                }
              />
              <p className='text-xs text-muted-foreground'>{t('createDialog.passwordHint')}</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-remark'>{t('createDialog.remark')}</Label>
              <Input
                id='create-remark'
                value={createState.remark}
                placeholder={t('createDialog.remarkPlaceholder')}
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
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={!createState.username || createMutation.isPending}
              onClick={() => createMutation.mutate(createState)}
            >
              {createMutation.isPending ? t('createDialog.creating') : t('createDialog.confirmCreate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetState)} onOpenChange={(open) => (open ? null : setResetState(null))}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('resetDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>{t('resetDialog.username')}</Label>
              <Input value={resetState?.username ?? ''} readOnly disabled />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='new-password'>{t('resetDialog.newPassword')}</Label>
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
              <p className='text-xs text-muted-foreground'>{t('resetDialog.passwordHint')}</p>
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={resetMutation.isPending}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={!resetState?.password || resetMutation.isPending}
              onClick={() => resetState && resetMutation.mutate(resetState)}
            >
              {resetMutation.isPending ? t('resetDialog.resetting') : t('resetDialog.confirmReset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteUsername)} onOpenChange={(open) => !open && setDeleteUsername(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <p className='text-sm text-muted-foreground'>
              <span dangerouslySetInnerHTML={{ __html: t('deleteDialog.description', { username: deleteUsername }) }} />
            </p>
            <ul className='list-disc list-inside text-sm text-muted-foreground space-y-1'>
              <li>{t('deleteDialog.dataAccount')}</li>
              <li>{t('deleteDialog.dataSubscription')}</li>
              <li>{t('deleteDialog.dataNodes')}</li>
              <li>{t('deleteDialog.dataExternalSub')}</li>
              <li>{t('deleteDialog.dataSettings')}</li>
            </ul>
            <p className='text-sm text-destructive font-medium'>{t('deleteDialog.irreversible')}</p>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={deleteMutation.isPending}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type='button'
              variant='destructive'
              disabled={deleteMutation.isPending}
              onClick={() => deleteUsername && deleteMutation.mutate(deleteUsername)}
            >
              {deleteMutation.isPending ? t('deleteDialog.deleting') : t('deleteDialog.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(packageManageState)} onOpenChange={(open) => !open && setPackageManageState(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('packageDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>{t('packageDialog.username')}</Label>
              <Input value={packageManageState?.username ?? ''} readOnly disabled />
            </div>
            <div className='space-y-3'>
              <Label>{t('packageDialog.selectPackage')}</Label>
              {packagesQuery.isLoading ? (
                <div className='text-sm text-muted-foreground'>{t('packageDialog.loadingPackages')}</div>
              ) : (packagesQuery.data as any[])?.length > 0 ? (
                <div className='space-y-2 max-h-80 overflow-y-auto border rounded-md p-3'>
                  <div
                    className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition hover:bg-muted ${packageManageState?.selectedPackageId === null ? 'bg-primary/10 border border-primary/30' : ''}`}
                    onClick={() => setPackageManageState((prev) => prev ? { ...prev, selectedPackageId: null } : prev)}
                  >
                    <span className='text-sm font-medium'>{t('packageDialog.noPackage')}</span>
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
                <div className='text-sm text-muted-foreground'>{t('packageDialog.noAvailablePackages')}</div>
              )}
            </div>
            {packageManageState?.selectedPackageId !== null && (
              <div className='space-y-3'>
                <div className='space-y-2'>
                  <Label htmlFor='pkg-expire-date'>{t('packageDialog.expireDate')}</Label>
                  <Input
                    id='pkg-expire-date'
                    type='date'
                    value={packageManageState?.expireDate ?? ''}
                    onChange={(e) => setPackageManageState((prev) => prev ? { ...prev, expireDate: e.target.value } : prev)}
                  />
                  <p className='text-xs text-muted-foreground'>{t('packageDialog.expireDateHint')}</p>
                </div>
                <div className='flex items-center space-x-2'>
                  <Checkbox
                    id='pkg-is-reset'
                    checked={packageManageState?.isReset ?? false}
                    onCheckedChange={(checked) => setPackageManageState((prev) => prev ? { ...prev, isReset: !!checked, ...(checked ? { resetDay: new Date().getDate() } : {}) } : prev)}
                  />
                  <Label htmlFor='pkg-is-reset' className='cursor-pointer'>{t('packageDialog.enableMonthlyReset')}</Label>
                </div>
                {packageManageState?.isReset && (
                  <div className='space-y-2'>
                    <Label htmlFor='pkg-reset-day'>{t('packageDialog.monthlyResetDay')}</Label>
                    <Input
                      id='pkg-reset-day'
                      type='number'
                      min={1}
                      max={31}
                      value={packageManageState.resetDay}
                      onChange={(e) => setPackageManageState((prev) => prev ? { ...prev, resetDay: parseInt(e.target.value) || 1 } : prev)}
                    />
                    <p className='text-xs text-muted-foreground'>
                      {t('packageDialog.monthlyResetDayHint')}{packageManageState.resetDay > 28 && t('packageDialog.monthlyResetDayWarning')}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={updatePackageMutation.isPending}>
                {t('actions.cancel', { ns: 'common' })}
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
              {updatePackageMutation.isPending ? t('packageDialog.saving') : t('packageDialog.confirmSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(remarkEditState)} onOpenChange={(open) => !open && setRemarkEditState(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('remarkDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>{t('remarkDialog.username')}</Label>
              <Input value={remarkEditState?.username ?? ''} readOnly disabled />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='edit-remark'>{t('remarkDialog.remark')}</Label>
              <Input
                id='edit-remark'
                value={remarkEditState?.remark ?? ''}
                placeholder={t('remarkDialog.remarkPlaceholder')}
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
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={remarkMutation.isPending}
              onClick={() => remarkEditState && remarkMutation.mutate(remarkEditState)}
            >
              {remarkMutation.isPending ? t('remarkDialog.saving') : t('remarkDialog.confirmSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
