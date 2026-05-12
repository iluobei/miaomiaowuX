import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Users, LayoutTemplate, Menu, Network, Package, Settings, PanelLeft, ChevronLeft, ChevronRight, MoreHorizontal, Shield, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ThemeSwitch } from '@/components/theme-switch'
import { UserMenu } from './user-menu'
import { useAuthStore } from '@/stores/auth-store'
import { useLayoutStore } from '@/stores/layout-store'
import { profileQueryFn } from '@/lib/profile'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { AnimatedX } from '@/components/animated-x'
import { useState, useRef, useEffect, useCallback } from 'react'

const baseNavLinks = [
  { titleKey: 'nav.trafficInfo' as const, to: '/', icon: Activity },
]

const adminNavLinks = [
  { titleKey: 'nav.nodeManagement' as const, to: '/nodes', icon: Network },
  { titleKey: 'nav.serviceManagement' as const, to: '/xray-servers', icon: Server },
  { titleKey: 'nav.userManagement' as const, to: '/users', icon: Users },
  { titleKey: 'nav.packageManagement' as const, to: '/packages', icon: Package },
  { titleKey: 'nav.certificateManagement' as const, to: '/certificates', icon: Shield },
  { titleKey: 'nav.templateManagement' as const, to: '/templates', icon: LayoutTemplate },
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

  // 计算所有导航链接
  const allNavLinks = isAdmin ? [...baseNavLinks, ...adminNavLinks] : baseNavLinks
  const totalLinks = allNavLinks.length

  // 计算需要隐藏文字的按钮数量（从后往前）
  const calculateIconOnlyCount = useCallback(() => {
    if (!navRef.current) return

    // 直接获取窗口宽度
    const windowWidth = window.innerWidth
    // 预留空间：logo图片约60px，右侧按钮区约200px，左右padding约48px，间距约24px
    const logoTextWidth = 90 // "妙妙屋X" 文字宽度
    const baseReservedSpace = 300

    // 每个带文字按钮约115px（4字+图标+padding），纯图标按钮约44px，gap约12px
    const fullButtonWidth = 115
    const iconButtonWidth = 44
    const gap = 12
    // 溢出菜单按钮宽度
    const overflowButtonWidth = 44

    // 计算全部显示文字需要的宽度
    const fullWidth = totalLinks * (fullButtonWidth + gap) - gap
    const availableWithLogoText = windowWidth - baseReservedSpace - logoTextWidth

    if (fullWidth <= availableWithLogoText) {
      // 空间够，全部显示
      setIconOnlyCount(0)
      setHideLogoText(false)
      setOverflowCount(0)
      return
    }

    // 空间不够，先隐藏"妙妙屋X"文字
    setHideLogoText(true)
    const availableWithoutLogoText = windowWidth - baseReservedSpace

    if (fullWidth <= availableWithoutLogoText) {
      // 隐藏logo文字后空间够了
      setIconOnlyCount(0)
      setOverflowCount(0)
      return
    }

    // 还不够，需要隐藏部分按钮文字
    const savedPerButton = fullButtonWidth - iconButtonWidth
    const overflowWidth = fullWidth - availableWithoutLogoText
    const needed = Math.ceil(overflowWidth / savedPerButton)

    if (needed <= totalLinks) {
      // 隐藏部分按钮文字即可
      setIconOnlyCount(Math.min(needed, totalLinks))
      setOverflowCount(0)
      return
    }

    // 所有按钮都只显示图标还不够，需要将部分按钮收到下拉菜单
    setIconOnlyCount(totalLinks)
    const allIconWidth = totalLinks * (iconButtonWidth + gap) - gap
    const stillOverflow = allIconWidth - availableWithoutLogoText + overflowButtonWidth
    if (stillOverflow > 0) {
      const buttonsToHide = Math.ceil(stillOverflow / (iconButtonWidth + gap))
      setOverflowCount(Math.min(buttonsToHide, totalLinks - 1)) // 至少保留1个按钮
    } else {
      setOverflowCount(0)
    }
  }, [totalLinks])

  useEffect(() => {
    calculateIconOnlyCount()

    const resizeObserver = new ResizeObserver(() => {
      calculateIconOnlyCount()
    })

    if (navRef.current?.parentElement?.parentElement) {
      resizeObserver.observe(navRef.current.parentElement.parentElement)
    }

    window.addEventListener('resize', calculateIconOnlyCount)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', calculateIconOnlyCount)
    }
  }, [calculateIconOnlyCount])

  return (
    <header className='fixed top-0 left-0 right-0 z-50 border-b border-[color:rgba(241,140,110,0.22)] bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60'>
      <div className='flex h-16 items-center justify-between px-4 sm:px-6'>
        <div className='flex items-center gap-4 sm:gap-6 min-w-0 flex-1 overflow-hidden'>
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
            {!hideLogoText && <span className='hidden md:inline pixel-text text-primary text-base whitespace-nowrap'>{t('brand').replace('X', '')}<AnimatedX size="sm" /></span>}
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
            <nav ref={navRef} className='hidden md:flex items-center gap-2 md:gap-3 overflow-hidden'>
            {allNavLinks.slice(0, totalLinks - overflowCount).map(({ titleKey, to, icon: Icon }, index) => {
              const label = t(titleKey)
              const showIconOnly = index >= totalLinks - overflowCount - iconOnlyCount

              return (
                <Link
                  key={to}
                  to={to}
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
