// @ts-nocheck
import { useState } from 'react'
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

      // Format: mlkem768x25519plus.[appearance].[ticket-lifetime].[padding]...[keys]
      const config = response.data.decryptionConfig
      const encryption = response.data.encryption

      onChange(config)

      // Call callback to pass encryption to parent
      if (onEncryptionGenerated) {
        onEncryptionGenerated(encryption)
      }

      toast.success('密钥生成成功', {
        description: '已自动填入配置字符串',
      })
    } catch (error) {
      toast.error('生成失败', {
        description: error.response?.data || error.message || '无法生成密钥，请确保服务器已安装 Xray',
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
        <Label>解密方式</Label>
        <div className="flex flex-wrap gap-2 md:gap-3">
          <Button
            type="button"
            variant={mode === 'none' ? 'default' : 'outline'}
            onClick={() => handleModeChange('none')}
            className="flex-1 min-w-[120px]"
          >
            none (无加密)
          </Button>
          <Button
            type="button"
            variant={mode === 'mlkem768x25519plus' ? 'default' : 'outline'}
            onClick={() => handleModeChange('mlkem768x25519plus')}
            className="flex-1 min-w-[120px]"
          >
            加密
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">VLESS解密方式，支持后量子加密</p>
      </div>

      {mode === 'mlkem768x25519plus' && (
        <>
          <div className="space-y-2">
            <Label>加密类型</Label>
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
              {encryptionType === 'x25519' && 'Authentication: X25519, not Post-Quantum (传统加密)'}
              {encryptionType === 'mlkem768' && 'Authentication: ML-KEM-768, Post-Quantum (后量子安全) ✅'}
            </p>
          </div>

          <div className="space-y-2">
            <Label>流量外观 (Appearance)</Label>
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
              {appearance === 'native' && '公钥特征在头部可见，TLSv1.3 AEAD模式可识别'}
              {appearance === 'xorpub' && 'XOR混淆公钥特征'}
              {appearance === 'random' && '完全随机化流量外观 (6/10,000开销)'}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Ticket生命周期</Label>
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
            <p className="text-xs text-muted-foreground">0-RTT ticket重用时间设置</p>
          </div>

          <div className="space-y-2">
            <Label>填充配置 (Padding)</Label>
            <Input
              value={padding}
              onChange={(e) => setPadding(e.target.value)}
              placeholder="100-111-1111.75-0-111.50-0-3333"
            />
            <p className="text-xs text-muted-foreground">
              防指纹填充配置，格式: 概率-长度-间隔序列
            </p>
          </div>

          <Button type="button" onClick={handleGenerate} className="w-full" variant="secondary" disabled={isGenerating}>
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                正在生成密钥...
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                生成解密配置
              </>
            )}
          </Button>
        </>
      )}

      <div className="space-y-2">
        <Label>Decryption 配置值</Label>
        <Input value={value || 'none'} readOnly className="font-mono text-xs" />
        <p className="text-xs text-muted-foreground">
          {mode === 'mlkem768x25519plus'
            ? '点击生成按钮自动生成后量子加密配置'
            : '无加密配置'}
        </p>
      </div>
    </div>
  )
}
