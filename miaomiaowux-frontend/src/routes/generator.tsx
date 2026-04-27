import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import yaml from 'js-yaml'
import {
  Loader2,
  Save,
  Layers,
  MapPin,
  Plus,
  Eye,
  Pencil,
  Trash2,
  Settings,
  FileText,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import {
  validateClashConfig,
  formatValidationIssues,
} from '@/lib/clash-validator'
import {
  extractRegionFromNodeName,
  findRegionGroupName,
} from '@/lib/country-flag'
import {
  collectMissingRuleTargets,
  extractProxyGroupNames,
  replaceMissingRuleTargets,
} from '@/lib/rules-node-replacement'
import { ClashConfigBuilder } from '@/lib/sublink/clash-builder'
import type { PredefinedRuleSetType, CustomRule } from '@/lib/sublink/types'
import type { ProxyConfig } from '@/lib/sublink/types'
import {
  ACL4SSR_PRESETS,
  Aethersailor_PRESETS,
  ALL_TEMPLATE_PRESETS,
  type ACL4SSRPreset,
} from '@/lib/template-presets'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useProxyGroupCategories } from '@/hooks/use-proxy-groups'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { CustomRulesEditor } from '@/components/custom-rules-editor'
import { DataTable } from '@/components/data-table'
import type { DataTableColumn } from '@/components/data-table'
import { EditNodesDialog } from '@/components/edit-nodes-dialog'
import { Topbar } from '@/components/layout/topbar'
import { MissingNodesReplaceDialog } from '@/components/missing-nodes-replace-dialog'
import { MobileEditNodesDialog } from '@/components/mobile-edit-nodes-dialog'
import { RuleSelector } from '@/components/rule-selector'
import { Twemoji } from '@/components/twemoji'

// 代理集合配置类型
interface ProxyProviderConfig {
  id: number
  name: string
  type: string
  interval: number
  proxy: string
  health_check_enabled: boolean
  health_check_url: string
  health_check_interval: number
  health_check_timeout: number
  health_check_lazy: boolean
  process_mode: string
}

// YAML dump 配置：使用双引号风格
const YAML_DUMP_OPTIONS: yaml.DumpOptions = {
  lineWidth: -1,
  noRefs: true,
  quotingType: '"', // 使用双引号而不是单引号
}

// 预处理 YAML 字符串，将以 [ 或 { 开头的未引用值用引号包裹，避免解析错误
function preprocessYaml(yamlStr: string): string {
  // 匹配 "key: [xxx" 或 "key: {xxx" 格式（值以 [ 或 { 开头但不是有效的 YAML 数组/对象）
  // 排除已经被引号包裹的值
  return yamlStr.replace(
    /^(\s*[\w-]+:\s*)(\[[^\]]*[^\],\s\d][^\]]*\]?)$/gm,
    (match, prefix, value) => {
      // 检查是否是有效的 YAML 数组格式（如 [a, b, c] 或 [1, 2, 3]）
      // 如果看起来像节点名称（包含中文或特殊字符），则加引号
      if (
        /[\u4e00-\u9fa5]/.test(value) ||
        /\[[^\[\]]*[^\],\s\w.-][^\[\]]*\]?/.test(value)
      ) {
        return `${prefix}"${value.replace(/"/g, '\\"')}"`
      }
      return match
    }
  )
}

// 协议颜色映射
const PROTOCOL_COLORS: Record<string, string> = {
  vmess: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  vless: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  trojan: 'bg-red-500/10 text-red-700 dark:text-red-400',
  ss: 'bg-green-500/10 text-green-700 dark:text-green-400',
  socks5: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  hysteria: 'bg-pink-500/10 text-pink-700 dark:text-pink-400',
  hysteria2: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
  tuic: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  anytls: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
  wireguard: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
}

// 获取协议颜色（支持链式代理）
function getProtocolColor(protocol: string): string {
  const normalizedProtocol = protocol.toLowerCase().split('⇋')[0].trim()
  return PROTOCOL_COLORS[normalizedProtocol] || ''
}

// 确保 short-id 字段始终作为字符串处理
function ensureShortIdAsString(obj: any): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(ensureShortIdAsString)
  }

  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'short-id') {
      // 强制转换为字符串
      if (value === null || value === undefined) {
        result[key] = ''
      } else if (typeof value === 'string') {
        result[key] = value
      } else {
        // 数字等其他类型转为字符串
        result[key] = String(value)
      }
    } else if (typeof value === 'object' && value !== null) {
      result[key] = ensureShortIdAsString(value)
    } else {
      result[key] = value
    }
  }
  return result
}

// 修复 YAML 中的 short-id 值，确保始终有双引号
function fixShortIdInYaml(yamlStr: string): string {
  let result = yamlStr
  // 1. 将 short-id: '' (单引号空字符串) 替换为 short-id: ""
  result = result.replace(
    /^([ \t]*)short-id:[ \t]*''[ \t]*$/gm,
    '$1short-id: ""'
  )
  // 2. 将 short-id: 后面没有值的行替换为 short-id: ""
  result = result.replace(/^([ \t]*)short-id:[ \t]*$/gm, '$1short-id: ""')
  // 3. 将 short-id: 'value' (单引号非空值) 替换为 short-id: "value"
  result = result.replace(
    /^([ \t]*)short-id:[ \t]*'([^']*)'[ \t]*$/gm,
    '$1short-id: "$2"'
  )
  // 4. 将 short-id: value (无引号值，如纯数字) 替换为 short-id: "value"
  result = result.replace(
    /^([ \t]*)short-id:[ \t]+([^"'\s][^\s]*)[ \t]*$/gm,
    '$1short-id: "$2"'
  )
  return result
}

// 重新排序代理节点字段，将 name, type, server, port 放在最前面
function reorderProxyFields(proxy: ProxyConfig): ProxyConfig {
  const ordered: any = {}
  const priorityKeys = ['name', 'type', 'server', 'port']

  // 先添加优先字段
  for (const key of priorityKeys) {
    if (key in proxy) {
      ordered[key] = (proxy as any)[key]
    }
  }

  // 再添加其他字段
  for (const [key, value] of Object.entries(proxy)) {
    if (!priorityKeys.includes(key)) {
      ordered[key] = value
    }
  }

  return ordered as ProxyConfig
}

type SavedNode = {
  id: number
  raw_url: string
  node_name: string
  protocol: string
  parsed_config: string
  clash_config: string
  enabled: boolean
  tag: string
  created_at: string
  updated_at: string
}

// 模板类型定义
interface Template {
  id: number
  name: string
  category: 'clash' | 'surge'
  template_url: string
  rule_source: string
  use_proxy: boolean
  enable_include_all: boolean
  created_at: string
  updated_at: string
}

type TemplateFormData = Omit<Template, 'id' | 'created_at' | 'updated_at'>

export const Route = createFileRoute('/generator')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/login' })
    }
  },
  component: SubscriptionGeneratorPage,
})

function SubscriptionGeneratorPage() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [ruleSet, setRuleSet] = useState<PredefinedRuleSetType>('balanced')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [customRules, setCustomRules] = useState<CustomRule[]>([])
  const [loading, setLoading] = useState(false)
  const [clashConfig, setClashConfig] = useState('')
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<number>>(new Set())
  const [selectedProtocols, setSelectedProtocols] = useState<Set<string>>(
    new Set()
  )

  // Fetch proxy group categories for ClashConfigBuilder
  const { data: proxyGroupCategories } = useProxyGroupCategories()
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())

  // 规则模式状态
  const [ruleMode, setRuleMode] = useState<'custom' | 'template'>('custom')
  const [selectedTemplateUrl, setSelectedTemplateUrl] = useState<string>('')
  const [hasManuallyGrouped, setHasManuallyGrouped] = useState(false)

  // 模板管理对话框状态
  const [templateManageDialogOpen, setTemplateManageDialogOpen] =
    useState(false)
  const [isTemplateFormDialogOpen, setIsTemplateFormDialogOpen] =
    useState(false)
  const [isTemplateDeleteDialogOpen, setIsTemplateDeleteDialogOpen] =
    useState(false)
  const [isTemplatePreviewDialogOpen, setIsTemplatePreviewDialogOpen] =
    useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(
    null
  )
  const [templatePreviewContent, setTemplatePreviewContent] = useState('')
  const [isTemplatePreviewLoading, setIsTemplatePreviewLoading] =
    useState(false)
  const [isSourcePreviewDialogOpen, setIsSourcePreviewDialogOpen] =
    useState(false)
  const [sourcePreviewContent, setSourcePreviewContent] = useState('')
  const [isSourcePreviewLoading, setIsSourcePreviewLoading] = useState(false)
  const [sourcePreviewTitle, setSourcePreviewTitle] = useState('')
  const [templateFormData, setTemplateFormData] = useState<TemplateFormData>({
    name: '',
    category: 'clash',
    template_url: '',
    rule_source: '',
    use_proxy: false,
    enable_include_all: true,
  })

  // 旧模板系统管理状态
  const [oldTemplateManageDialogOpen, setOldTemplateManageDialogOpen] =
    useState(false)
  const [oldTemplateEditDialogOpen, setOldTemplateEditDialogOpen] =
    useState(false)
  const [editingOldTemplate, setEditingOldTemplate] = useState<string | null>(
    null
  )
  const [oldTemplateContent, setOldTemplateContent] = useState('')
  const [isOldTemplateLoading, setIsOldTemplateLoading] = useState(false)
  const [deletingOldTemplate, setDeletingOldTemplate] = useState<string | null>(
    null
  )
  const [isOldTemplateDeleteDialogOpen, setIsOldTemplateDeleteDialogOpen] =
    useState(false)
  const [isOldTemplateRenameDialogOpen, setIsOldTemplateRenameDialogOpen] =
    useState(false)
  const [renamingOldTemplate, setRenamingOldTemplate] = useState<string | null>(
    null
  )
  const [newOldTemplateName, setNewOldTemplateName] = useState('')

  // 保存订阅对话框状态
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [subscribeName, setSubscribeName] = useState('')
  const [subscribeFilename, setSubscribeFilename] = useState('')
  const [subscribeDescription, setSubscribeDescription] = useState('')

  // 手动分组对话框状态
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [proxyGroups, setProxyGroups] = useState<ProxyGroup[]>([])
  const [allProxies, setAllProxies] = useState<string[]>([])
  const [showAllNodes, setShowAllNodes] = useState(false) // 默认隐藏已添加节点

  // 缺失节点替换对话框状态
  const [missingNodesDialogOpen, setMissingNodesDialogOpen] = useState(false)
  const [missingNodes, setMissingNodes] = useState<string[]>([])
  const [replacementChoice, setReplacementChoice] = useState<string>('DIRECT')
  const [pendingConfigAfterGrouping, setPendingConfigAfterGrouping] =
    useState<string>('')
  const missingNodeReplacementOptions = useMemo(() => {
    if (!pendingConfigAfterGrouping) {
      return []
    }
    try {
      const parsedConfig = yaml.load(preprocessYaml(pendingConfigAfterGrouping))
      return extractProxyGroupNames(parsedConfig)
    } catch {
      return []
    }
  }, [pendingConfigAfterGrouping])

  // 获取用户配置
  const { data: userConfig } = useQuery({
    queryKey: ['user-config'],
    queryFn: async () => {
      const response = await api.get('/api/user/config')
      return response.data as {
        use_new_template_system: boolean
        enable_proxy_provider: boolean
        node_order?: number[]
      }
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const useNewTemplateSystem = userConfig?.use_new_template_system !== false // 默认 true
  const enableProxyProvider = userConfig?.enable_proxy_provider ?? false

  // 获取已保存的节点
  const { data: nodesData } = useQuery({
    queryKey: ['nodes'],
    queryFn: async () => {
      const response = await api.get('/api/admin/nodes')
      return response.data as { nodes: SavedNode[] }
    },
    enabled: Boolean(auth.accessToken),
  })

  // 获取数据库模板列表（新模板系统）
  const { data: dbTemplates = [] } = useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: async () => {
      const response = await api.get('/api/admin/templates')
      return response.data.templates || []
    },
    enabled: Boolean(auth.accessToken) && useNewTemplateSystem,
  })

  // 获取旧模板列表（旧模板系统）
  const { data: oldTemplates = [] } = useQuery<string[]>({
    queryKey: ['rule-templates'],
    queryFn: async () => {
      const response = await api.get('/api/admin/rule-templates')
      return response.data.templates || []
    },
    enabled: Boolean(auth.accessToken) && !useNewTemplateSystem,
  })

  // 获取代理集合配置列表
  const { data: proxyProviderConfigsData } = useQuery({
    queryKey: ['proxy-provider-configs'],
    queryFn: async () => {
      const response = await api.get('/api/user/proxy-provider-configs')
      return response.data as ProxyProviderConfig[]
    },
    enabled: Boolean(auth.accessToken) && enableProxyProvider,
  })
  const proxyProviderConfigs = proxyProviderConfigsData ?? []

  // 获取用户订阅 token（用于代理集合 URL）
  const { data: userTokenData } = useQuery({
    queryKey: ['user-token'],
    queryFn: async () => {
      const response = await api.get('/api/user/token')
      return response.data as { token: string }
    },
    enabled: Boolean(auth.accessToken),
  })
  const userToken = userTokenData?.token ?? ''

  const savedNodes = nodesData?.nodes ?? []
  const enabledNodes = savedNodes.filter((n) => n.enabled)

  // 按节点管理的排序顺序排列
  const sortedEnabledNodes = useMemo(() => {
    if (!userConfig?.node_order || userConfig.node_order.length === 0) {
      return enabledNodes
    }

    const orderMap = new Map<number, number>()
    userConfig.node_order.forEach((id, index) => orderMap.set(id, index))

    return [...enabledNodes].sort((a, b) => {
      const aOrder = orderMap.get(a.id) ?? Infinity
      const bOrder = orderMap.get(b.id) ?? Infinity
      return aOrder - bOrder
    })
  }, [enabledNodes, userConfig?.node_order])

  // 合并后台模板和预设模板（后台模板放在最前面）
  const allTemplates = useMemo(() => {
    if (useNewTemplateSystem) {
      // 新模板系统：数据库模板 + 预设模板
      const dbTemplateItems: ACL4SSRPreset[] = dbTemplates.map((t) => ({
        name: `db-${t.id}`,
        url: t.rule_source,
        label: t.name,
      }))
      return [...dbTemplateItems, ...ALL_TEMPLATE_PRESETS]
    } else {
      // 旧模板系统：从 rule_templates 目录读取的 YAML 文件
      return oldTemplates.map((filename) => ({
        name: filename,
        url: `/api/admin/rule-templates/${filename}`,
        label: filename.replace(/\.(yaml|yml)$/, ''),
      }))
    }
  }, [dbTemplates, oldTemplates, useNewTemplateSystem])

  // 默认选择第一个模板
  useEffect(() => {
    if (
      ruleMode === 'template' &&
      allTemplates.length > 0 &&
      !selectedTemplateUrl
    ) {
      setSelectedTemplateUrl(allTemplates[0].url)
    }
  }, [ruleMode, selectedTemplateUrl, allTemplates])

  // 创建模板 mutation
  const createTemplateMutation = useMutation({
    mutationFn: async (template: TemplateFormData) => {
      const response = await api.post('/api/admin/templates', template)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      setIsTemplateFormDialogOpen(false)
      resetTemplateForm()
      toast.success('模板已创建')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '创建模板时出错')
    },
  })

  // 更新模板 mutation
  const updateTemplateMutation = useMutation({
    mutationFn: async ({
      id,
      ...template
    }: TemplateFormData & { id: number }) => {
      const response = await api.put(`/api/admin/templates/${id}`, template)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      setIsTemplateFormDialogOpen(false)
      resetTemplateForm()
      toast.success('模板已更新')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '更新模板时出错')
    },
  })

  // 删除模板 mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/admin/templates/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      setIsTemplateDeleteDialogOpen(false)
      setDeletingTemplateId(null)
      toast.success('模板已删除')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '删除模板时出错')
    },
  })

  // 旧模板更新 mutation
  const updateOldTemplateMutation = useMutation({
    mutationFn: async ({
      filename,
      content,
    }: {
      filename: string
      content: string
    }) => {
      await api.put(`/api/admin/rule-templates/${filename}`, { content })
    },
    onSuccess: () => {
      setOldTemplateEditDialogOpen(false)
      setEditingOldTemplate(null)
      setOldTemplateContent('')
      toast.success('模板已保存')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '保存模板时出错')
    },
  })

  // 旧模板删除 mutation
  const deleteOldTemplateMutation = useMutation({
    mutationFn: async (filename: string) => {
      await api.delete(`/api/admin/rule-templates/${filename}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rule-templates'] })
      setIsOldTemplateDeleteDialogOpen(false)
      setDeletingOldTemplate(null)
      toast.success('模板已删除')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '删除模板时出错')
    },
  })

  // 旧模板上传 mutation
  const uploadOldTemplateMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('template', file)
      const response = await api.post(
        '/api/admin/rule-templates/upload',
        formData
      )
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['rule-templates'] })
      toast.success(`模板 ${data.filename} 上传成功`)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '上传模板时出错')
    },
  })

  // 旧模板重命名 mutation
  const renameOldTemplateMutation = useMutation({
    mutationFn: async ({
      oldName,
      newName,
    }: {
      oldName: string
      newName: string
    }) => {
      const response = await api.post('/api/admin/rule-templates/rename', {
        old_name: oldName,
        new_name: newName,
      })
      return response.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['rule-templates'] })
      setIsOldTemplateRenameDialogOpen(false)
      setRenamingOldTemplate(null)
      setNewOldTemplateName('')
      toast.success(`模板已重命名为 ${data.filename}`)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '重命名模板时出错')
    },
  })

  // 重置模板表单
  const resetTemplateForm = () => {
    setTemplateFormData({
      name: '',
      category: 'clash',
      template_url: '',
      rule_source: '',
      use_proxy: false,
      enable_include_all: true,
    })
    setEditingTemplate(null)
  }

  // 模板管理相关函数
  const handleCreateTemplate = () => {
    resetTemplateForm()
    setIsTemplateFormDialogOpen(true)
  }

  const handleEditTemplate = (template: Template) => {
    setEditingTemplate(template)
    setTemplateFormData({
      name: template.name,
      category: template.category,
      template_url: template.template_url,
      rule_source: template.rule_source,
      use_proxy: template.use_proxy,
      enable_include_all: template.enable_include_all,
    })
    setIsTemplateFormDialogOpen(true)
  }

  const handleDeleteTemplate = (id: number) => {
    setDeletingTemplateId(id)
    setIsTemplateDeleteDialogOpen(true)
  }

  // 旧模板管理函数
  const handleEditOldTemplate = async (filename: string) => {
    setEditingOldTemplate(filename)
    setIsOldTemplateLoading(true)
    setOldTemplateEditDialogOpen(true)

    try {
      const response = await api.get(`/api/admin/rule-templates/${filename}`)
      setOldTemplateContent(response.data.content || '')
    } catch (error: any) {
      toast.error(error.response?.data?.error || '获取模板内容失败')
      setOldTemplateEditDialogOpen(false)
    } finally {
      setIsOldTemplateLoading(false)
    }
  }

  const handleSaveOldTemplate = () => {
    if (!editingOldTemplate) return
    updateOldTemplateMutation.mutate({
      filename: editingOldTemplate,
      content: oldTemplateContent,
    })
  }

  const handleDeleteOldTemplate = (filename: string) => {
    setDeletingOldTemplate(filename)
    setIsOldTemplateDeleteDialogOpen(true)
  }

  const handleUploadOldTemplate = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.yaml,.yml'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        uploadOldTemplateMutation.mutate(file)
      }
    }
    input.click()
  }

  const handleRenameOldTemplate = (filename: string) => {
    setRenamingOldTemplate(filename)
    // 去掉扩展名作为默认值
    setNewOldTemplateName(filename.replace(/\.(yaml|yml)$/, ''))
    setIsOldTemplateRenameDialogOpen(true)
  }

  const handleConfirmRenameOldTemplate = () => {
    if (!renamingOldTemplate || !newOldTemplateName.trim()) return
    renameOldTemplateMutation.mutate({
      oldName: renamingOldTemplate,
      newName: newOldTemplateName.trim(),
    })
  }

  const handlePreviewTemplate = async (template: Template) => {
    if (!template.rule_source) {
      toast.error('请先配置规则源')
      return
    }

    setIsTemplatePreviewLoading(true)
    setIsTemplatePreviewDialogOpen(true)

    try {
      const response = await api.post('/api/admin/templates/convert', {
        template_url: template.template_url,
        rule_source: template.rule_source,
        category: template.category,
        use_proxy: template.use_proxy,
        enable_include_all: template.enable_include_all,
      })
      setTemplatePreviewContent(response.data.content)
    } catch (error: any) {
      toast.error(error.response?.data?.error || '生成预览时出错')
      setIsTemplatePreviewDialogOpen(false)
    } finally {
      setIsTemplatePreviewLoading(false)
    }
  }

  const handlePreviewSource = async (template: Template) => {
    if (!template.rule_source) {
      toast.error('请先配置规则源')
      return
    }

    setIsSourcePreviewLoading(true)
    setIsSourcePreviewDialogOpen(true)
    setSourcePreviewTitle(template.name)

    try {
      // 通过后端代理获取源文件内容
      const response = await api.post('/api/admin/templates/fetch-source', {
        url: template.rule_source,
        use_proxy: template.use_proxy,
      })
      setSourcePreviewContent(response.data.content)
    } catch (error: any) {
      toast.error(error.response?.data?.error || '获取源文件时出错')
      setIsSourcePreviewDialogOpen(false)
    } finally {
      setIsSourcePreviewLoading(false)
    }
  }

  const handlePreviewSelectedSource = async () => {
    if (!selectedTemplateUrl) {
      toast.error('请先选择模板')
      return
    }

    // 找到当前选中的模板名称
    const selectedTemplate = allTemplates.find(
      (t) => t.url === selectedTemplateUrl
    )
    const templateName = selectedTemplate?.label || '模板源文件'

    // 旧模板系统：直接打开编辑对话框
    if (!useNewTemplateSystem && selectedTemplate) {
      handleEditOldTemplate(selectedTemplate.name)
      return
    }

    // 新模板系统：打开只读预览
    setIsSourcePreviewLoading(true)
    setIsSourcePreviewDialogOpen(true)
    setSourcePreviewTitle(templateName)

    try {
      const response = await api.post('/api/admin/templates/fetch-source', {
        url: selectedTemplateUrl,
        use_proxy: false,
      })
      setSourcePreviewContent(response.data.content)
    } catch (error: any) {
      toast.error(error.response?.data?.error || '获取源文件时出错')
      setIsSourcePreviewDialogOpen(false)
    } finally {
      setIsSourcePreviewLoading(false)
    }
  }

  const handleSubmitTemplate = () => {
    if (!templateFormData.name.trim()) {
      toast.error('请输入模板名称')
      return
    }

    if (!templateFormData.rule_source.trim()) {
      toast.error('请输入规则源地址')
      return
    }

    // 准备提交数据，如果启用代理下载则自动拼接 1ms.cc 代理前缀
    const submitData = {
      ...templateFormData,
      rule_source:
        templateFormData.use_proxy &&
        !templateFormData.rule_source.startsWith('https://1ms.cc/')
          ? `https://1ms.cc/${templateFormData.rule_source}`
          : templateFormData.rule_source,
      // 默认使用 Clash 格式和启用 include-all
      category: 'clash' as const,
      enable_include_all: true,
    }

    if (editingTemplate) {
      updateTemplateMutation.mutate({ id: editingTemplate.id, ...submitData })
    } else {
      createTemplateMutation.mutate(submitData)
    }
  }

  // 获取可用的预设模板（过滤掉已添加的）
  const getAvailablePresets = () => {
    const existingNames = new Set(dbTemplates.map((t) => t.name))
    const existingUrls = new Set(dbTemplates.map((t) => t.rule_source))

    const filterPresets = (presets: ACL4SSRPreset[]) =>
      presets.filter(
        (p) => !existingNames.has(p.name) && !existingUrls.has(p.url)
      )

    return {
      aethersailor: filterPresets(Aethersailor_PRESETS),
      acl4ssr: filterPresets(ACL4SSR_PRESETS),
    }
  }

  // 处理预设模板选择
  const handleTemplatePresetSelect = (presetUrl: string) => {
    const preset = ALL_TEMPLATE_PRESETS.find((p) => p.url === presetUrl)
    if (preset) {
      setTemplateFormData({
        ...templateFormData,
        name: preset.name,
        rule_source: preset.url,
      })
    }
  }

  // 获取所有协议类型
  const protocols = Array.from(
    new Set(sortedEnabledNodes.map((n) => n.protocol.toLowerCase()))
  ).sort()

  // 获取所有标签类型
  const tags = Array.from(new Set(sortedEnabledNodes.map((n) => n.tag))).sort()

  // 节点列表根据选中的协议和标签筛选
  const filteredNodes = useMemo(() => {
    if (selectedProtocols.size === 0 && selectedTags.size === 0) {
      // 没有筛选条件，显示全部
      return sortedEnabledNodes
    }

    return sortedEnabledNodes.filter((node) => {
      // 协议筛选
      if (selectedProtocols.size > 0) {
        return selectedProtocols.has(node.protocol.toLowerCase())
      }
      // 标签筛选
      if (selectedTags.size > 0) {
        return selectedTags.has(node.tag)
      }
      return true
    })
  }, [sortedEnabledNodes, selectedProtocols, selectedTags])

  const handleToggleNode = (nodeId: number) => {
    const newSet = new Set(selectedNodeIds)
    if (newSet.has(nodeId)) {
      newSet.delete(nodeId)
    } else {
      newSet.add(nodeId)
    }
    setSelectedNodeIds(newSet)
  }

  const handleToggleAll = () => {
    if (selectedNodeIds.size === filteredNodes.length) {
      setSelectedNodeIds(new Set())
    } else {
      setSelectedNodeIds(new Set(filteredNodes.map((n) => n.id)))
    }
  }

  type ProxyGroup = {
    name: string
    type: string
    proxies: string[]
    use?: string[] // 代理集合引用
    url?: string
    interval?: number
    lazy?: boolean
  }

  // 计算可用节点（根据 showAllNodes 状态过滤）
  const availableProxies = useMemo(() => {
    if (showAllNodes) {
      return allProxies
    }

    // 收集所有已使用的节点
    const usedNodes = new Set<string>()
    proxyGroups.forEach((group) => {
      group.proxies.forEach((proxy) => {
        usedNodes.add(proxy)
      })
    })

    // 只返回未使用的节点
    return allProxies.filter((name) => !usedNodes.has(name))
  }, [allProxies, proxyGroups, showAllNodes])

  // 加载模板（根据模板系统选择不同的加载方式）
  const handleLoadTemplate = async () => {
    if (selectedNodeIds.size === 0) {
      toast.error('请选择至少一个节点')
      return
    }

    if (!selectedTemplateUrl) {
      toast.error('请选择一个模板')
      return
    }

    setLoading(true)
    try {
      // 获取选中的节点并转换为ProxyConfig（使用排序后的节点列表）
      const selectedNodes = sortedEnabledNodes.filter((n) =>
        selectedNodeIds.has(n.id)
      )
      const proxies: ProxyConfig[] = selectedNodes
        .map((node) => {
          try {
            return JSON.parse(node.clash_config) as ProxyConfig
          } catch (e) {
            console.error(
              'Failed to parse clash config for node:',
              node.node_name,
              e
            )
            return null
          }
        })
        .filter((p): p is ProxyConfig => p !== null)

      if (proxies.length === 0) {
        toast.error('未能解析到任何有效节点')
        return
      }

      let finalConfig: string

      if (useNewTemplateSystem) {
        // 新模板系统：使用 ACL4SSR 模板转换功能
        const proxyNames = proxies.map((p) => p.name)

        const convertResponse = await api.post('/api/admin/templates/convert', {
          template_url: '', // 使用默认模板
          rule_source: selectedTemplateUrl,
          category: 'clash',
          use_proxy: false,
          enable_include_all: true,
          proxy_names: proxyNames,
        })

        // 解析生成的配置
        const templateConfig = yaml.load(convertResponse.data.content) as any

        // 插入代理节点，并重新排序字段
        templateConfig.proxies = proxies.map((proxy) =>
          reorderProxyFields(proxy)
        )

        // 确保 short-id 字段始终作为字符串
        const processedConfig = ensureShortIdAsString(templateConfig)

        // 转换回 YAML
        finalConfig = yaml.dump(processedConfig, YAML_DUMP_OPTIONS)

        // 修复 short-id 空值显示
        finalConfig = fixShortIdInYaml(finalConfig)
      } else {
        // 旧模板系统：直接读取 YAML 文件并填充 proxies
        const response = await api.get(selectedTemplateUrl)
        const templateContent = response.data.content as string

        // 解析模板
        const templateConfig = yaml.load(templateContent) as any

        // 插入代理节点，并重新排序字段
        templateConfig.proxies = proxies.map((proxy) =>
          reorderProxyFields(proxy)
        )

        // 确保 short-id 字段始终作为字符串
        const processedConfig = ensureShortIdAsString(templateConfig)

        // 转换回 YAML
        finalConfig = yaml.dump(processedConfig, YAML_DUMP_OPTIONS)

        // 修复 short-id 空值显示
        finalConfig = fixShortIdInYaml(finalConfig)
      }

      // 应用自定义规则
      try {
        const applyRulesResponse = await api.post(
          '/api/admin/apply-custom-rules',
          {
            yaml_content: finalConfig,
          }
        )
        finalConfig = applyRulesResponse.data.yaml_content
      } catch (error) {
        console.error('Apply custom rules error:', error)
        // 应用规则失败不影响主流程，继续使用原配置
      }

      // 校验配置有效性（只在使用新模板系统时校验）
      if (useNewTemplateSystem) {
        try {
          const parsedConfig = yaml.load(finalConfig) as any
          const validationResult = validateClashConfig(parsedConfig)

          if (!validationResult.valid) {
            // 有错误级别的问题，阻止保存
            const errorMessage = formatValidationIssues(validationResult.issues)
            toast.error('配置校验失败', {
              description: errorMessage,
              duration: 10000,
            })
            console.error('Clash配置校验失败:', validationResult.issues)
            return
          }

          // 如果有自动修复的内容，使用修复后的配置
          if (validationResult.fixedConfig) {
            finalConfig = yaml.dump(validationResult.fixedConfig, {
              indent: 2,
              lineWidth: -1,
              noRefs: true,
            })

            // 显示修复提示
            const warningIssues = validationResult.issues.filter(
              (i) => i.level === 'warning'
            )
            if (warningIssues.length > 0) {
              toast.warning('配置已自动修复', {
                description: formatValidationIssues(warningIssues),
                duration: 8000,
              })
            }
          }
        } catch (error) {
          console.error('配置校验异常:', error)
          toast.error(
            '配置校验时发生错误: ' +
              (error instanceof Error ? error.message : '未知错误')
          )
          return
        }
      } else {
        console.log('使用旧模板系统，跳过配置校验')
      }

      setClashConfig(finalConfig)
      setHasManuallyGrouped(false) // 加载模板后重置手动分组状态
      toast.success(`成功加载模板并插入 ${proxies.length} 个节点`)
    } catch (error: any) {
      console.error('Load template error:', error)
      toast.error(error.response?.data?.error || '加载模板失败')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (selectedNodeIds.size === 0) {
      toast.error('请选择至少一个节点')
      return
    }

    setLoading(true)
    try {
      // 获取选中的节点并转换为ProxyConfig（使用排序后的节点列表）
      const selectedNodes = sortedEnabledNodes.filter((n) =>
        selectedNodeIds.has(n.id)
      )
      const proxies: ProxyConfig[] = selectedNodes
        .map((node) => {
          try {
            return JSON.parse(node.clash_config) as ProxyConfig
          } catch (e) {
            console.error(
              'Failed to parse clash config for node:',
              node.node_name,
              e
            )
            return null
          }
        })
        .filter((p): p is ProxyConfig => p !== null)

      if (proxies.length === 0) {
        toast.error('未能解析到任何有效节点')
        return
      }

      toast.success(`成功加载 ${proxies.length} 个节点`)

      // Validate custom rules
      const validCustomRules = customRules.filter(
        (rule) => rule.name.trim() !== ''
      )
      if (validCustomRules.length > 0) {
        toast.info(`应用 ${validCustomRules.length} 条自定义规则`)
      }

      // All rule sets now use selected categories
      if (selectedCategories.length > 0) {
        toast.info(`应用 ${selectedCategories.length} 个规则类别`)
      }

      // Build Clash config using new builder with dynamic categories
      const clashBuilder = new ClashConfigBuilder(
        proxies,
        selectedCategories,
        validCustomRules,
        proxyGroupCategories
      )
      let generatedConfig = clashBuilder.build()

      // 应用自定义规则
      let addedProxyGroups: string[] = []
      try {
        const applyRulesResponse = await api.post(
          '/api/admin/apply-custom-rules',
          {
            yaml_content: generatedConfig,
          }
        )
        generatedConfig = applyRulesResponse.data.yaml_content
        addedProxyGroups = applyRulesResponse.data.added_proxy_groups || []
      } catch (error) {
        console.error('Apply custom rules error:', error)
        // 应用规则失败不影响主流程，继续使用原配置
      }

      // 校验配置有效性
      try {
        const parsedConfig = yaml.load(generatedConfig) as any
        const validationResult = validateClashConfig(parsedConfig)

        if (!validationResult.valid) {
          // 有错误级别的问题，阻止保存
          const errorMessage = formatValidationIssues(validationResult.issues)
          toast.error('配置校验失败', {
            description: errorMessage,
            duration: 10000,
          })
          console.error('Clash配置校验失败:', validationResult.issues)
          return
        }

        // 如果有自动修复的内容，使用修复后的配置
        if (validationResult.fixedConfig) {
          generatedConfig = yaml.dump(validationResult.fixedConfig, {
            indent: 2,
            lineWidth: -1,
            noRefs: true,
          })

          // 显示修复提示
          const warningIssues = validationResult.issues.filter(
            (i) => i.level === 'warning'
          )
          if (warningIssues.length > 0) {
            toast.warning('配置已自动修复', {
              description: formatValidationIssues(warningIssues),
              duration: 8000,
            })
          }
        }
      } catch (error) {
        console.error('配置校验异常:', error)
        toast.error(
          '配置校验时发生错误: ' +
            (error instanceof Error ? error.message : '未知错误')
        )
        return
      }

      setClashConfig(generatedConfig)
      setHasManuallyGrouped(true) // 自定义规则模式生成后自动标记为已分组

      // 显示生成成功通知，如果有新增代理组则包含提示
      if (addedProxyGroups.length > 0) {
        toast.success(
          `Clash 配置生成成功！已应用自定义规则，新增了以下代理组：${addedProxyGroups.join('、')}，默认节点：🚀 节点选择、DIRECT`,
          { duration: 8000 }
        )
      } else {
        toast.success('Clash 配置生成成功！')
      }
    } catch (error) {
      console.error('Generation error:', error)
      toast.error('生成订阅链接失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setSelectedNodeIds(new Set())
    setSelectedCategories([])
    setCustomRules([])
    setClashConfig('')
    toast.info('已清空所有内容')
  }

  // 保存订阅 mutation
  const saveSubscribeMutation = useMutation({
    mutationFn: async (data: {
      name: string
      filename: string
      description: string
      content: string
    }) => {
      const response = await api.post(
        '/api/admin/subscribe-files/create-from-config',
        data
      )
      return response.data
    },
    onSuccess: () => {
      toast.success('订阅保存成功！')
      toast.info('请前往"订阅文件"页面查看')
      setSaveDialogOpen(false)
      setSubscribeName('')
      setSubscribeFilename('')
      setSubscribeDescription('')
      queryClient.invalidateQueries({ queryKey: ['subscribe-files'] })
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions'] })
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || '保存订阅失败'
      toast.error(message)
    },
  })

  const handleOpenSaveDialog = () => {
    if (!clashConfig) {
      toast.error('请先生成配置')
      return
    }
    // 使用旧模板系统时，必须先手动分组
    if (
      ruleMode === 'template' &&
      !hasManuallyGrouped &&
      !useNewTemplateSystem
    ) {
      toast.error('请先手动分组节点')
      return
    }
    setSaveDialogOpen(true)
  }

  const handleSaveSubscribe = () => {
    if (!subscribeName.trim()) {
      toast.error('请输入订阅名称')
      return
    }

    saveSubscribeMutation.mutate({
      name: subscribeName.trim(),
      filename: subscribeFilename.trim(),
      description: subscribeDescription.trim(),
      content: clashConfig,
    })
  }

  // 手动分组功能
  const handleOpenGroupDialog = () => {
    if (!clashConfig) {
      toast.error('请先生成配置')
      return
    }

    try {
      // 解析当前的 Clash 配置
      const parsedConfig = yaml.load(preprocessYaml(clashConfig)) as any

      if (!parsedConfig['proxy-groups']) {
        toast.error('配置中没有找到代理组')
        return
      }

      // 获取所有代理组，确保每个组都有 proxies 数组
      const groups = (parsedConfig['proxy-groups'] as any[]).map((group) => ({
        ...group,
        proxies: group.proxies || [],
      })) as ProxyGroup[]

      // 获取用户选中的节点，添加默认的特殊节点（使用排序后的节点列表）
      const selectedNodes = sortedEnabledNodes.filter((n) =>
        selectedNodeIds.has(n.id)
      )
      const nodeNames = selectedNodes.map((n) => n.node_name)
      const specialNodes = ['♻️ 自动选择', '🚀 节点选择', 'DIRECT', 'REJECT']
      const availableNodes = [...specialNodes, ...nodeNames]

      setProxyGroups(groups)
      setAllProxies(availableNodes)
      setGroupDialogOpen(true)
    } catch (error) {
      console.error('解析配置失败:', error)
      toast.error('解析配置失败，请检查配置格式')
    }
  }

  const handleApplyGrouping = async () => {
    try {
      // 解析当前配置
      const parsedConfig = yaml.load(preprocessYaml(clashConfig)) as any

      // 获取所有 MMW 模式代理集合的名称（用于后续检查）
      const allMmwProviderNames = proxyProviderConfigs
        .filter((c) => c.process_mode === 'mmw')
        .map((c) => c.name)

      // 收集所有被使用的 provider 名称
      const usedProviders = new Set<string>()
      proxyGroups.forEach((group) => {
        // 从 use 属性收集（客户端模式）
        if (group.use) {
          group.use.forEach((provider) => usedProviders.add(provider))
        }
        // 从 proxies 属性收集 MMW 代理集合的引用（MMW 模式下代理集合名称作为代理组名称出现在 proxies 中）
        if (group.proxies) {
          group.proxies.forEach((proxy) => {
            if (proxy && allMmwProviderNames.includes(proxy)) {
              usedProviders.add(proxy)
            }
          })
        }
      })

      // 筛选 MMW 模式和非 MMW 模式的代理集合
      const mmwProviders = proxyProviderConfigs.filter(
        (c) => usedProviders.has(c.name) && c.process_mode === 'mmw'
      )
      const nonMmwProviders = proxyProviderConfigs.filter(
        (c) => usedProviders.has(c.name) && c.process_mode !== 'mmw'
      )

      // 找出不再被使用的 MMW 代理集合（需要清理其自动创建的代理组和节点）
      // allMmwProviderNames 已在函数开头定义
      const unusedMmwProviders = allMmwProviderNames.filter(
        (name) => !usedProviders.has(name)
      )

      // 获取 MMW 节点数据
      const mmwNodesMap: Record<string, { nodes: any[]; prefix: string }> = {}
      for (const config of mmwProviders) {
        try {
          const resp = await api.get(
            `/api/user/proxy-provider-nodes?id=${config.id}`
          )
          if (resp.data && resp.data.nodes) {
            mmwNodesMap[config.name] = resp.data
          }
        } catch (err) {
          console.error(`获取代理集合 ${config.name} 节点失败:`, err)
        }
      }

      // 1. 更新使用代理集合的代理组
      // 对于 MMW 模式：添加代理组名称到 proxies（而不是节点名称），移除 use 引用
      // 对于非 MMW 模式：保留 use 字段
      parsedConfig['proxy-groups'] = proxyGroups.map((group) => {
        const groupConfig: any = {
          ...group,
          proxies: group.proxies.filter((p): p is string => p !== undefined),
        }

        if (group.use && group.use.length > 0) {
          const newUse: string[] = []
          const mmwGroupNames: string[] = []

          group.use.forEach((providerName) => {
            if (mmwNodesMap[providerName]) {
              // MMW 模式：添加代理组名称（而非节点名称）
              mmwGroupNames.push(providerName)
            } else {
              // 非 MMW 模式：保留 use 引用
              newUse.push(providerName)
            }
          })

          // 添加 MMW 代理组名称到 proxies
          if (mmwGroupNames.length > 0) {
            groupConfig.proxies = [...groupConfig.proxies, ...mmwGroupNames]
          }

          // 只保留非 MMW 的 use 引用
          if (newUse.length > 0) {
            groupConfig.use = newUse
          } else {
            delete groupConfig.use
          }
        }

        return groupConfig
      })

      // 2. 为每个 MMW 代理集合创建或更新对应的代理组（与获取订阅逻辑一致）
      const mmwGroupsToAdd: any[] = []
      for (const [providerName, data] of Object.entries(mmwNodesMap)) {
        const nodeNames = data.nodes.map((node: any) => data.prefix + node.name)

        // 检查是否已存在同名代理组（可能是用户手动创建的）
        const existingGroupIndex = parsedConfig['proxy-groups']?.findIndex(
          (g: any) => g.name === providerName
        )

        if (existingGroupIndex >= 0) {
          // 更新已存在的代理组的 proxies
          parsedConfig['proxy-groups'][existingGroupIndex].proxies = nodeNames
        } else {
          // 创建新代理组（类型为 url-test）
          mmwGroupsToAdd.push({
            name: providerName,
            type: 'url-test',
            url: 'http://www.gstatic.com/generate_204',
            interval: 300,
            tolerance: 50,
            proxies: nodeNames,
          })
        }
      }

      // 3. 将新创建的 MMW 代理组追加到 proxy-groups 末尾
      if (mmwGroupsToAdd.length > 0) {
        parsedConfig['proxy-groups'] = [
          ...parsedConfig['proxy-groups'],
          ...mmwGroupsToAdd,
        ]
      }

      // 4. 清理不再使用的 MMW 代理集合的自动创建代理组
      if (unusedMmwProviders.length > 0 && parsedConfig['proxy-groups']) {
        // 删除自动创建的代理组（名称与代理集合相同的代理组）
        parsedConfig['proxy-groups'] = parsedConfig['proxy-groups'].filter(
          (group: any) => {
            if (unusedMmwProviders.includes(group.name)) {
              console.log(`[MMW清理] 删除不再使用的代理组: ${group.name}`)
              return false
            }
            return true
          }
        )
      }

      // 添加 MMW 节点到 proxies
      if (!parsedConfig.proxies) {
        parsedConfig.proxies = []
      }
      for (const [, data] of Object.entries(mmwNodesMap)) {
        data.nodes.forEach((node: any) => {
          const prefixedNode = { ...node, name: data.prefix + node.name }
          // 检查是否已存在同名节点，避免重复添加
          const existingIndex = parsedConfig.proxies.findIndex(
            (p: any) => p.name === prefixedNode.name
          )
          if (existingIndex >= 0) {
            parsedConfig.proxies[existingIndex] =
              reorderProxyFields(prefixedNode)
          } else {
            parsedConfig.proxies.push(reorderProxyFields(prefixedNode))
          }
        })
      }

      // 只为非 MMW 代理集合生成 proxy-providers 配置
      if (nonMmwProviders.length > 0) {
        const providers: Record<string, any> = {}
        nonMmwProviders.forEach((config) => {
          const baseUrl = window.location.origin
          const providerConfig: Record<string, any> = {
            type: config.type || 'http',
            path: `./proxy_providers/${config.name}.yaml`,
            url: `${baseUrl}/api/proxy-provider/${config.id}?token=${userToken}`,
            interval: config.interval || 3600,
          }
          if (config.health_check_enabled) {
            providerConfig['health-check'] = {
              enable: true,
              url:
                config.health_check_url ||
                'http://www.gstatic.com/generate_204',
              interval: config.health_check_interval || 300,
            }
          }
          providers[config.name] = providerConfig
        })
        if (Object.keys(providers).length > 0) {
          parsedConfig['proxy-providers'] = providers
        }
      }

      // 收集所有代理组中使用的节点名称（包括 MMW 节点）
      const usedNodeNames = new Set<string>()
      const groupNames = new Set(
        parsedConfig['proxy-groups'].map((g: any) => g.name)
      )
      parsedConfig['proxy-groups'].forEach((group: any) => {
        if (group.proxies && Array.isArray(group.proxies)) {
          group.proxies.forEach((proxy: string) => {
            // 只添加实际节点（不是特殊节点，也不是其他代理组）
            if (
              ![
                'DIRECT',
                'REJECT',
                'PROXY',
                'no-resolve',
                '♻️ 自动选择',
                '🚀 节点选择',
              ].includes(proxy) &&
              !groupNames.has(proxy)
            ) {
              usedNodeNames.add(proxy)
            }
          })
        }
      })

      // 过滤 proxies，只保留被使用的节点
      if (parsedConfig.proxies && Array.isArray(parsedConfig.proxies)) {
        const originalCount = parsedConfig.proxies.length
        parsedConfig.proxies = parsedConfig.proxies.filter((proxy: any) =>
          usedNodeNames.has(proxy.name)
        )
        const removedCount = originalCount - parsedConfig.proxies.length
        if (removedCount > 0) {
          console.log(
            `[handleApplyGrouping] 已删除 ${removedCount} 个未使用的节点`
          )
        }
      }

      // 处理链式代理：给落地节点组中的节点添加 dialer-proxy 参数
      const landingGroup = proxyGroups.find((g) => g.name === '🌄 落地节点')
      const hasRelayGroup = proxyGroups.some((g) => g.name === '🌠 中转节点')

      if (
        landingGroup &&
        hasRelayGroup &&
        parsedConfig.proxies &&
        Array.isArray(parsedConfig.proxies)
      ) {
        // 获取落地节点组中的所有节点名称
        const landingNodeNames = new Set(
          landingGroup.proxies.filter((p): p is string => p !== undefined)
        )

        // 创建节点名称到协议的映射
        const nodeProtocolMap = new Map<string, string>()
        savedNodes.forEach((node) => {
          nodeProtocolMap.set(node.node_name, node.protocol)
        })

        // 给这些节点添加 dialer-proxy 参数（跳过已经是链式代理的节点）
        parsedConfig.proxies = parsedConfig.proxies.map((proxy: any) => {
          if (landingNodeNames.has(proxy.name)) {
            // 通过协议判断是否为链式代理节点（协议包含 ⇋）
            const protocol = nodeProtocolMap.get(proxy.name)
            if (protocol && protocol.includes('⇋')) {
              return proxy
            }
            return {
              ...proxy,
              'dialer-proxy': '🌠 中转节点',
            }
          }
          return proxy
        })
      }

      // 重新排序 proxies 字段
      if (parsedConfig.proxies && Array.isArray(parsedConfig.proxies)) {
        parsedConfig.proxies = parsedConfig.proxies.map((proxy: any) =>
          reorderProxyFields(proxy)
        )
      }

      // 确保 short-id 字段始终作为字符串
      const processedConfig = ensureShortIdAsString(parsedConfig)

      // 转换回 YAML
      let newConfig = yaml.dump(processedConfig, YAML_DUMP_OPTIONS)

      // 修复 short-id 空值显示
      newConfig = fixShortIdInYaml(newConfig)

      // 验证 rules 中引用的节点是否都存在
      const validationResult = validateRulesNodes(parsedConfig)

      if (validationResult.missingNodes.length > 0) {
        // 有缺失的节点，显示替换对话框
        setMissingNodes(validationResult.missingNodes)
        setPendingConfigAfterGrouping(newConfig)
        setMissingNodesDialogOpen(true)
      } else {
        // 没有缺失节点，直接应用
        setClashConfig(newConfig)
        setGroupDialogOpen(false)
        setHasManuallyGrouped(true)
        toast.success('分组已应用到配置')
      }
    } catch (error) {
      console.error('应用分组失败:', error)
      toast.error('应用分组失败，请检查配置')
    }
  }

  // 验证 rules 中的节点是否存在于 proxy-groups 中
  const validateRulesNodes = (parsedConfig: any) => {
    const missingNodeNames = collectMissingRuleTargets(parsedConfig, 'node')
    missingNodeNames.forEach((nodeName) => {
      toast(`[validateRulesNodes] 发现缺失节点: "${nodeName}"`)
    })

    return {
      missingNodes: collectMissingRuleTargets(parsedConfig, 'rule'),
    }
  }

  // 应用缺失节点替换
  const handleApplyReplacement = () => {
    try {
      const parsedConfig = yaml.load(
        preprocessYaml(pendingConfigAfterGrouping)
      ) as any
      replaceMissingRuleTargets(parsedConfig, replacementChoice)

      // 重新排序 proxies 字段
      if (parsedConfig.proxies && Array.isArray(parsedConfig.proxies)) {
        parsedConfig.proxies = parsedConfig.proxies.map((proxy: any) =>
          reorderProxyFields(proxy)
        )
      }

      // 确保 short-id 字段始终作为字符串
      const processedConfigFinal = ensureShortIdAsString(parsedConfig)

      // 转换回 YAML
      let finalConfig = yaml.dump(processedConfigFinal, YAML_DUMP_OPTIONS)

      // 修复 short-id 空值显示
      finalConfig = fixShortIdInYaml(finalConfig)

      setClashConfig(finalConfig)
      setGroupDialogOpen(false)
      setMissingNodesDialogOpen(false)
      setHasManuallyGrouped(true)
      setPendingConfigAfterGrouping('')
      setMissingNodes([])
      toast.success(`已将缺失节点替换为 ${replacementChoice}`)
    } catch (error) {
      console.error('应用替换失败:', error)
      toast.error('应用替换失败，请检查配置')
    }
  }

  // 配置链式代理
  const handleConfigureChainProxy = () => {
    // 检查是否已存在这两个代理组
    const hasLandingNode = proxyGroups.some((g) => g.name === '🌄 落地节点')
    const hasRelayNode = proxyGroups.some((g) => g.name === '🌠 中转节点')

    // 从链式代理节点中提取落地节点和中转节点
    const chainProxyNodes = sortedEnabledNodes.filter((node) =>
      node.node_name.includes('⇋')
    )

    const landingNodeNames = new Set<string>()
    const relayNodeNames = new Set<string>()

    chainProxyNodes.forEach((node) => {
      const parts = node.node_name.split('⇋')
      if (parts.length === 2) {
        landingNodeNames.add(parts[0].trim())
        relayNodeNames.add(parts[1].trim())
      }
    })

    const newGroups: ProxyGroup[] = []

    if (!hasLandingNode) {
      newGroups.push({
        name: '🌄 落地节点',
        type: 'select',
        proxies: Array.from(landingNodeNames),
      })
    }

    if (!hasRelayNode) {
      newGroups.push({
        name: '🌠 中转节点',
        type: 'select',
        proxies: Array.from(relayNodeNames),
      })
    }

    if (newGroups.length > 0) {
      setProxyGroups((groups) => {
        const updatedGroups = [...newGroups, ...groups]

        // 如果添加了落地节点，将其添加到"🚀 节点选择"组的第一位
        if (newGroups.some((g) => g.name === '🌄 落地节点')) {
          return updatedGroups.map((group) => {
            if (group.name === '🚀 节点选择') {
              // 过滤掉已存在的"🌄 落地节点"（如果有的话）
              const filteredProxies = (group.proxies || []).filter(
                (p) => p !== '🌄 落地节点'
              )
              // 将"🌄 落地节点"添加到第一位
              return {
                ...group,
                proxies: ['🌄 落地节点', ...filteredProxies],
              }
            }
            return group
          })
        }

        return updatedGroups
      })
      toast.success(`已添加 ${newGroups.map((g) => g.name).join('、')}`)
    } else {
      toast.info('链式代理节点已存在')
    }
  }

  // 生成单个代理组的 YAML 字符串
  const generateProxyGroupYaml = (
    group: {
      name: string
      type: string
      url?: string
      interval?: number
      tolerance?: number
      proxies: string[]
    },
    indent: string = '  '
  ): string => {
    const lines: string[] = []
    lines.push(`${indent}- name: ${group.name}`)
    lines.push(`${indent}  type: ${group.type}`)
    if (group.url) {
      lines.push(`${indent}  url: ${group.url}`)
    }
    if (group.interval !== undefined) {
      lines.push(`${indent}  interval: ${group.interval}`)
    }
    if (group.tolerance !== undefined) {
      lines.push(`${indent}  tolerance: ${group.tolerance}`)
    }
    lines.push(`${indent}  proxies:`)
    for (const proxy of group.proxies) {
      lines.push(`${indent}    - ${proxy}`)
    }
    return lines.join('\n')
  }

  // 在指定代理组后插入节点（字符串操作）
  const insertProxiesIntoGroup = (
    yamlStr: string,
    groupName: string,
    newProxies: string[]
  ): string => {
    if (newProxies.length === 0) return yamlStr

    const lines = yamlStr.split('\n')
    const result: string[] = []
    let inTargetGroup = false
    let inProxiesSection = false
    let groupIndent = ''
    let proxiesInserted = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // 检测代理组开始 "  - name: xxx"
      const groupMatch = line.match(/^(\s*)- name:\s*(.+)$/)
      if (groupMatch) {
        // 如果之前在目标组的 proxies 部分，现在遇到新组了，说明需要在这里插入
        if (inTargetGroup && inProxiesSection && !proxiesInserted) {
          for (const proxy of newProxies) {
            result.push(`${groupIndent}    - ${proxy}`)
          }
          proxiesInserted = true
        }

        inTargetGroup = groupMatch[2].trim() === groupName
        groupIndent = groupMatch[1]
        inProxiesSection = false
      }

      // 检测 proxies: 开始
      if (inTargetGroup && line.match(/^\s+proxies:\s*$/)) {
        inProxiesSection = true
        result.push(line)
        continue
      }

      // 在 proxies 部分检测是否到了末尾（遇到非 "    - xxx" 格式的行）
      if (inTargetGroup && inProxiesSection && !proxiesInserted) {
        const proxyItemMatch = line.match(/^(\s+)-\s+(.+)$/)
        if (
          !proxyItemMatch ||
          proxyItemMatch[1].length <= groupIndent.length + 2
        ) {
          // 不是 proxy 项，在这里插入新节点
          for (const proxy of newProxies) {
            result.push(`${groupIndent}    - ${proxy}`)
          }
          proxiesInserted = true
          inTargetGroup = false
          inProxiesSection = false
        }
      }

      result.push(line)
    }

    // 如果到文件末尾还没插入（目标组在最后）
    if (inTargetGroup && inProxiesSection && !proxiesInserted) {
      for (const proxy of newProxies) {
        result.push(`${groupIndent}    - ${proxy}`)
      }
    }

    return result.join('\n')
  }

  // 在指定代理组后插入新代理组（字符串操作）
  const insertNewGroupsAfter = (
    yamlStr: string,
    afterGroupName: string,
    newGroupsYaml: string
  ): string => {
    const lines = yamlStr.split('\n')
    const result: string[] = []
    let foundGroup = false
    let insertPosition = -1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      result.push(line)

      // 检测代理组开始 "  - name: xxx"
      const groupMatch = line.match(/^(\s*)- name:\s*(.+)$/)
      if (groupMatch) {
        if (foundGroup && insertPosition === -1) {
          // 找到了下一个组，在这之前插入
          insertPosition = result.length - 1
        }
        if (groupMatch[2].trim() === afterGroupName) {
          foundGroup = true
        }
      }
    }

    if (foundGroup && insertPosition === -1) {
      // 目标组是最后一个，在文件末尾插入（在 proxy-groups 部分结束前）
      // 找到 rules: 或其他顶级 key 的位置
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].match(/^[a-zA-Z]/) && !result[i].startsWith(' ')) {
          insertPosition = i
          break
        }
      }
      if (insertPosition === -1) {
        insertPosition = result.length
      }
    }

    if (insertPosition !== -1) {
      result.splice(insertPosition, 0, newGroupsYaml)
    }

    return result.join('\n')
  }

  // 自动按地区分组（保留原始格式）
  const handleAutoGroupByRegion = () => {
    if (!clashConfig) {
      toast.error('请先生成配置')
      return
    }

    try {
      // 用 yaml.load 只是为了获取结构信息，不用于输出
      const parsedConfig = yaml.load(preprocessYaml(clashConfig)) as any
      const groups = parsedConfig['proxy-groups'] as any[]

      if (!groups || groups.length === 0) {
        toast.error('配置中没有找到代理组')
        return
      }

      // 获取选中的节点名称（使用排序后的节点列表）
      const selectedNodes = sortedEnabledNodes.filter((n) =>
        selectedNodeIds.has(n.id)
      )
      const nodeNames = selectedNodes.map((n) => n.node_name)

      // 按地区分类节点
      const regionNodes: Record<string, string[]> = {}
      const otherNodes: string[] = []

      for (const nodeName of nodeNames) {
        const regionInfo = extractRegionFromNodeName(nodeName)
        if (regionInfo) {
          const groupName = findRegionGroupName(regionInfo.countryCode)
          if (groupName) {
            if (!regionNodes[groupName]) regionNodes[groupName] = []
            regionNodes[groupName].push(nodeName)
          } else {
            otherNodes.push(nodeName)
          }
        } else {
          otherNodes.push(nodeName)
        }
      }

      // 获取现有代理组名称和节点
      const existingGroupNames = new Set(groups.map((g) => g.name))

      // 获取"自动选择"组中已有的节点
      const autoSelectGroup = groups.find((g) => g.name === '♻️ 自动选择')
      const existingAutoSelectNodes = new Set(autoSelectGroup?.proxies || [])

      let newConfig = clashConfig

      // 1. 为已存在的地区代理组添加节点
      for (const [groupName, nodes] of Object.entries(regionNodes)) {
        if (existingGroupNames.has(groupName)) {
          // 获取该组已有的节点，只添加不存在的
          const existingGroup = groups.find((g) => g.name === groupName)
          const existingNodes = new Set(existingGroup?.proxies || [])
          const newNodes = nodes.filter((n) => !existingNodes.has(n))
          if (newNodes.length > 0) {
            newConfig = insertProxiesIntoGroup(newConfig, groupName, newNodes)
          }
        }
      }

      // 为"其他地区"组添加节点（如果存在）
      if (existingGroupNames.has('🌐 其他地区')) {
        const existingGroup = groups.find((g) => g.name === '🌐 其他地区')
        const existingNodes = new Set(existingGroup?.proxies || [])
        const newNodes = otherNodes.filter((n) => !existingNodes.has(n))
        if (newNodes.length > 0) {
          newConfig = insertProxiesIntoGroup(newConfig, '🌐 其他地区', newNodes)
        }
      }

      // 为"自动选择"组添加节点（只添加不存在的）
      if (existingGroupNames.has('♻️ 自动选择')) {
        const newNodes = nodeNames.filter(
          (n) => !existingAutoSelectNodes.has(n)
        )
        if (newNodes.length > 0) {
          newConfig = insertProxiesIntoGroup(newConfig, '♻️ 自动选择', newNodes)
        }
      }

      // 2. 创建缺失的地区代理组
      const newGroups: {
        name: string
        type: string
        url: string
        interval: number
        tolerance: number
        proxies: string[]
      }[] = []
      const createdGroupNames: string[] = []

      for (const [groupName, nodes] of Object.entries(regionNodes)) {
        if (!existingGroupNames.has(groupName) && nodes.length > 0) {
          newGroups.push({
            name: groupName,
            type: 'url-test',
            url: 'https://www.gstatic.com/generate_204',
            interval: 300,
            tolerance: 50,
            proxies: nodes,
          })
          createdGroupNames.push(groupName)
        }
      }

      // 如果有其他地区节点且不存在"其他地区"组，则创建
      if (otherNodes.length > 0 && !existingGroupNames.has('🌐 其他地区')) {
        newGroups.push({
          name: '🌐 其他地区',
          type: 'url-test',
          url: 'https://www.gstatic.com/generate_204',
          interval: 300,
          tolerance: 50,
          proxies: otherNodes,
        })
        createdGroupNames.push('🌐 其他地区')
      }

      // 插入新代理组
      if (newGroups.length > 0) {
        // 找到插入位置（在"自动选择"或"节点选择"之后）
        let insertAfterGroup = '♻️ 自动选择'
        if (!existingGroupNames.has(insertAfterGroup)) {
          insertAfterGroup = '🚀 节点选择'
        }
        if (!existingGroupNames.has(insertAfterGroup) && groups.length > 0) {
          insertAfterGroup = groups[0].name
        }

        const newGroupsYaml = newGroups
          .map((g) => generateProxyGroupYaml(g))
          .join('\n')
        newConfig = insertNewGroupsAfter(
          newConfig,
          insertAfterGroup,
          newGroupsYaml
        )
      }

      // 3. 把新创建的地区代理组添加到"🚀 节点选择"的 proxies 中
      if (
        createdGroupNames.length > 0 &&
        existingGroupNames.has('🚀 节点选择')
      ) {
        // 检查"节点选择"组中已有的 proxies，只添加不存在的
        const nodeSelectGroup = groups.find((g) => g.name === '🚀 节点选择')
        const existingNodeSelectProxies = new Set(
          nodeSelectGroup?.proxies || []
        )
        const newGroupsToAdd = createdGroupNames.filter(
          (name) => !existingNodeSelectProxies.has(name)
        )
        if (newGroupsToAdd.length > 0) {
          newConfig = insertProxiesIntoGroup(
            newConfig,
            '🚀 节点选择',
            newGroupsToAdd
          )
        }
      }

      setClashConfig(newConfig)
      setHasManuallyGrouped(true)

      // 统计分组结果
      const stats = Object.entries(regionNodes)
        .filter(([, nodes]) => nodes.length > 0)
        .map(([name, nodes]) => `${name}: ${nodes.length}`)
      if (otherNodes.length > 0) {
        stats.push(`🌐 其他地区: ${otherNodes.length}`)
      }

      // 显示结果
      if (createdGroupNames.length > 0) {
        toast.success(
          `自动分组完成，新建代理组：${createdGroupNames.join('、')}`
        )
      } else {
        toast.success(`自动分组完成：${stats.join('、')}`)
      }
    } catch (error) {
      console.error('自动分组失败:', error)
      toast.error('自动分组失败')
    }
  }

  // 删除节点
  const handleRemoveProxy = (groupName: string, proxyIndex: number) => {
    setProxyGroups((groups) =>
      groups.map((group) => {
        if (group.name === groupName) {
          return {
            ...group,
            proxies: group.proxies.filter((_, idx) => idx !== proxyIndex),
          }
        }
        return group
      })
    )
  }

  // 删除整个代理组
  const handleRemoveGroup = (groupName: string) => {
    setProxyGroups((groups) => {
      // 先过滤掉要删除的组
      const filteredGroups = groups.filter((group) => group.name !== groupName)

      // 从所有剩余组的 proxies 列表中移除对被删除组的引用
      return filteredGroups.map((group) => ({
        ...group,
        proxies: group.proxies.filter((proxy) => proxy !== groupName),
      }))
    })
  }

  // 处理代理组改名
  const handleRenameGroup = (oldName: string, newName: string) => {
    setProxyGroups((groups) => {
      // 更新被改名的组
      const updatedGroups = groups.map((group) => {
        if (group.name === oldName) {
          return { ...group, name: newName }
        }
        // 更新其他组中对这个组的引用
        return {
          ...group,
          proxies: group.proxies.map((proxy) =>
            proxy === oldName ? newName : proxy
          ),
        }
      })
      return updatedGroups
    })

    // 同时更新待处理的配置（如果存在）
    if (pendingConfigAfterGrouping) {
      try {
        const parsedConfig = yaml.load(
          preprocessYaml(pendingConfigAfterGrouping)
        ) as any
        if (parsedConfig && parsedConfig['proxy-groups']) {
          // 更新 proxy-groups 中的组名
          parsedConfig['proxy-groups'] = parsedConfig['proxy-groups'].map(
            (group: any) => ({
              ...group,
              name: group.name === oldName ? newName : group.name,
              proxies: group.proxies.map((proxy: string) =>
                proxy === oldName ? newName : proxy
              ),
            })
          )
        }

        // 更新 rules 中的代理组引用
        if (
          parsedConfig &&
          parsedConfig['rules'] &&
          Array.isArray(parsedConfig['rules'])
        ) {
          const updatedRules = parsedConfig['rules'].map((rule: any) => {
            if (typeof rule === 'string') {
              // 规则格式: "DOMAIN-SUFFIX,google.com,PROXY_GROUP"
              const parts = rule.split(',')
              if (parts.length >= 3 && parts[2] === oldName) {
                parts[2] = newName
                return parts.join(',')
              }
            } else if (typeof rule === 'object' && rule.target) {
              // 对象格式的规则，更新 target 字段
              if (rule.target === oldName) {
                return { ...rule, target: newName }
              }
            }
            return rule
          })
          parsedConfig['rules'] = updatedRules
        }

        // 确保 short-id 字段始终作为字符串
        const processedParsedConfig = ensureShortIdAsString(parsedConfig)

        // 转换回YAML并更新待处理配置
        let newConfig = yaml.dump(processedParsedConfig, YAML_DUMP_OPTIONS)

        // 修复 short-id 空值显示
        newConfig = fixShortIdInYaml(newConfig)

        setPendingConfigAfterGrouping(newConfig)
      } catch (error) {
        console.error('更新待处理配置中的代理组引用失败:', error)
      }
    }

    // 更新当前显示的配置（如果存在）
    if (clashConfig) {
      try {
        const parsedConfig = yaml.load(preprocessYaml(clashConfig)) as any
        if (parsedConfig && parsedConfig['proxy-groups']) {
          // 更新 proxy-groups 中的组名
          parsedConfig['proxy-groups'] = parsedConfig['proxy-groups'].map(
            (group: any) => ({
              ...group,
              name: group.name === oldName ? newName : group.name,
              proxies: group.proxies.map((proxy: string) =>
                proxy === oldName ? newName : proxy
              ),
            })
          )
        }

        // 更新 rules 中的代理组引用
        if (
          parsedConfig &&
          parsedConfig['rules'] &&
          Array.isArray(parsedConfig['rules'])
        ) {
          const updatedRules = parsedConfig['rules'].map((rule: any) => {
            if (typeof rule === 'string') {
              const parts = rule.split(',')
              if (parts.length >= 3 && parts[2] === oldName) {
                parts[2] = newName
                return parts.join(',')
              }
            } else if (typeof rule === 'object' && rule.target) {
              if (rule.target === oldName) {
                return { ...rule, target: newName }
              }
            }
            return rule
          })
          parsedConfig['rules'] = updatedRules
        }

        // 确保 short-id 字段始终作为字符串
        const processedCurrentConfig = ensureShortIdAsString(parsedConfig)

        // 转换回YAML并更新当前配置
        let newConfig = yaml.dump(processedCurrentConfig, YAML_DUMP_OPTIONS)

        // 修复 short-id 空值显示
        newConfig = fixShortIdInYaml(newConfig)

        setClashConfig(newConfig)
      } catch (error) {
        console.error('更新当前配置中的代理组引用失败:', error)
      }
    }
  }

  // 处理手动分组对话框关闭
  const handleGroupDialogOpenChange = (open: boolean) => {
    if (!open) {
      // 先关闭对话框
      setGroupDialogOpen(false)

      // 延迟重置数据，避免用户看到复位动画
      setTimeout(() => {
        setProxyGroups([])
        setAllProxies([])
      }, 200)
    } else {
      setGroupDialogOpen(open)
    }
  }

  return (
    <div className='bg-background flex min-h-screen flex-col'>
      <Topbar />

      <main className='mx-auto w-full max-w-7xl px-4 py-8 pt-24 sm:px-6'>
        <div className='mx-auto space-y-6'>
          <div className='space-y-2'>
            <h1 className='text-3xl font-bold tracking-tight'>
              订阅链接生成器
            </h1>
            <p className='text-muted-foreground'>
              从节点管理中选择节点，快速生成 Clash 订阅配置
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>选择节点</CardTitle>
              <CardDescription>
                从已保存的节点中选择需要添加到订阅的节点（已选择{' '}
                {selectedNodeIds.size} 个）
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {sortedEnabledNodes.length === 0 ? (
                <div className='text-muted-foreground py-8 text-center'>
                  暂无可用节点，请先在节点管理中添加节点
                </div>
              ) : (
                <>
                  {/* 协议快速选择按钮（多选模式，与标签互斥） */}
                  <div className='mb-4 flex flex-wrap gap-2'>
                    <Button
                      variant={
                        selectedProtocols.size === 0 && selectedTags.size === 0
                          ? 'default'
                          : 'outline'
                      }
                      size='sm'
                      onClick={() => {
                        // 计算所有节点
                        const allNodeIds = new Set(
                          sortedEnabledNodes.map((n) => n.id)
                        )
                        const currentIds = Array.from(selectedNodeIds).sort()
                        const targetIds = Array.from(allNodeIds).sort()

                        // 如果当前已全选且没有选中协议/标签，则取消全部；否则全选
                        if (
                          selectedProtocols.size === 0 &&
                          selectedTags.size === 0 &&
                          currentIds.length === targetIds.length &&
                          currentIds.every((id, i) => id === targetIds[i])
                        ) {
                          setSelectedNodeIds(new Set())
                        } else {
                          setSelectedProtocols(new Set()) // 清空协议选择
                          setSelectedTags(new Set()) // 清空标签选择
                          setSelectedNodeIds(allNodeIds)
                        }
                      }}
                    >
                      全部 ({sortedEnabledNodes.length})
                    </Button>
                    {protocols.map((protocol) => {
                      const count = sortedEnabledNodes.filter(
                        (n) => n.protocol.toLowerCase() === protocol
                      ).length
                      const isProtocolSelected = selectedProtocols.has(protocol)
                      return (
                        <Button
                          key={protocol}
                          variant={isProtocolSelected ? 'default' : 'outline'}
                          size='sm'
                          onClick={() => {
                            // 获取该协议的所有节点（协议和标签互斥，不考虑标签）
                            const protocolNodeIds = sortedEnabledNodes
                              .filter(
                                (n) => n.protocol.toLowerCase() === protocol
                              )
                              .map((n) => n.id)

                            // 清空标签选择（协议和标签互斥）
                            setSelectedTags(new Set())

                            if (isProtocolSelected) {
                              // 已选中 → 移除该协议的节点
                              setSelectedProtocols((prev) => {
                                const next = new Set(prev)
                                next.delete(protocol)
                                return next
                              })
                              setSelectedNodeIds((prev) => {
                                const next = new Set(prev)
                                protocolNodeIds.forEach((id) => next.delete(id))
                                return next
                              })
                            } else {
                              // 未选中 → 添加该协议的节点
                              setSelectedProtocols(
                                (prev) => new Set([...prev, protocol])
                              )
                              setSelectedNodeIds(
                                (prev) => new Set([...prev, ...protocolNodeIds])
                              )
                            }
                          }}
                        >
                          {protocol.toUpperCase()} ({count})
                        </Button>
                      )
                    })}
                  </div>

                  {/* 标签快速选择按钮（多选模式，与协议互斥） */}
                  {tags.length > 0 && (
                    <div className='mb-4 flex flex-wrap gap-2'>
                      <Button
                        variant={
                          selectedTags.size === 0 &&
                          selectedProtocols.size === 0
                            ? 'default'
                            : 'outline'
                        }
                        size='sm'
                        onClick={() => {
                          // 计算所有节点
                          const allNodeIds = new Set(
                            sortedEnabledNodes.map((n) => n.id)
                          )
                          const currentIds = Array.from(selectedNodeIds).sort()
                          const targetIds = Array.from(allNodeIds).sort()

                          // 如果当前已全选且没有选中协议/标签，则取消全部；否则全选
                          if (
                            selectedProtocols.size === 0 &&
                            selectedTags.size === 0 &&
                            currentIds.length === targetIds.length &&
                            currentIds.every((id, i) => id === targetIds[i])
                          ) {
                            setSelectedNodeIds(new Set())
                          } else {
                            setSelectedProtocols(new Set()) // 清空协议选择
                            setSelectedTags(new Set()) // 清空标签选择
                            setSelectedNodeIds(allNodeIds)
                          }
                        }}
                      >
                        全部标签 ({sortedEnabledNodes.length})
                      </Button>
                      {tags.map((tag) => {
                        const count = sortedEnabledNodes.filter(
                          (n) => n.tag === tag
                        ).length
                        const isTagSelected = selectedTags.has(tag)
                        return (
                          <Button
                            key={tag}
                            variant={isTagSelected ? 'default' : 'outline'}
                            size='sm'
                            onClick={() => {
                              // 获取该标签的所有节点（协议和标签互斥，不考虑协议）
                              const tagNodeIds = sortedEnabledNodes
                                .filter((n) => n.tag === tag)
                                .map((n) => n.id)

                              // 清空协议选择（协议和标签互斥）
                              setSelectedProtocols(new Set())

                              if (isTagSelected) {
                                // 已选中 → 移除该标签的节点
                                setSelectedTags((prev) => {
                                  const next = new Set(prev)
                                  next.delete(tag)
                                  return next
                                })
                                setSelectedNodeIds((prev) => {
                                  const next = new Set(prev)
                                  tagNodeIds.forEach((id) => next.delete(id))
                                  return next
                                })
                              } else {
                                // 未选中 → 添加该标签的节点
                                setSelectedTags(
                                  (prev) => new Set([...prev, tag])
                                )
                                setSelectedNodeIds(
                                  (prev) => new Set([...prev, ...tagNodeIds])
                                )
                              }
                            }}
                          >
                            {tag} ({count})
                          </Button>
                        )
                      })}
                    </div>
                  )}

                  <DataTable
                    data={filteredNodes}
                    getRowKey={(node) => node.id}
                    emptyText='没有找到匹配的节点'
                    containerClassName='max-h-[440px] overflow-y-auto'
                    onRowClick={(node) => handleToggleNode(node.id)}
                    rowClassName={(node) =>
                      selectedNodeIds.has(node.id) ? 'bg-accent' : ''
                    }
                    columns={
                      [
                        {
                          header: (
                            <Checkbox
                              checked={
                                filteredNodes.length > 0 &&
                                filteredNodes.every((n) =>
                                  selectedNodeIds.has(n.id)
                                )
                              }
                              onCheckedChange={handleToggleAll}
                            />
                          ),
                          cell: (node) => (
                            <Checkbox
                              checked={selectedNodeIds.has(node.id)}
                              onCheckedChange={() => handleToggleNode(node.id)}
                            />
                          ),
                          width: '50px',
                        },
                        {
                          header: '节点名称',
                          cell: (node) => <Twemoji>{node.node_name}</Twemoji>,
                          cellClassName: 'font-medium',
                        },
                        {
                          header: '协议',
                          cell: (node) => (
                            <Badge
                              variant='outline'
                              className={getProtocolColor(node.protocol)}
                            >
                              {node.protocol.toUpperCase()}
                            </Badge>
                          ),
                          width: '100px',
                        },
                        {
                          header: '服务器地址',
                          cell: (node) => {
                            let serverAddress = '-'
                            try {
                              if (node.clash_config) {
                                const clashConfig = JSON.parse(
                                  node.clash_config
                                )
                                if (clashConfig.server) {
                                  const port = clashConfig.port
                                    ? `:${clashConfig.port}`
                                    : ''
                                  serverAddress = `${clashConfig.server}${port}`
                                }
                              }
                            } catch (e) {
                              // 解析失败，使用默认值
                            }
                            return (
                              <span className='font-mono text-sm'>
                                {serverAddress}
                              </span>
                            )
                          },
                          headerClassName: 'min-w-[150px]',
                        },
                        {
                          header: '标签',
                          cell: (node) => (
                            <div className='flex flex-wrap gap-1'>
                              {node.tag && (
                                <Badge variant='secondary' className='text-xs'>
                                  {node.tag}
                                </Badge>
                              )}
                            </div>
                          ),
                          width: '100px',
                        },
                      ] as DataTableColumn<SavedNode>[]
                    }
                    mobileCard={{
                      header: (node) => (
                        <div className='space-y-1'>
                          {/* 第一行：协议类型 + 节点名称 */}
                          <div className='flex items-center gap-2'>
                            <Checkbox
                              className='hidden shrink-0 md:flex'
                              checked={selectedNodeIds.has(node.id)}
                              onCheckedChange={() => handleToggleNode(node.id)}
                            />
                            <Badge
                              variant='outline'
                              className={`shrink-0 ${getProtocolColor(node.protocol)}`}
                            >
                              {node.protocol.toUpperCase()}
                            </Badge>
                            <div className='min-w-0 flex-1 truncate text-sm font-medium'>
                              <Twemoji>{node.node_name}</Twemoji>
                            </div>
                          </div>

                          {/* 第二行：标签 + 服务器地址 */}
                          <div className='flex items-center gap-2 text-xs'>
                            {/* 标签部分 */}
                            {node.tag && (
                              <div className='flex shrink-0 items-center gap-1'>
                                <Badge variant='secondary' className='text-xs'>
                                  {node.tag}
                                </Badge>
                              </div>
                            )}

                            {/* 地址部分 */}
                            <span className='text-muted-foreground min-w-0 flex-1 truncate font-mono'>
                              {(() => {
                                let serverAddress = '-'
                                try {
                                  if (node.clash_config) {
                                    const clashConfig = JSON.parse(
                                      node.clash_config
                                    )
                                    if (clashConfig.server) {
                                      const port = clashConfig.port
                                        ? `:${clashConfig.port}`
                                        : ''
                                      serverAddress = `${clashConfig.server}${port}`
                                    }
                                  }
                                } catch (e) {
                                  // 解析失败，使用默认值
                                }
                                return serverAddress
                              })()}
                            </span>
                          </div>
                        </div>
                      ),
                      fields: [],
                    }}
                  />
                </>
              )}

              {/* 规则模式选择 */}
              <div className='space-y-4'>
                <Label>规则模式</Label>
                <div className='flex gap-2'>
                  <Button
                    variant={ruleMode === 'custom' ? 'default' : 'outline'}
                    onClick={() => setRuleMode('custom')}
                    className='flex-1'
                  >
                    自定义规则
                  </Button>
                  <Button
                    variant={ruleMode === 'template' ? 'default' : 'outline'}
                    onClick={() => setRuleMode('template')}
                    className='flex-1'
                  >
                    使用模板
                  </Button>
                </div>
              </div>

              {/* 自定义规则模式 */}
              {ruleMode === 'custom' && (
                <RuleSelector
                  ruleSet={ruleSet}
                  onRuleSetChange={setRuleSet}
                  selectedCategories={selectedCategories}
                  onCategoriesChange={setSelectedCategories}
                />
              )}

              {/* 模板模式 */}
              {ruleMode === 'template' && (
                <div className='space-y-4'>
                  <div className='space-y-2'>
                    <Label htmlFor='template-select'>选择模板</Label>
                    <p className='text-muted-foreground text-sm'>
                      使用 ACL4SSR 规则模板生成配置，自动解析代理组和规则。
                    </p>
                  </div>
                  <div className='space-y-2'>
                    <div className='flex gap-2'>
                      <Select
                        value={selectedTemplateUrl}
                        onValueChange={setSelectedTemplateUrl}
                      >
                        <SelectTrigger id='template-select' className='flex-1'>
                          <SelectValue placeholder='请选择模板' />
                        </SelectTrigger>
                        <SelectContent>
                          {allTemplates.map((template) => (
                            <SelectItem
                              key={template.name}
                              value={template.url}
                            >
                              {template.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant='outline'
                        size='icon'
                        onClick={handlePreviewSelectedSource}
                        disabled={!selectedTemplateUrl}
                        title='查看源文件'
                      >
                        <FileText className='h-4 w-4' />
                      </Button>
                      {useNewTemplateSystem ? (
                        <Button
                          variant='outline'
                          size='icon'
                          onClick={() => setTemplateManageDialogOpen(true)}
                          title='模板管理'
                        >
                          <Settings className='h-4 w-4' />
                        </Button>
                      ) : (
                        <Button
                          variant='outline'
                          size='icon'
                          onClick={() => setOldTemplateManageDialogOpen(true)}
                          title='模板管理'
                        >
                          <Settings className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                    <div className='flex gap-2'>
                      <div
                        className='flex-1'
                        onClick={() => {
                          if (selectedNodeIds.size === 0) {
                            toast.error('请先选择节点')
                          } else if (!selectedTemplateUrl) {
                            toast.error('请先选择模板')
                          }
                        }}
                      >
                        <Button
                          className='w-full'
                          onClick={handleLoadTemplate}
                          disabled={
                            loading ||
                            selectedNodeIds.size === 0 ||
                            !selectedTemplateUrl
                          }
                        >
                          {loading && (
                            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                          )}
                          加载
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {ruleMode === 'custom' && (
                <div className='flex gap-2'>
                  <div
                    className='flex-1'
                    onClick={() => {
                      if (selectedNodeIds.size === 0) {
                        toast.error('请先选择节点')
                      }
                    }}
                  >
                    <Button
                      onClick={handleGenerate}
                      disabled={loading || selectedNodeIds.size === 0}
                      className='w-full'
                    >
                      {loading && (
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      )}
                      {loading ? '生成中...' : '生成订阅文件'}
                    </Button>
                  </div>
                  <Button variant='outline' onClick={handleClear}>
                    清空
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <CustomRulesEditor rules={customRules} onChange={setCustomRules} />

          {clashConfig && (
            <Card>
              <CardHeader>
                <div className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
                  <div>
                    <CardTitle>生成的 Clash 配置</CardTitle>
                    <CardDescription>预览生成的 YAML 配置文件</CardDescription>
                  </div>
                  <ButtonGroup mode='responsive' hideIconOnMobile>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleAutoGroupByRegion}
                    >
                      <MapPin className='h-4 w-4' />
                      地域分组
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleOpenGroupDialog}
                    >
                      <Layers className='h-4 w-4' />
                      手动分组
                    </Button>
                    <Button size='sm' onClick={handleOpenSaveDialog}>
                      <Save className='h-4 w-4' />
                      保存订阅
                    </Button>
                  </ButtonGroup>
                </div>
              </CardHeader>
              <CardContent>
                <div className='bg-muted/30 rounded-lg border'>
                  <Textarea
                    value={clashConfig}
                    onChange={(e) => setClashConfig(e.target.value)}
                    className='min-h-[400px] resize-none border-0 bg-transparent font-mono text-xs'
                    placeholder='生成配置后显示在这里...'
                  />
                </div>
                <div className='mt-4 flex justify-end gap-2'>
                  <Button variant='outline' onClick={handleAutoGroupByRegion}>
                    <MapPin className='mr-2 h-4 w-4' />
                    地域分组
                  </Button>
                  <Button variant='outline' onClick={handleOpenGroupDialog}>
                    <Layers className='mr-2 h-4 w-4' />
                    手动分组
                  </Button>
                  <Button onClick={handleOpenSaveDialog}>
                    <Save className='mr-2 h-4 w-4' />
                    保存订阅
                  </Button>
                </div>
                <div className='bg-muted/50 mt-4 rounded-lg border p-4'>
                  <h3 className='mb-2 font-semibold'>使用说明</h3>
                  <ul className='text-muted-foreground space-y-1 text-sm'>
                    <li>• 点击"保存为订阅"按钮保存为clash yaml格式配置文件</li>
                    <li>• 在订阅链接将订阅地址导入 Clash 客户端即可使用</li>
                    <li>• 支持 Clash、Clash Meta、Mihomo 等客户端</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {/* 保存订阅对话框 */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存为订阅</DialogTitle>
            <DialogDescription>
              将生成的配置保存为订阅文件，保存后可以在订阅管理中查看和使用
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label htmlFor='subscribe-name'>
                订阅名称 <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='subscribe-name'
                placeholder='例如：我的订阅'
                value={subscribeName}
                onChange={(e) => setSubscribeName(e.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='subscribe-filename'>文件名（可选）</Label>
              <Input
                id='subscribe-filename'
                placeholder='默认使用订阅名称'
                value={subscribeFilename}
                onChange={(e) => setSubscribeFilename(e.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                文件将保存到 subscribes 目录，自动添加 .yaml 扩展名
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='subscribe-description'>说明（可选）</Label>
              <Textarea
                id='subscribe-description'
                placeholder='订阅说明...'
                value={subscribeDescription}
                onChange={(e) => setSubscribeDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setSaveDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleSaveSubscribe}
              disabled={saveSubscribeMutation.isPending}
            >
              {saveSubscribeMutation.isPending && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 手动分组对话框 */}
      {!isMobile ? (
        <EditNodesDialog
          open={groupDialogOpen}
          onOpenChange={handleGroupDialogOpenChange}
          title='手动分组节点'
          proxyGroups={proxyGroups}
          availableNodes={availableProxies}
          allNodes={savedNodes.filter((n) => selectedNodeIds.has(n.id))}
          onProxyGroupsChange={setProxyGroups}
          onSave={handleApplyGrouping}
          onConfigureChainProxy={handleConfigureChainProxy}
          showAllNodes={showAllNodes}
          onShowAllNodesChange={setShowAllNodes}
          onRemoveNodeFromGroup={handleRemoveProxy}
          onRemoveGroup={handleRemoveGroup}
          onRenameGroup={handleRenameGroup}
          saveButtonText='确定'
          proxyProviderConfigs={proxyProviderConfigs}
        />
      ) : (
        <MobileEditNodesDialog
          open={groupDialogOpen}
          onOpenChange={handleGroupDialogOpenChange}
          proxyGroups={proxyGroups}
          availableNodes={availableProxies}
          allNodes={savedNodes.filter((n) => selectedNodeIds.has(n.id))}
          onProxyGroupsChange={setProxyGroups}
          onSave={handleApplyGrouping}
          onRemoveNodeFromGroup={handleRemoveProxy}
          onRemoveGroup={handleRemoveGroup}
          onRenameGroup={handleRenameGroup}
          proxyProviderConfigs={proxyProviderConfigs}
        />
      )}

      <MissingNodesReplaceDialog
        open={missingNodesDialogOpen}
        onOpenChange={setMissingNodesDialogOpen}
        missingNodes={missingNodes}
        replacementChoice={replacementChoice}
        onReplacementChoiceChange={setReplacementChoice}
        replacementOptions={missingNodeReplacementOptions}
        onConfirm={handleApplyReplacement}
        confirmText='确认替换'
      />

      {/* 模板管理主对话框 */}
      <Dialog
        open={templateManageDialogOpen}
        onOpenChange={setTemplateManageDialogOpen}
      >
        <DialogContent className='max-w-2xl'>
          <DialogHeader className='flex flex-row items-center justify-between'>
            <div>
              <DialogTitle>模板管理</DialogTitle>
              <DialogDescription>管理 ACL4SSR 规则模板</DialogDescription>
            </div>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='flex justify-end'>
              <Button onClick={handleCreateTemplate}>
                <Plus className='mr-2 h-4 w-4' />
                新建模板
              </Button>
            </div>
            <DataTable
              columns={[
                {
                  header: '名称',
                  cell: (template: Template) => (
                    <span className='font-medium'>{template.name}</span>
                  ),
                },
                {
                  header: '规则源',
                  cell: (template: Template) => (
                    <span
                      className='text-muted-foreground block max-w-[180px] truncate text-sm'
                      title={template.rule_source}
                    >
                      {template.rule_source
                        ? template.rule_source.split('/').pop()
                        : '未配置'}
                    </span>
                  ),
                },
                {
                  header: '操作',
                  cell: (template: Template) => (
                    <div className='flex items-center gap-1'>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => handlePreviewSource(template)}
                        title='查看源文件'
                      >
                        <FileText className='h-4 w-4' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => handlePreviewTemplate(template)}
                        title='预览生成结果'
                      >
                        <Eye className='h-4 w-4' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => handleEditTemplate(template)}
                        title='编辑'
                      >
                        <Pencil className='h-4 w-4' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => handleDeleteTemplate(template.id)}
                        title='删除'
                      >
                        <Trash2 className='text-destructive h-4 w-4' />
                      </Button>
                    </div>
                  ),
                },
              ]}
              data={dbTemplates}
              getRowKey={(template: Template) => template.id}
              emptyText='暂无模板，点击上方按钮创建'
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* 模板表单对话框 */}
      <Dialog
        open={isTemplateFormDialogOpen}
        onOpenChange={setIsTemplateFormDialogOpen}
      >
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? '编辑模板' : '新建模板'}
            </DialogTitle>
            <DialogDescription>配置模板名称和规则源地址</DialogDescription>
          </DialogHeader>

          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label htmlFor='template-name'>
                模板名称 <span className='text-destructive'>*</span>
              </Label>
              <div className='flex gap-2'>
                <Input
                  id='template-name'
                  value={templateFormData.name}
                  onChange={(e) =>
                    setTemplateFormData({
                      ...templateFormData,
                      name: e.target.value,
                    })
                  }
                  placeholder='输入模板名称'
                  className='flex-1'
                />
                {!editingTemplate &&
                  (() => {
                    const available = getAvailablePresets()
                    const hasPresets =
                      available.aethersailor.length > 0 ||
                      available.acl4ssr.length > 0
                    return hasPresets ? (
                      <Select onValueChange={handleTemplatePresetSelect}>
                        <SelectTrigger className='w-[140px]'>
                          <SelectValue placeholder='选择预设' />
                        </SelectTrigger>
                        <SelectContent>
                          {available.aethersailor.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>Aethersailor</SelectLabel>
                              {available.aethersailor.map((preset) => (
                                <SelectItem key={preset.url} value={preset.url}>
                                  {preset.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                          {available.acl4ssr.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>ACL4SSR</SelectLabel>
                              {available.acl4ssr.map((preset) => (
                                <SelectItem key={preset.url} value={preset.url}>
                                  {preset.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                        </SelectContent>
                      </Select>
                    ) : null
                  })()}
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='rule-source'>
                规则源地址 <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='rule-source'
                value={templateFormData.rule_source}
                onChange={(e) =>
                  setTemplateFormData({
                    ...templateFormData,
                    rule_source: e.target.value,
                  })
                }
                placeholder='ACL4SSR 配置 URL'
              />
              <p className='text-muted-foreground text-xs'>
                ACL4SSR 格式的规则配置 URL
              </p>
            </div>

            <div className='flex items-center justify-between'>
              <div className='space-y-0.5'>
                <Label>使用代理下载</Label>
                <p className='text-muted-foreground text-xs'>
                  启用后自动通过 1ms.cc 代理下载
                </p>
              </div>
              <Switch
                checked={templateFormData.use_proxy}
                onCheckedChange={(checked) =>
                  setTemplateFormData({
                    ...templateFormData,
                    use_proxy: checked,
                  })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setIsTemplateFormDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              onClick={handleSubmitTemplate}
              disabled={
                createTemplateMutation.isPending ||
                updateTemplateMutation.isPending ||
                !templateFormData.name.trim() ||
                !templateFormData.rule_source.trim()
              }
            >
              {(createTemplateMutation.isPending ||
                updateTemplateMutation.isPending) && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              {editingTemplate ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 模板删除确认对话框 */}
      <AlertDialog
        open={isTemplateDeleteDialogOpen}
        onOpenChange={setIsTemplateDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除这个模板吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deletingTemplateId &&
                deleteTemplateMutation.mutate(deletingTemplateId)
              }
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 模板预览对话框 */}
      <Dialog
        open={isTemplatePreviewDialogOpen}
        onOpenChange={setIsTemplatePreviewDialogOpen}
      >
        <DialogContent className='max-h-[80vh] max-w-4xl'>
          <DialogHeader>
            <DialogTitle className='flex items-center justify-between'>
              <span>配置预览</span>
            </DialogTitle>
            <DialogDescription>生成的配置文件预览</DialogDescription>
          </DialogHeader>

          <div className='max-h-[60vh] overflow-auto'>
            {isTemplatePreviewLoading ? (
              <div className='flex items-center justify-center py-8'>
                <span className='text-muted-foreground'>正在生成预览...</span>
              </div>
            ) : (
              <pre className='bg-muted rounded-md p-4 font-mono text-xs whitespace-pre-wrap'>
                {templatePreviewContent}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 模板源文件预览对话框 */}
      <Dialog
        open={isSourcePreviewDialogOpen}
        onOpenChange={setIsSourcePreviewDialogOpen}
      >
        <DialogContent className='max-h-[80vh] sm:max-w-[75vw]'>
          <DialogHeader>
            <DialogTitle>源文件预览 - {sourcePreviewTitle}</DialogTitle>
          </DialogHeader>

          <div className='max-h-[60vh] overflow-auto'>
            {isSourcePreviewLoading ? (
              <div className='flex items-center justify-center py-8'>
                <span className='text-muted-foreground'>正在获取源文件...</span>
              </div>
            ) : (
              <pre className='bg-muted rounded-md p-4 font-mono text-xs whitespace-pre-wrap'>
                {sourcePreviewContent}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 旧模板管理对话框 */}
      <Dialog
        open={oldTemplateManageDialogOpen}
        onOpenChange={setOldTemplateManageDialogOpen}
      >
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle>模板管理</DialogTitle>
            <DialogDescription>
              管理 rule_templates 目录下的 YAML 模板文件
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='flex justify-end'>
              <Button
                size='sm'
                onClick={handleUploadOldTemplate}
                disabled={uploadOldTemplateMutation.isPending}
              >
                <Upload className='mr-2 h-4 w-4' />
                {uploadOldTemplateMutation.isPending ? '上传中...' : '上传模板'}
              </Button>
            </div>
            <DataTable
              columns={[
                {
                  header: '文件名',
                  cell: (filename: string) => (
                    <span className='font-medium'>{filename}</span>
                  ),
                },
                {
                  header: '操作',
                  cell: (filename: string) => (
                    <div className='flex items-center gap-1'>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => handleRenameOldTemplate(filename)}
                        title='重命名'
                      >
                        <Pencil className='h-4 w-4' />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => handleDeleteOldTemplate(filename)}
                        title='删除'
                      >
                        <Trash2 className='text-destructive h-4 w-4' />
                      </Button>
                    </div>
                  ),
                },
              ]}
              data={oldTemplates}
              getRowKey={(filename: string) => filename}
              emptyText='暂无模板文件'
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* 旧模板编辑对话框 */}
      <Dialog
        open={oldTemplateEditDialogOpen}
        onOpenChange={setOldTemplateEditDialogOpen}
      >
        <DialogContent className='max-h-[90vh] sm:max-w-[80vw]'>
          <DialogHeader>
            <DialogTitle>编辑模板 - {editingOldTemplate}</DialogTitle>
            <DialogDescription>编辑 YAML 模板文件内容</DialogDescription>
          </DialogHeader>

          <div className='max-h-[60vh] overflow-auto'>
            {isOldTemplateLoading ? (
              <div className='flex items-center justify-center py-8'>
                <span className='text-muted-foreground'>
                  正在加载模板内容...
                </span>
              </div>
            ) : (
              <Textarea
                className='min-h-[400px] font-mono text-xs'
                value={oldTemplateContent}
                onChange={(e) => setOldTemplateContent(e.target.value)}
                placeholder='模板内容'
              />
            )}
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setOldTemplateEditDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              onClick={handleSaveOldTemplate}
              disabled={
                updateOldTemplateMutation.isPending || isOldTemplateLoading
              }
            >
              {updateOldTemplateMutation.isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 旧模板删除确认对话框 */}
      <AlertDialog
        open={isOldTemplateDeleteDialogOpen}
        onOpenChange={setIsOldTemplateDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除模板文件 "{deletingOldTemplate}" 吗？此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deletingOldTemplate &&
                deleteOldTemplateMutation.mutate(deletingOldTemplate)
              }
              className='bg-destructive hover:bg-destructive/90 text-white'
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 旧模板重命名对话框 */}
      <Dialog
        open={isOldTemplateRenameDialogOpen}
        onOpenChange={setIsOldTemplateRenameDialogOpen}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>重命名模板</DialogTitle>
            <DialogDescription>
              将 "{renamingOldTemplate}" 重命名为新文件名
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label htmlFor='new-template-name'>新文件名</Label>
              <div className='flex items-center gap-2'>
                <Input
                  id='new-template-name'
                  value={newOldTemplateName}
                  onChange={(e) => setNewOldTemplateName(e.target.value)}
                  placeholder='输入新的模板名称'
                />
                <span className='text-muted-foreground'>.yaml</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setIsOldTemplateRenameDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              onClick={handleConfirmRenameOldTemplate}
              disabled={
                !newOldTemplateName.trim() ||
                renameOldTemplateMutation.isPending
              }
            >
              {renameOldTemplateMutation.isPending ? '重命名中...' : '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
