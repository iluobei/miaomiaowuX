// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Eye, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Topbar } from '@/components/layout/topbar'
import { api } from '@/lib/api'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'

const TEMPLATE_DRAFT_KEY_PREFIX = 'mmwx_template_v3_draft_'

import { DataTable, type DataTableColumn } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'

import { ProxyGroupEditor } from '@/components/template-v3/proxy-group-editor'
import { TemplatePreview } from '@/components/template-v3/template-preview'
import { TemplateUploadDialog } from '@/components/template-v3/template-upload-dialog'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  extractProxyGroups,
  extractTemplateVariables,
  updateProxyGroups,
  createDefaultFormState,
  generateProxyGroupsPreview,
  generateRegionProxyGroups,
  getRegionProxyGroupNames,
  PROXY_NODES_MARKER,
  PROXY_PROVIDERS_MARKER,
  REGION_PROXY_GROUPS_MARKER,
  getProxyNodesDisplay,
  getProxyProvidersDisplay,
  getRegionProxyGroupsDisplay,
  type ProxyGroupFormState,
} from '@/lib/template-v3-utils'

export const Route = createFileRoute('/templates/')({
  component: TemplatesPage,
})

function TemplatesPage() {
  const { t } = useTranslation('templates')
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 767px)')
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1024px)')

  // Dialog states
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false)
  const [isDraftRecoveryOpen, setIsDraftRecoveryOpen] = useState(false)

  // Editing state
  const [editingTemplateName, setEditingTemplateName] = useState<string | null>(null)
  const [templateContent, setTemplateContent] = useState('')
  const [proxyGroups, setProxyGroups] = useState<ProxyGroupFormState[]>([])
  const [editorTab, setEditorTab] = useState<'visual' | 'yaml'>('visual')
  const [isDirty, setIsDirty] = useState(false)
  const isInitLoadRef = useRef(false)
  const pendingDraftRef = useRef<any>(null)
  const [enableRegionProxyGroups, setEnableRegionProxyGroups] = useState(false)
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({})

  // Delete/Rename state
  const [deletingTemplateName, setDeletingTemplateName] = useState<string | null>(null)
  const [renamingTemplate, setRenamingTemplate] = useState<string | null>(null)
  const [newTemplateName, setNewTemplateName] = useState('')

  // Preview state
  const [previewContent, setPreviewContent] = useState('')
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // List preview state (for eye button in table)
  const [listPreviewOpen, setListPreviewOpen] = useState(false)
  const [listPreviewContent, setListPreviewContent] = useState('')
  const [listPreviewLoading, setListPreviewLoading] = useState(false)
  const [listPreviewTemplateName, setListPreviewTemplateName] = useState<string | null>(null)
  const [listPreviewTemplateContent, setListPreviewTemplateContent] = useState('')

  // Fetch templates list
  const { data: templates = [], isLoading } = useQuery<string[]>({
    queryKey: ['rule-templates'],
    queryFn: async () => {
      const response = await api.get('/api/admin/rule-templates')
      return response.data.templates || []
    },
  })

  // Fetch template content when editing
  const { data: templateData } = useQuery({
    queryKey: ['rule-template', editingTemplateName],
    queryFn: async () => {
      const response = await api.get(`/api/admin/rule-templates/${encodeURIComponent(editingTemplateName!)}`)
      return response.data.content as string
    },
    enabled: !!editingTemplateName && isEditorOpen,
  })

  // Fetch nodes for preview
  const { data: nodesData } = useQuery({
    queryKey: ['nodes-for-preview'],
    queryFn: async () => {
      const response = await api.get('/api/admin/nodes')
      const nodes = response.data.nodes || []
      return nodes.map((node: any) => {
        if (node.clash_config) {
          try {
            return JSON.parse(node.clash_config)
          } catch {
            return { name: node.node_name, type: node.protocol }
          }
        }
        return { name: node.node_name, type: node.protocol }
      }).filter((n: any) => n.name && n.type)
    },
    enabled: isEditorOpen,
  })

  // Update template mutation
  const updateMutation = useMutation({
    mutationFn: async ({ name, content }: { name: string; content: string }) => {
      await api.put(`/api/admin/rule-templates/${encodeURIComponent(name)}`, { content })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rule-templates'] })
      queryClient.invalidateQueries({ queryKey: ['rule-template', editingTemplateName] })
      if (editingTemplateName) {
        localStorage.removeItem(TEMPLATE_DRAFT_KEY_PREFIX + editingTemplateName)
      }
      toast.success(t('toast.saveSuccess'))
      setIsDirty(false)
      setIsEditorOpen(false)
      setEditingTemplateName(null)
      setTemplateContent('')
      setProxyGroups([])
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || t('toast.saveFailed'))
    },
  })

  // Delete template mutation
  const deleteMutation = useMutation({
    mutationFn: async (name: string) => {
      await api.delete(`/api/admin/rule-templates/${encodeURIComponent(name)}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rule-templates'] })
      toast.success(t('toast.deleteSuccess'))
      setIsDeleteDialogOpen(false)
      setDeletingTemplateName(null)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || t('toast.deleteFailed'))
    },
  })

  // Upload template mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('template', file)
      await api.post('/api/admin/rule-templates/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rule-templates'] })
      toast.success(t('toast.uploadSuccess'))
      setIsUploadDialogOpen(false)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || t('toast.uploadFailed'))
    },
  })

  // Create template mutation (for paste/blank)
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
      toast.success(t('toast.createSuccess'))
      setIsUploadDialogOpen(false)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || t('toast.createFailed'))
    },
  })

  // Rename template mutation
  const renameMutation = useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      await api.post('/api/admin/rule-templates/rename', { old_name: oldName, new_name: newName })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rule-templates'] })
      toast.success(t('toast.renameSuccess'))
      setIsRenameDialogOpen(false)
      setRenamingTemplate(null)
      setNewTemplateName('')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || t('toast.renameFailed'))
    },
  })

  // Load template content when data is fetched
  useEffect(() => {
    if (templateData && isEditorOpen) {
      isInitLoadRef.current = true
      setTemplateContent(templateData)
      const vars = extractTemplateVariables(templateData)
      setTemplateVariables(vars)
      const groups = extractProxyGroups(templateData, vars)
      setProxyGroups(groups)
      const hasRegionProxyGroups = groups.some(g => g.includeRegionProxyGroups)
      setEnableRegionProxyGroups(hasRegionProxyGroups)
      setIsDirty(false)
      setTimeout(() => {
        isInitLoadRef.current = false
        if (editingTemplateName) {
          const draftJson = localStorage.getItem(TEMPLATE_DRAFT_KEY_PREFIX + editingTemplateName)
          if (draftJson) {
            try {
              const draft = JSON.parse(draftJson)
              const vars = extractTemplateVariables(templateData)
              const groups = extractProxyGroups(templateData, vars)
              const normalizedData = groups.length > 0 ? updateProxyGroups(templateData, groups) : templateData
              if (draft.templateContent !== normalizedData) {
                pendingDraftRef.current = draft
                setIsDraftRecoveryOpen(true)
              } else {
                localStorage.removeItem(TEMPLATE_DRAFT_KEY_PREFIX + editingTemplateName)
              }
            } catch {
              localStorage.removeItem(TEMPLATE_DRAFT_KEY_PREFIX + editingTemplateName)
            }
          }
        }
      }, 50)
    }
  }, [templateData, isEditorOpen])

  // Auto-refresh proxy-groups preview when proxyGroups changes
  useEffect(() => {
    if (!isEditorOpen) return
    if (proxyGroups.length > 0) {
      setPreviewContent(generateProxyGroupsPreview(proxyGroups))
    } else {
      setPreviewContent('')
    }
  }, [proxyGroups, isEditorOpen])

  // Write draft to localStorage when dirty
  useEffect(() => {
    if (!isDirty || !editingTemplateName || isInitLoadRef.current) return
    let content = templateContent
    if (editorTab === 'visual' && proxyGroups.length > 0) {
      content = updateProxyGroups(templateContent, proxyGroups)
    }
    const draft = {
      templateContent: content,
      proxyGroups,
      enableRegionProxyGroups,
      templateVariables,
      editorTab,
      savedAt: Date.now(),
    }
    localStorage.setItem(TEMPLATE_DRAFT_KEY_PREFIX + editingTemplateName, JSON.stringify(draft))
  }, [isDirty, templateContent, proxyGroups, enableRegionProxyGroups, templateVariables, editorTab, editingTemplateName])

  // Sync proxy groups to YAML when switching tabs
  const syncProxyGroupsToYaml = useCallback(() => {
    if (proxyGroups.length > 0) {
      setTemplateContent(updateProxyGroups(templateContent, proxyGroups))
    }
  }, [proxyGroups, templateContent])

  const handleTabChange = (tab: string) => {
    if (editorTab === 'visual' && tab === 'yaml') {
      syncProxyGroupsToYaml()
    } else if (editorTab === 'yaml' && tab === 'visual') {
      const vars = extractTemplateVariables(templateContent)
      setTemplateVariables(vars)
      setProxyGroups(extractProxyGroups(templateContent, vars))
    }
    setEditorTab(tab as 'visual' | 'yaml')
  }

  const handleEdit = (name: string) => {
    setEditingTemplateName(name)
    setIsEditorOpen(true)
    setEditorTab('visual')
    setPreviewContent('')
  }

  const handleDelete = (name: string) => {
    setDeletingTemplateName(name)
    setIsDeleteDialogOpen(true)
  }

  const handleRename = (name: string) => {
    setRenamingTemplate(name)
    setNewTemplateName(name)
    setIsRenameDialogOpen(true)
  }

  const handleListPreview = async (name: string) => {
    setListPreviewTemplateName(name)
    setListPreviewOpen(true)
    setListPreviewLoading(true)
    setListPreviewContent('')
    setListPreviewTemplateContent('')

    try {
      const templateResponse = await api.get(`/api/admin/rule-templates/${encodeURIComponent(name)}`)
      const content = templateResponse.data.content
      setListPreviewTemplateContent(content)

      const nodesResponse = await api.get('/api/admin/nodes')
      const nodes = (nodesResponse.data.nodes || []).map((node: any) => {
        if (node.clash_config) {
          try {
            return JSON.parse(node.clash_config)
          } catch {
            return { name: node.node_name, type: node.protocol }
          }
        }
        return { name: node.node_name, type: node.protocol }
      }).filter((n: any) => n.name && n.type)

      const previewResponse = await api.post('/api/admin/template-v3/preview', {
        template_content: content,
        proxies: nodes,
      })
      setListPreviewContent(previewResponse.data.content)
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('toast.previewFailed'))
      setListPreviewOpen(false)
    } finally {
      setListPreviewLoading(false)
    }
  }

  const handleSave = () => {
    if (!editingTemplateName) return
    let content = templateContent
    if (editorTab === 'visual') {
      content = updateProxyGroups(templateContent, proxyGroups)
    }
    updateMutation.mutate({ name: editingTemplateName, content })
  }

  const handleCloseEditor = () => {
    if (isDirty) {
      setIsCloseConfirmOpen(true)
      return
    }
    doCloseEditor()
  }

  const doCloseEditor = () => {
    setIsEditorOpen(false)
    setEditingTemplateName(null)
    setTemplateContent('')
    setProxyGroups([])
    setPreviewContent('')
    setIsDirty(false)
    setIsCloseConfirmOpen(false)
    setEnableRegionProxyGroups(false)
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
    setIsDirty(true)
    setTimeout(() => { isInitLoadRef.current = false }, 50)
    setIsDraftRecoveryOpen(false)
    pendingDraftRef.current = null
  }

  const handleDiscardDraft = () => {
    if (editingTemplateName) {
      localStorage.removeItem(TEMPLATE_DRAFT_KEY_PREFIX + editingTemplateName)
    }
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
      const updatedGroups = proxyGroups
        .filter(g => !regionGroupNames.includes(g.name))
        .map(g => ({
          ...g,
          includeRegionProxyGroups: false,
          proxyOrder: g.proxyOrder.filter(item => item !== REGION_PROXY_GROUPS_MARKER),
        }))
      setProxyGroups(updatedGroups)
    }
  }

  const handleProxyGroupChange = (index: number, group: ProxyGroupFormState) => {
    const newGroups = [...proxyGroups]
    newGroups[index] = group
    setProxyGroups(newGroups)
    if (!isInitLoadRef.current) {
      setIsDirty(true)
    }
  }

  const handleProxyGroupDelete = (index: number) => {
    setProxyGroups(proxyGroups.filter((_, i) => i !== index))
    setIsDirty(true)
  }

  const handleProxyGroupMoveUp = (index: number) => {
    if (index === 0) return
    const newGroups = [...proxyGroups]
    ;[newGroups[index - 1], newGroups[index]] = [newGroups[index], newGroups[index - 1]]
    setProxyGroups(newGroups)
    setIsDirty(true)
  }

  const handleProxyGroupMoveDown = (index: number) => {
    if (index === proxyGroups.length - 1) return
    const newGroups = [...proxyGroups]
    ;[newGroups[index], newGroups[index + 1]] = [newGroups[index + 1], newGroups[index]]
    setProxyGroups(newGroups)
    setIsDirty(true)
  }

  const handleAddProxyGroup = () => {
    setProxyGroups([...proxyGroups, createDefaultFormState(t('newProxyGroup', { index: proxyGroups.length + 1 }))])
    setIsDirty(true)
  }

  const handlePreview = async () => {
    setIsPreviewLoading(true)
    try {
      let content = templateContent
      if (editorTab === 'visual') {
        content = updateProxyGroups(templateContent, proxyGroups)
      }
      const response = await api.post('/api/admin/template-v3/preview', {
        template_content: content,
        proxies: nodesData || [],
      })
      setPreviewContent(response.data.content)
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('toast.previewFailed'))
    } finally {
      setIsPreviewLoading(false)
    }
  }

  const handleYamlChange = (value: string) => {
    setTemplateContent(value)
    setIsDirty(true)
  }

  const formatTemplateForDisplay = (content: string) => {
    return content
      .replace(new RegExp(PROXY_NODES_MARKER, 'g'), getProxyNodesDisplay())
      .replace(new RegExp(PROXY_PROVIDERS_MARKER, 'g'), getProxyProvidersDisplay())
      .replace(new RegExp(REGION_PROXY_GROUPS_MARKER, 'g'), getRegionProxyGroupsDisplay())
  }

  // Table columns
  const columns: DataTableColumn<string>[] = [
    {
      header: t('list.templateName'),
      cell: (name) => <span className="font-medium">{name}</span>,
    },
    {
      header: t('list.actions'),
      cell: (name) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(name)} title={t('list.edit')}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleListPreview(name)} title={t('list.preview')}>
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleDelete(name)} title={t('list.delete')}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="min-h-svh bg-background">
      <Topbar />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 pt-24">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>{t('subtitle')}</CardDescription>
          </div>
          <Button onClick={() => setIsUploadDialogOpen(true)} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            {t('list.newTemplate')}
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={templates}
            getRowKey={(name) => name}
            emptyText={t('list.empty')}
            mobileCard={{
              header: (name) => <span className="font-medium text-base">{name}</span>,
              actions: (name) => (
                <div className="flex items-center gap-4 w-full justify-between px-2">
                  <Button variant="ghost" size="sm" onClick={() => handleEdit(name)} className="flex-1">
                    <Pencil className="h-4 w-4 mr-1.5" /> {t('list.edit')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleListPreview(name)} className="flex-1">
                    <Eye className="h-4 w-4 mr-1.5" /> {t('list.preview')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(name)} className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-4 w-4 mr-1.5" /> {t('list.delete')}
                  </Button>
                </div>
              )
            }}
          />
        </CardContent>
      </Card>

      {/* Editor Dialog */}
      <Dialog open={isEditorOpen} onOpenChange={(open) => !open && handleCloseEditor()}>
        <DialogContent className={cn(
          "h-[90vh] flex flex-col",
          isMobile ? "!w-[95vw] !max-w-[95vw] p-4" : "!w-[85vw] !max-w-[85vw]"
        )} showCloseButton={false}>
          <DialogHeader className="flex-shrink-0">
            <div className={cn(
              "flex justify-between gap-4",
              isMobile ? "flex-col items-start" : "items-center"
            )}>
              <div>
                <DialogTitle className="break-all">{editingTemplateName}</DialogTitle>
                <DialogDescription>{t('editor.editTemplate')}</DialogDescription>
              </div>
              <div className={cn(
                "flex items-center gap-2",
                isMobile ? "w-full justify-between" : ""
              )}>
                {isDirty && <Badge variant="secondary">{t('unsaved')}</Badge>}
                <div className="flex gap-2">
                  <Button onClick={handleSave} disabled={updateMutation.isPending} size={isMobile ? "sm" : "default"}>
                    <Save className="h-4 w-4 mr-1 sm:mr-2" />
                    {t('actions.save', { ns: 'common' })}
                  </Button>
                  <Button variant="outline" onClick={handleCloseEditor} size={isMobile ? "sm" : "default"}>
                    {t('editor.close')}
                  </Button>
                </div>
              </div>
            </div>
          </DialogHeader>

          {/* Mobile: Preview below save button */}
          {isMobile && (
            <div className="flex-shrink-0 border-b pb-4 mt-2">
              <Collapsible open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full h-8 text-sm">
                    {isPreviewOpen ? t('collapsePreview') : t('expandPreview')}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4 h-[250px]">
                  <TemplatePreview
                    content={previewContent}
                    isLoading={isPreviewLoading}
                    onRefresh={handlePreview}
                    title={t('previewTitle')}
                    className="h-full"
                  />
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          <div className={cn(
            "flex-1 flex gap-4 overflow-hidden mt-4",
            isMobile ? "flex-col" : "flex-row"
          )}>
            {/* Editor Panel */}
            <div className={cn(
              "flex flex-col overflow-hidden",
              isMobile ? "w-full flex-1" : isTablet ? "w-[55%]" : "w-[40%]"
            )}>
              <Tabs value={editorTab} onValueChange={handleTabChange} className="flex flex-col h-full overflow-hidden">
                <TabsList className="flex-shrink-0 w-full grid grid-cols-2">
                  <TabsTrigger value="visual">{t('visualEdit')}</TabsTrigger>
                  <TabsTrigger value="yaml">{t('yamlCode')}</TabsTrigger>
                </TabsList>

                <TabsContent value="visual" className="flex-1 min-h-0 overflow-hidden mt-4 flex flex-col data-[state=inactive]:hidden">
                  <ScrollArea className="flex-1 h-full">
                    <div className="space-y-3 pb-4 pr-3">
                      {/* Region Proxy Groups Toggle */}
                      <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                          <Label htmlFor="region-toggle" className="font-medium">{t('enableRegionGroups')}</Label>
                          <span className="text-xs text-muted-foreground">{t('enableRegionGroupsDesc')}</span>
                        </div>
                        <Switch
                          id="region-toggle"
                          checked={enableRegionProxyGroups}
                          onCheckedChange={handleRegionProxyGroupsToggle}
                        />
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
                        {t('addProxyGroup')}
                      </Button>
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="yaml" className="flex-1 min-h-0 overflow-hidden mt-4 flex flex-col data-[state=inactive]:hidden">
                  <Textarea
                    value={templateContent}
                    onChange={(e) => handleYamlChange(e.target.value)}
                    className="flex-1 font-mono text-xs sm:text-sm resize-none p-4"
                    placeholder={t('yamlPlaceholder')}
                  />
                </TabsContent>
              </Tabs>
            </div>

            {/* Preview Panel */}
            {!isMobile && (
              <div className={cn(
                "border-l pl-4 flex overflow-hidden",
                isTablet ? "w-[45%]" : "w-[60%]"
              )}>
                <TemplatePreview
                  content={previewContent}
                  isLoading={isPreviewLoading}
                  onRefresh={handlePreview}
                  className="flex-1 h-full"
                  title={t('previewTitle')}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <TemplateUploadDialog
        open={isUploadDialogOpen}
        onOpenChange={setIsUploadDialogOpen}
        onUpload={(file) => uploadMutation.mutate(file)}
        onCreate={(name, content) => createMutation.mutate({ name, content })}
        isLoading={uploadMutation.isPending || createMutation.isPending}
      />

      {/* List Preview Dialog */}
      <Dialog open={listPreviewOpen} onOpenChange={setListPreviewOpen}>
        <DialogContent className={cn(
          "h-[85vh] flex flex-col",
          isMobile ? "!w-[95vw] !max-w-[95vw] p-4" : "!w-[90vw] !max-w-[90vw]"
        )} showCloseButton={false}>
          <DialogHeader className="flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="break-all truncate w-[200px] sm:w-auto">{t('listPreview.title')}: {listPreviewTemplateName}</DialogTitle>
                <DialogDescription className="hidden sm:block">{t('listPreview.description')}</DialogDescription>
              </div>
              <Button variant="outline" onClick={() => setListPreviewOpen(false)} size={isMobile ? "sm" : "default"}>
                {t('editor.close')}
              </Button>
            </div>
          </DialogHeader>
          <div className={cn("flex-1 overflow-hidden flex gap-4", isMobile ? "flex-col" : "flex-row")}>
            {listPreviewLoading ? (
              <div className="flex items-center justify-center w-full h-full">
                <span className="text-muted-foreground">{t('listPreview.generating')}</span>
              </div>
            ) : (
              <>
                <div className={cn("flex flex-col overflow-hidden", isMobile ? "h-1/2 w-full" : "w-1/2")}>
                  <div className="text-sm font-medium mb-2 text-muted-foreground">{t('listPreview.templateConfig')}</div>
                  <Card className="flex-1 overflow-hidden">
                    <ScrollArea className="h-full">
                      <pre className="text-xs p-2 sm:p-4 font-mono whitespace-pre-wrap break-all">
                        {formatTemplateForDisplay(listPreviewTemplateContent)}
                      </pre>
                    </ScrollArea>
                  </Card>
                </div>
                <div className={cn("flex flex-col overflow-hidden", isMobile ? "h-1/2 w-full" : "w-1/2")}>
                  <div className="text-sm font-medium mb-2 text-muted-foreground">{t('listPreview.finalConfig')}</div>
                  <Card className="flex-1 overflow-hidden">
                    <ScrollArea className="h-full">
                      <pre className="text-xs p-2 sm:p-4 font-mono whitespace-pre-wrap break-all">
                        {listPreviewContent}
                      </pre>
                    </ScrollArea>
                  </Card>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm.description', { name: deletingTemplateName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel', { ns: 'common' })}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingTemplateName && deleteMutation.mutate(deletingTemplateName)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('actions.delete', { ns: 'common' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Dialog */}
      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('renameDialog.title')}</DialogTitle>
            <DialogDescription>{t('renameDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              placeholder={t('renameDialog.placeholder')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameDialogOpen(false)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button
              onClick={() => renamingTemplate && renameMutation.mutate({ oldName: renamingTemplate, newName: newTemplateName })}
              disabled={renameMutation.isPending || !newTemplateName.trim()}
            >
              {t('actions.confirm', { ns: 'common' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Confirmation Dialog */}
      <AlertDialog open={isCloseConfirmOpen} onOpenChange={setIsCloseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('closeConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('closeConfirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel', { ns: 'common' })}</AlertDialogCancel>
            <AlertDialogAction onClick={doCloseEditor}>{t('closeConfirm.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Draft Recovery Dialog */}
      <AlertDialog open={isDraftRecoveryOpen} onOpenChange={setIsDraftRecoveryOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('draftRecovery.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('draftRecovery.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscardDraft}>{t('draftRecovery.discard')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecoverDraft}>{t('draftRecovery.recover')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </main>
    </div>
  )
}
