// @ts-nocheck
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Upload, AlertTriangle, ArrowLeft, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { handleServerError } from '@/lib/handle-server-error'

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (token) {
      throw redirect({ to: '/' })
    }
  },
  component: LoginPage,
})

type LoginFormValues = {
  username: string
  password: string
  remember_me: boolean
}

type LoginResponse = {
  token: string
  expires_at: string
  username: string
  email: string
  nickname: string
  role: string
  is_admin: boolean
}

type SetupFormValues = {
  username: string
  password: string
  nickname: string
  email: string
  avatar_url: string
}

function LoginPage() {
  const { t } = useTranslation('auth')
  // Check if initial setup is needed
  const { data: setupStatus, isLoading: isCheckingSetup } = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const response = await api.get('/api/setup/status')
      return response.data as { needs_setup: boolean }
    },
    staleTime: Infinity,
  })

  if (isCheckingSetup) {
    return (
      <div className='login-pixel-bg flex min-h-svh items-center justify-center'>
        <Card className='w-full max-w-sm'>
          <CardHeader className='space-y-2 text-center'>
            <CardTitle>{t('login.loading')}</CardTitle>
            <CardDescription>{t('login.checkingStatus')}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (setupStatus?.needs_setup) {
    return <InitialSetupView />
  }

  return <LoginView />
}

function handleLoginSuccess(
  payload: LoginResponse,
  auth: ReturnType<typeof useAuthStore>['auth'],
  queryClient: ReturnType<typeof useQueryClient>,
  navigate: ReturnType<typeof useNavigate>,
  t: (key: string) => string,
) {
  auth.setAccessToken(payload.token)
  queryClient.invalidateQueries({ queryKey: ['traffic-summary'] })
  queryClient.setQueryData(['profile'], {
    username: payload.username,
    email: payload.email,
    nickname: payload.nickname,
    role: payload.role,
    is_admin: payload.is_admin,
  })
  toast.success(t('login.success'))
  navigate({ to: '/' })
}

function LoginView() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { auth } = useAuthStore()
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null)
  const form = useForm<LoginFormValues>({
    defaultValues: {
      username: '',
      password: '',
      remember_me: false,
    },
  })

  const login = useMutation({
    mutationFn: async (values: LoginFormValues) => {
      const response = await api.post('/api/login', values)
      return response.data as LoginResponse & { requires_2fa?: boolean; two_factor_token?: string }
    },
    onSuccess: (payload) => {
      if (payload.requires_2fa && payload.two_factor_token) {
        setTwoFactorToken(payload.two_factor_token)
        return
      }
      handleLoginSuccess(payload, auth, queryClient, navigate, t)
      form.reset()
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('login.failed'))
    },
  })

  const onSubmit = form.handleSubmit((values) => {
    login.mutate(values)
  })

  if (twoFactorToken) {
    return (
      <TwoFactorStep
        twoFactorToken={twoFactorToken}
        onBack={() => setTwoFactorToken(null)}
        onSuccess={(payload) => handleLoginSuccess(payload, auth, queryClient, navigate, t)}
      />
    )
  }

  return (
    <div className='flex min-h-svh items-center justify-center login-pixel-bg px-4 py-12'>
      <Card className='w-full max-w-sm shadow-lg'>
        <CardHeader className='space-y-2 text-center'>
          <CardTitle className='text-2xl font-semibold'>{t('login.title')}</CardTitle>
          <CardDescription>{t('login.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className='space-y-6' onSubmit={onSubmit}>
            <div className='space-y-2'>
              <Label htmlFor='username'>{t('login.username')}</Label>
              <Input
                id='username'
                name='username'
                type='text'
                autoCapitalize='none'
                autoComplete='username'
                autoFocus
                placeholder={t('login.usernamePlaceholder')}
                {...form.register('username', { required: true })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='password'>{t('login.password')}</Label>
              <Input
                id='password'
                name='password'
                type='password'
                autoComplete='current-password'
                placeholder={t('login.passwordPlaceholder')}
                {...form.register('password', { required: true })}
              />
            </div>
            <div className='flex items-center space-x-2'>
              <Checkbox
                id='remember_me'
                checked={form.watch('remember_me')}
                onCheckedChange={(checked) => form.setValue('remember_me', checked === true)}
              />
              <Label htmlFor='remember_me' className='text-sm font-normal cursor-pointer'>
                {t('login.rememberMe')}
              </Label>
            </div>
            <Button type='submit' className='w-full' disabled={login.isPending}>
              {login.isPending ? t('login.loggingIn') : t('login.loginButton')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function TwoFactorStep({
  twoFactorToken,
  onBack,
  onSuccess,
}: {
  twoFactorToken: string
  onBack: () => void
  onSuccess: (payload: LoginResponse) => void
}) {
  const { t } = useTranslation('auth')
  const [otpCode, setOtpCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')

  const verify2FA = useMutation({
    mutationFn: async (code: string) => {
      const response = await api.post('/api/login/2fa', {
        two_factor_token: twoFactorToken,
        code,
      })
      return response.data as LoginResponse
    },
    onSuccess: (payload) => onSuccess(payload),
    onError: (error) => {
      handleServerError(error)
      toast.error(t('twoFactor.invalidCode'))
      setOtpCode('')
    },
  })

  const verifyRecovery = useMutation({
    mutationFn: async (code: string) => {
      const response = await api.post('/api/login/recovery', {
        two_factor_token: twoFactorToken,
        recovery_code: code,
      })
      return response.data as LoginResponse
    },
    onSuccess: (payload) => {
      toast.success(t('twoFactor.recoverySuccess'))
      onSuccess(payload)
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('twoFactor.invalidRecovery'))
    },
  })

  return (
    <div className='login-pixel-bg flex min-h-svh items-center justify-center px-4 py-12'>
      <Card className='w-full max-w-sm shadow-lg'>
        <CardHeader className='space-y-2 text-center'>
          <CardTitle className='text-2xl font-semibold'>{t('twoFactor.title')}</CardTitle>
          <CardDescription>
            {useRecovery ? t('twoFactor.recoveryDesc') : t('twoFactor.codeDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          {useRecovery ? (
            <div className='space-y-4'>
              <Input
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                placeholder={t('twoFactor.recoveryPlaceholder')}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && recoveryCode.trim()) {
                    verifyRecovery.mutate(recoveryCode.trim())
                  }
                }}
              />
              <Button
                className='w-full'
                onClick={() => verifyRecovery.mutate(recoveryCode.trim())}
                disabled={!recoveryCode.trim() || verifyRecovery.isPending}
              >
                {verifyRecovery.isPending ? t('twoFactor.verifying') : t('twoFactor.useRecoveryLogin')}
              </Button>
            </div>
          ) : (
            <div className='space-y-4'>
              <div className='flex justify-center'>
                <InputOTP
                  maxLength={6}
                  value={otpCode}
                  onChange={setOtpCode}
                  onComplete={(code) => verify2FA.mutate(code)}
                  autoFocus
                >
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
              <Button
                className='w-full'
                onClick={() => verify2FA.mutate(otpCode)}
                disabled={otpCode.length !== 6 || verify2FA.isPending}
              >
                {verify2FA.isPending ? t('twoFactor.verifying') : t('twoFactor.verify')}
              </Button>
            </div>
          )}
          <div className='flex items-center justify-between text-sm'>
            <button
              type='button'
              className='text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1'
              onClick={onBack}
            >
              <ArrowLeft className='size-3' />
              {t('twoFactor.back')}
            </button>
            <button
              type='button'
              className='text-muted-foreground hover:text-foreground transition-colors'
              onClick={() => {
                setUseRecovery(!useRecovery)
                setOtpCode('')
                setRecoveryCode('')
              }}
            >
              {useRecovery ? t('twoFactor.useVerificationCode') : t('twoFactor.useRecoveryCode')}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function InitialSetupView() {
  const { t } = useTranslation('auth')
  const queryClient = useQueryClient()
  const [backupFile, setBackupFile] = useState<File | null>(null)
  const [domain, setDomain] = useState('')
  const [domainVerified, setDomainVerified] = useState(false)
  const [domainVerifyResult, setDomainVerifyResult] = useState<{
    match: boolean; domain_ips: string[]; server_ip: string; message?: string
  } | null>(null)
  const form = useForm<SetupFormValues>({
    defaultValues: {
      username: '',
      password: '',
      nickname: '',
      email: '',
      avatar_url: '',
    },
  })

  const verifyDomain = useMutation({
    mutationFn: async (d: string) => {
      const response = await api.post('/api/setup/verify-domain', { domain: d })
      return response.data as { success: boolean; match: boolean; domain_ips: string[]; server_ip: string; message?: string }
    },
    onSuccess: (data) => {
      setDomainVerifyResult(data)
      setDomainVerified(data.match)
      if (data.match) toast.success(t('setup.domainVerified'))
      else toast.error(data.message || t('setup.domainMismatch'))
    },
    onError: (error) => {
      handleServerError(error)
      setDomainVerified(false)
      setDomainVerifyResult(null)
    },
  })

  useEffect(() => {
    const hostname = window.location.hostname
    if (hostname && hostname !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && !hostname.includes(':')) {
      setDomain(hostname)
      verifyDomain.mutate(hostname)
    }
  }, [])

  const setup = useMutation({
    mutationFn: async (values: SetupFormValues) => {
      const response = await api.post('/api/setup/init', {
        ...values,
        domain: domainVerified ? domain : '',
      })
      return response.data as {
        username: string
        nickname: string
        email: string
        nginx_setup?: boolean
        redirect_url?: string
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      let msg = t('setup.success')
      if (data.nginx_setup) msg += ' ' + t('setup.nginxConfigured')
      toast.success(msg)
      form.reset()
      if (data.redirect_url) {
        setTimeout(() => {
          window.location.href = data.redirect_url + '/login'
        }, 1500)
      }
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('setup.failed'))
    },
  })

  const restoreBackup = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('backup', file)
      return api.post('/api/setup/restore-backup', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      toast.success(t('setup.restoreSuccess'))
      setBackupFile(null)
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    },
    onError: (error) => {
      handleServerError(error)
      toast.error(t('setup.restoreFailed'))
    },
  })

  const onSubmit = form.handleSubmit((values) => {
    setup.mutate(values)
  })

  const domainHasValue = domain.trim().length > 0
  const submitDisabled = setup.isPending || (domainHasValue && !domainVerified)

  return (
    <div className='flex min-h-svh items-center justify-center login-pixel-bg px-4 py-12'>
      <Card className='w-full max-w-md shadow-lg'>
        <CardHeader className='space-y-2 text-center'>
          <CardTitle className='text-2xl font-semibold'>{t('setup.welcome')}</CardTitle>
          <CardDescription>
            {t('setup.firstAdminDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className='space-y-4' onSubmit={onSubmit}>
            <div className='space-y-2'>
              <Label htmlFor='setup-username'>
                {t('setup.username')} <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='setup-username'
                name='username'
                type='text'
                autoCapitalize='none'
                autoComplete='username'
                autoFocus
                placeholder={t('setup.usernamePlaceholder')}
                {...form.register('username', { required: true })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='setup-password'>
                {t('setup.password')} <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='setup-password'
                name='password'
                type='password'
                autoComplete='new-password'
                placeholder={t('setup.passwordPlaceholder')}
                {...form.register('password', { required: true })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='setup-domain'>{t('setup.domainLabel')}</Label>
              <div className='flex gap-2'>
                <Input
                  id='setup-domain'
                  type='text'
                  placeholder={t('setup.domainPlaceholder')}
                  value={domain}
                  onChange={(e) => {
                    setDomain(e.target.value)
                    setDomainVerified(false)
                    setDomainVerifyResult(null)
                  }}
                />
                <Button
                  type='button'
                  variant='outline'
                  disabled={!domainHasValue || verifyDomain.isPending}
                  onClick={() => verifyDomain.mutate(domain.trim())}
                >
                  {verifyDomain.isPending ? <Loader2 className='size-4 animate-spin' /> : t('setup.verifyButton')}
                </Button>
              </div>
              {domainVerifyResult && (
                <div className={`flex items-start gap-2 text-xs ${domainVerifyResult.match ? 'text-green-600' : 'text-destructive'}`}>
                  {domainVerifyResult.match ? (
                    <CheckCircle className='size-4 shrink-0 mt-0.5' />
                  ) : (
                    <XCircle className='size-4 shrink-0 mt-0.5' />
                  )}
                  <span>
                    {domainVerifyResult.match
                      ? t('setup.domainCorrect', { serverIp: domainVerifyResult.server_ip })
                      : t('setup.domainMismatchDetailed', { domainIp: domainVerifyResult.domain_ips?.join(', ') || t('setup.none'), serverIp: domainVerifyResult.server_ip || t('setup.unknown') })}
                  </span>
                </div>
              )}
              <p className='text-xs text-muted-foreground'>
                {t('setup.domainHint')}
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='setup-nickname'>{t('setup.nickname')}</Label>
              <Input
                id='setup-nickname'
                name='nickname'
                type='text'
                autoComplete='name'
                placeholder={t('setup.nicknamePlaceholder')}
                {...form.register('nickname')}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='setup-email'>{t('setup.email')}</Label>
              <Input
                id='setup-email'
                name='email'
                type='email'
                autoComplete='email'
                placeholder={t('setup.emailPlaceholder')}
                {...form.register('email')}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='setup-avatar'>{t('setup.avatarUrl')}</Label>
              <Input
                id='setup-avatar'
                name='avatar_url'
                type='url'
                autoComplete='url'
                placeholder={t('setup.avatarPlaceholder')}
                {...form.register('avatar_url')}
              />
            </div>
            <Button type='submit' className='w-full' disabled={submitDisabled}>
              {setup.isPending ? t('setup.creating') : t('setup.createAdmin')}
            </Button>
          </form>

          {/* Divider */}
          <div className='relative my-6'>
            <div className='absolute inset-0 flex items-center'>
              <span className='w-full border-t' />
            </div>
            <div className='relative flex justify-center text-xs uppercase'>
              <span className='bg-card px-2 text-muted-foreground'>{t('setup.or')}</span>
            </div>
          </div>

          {/* Restore from backup */}
          <div className='space-y-3'>
            <Label>{t('setup.restoreFromBackup')}</Label>
            <Input
              type='file'
              accept='.zip'
              onChange={(e) => setBackupFile(e.target.files?.[0] || null)}
              className='cursor-pointer'
            />
            <Button
              type='button'
              onClick={() => backupFile && restoreBackup.mutate(backupFile)}
              disabled={!backupFile || restoreBackup.isPending}
              variant='outline'
              className='w-full'
            >
              <Upload className='size-4 mr-2' />
              {restoreBackup.isPending ? t('setup.restoring') : t('setup.restoreFromBackup')}
            </Button>
            <div className='flex items-start gap-2 text-xs text-muted-foreground'>
              <AlertTriangle className='size-4 shrink-0 text-amber-500' />
              <span>{t('setup.backupHint')}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
