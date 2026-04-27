import { createFileRoute, Outlet } from '@tanstack/react-router'
import { Topbar } from '@/components/layout/topbar'

type OutboundsSearch = {
  remote_server_id?: number
}

export const Route = createFileRoute('/xray-outbounds')({
  validateSearch: (search: Record<string, unknown>): OutboundsSearch => {
    return {
      remote_server_id: search.remote_server_id ? Number(search.remote_server_id) : undefined,
    }
  },
  component: XrayOutboundsLayout,
})

function XrayOutboundsLayout() {
  return (
    <div className="min-h-svh bg-background">
      <Topbar />
      <Outlet />
    </div>
  )
}
