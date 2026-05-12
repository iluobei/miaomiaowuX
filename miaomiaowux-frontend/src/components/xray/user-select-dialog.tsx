// @ts-nocheck
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import type { Field } from '@/lib/xray-form-fields'

interface UserSelectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (users: any[]) => void
  fields: Field[]
  ss2022Method?: string // For Shadowsocks 2022 key generation
}

export function UserSelectDialog({ open, onOpenChange, onSelect, fields, ss2022Method }: UserSelectDialogProps) {
  const { t } = useTranslation('xray')
  const { t: tc } = useTranslation('common')
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    if (open) {
      loadUsers()
      setSelectedUserIds(new Set())
      setSearchTerm('')
    }
  }, [open])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const response = await api.get('/api/admin/users')
      const userData = Array.isArray(response.data) ? response.data : (response.data?.users || [])
      setUsers(userData)
    } catch (error) {
      toast.error(t('userSelect.loadFailed'), {
        description: error.response?.data?.message || error.message,
      })
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  const handleToggleUser = (userId: number) => {
    const newSelection = new Set(selectedUserIds)
    if (newSelection.has(userId)) {
      newSelection.delete(userId)
    } else {
      newSelection.add(userId)
    }
    setSelectedUserIds(newSelection)
  }

  const generateRandomPassword = (length = 16) => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
    let password = ''
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length))
    }
    return password
  }

  // Generate random bytes and encode to Base64 for Shadowsocks 2022
  const generateBase64Key = (byteLength: number): string => {
    const array = new Uint8Array(byteLength)
    crypto.getRandomValues(array)
    let binary = ''
    for (let i = 0; i < array.length; i++) {
      binary += String.fromCharCode(array[i])
    }
    return btoa(binary)
  }

  // Generate Shadowsocks 2022 PSK key
  const generateSS2022Key = () => {
    const method = ss2022Method || '2022-blake3-aes-128-gcm'
    const byteLength = method.includes('128') ? 16 : 32
    return generateBase64Key(byteLength)
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

  const handleConfirm = async () => {
    const usersToUpdate = users.filter((user) =>
      selectedUserIds.has(user.id) && !user.email
    )

    for (const user of usersToUpdate) {
      const generatedEmail = `mmw@${user.username}.me`
      try {
        await api.post('/api/admin/users/update-email', {
          username: user.username,
          email: generatedEmail,
        })
        user.email = generatedEmail
      } catch (error) {
        console.error(`Failed to update email for user ${user.username}:`, error)
        toast.error(t('userSelect.updateEmailFailed', { username: user.username }))
      }
    }

    const selectedUsers = users
      .filter((user) => selectedUserIds.has(user.id))
      .map((user) => {
        const userObj: any = {}

        const hasUserOrIdField = fields.some(f => f.name === 'user' || f.name === 'id')

        fields.forEach((field) => {
          if (field.name === 'id') {
            userObj[field.name] = generateUUID()
          } else if (field.name === 'user') {
            userObj[field.name] = user.username || user.email
          } else if (field.name === 'email') {
            userObj[field.name] = hasUserOrIdField
              ? (user.email || user.username)
              : user.username
          } else if (field.name === 'password' || field.name === 'pass') {
            const isSS2022PskField = field.label?.includes('psk')
            if (isSS2022PskField) {
              userObj[field.name] = generateSS2022Key()
            } else {
              userObj[field.name] = generateRandomPassword()
            }
          } else {
            userObj[field.name] = field.defaultValue ?? ''
          }
        })
        return userObj
      })

    onSelect(selectedUsers)
  }

  const filteredUsers = users.filter((user) => {
    const searchLower = searchTerm.toLowerCase()
    return (
      user.email?.toLowerCase().includes(searchLower) ||
      user.username?.toLowerCase().includes(searchLower)
    )
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('userSelect.title')}</DialogTitle>
          <DialogDescription>{t('userSelect.desc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          <div className="space-y-2">
            <Label>{t('userSelect.searchUser')}</Label>
            <Input
              placeholder={t('userSelect.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex-1 overflow-y-auto border rounded-lg p-4">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t('userSelect.loading')}</p>
            ) : filteredUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {searchTerm ? t('userSelect.noMatch') : t('userSelect.noUsers')}
              </p>
            ) : (
              <div className="space-y-2">
                {filteredUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center space-x-2 p-3 border rounded hover:bg-gray-50 cursor-pointer"
                    onClick={() => handleToggleUser(user.id)}
                  >
                    <Checkbox
                      checked={selectedUserIds.has(user.id)}
                      onCheckedChange={() => handleToggleUser(user.id)}
                    />
                    <div className="flex-1 flex items-center gap-2">
                      <span className="font-medium">{user.username}</span>
                      {user.email && (
                        <span className="text-sm text-muted-foreground">({user.email})</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            {t('userSelect.selectedCount', { count: selectedUserIds.size })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('actions.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={selectedUserIds.size === 0}>
            {t('userSelect.confirmAdd')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
