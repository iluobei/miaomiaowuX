// @ts-nocheck
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { KeyGeneratorField } from './key-generator-field'
import { RefreshCw, Wand2 } from 'lucide-react'
import type { Field } from '@/lib/xray-form-fields'

interface FormFieldProps {
  field: Field
  value: any
  onChange: (value: any) => void
  error?: string
  onPublicKeyGenerated?: (publicKey: string) => void
  // For Shadowsocks2022, we need to know the method to generate correct key length
  ss2022Method?: string
}

// Generate random bytes and encode to Base64
function generateBase64Key(byteLength: number): string {
  const array = new Uint8Array(byteLength)
  crypto.getRandomValues(array)
  // Convert to base64
  let binary = ''
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i])
  }
  return btoa(binary)
}

export function FormField({ field, value, onChange, error, onPublicKeyGenerated, ss2022Method }: FormFieldProps) {
  // Check if this is a Shadowsocks 2022 PSK field
  // Identify by field name and label containing PSK
  const isSS2022PskField = field.generateKey && field.type === 'password' &&
    (field.name === 'serverPassword' || field.name === 'password') &&
    field.label?.includes('PSK')

  // If field has generateKey flag and is for x25519, use KeyGeneratorField
  if (field.generateKey && field.type === 'password' && !isSS2022PskField) {
    return (
      <KeyGeneratorField
        label={field.label}
        value={value || ''}
        onChange={onChange}
        description={field.description}
        placeholder={field.placeholder}
        onPublicKeyGenerated={onPublicKeyGenerated}
      />
    )
  }

  // 生成随机密码
  const generateRandomPassword = (length = 16) => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
    let password = ''
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length))
    }
    return password
  }

  // Generate Shadowsocks 2022 PSK key
  const generateSS2022Key = () => {
    // Determine key length based on method
    // aes-128-gcm needs 16 bytes, aes-256-gcm/chacha20 needs 32 bytes
    const method = ss2022Method || '2022-blake3-aes-128-gcm'
    const byteLength = method.includes('128') ? 16 : 32
    return generateBase64Key(byteLength)
  }

  const renderField = () => {
    switch (field.type) {
      case 'host-port':
        // Parse current value into host and port
        const parts = (value || '').split(':')
        const host = parts[0] || ''
        const port = parts[1] || field.defaultPort || 443

        return (
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder={field.placeholder}
              value={host}
              onChange={(e) => onChange(`${e.target.value}:${port}`)}
              className={error ? 'border-red-500 flex-1' : 'flex-1'}
            />
            <Input
              type="number"
              placeholder="443"
              value={port}
              onChange={(e) => onChange(`${host}:${e.target.value}`)}
              className={error ? 'border-red-500 w-24' : 'w-24'}
              min={1}
              max={65535}
            />
          </div>
        )

      case 'text':
        return (
          <Input
            type={field.type}
            placeholder={field.placeholder}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className={error ? 'border-red-500' : ''}
          />
        )

      case 'password':
        // Special handling for Shadowsocks 2022 PSK fields
        if (isSS2022PskField) {
          return (
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder={field.placeholder}
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                className={error ? 'border-red-500 flex-1 font-mono text-sm' : 'flex-1 font-mono text-sm'}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => onChange(generateSS2022Key())}
                title="生成 Base64 PSK 密钥"
              >
                <Wand2 className="h-4 w-4" />
              </Button>
            </div>
          )
        }
        return (
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder={field.placeholder}
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              className={error ? 'border-red-500' : ''}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onChange(generateRandomPassword())}
              title="生成随机密码"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        )

      case 'number':
        return (
          <Input
            type="number"
            placeholder={field.placeholder}
            value={value || ''}
            onChange={(e) => onChange(e.target.valueAsNumber || '')}
            min={field.min}
            max={field.max}
            className={error ? 'border-red-500' : ''}
          />
        )

      case 'textarea':
        return (
          <Textarea
            placeholder={field.placeholder}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className={error ? 'border-red-500' : ''}
            rows={3}
          />
        )

      case 'select':
        // Render as radio buttons if renderAs is 'radio'
        if (field.renderAs === 'radio') {
          const currentValue = value || field.defaultValue
          return (
            <div className="flex flex-wrap gap-2">
              {field.options?.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={currentValue === String(option.value) ? 'default' : 'outline'}
                  onClick={() => onChange(String(option.value))}
                  className="whitespace-nowrap"
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )
        }
        // Default dropdown rendering
        return (
          <Select value={value || field.defaultValue} onValueChange={onChange}>
            <SelectTrigger className={error ? 'border-red-500' : ''}>
              <SelectValue placeholder={field.placeholder || '请选择'} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case 'checkbox':
        return (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={field.name}
              checked={value ?? field.defaultValue ?? false}
              onCheckedChange={onChange}
            />
            <Label htmlFor={field.name} className="text-sm font-normal cursor-pointer">
              {field.label}
            </Label>
          </div>
        )

      default:
        return null
    }
  }

  if (field.type === 'checkbox') {
    return (
      <div className="space-y-1">
        {renderField()}
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={field.name}>
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      {renderField()}
      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
