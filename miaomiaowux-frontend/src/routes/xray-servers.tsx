import { createFileRoute, Outlet } from '@tanstack/react-router'
import { Topbar } from '@/components/layout/topbar'

export const Route = createFileRoute('/xray-servers')({
  component: XrayServersLayout,
})

function XrayServersLayout() {
  return (
    <div className="min-h-svh bg-background">
      <Topbar />
      <Outlet />
    </div>
  )
}
