import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ChevronDown, ChevronUp, Trash2, GripVertical, Link2, Variable, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeywordFilterInput } from './keyword-filter-input'
import { ProxyTypeSelect } from './proxy-type-select'
import { ProxyGroupSelect } from './proxy-group-select'
import {
  PROXY_GROUP_TYPES,
  hasProxyNodes,
  hasProxyProviders,
  type ProxyGroupFormState,
  type ProxyGroupType,
} from '@/lib/template-v3-utils'

interface ProxyGroupEditorProps {
  group: ProxyGroupFormState
  index: number
  allGroupNames: string[]
  onChange: (index: number, group: ProxyGroupFormState) => void
  onDelete: (index: number) => void
  onMoveUp?: (index: number) => void
  onMoveDown?: (index: number) => void
  isFirst?: boolean
  isLast?: boolean
  showRegionToggle?: boolean
  isRegionGroup?: boolean
  variables?: Record<string, string>
}

export function ProxyGroupEditor({
  group,
  index,
  allGroupNames,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst = false,
  isLast = false,
  showRegionToggle = true,
  isRegionGroup = false,
  variables,
}: ProxyGroupEditorProps) {
  const { t } = useTranslation('templates')
  const [isOpen, setIsOpen] = useState(false)
  const [showRelayPicker, setShowRelayPicker] = useState(false)

  const updateField = <K extends keyof ProxyGroupFormState>(
    field: K,
    value: ProxyGroupFormState[K]
  ) => {
    onChange(index, { ...group, [field]: value })
  }

  const needsUrlTestOptions = ['url-test', 'fallback', 'load-balance'].includes(group.type)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={`border rounded-lg ${group.hidden ? 'opacity-60' : ''}`}>
        <CollapsibleTrigger asChild>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 cursor-pointer hover:bg-accent/50 gap-3 sm:gap-0">
            <div className="flex items-center justify-end flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              {group.icon && (
                /^https?:\/\//.test(group.icon)
                  ? <img src={group.icon} alt="" className="h-5 w-5 object-contain shrink-0" />
                  : <span className="text-base leading-none shrink-0">{group.icon}</span>
              )}
              <span className="font-medium mr-auto truncate max-w-[150px] sm:max-w-none">{group.name}</span>
              <Badge variant="outline" className="text-xs shrink-0">
                {t(`proxyGroupEditor.groupTypes.${group.type}`)}
              </Badge>
              {group.hidden && (
                <Badge variant="secondary" className="text-xs gap-1 shrink-0">
                  <EyeOff className="h-3 w-3" />
                  {t('proxyGroupEditor.hidden')}
                </Badge>
              )}
              {group.filterKeywords && (
                <Badge variant="secondary" className="text-xs shrink-0">{t('proxyGroupEditor.hasFilter')}</Badge>
              )}
            </div>
            <div className="flex items-center justify-end gap-1 w-full sm:w-auto border-t sm:border-0 pt-2 sm:pt-0">
              {group.dialerProxyGroup && (
                <Badge
                  variant="secondary"
                  className="text-xs cursor-pointer mr-auto hover:bg-secondary/80 shrink-0 truncate max-w-[100px] sm:max-w-[150px]"
                  onClick={(e) => { e.stopPropagation(); setShowRelayPicker(!showRelayPicker) }}
                >
                  {t('proxyGroupEditor.relayPrefix', { name: group.dialerProxyGroup })}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${group.dialerProxyGroup ? 'text-primary' : 'text-muted-foreground'}`}
                title={group.dialerProxyGroup ? t('proxyGroupEditor.relayPrefix', { name: group.dialerProxyGroup }) : t('proxyGroupEditor.setRelayGroup')}
                onClick={(e) => { e.stopPropagation(); setShowRelayPicker(!showRelayPicker) }}
              >
                <Link2 className="h-4 w-4" />
              </Button>
              {onMoveUp && !isFirst && (
                <Button variant="ghost" size="icon" className="h-8 w-8"
                  onClick={(e) => { e.stopPropagation(); onMoveUp(index) }}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
              )}
              {onMoveDown && !isLast && (
                <Button variant="ghost" size="icon" className="h-8 w-8"
                  onClick={(e) => { e.stopPropagation(); onMoveDown(index) }}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                onClick={(e) => { e.stopPropagation(); onDelete(index) }}>
                <Trash2 className="h-4 w-4" />
              </Button>
              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
          </div>
        </CollapsibleTrigger>

        {showRelayPicker && (
          <div className="px-3 pb-3 border-t">
            <div className="flex items-center justify-between pt-3 pb-2">
              <span className="text-xs text-muted-foreground">{t('proxyGroupEditor.selectRelayGroup')}</span>
              {group.dialerProxyGroup && (
                <Badge variant="outline" className="text-xs cursor-pointer hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => updateField('dialerProxyGroup', '')}>{t('proxyGroupEditor.clear')}</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {allGroupNames.filter(n => n !== group.name).map(n => (
                <Badge key={n}
                  variant={group.dialerProxyGroup === n ? "default" : "outline"}
                  className={`cursor-pointer justify-center py-1.5 transition-colors ${group.dialerProxyGroup === n ? '' : 'hover:bg-accent'}`}
                  onClick={() => updateField('dialerProxyGroup', group.dialerProxyGroup === n ? '' : n)}>
                  {n}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <CollapsibleContent>
          <div className="p-4 pt-0 space-y-4 border-t overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('proxyGroupEditor.groupName')}</Label>
                <Input value={group.name} onChange={(e) => updateField('name', e.target.value)} placeholder={t('proxyGroupEditor.groupNamePlaceholder')} className="w-full" />
              </div>
              <div className="space-y-2">
                <Label>{t('proxyGroupEditor.groupType')}</Label>
                <Select value={group.type} onValueChange={(v) => updateField('type', v as ProxyGroupType)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROXY_GROUP_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{t(`proxyGroupEditor.groupTypes.${type}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('proxyGroupEditor.nodeSource')}</Label>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <Switch checked={group.includeAll} onCheckedChange={(v) => {
                    onChange(index, { ...group, includeAll: v, includeAllProxies: v, includeAllProviders: v })
                  }} />
                  <span className="text-sm">{t('proxyGroupEditor.providersAndNodes')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={group.includeAllProxies} onCheckedChange={(v) => {
                    const newIncludeAll = v && group.includeAllProviders
                    onChange(index, { ...group, includeAllProxies: v, includeAll: v ? newIncludeAll : false })
                  }} />
                  <span className="text-sm">{t('proxyGroupEditor.proxyNodes')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={group.includeAllProviders} onCheckedChange={(v) => {
                    const newIncludeAll = v && group.includeAllProxies
                    onChange(index, { ...group, includeAllProviders: v, includeAll: v ? newIncludeAll : false })
                  }} />
                  <span className="text-sm">{t('proxyGroupEditor.proxyProviders')}</span>
                </div>
                {showRegionToggle && !isRegionGroup && (
                  <div className="flex items-center gap-2">
                    <Switch checked={group.includeRegionProxyGroups} onCheckedChange={(v) => updateField('includeRegionProxyGroups', v)} />
                    <span className="text-sm">{t('proxyGroupEditor.regionProxyGroups')}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-hidden w-full max-w-full">
              <ProxyGroupSelect
                label={t('proxyGroupEditor.proxyOrder')}
                value={group.proxyOrder}
                onChange={(v) => updateField('proxyOrder', v)}
                availableGroups={allGroupNames.filter(n => n !== group.name)}
                showNodesMarker={hasProxyNodes(group)}
                showProvidersMarker={hasProxyProviders(group)}
                showRegionGroupsMarker={group.includeRegionProxyGroups}
                placeholder={t('proxyGroupEditor.selectRefGroups')}
              />
            </div>

            {variables && Object.keys(variables).length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="text-xs cursor-help border-dashed border-amber-500 text-amber-600 dark:text-amber-400 gap-1 shrink-0">
                        <Variable className="h-3 w-3 shrink-0" />
                        {t('proxyGroupEditor.templateVariables', { count: Object.keys(variables).length })}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[90vw] sm:max-w-md break-all">
                      <div className="space-y-1 text-xs">
                        {Object.entries(variables).map(([name, value]) => (
                          <div key={name} className="flex gap-2">
                            <span className="font-mono font-semibold shrink-0">{name}</span>
                            <span className="truncate">{value}</span>
                          </div>
                        ))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <KeywordFilterInput label={t('proxyGroupEditor.filterKeywords')} value={group.filterKeywords}
                onChange={(v) => updateField('filterKeywords', v)}
                onVariableCleared={() => updateField('filterFromVariable', undefined)}
                placeholder={t('proxyGroupEditor.filterPlaceholder')} description={t('proxyGroupEditor.filterDescription')} fromVariable={group.filterFromVariable} />
              <KeywordFilterInput label={t('proxyGroupEditor.excludeKeywords')} value={group.excludeFilterKeywords}
                onChange={(v) => updateField('excludeFilterKeywords', v)}
                onVariableCleared={() => updateField('excludeFilterFromVariable', undefined)}
                placeholder={t('proxyGroupEditor.excludePlaceholder')} description={t('proxyGroupEditor.excludeDescription')} fromVariable={group.excludeFilterFromVariable} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ProxyTypeSelect label={t('proxyGroupEditor.includeType')} value={group.includeTypes}
                onChange={(v) => updateField('includeTypes', v)} placeholder={t('proxyGroupEditor.includeTypePlaceholder')} />
              <ProxyTypeSelect label={t('proxyGroupEditor.excludeType')} value={group.excludeTypes}
                onChange={(v) => updateField('excludeTypes', v)} placeholder={t('proxyGroupEditor.excludeTypePlaceholder')} />
            </div>

            {needsUrlTestOptions && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t('proxyGroupEditor.testUrl')}</Label>
                  <Input value={group.url} onChange={(e) => updateField('url', e.target.value)}
                    placeholder="https://www.gstatic.com/generate_204" className="w-full" />
                </div>
                <div className="space-y-2">
                  <Label>{t('proxyGroupEditor.testInterval')}</Label>
                  <Input type="number" value={group.interval}
                    onChange={(e) => updateField('interval', parseInt(e.target.value) || 300)} className="w-full" />
                </div>
                {group.type !== 'load-balance' && (
                  <div className="space-y-2">
                    <Label>{t('proxyGroupEditor.tolerance')}</Label>
                    <Input type="number" value={group.tolerance}
                      onChange={(e) => updateField('tolerance', parseInt(e.target.value) || 50)} className="w-full" />
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('proxyGroupEditor.icon')}</Label>
                <Input value={group.icon} onChange={(e) => updateField('icon', e.target.value)}
                  placeholder={t('proxyGroupEditor.iconPlaceholder')} className="w-full" />
              </div>
              <div className="flex items-center gap-2 sm:pt-8">
                <Switch checked={group.hidden} onCheckedChange={(v) => updateField('hidden', v)} />
                <span className="text-sm">{t('proxyGroupEditor.hideGroup')}</span>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
