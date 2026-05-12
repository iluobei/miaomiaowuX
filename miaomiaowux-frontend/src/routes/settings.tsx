import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Topbar } from '@/components/layout/topbar'
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
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { api } from '@/lib/api'
import { getCookie, setCookie } from '@/lib/cookies'
import { handleServerError } from '@/lib/handle-server-error'
import { profileQueryFn } from '@/lib/profile'
import { useAuthStore } from '@/stores/auth-store'

type ProfileFormValues = {
  username: string
  nickname: string
  email: string
  avatar_url: string
}

type PasswordFormValues = {
  current_password: string
  new_password: string
  confirm_password: string
}

export const Route = createFileRoute('/settings')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { auth } = useAuthStore()

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ['profile'],
    queryFn: profileQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const { data: tokenData, isLoading: loadingToken } = useQuery({
    queryKey: ['user-token'],
    queryFn: async () => {
      const response = await api.get('/api/user/token')
      return response.data as { token: string }
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const profileForm = useForm<ProfileFormValues>({
    defaultValues: {
      username: '',
      nickname: '',
      email: '',
      avatar_url: '',
    },
  })

  useEffect(() => {
    if (profile) {
      profileForm.reset({
        username: profile.username,
        nickname: profile.nickname,
        email: profile.email,
        avatar_url: profile.avatar_url,
      })
    }
  }, [profile, profileForm])

  const updateProfileMutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const payload = {
        username: values.username.trim(),
        nickname: values.nickname.trim(),
        email: values.email.trim(),
        avatar_url: values.avatar_url.trim(),
      }
      const response = await api.put('/api/user/settings', payload)
      return response.data as { profile: ProfileFormValues }
    },
    onSuccess: () => {
      toast.success(t('profile.updated'))
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('profile.updateFailed'))
    },
  })

  const resetTokenMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/api/user/token')
      return response.data as { token: string }
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(['user-token'], payload)
      toast.success(t('token.reset'))
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('token.resetFailed'))
    },
  })

  const resetShortLinkMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/api/user/short-link')
      return response.data as { message: string }
    },
    onSuccess: () => {
      // Invalidate subscriptions to refresh short URLs
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions'] })
      toast.success(t('shortLink.resetSuccess'))
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('shortLink.resetFailed'))
    },
  })

  const passwordForm = useForm<PasswordFormValues>({
    defaultValues: {
      current_password: '',
      new_password: '',
      confirm_password: '',
    },
  })

  const changePasswordMutation = useMutation({
    mutationFn: async (values: PasswordFormValues) => {
      const response = await api.post('/api/user/password', {
        current_password: values.current_password,
        new_password: values.new_password,
      })
      return response.data
    },
    onSuccess: () => {
      toast.success(t('password.updated'))
      passwordForm.reset()
      auth.reset()
      navigate({ to: '/', replace: true })
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('password.changeFailed'))
    },
  })

  const submitProfile = profileForm.handleSubmit((values) => {
    if (!values.username.trim()) {
      toast.error(t('profile.usernameEmpty'))
      return
    }

    if (profile?.is_admin && values.username.trim() !== profile.username) {
      toast.error(t('profile.adminUsernameImmutable'))
      return
    }

    updateProfileMutation.mutate(values)
  })

  const submitPassword = passwordForm.handleSubmit((values) => {
    if (values.new_password.trim().length < 8) {
      toast.error(t('password.minLength'))
      return
    }

    if (values.new_password !== values.confirm_password) {
      toast.error(t('password.mismatch'))
      return
    }

    changePasswordMutation.mutate(values)
  })

  const displayName = profile?.nickname || profile?.username || t('defaultUser')
  const fallbackAvatar = profile?.is_admin ? '/images/admin-avatar.webp' : '/images/user-avatar.png'
  const avatarSrc = profile?.avatar_url?.trim() ? profile.avatar_url.trim() : fallbackAvatar
  const avatarFallback = displayName.slice(0, 2) || t('defaultUser')
  const tokenValue = tokenData?.token ?? ''

  return (
    <div className='min-h-svh bg-background'>
      <Topbar />
      <main className='mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 pt-24'>
        <section className='space-y-2'>
          <h1 className='text-3xl font-semibold tracking-tight'>{t('title')}</h1>
        </section>

        <div className='mt-8 grid gap-6 lg:grid-cols-2'>
          {/* 左侧：个人资料 */}
          <div className='space-y-6'>
            <Card>
              <CardHeader>
                <CardTitle>{t('profile.title')}</CardTitle>
                <CardDescription>{t('profile.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form className='space-y-5' onSubmit={submitProfile}>
                  <div className='flex items-center gap-4'>
                    <Avatar className='size-12'>
                      <AvatarImage src={avatarSrc} alt={displayName} />
                      <AvatarFallback>{avatarFallback}</AvatarFallback>
                    </Avatar>
                    <div className='text-sm text-muted-foreground'>
                      {profile?.is_admin ? t('profile.adminAvatarHint') : t('profile.avatarHint')}
                    </div>
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='username'>{t('profile.username')}</Label>
                    <Input
                      id='username'
                      placeholder={t('profile.usernamePlaceholder')}
                      disabled={loadingProfile || profile?.is_admin}
                      {...profileForm.register('username', { required: true })}
                    />
                    {profile?.is_admin ? (
                      <p className='text-xs text-muted-foreground'>{t('profile.adminUsernameDisabled')}</p>
                    ) : null}
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='nickname'>{t('profile.nickname')}</Label>
                    <Input
                      id='nickname'
                      placeholder={t('profile.nicknamePlaceholder')}
                      disabled={loadingProfile}
                      {...profileForm.register('nickname')}
                    />
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='email'>{t('profile.email')}</Label>
                    <Input
                      id='email'
                      type='email'
                      placeholder={t('profile.emailPlaceholder')}
                      disabled={loadingProfile}
                      {...profileForm.register('email')}
                    />
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='avatar_url'>{t('profile.avatarUrl')}</Label>
                    <Input
                      id='avatar_url'
                      placeholder='https://example.com/avatar.png'
                      disabled={loadingProfile}
                      {...profileForm.register('avatar_url')}
                    />
                  </div>

                  <Button type='submit' className='w-full' disabled={updateProfileMutation.isPending}>
                    {updateProfileMutation.isPending ? t('actions.saving', { ns: 'common' }) : t('profile.saveButton')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* 右侧：修改密码和订阅Token */}
          <div className='space-y-6'>
            <Card>
              <CardHeader>
                <CardTitle>{t('themeStyle.title')}</CardTitle>
                <CardDescription>{t('themeStyle.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='flex gap-2'>
                  {[
                    { value: 'miaomiaowu', label: t('themeStyle.miaomiaowu') },
                    { value: 'flat', label: t('themeStyle.flat') },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type='button'
                      onClick={() => {
                        const current = getCookie('mmw-theme-style') || 'miaomiaowu'
                        if (current !== opt.value) {
                          setCookie('mmw-theme-style', opt.value, 60 * 60 * 24 * 365)
                          window.location.reload()
                        }
                      }}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm transition-colors ${
                        (getCookie('mmw-theme-style') || 'miaomiaowu') === opt.value
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background hover:bg-muted border-border'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('password.title')}</CardTitle>
                <CardDescription>{t('password.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form className='space-y-4' onSubmit={submitPassword}>
                  <div className='space-y-2'>
                    <Label htmlFor='current_password'>{t('password.currentPassword')}</Label>
                    <Input
                      id='current_password'
                      type='password'
                      autoComplete='current-password'
                      placeholder={t('password.currentPasswordPlaceholder')}
                      {...passwordForm.register('current_password', { required: true })}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='new_password'>{t('password.newPassword')}</Label>
                    <Input
                      id='new_password'
                      type='password'
                      autoComplete='new-password'
                      placeholder={t('password.newPasswordHint')}
                      {...passwordForm.register('new_password', { required: true })}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='confirm_password'>{t('password.confirmPassword')}</Label>
                    <Input
                      id='confirm_password'
                      type='password'
                      autoComplete='new-password'
                      placeholder={t('password.confirmPasswordPlaceholder')}
                      {...passwordForm.register('confirm_password', { required: true })}
                    />
                  </div>
                  <Button
                    type='submit'
                    className='w-full'
                    disabled={changePasswordMutation.isPending}
                  >
                    {changePasswordMutation.isPending ? t('password.changing') : t('password.updateButton')}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('token.title')}</CardTitle>
                <CardDescription><p className='mt-2 text-sm font-semibold text-destructive'>{t('token.warning')}</p></CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='font-mono text-xs sm:text-sm break-all rounded-md border bg-muted/40 p-3 shadow-inner'>
                  {loadingToken ? t('actions.loading', { ns: 'common' }) : tokenValue || t('token.notGenerated')}
                </div>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    size='sm'
                    variant='secondary'
                    disabled={!tokenValue || resetTokenMutation.isPending}
                    onClick={async () => {
                      if (!tokenValue) return
                      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                        try {
                          await navigator.clipboard.writeText(tokenValue)
                          toast.success(t('token.copied'))
                          return
                        } catch (error) {
                          console.error('copy token failed', error)
                        }
                      }
                      toast.error(t('actions.copyFailed', { ns: 'common' }))
                    }}
                  >
                    {t('token.copyButton')}
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={resetTokenMutation.isPending}
                    onClick={() => resetTokenMutation.mutate()}
                  >
                    {resetTokenMutation.isPending ? t('actions.resetting', { ns: 'common' }) : t('token.resetButton')}
                  </Button>
                </div>

                <div className='space-y-2 pt-4 border-t'>
                  <Label>{t('shortLink.title')}</Label>
                  <p className='text-xs text-muted-foreground'>
                    {t('shortLink.hint')}
                  </p>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={resetShortLinkMutation.isPending}
                    onClick={() => resetShortLinkMutation.mutate()}
                    className='w-full'
                  >
                    {resetShortLinkMutation.isPending ? t('actions.resetting', { ns: 'common' }) : t('shortLink.resetAll')}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <TwoFactorCard />
          </div>
        </div>
      </main>
    </div>
  )
}

function TwoFactorCard() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: profileQueryFn, staleTime: 5 * 60 * 1000 })
  const [setupOpen, setSetupOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const [setupStep, setSetupStep] = useState<'password' | 'qr' | 'verify' | 'recovery'>('password')
  const [setupPassword, setSetupPassword] = useState('')
  const [totpUrl, setTotpUrl] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [disableCode, setDisableCode] = useState('')

  const { data: tfStatus } = useQuery({
    queryKey: ['2fa-status'],
    queryFn: async () => {
      const res = await api.get('/api/user/2fa/status')
      return res.data as { enabled: boolean }
    },
    staleTime: 30_000,
  })

  const setupMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await api.post('/api/user/2fa/setup', { password })
      return res.data as { secret: string; url: string }
    },
    onSuccess: (data) => {
      setTotpSecret(data.secret)
      setTotpUrl(data.url)
      setSetupStep('qr')
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('twoFactor.passwordFailed'))
    },
  })

  const verifySetupMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await api.post('/api/user/2fa/verify-setup', { code })
      return res.data as { recovery_codes: string[] }
    },
    onSuccess: (data) => {
      setRecoveryCodes(data.recovery_codes)
      setSetupStep('recovery')
      queryClient.invalidateQueries({ queryKey: ['2fa-status'] })
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('twoFactor.invalidCode'))
      setVerifyCode('')
    },
  })

  const disableMutation = useMutation({
    mutationFn: async (code: string) => {
      await api.post('/api/user/2fa/disable', { code })
    },
    onSuccess: () => {
      toast.success(t('twoFactor.disabled'))
      setDisableOpen(false)
      setDisableCode('')
      queryClient.invalidateQueries({ queryKey: ['2fa-status'] })
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('twoFactor.invalidCode'))
      setDisableCode('')
    },
  })

  const resetSetup = () => {
    setSetupStep('password')
    setSetupPassword('')
    setTotpUrl('')
    setTotpSecret('')
    setVerifyCode('')
    setRecoveryCodes([])
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('twoFactor.title')}</CardTitle>
          <CardDescription>
            {tfStatus?.enabled
              ? t('twoFactor.enabledDesc')
              : t('twoFactor.disabledDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tfStatus?.enabled ? (
            <Button variant='destructive' className='w-full' onClick={() => setDisableOpen(true)}>
              {t('twoFactor.disableButton')}
            </Button>
          ) : (
            <Button className='w-full' onClick={() => { resetSetup(); setSetupOpen(true) }}>
              {t('twoFactor.enableButton')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={setupOpen} onOpenChange={(open) => { if (!open && setupStep !== 'recovery') { setSetupOpen(false); resetSetup() } }}>
        <DialogContent className='sm:max-w-md' onInteractOutside={(e) => { if (setupStep === 'recovery') e.preventDefault() }}>
          <DialogHeader>
            <DialogTitle>
              {setupStep === 'password' && t('twoFactor.steps.password')}
              {setupStep === 'qr' && t('twoFactor.steps.qrcode')}
              {setupStep === 'verify' && t('twoFactor.steps.verify')}
              {setupStep === 'recovery' && t('twoFactor.steps.recovery')}
            </DialogTitle>
            <DialogDescription>
              {setupStep === 'password' && t('twoFactor.passwordDesc')}
              {setupStep === 'qr' && t('twoFactor.qrcodeDesc')}
              {setupStep === 'verify' && t('twoFactor.verifyDesc')}
              {setupStep === 'recovery' && t('twoFactor.recoveryDesc')}
            </DialogDescription>
          </DialogHeader>

          {setupStep === 'password' && (
            <div className='space-y-4'>
              <Input
                type='password'
                placeholder={t('twoFactor.passwordPlaceholder')}
                value={setupPassword}
                onChange={(e) => setSetupPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && setupPassword) setupMutation.mutate(setupPassword) }}
                autoFocus
              />
              <Button className='w-full' disabled={!setupPassword || setupMutation.isPending} onClick={() => setupMutation.mutate(setupPassword)}>
                {setupMutation.isPending ? t('actions.verifying', { ns: 'common' }) : t('actions.next', { ns: 'common' })}
              </Button>
            </div>
          )}

          {setupStep === 'qr' && (
            <div className='space-y-4'>
              <div className='flex justify-center rounded-lg border bg-white p-4'>
                <QRCodeSVG value={totpUrl} size={200} />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs text-muted-foreground'>{t('twoFactor.manualKey')}</Label>
                <div className='font-mono text-xs break-all rounded-md border bg-muted/40 p-2 select-all'>
                  {totpSecret}
                </div>
              </div>
              <Button className='w-full' onClick={() => setSetupStep('verify')}>
                {t('actions.next', { ns: 'common' })}
              </Button>
            </div>
          )}

          {setupStep === 'verify' && (
            <div className='space-y-4'>
              <div className='flex justify-center'>
                <InputOTP maxLength={6} value={verifyCode} onChange={setVerifyCode} onComplete={(code) => verifySetupMutation.mutate(code)} autoFocus>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button className='w-full' disabled={verifyCode.length !== 6 || verifySetupMutation.isPending} onClick={() => verifySetupMutation.mutate(verifyCode)}>
                {verifySetupMutation.isPending ? t('actions.verifying', { ns: 'common' }) : t('twoFactor.verifyAndEnable')}
              </Button>
            </div>
          )}

          {setupStep === 'recovery' && (
            <div className='space-y-4'>
              <div className='grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3'>
                {recoveryCodes.map((code) => (
                  <div key={code} className='font-mono text-sm text-center'>{code}</div>
                ))}
              </div>
              <div className='grid grid-cols-2 gap-2'>
                <Button
                  variant='outline'
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(recoveryCodes.join('\n'))
                      toast.success(t('twoFactor.recoveryCodesCopied'))
                    } catch {
                      toast.error(t('twoFactor.recoveryCodesCopyFailed'))
                    }
                  }}
                >
                  {t('twoFactor.copyRecoveryCodes')}
                </Button>
                <Button
                  variant='outline'
                  onClick={() => {
                    const text = recoveryCodes.join('\n')
                    const blob = new Blob([text], { type: 'text/plain' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${t('brand', { ns: 'common' })}-${profile?.username || 'user'}.txt`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  <Download className='size-4 mr-1' />
                  {t('twoFactor.downloadRecoveryCodes')}
                </Button>
              </div>
              <Button className='w-full' onClick={() => { setSetupOpen(false); resetSetup() }}>
                {t('twoFactor.recoveryCodesSaved')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={disableOpen} onOpenChange={(open) => { if (!open) { setDisableOpen(false); setDisableCode('') } }}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('twoFactor.disableTitle')}</DialogTitle>
            <DialogDescription>{t('twoFactor.disableDesc')}</DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='flex justify-center'>
              <InputOTP maxLength={6} value={disableCode} onChange={setDisableCode} onComplete={(code) => disableMutation.mutate(code)} autoFocus>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button variant='destructive' className='w-full' disabled={disableCode.length !== 6 || disableMutation.isPending} onClick={() => disableMutation.mutate(disableCode)}>
              {disableMutation.isPending ? t('actions.disabling', { ns: 'common' }) : t('twoFactor.confirmDisable')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
