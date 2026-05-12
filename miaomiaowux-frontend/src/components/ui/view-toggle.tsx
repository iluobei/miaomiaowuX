import { LayoutGrid, List } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

export type ViewMode = 'card' | 'list'

interface ViewToggleProps {
  view: ViewMode
  onViewChange: (view: ViewMode) => void
  className?: string
}

export function ViewToggle({ view, onViewChange, className }: ViewToggleProps) {
  const { t } = useTranslation('common')
  return (
    <div className={`flex gap-1 ${className || ''}`}>
      <Button
        variant={view === 'card' ? 'default' : 'outline'}
        size="icon"
        onClick={() => onViewChange('card')}
        title={t('viewToggle.card')}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        variant={view === 'list' ? 'default' : 'outline'}
        size="icon"
        onClick={() => onViewChange('list')}
        title={t('viewToggle.list')}
      >
        <List className="h-4 w-4" />
      </Button>
    </div>
  )
}
