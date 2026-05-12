// @ts-nocheck
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Wand2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface VlessDecryptionFieldProps {
  value: string
  onChange: (value: string) => void
  onEncryptionGenerated?: (encryption: string) => void
}

export function VlessDecryptionField({ value, onChange, onEncryptionGenerated }: VlessDecryptionFieldProps) {
  const { t } = useTranslation('xray')
  const [mode, setMode] = useState<'none' | 'mlkem768x25519plus'>(
    value && value !== 'none' ? 'mlkem768x25519plus' : 'none',
  )
  const [encryptionType, setEncryptionType] = useState<'x25519' | 'mlkem768'>('mlkem768')
  const [appearance, setAppearance] = useState('native')
  const [ticketLifetime, setTicketLifetime] = useState('600s')
  const [padding, setPadding] = useState('100-111-1111.75-0-111.50-0-3333')
  const [isGenerating, setIsGenerating] = useState(false)

  const handleGenerate = async () => {
    if (mode === 'none') {
      onChange('none')
      return
    }

    setIsGenerating(true)
    try {
      // Call backend API to generate keys using xray commands
      const response = await api.post('/api/admin/xray/generate-keys', {
        type: 'mlkem768x25519plus',
        encryptionType,
        appearance,
        ticketLifetime,
        padding,
      })

      const config = response.data.decryptionConfig
      const encryption = response.data.encryption

      onChange(config)

      if (onEncryptionGenerated) {
        onEncryptionGenerated(encryption)
      }

      toast.success(t('vlessDecryption.genSuccess'), {
        description: t('vlessDecryption.genSuccessDesc'),
      })
    } catch (error) {
      toast.error(t('vlessDecryption.genFailed'), {
        description: error.response?.data || error.message || t('vlessDecryption.genFailedDesc'),
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleModeChange = (newMode: string) => {
    setMode(newMode as 'none' | 'mlkem768x25519plus')
    if (newMode === 'none') {
      onChange('none')
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t('vlessDecryption.decryptionMode')}</Label>
        <div className="flex flex-wrap gap-2 md:gap-3">
          <Button
            type="button"
            variant={mode === 'none' ? 'default' : 'outline'}
            onClick={() => handleModeChange('none')}
            className="flex-1 min-w-[120px]"
          >
            {t('vlessDecryption.noneMode')}
          </Button>
          <Button
            type="button"
            variant={mode === 'mlkem768x25519plus' ? 'default' : 'outline'}
            onClick={() => handleModeChange('mlkem768x25519plus')}
            className="flex-1 min-w-[120px]"
          >
            {t('vlessDecryption.encryptedMode')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('vlessDecryption.supportPostQuantum')}</p>
      </div>

      {mode === 'mlkem768x25519plus' && (
        <>
          <div className="space-y-2">
            <Label>{t('vlessDecryption.encryptionType')}</Label>
            <div className="flex gap-3">
              <Button
                type="button"
                variant={encryptionType === 'x25519' ? 'default' : 'outline'}
                onClick={() => setEncryptionType('x25519')}
                className="flex-1"
              >
                X25519
              </Button>
              <Button
                type="button"
                variant={encryptionType === 'mlkem768' ? 'default' : 'outline'}
                onClick={() => setEncryptionType('mlkem768')}
                className="flex-1"
              >
                ML-KEM-768
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {encryptionType === 'x25519' && t('vlessDecryption.x25519Desc')}
              {encryptionType === 'mlkem768' && t('vlessDecryption.mlkemDesc')}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t('vlessDecryption.appearance')}</Label>
            <div className="flex flex-wrap gap-2 md:gap-3">
              <Button
                type="button"
                variant={appearance === 'native' ? 'default' : 'outline'}
                onClick={() => setAppearance('native')}
                className="flex-1 min-w-[120px]"
              >
                native
              </Button>
              <Button
                type="button"
                variant={appearance === 'xorpub' ? 'default' : 'outline'}
                onClick={() => setAppearance('xorpub')}
                className="flex-1 min-w-[120px]"
              >
                xorpub
              </Button>
              <Button
                type="button"
                variant={appearance === 'random' ? 'default' : 'outline'}
                onClick={() => setAppearance('random')}
                className="flex-1 min-w-[120px]"
              >
                random
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {appearance === 'native' && t('vlessDecryption.nativeDesc')}
              {appearance === 'xorpub' && t('vlessDecryption.xorpubDesc')}
              {appearance === 'random' && t('vlessDecryption.randomDesc')}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t('vlessDecryption.ticketLifetime')}</Label>
            <div className="flex flex-wrap gap-2 md:gap-3">
              <Button
                type="button"
                variant={ticketLifetime === '0s' ? 'default' : 'outline'}
                onClick={() => setTicketLifetime('0s')}
                className="flex-1 min-w-[120px]"
              >
                0s
              </Button>
              <Button
                type="button"
                variant={ticketLifetime === '300-600s' ? 'default' : 'outline'}
                onClick={() => setTicketLifetime('300-600s')}
                className="flex-1 min-w-[120px]"
              >
                300-600s
              </Button>
              <Button
                type="button"
                variant={ticketLifetime === '600s' ? 'default' : 'outline'}
                onClick={() => setTicketLifetime('600s')}
                className="flex-1 min-w-[120px]"
              >
                600s
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('vlessDecryption.ticketLifetimeDesc')}</p>
          </div>

          <div className="space-y-2">
            <Label>{t('vlessDecryption.padding')}</Label>
            <Input
              value={padding}
              onChange={(e) => setPadding(e.target.value)}
              placeholder="100-111-1111.75-0-111.50-0-3333"
            />
            <p className="text-xs text-muted-foreground">
              {t('vlessDecryption.paddingDesc')}
            </p>
          </div>

          <Button type="button" onClick={handleGenerate} className="w-full" variant="secondary" disabled={isGenerating}>
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('vlessDecryption.generating')}
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                {t('vlessDecryption.generateConfig')}
              </>
            )}
          </Button>
        </>
      )}

      <div className="space-y-2">
        <Label>{t('vlessDecryption.configValue')}</Label>
        <Input value={value || 'none'} readOnly className="font-mono text-xs" />
        <p className="text-xs text-muted-foreground">
          {mode === 'mlkem768x25519plus'
            ? t('vlessDecryption.configValueDescEncrypted')
            : t('vlessDecryption.configValueDescNone')}
        </p>
      </div>
    </div>
  )
}
