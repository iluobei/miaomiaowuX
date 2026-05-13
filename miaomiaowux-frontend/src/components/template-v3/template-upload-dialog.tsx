import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Upload, FileText, Plus, RefreshCw, Wand2, Link } from 'lucide-react'
import { toast } from 'sonner'
import { createBlankTemplate } from '@/lib/template-v3-utils'
import { api } from '@/lib/api'
import { RULE_TEMPLATES } from '@/config/custom-rules-templates'
import { ALL_TEMPLATE_PRESETS } from '@/lib/template-presets'

interface UserTemplate {
  id: number
  name: string
  rule_source: string
}

interface SubscribeFile {
  id: number
  name: string
  filename: string
  description: string
}

interface TemplateUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpload: (file: File) => void
  onCreate: (name: string, content: string) => void
  isLoading?: boolean
}

export function TemplateUploadDialog({
  open,
  onOpenChange,
  onUpload,
  onCreate,
  isLoading = false,
}: TemplateUploadDialogProps) {
  const { t } = useTranslation('templates')
  const [tab, setTab] = useState<'upload' | 'paste' | 'blank' | 'v2import' | 'fromSub' | 'fromUrl'>('upload')
  const [pasteContent, setPasteContent] = useState('')
  const [newTemplateName, setNewTemplateName] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isConverting, setIsConverting] = useState(false)
  const [selectedDnsPreset, setSelectedDnsPreset] = useState<string>('fake_ip_no_dnsleak')

  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>([])
  const [selectedV2Template, setSelectedV2Template] = useState<string>('')
  const [isFetchingTemplates, setIsFetchingTemplates] = useState(false)

  const [subscribeFiles, setSubscribeFiles] = useState<SubscribeFile[]>([])
  const [selectedSubscription, setSelectedSubscription] = useState<string>('')
  const [isFetchingSubscriptions, setIsFetchingSubscriptions] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisPreview, setAnalysisPreview] = useState<string>('')

  const [importUrl, setImportUrl] = useState('')
  const [isFetchingUrl, setIsFetchingUrl] = useState(false)
  const [urlPreview, setUrlPreview] = useState('')

  useEffect(() => {
    if (open && tab === 'v2import' && userTemplates.length === 0) {
      fetchUserTemplates()
    }
  }, [open, tab])

  useEffect(() => {
    if (open && tab === 'fromSub' && subscribeFiles.length === 0) {
      fetchSubscriptions()
    }
  }, [open, tab])

  const fetchUserTemplates = async () => {
    setIsFetchingTemplates(true)
    try {
      const response = await api.get('/api/admin/templates')
      setUserTemplates(response.data.templates || [])
    } catch {
      toast.error(t('upload.fetchTemplatesFailed'))
    } finally {
      setIsFetchingTemplates(false)
    }
  }

  const fetchSubscriptions = async () => {
    setIsFetchingSubscriptions(true)
    try {
      const response = await api.get('/api/admin/subscribe-files')
      setSubscribeFiles(response.data.files || [])
    } catch {
      toast.error(t('upload.fetchSubscriptionsFailed'))
    } finally {
      setIsFetchingSubscriptions(false)
    }
  }

  const resetForm = () => {
    setPasteContent('')
    setNewTemplateName('')
    setSelectedFile(null)
    setSelectedDnsPreset('fake_ip_no_dnsleak')
    setSelectedV2Template('')
    setSelectedSubscription('')
    setAnalysisPreview('')
    setImportUrl('')
    setUrlPreview('')
    setTab('upload')
  }

  const handleClose = () => {
    resetForm()
    onOpenChange(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.name.endsWith('.yaml') && !file.name.endsWith('.yml')) {
        toast.error(t('upload.yamlOnly'))
        return
      }
      setSelectedFile(file)
    }
  }

  const handleSubmit = () => {
    if (tab === 'upload') {
      if (!selectedFile) {
        toast.error(t('upload.selectFile'))
        return
      }
      onUpload(selectedFile)
    } else if (tab === 'paste') {
      if (!pasteContent.trim()) {
        toast.error(t('upload.enterContent'))
        return
      }
      if (!newTemplateName.trim()) {
        toast.error(t('upload.enterName'))
        return
      }
      let name = newTemplateName.trim()
      if (!name.endsWith('.yaml') && !name.endsWith('.yml')) {
        name += '.yaml'
      }
      onCreate(name, pasteContent)
    } else if (tab === 'blank') {
      if (!newTemplateName.trim()) {
        toast.error(t('upload.enterName'))
        return
      }
      let name = newTemplateName.trim()
      if (!name.endsWith('.yaml') && !name.endsWith('.yml')) {
        name += '.yaml'
      }
      onCreate(name, createBlankTemplate())
    } else if (tab === 'v2import') {
      handleV2Import()
      return
    } else if (tab === 'fromSub') {
      handleFromSubscription()
      return
    } else if (tab === 'fromUrl') {
      handleFromUrl()
      return
    }
    resetForm()
  }

  const handleFromSubscription = async () => {
    if (!selectedSubscription) {
      toast.error(t('upload.selectSubscription'))
      return
    }
    if (!newTemplateName.trim()) {
      toast.error(t('upload.enterName'))
      return
    }

    setIsAnalyzing(true)
    try {
      const response = await api.post('/api/admin/template-v3/analyze-subscription', {
        subscription_filename: selectedSubscription,
      })

      const { template_content } = response.data

      let name = newTemplateName.trim()
      if (!name.endsWith('.yaml') && !name.endsWith('.yml')) {
        name += '.yaml'
      }

      onCreate(name, template_content)
      resetForm()
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('upload.analyzeFailed'))
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleAnalyzePreview = async () => {
    if (!selectedSubscription) {
      toast.error(t('upload.selectSubscription'))
      return
    }

    setIsAnalyzing(true)
    try {
      const response = await api.post('/api/admin/template-v3/analyze-subscription', {
        subscription_filename: selectedSubscription,
      })

      setAnalysisPreview(response.data.template_content)

      const sub = subscribeFiles.find(s => s.filename === selectedSubscription)
      if (sub && !newTemplateName) {
        setNewTemplateName(sub.name)
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('upload.analyzeFailed'))
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleFromUrl = async () => {
    if (!importUrl.trim()) {
      toast.error(t('upload.enterUrl'))
      return
    }
    if (!newTemplateName.trim()) {
      toast.error(t('upload.enterName'))
      return
    }

    setIsFetchingUrl(true)
    try {
      const content = urlPreview || await fetchUrlContent(importUrl.trim())

      let name = newTemplateName.trim()
      if (!name.endsWith('.yaml') && !name.endsWith('.yml')) {
        name += '.yaml'
      }

      onCreate(name, content)
      resetForm()
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('upload.fetchUrlFailed'))
    } finally {
      setIsFetchingUrl(false)
    }
  }

  const handleUrlPreview = async () => {
    if (!importUrl.trim()) {
      toast.error(t('upload.enterUrl'))
      return
    }

    setIsFetchingUrl(true)
    try {
      const content = await fetchUrlContent(importUrl.trim())
      setUrlPreview(content)
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('upload.fetchUrlFailed'))
    } finally {
      setIsFetchingUrl(false)
    }
  }

  const fetchUrlContent = async (url: string): Promise<string> => {
    const response = await api.post('/api/admin/templates/fetch-source', {
      url,
      use_proxy: false,
    })
    return response.data.content
  }

  const handleV2Import = async () => {
    if (!selectedV2Template) {
      toast.error(t('upload.selectV2Template'))
      return
    }
    if (!newTemplateName.trim()) {
      toast.error(t('upload.enterName'))
      return
    }

    setIsConverting(true)
    try {
      let ruleSourceUrl: string
      if (selectedV2Template.startsWith('user:')) {
        const templateId = selectedV2Template.replace('user:', '')
        const template = userTemplates.find(t => t.id.toString() === templateId)
        if (!template) {
          toast.error(t('upload.templateNotFound'))
          return
        }
        ruleSourceUrl = template.rule_source
      } else if (selectedV2Template.startsWith('preset:')) {
        const presetName = selectedV2Template.replace('preset:', '')
        const preset = ALL_TEMPLATE_PRESETS.find(p => p.name === presetName)
        if (!preset) {
          toast.error(t('upload.presetNotFound'))
          return
        }
        ruleSourceUrl = preset.url
      } else {
        toast.error(t('upload.invalidSelection'))
        return
      }

      const fetchResponse = await api.post('/api/admin/templates/fetch-source', {
        url: ruleSourceUrl,
        use_proxy: false,
      })
      const v2Content = fetchResponse.data.content

      const response = await api.post('/api/admin/template-v3/convert-v2', {
        content: v2Content,
      })

      const { proxy_groups, rules, rule_providers } = response.data

      const v3Content = generateV3TemplateFromConversion(proxy_groups, rules, rule_providers)

      let name = newTemplateName.trim()
      if (!name.endsWith('.yaml') && !name.endsWith('.yml')) {
        name += '.yaml'
      }

      onCreate(name, v3Content)
      resetForm()
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('upload.convertFailed'))
    } finally {
      setIsConverting(false)
    }
  }

  const generateV3TemplateFromConversion = (
    proxyGroups: any[],
    rules: string[],
    ruleProviders: Record<string, any>
  ): string => {
    const lines: string[] = []

    lines.push('mode: rule')

    const dnsPreset = RULE_TEMPLATES.dns[selectedDnsPreset as keyof typeof RULE_TEMPLATES.dns]
    if (dnsPreset) {
      lines.push('dns:')
      const dnsLines = dnsPreset.content.split('\n')
      for (const line of dnsLines) {
        lines.push('  ' + line)
      }
    } else {
      lines.push('dns:')
      lines.push('  enable: true')
      lines.push('  enhanced-mode: fake-ip')
      lines.push('  nameserver:')
      lines.push('    - https://doh.pub/dns-query')
      lines.push('  ipv6: false')
    }

    lines.push('proxies: null')

    lines.push('proxy-groups:')
    for (const group of proxyGroups) {
      lines.push(`  - name: ${group.name}`)
      lines.push(`    type: ${group.type}`)
      if (group['include-all']) {
        lines.push('    include-all: true')
      }
      if (group['include-all-proxies']) {
        lines.push('    include-all-proxies: true')
      }
      if (group.filter) {
        lines.push(`    filter: ${group.filter}`)
      }
      if (group['exclude-filter']) {
        lines.push(`    exclude-filter: ${group['exclude-filter']}`)
      }
      if (group.proxies && group.proxies.length > 0) {
        lines.push('    proxies:')
        for (const proxy of group.proxies) {
          lines.push(`      - ${proxy}`)
        }
      }
      if (group.url) {
        lines.push(`    url: ${group.url}`)
      }
      if (group.interval) {
        lines.push(`    interval: ${group.interval}`)
      }
      if (group.tolerance) {
        lines.push(`    tolerance: ${group.tolerance}`)
      }
    }

    if (rules.length > 0) {
      lines.push('rules:')
      for (const rule of rules) {
        lines.push(`  - ${rule}`)
      }
    }

    if (Object.keys(ruleProviders).length > 0) {
      lines.push('rule-providers:')
      for (const [name, provider] of Object.entries(ruleProviders)) {
        lines.push(`  ${name}:`)
        lines.push(`    type: ${(provider as any).type}`)
        lines.push(`    behavior: ${(provider as any).behavior}`)
        lines.push(`    url: ${(provider as any).url}`)
        lines.push(`    path: ${(provider as any).path}`)
        lines.push(`    interval: ${(provider as any).interval}`)
      }
    }

    return lines.join('\n')
  }

  const handleV2TemplateSelect = (value: string) => {
    setSelectedV2Template(value)
    let baseName = ''
    if (value.startsWith('user:')) {
      const templateId = value.replace('user:', '')
      const template = userTemplates.find(t => t.id.toString() === templateId)
      if (template) {
        baseName = template.name
      }
    } else if (value.startsWith('preset:')) {
      const presetName = value.replace('preset:', '')
      const preset = ALL_TEMPLATE_PRESETS.find(p => p.name === presetName)
      if (preset) {
        baseName = preset.label
      }
    }
    if (baseName) {
      setNewTemplateName(baseName)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('upload.title')}</DialogTitle>
          <DialogDescription>{t('upload.description')}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="w-full grid grid-cols-6">
            <TabsTrigger value="upload">
              <Upload className="h-4 w-4 mr-1" />
              {t('upload.tabs.upload')}
            </TabsTrigger>
            <TabsTrigger value="paste">
              <FileText className="h-4 w-4 mr-1" />
              {t('upload.tabs.paste')}
            </TabsTrigger>
            <TabsTrigger value="blank">
              <Plus className="h-4 w-4 mr-1" />
              {t('upload.tabs.blank')}
            </TabsTrigger>
            <TabsTrigger value="fromUrl">
              <Link className="h-4 w-4 mr-1" />
              {t('upload.tabs.fromUrl')}
            </TabsTrigger>
            <TabsTrigger value="v2import">
              <RefreshCw className="h-4 w-4 mr-1" />
              {t('upload.tabs.v2import')}
            </TabsTrigger>
            <TabsTrigger value="fromSub">
              <Wand2 className="h-4 w-4 mr-1" />
              {t('upload.tabs.fromSub')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>{t('upload.selectYamlFile')}</Label>
              <Input type="file" accept=".yaml,.yml" onChange={handleFileChange} />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  {t('upload.selected')}: {selectedFile.name}
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="paste" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>{t('upload.templateName')}</Label>
              <Input
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="my_template.yaml"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('upload.yamlContent')}</Label>
              <Textarea
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                placeholder={t('upload.pasteYamlPlaceholder')}
                className="min-h-[200px] font-mono text-sm"
              />
            </div>
          </TabsContent>

          <TabsContent value="blank" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>{t('upload.templateName')}</Label>
              <Input
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="my_template.yaml"
              />
            </div>
            <p className="text-sm text-muted-foreground">{t('upload.blankDesc')}</p>
          </TabsContent>

          <TabsContent value="fromUrl" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>{t('upload.templateUrl')}</Label>
              <Input
                value={importUrl}
                onChange={(e) => {
                  setImportUrl(e.target.value)
                  setUrlPreview('')
                }}
                placeholder="https://example.com/template.yaml"
              />
            </div>

            <div className="space-y-2">
              <Label>{t('upload.templateName')}</Label>
              <Input
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="my_template.yaml"
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleUrlPreview} disabled={isFetchingUrl || !importUrl.trim()}>
                {isFetchingUrl ? t('upload.fetching') : t('upload.previewContent')}
              </Button>
            </div>

            {urlPreview && (
              <div className="space-y-2">
                <Label>{t('upload.contentPreview')}</Label>
                <Textarea value={urlPreview} readOnly className="min-h-[200px] font-mono text-xs" />
              </div>
            )}

            <p className="text-sm text-muted-foreground">{t('upload.fromUrlDesc')}</p>
          </TabsContent>

          <TabsContent value="v2import" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>{t('upload.selectV2')}</Label>
              <Select value={selectedV2Template} onValueChange={handleV2TemplateSelect} disabled={isFetchingTemplates}>
                <SelectTrigger>
                  <SelectValue placeholder={isFetchingTemplates ? t('actions.loading', { ns: 'common' }) : t('upload.selectTemplate')} />
                </SelectTrigger>
                <SelectContent>
                  {userTemplates.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{t('upload.myTemplates')}</SelectLabel>
                      {userTemplates.map((template) => (
                        <SelectItem key={`user-${template.id}`} value={`user:${template.id}`}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>{t('upload.presetTemplates')}</SelectLabel>
                    {ALL_TEMPLATE_PRESETS.map((preset) => (
                      <SelectItem key={`preset-${preset.name}`} value={`preset:${preset.name}`}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('upload.newTemplateName')}</Label>
              <Input
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="my_template.yaml"
              />
            </div>

            <div className="space-y-2">
              <Label>{t('upload.dnsConfig')}</Label>
              <Select value={selectedDnsPreset} onValueChange={setSelectedDnsPreset}>
                <SelectTrigger>
                  <SelectValue placeholder={t('upload.selectDns')} />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RULE_TEMPLATES.dns).map(([key, preset]) => (
                    <SelectItem key={key} value={key}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-sm text-muted-foreground">{t('upload.v2importDesc')}</p>
          </TabsContent>

          <TabsContent value="fromSub" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>{t('upload.selectSubscriptionFile')}</Label>
              <Select
                value={selectedSubscription}
                onValueChange={setSelectedSubscription}
                disabled={isFetchingSubscriptions}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isFetchingSubscriptions ? t('actions.loading', { ns: 'common' }) : t('upload.selectSub')} />
                </SelectTrigger>
                <SelectContent>
                  {subscribeFiles.map((sub) => (
                    <SelectItem key={sub.id} value={sub.filename}>
                      {sub.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('upload.newTemplateName')}</Label>
              <Input
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="my_template.yaml"
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleAnalyzePreview} disabled={isAnalyzing || !selectedSubscription}>
                {isAnalyzing ? t('upload.analyzing') : t('upload.previewAnalysis')}
              </Button>
            </div>

            {analysisPreview && (
              <div className="space-y-2">
                <Label>{t('upload.analysisPreview')}</Label>
                <Textarea value={analysisPreview} readOnly className="min-h-[200px] font-mono text-xs" />
              </div>
            )}

            <p className="text-sm text-muted-foreground">{t('upload.fromSubDesc')}</p>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('actions.cancel', { ns: 'common' })}
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || isConverting || isAnalyzing || isFetchingUrl}>
            {isLoading || isConverting || isAnalyzing || isFetchingUrl
              ? t('upload.processing')
              : tab === 'v2import'
                ? t('upload.convertAndCreate')
                : tab === 'fromSub'
                  ? t('upload.generateAndCreate')
                  : tab === 'fromUrl'
                    ? t('upload.importAndCreate')
                    : t('upload.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
