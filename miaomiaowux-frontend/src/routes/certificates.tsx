import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { PageLayout } from '@/components/layout/page-layout'

export const Route = createFileRoute('/certificates')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: CertificatesLayout,
})

function CertificatesLayout() {
  return (
    <PageLayout>
      <Outlet />
    </PageLayout>
  )
}
