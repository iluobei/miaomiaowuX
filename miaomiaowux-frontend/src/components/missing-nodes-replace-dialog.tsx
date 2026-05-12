import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

interface MissingNodesReplaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  missingNodes: string[]
  replacementChoice: string
  onReplacementChoiceChange: (choice: string) => void
  replacementOptions?: string[]
  onConfirm: () => void
  confirmText?: string
  cancelText?: string
  maxOptionColumns?: number
}

export function MissingNodesReplaceDialog({
  open,
  onOpenChange,
  missingNodes,
  replacementChoice,
  onReplacementChoiceChange,
  replacementOptions = [],
  onConfirm,
  confirmText,
  cancelText,
  maxOptionColumns = 4,
}: MissingNodesReplaceDialogProps) {
  const { t } = useTranslation('nodes')
  const options = useMemo(() => {
    const unique = new Set<string>(['DIRECT', 'REJECT', ...replacementOptions])
    return Array.from(unique)
  }, [replacementOptions])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('missingNodesDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('missingNodesDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='max-h-[200px] space-y-1 overflow-y-auto rounded-md border p-3'>
            {missingNodes.map((node, index) => (
              <div
                key={`${node}-${index}`}
                className='bg-muted rounded px-2 py-1 font-mono text-sm'
              >
                {node}
              </div>
            ))}
          </div>

          <div className='space-y-2'>
            <Label>{t('missingNodesDialog.replaceLabel')}</Label>
            <ButtonGroup
              mode='adaptive-full'
              maxColumns={maxOptionColumns}
              className='w-full'
            >
              {options.map((option) => (
                <Button
                  key={option}
                  variant={replacementChoice === option ? 'default' : 'outline'}
                  onClick={() => onReplacementChoiceChange(option)}
                  className='w-full min-w-0'
                >
                  {option}
                </Button>
              ))}
            </ButtonGroup>
            <p className='text-muted-foreground text-xs'>
              {t('missingNodesDialog.replaceHint')}{' '}
              <span className='font-semibold'>{replacementChoice}</span>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {cancelText || t('actions.cancel', { ns: 'common' })}
          </Button>
          <Button onClick={onConfirm}>{confirmText || t('missingNodesDialog.confirmReplace')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
