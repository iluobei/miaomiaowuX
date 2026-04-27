// @ts-nocheck
import { useState, useEffect } from 'react'
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
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')

  // 加载用户列表
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
      // 调用API获取用户列表
      const response = await api.get('/api/admin/users')
      // 确保返回的是数组
      const userData = Array.isArray(response.data) ? response.data : (response.data?.users || [])
      setUsers(userData)
    } catch (error) {
      toast.error('加载用户失败', {
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

  // 生成随机密码
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
    // 检查并更新缺少邮箱的用户
    const usersToUpdate = users.filter((user) =>
      selectedUserIds.has(user.id) && !user.email
    )

    // 为没有邮箱的用户生成邮箱并保存
    for (const user of usersToUpdate) {
      const generatedEmail = `mmw@${user.username}.me`
      try {
        await api.post('/api/admin/users/update-email', {
          username: user.username,
          email: generatedEmail,
        })
        // 更新本地用户数据
        user.email = generatedEmail
      } catch (error) {
        console.error(`Failed to update email for user ${user.username}:`, error)
        toast.error(`无法为用户 ${user.username} 更新邮箱`)
      }
    }

    const selectedUsers = users
      .filter((user) => selectedUserIds.has(user.id))
      .map((user) => {
        // 根据fields构建用户对象
        const userObj: any = {}

        // 检查是否有用户名或ID字段（用于判断是否是Trojan等只有密码的协议）
        const hasUserOrIdField = fields.some(f => f.name === 'user' || f.name === 'id')

        fields.forEach((field) => {
          // 映射用户数据到字段
          if (field.name === 'id') {
            userObj[field.name] = generateUUID()
          } else if (field.name === 'user') {
            // 对于需要用户名的协议（如Socks5/HTTP）
            userObj[field.name] = user.username || user.email
          } else if (field.name === 'email') {
            // 如果没有user/id字段（如Trojan），使用用户名作为email
            // 如果有user/id字段，优先使用用户的email，如果没有则使用用户名
            userObj[field.name] = hasUserOrIdField
              ? (user.email || user.username)
              : user.username
          } else if (field.name === 'password' || field.name === 'pass') {
            // Check if this is a Shadowsocks 2022 PSK field
            const isSS2022PskField = field.label?.includes('PSK')
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

  // 过滤用户
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
          <DialogTitle>选择用户</DialogTitle>
          <DialogDescription>从用户列表中选择要添加的用户</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* 搜索框 */}
          <div className="space-y-2">
            <Label>搜索用户</Label>
            <Input
              placeholder="输入邮箱或用户名搜索"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* 用户列表 */}
          <div className="flex-1 overflow-y-auto border rounded-lg p-4">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">加载中...</p>
            ) : filteredUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {searchTerm ? '未找到匹配的用户' : '暂无用户'}
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
            已选择 {selectedUserIds.size} 个用户
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={selectedUserIds.size === 0}>
            确认添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
