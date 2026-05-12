import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

type TableCardProps = {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  isLoading?: boolean
  loadingText?: ReactNode
  isEmpty?: boolean
  emptyState?: ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
  scrollClassName?: string
}

export function TableCard({
  title,
  description,
  actions,
  children,
  isLoading = false,
  loadingText,
  isEmpty = false,
  emptyState,
  className,
  headerClassName,
  contentClassName,
  scrollClassName,
}: TableCardProps) {
  const { t } = useTranslation('common')
  const hasHeader = !!title || !!description || !!actions

  return (
    <Card className={className}>
      {hasHeader && (
        <CardHeader
          className={cn(
            actions &&
              'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
            headerClassName
          )}
        >
          <div className='space-y-1'>
            {title && <CardTitle>{title}</CardTitle>}
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {actions && <div className='shrink-0'>{actions}</div>}
        </CardHeader>
      )}

      <CardContent className={cn('p-0', contentClassName)}>
        {isLoading ? (
          <EmptyState className='py-8' title={loadingText ?? t('actions.loading')} />
        ) : isEmpty ? (
          emptyState || <EmptyState className='py-8' title={t('dataTable.noData')} />
        ) : (
          <div className={cn('overflow-x-auto', scrollClassName)}>
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
