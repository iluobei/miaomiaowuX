import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Home,
  BookOpen,
  Download,
  Settings,
  Users,
  Zap,
  HelpCircle,
  Activity,
  Link as LinkIcon,
  Network,
  Radar,
  Database,
  FileCode,
  ChevronDown,
  ChevronRight,
  Wrench,
  Sparkles,
  Github,
  ChevronUp,
  Shield,
  Eye,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ThemeSwitch } from '@/components/theme-switch'
import { cn } from '@/lib/utils'
import { useState, useEffect } from 'react'

// Import client icons
import clashIcon from '@/assets/icons/clash_color.png'
import stashIcon from '@/assets/icons/stash_color.png'
import shadowrocketIcon from '@/assets/icons/shadowrocket_color.png'
import surfboardIcon from '@/assets/icons/surfboard_color.png'
import surgeIcon from '@/assets/icons/surge_color.png'
import surgeMacIcon from '@/assets/icons/surgeformac_icon_color.png'
import loonIcon from '@/assets/icons/loon_color.png'
import quanxIcon from '@/assets/icons/quanx_color.png'
import egernIcon from '@/assets/icons/egern_color.png'
import singboxIcon from '@/assets/icons/sing-box_color.png'
import v2rayIcon from '@/assets/icons/v2ray_color.png'
import uriIcon from '@/assets/icons/uri-color.svg'

// Import node management icons
import IpIcon from '@/assets/icons/ip.svg'
import ExchangeIcon from '@/assets/icons/exchange.svg'

export const Route = createFileRoute('/docs')({
  component: DocsPage,
})

// Client types configuration with icons and names (same as subscription page)
const CLIENT_TYPES = [
  { type: 'clash', name: 'Clash', icon: clashIcon },
  { type: 'stash', name: 'Stash', icon: stashIcon },
  { type: 'shadowrocket', name: 'Shadowrocket', icon: shadowrocketIcon },
  { type: 'surfboard', name: 'Surfboard', icon: surfboardIcon },
  { type: 'surge', name: 'Surge', icon: surgeIcon },
  { type: 'surgemac', name: 'Surge Mac', icon: surgeMacIcon },
  { type: 'loon', name: 'Loon', icon: loonIcon },
  { type: 'qx', name: 'QuantumultX', icon: quanxIcon },
  { type: 'egern', name: 'Egern', icon: egernIcon },
  { type: 'sing-box', name: 'sing-box', icon: singboxIcon },
  { type: 'v2ray', name: 'V2Ray', icon: v2rayIcon },
  { type: 'uri', name: 'URI', icon: uriIcon },
] as const

type NavItem = {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  children?: NavItem[]
  badge?: string
}

const navItems: NavItem[] = [
  {
    id: 'introduction',
    label: '简介',
    icon: Home,
    children: [
      { id: 'about', label: '关于妙妙屋', icon: BookOpen },
      { id: 'features', label: '核心特性', icon: Sparkles },
      { id: 'quick-start', label: '快速开始', icon: Zap },
    ],
  },
  {
    id: 'installation',
    label: '安装',
    icon: Download,
    children: [
      { id: 'direct-install', label: '直接安装', icon: Download },
      { id: 'docker-install', label: 'Docker安装', icon: Download },
      { id: 'system-requirements', label: '系统要求', icon: Settings },
      { id: 'client-setup', label: '客户端配置', icon: Settings },
      { id: 'import-subscription', label: '导入订阅', icon: LinkIcon },
    ],
  },
  {
    id: 'manual',
    label: '使用手册',
    icon: BookOpen,
    children: [
      { id: 'traffic-info', label: '流量信息', icon: Activity },
      { id: 'subscription-link', label: '订阅链接', icon: LinkIcon },
      { id: 'generator', label: '生成订阅', icon: Zap, badge: '管理员' },
      { id: 'nodes', label: '节点管理', icon: Network, badge: '管理员' },
      { id: 'subscribe-files', label: '订阅管理', icon: Database, badge: '管理员' },
      { id: 'users', label: '用户管理', icon: Users, badge: '管理员' },
      { id: 'custom-rules', label: '自定义规则', icon: FileCode, badge: '管理员' },
      { id: 'system-settings', label: '系统设置', icon: Settings, badge: '管理员' },
    ],
  },
  {
    id: 'advanced',
    label: '高级技巧',
    icon: Wrench,
    children: [
      { id: 'chain-proxy', label: '链式代理', icon: Network }
    ],
  },
  { id: 'faq', label: '常见问题', icon: HelpCircle },
]

function DocsPage() {
  const [activeSection, setActiveSection] = useState('about')
  const [expandedSections, setExpandedSections] = useState<string[]>(['introduction', 'manual', 'advanced'])
  const [showBackToTop, setShowBackToTop] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToSection = (id: string) => {
    setActiveSection(id)
    const element = document.getElementById(id)
    if (element) {
      const offset = 80
      const elementPosition = element.getBoundingClientRect().top + window.scrollY
      window.scrollTo({
        top: elementPosition - offset,
        behavior: 'smooth',
      })
    }
  }

  const toggleSection = (id: string) => {
    setExpandedSections((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const getBreadcrumb = () => {
    for (const item of navItems) {
      if (item.id === activeSection) {
        return [item.label]
      }
      if (item.children) {
        for (const child of item.children) {
          if (child.id === activeSection) {
            return [item.label, child.label]
          }
        }
      }
    }
    return []
  }

  const breadcrumb = getBreadcrumb()

  return (
    <div className='min-h-screen bg-background' style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <header className='sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 h-16'>
        <div className='flex h-16 items-center justify-between px-6 max-w-full'>
          <div className='flex items-center gap-4'>
            <Link to='/' className='flex items-center gap-2'>
              <img
                src='/images/logo.webp'
                alt='妙妙屋 Logo'
                className='h-8 w-8 border-2 border-[color:rgba(241,140,110,0.4)] shadow-[2px_2px_0_rgba(0,0,0,0.2)]'
              />
              <span className='font-bold text-lg pixel-text text-primary'>妙妙屋文档</span>
            </Link>
          </div>
          <div className='flex items-center gap-3'>
            <Button variant='ghost' size='sm' className='gap-2' asChild>
              <Link to='/'>
                <Home className='size-4' />
                返回妙妙屋
              </Link>
            </Button>
            <Button variant='ghost' size='sm' className='gap-2' asChild>
              <a href='https://github.com/Jimleerx/miaomiaowu' target='_blank' rel='noopener noreferrer'>
                <Github className='size-4' />
                GitHub
              </a>
            </Button>
            <ThemeSwitch />
          </div>
        </div>
      </header>

      <div className='flex'>
        {/* Left Sidebar Navigation */}
        <aside className='hidden lg:block w-72 border-r bg-background/50 backdrop-blur supports-[backdrop-filter]:bg-background/30 h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto'>
          <div className='p-4 space-y-4'>
            {/* Navigation Tree */}
            <nav className='space-y-1'>
              {navItems.map((item) => {
                const Icon = item.icon
                const isExpanded = expandedSections.includes(item.id)
                const hasChildren = item.children && item.children.length > 0

                return (
                  <div key={item.id}>
                    <button
                      onClick={() => {
                        if (hasChildren) {
                          toggleSection(item.id)
                        } else {
                          scrollToSection(item.id)
                        }
                      }}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors font-medium',
                        'hover:bg-accent/50 hover:text-accent-foreground',
                        activeSection === item.id && !hasChildren
                          ? 'bg-primary/10 text-primary border-l-2 border-primary'
                          : 'text-foreground/80'
                      )}
                    >
                      <Icon className='size-4 shrink-0' />
                      <span className='flex-1 text-left'>{item.label}</span>
                      {hasChildren && (
                        <span className='ml-auto'>
                          {isExpanded ? (
                            <ChevronDown className='size-4' />
                          ) : (
                            <ChevronRight className='size-4' />
                          )}
                        </span>
                      )}
                    </button>
                    {item.children && item.children.length > 0 && isExpanded && (
                      <div className='ml-6 mt-1 space-y-1 border-l-2 border-border/50 pl-2'>
                        {item.children.map((child) => {
                          const ChildIcon = child.icon
                          return (
                            <button
                              key={child.id}
                              onClick={() => scrollToSection(child.id)}
                              className={cn(
                                'w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors',
                                'hover:bg-accent/50 hover:text-accent-foreground',
                                activeSection === child.id
                                  ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary'
                                  : 'text-muted-foreground'
                              )}
                            >
                              <ChildIcon className='size-3.5 shrink-0' />
                              <span className='flex-1 text-left'>{child.label}</span>
                              {child.badge && (
                                <span className='px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary/80'>
                                  {child.badge}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </nav>
          </div>
        </aside>

        {/* Main Content */}
        <main className='flex-1 min-w-0 bg-background'>
          <div className='max-w-4xl mx-auto px-6 py-8'>
            {/* Breadcrumb */}
            {breadcrumb.length > 0 && (
              <div className='flex items-center gap-2 text-sm text-muted-foreground mb-6 font-mono'>
                <Home className='size-4' />
                {breadcrumb.map((crumb, index) => (
                  <div key={index} className='flex items-center gap-2'>
                    <ChevronRight className='size-4' />
                    <span className={cn(index === breadcrumb.length - 1 && 'text-foreground font-medium')}>
                      {crumb}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Content */}
            <div className='prose prose-neutral dark:prose-invert max-w-none'>
              {/* About Section */}
              <section id='about' className='scroll-mt-20 space-y-6'>
                <div className='flex items-center gap-4 mb-8'>
                  <div className='p-3 rounded-lg bg-primary/10'>
                    <Home className='size-8 text-primary' />
                  </div>
                  <div>
                    <h1 className='text-4xl font-bold tracking-tight mb-2'>关于妙妙屋</h1>
                    <p className='text-lg text-muted-foreground'>
                      妙妙屋是一个功能强大的代理节点管理平台，帮助您轻松管理订阅、节点和用户。
                    </p>
                  </div>
                </div>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <h3 className='text-2xl font-semibold mb-4'>核心特性</h3>
                    <div className='grid gap-4 md:grid-cols-2'>
                      <div className='flex items-start gap-3 p-4 rounded-lg bg-muted/30'>
                        <Users className='size-5 text-primary mt-1 flex-shrink-0' />
                        <div>
                          <h4 className='font-semibold mb-1'>多用户管理</h4>
                          <p className='text-sm text-muted-foreground'>支持创建多个用户账号，独立流量配额和有效期管理</p>
                        </div>
                      </div>
                      <div className='flex items-start gap-3 p-4 rounded-lg bg-muted/30'>
                        <FileCode className='size-5 text-primary mt-1 flex-shrink-0' />
                        <div>
                          <h4 className='font-semibold mb-1'>灵活订阅生成</h4>
                          <p className='text-sm text-muted-foreground'>支持 Clash 格式，自定义代理组配置</p>
                        </div>
                      </div>
                      <div className='flex items-start gap-3 p-4 rounded-lg bg-muted/30'>
                        <Network className='size-5 text-primary mt-1 flex-shrink-0' />
                        <div>
                          <h4 className='font-semibold mb-1'>节点智能管理</h4>
                          <p className='text-sm text-muted-foreground'>批量导入外部订阅，支持节点分组、搜索、排序</p>
                        </div>
                      </div>
                      <div className='flex items-start gap-3 p-4 rounded-lg bg-muted/30'>
                        <Radar className='size-5 text-primary mt-1 flex-shrink-0' />
                        <div>
                          <h4 className='font-semibold mb-1'>多客户端支持</h4>
                          <p className='text-sm text-muted-foreground'>支持导出Clash订阅节点信息到常见的客户端格式</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Features Section */}
              <section id='features' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4'>核心特性详解</h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6 space-y-6'>
                    <div>
                      <h3 className='text-xl font-semibold mb-3 flex items-center gap-2'>
                        <Network className='size-5 text-primary' />
                        支持配置链式代理
                      </h3>
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-primary'>
                        <p className='text-sm text-muted-foreground mb-3'>
                          支持为节点配置前置代理链，实现多层代理转发，适用于需要特殊网络路径的场景。
                        </p>
                        <div className='space-y-2 text-xs font-mono bg-background rounded p-3'>
                          <div>用户 → 前置代理 → 目标节点 → 目标网站</div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className='text-xl font-semibold mb-3 flex items-center gap-2'>
                        <Radar className='size-5 text-primary' />
                        订阅节点管理
                      </h3>
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-primary'>
                        <p className='text-sm text-muted-foreground mb-3'>
                          可以导入自己的节点和外部订阅的节点，合并多个节点到一个订阅中。
                        </p>
                        <div className='flex gap-2 flex-wrap'>
                          <span className='px-2 py-1 bg-background rounded text-xs font-mono'>导入外部订阅</span>
                          <span className='px-2 py-1 bg-background rounded text-xs font-mono'>导入自建节点</span>
                          <span className='px-2 py-1 bg-background rounded text-xs font-mono'>自动同步</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className='text-xl font-semibold mb-3 flex items-center gap-2'>
                        <FileCode className='size-5 text-primary' />
                        自定义规则
                      </h3>
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-primary'>
                        <p className='text-sm text-muted-foreground mb-3'>
                          支持配置灵活的DNS、RULES规则，精确控制流量走向，满足个性化需求。
                        </p>
                        <div className='space-y-1 text-xs font-mono bg-background rounded p-3'>
                          <div>DOMAIN-SUFFIX,google.com,Proxy</div>
                          <div>IP-CIDR,192.168.0.0/16,DIRECT</div>
                          <div>GEOIP,CN,DIRECT</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Quick Start */}
              <section id='quick-start' className='scroll-mt-20 space-y-6 pt-12'>
                <div className='flex items-center gap-3 mb-4'>
                  <div className='p-2 rounded-lg bg-primary/10'>
                    <Zap className='size-6 text-primary' />
                  </div>
                  <h2 className='text-3xl font-bold tracking-tight'>快速开始</h2>
                </div>
                <p className='text-muted-foreground text-lg'>按照以下步骤快速上手妙妙屋平台</p>

                <div className='grid gap-6 md:grid-cols-2'>
                  {[
                    {
                      step: 1,
                      title: '管理员：添加节点',
                      description: '导入自建节点与外部订阅链接的节点',
                      icon: Download,
                      items: [
                        '进入 <code class="px-1 py-0.5 bg-muted rounded text-xs">节点管理</code> 页面',
                        '点击 <code class="px-1 py-0.5 bg-muted rounded text-xs">添加订阅链接</code>',
                        '点击解析节点或导入节点',
                        '点击保存，节点保存到节点表'
                      ]
                    },
                    {
                      step: 2,
                      title: '管理员：生成订阅文件',
                      description: '创建订阅配置',
                      icon: Zap,
                      items: [
                        '进入 <code class="px-1 py-0.5 bg-muted rounded text-xs">生成订阅</code> 页面',
                        '创建新的订阅文件配置',
                        '选择要使用的节点',
                        '使用内置sublink或模板生成',
                        '通过手动分组拖动节点到代理组',
                        '保存订阅'
                      ]
                    },
                    {
                      step: 3,
                      title: '管理员：创建用户',
                      description: '分配账号和订阅',
                      icon: Users,
                      items: [
                        '进入 <code class="px-1 py-0.5 bg-muted rounded text-xs">用户管理</code> 页面',
                        '点击 <code class="px-1 py-0.5 bg-muted rounded text-xs">添加用户</code> 按钮',
                        '填写用户信息',
                        '分配订阅文件',
                        '创建完成后即可使用'
                      ]
                    },
                    {
                      step: 4,
                      title: '用户：获取订阅链接',
                      description: '配置客户端',
                      icon: LinkIcon,
                      items: [
                        '使用账号登录妙妙屋',
                        '进入 <code class="px-1 py-0.5 bg-muted rounded text-xs">订阅链接</code> 页面',
                        '复制对应客户端的订阅链接或扫描二维码（需支持Clash配置的客户端）',
                        '在客户端中导入订阅',
                        '开始使用代理服务'
                      ]
                    }
                  ].map((item) => (
                    <Card key={item.step} className='bg-background/50 backdrop-blur border-border/50'>
                      <CardContent className='pt-6'>
                        <div className='flex items-start gap-4'>
                          <div className='flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary font-bold flex-shrink-0'>
                            {item.step}
                          </div>
                          <div className='flex-1 space-y-3'>
                            <div>
                              <h3 className='font-semibold flex items-center gap-2 mb-1'>
                                <item.icon className='size-4 text-primary' />
                                {item.title}
                              </h3>
                              <p className='text-sm text-muted-foreground'>{item.description}</p>
                            </div>
                            <ol className='space-y-1 text-sm'>
                              {item.items.map((step, index) => (
                                <li key={index} dangerouslySetInnerHTML={{ __html: step }} />
                              ))}
                            </ol>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              {/* Direct Install Section */}
              <section id='direct-install' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4 flex items-center gap-3'>
                  <Download className='size-8 text-primary' />
                  直接安装
                </h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <p className='text-muted-foreground mb-6'>
                      直接安装适用于 Linux 系统，支持一键安装脚本和手动二进制部署。
                    </p>

                    <div className='space-y-6'>
                      {/* 一键安装 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Zap className='size-4' />
                          一键安装（推荐）
                        </h3>
                        <div className='space-y-4 text-sm'>
                          <div className='bg-destructive/10 rounded-lg p-3 border border-destructive/20'>
                            <p className='text-destructive font-semibold mb-2'>⚠️ 注意：0.1.1版本修改了服务名称</p>
                            <p className='text-xs text-muted-foreground mb-3'>无法通过脚本更新，只能重新安装。先执行以下命令卸载及转移数据：</p>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1'>
                              <div>sudo systemctl stop traffic-info</div>
                              <div>sudo systemctl disable traffic-info</div>
                              <div>sudo rm -rf /etc/systemd/system/traffic-info.service</div>
                              <div>sudo rm -f /usr/local/bin/traffic-info</div>
                              <div>sudo cp -rf /var/lib/traffic-info/* /etc/mmw/</div>
                            </div>
                          </div>

                          <div>
                            <h4 className='font-semibold mb-2'>自动安装为 systemd 服务（Debian/Ubuntu）</h4>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs mb-2'>
                              curl -sL https://raw.githubusercontent.com/Jimleerx/miaomiaowu/main/install.sh | bash
                            </div>
                            <p className='text-xs text-muted-foreground'>
                              安装完成后，服务将自动启动，访问 http://服务器IP:12889 即可
                            </p>
                          </div>

                          <div>
                            <h4 className='font-semibold mb-2'>更新到最新版本</h4>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs'>
                              curl -sL https://raw.githubusercontent.com/Jimleerx/miaomiaowu/main/install.sh | sudo bash -s update
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 简易安装 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-purple-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Download className='size-4' />
                          简易安装（手动运行）
                        </h3>
                        <div className='space-y-4 text-sm'>
                          <div>
                            <h4 className='font-semibold mb-2'>一键下载安装</h4>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1'>
                              <div># 下载安装</div>
                              <div>curl -sL https://raw.githubusercontent.com/Jimleerx/miaomiaowu/main/quick-install.sh | bash</div>
                              <div className='mt-2'># 运行服务</div>
                              <div>./mmw</div>
                            </div>
                          </div>

                          <div>
                            <h4 className='font-semibold mb-2'>更新简易安装版本</h4>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs'>
                              curl -sL https://raw.githubusercontent.com/Jimleerx/miaomiaowu/main/quick-install.sh | bash -s update
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 二进制文件部署 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-green-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Settings className='size-4' />
                          二进制文件部署
                        </h3>
                        <div className='space-y-4 text-sm'>
                          <div>
                            <h4 className='font-semibold mb-2'>Linux</h4>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1'>
                              <div># 下载二进制文件（修改版本号为所需版本）</div>
                              <div>wget https://github.com/Jimleerx/miaomiaowu/releases/download/v0.0.2/mmw-linux-amd64</div>
                              <div className='mt-2'># 添加执行权限</div>
                              <div>chmod +x mmw-linux-amd64</div>
                              <div className='mt-2'># 运行</div>
                              <div>./mmw-linux-amd64</div>
                            </div>
                          </div>

                          <div>
                            <h4 className='font-semibold mb-2'>Windows</h4>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1'>
                              <div># 从 Releases 页面下载 mmw-windows-amd64.exe</div>
                              <div># https://github.com/Jimleerx/miaomiaowu/releases</div>
                              <div className='mt-2'># 双击运行或在命令行中执行</div>
                              <div>.\\mmw-windows-amd64.exe</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 注意事项 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-orange-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Shield className='size-4' />
                          注意事项
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>数据备份</strong>：安装前建议备份现有数据</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>端口占用</strong>：确保 12889 端口未被占用</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>防火墙</strong>：需要开放 12889 端口</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>首次访问</strong>：首次访问会显示初始化页面，设置管理员账号</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Docker Install Section */}
              <section id='docker-install' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4 flex items-center gap-3'>
                  <Download className='size-8 text-primary' />
                  Docker 安装
                </h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <p className='text-muted-foreground mb-6'>
                      使用 Docker 是最简单快捷的部署方式，无需配置任何依赖环境。推荐生产环境使用。
                    </p>

                    <div className='space-y-6'>
                      {/* 基础部署 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Zap className='size-4' />
                          基础部署
                        </h3>
                        <div className='space-y-4 text-sm'>
                          <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1'>
                            <div>docker run -d \</div>
                            <div className='ml-2'>--user root \</div>
                            <div className='ml-2'>-v $(pwd)/mmw-data:/app/data \</div>
                            <div className='ml-2'>-v $(pwd)/subscribes:/app/subscribes \</div>
                            <div className='ml-2'>-v $(pwd)/rule_templates:/app/rule_templates \</div>
                            <div className='ml-2'>--name miaomiaowu \</div>
                            <div className='ml-2'>-p 12889:12889 \</div>
                            <div className='ml-2'>ghcr.io/jimleerx/miaomiaowu:latest</div>
                          </div>

                          <div>
                            <h4 className='font-semibold mb-2'>参数说明</h4>
                            <ul className='space-y-1 text-xs text-muted-foreground ml-4'>
                              <li>• <code className='bg-muted px-1 rounded'>-p 12889:12889</code> - 端口映射，按需调整</li>
                              <li>• <code className='bg-muted px-1 rounded'>-v $(pwd)/mmw-data:/app/data</code> - 持久化数据库</li>
                              <li>• <code className='bg-muted px-1 rounded'>-v $(pwd)/subscribes:/app/subscribes</code> - 订阅文件目录</li>
                              <li>• <code className='bg-muted px-1 rounded'>-v $(pwd)/rule_templates:/app/rule_templates</code> - 规则模板目录</li>
                              <li>• <code className='bg-muted px-1 rounded'>-e JWT_SECRET=your-secret</code> - JWT密钥（建议自定义）</li>
                            </ul>
                          </div>

                          <div>
                            <h4 className='font-semibold mb-2'>更新镜像</h4>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1'>
                              <div>docker pull ghcr.io/jimleerx/miaomiaowu:latest</div>
                              <div>docker stop miaomiaowu && docker rm miaomiaowu</div>
                              <div className='text-muted-foreground'># 然后重新运行上方的启动命令</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Docker Compose */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-purple-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Settings className='size-4' />
                          Docker Compose 部署（推荐）
                        </h3>
                        <div className='space-y-4 text-sm'>
                          <p className='text-muted-foreground'>创建 <code className='bg-muted px-1.5 py-0.5 rounded'>docker-compose.yml</code> 文件：</p>

                          <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1 overflow-x-auto'>
                            <div>version: '3.8'</div>
                            <div className='mt-2'>services:</div>
                            <div className='ml-2'>miaomiaowu:</div>
                            <div className='ml-4'>image: ghcr.io/jimleerx/miaomiaowu:latest</div>
                            <div className='ml-4'>container_name: miaomiaowu</div>
                            <div className='ml-4'>restart: unless-stopped</div>
                            <div className='ml-4'>user: root</div>
                            <div className='ml-4 mt-2'>environment:</div>
                            <div className='ml-6'>- PORT=12889</div>
                            <div className='ml-6'>- DATABASE_PATH=/app/data/traffic.db</div>
                            <div className='ml-6'>- LOG_LEVEL=info</div>
                            <div className='ml-4 mt-2'>ports:</div>
                            <div className='ml-6'>- "12889:12889"</div>
                            <div className='ml-4 mt-2'>volumes:</div>
                            <div className='ml-6'>- ./data:/app/data</div>
                            <div className='ml-6'>- ./subscribes:/app/subscribes</div>
                            <div className='ml-6'>- ./rule_templates:/app/rule_templates</div>
                            <div className='ml-4 mt-2'>healthcheck:</div>
                            <div className='ml-6'>test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:12889/"]</div>
                            <div className='ml-6'>interval: 30s</div>
                            <div className='ml-6'>timeout: 3s</div>
                            <div className='ml-6'>start_period: 5s</div>
                            <div className='ml-6'>retries: 3</div>
                          </div>

                          <div>
                            <h4 className='font-semibold mb-2'>常用命令</h4>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-2'>
                              <div># 启动服务</div>
                              <div>docker-compose up -d</div>
                              <div className='mt-2'># 查看日志</div>
                              <div>docker-compose logs -f</div>
                              <div className='mt-2'># 停止服务</div>
                              <div>docker-compose down</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 数据持久化 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-cyan-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Database className='size-4' />
                          数据持久化说明
                        </h3>
                        <div className='space-y-3 text-sm text-muted-foreground'>
                          <p>容器使用三个数据卷进行数据持久化：</p>
                          <ul className='space-y-2 ml-4'>
                            <li>• <code className='bg-muted px-1.5 py-0.5 rounded'>/app/data</code> - 存储 SQLite 数据库文件</li>
                            <li>• <code className='bg-muted px-1.5 py-0.5 rounded'>/app/subscribes</code> - 存储订阅配置文件</li>
                            <li>• <code className='bg-muted px-1.5 py-0.5 rounded'>/app/rule_templates</code> - 存储规则文件模板</li>
                          </ul>
                          <p className='text-orange-500 font-semibold mt-3'>⚠️ 重要提示：请确保定期备份这些目录的数据</p>
                        </div>
                      </div>

                      {/* 常见问题 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-red-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <HelpCircle className='size-4' />
                          常见问题
                        </h3>
                        <div className='space-y-3'>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>Docker 启动报错 "out of memory (14)"</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              <strong>问题原因：</strong>数据目录权限不足<br/>
                              <strong>解决方法：</strong>
                            </p>
                            <div className='bg-muted/50 rounded p-2 font-mono text-xs space-y-1'>
                              <div># 给映射的目录添加权限</div>
                              <div>chmod -R 777 ./data ./subscribes ./rule_templates</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 注意事项 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-orange-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Shield className='size-4' />
                          注意事项
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>目录权限</strong>：确保挂载目录有正确的读写权限</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>端口冲突</strong>：确保宿主机 12889 端口未被占用</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>网络访问</strong>：如需外网访问，需配置防火墙和安全组</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>定期备份</strong>：建议定期备份数据卷内容</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>安全建议</strong>：生产环境建议修改 JWT_SECRET 为随机字符串</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* System Requirements Section */}
              <section id='system-requirements' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4'>系统要求</h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6 space-y-4'>
                    <div>
                      <h3 className='text-xl font-semibold mb-3'>服务器要求</h3>
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <ul className='space-y-2 text-sm'>
                          <li>• CPU: 1核心以上</li>
                          <li>• 内存: 512MB 以上</li>
                          <li>• 存储: 1GB 以上</li>
                          <li>• 网络: 稳定的互联网连接</li>
                          <li>• 系统: Linux (推荐 Debian 11+)</li>
                        </ul>
                      </div>
                    </div>

                    <div>
                      <h3 className='text-xl font-semibold mb-3'>客户端支持</h3>
                      <div className='grid gap-3 md:grid-cols-2'>
                        {[
                          { os: 'Windows', clients: ['Clash Verge', 'Clash for Windows', 'v2rayN'] },
                          { os: 'macOS', clients: ['ClashX Pro', 'Shadowsocket', 'Clash Verge'] },
                          { os: 'iOS / iPadOS', clients: ['Shadowrocket', 'clashmi', 'Quantumult'] },
                          { os: 'Android', clients: ['Clash Meta for Android', 'v2rayNG', 'Clash Mi', 'FlClash'] }
                        ].map((platform) => (
                          <div key={platform.os} className='bg-muted/30 rounded-lg p-4'>
                            <h4 className='font-semibold mb-2'>{platform.os}</h4>
                            <div className='flex flex-wrap gap-1'>
                              {platform.clients.map((client) => (
                                <span key={client} className='px-2 py-1 bg-background rounded text-xs'>
                                  {client}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              <section id='client-setup' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4'>客户端配置</h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6 space-y-6'>
                    <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-green-500'>
                      <h3 className='font-semibold mb-3'>通用导入步骤</h3>
                      <ol className='space-y-2 text-sm font-mono'>
                        <li>1. 登录妙妙屋，进入"订阅链接"页面</li>
                        <li>2. 复制您的订阅链接</li>
                        <li>3. 打开代理客户端</li>
                        <li>4. 找到"配置"或"订阅"设置</li>
                        <li>5. 添加订阅并粘贴链接</li>
                        <li>6. 更新订阅并选择节点</li>
                        <li>7. 开启系统代理即可使用</li>
                      </ol>
                    </div>

                    <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-yellow-500'>
                      <p className='text-sm'>
                        💡 <strong>提示：</strong>部分客户端支持扫描二维码导入，您可以在订阅链接页面生成二维码。
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </section>

              <section id='import-subscription' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4'>导入订阅</h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <div className='space-y-4'>
                      <h3 className='text-xl font-semibold'>订阅格式支持</h3>
                      <div className='grid gap-4 md:grid-cols-2'>
                        <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-orange-500'>
                          <h4 className='font-semibold mb-2 flex items-center gap-2'>
                            <FileCode className='size-4' />
                            Clash 格式
                          </h4>
                          <p className='text-sm text-muted-foreground mb-2'>
                            适用于 Clash 客户端，支持完整的代理组和规则配置。
                          </p>
                          <div className='flex gap-2'>
                            <span className='px-2 py-1 bg-background rounded text-xs'>Clash Verge</span>
                            <span className='px-2 py-1 bg-background rounded text-xs'>ClashX Pro</span>
                            <span className='px-2 py-1 bg-background rounded text-xs'>Clash Meta for Android</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className='space-y-4 mt-8'>
                      <h3 className='text-xl font-semibold'>支持的客户端</h3>
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <p className='text-sm'>
                          💡 <strong>提示：</strong>以下客户端均支持导入妙妙屋的订阅节点配置
                        </p>
                      </div>
                      <div className='grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
                        {CLIENT_TYPES.map((client) => (
                          <div
                            key={client.type}
                            className='bg-muted/30 rounded-lg p-3 flex items-center gap-2 hover:bg-muted/50 transition-colors'
                          >
                            <img src={client.icon} alt={client.name} className='size-6 shrink-0' />
                            <span className='text-sm font-medium truncate'>{client.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Manual sections - abbreviated for brevity */}
              <section id='traffic-info' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4 flex items-center gap-3'>
                  <Activity className='size-8 text-primary' />
                  流量信息
                </h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <p className='text-muted-foreground mb-4'>
                      查看当前用户的流量使用情况和订阅有效期信息。
                    </p>
                    <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-primary'>
                      <h3 className='font-semibold mb-3'>主要功能</h3>
                      <ul className='space-y-1 text-sm'>
                        <li>• 实时显示已用流量和总流量配额</li>
                        <li>• 显示订阅有效期（开始时间和结束时间）</li>
                        <li>• 流量使用进度条可视化展示</li>
                        <li>• 显示剩余可用流量</li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Subscription Link Section */}
              <section id='subscription-link' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4 flex items-center gap-3'>
                  <LinkIcon className='size-8 text-primary' />
                  订阅链接
                </h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <p className='text-muted-foreground mb-4'>
                      订阅链接页面提供便捷的订阅管理功能，支持多种客户端格式的订阅链接生成和导入。
                    </p>

                    <div className='space-y-6'>
                      {/* 主要功能 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          主要功能
                        </h3>
                        <ul className='space-y-2 text-sm'>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>订阅卡片展示</strong>：显示管理员分配给您的所有订阅配置，包括订阅名称、描述、更新时间和版本号</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>订阅链接查看</strong>：每个订阅卡片都显示完整的订阅链接地址，支持直接复制</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>多客户端支持</strong>：点击"复制"按钮可选择不同的客户端格式（Clash、Stash、Shadowrocket、Surge 等12种客户端）</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>一键导入 Clash</strong>：点击"导入 Clash"按钮可直接在 Clash 客户端中打开并导入订阅</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>二维码生成</strong>：点击订阅图标可显示二维码，方便在移动设备上扫码导入订阅</span>
                          </li>
                        </ul>
                      </div>

                      {/* 使用步骤 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-green-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <FileCode className='size-4' />
                          使用步骤
                        </h3>
                        <div className='space-y-3 text-sm'>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>1</span>
                            <div>
                              <strong>选择订阅配置</strong>
                              <p className='text-muted-foreground mt-1'>从订阅卡片列表中选择需要使用的订阅配置</p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>2</span>
                            <div>
                              <strong>选择导入方式</strong>
                              <p className='text-muted-foreground mt-1'>
                                • <strong>PC端</strong>：点击"复制"按钮，选择对应的客户端格式，复制订阅链接后在客户端中粘贴导入<br/>
                                • <strong>移动端</strong>：点击订阅图标显示二维码，使用手机客户端扫码导入<br/>
                                • <strong>Clash快捷导入</strong>：点击"导入 Clash"按钮直接在 Clash 中打开
                              </p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>3</span>
                            <div>
                              <strong>在客户端中完成导入</strong>
                              <p className='text-muted-foreground mt-1'>根据客户端提示完成订阅导入和配置更新</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 支持的客户端格式 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-purple-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Network className='size-4' />
                          支持的客户端格式
                        </h3>
                        <p className='text-sm text-muted-foreground mb-3'>
                          订阅链接支持以下12种客户端格式的自动转换：
                        </p>
                        <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2'>
                          {CLIENT_TYPES.map((client) => (
                            <div
                              key={client.type}
                              className='bg-background/50 rounded px-3 py-2 flex items-center gap-2 text-xs'
                            >
                              <img src={client.icon} alt={client.name} className='size-4 shrink-0' />
                              <span className='font-medium'>{client.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 注意事项 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-orange-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Shield className='size-4' />
                          注意事项
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span>订阅链接包含您的个人认证信息，请勿分享给他人</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span>如果订阅列表为空，表示管理员尚未为您分配订阅，请联系管理员</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span>客户端转换功能基于 SubStore 实现，如遇到问题请联系开发者或提交 Issue</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span>建议定期更新订阅以获取最新的节点配置和规则</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span>机场有经常更换域名和IP的情况，可以在系统管理打开强制同步外部订阅，这样每次获取订阅时都会同步一次外部订阅的节点</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Generator Section */}
              <section id='generator' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4 flex items-center gap-3'>
                  <Zap className='size-8 text-primary' />
                  生成订阅
                  <span className='ml-2 text-sm font-normal px-2 py-1 bg-destructive/10 text-destructive rounded-md border border-destructive/20'>
                    管理员功能
                  </span>
                </h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <p className='text-muted-foreground mb-4'>
                      生成订阅页面是管理员专用功能，用于创建和管理用于分发给用户的订阅配置文件。生成的订阅文件为 Clash 格式。
                    </p>

                    <div className='space-y-6'>
                      {/* 主要功能 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          主要功能
                        </h3>
                        <ul className='space-y-2 text-sm'>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>创建新订阅：</strong>通过"生成订阅"菜单创建全新的订阅配置</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>代理组配置：</strong>通过拖动的方式把节点分配给代理组</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>集成Sublink生成订阅：</strong>支持和sublink一样选择代理组后生成订阅文件</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>内置默认规则模板：</strong>内置了ACL4SSR 和 Aethersailor 模板</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>支持配置链式代理分组：</strong>添加🌄 落地节点和🌠 中转节点代理组，适合有多个落地多个中转的用户</span>
                          </li>
                        </ul>
                      </div>

                      {/* 创建订阅步骤 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-green-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <FileCode className='size-4' />
                          创建订阅步骤
                        </h3>
                        <div className='space-y-3 text-sm'>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>1</span>
                            <div>
                              <strong>点击"生成订阅"菜单</strong>
                              <p className='text-muted-foreground mt-1'>进入订阅创建界面</p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>2</span>
                            <div>
                              <strong>选择节点</strong>
                              <p className='text-muted-foreground mt-1'>
                                • <strong>选择订阅中要使用的节点：</strong>支持快速筛选，点击左上角的选择框可以全选<br/>
                              </p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>3</span>
                            <div>
                              <strong>选择使用模板或自定义规则</strong>
                              <p className='text-muted-foreground mt-1'>
                                • <strong>自定义规则：</strong>选择需要的代理组，点击生成订阅文件<br/>
                                • <strong>使用模板：</strong>选择模板，点击加载<br/>
                              </p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>4</span>
                            <div>
                              <strong>自定义规则</strong>
                              <p className='text-muted-foreground mt-1'>此处的自定义规则会被系统管理的自定义规则覆盖，请使用系统管理里的自定义规则</p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>4</span>
                            <div>
                              <strong>手动分组</strong>
                              <p className='text-muted-foreground mt-1'>
                                • <strong>代理组卡片：</strong>可以拖动卡片顶部调整代理组顺序<br/>
                                • <strong>代理组标题：</strong>代理组标题也被视作一个节点，可以拖动到其他代理组<br/>
                                • <strong>节点：</strong>节点可以拖动到代理组中<br/>
                                • <strong>可用节点标题：</strong>拖动可用节点标题到代理组时，添加可用节点列表的所有节点到代理组<br/>
                              </p>                            
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>4</span>
                            <div>
                              <strong>保存并发布</strong>
                              <p className='text-muted-foreground mt-1'>点击保存按钮创建订阅文件，系统会自动生成版本号</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 订阅类型说明 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-purple-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Network className='size-4' />
                          订阅类型说明
                        </h3>
                        <div className='space-y-3'>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2 flex items-center gap-2'>
                              <span className='size-2 rounded-full bg-orange-500'></span>
                              Clash 格式
                            </h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              适用于 Clash 内核及其衍生版本，是目前最流行的代理配置格式之一。
                            </p>
                            <div className='text-xs space-y-1'>
                              <p><strong>支持客户端：</strong></p>
                              <p className='text-muted-foreground'>Clash、Clash Verge、ClashX Pro、Clash for Windows、Clash Meta for Android 等</p>
                              <p className='mt-2'><strong>配置特点：</strong></p>
                              <p className='text-muted-foreground'>• 支持代理组（proxy-group）和规则（rules）配置<br/>• YAML 格式，易读易编辑<br/>• 支持多种代理协议（SS、VMess、Trojan、VLESS 等）</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 编辑器功能
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-cyan-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <FileCode className='size-4' />
                          代码编辑器功能
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-cyan-500 mt-1'>✓</span>
                            <span><strong>语法高亮</strong>：自动识别 YAML 和 JSON 格式，提供语法高亮显示</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-cyan-500 mt-1'>✓</span>
                            <span><strong>自动缩进</strong>：智能处理代码缩进，保持配置文件格式整洁</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-cyan-500 mt-1'>✓</span>
                            <span><strong>行号显示</strong>：显示行号，方便定位和修改</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-cyan-500 mt-1'>✓</span>
                            <span><strong>全屏编辑</strong>：支持全屏模式，提供更大的编辑空间</span>
                          </li>
                        </ul>
                      </div> */}

                      {/* 注意事项 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-orange-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Shield className='size-4' />
                          注意事项
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>配置格式：</strong>确保自定义配置格式正确，保持yaml的缩进格式</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>节点更新：</strong>系统设置里打开强制同步外部订阅后，使用的节点会与节点表自动同步</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>删除影响</strong>：删除订阅会影响已分配该订阅的所有用户，请谨慎操作</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>用户分配</strong>：创建订阅后，需要在"用户管理"中为用户分配订阅才能使用</span>
                          </li>
                        </ul>
                      </div>

                      {/* 最佳实践 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-emerald-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          最佳实践
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>使用清晰的命名</strong>：订阅名称应简洁明了，如"clash-main"、"singbox-premium"</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>添加详细描述</strong>：在描述中说明订阅的适用场景和特性</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>测试后再分配</strong>：新建订阅后先在自己的客户端测试无误再分配给用户</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>自动更新节点</strong>：如节点服务器地址或端口会发生变更，建议打开系统设置的强制更新外部订阅开关</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>分场景创建订阅</strong>：可以创建不同场景的订阅（如游戏专用、流媒体专用等）</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Nodes Management Section */}
              <section id='nodes' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4 flex items-center gap-3'>
                  <Network className='size-8 text-primary' />
                  节点管理
                  <span className='ml-2 text-sm font-normal px-2 py-1 bg-destructive/10 text-destructive rounded-md border border-destructive/20'>
                    管理员功能
                  </span>
                </h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <p className='text-muted-foreground mb-4'>
                      节点管理页面是管理员专用功能，用于管理所有代理节点。支持添加、编辑、删除自建节点和外部订阅节点。
                    </p>

                    <div className='space-y-6'>
                      {/* 主要功能 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          主要功能
                        </h3>
                        <ul className='space-y-2 text-sm'>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>添加节点：</strong>支持手动添加代理节点，用户手动输入vless://之类的链接，一行一个</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>导入节点：</strong>用户输入外部订阅的链接，从外部订阅解析节点并导入</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>编辑节点：</strong>修改节点的名称、地址、端口等配置信息，信息会自动同步到已关联的订阅</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>删除节点：</strong>移除不再使用的节点</span>
                          </li>
                          {/* <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>拖拽排序</strong>：通过拖拽节点卡片调整节点在订阅中的显示顺序</span>
                          </li> */}
                          {/* <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>分组管理</strong>：为节点分配代理组，便于在订阅配置中引用</span>
                          </li> */}
                          <li className='flex items-start gap-2'>
                            <Eye className='size-4 text-primary mt-1 shrink-0' />
                            <span><strong>节点信息展示：</strong>显示节点的详细配置信息（协议、地址、端口等）</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <img src={IpIcon} alt='IP' className='size-4 mt-1 shrink-0' />
                            <span><strong>解析为IP：</strong>将节点的域名解析为固定的IP，支持ipv4和ipv6</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <img src={ExchangeIcon} alt='Exchange' className='size-4 mt-1 shrink-0' />
                            <span><strong>创建链式代理：</strong>为节点指定前置节点，生成一个链式代理节点</span>
                          </li>
                        </ul>
                      </div>

                      {/* 添加节点步骤 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-green-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <FileCode className='size-4' />
                          添加节点步骤
                        </h3>
                        <div className='space-y-3 text-sm'>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>1</span>
                            <div>
                              <strong>点击"节点管理"菜单</strong>
                              <p className='text-muted-foreground mt-1'>选择添加节点的方式，手动输入或订阅导入，手动输入的是类似vless://的链接，订阅导入为机场生成的订阅链接</p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>2</span>
                            <div>
                              <strong>点击解析或导入后下方节点表格展示节点</strong>
                              <p className='text-muted-foreground mt-1'>
                                • <strong>节点类型：</strong>节点的协议<br/>
                                • <strong>节点名称：</strong>手动输入订阅链接里的#后面的部分，订阅导入的节点name<br/>
                                • <strong>标签：</strong>手动输入 | 链式代理 | 订阅导入的为订阅链接的服务器地址<br/>
                                • <strong>服务器地址：</strong>节点的服务器地址，点击IP按钮可以解析为固定IP<br/>
                                • <strong>配置：</strong>点击查看解析的Clash配置<br/>
                              </p>
                            </div>
                          </div>
                          {/* // 暂不支持手动添加节点 */}
                          {/* <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>3</span>
                            <div>
                              <strong>配置节点参数</strong>
                              <p className='text-muted-foreground mt-1'>
                                根据节点协议类型填写相应的配置参数：<br/>
                                • <strong>服务器地址</strong>：节点的域名或 IP 地址<br/>
                                • <strong>端口</strong>：节点的端口号<br/>
                                • <strong>协议类型</strong>：如 VMess、VLESS、Trojan、Shadowsocks 等<br/>
                                • <strong>加密方式</strong>：根据协议选择对应的加密方法<br/>
                                • <strong>其他参数</strong>：UUID、路径、SNI 等协议特定参数
                              </p>
                            </div>
                          </div> */}
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>3</span>
                            <div>
                              <strong>保存节点</strong>
                              <p className='text-muted-foreground mt-1'>点击保存按钮，节点将添加到节点列表中</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 支持的协议 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-indigo-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Shield className='size-4' />
                          支持的协议类型
                        </h3>
                        <p className='text-sm text-muted-foreground mb-3'>
                          妙妙屋支持主流的代理协议，可根据实际需求选择：
                        </p>
                        <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>VMess</h4>
                            <p className='text-xs text-muted-foreground'>V2Ray 原生协议，广泛支持，配置灵活</p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>VLESS</h4>
                            <p className='text-xs text-muted-foreground'>轻量级协议，性能优于 VMess</p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>Trojan</h4>
                            <p className='text-xs text-muted-foreground'>伪装成 HTTPS 流量，抗封锁能力强</p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>Shadowsocks</h4>
                            <p className='text-xs text-muted-foreground'>经典协议，轻量高效</p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>Hysteria / Hysteria2</h4>
                            <p className='text-xs text-muted-foreground'>基于 QUIC 协议，弱网环境表现优秀</p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>其他协议</h4>
                            <p className='text-xs text-muted-foreground'>支持 ShadowsocksR、Socks5 等</p>
                          </div>
                        </div>
                      </div>

                      {/* 注意事项 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-orange-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Shield className='size-4' />
                          注意事项
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>配置准确性：</strong>节点配置信息必须准确无误，错误的配置会导致节点无法连接</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>删除影响：</strong>：删除节点不会影响引用该节点的订阅配置</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>订阅导入的节点信息更新：</strong>设置中打开开关后，每次获取订阅时根据过期时间同步外部订阅节点</span>
                          </li>
                        </ul>
                      </div>

                      {/* 拖拽排序功能 */}
                      {/* <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-purple-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Network className='size-4' />
                          拖拽排序功能
                        </h3>
                        <div className='space-y-3 text-sm'>
                          <p className='text-muted-foreground'>
                            节点管理支持通过拖拽调整节点顺序，这对于控制订阅中的节点显示顺序非常有用。
                          </p>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>使用方法</h4>
                            <ol className='space-y-2 text-xs text-muted-foreground'>
                              <li><strong>1.</strong> 将鼠标悬停在节点卡片上，卡片会显示可拖拽的抓手图标</li>
                              <li><strong>2.</strong> 按住节点卡片并拖动到目标位置</li>
                              <li><strong>3.</strong> 释放鼠标，节点顺序会自动保存</li>
                              <li><strong>4.</strong> 调整后的顺序会立即应用到所有订阅配置中</li>
                            </ol>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>应用场景</h4>
                            <ul className='space-y-1 text-xs text-muted-foreground'>
                              <li>• 将常用节点排在前面，方便用户快速选择</li>
                              <li>• 按地区分组排列节点（如：香港 → 台湾 → 日本 → 美国）</li>
                              <li>• 将高速节点优先展示</li>
                            </ul>
                          </div>
                        </div>
                      </div> */}

                      
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Subscribe Files Management Section */}
              <section id='subscribe-files' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4 flex items-center gap-3'>
                  <Database className='size-8 text-primary' />
                  订阅管理
                  <span className='ml-2 text-sm font-normal px-2 py-1 bg-destructive/10 text-destructive rounded-md border border-destructive/20'>
                    管理员功能
                  </span>
                </h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <p className='text-muted-foreground mb-4'>
                      订阅管理页面是管理员专用功能，用于管理订阅文件的版本、查看订阅详情，以及为用户分配订阅配置。支持多版本管理和用户订阅分配。
                    </p>

                    <div className='space-y-6'>
                      {/* 主要功能 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          主要功能
                        </h3>
                        <ul className='space-y-2 text-sm'>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>订阅列表查看</strong>：查看所有已创建的订阅文件及其基本信息</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>导入订阅</strong>：直接导入外部订阅，可以编辑外部订阅的规则</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>上传文件</strong>：上传本地使用的订阅文件生成订阅链接</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>生成订阅</strong>：同生成订阅菜单</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>编辑配置</strong>：直接编辑订阅的配置文件</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>编辑配置 - 应用自定义规则</strong>：使用自定义规则覆盖配置文件的规则</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>编辑配置 - 编辑节点</strong>：给已生成的订阅添加或删除节点</span>
                          </li>
                        </ul>
                      </div>

                      {/* 页面布局 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-purple-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Network className='size-4' />
                          编辑页面布局
                        </h3>
                        <div className='space-y-3 text-sm'>
                          <p className='text-muted-foreground'>
                            采用双列布局，便于拖动节点：
                          </p>
                          <div className='grid md:grid-cols-3 gap-3'>
                            <div className='bg-background/50 rounded-lg p-3'>
                              <h4 className='font-semibold text-sm mb-2'>左侧 - 代理组</h4>
                              <p className='text-xs text-muted-foreground'>
                                显示配置文件里的所有代理组卡片
                              </p>
                            </div>
                            <div className='bg-background/50 rounded-lg p-3'>
                              <h4 className='font-semibold text-sm mb-2'>右侧 - 可用节点</h4>
                              <p className='text-xs text-muted-foreground'>
                                显示节点表里所有可用节点
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 版本管理功能 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-cyan-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <FileCode className='size-4' />
                          版本管理
                        </h3>
                        <div className='space-y-3 text-sm'>
                          <p className='text-muted-foreground'>
                            订阅文件支持多版本管理，每次在"生成订阅"中编辑保存订阅配置时，系统会自动创建新版本。
                          </p>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>版本信息</h4>
                            <ul className='space-y-1 text-xs text-muted-foreground'>
                              <li>• <strong>版本号</strong>：每个版本都有唯一的版本编号，按创建时间递增</li>
                              <li>• <strong>创建时间</strong>：记录版本的创建时间</li>
                              {/* <li>• <strong>配置内容</strong>：可查看每个版本的完整配置内容</li> */}
                              <li>• <strong>当前版本</strong>：标识用户当前使用的版本</li>
                            </ul>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>版本回退</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              <strong>TODO：</strong>如果新版本出现问题，可以回退到之前的稳定版本：
                            </p>
                            <ol className='space-y-1 text-xs text-muted-foreground'>
                              <li><strong>TODO：1.</strong> 在订阅详情中查看版本历史</li>
                              <li><strong>TODO：2.</strong> 选择需要回退的目标版本</li>
                              <li><strong>TODO：3.</strong> 点击"回退到此版本"按钮</li>
                              <li><strong>TODO：4.</strong> 系统会将订阅内容恢复到该版本</li>
                            </ol>
                          </div>
                        </div>
                      </div>

                      {/* 使用场景 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-amber-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          典型使用场景
                        </h3>
                        <div className='space-y-3'>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>场景一：添加了新节点</h4>
                            <p className='text-xs text-muted-foreground'>
                              点击编辑节点，再可以节点里把新增的节点拖到左侧代理组中。
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 注意事项 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-orange-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Shield className='size-4' />
                          注意事项
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>节点修改</strong>：在节点管理对节点编辑后，会自动同步到订阅中</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>订阅删除</strong>：在"生成订阅"中删除订阅文件会同时删除所有版本和用户分配关系</span>
                          </li>
                        </ul>
                      </div>

                      {/* 与其他功能的关系 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-violet-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Network className='size-4' />
                          功能关联
                        </h3>
                        <div className='space-y-3 text-sm text-muted-foreground'>
                          <p>
                            订阅管理与其他功能模块紧密关联，形成完整的订阅服务流程：
                          </p>
                          <div className='grid md:grid-cols-2 gap-3'>
                            <div className='bg-background/50 rounded-lg p-3'>
                              <h4 className='font-semibold text-sm mb-2 text-foreground'>生成订阅 → 订阅管理</h4>
                              <p className='text-xs'>
                                在"生成订阅"中创建或编辑订阅配置后，可在"订阅管理"中查看版本历史并为用户分配
                              </p>
                            </div>
                            <div className='bg-background/50 rounded-lg p-3'>
                              <h4 className='font-semibold text-sm mb-2 text-foreground'>订阅管理 → 用户管理</h4>
                              <p className='text-xs'>
                                可以从"用户管理"快速跳转查看特定用户的订阅分配情况
                              </p>
                            </div>
                            <div className='bg-background/50 rounded-lg p-3'>
                              <h4 className='font-semibold text-sm mb-2 text-foreground'>节点管理 → 订阅管理</h4>
                              <p className='text-xs'>
                                订阅配置引用"节点管理"中的节点，节点变化会影响订阅内容
                              </p>
                            </div>
                            <div className='bg-background/50 rounded-lg p-3'>
                              <h4 className='font-semibold text-sm mb-2 text-foreground'>订阅管理 → 订阅链接</h4>
                              <p className='text-xs'>
                                用户在"订阅链接"页面看到的订阅，就是管理员在"订阅管理"中分配给他们的
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* User Management Section */}
              <section id='users' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4 flex items-center gap-3'>
                  <Users className='size-8 text-primary' />
                  用户管理
                  <span className='ml-2 text-sm font-normal px-2 py-1 bg-destructive/10 text-destructive rounded-md border border-destructive/20'>
                    管理员功能
                  </span>
                </h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <p className='text-muted-foreground mb-4'>
                      用户管理页面是管理员专用功能，用于管理平台的所有用户账户，包括创建用户、编辑用户信息、分配订阅等核心管理功能。
                    </p>

                    <div className='space-y-6'>
                      {/* 主要功能 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          主要功能
                        </h3>
                        <ul className='space-y-2 text-sm'>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>用户列表查看</strong>：查看所有用户的基本信息</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>创建新用户</strong>：手动创建新用户账户，设置用户名、密码</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>编辑用户信息</strong>：修改用户的状态（启用|停用）</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>删除用户</strong>：删除不再需要的用户账户</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>订阅分配</strong>：为用户分配或取消分配订阅文件</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>重置密码</strong>：为用户重置登录密码</span>
                          </li>
                        </ul>
                      </div>

                      {/* 创建用户 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-green-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <FileCode className='size-4' />
                          创建用户
                        </h3>
                        <div className='space-y-3 text-sm'>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>1</span>
                            <div>
                              <strong>点击"新增用户"按钮</strong>
                              <p className='text-muted-foreground mt-1'>打开用户创建对话框</p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>2</span>
                            <div>
                              <strong>填写用户基本信息</strong>
                              <p className='text-muted-foreground mt-1'>
                                • <strong>用户名</strong>：设置用户的登录用户名（唯一，不可重复）<br/>
                                • <strong>初始密码</strong>：设置用户的初始登录密码<br/>
                                • <strong>邮箱</strong>：用户的邮箱地址（可选）
                                • <strong>昵称</strong>：用户昵称
                                • <strong>分配订阅</strong>：用户可以看到的订阅
                              </p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>4</span>
                            <div>
                              <strong>分配订阅（可选）</strong>
                              <p className='text-muted-foreground mt-1'>可以在创建时分配订阅，也可以稍后在"订阅管理"中分配</p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>5</span>
                            <div>
                              <strong>保存用户</strong>
                              <p className='text-muted-foreground mt-1'>点击保存按钮创建用户，用户即可使用账户登录</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 使用场景 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-violet-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          典型使用场景
                        </h3>
                        <div className='space-y-3'>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>场景一：新用户开通服务</h4>
                            <p className='text-xs text-muted-foreground'>
                              分享给朋友或家人时，管理员创建账户 → 分配对应的订阅 → 通知用户登录信息。
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 注意事项 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-orange-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Shield className='size-4' />
                          注意事项
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>用户名唯一性</strong>：用户名必须唯一且创建后不可修改，请谨慎设置</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>删除不可恢复</strong>：删除用户会永久删除其所有数据，无法恢复</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>密码安全</strong>：创建用户时设置的密码应足够复杂，建议包含字母、数字和符号</span>
                          </li>
                          {/* <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>流量单位准确</strong>：设置流量配额时注意单位换算（1GB = 1024MB）</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>有效期设置</strong>：确保有效期的开始时间早于结束时间</span>
                          </li> */}
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>订阅分配</strong>：用户至少需要分配一个订阅才能正常使用服务</span>
                          </li>
                          {/* <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>流量统计</strong>：已用流量由系统自动统计，手动修改仅用于特殊情况（如重置流量）</span>
                          </li> */}
                        </ul>
                      </div>

                      {/* 最佳实践 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-emerald-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          最佳实践
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>规范命名</strong>：使用统一的用户名命名规范，如"user001"、"vip-zhangsan"等</span>
                          </li>
                          {/* <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>记录备注</strong>：在用户备注中记录重要信息（如购买时间、套餐类型、联系方式等）</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>定期检查</strong>：定期查看用户列表，识别即将过期或流量即将耗尽的用户</span>
                          </li> */}
                          {/* <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>分级管理</strong>：为不同级别用户设置不同的流量配额和订阅</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>合理配额</strong>：根据用户实际需求设置合理的流量配额，避免浪费</span>
                          </li> */}
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>及时通知</strong>：用户创建后及时将登录信息（用户名、密码、登录地址）告知用户</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>TODO：数据备份</strong>：定期导出用户数据进行备份</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Custom Rules Section */}
              <section id='custom-rules' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4 flex items-center gap-3'>
                  <FileCode className='size-8 text-primary' />
                  自定义规则
                  <span className='ml-2 text-sm font-normal px-2 py-1 bg-destructive/10 text-destructive rounded-md border border-destructive/20'>
                    管理员功能
                  </span>
                </h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <p className='text-muted-foreground mb-4'>
                      自定义规则页面是管理员专用功能，用于管理代理规则集。支持创建、编辑、删除规则文件，这些规则可以在订阅配置中引用，实现灵活的流量分流和路由控制。
                    </p>

                    <div className='space-y-6'>
                      {/* 主要功能 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          主要功能
                        </h3>
                        <ul className='space-y-2 text-sm'>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>规则列表查看</strong>：查看所有已创建的自定义规则文件及其基本信息</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>创建规则</strong>：新建规则文件，支持DNS(dns)、规则(rules)、规则集(rule-providers)</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>编辑规则</strong>：修改规则的名称、类型、行为和规则内容</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>删除规则</strong>：移除不再使用的规则文件</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>规则类型选择</strong>：支持 DNS(dns)、规则(rules)、规则集(rule-providers) 多种规则类型</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-primary mt-1'>•</span>
                            <span><strong>规则行为设置</strong>：替换或追加</span>
                          </li>
                        </ul>
                      </div>

                      {/* 规则类型说明 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-purple-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Network className='size-4' />
                          规则类型说明
                        </h3>
                        <div className='space-y-3 text-sm'>
                          <p className='text-muted-foreground'>
                            自定义规则支持多种规则类型，用于不同的匹配场景：
                          </p>
                          <div className='grid md:grid-cols-2 gap-3'>
                            <div className='bg-background/50 rounded-lg p-3'>
                              <h4 className='font-semibold text-sm mb-2'>DNS</h4>
                              <p className='text-xs text-muted-foreground mb-2'>
                                替换配置文件中dns:这一整段
                              </p>
                            </div>
                            <div className='bg-background/50 rounded-lg p-3'>
                              <h4 className='font-semibold text-sm mb-2'>规则</h4>
                              <p className='text-xs text-muted-foreground mb-2'>
                                替换或追加配置文件中rules:的内容
                              </p>
                            </div>
                            <div className='bg-background/50 rounded-lg p-3'>
                              <h4 className='font-semibold text-sm mb-2'>规则集</h4>
                              <p className='text-xs text-muted-foreground mb-2'>
                                替换或追加配置文件中rules-providers:的内容
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 创建规则步骤 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-green-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <FileCode className='size-4' />
                          创建规则步骤
                        </h3>
                        <div className='space-y-3 text-sm'>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>1</span>
                            <div>
                              <strong>点击"新建规则"按钮</strong>
                              <p className='text-muted-foreground mt-1'>打开规则创建对话框</p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>2</span>
                            <div>
                              <strong>填写规则基本信息</strong>
                              <p className='text-muted-foreground mt-1'>
                                • <strong>规则名称</strong>：为规则设置一个唯一的名称（如：广告屏蔽、国内直连）<br/>
                                • <strong>规则类型</strong>：DNS、规则、规则集<br/>
                                • <strong>规则行为</strong>：替换或追加
                              </p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>3</span>
                            <div>
                              <strong>编写规则内容</strong>
                              <p className='text-muted-foreground mt-1'>
                                在编辑器中编写规则，每行一条规则。如规则类型的格式：<br/>
                                <code className='bg-muted px-2 py-0.5 rounded text-xs'>规则类型,匹配值</code><br/>
                                示例：<br/>
                                <code className='bg-muted px-2 py-0.5 rounded text-xs'>DOMAIN-SUFFIX,google.com</code><br/>
                                <code className='bg-muted px-2 py-0.5 rounded text-xs'>IP-CIDR,192.168.0.0/16</code>
                              </p>
                            </div>
                          </div>
                          <div className='flex gap-3'>
                            <span className='flex-shrink-0 flex items-center justify-center size-6 rounded-full bg-primary/20 text-primary font-semibold text-xs'>4</span>
                            <div>
                              <strong>保存规则</strong>
                              <p className='text-muted-foreground mt-1'>点击保存按钮创建规则，规则可在订阅配置中引用</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 规则应用场景 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-indigo-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          规则应用场景
                        </h3>
                        <div className='space-y-3'>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>场景一：广告屏蔽</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              编写一个 REJECT 规则，包含常见广告域名：
                            </p>
                            <div className='bg-muted/50 rounded p-2 font-mono text-xs space-y-1'>
                              <div>DOMAIN-SUFFIX,doubleclick.net</div>
                              <div>DOMAIN-SUFFIX,googleadservices.com</div>
                              <div>DOMAIN-KEYWORD,advertisement</div>
                            </div>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>场景二：国内直连</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              编写一个 DIRECT 规则，让国内网站直连：
                            </p>
                            <div className='bg-muted/50 rounded p-2 font-mono text-xs space-y-1'>
                              <div>DOMAIN-SUFFIX,baidu.com</div>
                              <div>DOMAIN-SUFFIX,taobao.com</div>
                              <div>GEOIP,CN</div>
                            </div>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>场景三：流媒体代理</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              编写一个 PROXY 规则，让流媒体走代理：
                            </p>
                            <div className='bg-muted/50 rounded p-2 font-mono text-xs space-y-1'>
                              <div>DOMAIN-SUFFIX,netflix.com</div>
                              <div>DOMAIN-SUFFIX,youtube.com</div>
                              <div>DOMAIN-KEYWORD,spotify</div>
                            </div>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>场景四：局域网直连</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              编写一个 DIRECT 规则，让局域网流量直连：
                            </p>
                            <div className='bg-muted/50 rounded p-2 font-mono text-xs space-y-1'>
                              <div>IP-CIDR,192.168.0.0/16</div>
                              <div>IP-CIDR,10.0.0.0/8</div>
                              <div>IP-CIDR,172.16.0.0/12</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 在订阅中引用规则 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-amber-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Database className='size-4' />
                          在订阅中引用规则
                        </h3>
                        <div className='space-y-3 text-sm'>
                          <p className='text-muted-foreground'>
                            创建规则后，需要在"生成订阅"的配置中引用才能生效：
                          </p>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>规则 类型示例</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              替换或追加配置文件中 rule: 的内容
                            </p>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1'>
                              <div className='mt-2'>rules:</div>
                              <div className='ml-4'>- RULE-SET,reject,🐟 漏网之鱼</div>
                              <div className='ml-4'>- RULE-SET,ad-block,REJECT</div>
                              <div className='ml-4'>- GEOIP,CN,DIRECT</div>
                              <div className='ml-4'>- MATCH,PROXY</div>
                            </div>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>规则集 类型示例</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              替换或追加到订阅配置的 rule-providers 部分：
                            </p>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1'>
                              <div>reject:</div>
                              <div className='ml-4'>type: http</div>
                              <div className='ml-4'>behavior: domain</div>
                              <div className='ml-4'>url: https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt</div>
                              <div className='ml-4'>path: "./rule_provider/reject.yaml"</div>
                              <div className='ml-4'>interval: 86400</div>
                            </div>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>DNS 类型的自定义规则示例</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              DNS 配置用于实现智能分流和防污染，替换自定义DNS规则到配置文件里
                            </p>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1 overflow-x-auto'>
                              <div>dns:</div>
                              <div className='ml-4'>enable: true</div>
                              <div className='ml-4'>nameserver:</div>
                              <div className='ml-8'>- https://1.12.12.12/dns-query</div>
                              <div className='ml-4'>direct-nameserver:</div>
                              <div className='ml-8'>- https://1.12.12.12/dns-query</div>
                              <div className='ml-4'>nameserver-policy:</div>
                              <div className='ml-8'>'geosite:gfw,greatfire':</div>
                              <div className='ml-12'>- 'https://8.8.8.8/dns-query'</div>
                              <div className='ml-8'>"geosite:cn, private":</div>
                              <div className='ml-12'>- https://1.12.12.12/dns-query</div>
                              <div className='ml-8'>"geosite:category-games@cn":</div>
                              <div className='ml-12'>- https://1.12.12.12/dns-query</div>
                              <div className='ml-8'>"geosite:google":</div>
                              <div className='ml-12'>- https://1.0.0.1/dns-query</div>
                              <div className='ml-8'>"geosite:apple":</div>
                              <div className='ml-12'>- https://1.0.0.1/dns-query</div>
                              <div className='ml-8'>"geosite:geolocation-!cn":</div>
                              <div className='ml-12'>- https://1.0.0.1/dns-query</div>
                              <div className='ml-4'>proxy-server-nameserver:</div>
                              <div className='ml-8'>- https://1.12.12.12/dns-query</div>
                              <div className='ml-4'>ipv6: false</div>
                              <div className='ml-4'>listen: 0.0.0.0:7874</div>
                              <div className='ml-4'>default-nameserver:</div>
                              <div className='ml-8'>- https://1.1.1.1/dns-query</div>
                              <div className='ml-4'>fallback:</div>
                              <div className='ml-8'>- https://120.53.53.53/dns-query</div>
                              <div className='ml-8'>- https://223.5.5.5/dns-query</div>
                              <div className='ml-8'>- https://1.1.1.1/dns-query</div>
                              <div className='ml-4'>use-hosts: true</div>
                            </div>
                            <p className='text-xs text-muted-foreground mt-2'>
                              <strong>配置说明：</strong><br/>
                              • <strong>nameserver</strong>: 默认 DNS 服务器<br/>
                              • <strong>nameserver-policy</strong>: 根据域名分类使用不同的 DNS 服务器<br/>
                              • <strong>geosite:gfw,greatfire</strong>: 被墙网站使用国外 DNS<br/>
                              • <strong>geosite:cn</strong>: 国内网站使用国内 DNS<br/>
                              • <strong>fallback</strong>: 备用 DNS 服务器<br/>
                              • <strong>ipv6: false</strong>: 禁用 IPv6 解析
                            </p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>规则优先级</h4>
                            <p className='text-xs text-muted-foreground'>
                              规则按照在配置中出现的顺序匹配，越靠前的规则优先级越高。建议顺序：<br/>
                              1. 特定规则（如广告屏蔽）<br/>
                              2. 国内直连规则<br/>
                              3. 代理规则<br/>
                              4. 兜底规则（MATCH）
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 注意事项 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-orange-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Shield className='size-4' />
                          注意事项
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>规则格式</strong>：yaml的缩进必须正确</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>RUlES的规则使用的代理组必须存在</strong>：如示例中🐟 漏网之鱼，代理组中必须存在</span>
                          </li>
                        </ul>
                      </div>

                      {/* 最佳实践 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-emerald-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          最佳实践
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>生成订阅后修改配置文件自定义规则被自动任务覆盖</strong>：使用自定义规则保证不会被自动生成的规则覆盖</span>
                          </li>
                        </ul>
                      </div>

                      {/* 规则维护建议 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-violet-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Settings className='size-4' />
                          规则维护建议
                        </h3>
                        <div className='space-y-3 text-sm text-muted-foreground'>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2 text-foreground'>定期检查</h4>
                            <p className='text-xs'>
                              定期检查规则的有效性，移除已失效的域名和 IP 段，保持规则集的精简和高效。
                            </p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2 text-foreground'>用户反馈</h4>
                            <p className='text-xs'>
                              关注用户反馈，根据实际使用情况调整规则。例如某些网站无法访问，可能需要添加直连规则。
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* System Settings Section */}
              <section id='system-settings' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4 flex items-center gap-3'>
                  <Settings className='size-8 text-primary' />
                  系统设置
                  <span className='ml-2 text-sm font-normal px-2 py-1 bg-destructive/10 text-destructive rounded-md border border-destructive/20'>
                    管理员功能
                  </span>
                </h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <p className='text-muted-foreground mb-4'>
                      系统设置页面是管理员专用功能，用于配置系统级别的全局设置，包括外部订阅同步和自定义规则等核心功能的开关和参数。
                    </p>

                    <div className='space-y-6'>
                      {/* 外部订阅同步设置 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Database className='size-4' />
                          外部订阅同步设置
                        </h3>
                        <div className='space-y-4 text-sm'>
                          <p className='text-muted-foreground'>
                            配置外部订阅链接的同步行为，控制节点数据的更新策略和缓存机制。
                          </p>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>同步外部订阅流量信息</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              <strong>开关设置</strong>：开启 / 关闭
                            </p>
                            <p className='text-xs text-muted-foreground'>
                              • <strong>开启后</strong>：流量信息数据包含外部订阅的流量信息<br/>
                              • <strong>关闭后</strong>：仅统计本地管理的节点流量<br/>
                              • <strong>适用场景</strong>：当使用外部订阅源时，需要同步显示外部订阅的流量使用情况
                            </p>
                          </div>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>强制同步外部订阅</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              <strong>开关设置</strong>：开启 / 关闭
                            </p>
                            <p className='text-xs text-muted-foreground'>
                              • <strong>开启后</strong>：每次用户获取订阅链接时，系统都会重新从外部订阅源拉取最新节点数据<br/>
                              • <strong>关闭后</strong>：使用缓存的外部订阅数据，不会实时更新<br/>
                              • <strong>注意</strong>：开启会增加订阅接口的响应时间
                            </p>
                          </div>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>匹配规则</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              <strong>选项</strong>：节点名称 / 服务器:端口
                            </p>
                            <div className='space-y-2 text-xs text-muted-foreground'>
                              <div>
                                <strong>节点名称</strong>：根据节点名称匹配并更新节点信息
                                <ul className='ml-4 mt-1 space-y-1'>
                                  <li>• 适用于节点名称稳定的订阅源</li>
                                  <li>• 更新时保留本地对节点的配置修改</li>
                                </ul>
                              </div>
                              <div className='mt-2'>
                                <strong>服务器:端口</strong>：根据服务器地址和端口匹配并更新节点信息
                                <ul className='ml-4 mt-1 space-y-1'>
                                  <li>• 适用于节点名称会经常变更的订阅源</li>
                                  <li>• 通过 server:port 组合唯一标识节点</li>
                                  <li>• 即使节点名称改变，也能正确匹配和更新</li>
                                </ul>
                              </div>
                            </div>
                          </div>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>缓存过期时间（分钟）</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              <strong>设置</strong>：0 或大于 0 的整数
                            </p>
                            <p className='text-xs text-muted-foreground'>
                              • <strong>设置为 0</strong>：每次获取订阅时都重新拉取外部订阅节点（实时更新）<br/>
                              • <strong>大于 0</strong>：只有距离上次同步时间超过设置的分钟数才会重新拉取<br/>
                              • <strong>示例</strong>：设置为 60，则 1 小时内的订阅请求使用缓存数据<br/>
                              • <strong>⚠️ 警告</strong>：设置为 0 会影响获取订阅接口的响应速度
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 节点流量设置 */}
                      {/* 自定义规则设置 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-cyan-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <FileCode className='size-4' />
                          自定义规则设置
                        </h3>
                        <div className='space-y-4 text-sm'>
                          <p className='text-muted-foreground'>
                            配置自定义 DNS、规则和规则集功能，实现高级的流量分流控制。
                          </p>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>启用自定义规则</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              <strong>开关设置</strong>：开启 / 关闭
                            </p>
                            <div className='space-y-2 text-xs text-muted-foreground'>
                              <p><strong>开启后：</strong></p>
                              <ul className='ml-4 space-y-1'>
                                <li>• 导航栏显示"自定义规则"菜单项</li>
                                <li>• 可以创建 DNS 配置、规则列表和规则集提供商</li>
                                <li>• 生成订阅时自动应用已启用的自定义规则</li>
                                <li>• DNS 规则会替换默认的 DNS 配置</li>
                                <li>• 普通规则和规则集可选择"替换"或"添加至头部"模式</li>
                              </ul>
                              <p className='mt-2'><strong>关闭后：</strong></p>
                              <ul className='ml-4 space-y-1'>
                                <li>• 自定义规则菜单不显示</li>
                                <li>• 订阅使用默认配置生成</li>
                                <li>• 已创建的自定义规则不会被删除，只是不生效</li>
                              </ul>
                            </div>
                          </div>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>自定义规则类型</h4>
                            <div className='space-y-2 text-xs text-muted-foreground'>
                              <div>
                                <strong>DNS 配置</strong>
                                <ul className='ml-4 mt-1 space-y-1'>
                                  <li>• 配置 DNS 服务器和分流策略</li>
                                  <li>• 支持 DoH/DoT 等加密 DNS</li>
                                  <li>• 可按域名分类使用不同 DNS</li>
                                </ul>
                              </div>
                              <div className='mt-2'>
                                <strong>规则列表</strong>
                                <ul className='ml-4 mt-1 space-y-1'>
                                  <li>• 创建域名、IP 等规则</li>
                                  <li>• 设置规则行为（DIRECT/PROXY/REJECT）</li>
                                  <li>• 支持多种规则类型</li>
                                </ul>
                              </div>
                              <div className='mt-2'>
                                <strong>规则集提供商</strong>
                                <ul className='ml-4 mt-1 space-y-1'>
                                  <li>• 引用外部规则集文件</li>
                                  <li>• 支持定时更新规则集</li>
                                  <li>• 可组合多个规则集</li>
                                </ul>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 使用场景 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-indigo-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          典型使用场景
                        </h3>
                        <div className='space-y-3'>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>场景一：使用外部订阅源</h4>
                            <p className='text-xs text-muted-foreground'>
                              管理员导入外部订阅链接作为节点来源 → 开启"强制同步外部订阅" → 设置合适的缓存时间（如 30 分钟）→ 选择匹配规则 → 用户每次获取订阅时节点信息保持最新。
                            </p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>场景三：高级分流配置</h4>
                            <p className='text-xs text-muted-foreground'>
                              开启"自定义规则" → 创建 DNS 配置实现智能 DNS 分流 → 添加广告屏蔽规则 → 配置国内直连规则 → 引用外部规则集 → 生成订阅时自动应用这些规则。
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 注意事项 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-orange-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Shield className='size-4' />
                          注意事项
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>性能影响</strong>：将缓存时间设置为 0 会显著增加订阅接口的响应时间</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>匹配规则选择</strong>：如果外部订阅的节点名称经常变化，建议使用"服务器:端口"匹配</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>自定义规则测试</strong>：启用自定义规则后建议先测试订阅是否正常工作</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>设置即时生效</strong>：所有设置修改后立即生效，无需重启服务</span>
                          </li>
                        </ul>
                      </div>

                      {/* 最佳实践 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-emerald-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          最佳实践
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>合理设置缓存</strong>：根据节点更新频率设置缓存时间，建议 15-60 分钟</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>按需开启功能</strong>：只开启实际需要的功能，避免不必要的性能开销</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>测试后部署</strong>：修改系统设置后先进行测试，确认无误后再正式使用</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>记录配置</strong>：记录系统设置的修改历史和原因，便于问题排查</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>定期检查</strong>：定期检查外部订阅同步是否正常</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* Advanced Techniques - Chain Proxy Section */}
              <section id='chain-proxy' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4 flex items-center gap-3'>
                  <Network className='size-8 text-primary' />
                  链式代理
                </h2>

                <Card className='bg-background/50 backdrop-blur border-border/50'>
                  <CardContent className='pt-6'>
                    <p className='text-muted-foreground mb-6'>
                      链式代理（Chain Proxy）是一种通过多层代理服务器转发流量的技术，可以实现更复杂的网络路由策略。妙妙屋通过 dialer-proxy 技术实现链式代理，允许为节点指定前置节点，实现多级代理转发。
                    </p>

                    <div className='space-y-6'>
                      {/* 什么是链式代理 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-blue-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Network className='size-4' />
                          什么是链式代理
                        </h3>
                        <div className='space-y-3 text-sm text-muted-foreground'>
                          <p>
                            链式代理是指将多个代理节点串联起来，让流量依次通过多个代理服务器再到达目标网站。例如：
                          </p>
                          <div className='bg-background/50 rounded-lg p-3 font-mono text-xs'>
                            客户端 → 中转节点 → 落地节点 → 目标网站
                          </div>
                          <p>
                            在妙妙屋中，这通过 Clash 的 <code className='bg-muted px-1.5 py-0.5 rounded text-xs'>dialer-proxy</code> 属性实现。源节点会将流量先转发到指定的目标节点（前置节点），再由目标节点转发到最终目的地。
                          </p>
                        </div>
                      </div>

                      {/* 应用场景 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-purple-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          应用场景
                        </h3>
                        <div className='space-y-3 text-sm'>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>场景一：中转加速</h4>
                            <p className='text-muted-foreground text-xs'>
                              当落地节点距离用户较远时，可以通过距离用户较近的中转节点来加速连接。例如：国内用户 → 香港中转 → 美国落地节点。
                            </p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>场景二：隐藏真实IP</h4>
                            <p className='text-muted-foreground text-xs'>
                              通过多层代理隐藏客户端的真实 IP 地址，增强隐私保护。目标网站只能看到最后一个落地节点的 IP。
                            </p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>场景三：绕过限制</h4>
                            <p className='text-muted-foreground text-xs'>
                              某些服务可能限制特定地区的 IP 访问，通过链式代理可以灵活切换出口 IP 所在地区，绕过地域限制。
                            </p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>场景四：负载均衡</h4>
                            <p className='text-muted-foreground text-xs'>
                              配合代理组使用，可以实现多中转、多落地的负载均衡策略，提高可用性和稳定性。
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 创建链式代理 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-cyan-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <img src={ExchangeIcon} alt='Exchange' className='size-4' />
                          创建链式代理节点
                        </h3>
                        <div className='space-y-4 text-sm'>
                          <p className='text-muted-foreground'>
                            在妙妙屋中创建链式代理节点非常简单，只需几个步骤：
                          </p>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>操作步骤</h4>
                            <ol className='space-y-2 text-xs text-muted-foreground'>
                              <li><strong>1.</strong> 进入"节点管理"页面</li>
                              <li><strong>2.</strong> 找到要作为源节点（落地节点）的节点</li>
                              <li><strong>3.</strong> 点击该节点右侧的"链式代理"按钮（<img src={ExchangeIcon} alt='Exchange' className='size-3 inline' /> 图标）</li>
                              <li><strong>4.</strong> 在弹出的对话框中选择目标节点（前置中转节点）</li>
                              <li><strong>5.</strong> 点击"创建链式代理"按钮</li>
                              <li><strong>6.</strong> 系统会自动创建一个新的链式代理节点</li>
                            </ol>
                          </div>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>节点命名规则</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              创建的链式代理节点会自动以以下格式命名：
                            </p>
                            <div className='bg-muted/50 rounded p-2 font-mono text-xs'>
                              源节点名称⇋目标节点名称
                            </div>
                            <p className='text-xs text-muted-foreground mt-2'>
                              例如：<code className='bg-muted px-1.5 py-0.5 rounded'>美国节点⇋香港中转</code>
                            </p>
                          </div>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>节点标签</h4>
                            <p className='text-xs text-muted-foreground'>
                              创建的链式代理节点会自动添加"<strong>链式代理</strong>"标签，方便识别和管理。
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 技术原理 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-green-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <FileCode className='size-4' />
                          技术原理
                        </h3>
                        <div className='space-y-4 text-sm'>
                          <p className='text-muted-foreground'>
                            妙妙屋的链式代理基于 Clash 的 <code className='bg-muted px-1.5 py-0.5 rounded text-xs'>dialer-proxy</code> 配置实现。
                          </p>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>配置示例</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              当创建链式代理时，系统会为源节点添加 dialer-proxy 属性：
                            </p>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1 overflow-x-auto'>
                              <div>- name: "美国节点⇋香港中转"</div>
                              <div className='ml-2'>type: vmess</div>
                              <div className='ml-2'>server: us.example.com</div>
                              <div className='ml-2'>port: 443</div>
                              <div className='ml-2'>uuid: "..."</div>
                              <div className='ml-2'>alterId: 0</div>
                              <div className='ml-2'>cipher: auto</div>
                              <div className='ml-2'>dialer-proxy: "香港中转"</div>
                            </div>
                            <p className='text-xs text-muted-foreground mt-2'>
                              <code className='bg-muted px-1.5 py-0.5 rounded'>dialer-proxy: "香港中转"</code> 表示此节点的流量会先经过"香港中转"节点。
                            </p>
                          </div>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>流量转发流程</h4>
                            <ol className='space-y-2 text-xs text-muted-foreground'>
                              <li><strong>1.</strong> 客户端发起请求到链式代理节点</li>
                              <li><strong>2.</strong> Clash 读取节点的 dialer-proxy 配置</li>
                              <li><strong>3.</strong> 流量先建立到前置节点（香港中转）的连接</li>
                              <li><strong>4.</strong> 通过前置节点再连接到源节点（美国节点）</li>
                              <li><strong>5.</strong> 最终通过美国节点访问目标网站</li>
                            </ol>
                          </div>
                        </div>
                      </div>

                      {/* 配合代理组使用 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-indigo-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Zap className='size-4' />
                          配合代理组使用
                        </h3>
                        <div className='space-y-4 text-sm'>
                          <p className='text-muted-foreground'>
                            链式代理的真正威力在于与代理组结合使用，实现灵活的多级代理策略。
                          </p>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>创建代理组</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              在"生成订阅"页面中，可以配置两个特殊的代理组：
                            </p>
                            <ul className='space-y-1 text-xs text-muted-foreground ml-4'>
                              <li>• <strong>🌄 落地节点</strong>：包含所有最终出口节点</li>
                              <li>• <strong>🌠 中转节点</strong>：包含所有中转/前置节点</li>
                            </ul>
                          </div>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>批量创建链式代理</h4>
                            <p className='text-xs text-muted-foreground mb-2'>
                              如果你有多个落地节点和多个中转节点，可以批量创建链式代理：
                            </p>
                            <ol className='space-y-2 text-xs text-muted-foreground'>
                              <li><strong>1.</strong> 准备好落地节点（例如：美国、日本、新加坡）</li>
                              <li><strong>2.</strong> 准备好中转节点（例如：香港、台湾）</li>
                              <li><strong>3.</strong> 为每个落地节点分别创建链式代理</li>
                              <li><strong>4.</strong> 选择不同的中转节点作为前置</li>
                              <li><strong>5.</strong> 生成订阅时启用"配置链式代理分组"</li>
                            </ol>
                          </div>

                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold mb-2'>代理组配置示例</h4>
                            <div className='bg-muted/50 rounded p-3 font-mono text-xs space-y-1 overflow-x-auto'>
                              <div>proxy-groups:</div>
                              <div className='ml-2'>- name: "🌄 落地节点"</div>
                              <div className='ml-4'>type: select</div>
                              <div className='ml-4'>proxies:</div>
                              <div className='ml-6'>- "美国节点"</div>
                              <div className='ml-6'>- "日本节点"</div>
                              <div className='ml-6'>- "新加坡节点"</div>
                              <div className='mt-2 ml-2'>- name: "🌠 中转节点"</div>
                              <div className='ml-4'>type: select</div>
                              <div className='ml-4'>proxies:</div>
                              <div className='ml-6'>- "香港中转"</div>
                              <div className='ml-6'>- "台湾中转"</div>
                              <div className='mt-2 ml-2'>- name: "🚀 链式代理"</div>
                              <div className='ml-4'>type: select</div>
                              <div className='ml-4'>proxies:</div>
                              <div className='ml-6'>- "美国节点⇋香港中转"</div>
                              <div className='ml-6'>- "美国节点⇋台湾中转"</div>
                              <div className='ml-6'>- "日本节点⇋香港中转"</div>
                              <div className='ml-6'>- "新加坡节点⇋香港中转"</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 注意事项 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-orange-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Shield className='size-4' />
                          注意事项
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>延迟增加</strong>：每增加一层代理，网络延迟会相应增加，建议不超过 2 层</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>速度影响</strong>：链式代理的最终速度取决于链路中最慢的节点</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>循环引用</strong>：避免创建循环引用的链式代理（A→B→A），会导致连接失败</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>节点删除</strong>：删除前置节点时，依赖它的链式代理节点会失效</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>流量统计</strong>：链式代理的流量会分别计入每一层节点的统计中</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-orange-500 mt-1'>⚠</span>
                            <span><strong>客户端支持</strong>：确保你的 Clash 客户端支持 dialer-proxy 功能</span>
                          </li>
                        </ul>
                      </div>

                      {/* 最佳实践 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-emerald-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <Sparkles className='size-4' />
                          最佳实践
                        </h3>
                        <ul className='space-y-2 text-sm text-muted-foreground'>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>选择低延迟中转</strong>：中转节点应选择距离用户较近、延迟较低的节点</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>选择高带宽落地</strong>：落地节点应选择带宽充足、稳定性好的节点</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>合理规划路径</strong>：遵循"就近接入、远程落地"的原则</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>测试后使用</strong>：创建链式代理后先测试连接速度和稳定性</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>保留直连选项</strong>：在代理组中同时保留单层节点，以便灵活切换</span>
                          </li>
                          <li className='flex items-start gap-2'>
                            <span className='text-emerald-500 mt-1'>💡</span>
                            <span><strong>定期维护</strong>：定期检查链式代理节点是否正常工作，及时删除失效节点</span>
                          </li>
                        </ul>
                      </div>

                      {/* 故障排查 */}
                      <div className='bg-muted/30 rounded-lg p-4 border-l-4 border-red-500'>
                        <h3 className='font-semibold mb-3 flex items-center gap-2'>
                          <HelpCircle className='size-4' />
                          故障排查
                        </h3>
                        <div className='space-y-3'>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>问题：链式代理节点无法连接</h4>
                            <p className='text-xs text-muted-foreground'>
                              <strong>可能原因：</strong><br/>
                              • 前置节点已被删除或禁用<br/>
                              • 前置节点自身连接失败<br/>
                              • 前置节点不支持转发流量<br/>
                              <strong>解决方法：</strong><br/>
                              • 检查前置节点是否正常工作<br/>
                              • 尝试直接连接前置节点测试<br/>
                              • 更换其他前置节点重新创建
                            </p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>问题：速度明显变慢</h4>
                            <p className='text-xs text-muted-foreground'>
                              <strong>可能原因：</strong><br/>
                              • 中转节点带宽不足<br/>
                              • 链路过长（超过2层）<br/>
                              • 节点之间距离太远<br/>
                              <strong>解决方法：</strong><br/>
                              • 更换带宽更高的中转节点<br/>
                              • 减少代理层数<br/>
                              • 优化节点地理位置分布
                            </p>
                          </div>
                          <div className='bg-background/50 rounded-lg p-3'>
                            <h4 className='font-semibold text-sm mb-2'>问题：延迟过高</h4>
                            <p className='text-xs text-muted-foreground'>
                              <strong>可能原因：</strong><br/>
                              • 中转节点延迟较高<br/>
                              • 中转到落地之间路由不佳<br/>
                              <strong>解决方法：</strong><br/>
                              • 使用延迟测试找出最优中转节点<br/>
                              • 尝试不同的中转落地组合<br/>
                              • 考虑使用直连节点代替链式代理
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              {/* FAQ Section */}
              <section id='faq' className='scroll-mt-20 space-y-6 pt-12'>
                <h2 className='text-3xl font-bold tracking-tight mb-4'>常见问题</h2>

                <div className='space-y-4'>
                  {[
                    {
                      question: '订阅链接不显示订阅怎么办？',
                      answer: '检查以下几点：\n1. 管理员是否已给用户绑定订阅'
                    },
                    {
                      question: '客户端导入订阅失败怎么办？',
                      answer: '提供报错信息联系开发者，建议提issue'
                    },
                    {
                      question: '支持哪些订阅格式？',
                      answer: '妙妙屋目前保存为 Clash 订阅格式，可以转换为其他客户端格式，您可以在获取订阅链接时选择合适的格式。'
                    }
                  ].map((faq, index) => (
                    <Card key={index} className='bg-background/50 backdrop-blur border-border/50'>
                      <CardContent className='pt-6'>
                        <h3 className='font-semibold mb-2 flex items-center gap-2'>
                          <HelpCircle className='size-4 text-primary' />
                          {faq.question}
                        </h3>
                        <p className='text-sm text-muted-foreground whitespace-pre-line'>
                          {faq.answer}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              {/* Footer */}
              <div className='mt-16 pt-8 border-t border-border/50'>
                <div className='flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground'>
                  <p>如有其他问题，欢迎访问项目 GitHub 页面提交 Issue</p>
                  <Link to='/'>
                    <Button variant='outline' size='sm'>返回首页</Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Right Sidebar - On This Page */}
        <aside className='hidden xl:block w-64 border-r bg-background/30 backdrop-blur supports-[backdrop-filter]:bg-background/20 h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto'>
          <div className='p-4'>
            <h3 className='text-sm font-semibold mb-3 text-muted-foreground'>本页内容</h3>
            <nav className='space-y-1 text-sm'>
              <button
                onClick={() => scrollToSection('about')}
                className='block w-full text-left px-2 py-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors'
              >
                关于妙妙屋
              </button>
              <button
                onClick={() => scrollToSection('features')}
                className='block w-full text-left px-2 py-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors'
              >
                核心特性详解
              </button>
              <button
                onClick={() => scrollToSection('quick-start')}
                className='block w-full text-left px-2 py-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors'
              >
                快速开始
              </button>
              <button
                onClick={() => scrollToSection('system-requirements')}
                className='block w-full text-left px-2 py-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors'
              >
                系统要求
              </button>
              <button
                onClick={() => scrollToSection('client-setup')}
                className='block w-full text-left px-2 py-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors'
              >
                客户端配置
              </button>
              <button
                onClick={() => scrollToSection('import-subscription')}
                className='block w-full text-left px-2 py-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors'
              >
                导入订阅
              </button>
            </nav>
          </div>
        </aside>
      </div>

      {/* Back to Top Button */}
      {showBackToTop && (
        <button
          onClick={scrollToTop}
          className='fixed bottom-8 right-8 p-3 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all z-40'
          aria-label='返回顶部'
        >
          <ChevronUp className='size-5' />
        </button>
      )}
    </div>
  )
}
