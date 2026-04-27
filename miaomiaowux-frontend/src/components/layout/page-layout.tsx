import type { ReactNode } from 'react'
import { Topbar } from './topbar'
import { cn } from '@/lib/utils'

export function PageLayout({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className="min-h-svh bg-background">
      <Topbar />
      <main className={cn('container mx-auto px-4 pt-24 pb-6', className)}>
        {children}
      </main>
    </div>
  )
}
