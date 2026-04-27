import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { keywordsToRegex } from '@/lib/template-v3-utils'

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
  placeholder = '输入关键词，用逗号分隔',
  description,
  fromVariable,
}: KeywordFilterInputProps) {
  const regex = keywordsToRegex(value)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        {fromVariable && (
          <Badge variant="outline" className="text-xs border-dashed border-amber-500 text-amber-600">
            变量: {fromVariable}
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
        placeholder={placeholder}
        className={fromVariable ? 'border-dashed border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/10' : ''}
      />
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {regex && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">正则:</span>
          <Badge variant="secondary" className="font-mono text-xs">
            {regex}
          </Badge>
        </div>
      )}
    </div>
  )
}
