// @ts-nocheck
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Wand2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface KeyGeneratorFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  description?: string
  placeholder?: string
  onPublicKeyGenerated?: (publicKey: string) => void  // Callback for generated public key
}

export function KeyGeneratorField({ label, value, onChange, description, placeholder, onPublicKeyGenerated }: KeyGeneratorFieldProps) {
  const { t } = useTranslation('xray')
  const [isGenerating, setIsGenerating] = useState(false)

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      // Call backend API to generate x25519 private key
      const response = await api.post('/api/admin/xray/generate-x25519')

      const privateKey = response.data.privateKey
      const publicKey = response.data.publicKey

      onChange(privateKey)

      // If callback provided, send public key to parent
      if (onPublicKeyGenerated && publicKey) {
        onPublicKeyGenerated(publicKey)
      }

      toast.success(t('keyGenerator.keyGenSuccess'), {
        description: onPublicKeyGenerated ? t('keyGenerator.keyGenSuccessDescBoth') : t('keyGenerator.keyGenSuccessDescKey'),
      })
    } catch (error) {
      toast.error(t('keyGenerator.keyGenFailed'), {
        description: error.response?.data || error.message || t('keyGenerator.keyGenFailedDesc'),
      })
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || 'xray x25519'}
          className="flex-1"
        />
        <Button
          type="button"
          onClick={handleGenerate}
          variant="outline"
          size="icon"
          disabled={isGenerating}
          className="shrink-0"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
        </Button>
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
