// @ts-nocheck
import { useState } from 'react'
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

      toast.success('密钥生成成功', {
        description: onPublicKeyGenerated ? '已自动填入私钥和公钥' : '已自动填入私钥',
      })
    } catch (error) {
      toast.error('生成失败', {
        description: error.response?.data || error.message || '无法生成密钥，请确保服务器已安装 Xray',
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
          placeholder={placeholder || '执行 xray x25519 生成'}
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
