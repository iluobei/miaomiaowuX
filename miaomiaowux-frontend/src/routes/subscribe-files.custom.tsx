import { useTranslation } from 'react-i18next'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/subscribe-files/custom')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: CustomProxyGroupPage,
})

function CustomProxyGroupPage() {
  const { t } = useTranslation('subscribe')
  return (
    <main className='mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 pt-24'>
      <section className='space-y-4'>
        <div>
          <h1 className='text-3xl font-semibold tracking-tight'>{t('customProxyGroup.title')}</h1>
          <p className='text-muted-foreground mt-2'>
            {t('customProxyGroup.description')}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('customProxyGroup.wip')}</CardTitle>
            <CardDescription>
              {t('customProxyGroup.wipDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className='text-sm text-muted-foreground'>
              {t('customProxyGroup.wipDetail')}
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
