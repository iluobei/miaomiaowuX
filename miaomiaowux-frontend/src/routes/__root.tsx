import { type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { Bug, MessageCircle } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { NavigationProgress } from '@/components/navigation-progress'
import { Sidebar } from '@/components/layout/sidebar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
      <Popover>
        <PopoverTrigger asChild>
          <button
            className='fixed left-0 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1 rounded-r-lg bg-muted/80 backdrop-blur-sm border border-l-0 border-border px-1.5 py-2 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground'
            aria-label='反馈问题'
          >
            <Bug className='size-4' />
          </button>
        </PopoverTrigger>
        <PopoverContent side='right' align='center' className='w-56 p-3'>
          <p className='text-sm font-medium mb-2'>反馈问题</p>
          <div className='space-y-2'>
            <a
              href='https://t.me/miaomiaowux'
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors'
            >
              <MessageCircle className='size-4' />
              Telegram 群组
            </a>
            <a
              href='https://github.com/iluobei/miaomiaowuX/issues'
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors'
            >
              <Bug className='size-4' />
              GitHub Issues
            </a>
          </div>
        </PopoverContent>
      </Popover>
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
