// @ts-nocheck
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Trash2, UserPlus } from 'lucide-react'
import { FormField } from './form-field'
import { UserSelectDialog } from './user-select-dialog'
import type { Field } from '@/lib/xray-form-fields'

interface ArrayFieldProps {
  label: string
  fields: Field[]
  values: any[]
  onChange: (values: any[]) => void
  addButtonText?: string
  required?: boolean
  showUserSelect?: boolean // 是否显示选择用户按钮
  ss2022Method?: string // For Shadowsocks 2022 key generation
}

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function ArrayField({
  label,
  fields,
  values = [],
  onChange,
  addButtonText = '添加',
  required = false,
  showUserSelect = false,
  ss2022Method,
}: ArrayFieldProps) {
  const [showSelectDialog, setShowSelectDialog] = useState(false)

  const handleAdd = () => {
    const newItem = fields.reduce((acc, field) => {
      if (field.name === 'id') {
        acc[field.name] = field.defaultValue ?? generateUUID()
      } else {
        acc[field.name] = field.defaultValue ?? ''
      }
      return acc
    }, {} as any)
    onChange([...values, newItem])
  }

  const handleSelectUsers = (selectedUsers: any[]) => {
    const existingKeys = new Set(
      values.map((v) => v.id || v.user || v.password).filter(Boolean)
    )
    const newUsers = selectedUsers.filter(
      (u) => !existingKeys.has(u.id || u.user || u.password)
    )
    onChange([...values, ...newUsers])
    setShowSelectDialog(false)
  }

  const handleRemove = (index: number) => {
    const newValues = values.filter((_, i) => i !== index)
    onChange(newValues)
  }

  const handleItemChange = (index: number, fieldName: string, value: any) => {
    const newValues = [...values]
    newValues[index] = { ...newValues[index], [fieldName]: value }

    // 如果修改的是用户名或ID字段，且email为空，则自动填充email
    // 注意：对于只有password字段的协议（如Trojan），不会触发此逻辑
    if ((fieldName === 'user' || fieldName === 'id') && value) {
      const hasEmailField = fields.some(f => f.name === 'email')
      if (hasEmailField && !newValues[index].email) {
        newValues[index].email = value
      }
    }

    onChange(newValues)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </h4>
        <div className="flex gap-2">
          {showUserSelect && (
            <Button type="button" size="sm" onClick={() => setShowSelectDialog(true)} variant="outline">
              <UserPlus className="h-4 w-4 mr-1" />
              选择用户
            </Button>
          )}
          <Button type="button" size="sm" onClick={handleAdd} variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            {addButtonText}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {values.length === 0 && (
          <p className="text-sm text-muted-foreground">暂无{label}，点击上方按钮添加</p>
        )}

        {values.map((item, index) => (
          <Card key={index}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  {label} #{index + 1}
                </CardTitle>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemove(index)}
                  className="h-8 w-8 p-0"
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {fields.map((field) => (
                <FormField
                  key={field.name}
                  field={field}
                  value={item[field.name]}
                  onChange={(value) => handleItemChange(index, field.name, value)}
                  ss2022Method={ss2022Method}
                />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {showUserSelect && (
        <UserSelectDialog
          open={showSelectDialog}
          onOpenChange={setShowSelectDialog}
          onSelect={handleSelectUsers}
          fields={fields}
          ss2022Method={ss2022Method}
        />
      )}
    </div>
  )
}
