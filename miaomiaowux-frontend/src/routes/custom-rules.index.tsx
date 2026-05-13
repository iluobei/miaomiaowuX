import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'

import { DataTable } from '@/components/data-table'
import type { DataTableColumn } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { RULE_TEMPLATES, RULE_PROVIDER_RULES } from '../config/custom-rules-templates'
import { OVERRIDE_SCRIPT_TEMPLATES } from '@/config/override-script-templates'

export const Route = createFileRoute('/custom-rules/')({
	component: OverrideManagementPage,
})

interface CustomRule {
	id: number
	name: string
	type: 'dns' | 'rules' | 'rule-providers'
	mode: 'replace' | 'prepend' | 'append'
	content: string
	enabled: boolean
	created_at: string
	updated_at: string
	added_proxy_groups?: string[]
}

interface OverrideScript {
	id: number
	name: string
	hook: 'post_fetch' | 'pre_save_nodes'
	content: string
	enabled: boolean
	sort_order: number
	created_at: string
	updated_at: string
}

interface OverrideItem {
	id: number
	name: string
	kind: 'rule' | 'script'
	type: 'dns' | 'rules' | 'rule-providers' | 'script'
	mode?: string
	hook?: string
	content: string
	enabled: boolean
	sort_order?: number
	created_at: string
	updated_at: string
}

type OverrideType = 'dns' | 'rules' | 'rule-providers' | 'script'

interface FormData {
	name: string
	type: OverrideType
	mode: string
	hook: string
	content: string
	enabled: boolean
	sort_order: number
}

function ruleToItem(rule: CustomRule): OverrideItem {
	return {
		id: rule.id,
		name: rule.name,
		kind: 'rule',
		type: rule.type,
		mode: rule.mode,
		content: rule.content,
		enabled: rule.enabled,
		created_at: rule.created_at,
		updated_at: rule.updated_at,
	}
}

function scriptToItem(script: OverrideScript): OverrideItem {
	return {
		id: script.id,
		name: script.name,
		kind: 'script',
		type: 'script',
		hook: script.hook,
		content: script.content,
		enabled: script.enabled,
		sort_order: script.sort_order,
		created_at: script.created_at,
		updated_at: script.updated_at,
	}
}

function OverrideManagementPage() {
	const { t } = useTranslation('customRules')
	const queryClient = useQueryClient()
	const [filterType, setFilterType] = useState<string>('')
	const [isDialogOpen, setIsDialogOpen] = useState(false)
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
	const [editingItem, setEditingItem] = useState<OverrideItem | null>(null)
	const [deletingItem, setDeletingItem] = useState<OverrideItem | null>(null)
	const [formData, setFormData] = useState<FormData>({
		name: '',
		type: 'dns',
		mode: 'replace',
		hook: 'post_fetch',
		content: '',
		enabled: true,
		sort_order: 0,
	})
	const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
	const [isRuleProviderConfirmOpen, setIsRuleProviderConfirmOpen] = useState(false)
	const [pendingRuleProviderData, setPendingRuleProviderData] = useState<FormData | null>(null)

	const { data: rules = [], isLoading: isLoadingRules } = useQuery<CustomRule[]>({
		queryKey: ['custom-rules'],
		queryFn: async () => {
			const response = await api.get('/api/admin/custom-rules')
			return response.data
		},
	})

	const { data: scripts = [], isLoading: isLoadingScripts } = useQuery<OverrideScript[]>({
		queryKey: ['override-scripts'],
		queryFn: async () => {
			const response = await api.get('/api/admin/override-scripts')
			return response.data
		},
	})

	const isLoading = isLoadingRules || isLoadingScripts

	const allItems: OverrideItem[] = [
		...rules.map(ruleToItem),
		...scripts.map(scriptToItem),
	]

	const filteredItems = filterType
		? allItems.filter((item) => item.type === filterType)
		: allItems

	// Rule mutations
	const createRuleMutation = useMutation({
		mutationFn: async (data: { name: string; type: string; mode: string; content: string; enabled: boolean }) => {
			if (data.enabled && data.mode === 'replace') {
				const conflicting = rules.filter(
					(r) => r.type === data.type && r.mode === 'replace' && r.enabled
				)
				for (const c of conflicting) {
					await api.put(`/api/admin/custom-rules/${c.id}`, { ...c, enabled: false })
				}
			}
			const response = await api.post('/api/admin/custom-rules', data)
			return response.data
		},
		onSuccess: (data: CustomRule) => {
			queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
			if (data.added_proxy_groups && data.added_proxy_groups.length > 0) {
				toast.success(
					t('toast.createdWithGroups', { groups: data.added_proxy_groups.join('、') }),
					{ duration: 8000 }
				)
			} else {
				toast.success(t('toast.created'))
			}
		},
		onError: (error: any) => {
			toast.error(error.response?.data?.error || t('toast.createError'))
		},
	})

	const updateRuleMutation = useMutation({
		mutationFn: async ({ id, ...data }: { id: number; name: string; type: string; mode: string; content: string; enabled: boolean }) => {
			if (data.enabled && data.mode === 'replace') {
				const conflicting = rules.filter(
					(r) => r.id !== id && r.type === data.type && r.mode === 'replace' && r.enabled
				)
				for (const c of conflicting) {
					await api.put(`/api/admin/custom-rules/${c.id}`, { ...c, enabled: false })
				}
			}
			const response = await api.put(`/api/admin/custom-rules/${id}`, data)
			return response.data
		},
		onSuccess: (data: CustomRule) => {
			queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
			if (data.added_proxy_groups && data.added_proxy_groups.length > 0) {
				toast.success(
					t('toast.updatedWithGroups', { groups: data.added_proxy_groups.join('、') }),
					{ duration: 8000 }
				)
			} else {
				toast.success(t('toast.updated'))
			}
		},
		onError: (error: any) => {
			toast.error(error.response?.data?.error || t('toast.updateError'))
		},
	})

	const deleteRuleMutation = useMutation({
		mutationFn: async (id: number) => {
			await api.delete(`/api/admin/custom-rules/${id}`)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
			toast.success(t('toast.deleted'))
		},
		onError: (error: any) => {
			toast.error(error.response?.data?.error || t('toast.deleteError'))
		},
	})

	const toggleRuleMutation = useMutation({
		mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
			const rule = rules.find((r) => r.id === id)
			if (!rule) throw new Error(t('toast.ruleNotFound'))
			if (enabled && rule.mode === 'replace') {
				const conflicting = rules.filter(
					(r) => r.id !== id && r.type === rule.type && r.mode === 'replace' && r.enabled
				)
				for (const c of conflicting) {
					await api.put(`/api/admin/custom-rules/${c.id}`, { ...c, enabled: false })
				}
			}
			await api.put(`/api/admin/custom-rules/${id}`, { ...rule, enabled })
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
			toast.success(t('toast.statusUpdated'))
		},
		onError: (error: any) => {
			toast.error(error.response?.data?.error || t('toast.statusError'))
		},
	})

	// Script mutations
	const createScriptMutation = useMutation({
		mutationFn: async (data: { name: string; hook: string; content: string; enabled: boolean; sort_order: number }) => {
			return api.post('/api/admin/override-scripts', data)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['override-scripts'] })
			toast.success(t('toast.scriptCreated'))
		},
		onError: () => toast.error(t('toast.scriptCreateError')),
	})

	const updateScriptMutation = useMutation({
		mutationFn: async ({ id, ...data }: { id: number; name: string; hook: string; content: string; enabled: boolean; sort_order: number }) => {
			return api.put(`/api/admin/override-scripts/${id}`, data)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['override-scripts'] })
			toast.success(t('toast.scriptUpdated'))
		},
		onError: () => toast.error(t('toast.scriptUpdateError')),
	})

	const deleteScriptMutation = useMutation({
		mutationFn: async (id: number) => {
			return api.delete(`/api/admin/override-scripts/${id}`)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['override-scripts'] })
			toast.success(t('toast.scriptDeleted'))
		},
		onError: () => toast.error(t('toast.scriptDeleteError')),
	})

	const toggleScriptMutation = useMutation({
		mutationFn: async ({ id, script, enabled }: { id: number; script: OverrideScript; enabled: boolean }) => {
			return api.put(`/api/admin/override-scripts/${id}`, {
				name: script.name,
				hook: script.hook,
				content: script.content,
				enabled,
				sort_order: script.sort_order,
			})
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['override-scripts'] })
			toast.success(t('toast.statusUpdated'))
		},
	})

	const resetForm = () => {
		setFormData({
			name: '',
			type: 'dns',
			mode: 'replace',
			hook: 'post_fetch',
			content: '',
			enabled: true,
			sort_order: 0,
		})
		setEditingItem(null)
		setSelectedTemplate(null)
	}

	const handleCreate = () => {
		resetForm()
		setIsDialogOpen(true)
	}

	const handleEdit = (item: OverrideItem) => {
		setEditingItem(item)
		setFormData({
			name: item.name,
			type: item.type,
			mode: item.mode || 'replace',
			hook: item.hook || 'post_fetch',
			content: item.content,
			enabled: item.enabled,
			sort_order: item.sort_order || 0,
		})
		setIsDialogOpen(true)
	}

	const handleDelete = (item: OverrideItem) => {
		setDeletingItem(item)
		setIsDeleteDialogOpen(true)
	}

	const handleDeleteConfirm = () => {
		if (!deletingItem) return
		if (deletingItem.kind === 'rule') {
			deleteRuleMutation.mutate(deletingItem.id)
		} else {
			deleteScriptMutation.mutate(deletingItem.id)
		}
		setIsDeleteDialogOpen(false)
		setDeletingItem(null)
	}

	const handleToggle = (item: OverrideItem, enabled: boolean) => {
		if (item.kind === 'rule') {
			toggleRuleMutation.mutate({ id: item.id, enabled })
		} else {
			const script = scripts.find((s) => s.id === item.id)
			if (script) {
				toggleScriptMutation.mutate({ id: item.id, script, enabled })
			}
		}
	}

	const handleSubmit = () => {
		if (!formData.name.trim()) {
			toast.error(t('toast.nameRequired'))
			return
		}
		if (!formData.content.trim()) {
			toast.error(t('toast.contentRequired'))
			return
		}

		const isScript = formData.type === 'script'

		if (isScript) {
			if (editingItem) {
				updateScriptMutation.mutate({
					id: editingItem.id,
					name: formData.name,
					hook: formData.hook,
					content: formData.content,
					enabled: formData.enabled,
					sort_order: formData.sort_order,
				})
			} else {
				createScriptMutation.mutate({
					name: formData.name,
					hook: formData.hook,
					content: formData.content,
					enabled: formData.enabled,
					sort_order: formData.sort_order,
				})
			}
			setIsDialogOpen(false)
			resetForm()
			return
		}

		if (!editingItem && formData.type === 'rule-providers' && selectedTemplate && selectedTemplate in RULE_PROVIDER_RULES) {
			setPendingRuleProviderData(formData)
			setIsRuleProviderConfirmOpen(true)
			return
		}

		const ruleData = {
			name: formData.name,
			type: formData.type,
			mode: formData.mode,
			content: formData.content,
			enabled: formData.enabled,
		}

		if (editingItem) {
			updateRuleMutation.mutate({ id: editingItem.id, ...ruleData })
		} else {
			createRuleMutation.mutate(ruleData)
		}
		setIsDialogOpen(false)
		resetForm()
	}

	const handleRuleProviderConfirm = async (createRuleConfig: boolean) => {
		if (!pendingRuleProviderData) return
		try {
			await createRuleMutation.mutateAsync({
				name: pendingRuleProviderData.name,
				type: pendingRuleProviderData.type,
				mode: pendingRuleProviderData.mode,
				content: pendingRuleProviderData.content,
				enabled: pendingRuleProviderData.enabled,
			})

			if (createRuleConfig && selectedTemplate && selectedTemplate in RULE_PROVIDER_RULES) {
				const ruleContent = RULE_PROVIDER_RULES[selectedTemplate as keyof typeof RULE_PROVIDER_RULES]
				await queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
				const latestRules = await api.get('/api/admin/custom-rules').then((res) => res.data)
				const existingRulesRules = latestRules?.filter((r: CustomRule) => r.type === 'rules')
				let finalRuleContent = ruleContent

				if (existingRulesRules && existingRulesRules.length > 0) {
					const allExistingLines: string[] = []
					existingRulesRules.forEach((rule: CustomRule) => {
						const lines = rule.content.split('\n').map((l: string) => l.trim()).filter((l: string) => l)
						allExistingLines.push(...lines.slice(1))
					})
					const newLines = ruleContent.split('\n').map((l: string) => l.trim()).filter((l: string) => l)
					const existingLinesLower = allExistingLines.map((l: string) => l.toLowerCase())
					const filteredNewLines = newLines.filter((l: string) => !existingLinesLower.includes(l.toLowerCase()))
					if (filteredNewLines.length > 0) {
						finalRuleContent = filteredNewLines.join('\n')
					}
				}

				await createRuleMutation.mutateAsync({
					name: t('toast.routeRuleName', { name: pendingRuleProviderData.name }),
					type: 'rules',
					mode: 'append',
					content: finalRuleContent,
					enabled: true,
				})
				toast.success(t('toast.ruleProviderCreated'))
			} else {
				toast.success(t('toast.ruleProviderOnlyCreated'))
			}
		} catch {
			toast.error(t('toast.ruleProviderError'))
		} finally {
			setIsRuleProviderConfirmOpen(false)
			setPendingRuleProviderData(null)
			setIsDialogOpen(false)
			resetForm()
		}
	}

	const getTypeLabel = (type: string) => {
		switch (type) {
			case 'dns': return t('type.dns')
			case 'rules': return t('type.rules')
			case 'rule-providers': return t('type.ruleProviders')
			case 'script': return t('type.script')
			default: return type
		}
	}

	const getTypeBadgeClass = (type: string) => {
		switch (type) {
			case 'dns':
				return 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30'
			case 'rules':
				return 'bg-green-500/10 text-green-700 border-green-500/20 dark:bg-green-500/20 dark:text-green-400 dark:border-green-500/30'
			case 'rule-providers':
				return 'bg-purple-500/10 text-purple-700 border-purple-500/20 dark:bg-purple-500/20 dark:text-purple-400 dark:border-purple-500/30'
			case 'script':
				return 'bg-orange-500/10 text-orange-700 border-orange-500/20 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-500/30'
			default:
				return ''
		}
	}

	const getModeOrHookLabel = (item: OverrideItem) => {
		if (item.kind === 'script') {
			return t(`hook.${item.hook}`, { defaultValue: item.hook || '-' })
		}
		switch (item.mode) {
			case 'replace': return t('mode.replace')
			case 'prepend': return t('mode.prepend')
			case 'append': return t('mode.append')
			default: return item.mode || '-'
		}
	}

	const isScript = formData.type === 'script'

	const isMutating =
		createRuleMutation.isPending ||
		updateRuleMutation.isPending ||
		createScriptMutation.isPending ||
		updateScriptMutation.isPending

	return (
		<main className='mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 pt-24'>
			<div className='space-y-6'>
				<div className='flex items-center justify-between'>
					<div>
						<h1 className='text-3xl font-bold'>{t('title')}</h1>
						<p className='text-muted-foreground mt-2'>
							{t('subtitle')}
						</p>
					</div>
					<Button onClick={handleCreate}>
						<Plus className='mr-2 h-4 w-4' />
						{t('createRule')}
					</Button>
				</div>

				<Card>
					<CardHeader>
						<div className='flex items-center justify-between'>
							<div>
								<CardTitle>{t('ruleList')}</CardTitle>
								<CardDescription>{t('ruleCount', { count: filteredItems.length })}</CardDescription>
							</div>
							<Tabs value={filterType} onValueChange={setFilterType}>
								<TabsList>
									<TabsTrigger value=''>{t('filterAll')}</TabsTrigger>
									<TabsTrigger value='dns'>{t('filterDns')}</TabsTrigger>
									<TabsTrigger value='rules'>{t('filterRules')}</TabsTrigger>
									<TabsTrigger value='rule-providers'>{t('filterRuleProviders')}</TabsTrigger>
									<TabsTrigger value='script'>{t('filterScript')}</TabsTrigger>
								</TabsList>
							</Tabs>
						</div>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<div className='text-center py-8 text-muted-foreground'>
								{t('actions.loading', { ns: 'common' })}
							</div>
						) : (
							<DataTable
								data={filteredItems}
								getRowKey={(item) => `${item.kind}-${item.id}`}
								emptyText={t('emptyText')}
								columns={[
									{
										header: t('columns.name'),
										cell: (item) => item.name,
										cellClassName: 'font-medium',
									},
									{
										header: t('columns.type'),
										cell: (item) => (
											<Badge variant='outline' className={getTypeBadgeClass(item.type)}>
												{getTypeLabel(item.type)}
											</Badge>
										),
									},
									{
										header: t('columns.mode'),
										cell: (item) => getModeOrHookLabel(item),
									},
									{
										header: t('columns.status'),
										cell: (item) => (
											<div className='flex items-center gap-2'>
												<Switch
													checked={item.enabled}
													onCheckedChange={(checked) => handleToggle(item, checked)}
													disabled={toggleRuleMutation.isPending || toggleScriptMutation.isPending}
												/>
												<span className='text-sm text-muted-foreground'>
													{item.enabled ? t('actions.enable', { ns: 'common' }) : t('actions.disable', { ns: 'common' })}
												</span>
											</div>
										),
									},
									{
										header: t('columns.createdAt'),
										cell: (item) => (
											<span className='text-sm text-muted-foreground'>
												{new Date(item.created_at).toLocaleString('zh-CN')}
											</span>
										),
									},
									{
										header: t('columns.actions'),
										cell: (item) => (
											<div className='flex justify-end gap-2'>
												<Button variant='ghost' size='icon' onClick={() => handleEdit(item)}>
													<Pencil className='h-4 w-4' />
												</Button>
												<Button variant='ghost' size='icon' onClick={() => handleDelete(item)}>
													<Trash2 className='h-4 w-4' />
												</Button>
											</div>
										),
										headerClassName: 'text-right',
										cellClassName: 'text-right',
									},
								] as DataTableColumn<OverrideItem>[]}
								mobileCard={{
									header: (item) => (
										<div className='space-y-1'>
											<div className='flex items-start justify-between gap-2'>
												<div className='flex items-center gap-2 flex-1 min-w-0'>
													<Badge variant='outline' className={`${getTypeBadgeClass(item.type)} shrink-0`}>
														{getTypeLabel(item.type)}
													</Badge>
													<div className='font-medium text-sm truncate flex-1 min-w-0'>{item.name}</div>
												</div>
												<Button
													variant='outline'
													size='icon'
													className='size-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10'
													onClick={(e) => {
														e.stopPropagation()
														handleDelete(item)
													}}
												>
													<Trash2 className='size-4' />
												</Button>
											</div>
											<div className='flex items-center justify-between gap-4 text-xs'>
												<div className='flex items-center gap-2 min-w-0'>
													<span className='text-muted-foreground shrink-0'>
														{item.kind === 'script' ? t('dialog.hookLabel') + ':' : t('mobileLabels.mode')}
													</span>
													<span className='truncate'>{getModeOrHookLabel(item)}</span>
												</div>
												<div className='flex items-center gap-2 shrink-0'>
													<span className='text-muted-foreground shrink-0'>{t('mobileLabels.status')}</span>
													<div className='flex items-center gap-2'>
														<Switch
															checked={item.enabled}
															onCheckedChange={(checked) => handleToggle(item, checked)}
															disabled={toggleRuleMutation.isPending || toggleScriptMutation.isPending}
														/>
														<span>{item.enabled ? t('actions.enable', { ns: 'common' }) : t('actions.disable', { ns: 'common' })}</span>
													</div>
												</div>
											</div>
											<div className='flex items-center gap-2 text-xs'>
												<span className='text-muted-foreground shrink-0'>{t('mobileLabels.createdAt')}</span>
												<span>{new Date(item.created_at).toLocaleString('zh-CN')}</span>
											</div>
										</div>
									),
									fields: [],
									actions: (item) => (
										<Button variant='outline' size='sm' className='w-full' onClick={() => handleEdit(item)}>
											<Pencil className='mr-1 h-4 w-4' />
											{t('actions.edit', { ns: 'common' })}
										</Button>
									),
								}}
							/>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Create/Edit Dialog */}
			<Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
				<DialogContent className='max-w-3xl max-h-[90vh] overflow-y-auto'>
					<DialogHeader>
						<DialogTitle>
							{editingItem ? t('dialog.editTitle') : t('dialog.createTitle')}
						</DialogTitle>
						<DialogDescription>
							{isScript
								? t('dialog.scriptCreateDesc')
								: editingItem
									? t('dialog.editDesc')
									: t('dialog.createDesc')}
						</DialogDescription>
					</DialogHeader>

					{/* 顶部操作区 */}
					<div className='flex items-center justify-between border-b pb-4'>
						<div className='flex items-center space-x-2'>
							<Switch
								id='enabled'
								checked={formData.enabled}
								onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
							/>
							<Label htmlFor='enabled'>{t('dialog.enableRule')}</Label>
						</div>
						<div className='flex items-center space-x-2'>
							<Button
								variant='outline'
								onClick={() => {
									setIsDialogOpen(false)
									resetForm()
								}}
							>
								{t('actions.cancel', { ns: 'common' })}
							</Button>
							<Button onClick={handleSubmit} disabled={isMutating}>
								{isMutating ? t('actions.saving', { ns: 'common' }) : t('actions.save', { ns: 'common' })}
							</Button>
						</div>
					</div>

					<div className='space-y-4 py-4'>
						<div className='space-y-2'>
							<Label htmlFor='name'>{t('dialog.nameLabel')}</Label>
							<Input
								id='name'
								value={formData.name}
								onChange={(e) => setFormData({ ...formData, name: e.target.value })}
								placeholder={t('dialog.namePlaceholder')}
							/>
						</div>

						<div className={`grid gap-4 ${!editingItem && !isScript ? 'grid-cols-4' : isScript ? 'grid-cols-2' : 'grid-cols-2'}`}>
							<div className='space-y-2'>
								<Label htmlFor='type'>{t('dialog.typeLabel')}</Label>
								<Select
									value={formData.type}
									onValueChange={(value: any) => {
										const newFormData = { ...formData, type: value }
										if (value === 'dns') newFormData.mode = 'replace'
										if (value === 'script') newFormData.hook = formData.hook || 'post_fetch'
										setFormData(newFormData)
										setSelectedTemplate(null)
									}}
									disabled={!!editingItem}
								>
									<SelectTrigger id='type'>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value='dns'>{t('type.dns')}</SelectItem>
										<SelectItem value='rules'>{t('type.rules')}</SelectItem>
										<SelectItem value='rule-providers'>{t('type.ruleProviders')}</SelectItem>
										<SelectItem value='script'>{t('type.script')}</SelectItem>
									</SelectContent>
								</Select>
							</div>

							{isScript ? (
								<div className='space-y-2'>
									<Label htmlFor='hook'>{t('dialog.hookLabel')}</Label>
									<Select
										value={formData.hook}
										onValueChange={(value) => setFormData({ ...formData, hook: value })}
									>
										<SelectTrigger id='hook'>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value='post_fetch'>{t('hook.post_fetch')}</SelectItem>
											<SelectItem value='pre_save_nodes'>{t('hook.pre_save_nodes')}</SelectItem>
										</SelectContent>
									</Select>
								</div>
							) : (
								<div className='space-y-2'>
									<Label htmlFor='mode'>{t('dialog.modeLabel')}</Label>
									<Select
										value={formData.mode}
										onValueChange={(value: any) => setFormData({ ...formData, mode: value })}
										disabled={formData.type === 'dns'}
									>
										<SelectTrigger id='mode'>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value='replace'>{t('mode.replace')}</SelectItem>
											<SelectItem value='prepend'>{t('mode.prepend')}</SelectItem>
											<SelectItem value='append'>{t('mode.append')}</SelectItem>
										</SelectContent>
									</Select>
								</div>
							)}

							{/* 模板选择 - 仅在新建时显示 */}
							{!editingItem && !isScript && (
								<div className='space-y-2 col-span-2'>
									<Label htmlFor='template'>{t('dialog.templateLabel')}</Label>
									<Select
										value={selectedTemplate || 'none'}
										onValueChange={(value: string) => {
											if (value === 'none') {
												setSelectedTemplate(null)
												return
											}
											const templates = RULE_TEMPLATES[formData.type as keyof typeof RULE_TEMPLATES]
											const template = templates[value as keyof typeof templates] as { name: string; content: string } | undefined
											if (template) {
												setSelectedTemplate(value)
												const allTemplates = RULE_TEMPLATES[formData.type as keyof typeof RULE_TEMPLATES]
												const isTemplateName = Object.values(allTemplates).some(
													(t: any) => t.name === formData.name
												)
												setFormData({
													...formData,
													name: formData.name === '' || isTemplateName ? template.name : formData.name,
													content: template.content,
												})
											}
										}}
									>
										<SelectTrigger id='template'>
											<SelectValue placeholder={t('dialog.templatePlaceholder')} />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value='none'>{t('dialog.noTemplate')}</SelectItem>
											{Object.entries(RULE_TEMPLATES[formData.type as keyof typeof RULE_TEMPLATES] || {}).map(
												([key, template]) => (
													<SelectItem key={key} value={key}>
														{template.name}
													</SelectItem>
												)
											)}
										</SelectContent>
									</Select>
								</div>
							)}

							{/* 脚本模板 */}
							{!editingItem && isScript && (
								<div className='space-y-2'>
									<Label>{t('dialog.templateLabel')}</Label>
									<Select
										onValueChange={(templateName) => {
											const hookTemplates = OVERRIDE_SCRIPT_TEMPLATES[formData.hook as keyof typeof OVERRIDE_SCRIPT_TEMPLATES] || []
											const template = hookTemplates.find((t) => t.name === templateName)
											if (template) {
												setFormData((prev) => ({ ...prev, content: template.content }))
											}
										}}
									>
										<SelectTrigger>
											<SelectValue placeholder={t('dialog.scriptTemplatePlaceholder')} />
										</SelectTrigger>
										<SelectContent>
											{(OVERRIDE_SCRIPT_TEMPLATES[formData.hook as keyof typeof OVERRIDE_SCRIPT_TEMPLATES] || []).map((t) => (
												<SelectItem key={t.name} value={t.name}>
													{t.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</div>

						<div className='space-y-2'>
							<Label htmlFor='content'>
								{isScript ? t('dialog.scriptContentLabel') : t('dialog.contentLabel')}
							</Label>
							<Textarea
								id='content'
								value={formData.content}
								onChange={(e) => setFormData({ ...formData, content: e.target.value })}
								placeholder={
									isScript
										? `function main(${formData.hook === 'post_fetch' ? 'config' : 'proxies'}) {\n  // ...\n  return ${formData.hook === 'post_fetch' ? 'config' : 'proxies'};\n}`
										: t('dialog.contentPlaceholder')
								}
								className='font-mono text-sm min-h-[300px] whitespace-pre-wrap break-all [field-sizing:fixed]'
							/>
							<p className='text-xs text-muted-foreground'>
								{isScript ? t('dialog.scriptContentHint') : t('dialog.contentHint')}
							</p>
						</div>
					</div>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
						<AlertDialogDescription>
							{t('deleteConfirm.description')}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t('actions.cancel', { ns: 'common' })}</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							disabled={deleteRuleMutation.isPending || deleteScriptMutation.isPending}
						>
							{deleteRuleMutation.isPending || deleteScriptMutation.isPending ? t('deleteConfirm.deleting') : t('deleteConfirm.confirm')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Rule Provider Confirmation Dialog */}
			<AlertDialog open={isRuleProviderConfirmOpen} onOpenChange={setIsRuleProviderConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('ruleProviderConfirm.title')}</AlertDialogTitle>
						<AlertDialogDescription>
							{t('ruleProviderConfirm.description')}
							<br /><br />
							{t('ruleProviderConfirm.descriptionDetail')}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => handleRuleProviderConfirm(false)}>
							{t('ruleProviderConfirm.onlyRuleProvider')}
						</AlertDialogCancel>
						<AlertDialogAction onClick={() => handleRuleProviderConfirm(true)}>
							{t('ruleProviderConfirm.withRuleConfig')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</main>
	)
}
