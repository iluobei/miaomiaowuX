import { createFileRoute, Outlet } from '@tanstack/react-router'
import { Topbar } from '@/components/layout/topbar'

type InboundsSearch = {
  remote_server_id?: number
}

export const Route = createFileRoute('/xray-inbounds')({
  validateSearch: (search: Record<string, unknown>): InboundsSearch => {
    return {
      remote_server_id: search.remote_server_id ? Number(search.remote_server_id) : undefined,
    }
  },
  component: XrayInboundsLayout,
})

function XrayInboundsLayout() {
  return (
    <div className="min-h-svh bg-background">
      <Topbar />
      <Outlet />
    </div>
  )
}
