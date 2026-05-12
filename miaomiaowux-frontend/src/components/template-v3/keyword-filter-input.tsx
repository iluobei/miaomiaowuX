import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { keywordsToRegex } from '@/lib/template-v3-utils'
import { useTranslation } from 'react-i18next'

interface KeywordFilterInputProps {
  value: string
  onChange: (value: string) => void
  onVariableCleared?: () => void
  label: string
  placeholder?: string
  description?: string
  fromVariable?: string
}

export function KeywordFilterInput({
  value,
  onChange,
  onVariableCleared,
  label,
  placeholder,
  description,
  fromVariable,
}: KeywordFilterInputProps) {
  const { t } = useTranslation('templates')
  const resolvedPlaceholder = placeholder ?? t('keywordFilter.defaultPlaceholder')
  const regex = keywordsToRegex(value)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        {fromVariable && (
          <Badge variant="outline" className="text-xs border-dashed border-amber-500 text-amber-600">
            {t('keywordFilter.variable', { name: fromVariable })}
          </Badge>
        )}
      </div>
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          if (fromVariable && onVariableCleared) {
            onVariableCleared()
          }
        }}
        placeholder={resolvedPlaceholder}
        className={fromVariable ? 'border-dashed border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/10' : ''}
      />
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {regex && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('keywordFilter.regex')}</span>
          <Badge variant="secondary" className="font-mono text-xs">
            {regex}
          </Badge>
        </div>
      )}
    </div>
  )
}
