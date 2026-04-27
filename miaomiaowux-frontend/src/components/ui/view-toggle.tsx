import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type ViewMode = 'card' | 'list'

interface ViewToggleProps {
  view: ViewMode
  onViewChange: (view: ViewMode) => void
  className?: string
}

export function ViewToggle({ view, onViewChange, className }: ViewToggleProps) {
  return (
    <div className={`flex gap-1 ${className || ''}`}>
      <Button
        variant={view === 'card' ? 'default' : 'outline'}
        size="icon"
        onClick={() => onViewChange('card')}
        title="卡片视图"
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        variant={view === 'list' ? 'default' : 'outline'}
        size="icon"
        onClick={() => onViewChange('list')}
        title="列表视图"
      >
        <List className="h-4 w-4" />
      </Button>
    </div>
  )
}
