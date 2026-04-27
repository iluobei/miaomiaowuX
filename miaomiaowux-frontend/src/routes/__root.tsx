import { type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { Toaster } from '@/components/ui/sonner'
import { NavigationProgress } from '@/components/navigation-progress'
import { Sidebar } from '@/components/layout/sidebar'
import { useLayoutStore } from '@/stores/layout-store'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'

function RootLayout() {
  const { layoutMode, sidebarCollapsed } = useLayoutStore()
  const { auth } = useAuthStore()
  const routerState = useRouterState()

  // 只在已登录且不在登录页时显示侧边栏
  const isLoginPage = routerState.location.pathname === '/login'
  const isLoggedIn = Boolean(auth.accessToken)
  const showSidebar = layoutMode === 'sidebar' && isLoggedIn && !isLoginPage

  return (
    <>
      <NavigationProgress />
      {showSidebar && <Sidebar />}
      <div
        className={cn(
          'transition-all duration-300',
          showSidebar && (sidebarCollapsed ? 'md:pl-16' : 'md:pl-52')
        )}
      >
        <Outlet />
      </div>
      <Toaster duration={5000} visibleToasts={5} />
      {import.meta.env.MODE === 'development' && (
        <>
          <ReactQueryDevtools buttonPosition='bottom-left' />
          <TanStackRouterDevtools position='bottom-right' />
        </>
      )}
    </>
  )
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  component: RootLayout,
  notFoundComponent: () => (
    <div className='flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center'>
      <h1 className='text-3xl font-semibold tracking-tight'>页面不存在</h1>
      <p className='text-muted-foreground'>请检查链接或返回首页。</p>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className='flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center'>
      <h1 className='text-3xl font-semibold tracking-tight'>发生错误</h1>
      <p className='text-muted-foreground'>{error?.message ?? '请稍后重试。'}</p>
    </div>
  ),
})
