import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'

type EmptyStateProps = {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  className?: string
  titleClassName?: string
  descriptionClassName?: string
}

type EmptyStateCardProps = EmptyStateProps & {
  cardClassName?: string
  contentClassName?: string
}

export function EmptyState({
  title,
  description,
  icon,
  actions,
  className,
  titleClassName,
  descriptionClassName,
}: EmptyStateProps) {
  return (
    <div className={cn('py-8 text-center', className)}>
      {icon && <div className='mb-4 flex justify-center'>{icon}</div>}
      <p className={cn('text-muted-foreground mb-2', titleClassName)}>
        {title}
      </p>
      {description && (
        <p
          className={cn(
            'text-muted-foreground/80 text-sm',
            descriptionClassName
          )}
        >
          {description}
        </p>
      )}
      {actions && <div className='mt-4 flex justify-center'>{actions}</div>}
    </div>
  )
}

export function EmptyStateCard({
  cardClassName,
  contentClassName,
  ...props
}: EmptyStateCardProps) {
  return (
    <Card className={cardClassName}>
      <CardContent className={cn('py-0', contentClassName)}>
        <EmptyState {...props} />
      </CardContent>
    </Card>
  )
}
