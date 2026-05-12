import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, Upload, HardDrive, AlertTriangle } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface BackupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BackupDialog({ open, onOpenChange }: BackupDialogProps) {
  const { t } = useTranslation('common')
  const [backupFile, setBackupFile] = useState<File | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  // Download backup
  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      const response = await api.get('/api/admin/backup/download', {
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      link.setAttribute('download', `miaomiaowu-backup-${timestamp}.zip`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast.success(t('backup.downloadSuccess'))
    } catch {
      toast.error(t('backup.downloadFailed'))
    } finally {
      setIsDownloading(false)
    }
  }

  // Restore backup
  const restoreMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('backup', file)
      return api.post('/api/admin/backup/restore', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      toast.success(t('backup.restoreSuccess'))
      setBackupFile(null)
      onOpenChange(false)
      // Reload page after a short delay
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    },
    onError: () => {
      toast.error(t('backup.restoreFailed'))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <HardDrive className='size-5' /> {t('backup.title')}
          </DialogTitle>
          <DialogDescription>
            {t('backup.description')}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-6'>
          {/* Download backup */}
          <div className='space-y-2'>
            <Label>{t('backup.downloadLabel')}</Label>
            <Button
              onClick={handleDownload}
              disabled={isDownloading}
              className='w-full'
            >
              <Download className='size-4 mr-2' />
              {isDownloading ? t('backup.downloading') : t('backup.downloadButton')}
            </Button>
          </div>

          {/* Restore backup */}
          <div className='space-y-3'>
            <Label>{t('backup.restoreLabel')}</Label>
            <Input
              type='file'
              accept='.zip'
              onChange={(e) => setBackupFile(e.target.files?.[0] || null)}
              className='cursor-pointer'
            />
            <Button
              onClick={() => backupFile && restoreMutation.mutate(backupFile)}
              disabled={!backupFile || restoreMutation.isPending}
              variant='destructive'
              className='w-full'
            >
              <Upload className='size-4 mr-2' />
              {restoreMutation.isPending ? t('backup.restoring') : t('backup.restoreButton')}
            </Button>
            <div className='flex items-start gap-2 text-xs text-muted-foreground'>
              <AlertTriangle className='size-4 shrink-0 text-destructive' />
              <span>{t('backup.restoreWarning')}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
