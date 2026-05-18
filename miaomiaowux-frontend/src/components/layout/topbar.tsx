import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Users, LayoutTemplate, Menu, Network, Package, Settings, PanelLeft, ChevronLeft, ChevronRight, MoreHorizontal, Shield, Server, Link2, FileText, Scissors, LinkIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ThemeSwitch } from '@/components/theme-switch'
import { UserMenu } from './user-menu'
import { useAuthStore } from '@/stores/auth-store'
import { useLayoutStore } from '@/stores/layout-store'
import { profileQueryFn } from '@/lib/profile'
import { api } from '@/lib/api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { AnimatedX } from '@/components/animated-x'
import { useState, useRef, useLayoutEffect } from 'react'

const baseNavLinks = [
  { titleKey: 'nav.trafficInfo' as const, to: '/', icon: Activity },
]

const coreAdminNavLinks = [
  { titleKey: 'nav.nodeManagement' as const, to: '/nodes', icon: Network },
  { titleKey: 'nav.serviceManagement' as const, to: '/xray-servers', icon: Server },
  { titleKey: 'nav.userManagement' as const, to: '/users', icon: Users },
  { titleKey: 'nav.packageManagement' as const, to: '/packages', icon: Package },
  { titleKey: 'nav.certificateManagement' as const, to: '/certificates', icon: Shield },
]

const mmwTopNavLinks = [
  { titleKey: 'nav.subscriptionLinks' as const, to: '/subscription', icon: LinkIcon },
  { titleKey: 'nav.subscriptionGenerator' as const, to: '/generator', icon: Link2 },
]

const mmwBottomNavLinks = [
  { titleKey: 'nav.templateManagement' as const, to: '/templates', icon: LayoutTemplate },
  { titleKey: 'nav.subscriptionManagement' as const, to: '/subscribe-files', icon: FileText },
  { titleKey: 'nav.customRulesManagement' as const, to: '/custom-rules', icon: Scissors },
]

const tailAdminNavLinks = [
  { titleKey: 'nav.systemSettings' as const, to: '/system-settings', icon: Settings },
]

export function Topbar() {
  const { t } = useTranslation()
  const { auth } = useAuthStore()
  const { layoutMode, setLayoutMode, sidebarCollapsed, toggleSidebar } = useLayoutStore()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const [iconOnlyCount, setIconOnlyCount] = useState(0)
  const [hideLogoText, setHideLogoText] = useState(false)
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false)
  const [overflowCount, setOverflowCount] = useState(0) // 需要收到下拉菜单的按钮数量

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: profileQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const isAdmin = Boolean(profile?.is_admin)

  const { data: mmwFeaturesData } = useQuery({
    queryKey: ['miaomiaowu-features-enabled'],
    queryFn: async () => {
      const response = await api.get('/api/admin/system-settings/miaomiaowu-features')
      return response.data as { success: boolean; enable_miaomiaowu_features: boolean }
    },
    enabled: Boolean(auth.accessToken) && isAdmin,
    staleTime: 5 * 60 * 1000,
  })
  const enableMmwFeatures = mmwFeaturesData?.enable_miaomiaowu_features ?? true

  // 计算所有导航链接
  const adminNavLinks = [...(enableMmwFeatures ? mmwTopNavLinks : []), ...coreAdminNavLinks, ...(enableMmwFeatures ? mmwBottomNavLinks : []), ...tailAdminNavLinks]
  const allNavLinks = isAdmin ? [...baseNavLinks, ...adminNavLinks] : baseNavLinks
  const totalLinks = allNavLinks.length

  const buttonWidthsRef = useRef<number[]>([])
  const logoTextWidthRef = useRef(0)
  const hideLogoTextRef = useRef(false)

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return

    const ICON_WIDTH = 36 // w-9 = 2.25rem
    const OVERFLOW_BTN_WIDTH = 36

    const doCalculate = () => {
      if (!nav.isConnected) return
      const availableWidth = nav.clientWidth
      if (availableWidth <= 0) return

      // 测量 logo 文字宽度（仅在文字可见时）
      if (!hideLogoTextRef.current) {
        const logoTextEl = nav.parentElement?.querySelector<HTMLElement>('[data-logo-text]')
        if (logoTextEl) {
          const parentGap = parseFloat(getComputedStyle(nav.parentElement!).gap) || 24
          logoTextWidthRef.current = logoTextEl.offsetWidth + parentGap
        }
      }

      // 测量按钮实际宽度（仅在全文字模式下）
      const buttons = Array.from(nav.querySelectorAll<HTMLElement>('[data-nav-item]'))
      if (buttons.length === totalLinks && buttons.every(b => b.dataset.iconOnly !== 'true')) {
        buttonWidthsRef.current = buttons.map(b => b.offsetWidth)
      }

      const btnWidths = buttonWidthsRef.current.length === totalLinks
        ? buttonWidthsRef.current
        : Array(totalLinks).fill(115)

      const gap = parseFloat(getComputedStyle(nav).gap) || 12

      // 以"显示 logo 文字"为基准计算可用宽度
      const logoTextW = logoTextWidthRef.current || 90
      const baseAvailable = hideLogoTextRef.current
        ? availableWidth - logoTextW
        : availableWidth

      // 所有按钮全文字的总宽度
      const fullContentWidth = btnWidths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0)

      // 阶段1：全部显示（含logo文字）
      if (fullContentWidth <= baseAvailable) {
        hideLogoTextRef.current = false
        setHideLogoText(false)
        setIconOnlyCount(0)
        setOverflowCount(0)
        return
      }

      // 阶段2：隐藏 logo 文字
      const availableNoLogo = baseAvailable + logoTextW
      if (fullContentWidth <= availableNoLogo) {
        hideLogoTextRef.current = true
        setHideLogoText(true)
        setIconOnlyCount(0)
        setOverflowCount(0)
        return
      }

      // 阶段3：从右往左收起按钮文字
      hideLogoTextRef.current = true
      setHideLogoText(true)

      let saved = 0
      let collapseCount = 0
      for (let i = btnWidths.length - 1; i >= 0; i--) {
        saved += btnWidths[i] - ICON_WIDTH
        collapseCount++
        if (fullContentWidth - saved <= availableNoLogo) {
          setIconOnlyCount(collapseCount)
          setOverflowCount(0)
          return
        }
      }

      // 阶段4：全部图标仍不够，放入溢出菜单
      setIconOnlyCount(totalLinks)
      const allIconWidth = totalLinks * (ICON_WIDTH + gap) - gap + OVERFLOW_BTN_WIDTH + gap
      if (allIconWidth > availableNoLogo) {
        const excess = allIconWidth - availableNoLogo
        const toHide = Math.ceil(excess / (ICON_WIDTH + gap))
        setOverflowCount(Math.min(toHide, totalLinks - 1))
      } else {
        setOverflowCount(0)
      }
    }

    doCalculate()

    const observer = new ResizeObserver(() => doCalculate())
    observer.observe(nav)
    if (nav.parentElement) observer.observe(nav.parentElement)

    return () => observer.disconnect()
  }, [totalLinks])

  return (
    <header className='fixed top-0 left-0 right-0 z-50 border-b border-[color:rgba(241,140,110,0.22)] bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60'>
      <div className='flex h-16 items-center justify-between px-4 sm:px-6'>
        <div className='flex items-center gap-4 sm:gap-6 min-w-0 flex-1 overflow-x-clip overflow-y-visible'>
          <Link
            to='/'
            className='flex items-center gap-3 font-semibold text-lg tracking-tight transition hover:text-primary outline-none focus:outline-none shrink-0'
          >
            <img
              src='/images/mmwx_light.webp'
              alt={`${t('brand')} Logo`}
              className='h-10 w-10 border-2 border-[color:rgba(241,140,110,0.4)] shadow-[4px_4px_0_rgba(0,0,0,0.2)] shrink-0 dark:hidden'
            />
            <img
              src='/images/logo.webp'
              alt={`${t('brand')} Logo`}
              className='h-10 w-10 border-2 border-[color:rgba(241,140,110,0.4)] shadow-[4px_4px_0_rgba(0,0,0,0.2)] shrink-0 hidden dark:block'
            />
            {!hideLogoText && <span data-logo-text className='hidden md:inline pixel-text text-primary text-base whitespace-nowrap'>{t('brand').replace('X', '')}<AnimatedX size="sm" /></span>}
          </Link>

          {/* Sidebar Toggle Button - Only show in sidebar mode */}
          {layoutMode === 'sidebar' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="hidden md:inline-flex h-9 w-9 pixel-button bg-background/75 border-[color:rgba(137,110,96,0.45)] hover:bg-accent/35 dark:bg-input/30 dark:border-[color:rgba(255,255,255,0.18)] dark:hover:bg-accent/45"
              title={sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
          )}

          {/* Desktop Navigation - Base links + Admin links (only show in top mode) */}
          {layoutMode === 'top' && (
            <nav ref={navRef} className='hidden md:flex flex-1 min-w-0 items-center gap-2 md:gap-3 overflow-x-clip overflow-y-visible pr-[3px]'>
            {allNavLinks.slice(0, totalLinks - overflowCount).map(({ titleKey, to, icon: Icon }, index) => {
              const label = t(titleKey)
              const showIconOnly = index >= totalLinks - overflowCount - iconOnlyCount

              return (
                <Link
                  key={to}
                  to={to}
                  data-nav-item
                  data-icon-only={showIconOnly ? 'true' : undefined}
                  aria-label={label}
                  title={label}
                  className={`pixel-button inline-flex items-center gap-2 py-2 h-9 text-sm font-semibold uppercase tracking-widest bg-background/75 text-foreground border-[color:rgba(137,110,96,0.45)] hover:bg-accent/35 hover:text-accent-foreground dark:bg-input/30 dark:border-[color:rgba(255,255,255,0.18)] dark:hover:bg-accent/45 dark:hover:text-accent-foreground transition-all whitespace-nowrap ${
                    showIconOnly ? 'justify-center px-2 w-9' : 'justify-start px-3'
                  }`}
                  activeProps={{
                    className: 'bg-primary/20 text-primary border-[color:rgba(217,119,87,0.55)] dark:bg-primary/20 dark:border-[color:rgba(217,119,87,0.55)]'
                  }}
                >
                  <Icon className='size-[18px] shrink-0' />
                  {!showIconOnly && <span>{label}</span>}
                </Link>
              )
            })}
            {/* Overflow menu for hidden buttons */}
            {overflowCount > 0 && (
              <DropdownMenu open={overflowMenuOpen} onOpenChange={setOverflowMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='outline'
                    size='icon'
                    className='pixel-button h-9 w-9 bg-background/75 border-[color:rgba(137,110,96,0.45)] hover:bg-accent/35 dark:bg-input/30 dark:border-[color:rgba(255,255,255,0.18)] dark:hover:bg-accent/45'
                  >
                    <MoreHorizontal className='h-5 w-5' />
                    <span className='sr-only'>{t('sidebar.moreMenu')}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-48 pixel-border'>
                  {allNavLinks.slice(totalLinks - overflowCount).map(({ titleKey, to, icon: Icon }) => (
                    <DropdownMenuItem key={to} asChild>
                      <Link
                        to={to}
                        className='flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/35 focus:bg-accent/35'
                        onClick={() => setOverflowMenuOpen(false)}
                      >
                        <Icon className='size-[18px] shrink-0' />
                        <span>{t(titleKey)}</span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            </nav>
          )}

          {/* Mobile Base Navigation - Only show on mobile */}
          <nav className='md:hidden flex items-center gap-2'>
            {baseNavLinks.map(({ titleKey, to, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                aria-label={t(titleKey)}
                className='pixel-button inline-flex items-center justify-center gap-2 px-2 py-2 h-9 text-sm font-semibold uppercase tracking-widest bg-background/75 text-foreground border-[color:rgba(137,110,96,0.45)] hover:bg-accent/35 hover:text-accent-foreground dark:bg-input/30 dark:border-[color:rgba(255,255,255,0.18)] dark:hover:bg-accent/45 dark:hover:text-accent-foreground transition-all'
                activeProps={{
                  className: 'bg-primary/20 text-primary border-[color:rgba(217,119,87,0.55)] dark:bg-primary/20 dark:border-[color:rgba(217,119,87,0.55)]'
                }}
              >
                <Icon className='size-[18px] shrink-0' />
              </Link>
            ))}
          </nav>

          {/* Mobile Navigation Dropdown - Only show on mobile for admin */}
          {isAdmin && (
            <DropdownMenu open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='outline'
                  size='icon'
                  className='md:hidden pixel-button h-9 w-9 bg-background/75 border-[color:rgba(137,110,96,0.45)] hover:bg-accent/35 dark:bg-input/30 dark:border-[color:rgba(255,255,255,0.18)] dark:hover:bg-accent/45'
                >
                  <Menu className='h-5 w-5' />
                  <span className='sr-only'>{t('sidebar.openMenu')}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' className='w-48 pixel-border'>
                {adminNavLinks.map(({ titleKey, to, icon: Icon }) => (
                  <DropdownMenuItem key={to} asChild>
                    <Link
                      to={to}
                      className='flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/35 focus:bg-accent/35'
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <Icon className='size-[18px] shrink-0' />
                      <span>{t(titleKey)}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className='flex items-center gap-2 sm:gap-3 pl-2 sm:pl-0 shrink-0'>
          {/* Layout Mode Toggle - Desktop only */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLayoutMode(layoutMode === 'top' ? 'sidebar' : 'top')}
            className="hidden md:inline-flex h-9 w-9 pixel-button bg-background/75 border-[color:rgba(137,110,96,0.45)] hover:bg-accent/35 dark:bg-input/30 dark:border-[color:rgba(255,255,255,0.18)] dark:hover:bg-accent/45"
            title={layoutMode === 'top' ? t('sidebar.switchToSidebar') : t('sidebar.switchToTopMenu')}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <ThemeSwitch />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
