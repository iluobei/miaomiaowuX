import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Flag } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Twemoji } from '@/components/twemoji'
import { FLAG_OPTIONS, countryCodeToFlag } from '@/lib/country-flag'

interface FlagEmojiPickerProps {
  onSelect: (flag: string) => void
  onAutoDetect?: () => void
  disabled?: boolean
  loading?: boolean
  className?: string
  currentFlag?: string
  stopPropagation?: boolean
}

export function FlagEmojiPicker({ onSelect, onAutoDetect, disabled, loading, className, currentFlag, stopPropagation }: FlagEmojiPickerProps) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className={className || 'size-7 text-[#d97757] hover:text-[#c66647]'}
          disabled={disabled}
          onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
        >
          {currentFlag ? (
            <span className='text-base'><Twemoji>{currentFlag}</Twemoji></span>
          ) : (
            <Flag className={`size-4 ${loading ? 'animate-pulse' : ''}`} />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-72 p-2' align='start' onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}>
        {onAutoDetect && (
          <Button variant='outline' size='sm' className='w-full mb-2 text-xs' onClick={() => { onAutoDetect(); setOpen(false) }}>
            🌐 {t('flagPicker.autoDetect')}
          </Button>
        )}
        <div className='grid grid-cols-8 gap-1'>
          {FLAG_OPTIONS.map(({ code, label }) => (
            <button
              key={code}
              className='size-8 flex items-center justify-center rounded hover:bg-accent text-lg cursor-pointer'
              onClick={() => { onSelect(countryCodeToFlag(code)); setOpen(false) }}
              title={label}
            >
              <Twemoji>{countryCodeToFlag(code)}</Twemoji>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
