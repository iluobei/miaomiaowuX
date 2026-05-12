import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RefreshCw, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

interface TemplatePreviewProps {
  content: string
  isLoading: boolean
  onRefresh: () => void
  className?: string
  title?: string
}

export function TemplatePreview({
  content,
  isLoading,
  onRefresh,
  className,
  title,
}: TemplatePreviewProps) {
  const { t } = useTranslation('templates')
  const displayTitle = title ?? t('preview.defaultTitle')
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      toast.success(t('preview.copiedToClipboard'))
    } catch {
      toast.error(t('preview.copyFailed'))
    }
  }

  return (
    <Card className={className}>
      <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">{displayTitle}</CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleCopy}
            disabled={!content || isLoading}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[calc(100vh-300px)] min-h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-full py-8">
              <span className="text-muted-foreground">{t('preview.generating')}</span>
            </div>
          ) : content ? (
            <pre className="text-xs p-4 font-mono whitespace-pre-wrap break-all">
              {content}
            </pre>
          ) : (
            <div className="flex items-center justify-center h-full py-8">
              <span className="text-muted-foreground">{t('preview.clickRefresh')}</span>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
