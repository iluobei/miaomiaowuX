import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Users, Package, Settings, Shield, Server, LayoutTemplate, Network } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useLayoutStore } from '@/stores/layout-store'
import { profileQueryFn } from '@/lib/profile'
import { cn } from '@/lib/utils'

const baseNavLinks = [
  {
    title: '首页',
    to: '/',
    icon: Activity,
  },
]

const adminNavLinks = [
  {
    title: '节点管理',
    to: '/nodes',
    icon: Network,
  },
  {
    title: '证书管理',
    to: '/certificates',
    icon: Shield,
  },
  {
    title: '服务管理',
    to: '/xray-servers',
    icon: Server,
  },
  {
    title: '用户管理',
    to: '/users',
    icon: Users,
  },
  {
    title: '套餐管理',
    to: '/packages',
    icon: Package,
  },
  {
    title: '模板管理',
    to: '/templates',
    icon: LayoutTemplate,
  },
  {
    title: '系统设置',
    to: '/system-settings',
    icon: Settings,
  },
]

export function Sidebar() {
  const { auth } = useAuthStore()
  const { sidebarCollapsed } = useLayoutStore()

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: profileQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const isAdmin = Boolean(profile?.is_admin)
  const allNavLinks = isAdmin ? [...baseNavLinks, ...adminNavLinks] : baseNavLinks

  return (
    <aside
      className={cn(
        'fixed left-0 top-16 bottom-0 z-40 border-r border-[color:rgba(241,140,110,0.22)] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-all duration-300 shadow-[2px_0_12px_rgba(0,0,0,0.08)] dark:shadow-[2px_0_15px_rgba(0,0,0,0.4)]',
        sidebarCollapsed ? 'w-16' : 'w-52'
      )}
    >
      <div className="flex flex-col h-full">
        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto py-3 px-3">
          <div className="flex flex-col gap-2">
            {allNavLinks.map(({ title, to, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                title={title}
                className={cn(
                  'pixel-button inline-flex items-center gap-2 py-2 h-9 text-sm font-semibold uppercase tracking-widest bg-background/75 text-foreground border-[color:rgba(137,110,96,0.45)] shadow-sm hover:bg-accent/35 hover:text-accent-foreground hover:shadow-[0_0_12px_rgba(217,119,87,0.4)] dark:bg-input/30 dark:border-[color:rgba(255,255,255,0.18)] dark:hover:bg-accent/45 dark:hover:text-accent-foreground dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)] dark:hover:shadow-[0_0_15px_rgba(217,119,87,0.5)] transition-all duration-200 w-full justify-center',
                  sidebarCollapsed && 'px-2'
                )}
                activeProps={{
                  className: 'bg-primary/20 text-primary border-[color:rgba(217,119,87,0.55)] shadow-[0_0_10px_rgba(217,119,87,0.35)] dark:bg-primary/20 dark:border-[color:rgba(217,119,87,0.55)] dark:shadow-[0_0_12px_rgba(217,119,87,0.45)]'
                }}
              >
                <Icon className="size-[18px] shrink-0" />
                {!sidebarCollapsed && <span>{title}</span>}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </aside>
  )
}
