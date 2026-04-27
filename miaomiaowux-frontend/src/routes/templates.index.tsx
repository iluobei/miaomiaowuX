// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Save, RefreshCw, RotateCcw } from 'lucide-react'

import { Topbar } from '@/components/layout/topbar'
import { api } from '@/lib/api'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

import { ProxyGroupEditor } from '@/components/template-v3/proxy-group-editor'
import { TemplatePreview } from '@/components/template-v3/template-preview'
import {
  extractProxyGroups,
  extractTemplateVariables,
  updateProxyGroups,
  createDefaultFormState,
  parseTemplate,
  generateProxyGroupsPreview,
  generateRegionProxyGroups,
  getRegionProxyGroupNames,
  REGION_PROXY_GROUPS_MARKER,
  type ProxyGroupFormState,
} from '@/lib/template-v3-utils'

export const Route = createFileRoute('/templates/')({
  component: TemplatesPage,
})

const TEMPLATE_DRAFT_KEY = 'mmwx_template_v3_draft'
const DEFAULT_TEMPLATE_NAME = 'default.yaml'

const REDIR_HOST_TEMPLATE = 'redirhost__v3.yaml'
const FAKE_IP_TEMPLATE = 'fake_ip__v3.yaml'

function getDnsMode(content: string): 'redir-host' | 'fake-ip' {
  const parsed = parseTemplate(content)
  const mode = (parsed?.dns as any)?.['enhanced-mode']
  return mode === 'fake-ip' ? 'fake-ip' : 'redir-host'
}

function getDefaultTemplateName(mode: 'redir-host' | 'fake-ip'): string {
  return mode === 'fake-ip' ? FAKE_IP_TEMPLATE : REDIR_HOST_TEMPLATE
}

function TemplatesPage() {
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 767px)')
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1024px)')

  const [templateContent, setTemplateContent] = useState('')
  const [proxyGroups, setProxyGroups] = useState<ProxyGroupFormState[]>([])
  const [editorTab, setEditorTab] = useState<'visual' | 'yaml'>('visual')
  const [isDirty, setIsDirty] = useState(false)
  const isInitLoadRef = useRef(false)
  const pendingDraftRef = useRef<any>(null)
  const [enableRegionProxyGroups, setEnableRegionProxyGroups] = useState(false)
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({})
  const [isDraftRecoveryOpen, setIsDraftRecoveryOpen] = useState(false)
  const [dnsMode, setDnsMode] = useState<'redir-host' | 'fake-ip'>('redir-host')
  const [isSwitchConfirmOpen, setIsSwitchConfirmOpen] = useState(false)
  const [pendingSwitchMode, setPendingSwitchMode] = useState<'redir-host' | 'fake-ip' | null>(null)
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)

  const [previewContent, setPreviewContent] = useState('')
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  const [templateName, setTemplateName] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  // Fetch templates list to find the first one (or default.yaml)
  const { data: templates = [], isLoading: isListLoading } = useQuery<string[]>({
    queryKey: ['rule-templates'],
    queryFn: async () => {
      const response = await api.get('/api/admin/rule-templates')
      return response.data.templates || []
    },
  })

  // Determine which template to use
  useEffect(() => {
    if (isListLoading) return
    if (templates.length > 0) {
      const name = templates.includes(DEFAULT_TEMPLATE_NAME) ? DEFAULT_TEMPLATE_NAME : templates[0]
      setTemplateName(name)
    } else {
      setTemplateName(null)
      setIsLoaded(true)
    }
  }, [templates, isListLoading])

  // Fetch template content
  const { data: templateData } = useQuery({
    queryKey: ['rule-template', templateName],
    queryFn: async () => {
      const response = await api.get(`/api/admin/rule-templates/${encodeURIComponent(templateName!)}`)
      return response.data.content as string
    },
    enabled: !!templateName,
  })

  // Fetch nodes for preview
  const { data: nodesData } = useQuery({
    queryKey: ['nodes-for-preview'],
    queryFn: async () => {
      const response = await api.get('/api/admin/nodes')
      const nodes = response.data.nodes || []
      return nodes.map((node: any) => {
        if (node.clash_config) {
          try { return JSON.parse(node.clash_config) } catch { return { name: node.node_name, type: node.protocol } }
        }
        return { name: node.node_name, type: node.protocol }
      }).filter((n: any) => n.name && n.type)
    },
  })

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async ({ name, content }: { name: string; content: string }) => {
      await api.put(`/api/admin/rule-templates/${encodeURIComponent(name)}`, { content })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rule-templates'] })
      queryClient.invalidateQueries({ queryKey: ['rule-template', templateName] })
      localStorage.removeItem(TEMPLATE_DRAFT_KEY)
      toast.success('模板保存成功')
      setIsDirty(false)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '保存失败')
    },
  })

  // Create default template mutation
  const createMutation = useMutation({
    mutationFn: async ({ name, content }: { name: string; content: string }) => {
      const formData = new FormData()
      const blob = new Blob([content], { type: 'text/yaml' })
      formData.append('template', blob, name)
      await api.post('/api/admin/rule-templates/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rule-templates'] })
      setTemplateName(DEFAULT_TEMPLATE_NAME)
      toast.success('默认模板已创建')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '创建失败')
    },
  })

  // Load template content
  useEffect(() => {
    if (!templateData) return
    isInitLoadRef.current = true
    setTemplateContent(templateData)
    setDnsMode(getDnsMode(templateData))
    const vars = extractTemplateVariables(templateData)
    setTemplateVariables(vars)
    const groups = extractProxyGroups(templateData, vars)
    setProxyGroups(groups)
    const hasRegion = groups.some(g => g.includeRegionProxyGroups)
    setEnableRegionProxyGroups(hasRegion)
    setIsDirty(false)
    setIsLoaded(true)
    setTimeout(() => {
      isInitLoadRef.current = false
      const draftJson = localStorage.getItem(TEMPLATE_DRAFT_KEY)
      if (draftJson) {
        try {
          const draft = JSON.parse(draftJson)
          const vars2 = extractTemplateVariables(templateData)
          const groups2 = extractProxyGroups(templateData, vars2)
          const normalized = groups2.length > 0 ? updateProxyGroups(templateData, groups2) : templateData
          if (draft.templateContent !== normalized) {
            pendingDraftRef.current = draft
            setIsDraftRecoveryOpen(true)
          } else {
            localStorage.removeItem(TEMPLATE_DRAFT_KEY)
          }
        } catch { localStorage.removeItem(TEMPLATE_DRAFT_KEY) }
      }
    }, 50)
  }, [templateData])

  // Auto-refresh preview when proxyGroups changes
  useEffect(() => {
    if (proxyGroups.length > 0) {
      setPreviewContent(generateProxyGroupsPreview(proxyGroups))
    } else {
      setPreviewContent('')
    }
  }, [proxyGroups])

  // Save draft to localStorage
  useEffect(() => {
    if (!isDirty || !templateName || isInitLoadRef.current) return
    let content = templateContent
    if (editorTab === 'visual' && proxyGroups.length > 0) {
      content = updateProxyGroups(templateContent, proxyGroups)
    }
    localStorage.setItem(TEMPLATE_DRAFT_KEY, JSON.stringify({
      templateContent: content, proxyGroups, enableRegionProxyGroups, templateVariables, editorTab, savedAt: Date.now(),
    }))
  }, [isDirty, templateContent, proxyGroups, enableRegionProxyGroups, templateVariables, editorTab, templateName])

  const syncProxyGroupsToYaml = useCallback(() => {
    if (proxyGroups.length > 0) {
      setTemplateContent(updateProxyGroups(templateContent, proxyGroups))
    }
  }, [proxyGroups, templateContent])

  const handleTabChange = (tab: string) => {
    if (editorTab === 'visual' && tab === 'yaml') syncProxyGroupsToYaml()
    else if (editorTab === 'yaml' && tab === 'visual') {
      const vars = extractTemplateVariables(templateContent)
      setTemplateVariables(vars)
      setProxyGroups(extractProxyGroups(templateContent, vars))
    }
    setEditorTab(tab as 'visual' | 'yaml')
  }

  const handleSave = () => {
    if (!templateName) return
    let content = templateContent
    if (editorTab === 'visual') content = updateProxyGroups(templateContent, proxyGroups)
    saveMutation.mutate({ name: templateName, content })
  }

  const applyTemplateContent = useCallback((content: string) => {
    isInitLoadRef.current = true
    setTemplateContent(content)
    setDnsMode(getDnsMode(content))
    const vars = extractTemplateVariables(content)
    setTemplateVariables(vars)
    const groups = extractProxyGroups(content, vars)
    setProxyGroups(groups)
    const hasRegion = groups.some(g => g.includeRegionProxyGroups)
    setEnableRegionProxyGroups(hasRegion)
    setIsDirty(true)
    setTimeout(() => { isInitLoadRef.current = false }, 50)
  }, [])

  const handleDnsModeSwitch = async (mode: 'redir-host' | 'fake-ip') => {
    if (mode === dnsMode) return
    if (isDirty) {
      setPendingSwitchMode(mode)
      setIsSwitchConfirmOpen(true)
      return
    }
    await doSwitchDnsMode(mode)
  }

  const doSwitchDnsMode = async (mode: 'redir-host' | 'fake-ip') => {
    try {
      const name = getDefaultTemplateName(mode)
      const response = await api.get(`/api/admin/rule-templates/${encodeURIComponent(name)}`)
      applyTemplateContent(response.data.content)
    } catch (error: any) {
      toast.error(error.response?.data?.error || '加载模板失败')
    }
  }

  const handleConfirmSwitch = async () => {
    setIsSwitchConfirmOpen(false)
    if (pendingSwitchMode) {
      await doSwitchDnsMode(pendingSwitchMode)
      setPendingSwitchMode(null)
    }
  }

  const handleReset = () => {
    setIsResetConfirmOpen(true)
  }

  const handleConfirmReset = async () => {
    setIsResetConfirmOpen(false)
    try {
      const name = getDefaultTemplateName(dnsMode)
      const response = await api.get(`/api/admin/rule-templates/${encodeURIComponent(name)}`)
      applyTemplateContent(response.data.content)
    } catch (error: any) {
      toast.error(error.response?.data?.error || '重置失败')
    }
  }

  const handleCreateDefault = async () => {
    try {
      const response = await api.get(`/api/admin/rule-templates/${encodeURIComponent(REDIR_HOST_TEMPLATE)}`)
      createMutation.mutate({ name: DEFAULT_TEMPLATE_NAME, content: response.data.content })
    } catch (error: any) {
      toast.error(error.response?.data?.error || '创建失败')
    }
  }

  const handleRecoverDraft = () => {
    const draft = pendingDraftRef.current
    if (!draft) return
    isInitLoadRef.current = true
    setTemplateContent(draft.templateContent)
    setProxyGroups(draft.proxyGroups)
    setEnableRegionProxyGroups(draft.enableRegionProxyGroups)
    setTemplateVariables(draft.templateVariables)
    setEditorTab(draft.editorTab)
    setDnsMode(getDnsMode(draft.templateContent))
    setIsDirty(true)
    setTimeout(() => { isInitLoadRef.current = false }, 50)
    setIsDraftRecoveryOpen(false)
    pendingDraftRef.current = null
  }

  const handleDiscardDraft = () => {
    localStorage.removeItem(TEMPLATE_DRAFT_KEY)
    setIsDraftRecoveryOpen(false)
    pendingDraftRef.current = null
  }

  const regionGroupNames = getRegionProxyGroupNames()

  const handleRegionProxyGroupsToggle = (enabled: boolean) => {
    setEnableRegionProxyGroups(enabled)
    setIsDirty(true)
    if (enabled) {
      const regionGroups = generateRegionProxyGroups('url-test')
      const nonRegionGroups = proxyGroups.filter(g => !regionGroupNames.includes(g.name))
      setProxyGroups([...nonRegionGroups, ...regionGroups])
    } else {
      setProxyGroups(
        proxyGroups
          .filter(g => !regionGroupNames.includes(g.name))
          .map(g => ({ ...g, includeRegionProxyGroups: false, proxyOrder: g.proxyOrder.filter(item => item !== REGION_PROXY_GROUPS_MARKER) }))
      )
    }
  }

  const handleProxyGroupChange = (index: number, group: ProxyGroupFormState) => {
    const newGroups = [...proxyGroups]
    newGroups[index] = group
    setProxyGroups(newGroups)
    if (!isInitLoadRef.current) setIsDirty(true)
  }

  const handleProxyGroupDelete = (index: number) => {
    setProxyGroups(proxyGroups.filter((_, i) => i !== index))
    setIsDirty(true)
  }

  const handleProxyGroupMoveUp = (index: number) => {
    if (index === 0) return
    const g = [...proxyGroups]
    ;[g[index - 1], g[index]] = [g[index], g[index - 1]]
    setProxyGroups(g)
    setIsDirty(true)
  }

  const handleProxyGroupMoveDown = (index: number) => {
    if (index === proxyGroups.length - 1) return
    const g = [...proxyGroups]
    ;[g[index], g[index + 1]] = [g[index + 1], g[index]]
    setProxyGroups(g)
    setIsDirty(true)
  }

  const handleAddProxyGroup = () => {
    setProxyGroups([...proxyGroups, createDefaultFormState(`新代理组 ${proxyGroups.length + 1}`)])
    setIsDirty(true)
  }

  const handlePreview = async () => {
    setIsPreviewLoading(true)
    try {
      let content = templateContent
      if (editorTab === 'visual') content = updateProxyGroups(templateContent, proxyGroups)
      const response = await api.post('/api/admin/template-v3/preview', {
        template_content: content,
        proxies: nodesData || [],
      })
      setPreviewContent(response.data.content)
    } catch (error: any) {
      toast.error(error.response?.data?.error || '预览生成失败')
    } finally {
      setIsPreviewLoading(false)
    }
  }

  const handleYamlChange = (value: string) => {
    setTemplateContent(value)
    setIsDirty(true)
  }

  // Empty state: no template exists yet
  if (isLoaded && !templateName) {
    return (
      <div className="min-h-svh bg-background">
        <Topbar />
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 pt-24">
          <Card>
            <CardHeader>
              <CardTitle>模板管理</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <p className="text-muted-foreground">尚未创建模板，点击下方按钮创建默认模板</p>
                <Button onClick={handleCreateDefault} disabled={createMutation.isPending}>
                  <Plus className="h-4 w-4 mr-2" />
                  创建默认模板
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  // Loading state
  if (!isLoaded || isListLoading) {
    return (
      <div className="min-h-svh bg-background">
        <Topbar />
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 pt-24">
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <span className="text-muted-foreground">加载中...</span>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-svh bg-background">
      <Topbar />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 pt-24 space-y-4">
      {/* Header */}
      <div className={cn("flex justify-between gap-4", isMobile ? "flex-col" : "items-center")}>
        <div>
          <h2 className="text-lg font-semibold">模板管理</h2>
          <p className="text-sm text-muted-foreground">mihomo 订阅模板配置</p>
        </div>
        <div className={cn("flex items-center gap-2 flex-wrap", isMobile ? "justify-between" : "")}>
          {isDirty && <Badge variant="secondary">未保存</Badge>}
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            <Button
              variant={dnsMode === 'redir-host' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleDnsModeSwitch('redir-host')}
            >
              redir-host
            </Button>
            <Button
              variant={dnsMode === 'fake-ip' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleDnsModeSwitch('fake-ip')}
            >
              fake-ip
            </Button>
          </div>
          <Button variant="outline" onClick={handleReset} size={isMobile ? "sm" : "default"} title="重置为默认模板">
            <RotateCcw className="h-4 w-4 mr-1.5" />
            重置
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending} size={isMobile ? "sm" : "default"}>
            <Save className="h-4 w-4 mr-1.5" />
            保存
          </Button>
        </div>
      </div>

      {/* Mobile: collapsible preview */}
      {isMobile && (
        <Collapsible open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full h-8 text-sm">
              {isPreviewOpen ? '收起配置预览' : '展开配置预览'}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 h-[250px]">
            <TemplatePreview content={previewContent} isLoading={isPreviewLoading} onRefresh={handlePreview} title="配置预览" className="h-full" />
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Main layout */}
      <div className={cn("flex gap-4", isMobile ? "flex-col" : "flex-row", !isMobile && "h-[calc(100vh-200px)]")}>
        {/* Editor panel */}
        <div className={cn("flex flex-col overflow-hidden", isMobile ? "w-full min-h-[500px]" : isTablet ? "w-[55%]" : "w-[40%]")}>
          <Tabs value={editorTab} onValueChange={handleTabChange} className="flex flex-col h-full overflow-hidden">
            <TabsList className="flex-shrink-0 w-full grid grid-cols-2">
              <TabsTrigger value="visual">可视化编辑</TabsTrigger>
              <TabsTrigger value="yaml">YAML 代码</TabsTrigger>
            </TabsList>

            <TabsContent value="visual" className="flex-1 min-h-0 overflow-hidden mt-4 flex flex-col data-[state=inactive]:hidden">
              <ScrollArea className="flex-1 h-full">
                <div className="space-y-3 pb-4 pr-3">
                  <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                      <Label htmlFor="region-toggle" className="font-medium">开启区域代理组</Label>
                      <span className="text-xs text-muted-foreground">自动添加按地区分类的代理组</span>
                    </div>
                    <Switch id="region-toggle" checked={enableRegionProxyGroups} onCheckedChange={handleRegionProxyGroupsToggle} />
                  </div>

                  {proxyGroups.map((group, index) => (
                    <ProxyGroupEditor
                      key={index}
                      group={group}
                      index={index}
                      allGroupNames={proxyGroups.map(g => g.name)}
                      onChange={handleProxyGroupChange}
                      onDelete={handleProxyGroupDelete}
                      onMoveUp={handleProxyGroupMoveUp}
                      onMoveDown={handleProxyGroupMoveDown}
                      isFirst={index === 0}
                      isLast={index === proxyGroups.length - 1}
                      showRegionToggle={enableRegionProxyGroups}
                      isRegionGroup={regionGroupNames.includes(group.name)}
                      variables={templateVariables}
                    />
                  ))}
                  <Button variant="outline" className="w-full mt-2" onClick={handleAddProxyGroup}>
                    <Plus className="h-4 w-4 mr-2" />
                    添加代理组
                  </Button>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="yaml" className="flex-1 min-h-0 overflow-hidden mt-4 flex flex-col data-[state=inactive]:hidden">
              <Textarea
                value={templateContent}
                onChange={(e) => handleYamlChange(e.target.value)}
                className="flex-1 font-mono text-xs sm:text-sm resize-none p-4"
                placeholder="YAML 内容..."
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Preview panel - desktop/tablet only */}
        {!isMobile && (
          <div className={cn("border-l pl-4 flex overflow-hidden", isTablet ? "w-[45%]" : "w-[60%]")}>
            <TemplatePreview content={previewContent} isLoading={isPreviewLoading} onRefresh={handlePreview} className="flex-1 h-full" title="配置预览" />
          </div>
        )}
      </div>

      {/* Draft Recovery Dialog */}
      <AlertDialog open={isDraftRecoveryOpen} onOpenChange={setIsDraftRecoveryOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复本地缓存</AlertDialogTitle>
            <AlertDialogDescription>检测到未保存的本地缓存，是否恢复？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscardDraft}>放弃</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecoverDraft}>恢复</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* DNS Switch Confirm Dialog */}
      <AlertDialog open={isSwitchConfirmOpen} onOpenChange={setIsSwitchConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>切换 DNS 模式</AlertDialogTitle>
            <AlertDialogDescription>当前有未保存的更改，切换模式将丢失这些更改。是否继续？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingSwitchMode(null)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSwitch}>确认切换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Confirm Dialog */}
      <AlertDialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置模板</AlertDialogTitle>
            <AlertDialogDescription>将恢复为当前 DNS 模式的默认模板，所有未保存的更改将丢失。是否继续？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmReset}>确认重置</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </main>
    </div>
  )
}
