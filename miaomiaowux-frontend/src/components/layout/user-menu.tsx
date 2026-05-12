import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { LogOut, Settings2, ExternalLink, BookOpen, HardDrive, RefreshCw, Bug, Palette, Languages } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import useDialogState from '@/hooks/use-dialog-state'
import { SignOutDialog } from '@/components/sign-out-dialog'
import { BackupDialog } from '@/components/backup-dialog'
import { UpdateDialog } from '@/components/update-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/switch'
import { profileQueryFn } from '@/lib/profile'
import { useAuthStore } from '@/stores/auth-store'
import { useVersionCheck } from '@/hooks/use-version-check'
import { getCookie, setCookie } from '@/lib/cookies'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'

export function UserMenu() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useDialogState<boolean>()
  const [backupDialogOpen, setBackupDialogOpen] = useState(false)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const { auth } = useAuthStore()
  const { currentVersion, hasUpdate, releaseUrl } = useVersionCheck()
  const queryClient = useQueryClient()

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: profileQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  // Debug日志状态
  const { data: debugStatus } = useQuery({
    queryKey: ['debug-status'],
    queryFn: async () => {
      const response = await api.get('/api/user/debug/status')
      return response.data as {
        enabled: boolean
        log_path?: string
        started_at?: string
        file_size?: string
        duration?: string
      }
    },
    enabled: Boolean(auth.accessToken),
    refetchInterval: (query) => {
      return query.state.data?.enabled ? 5000 : false
    },
  })

  // 开启Debug日志
  const enableDebugMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/api/user/debug/enable')
      return response.data
    },
    onSuccess: () => {
      toast.success(t('userMenu.debugEnabled'))
      queryClient.invalidateQueries({ queryKey: ['debug-status'] })
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('userMenu.debugEnableFailed'))
    },
  })

  // 关闭Debug日志并下载
  const disableDebugMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/api/user/debug/disable')
      return response.data as { message: string; download_url: string; log_path: string }
    },
    onSuccess: async (data) => {
      toast.success(t('userMenu.debugDisabled'))
      queryClient.invalidateQueries({ queryKey: ['debug-status'] })

      // 自动下载日志文件
      if (data.download_url) {
        setIsDownloading(true)
        try {
          const response = await api.get(data.download_url, {
            responseType: 'blob',
          })

          const url = window.URL.createObjectURL(new Blob([response.data]))
          const link = document.createElement('a')
          link.href = url
          link.setAttribute('download', data.download_url.split('file=')[1] || 'debug.log')
          document.body.appendChild(link)
          link.click()
          link.remove()
          window.URL.revokeObjectURL(url)

          toast.success(t('userMenu.logDownloaded'))
        } catch (error) {
          console.error('下载日志失败:', error)
          toast.error(t('userMenu.logDownloadFailed'))
        } finally {
          setIsDownloading(false)
        }
      }
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('userMenu.debugDisableFailed'))
    },
  })

  const handleDebugToggle = (checked: boolean) => {
    if (checked) {
      enableDebugMutation.mutate()
    } else {
      disableDebugMutation.mutate()
    }
  }

  const displayName = profile?.nickname || profile?.username || t('userMenu.user')
  const fallbackAvatar = profile?.is_admin ? '/images/admin-avatar.webp' : '/images/user-avatar.png'
  const avatarSrc = profile?.avatar_url?.trim() ? profile.avatar_url.trim() : fallbackAvatar
  const fallbackText = displayName.slice(0, 2)
  const emailText = profile?.email?.trim()
  const levelText = profile?.role ? profile.role.toUpperCase() : 'LV.0'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='outline'
            size='sm'
            aria-label={displayName}
            className='h-9 min-w-0 justify-center gap-2 px-2 py-2 overflow-hidden sm:min-w-[120px] sm:gap-2 sm:px-3'
          >
            <span className='sr-only'>{displayName}</span>
            <Avatar className='size-7 border-[1.5px] border-[color:rgba(241,140,110,0.45)] shadow-[2px_2px_0_rgba(0,0,0,0.2)]'>
              <AvatarImage src={avatarSrc} alt={displayName} />
              <AvatarFallback>{fallbackText || t('userMenu.user')}</AvatarFallback>
            </Avatar>
            <div className='hidden sm:flex sm:flex-col sm:items-center sm:leading-tight'>
              <span className='text-sm font-semibold truncate max-w-[70px]'>{displayName}</span>
              <span className='text-xs uppercase tracking-[0.2em] text-muted-foreground'>
                {levelText}
              </span>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-56 space-y-3 p-4'>
          <div className='flex flex-col items-center gap-2 text-center'>
            <Avatar className='size-12'>
              <AvatarImage src={avatarSrc} alt={displayName} />
              <AvatarFallback>{fallbackText || t('userMenu.user')}</AvatarFallback>
            </Avatar>
            <div className='space-y-1'>
              <p className='text-sm font-semibold leading-tight'>{displayName}</p>
              <p className='text-xs text-muted-foreground'>{profile?.username || t('userMenu.notLoggedIn')}</p>
              {emailText ? (
                <p className='text-xs text-muted-foreground break-all'>{emailText}</p>
              ) : (
                <p className='text-xs text-muted-foreground'>{t('userMenu.noEmail')}</p>
              )}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className='cursor-pointer justify-center'>
            <Link to='/settings' className='flex items-center gap-2'>
              <Settings2 className='size-4' /> {t('userMenu.settings')}
            </Link>
          </DropdownMenuItem>

          {/* Debug日志开关 */}
          <DropdownMenuItem
            className='cursor-pointer justify-between px-2'
            onSelect={(e) => e.preventDefault()}
          >
            <div className='flex items-center gap-2'>
              <Bug className='size-4' />
              <div className='flex flex-col'>
                <span className='text-sm'>{t('userMenu.debugLog')}</span>
                {debugStatus?.enabled && debugStatus.file_size && (
                  <span className='text-xs text-muted-foreground'>
                    {debugStatus.file_size} · {debugStatus.duration}
                  </span>
                )}
              </div>
            </div>
            <Switch
              checked={debugStatus?.enabled || false}
              onCheckedChange={handleDebugToggle}
              disabled={
                enableDebugMutation.isPending ||
                disableDebugMutation.isPending ||
                isDownloading
              }
              onClick={(e) => e.stopPropagation()}
            />
          </DropdownMenuItem>

          {/* 界面风格切换 */}
          <DropdownMenuItem
            className='cursor-pointer px-2'
            onSelect={(e) => e.preventDefault()}
          >
            <Palette className='size-4 shrink-0' />
            <div className='flex flex-1 gap-1'>
              {[
                { value: 'miaomiaowu', label: t('userMenu.themeMiaomiaowu') },
                { value: 'flat', label: t('userMenu.themeFlat') },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    const current = getCookie('mmw-theme-style') || 'miaomiaowu'
                    if (current !== opt.value) {
                      setCookie('mmw-theme-style', opt.value, 60 * 60 * 24 * 365)
                      window.location.reload()
                    }
                  }}
                  className={`flex-1 px-2 py-0.5 text-xs border transition-colors ${
                    (getCookie('mmw-theme-style') || 'miaomiaowu') === opt.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted border-border'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </DropdownMenuItem>

          {/* 语言切换 */}
          <DropdownMenuItem
            className='cursor-pointer px-2'
            onSelect={(e) => e.preventDefault()}
          >
            <Languages className='size-4 shrink-0' />
            <div className='flex flex-1 gap-1'>
              {[
                { value: 'zh-CN', label: '中文' },
                { value: 'en', label: 'English' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    if (i18n.language !== opt.value) {
                      i18n.changeLanguage(opt.value)
                    }
                  }}
                  className={`flex-1 px-2 py-0.5 text-xs border transition-colors ${
                    i18n.language === opt.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted border-border'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem asChild className='cursor-pointer justify-center'>
            <a href='https://docs.miaomiaowu.net' target='_blank' rel='noopener noreferrer' className='flex items-center gap-2'>
              <BookOpen className='size-4' /> {t('userMenu.help')}
            </a>
          </DropdownMenuItem>
          {profile?.is_admin && (
            <DropdownMenuItem onClick={() => setBackupDialogOpen(true)} className='cursor-pointer justify-center'>
              <HardDrive className='size-4' /> {t('userMenu.backup')}
            </DropdownMenuItem>
          )}
          {profile?.is_admin && (
            <DropdownMenuItem onClick={() => setUpdateDialogOpen(true)} className='cursor-pointer justify-center'>
              <RefreshCw className='size-4' />
              <span className='relative'>
                {t('userMenu.checkUpdate')}
                {hasUpdate && (
                  <span className='absolute mt-2 -right-1.5 -top-1.5 flex size-1.5'>
                    <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75'></span>
                    <span className='relative inline-flex size-1.5 rounded-full bg-primary'></span>
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className='cursor-pointer justify-center'>
            <a
              href={releaseUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center gap-2'
            >
              <ExternalLink className='size-4' />
              {t('userMenu.version')} v{currentVersion}
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen(true)} className='cursor-pointer justify-center'>
            <LogOut className='size-4' /> {t('userMenu.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SignOutDialog open={Boolean(open)} onOpenChange={(value) => setOpen(value)} />
      <BackupDialog open={backupDialogOpen} onOpenChange={setBackupDialogOpen} />
      <UpdateDialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen} />
    </>
  )
}
