import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()

  const handleSignOut = () => {
    auth.reset()
    queryClient.removeQueries({ queryKey: ['traffic-summary'] })
    queryClient.removeQueries({ queryKey: ['user-token'] })
    queryClient.removeQueries({ queryKey: ['profile'] })
    navigate({
      to: '/',
      replace: true,
    })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('signOut.title')}
      desc={t('signOut.description')}
      confirmText={t('signOut.confirm')}
      cancelBtnText={t('signOut.cancel')}
      handleConfirm={handleSignOut}
      className='sm:max-w-sm'
    />
  )
}
