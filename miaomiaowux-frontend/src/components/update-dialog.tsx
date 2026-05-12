import { useState, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  RefreshCw,
  Download,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  Circle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useAuthStore } from '@/stores/auth-store'

interface UpdateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface UpdateInfo {
  current_version: string
  latest_version: string
  has_update: boolean
  release_url: string
  download_url: string
  release_notes: string
}

interface UpdateProgress {
  step: 'checking' | 'downloading' | 'backing_up' | 'replacing' | 'restarting' | 'done' | 'error'
  progress: number
  message: string
}

const STEP_KEYS = ['checking', 'downloading', 'backing_up', 'replacing', 'restarting'] as const

const STEP_LABEL_MAP = {
  checking: 'update.steps.checking',
  downloading: 'update.steps.downloading',
  backing_up: 'update.steps.backingUp',
  replacing: 'update.steps.replacing',
  restarting: 'update.steps.restarting',
} as const

export function UpdateDialog({ open, onOpenChange }: UpdateDialogProps) {
  const { t } = useTranslation('common')
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)
  const updateCompleteRef = useRef(false)
  const { auth } = useAuthStore()

  // Check for updates
  const {
    data: updateInfo,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['update-check'],
    queryFn: async () => {
      const response = await api.get('/api/admin/update/check')
      return response.data as UpdateInfo
    },
    enabled: open,
    staleTime: 0,
    retry: 1,
  })

  // Start update with SSE using fetch (more reliable than EventSource for auth)
  const startUpdate = useCallback(async (force = false) => {
    setIsUpdating(true)
    setUpdateProgress(null)
    updateCompleteRef.current = false

    try {
      const url = force ? '/api/admin/update/apply-sse?force=true' : '/api/admin/update/apply-sse'
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'MM-Authorization': auth.accessToken || '',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error(t('update.cannotReadStream'))
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const progress = JSON.parse(line.slice(6)) as UpdateProgress
              setUpdateProgress(progress)

              if (progress.step === 'done') {
                updateCompleteRef.current = true
                toast.success(t('update.updateSuccess'))
                setTimeout(() => {
                  window.location.reload()
                }, 3000)
                return
              } else if (progress.step === 'error') {
                updateCompleteRef.current = true
                setIsUpdating(false)
                toast.error(progress.message)
                return
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      // Stream ended without done/error
      if (!updateCompleteRef.current) {
        setIsUpdating(false)
        toast.error(t('update.connectionClosed'))
      }
    } catch (error) {
      if (!updateCompleteRef.current) {
        setIsUpdating(false)
        toast.error(t('update.updateFailed', { error: error instanceof Error ? error.message : t('update.unknownError') }))
      }
    }
  }, [auth.accessToken])

  // Cleanup on close
  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen)
  }

  const isCheckingOrRefetching = isLoading || isRefetching

  // Get current step index for UI
  const currentStepIndex = STEP_KEYS.findIndex(k => k === updateProgress?.step)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-md overflow-hidden'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <RefreshCw className='size-5' /> {t('update.title')}
          </DialogTitle>
          <DialogDescription>{t('update.description')}</DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {isCheckingOrRefetching ? (
            <div className='text-center py-8'>
              <RefreshCw className='size-8 animate-spin mx-auto mb-3 text-primary' />
              <p className='text-sm text-muted-foreground'>{t('update.checking')}</p>
            </div>
          ) : updateInfo?.has_update ? (
            <div className='space-y-4'>
              <div className='flex items-center gap-2 text-amber-500'>
                <AlertTriangle className='size-5' />
                <span className='font-medium'>{t('update.newVersion')}</span>
              </div>

              <div className='bg-muted/50 rounded-lg p-3 space-y-2'>
                <div className='flex justify-between text-sm'>
                  <span className='text-muted-foreground'>{t('update.currentVersion')}</span>
                  <span className='font-mono'>v{updateInfo.current_version}</span>
                </div>
                <div className='flex justify-between text-sm'>
                  <span className='text-muted-foreground'>{t('update.latestVersion')}</span>
                  <span className='font-mono text-green-600'>
                    v{updateInfo.latest_version}
                  </span>
                </div>
              </div>

              {updateInfo.release_notes && !isUpdating && (
                <div className='space-y-2 overflow-hidden'>
                  <p className='text-sm font-medium'>{t('update.releaseNotes')}</p>
                  <div className='bg-muted/30 rounded-lg p-3 max-h-40 overflow-y-auto overflow-x-hidden'>
                    <p className='text-sm text-muted-foreground whitespace-pre-wrap break-all'>
                      {updateInfo.release_notes}
                    </p>
                  </div>
                </div>
              )}

              {/* Progress UI */}
              {isUpdating && (
                <div className='space-y-4'>
                  <div className='space-y-2'>
                    {STEP_KEYS.map((stepKey, index) => {
                      const isCompleted = index < currentStepIndex
                      const isCurrent = stepKey === updateProgress?.step
                      const isPending = index > currentStepIndex || currentStepIndex === -1

                      return (
                        <div key={stepKey} className='flex items-center gap-3'>
                          {isCompleted ? (
                            <CheckCircle className='size-5 text-green-500 shrink-0' />
                          ) : isCurrent ? (
                            <RefreshCw className='size-5 text-primary animate-spin shrink-0' />
                          ) : (
                            <Circle className='size-5 text-muted-foreground shrink-0' />
                          )}
                          <span
                            className={
                              isCurrent
                                ? 'font-medium'
                                : isPending
                                  ? 'text-muted-foreground'
                                  : ''
                            }
                          >
                            {t(STEP_LABEL_MAP[stepKey])}
                          </span>
                          {isCurrent && stepKey === 'downloading' && updateProgress && (
                            <span className='ml-auto text-sm font-mono'>
                              {updateProgress.progress}%
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Progress bar for downloading */}
                  {updateProgress?.step === 'downloading' && (
                    <Progress value={updateProgress.progress} className='h-2' />
                  )}

                  <div className='bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3'>
                    <p className='text-sm text-blue-600 dark:text-blue-400'>
                      {updateProgress?.message || t('update.preparing')}
                    </p>
                  </div>
                </div>
              )}

              {!isUpdating && (
                <div className='flex flex-col gap-2'>
                  <Button
                    onClick={() => startUpdate()}
                    disabled={isUpdating || !updateInfo.download_url}
                    className='w-full'
                  >
                    <Download className='size-4 mr-2' />
                    {t('update.updateNow')}
                  </Button>

                  {!updateInfo.download_url && (
                    <p className='text-xs text-destructive text-center'>
                      {t('update.noDownload')}
                    </p>
                  )}

                  {updateInfo.release_url && (
                    <Button
                      variant='outline'
                      className='w-full'
                      onClick={() => window.open(updateInfo.release_url, '_blank')}
                    >
                      <ExternalLink className='size-4 mr-2' />
                      {t('update.viewRelease')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className='text-center py-8'>
              <CheckCircle className='size-12 text-green-500 mx-auto mb-3' />
              <p className='font-medium text-lg'>{t('update.upToDate')}</p>
              <p className='text-sm text-muted-foreground mt-1'>
                {t('update.currentVersionLabel', { version: updateInfo?.current_version })}
              </p>
              <Button
                variant='outline'
                size='sm'
                onClick={() => startUpdate(true)}
                disabled={isUpdating}
                className='mt-4'
              >
                <Download className='size-4 mr-2' />
                {t('update.forceReinstall')}
              </Button>
            </div>
          )}

          <Button
            variant='outline'
            onClick={() => refetch()}
            disabled={isCheckingOrRefetching || isUpdating}
            className='w-full'
          >
            <RefreshCw
              className={`size-4 mr-2 ${isCheckingOrRefetching ? 'animate-spin' : ''}`}
            />
            {t('update.recheck')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
