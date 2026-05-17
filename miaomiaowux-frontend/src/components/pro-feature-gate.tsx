import { useLicenseFeature } from '@/hooks/use-license'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface ProFeatureGateProps {
  feature: string
  children: React.ReactNode
  className?: string
}

export function ProFeatureGate({ feature, children, className }: ProFeatureGateProps) {
  const { hasFeature } = useLicenseFeature(feature)
  const { t } = useTranslation('common')

  return (
    <div className={cn('relative', className)}>
      <div className={hasFeature ? '' : 'pointer-events-none opacity-50'}>
        {children}
      </div>
      {!hasFeature && <div className="absolute inset-0 cursor-not-allowed" />}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            'absolute -top-2.5 -right-2.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold cursor-default select-none shadow-sm border transition-all',
            hasFeature
              ? 'bg-gradient-to-r from-amber-400 to-yellow-300 text-amber-900 border-amber-300/60 shadow-amber-200/50'
              : 'bg-gradient-to-r from-gray-200 to-gray-300 text-gray-500 border-gray-300/60 dark:from-gray-700 dark:to-gray-600 dark:text-gray-300 dark:border-gray-500/60'
          )}>
            <svg
              className={cn('h-2.5 w-2.5', hasFeature && 'animate-pulse')}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
            Pro
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {hasFeature ? t('license.proFeatureActive') : t('license.proFeatureTooltip')}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
