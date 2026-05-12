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

export const Route = createFileRoute('/custom-rules/')({
	component: CustomRulesPage,
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

type RuleFormData = Omit<CustomRule, 'id' | 'created_at' | 'updated_at'>

function CustomRulesPage() {
	const { t } = useTranslation('customRules')
	const queryClient = useQueryClient()
	const [filterType, setFilterType] = useState<string>('')
	const [isDialogOpen, setIsDialogOpen] = useState(false)
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
	const [editingRule, setEditingRule] = useState<CustomRule | null>(null)
	const [deletingRuleId, setDeletingRuleId] = useState<number | null>(null)
	const [formData, setFormData] = useState<RuleFormData>({
		name: '',
		type: 'dns',
		mode: 'replace',
		content: '',
		enabled: true,
	})
	const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
	const [isRuleProviderConfirmOpen, setIsRuleProviderConfirmOpen] = useState(false)
	const [pendingRuleProviderData, setPendingRuleProviderData] = useState<RuleFormData | null>(null)

	// Fetch rules
	const { data: rules = [], isLoading } = useQuery<CustomRule[]>({
		queryKey: ['custom-rules', filterType],
		queryFn: async () => {
			const params = filterType ? { type: filterType } : {}
			const response = await api.get('/api/admin/custom-rules', { params })
			return response.data
		},
	})

	// Create rule mutation
	const createMutation = useMutation({
		mutationFn: async (rule: RuleFormData) => {
			// 如果是启用状态且模式为替换，需要先禁用同类型的其他替换模式规则
			if (rule.enabled && rule.mode === 'replace') {
				const conflictingRules = rules.filter(
					r => r.type === rule.type &&
					r.mode === 'replace' &&
					r.enabled
				)

				for (const conflictRule of conflictingRules) {
					await api.put(`/api/admin/custom-rules/${conflictRule.id}`, {
						name: conflictRule.name,
						type: conflictRule.type,
						mode: conflictRule.mode,
						content: conflictRule.content,
						enabled: false,
					})
				}
			}

			const response = await api.post('/api/admin/custom-rules', rule)
			return response.data
		},
		onSuccess: (data: CustomRule) => {
			queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
			setIsDialogOpen(false)
			resetForm()

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

	// Update rule mutation
	const updateMutation = useMutation({
		mutationFn: async ({
			id,
			...rule
		}: RuleFormData & { id: number }) => {
			// 如果是启用状态且模式为替换，需要先禁用同类型的其他替换模式规则
			if (rule.enabled && rule.mode === 'replace') {
				const conflictingRules = rules.filter(
					r => r.id !== id &&
					r.type === rule.type &&
					r.mode === 'replace' &&
					r.enabled
				)

				for (const conflictRule of conflictingRules) {
					await api.put(`/api/admin/custom-rules/${conflictRule.id}`, {
						name: conflictRule.name,
						type: conflictRule.type,
						mode: conflictRule.mode,
						content: conflictRule.content,
						enabled: false,
					})
				}
			}

			const response = await api.put(`/api/admin/custom-rules/${id}`, rule)
			return response.data
		},
		onSuccess: (data: CustomRule) => {
			queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
			setIsDialogOpen(false)
			resetForm()

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

	// Delete rule mutation
	const deleteMutation = useMutation({
		mutationFn: async (id: number) => {
			await api.delete(`/api/admin/custom-rules/${id}`)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
			setIsDeleteDialogOpen(false)
			setDeletingRuleId(null)
			toast.success(t('toast.deleted'))
		},
		onError: (error: any) => {
			toast.error(error.response?.data?.error || t('toast.deleteError'))
		},
	})

	// Toggle enabled state mutation
	const toggleEnabledMutation = useMutation({
		mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
			const rule = rules.find(r => r.id === id)
			if (!rule) throw new Error(t('toast.ruleNotFound'))

			// 如果是启用操作且模式为替换，需要检查同类型的其他替换模式规则
			if (enabled && rule.mode === 'replace') {
				// 找出同类型且为替换模式的其他已启用规则
				const conflictingRules = rules.filter(
					r => r.id !== id &&
					r.type === rule.type &&
					r.mode === 'replace' &&
					r.enabled
				)

				// 如果有冲突的规则，先禁用它们
				for (const conflictRule of conflictingRules) {
					await api.put(`/api/admin/custom-rules/${conflictRule.id}`, {
						name: conflictRule.name,
						type: conflictRule.type,
						mode: conflictRule.mode,
						content: conflictRule.content,
						enabled: false,
					})
				}
			}

			// 更新当前规则
			const response = await api.put(`/api/admin/custom-rules/${id}`, {
				name: rule.name,
				type: rule.type,
				mode: rule.mode,
				content: rule.content,
				enabled: enabled,
			})
			return response.data
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
			toast.success(t('toast.statusUpdated'))
		},
		onError: (error: any) => {
			toast.error(error.response?.data?.error || t('toast.statusError'))
		},
	})

	const resetForm = () => {
		setFormData({
			name: '',
			type: 'dns',
			mode: 'replace',
			content: '',
			enabled: true,
		})
		setEditingRule(null)
		setSelectedTemplate(null)
	}

	const handleCreate = () => {
		resetForm()
		setIsDialogOpen(true)
	}

	const handleEdit = (rule: CustomRule) => {
		setEditingRule(rule)
		setFormData({
			name: rule.name,
			type: rule.type,
			mode: rule.mode,
			content: rule.content,
			enabled: rule.enabled,
		})
		setIsDialogOpen(true)
	}

	const handleDelete = (id: number) => {
		setDeletingRuleId(id)
		setIsDeleteDialogOpen(true)
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

		// 如果是新建规则集且使用了模板，询问是否创建对应的规则配置
		if (!editingRule && formData.type === 'rule-providers' && selectedTemplate && selectedTemplate in RULE_PROVIDER_RULES) {
			setPendingRuleProviderData(formData)
			setIsRuleProviderConfirmOpen(true)
			return
		}

		if (editingRule) {
			updateMutation.mutate({ id: editingRule.id, ...formData })
		} else {
			createMutation.mutate(formData)
		}
	}


	// 处理规则集确认创建
	const handleRuleProviderConfirm = async (createRuleConfig: boolean) => {
		if (!pendingRuleProviderData) return

		try {
			// 先创建规则集
			await createMutation.mutateAsync(pendingRuleProviderData)

			// 如果用户选择创建规则配置
			if (createRuleConfig && selectedTemplate && selectedTemplate in RULE_PROVIDER_RULES) {
				const ruleContent = RULE_PROVIDER_RULES[selectedTemplate as keyof typeof RULE_PROVIDER_RULES]

				// 重新获取最新的规则列表
				await queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
				const latestRules = await api.get('/api/admin/custom-rules').then(res => res.data)

				// 查找现有的 rules 类型规则
				const existingRulesRules = latestRules?.filter((r: CustomRule) => r.type === 'rules')

				// 处理规则内容：移除与现有规则重复的部分（忽略大小写）
				let finalRuleContent = ruleContent

				if (existingRulesRules && existingRulesRules.length > 0) {
					// 收集所有现有 rules 的内容
					const allExistingLines: string[] = []
					existingRulesRules.forEach((rule: CustomRule) => {
						const lines = rule.content.split('\n').map((line: string) => line.trim()).filter((line: string) => line)
						// 从第二行开始收集（跳过第一行，通常是注释或标题）
						allExistingLines.push(...lines.slice(1))
					})

					const newLines = ruleContent.split('\n').map((line: string) => line.trim()).filter((line: string) => line)
					const existingLinesLower = allExistingLines.map((line: string) => line.toLowerCase())

					// 过滤掉与现有规则重复的内容
					const filteredNewLines = newLines.filter((line: string) =>
						!existingLinesLower.includes(line.toLowerCase())
					)

					// 如果过滤后还有内容，则使用过滤后的内容
					if (filteredNewLines.length > 0) {
						finalRuleContent = filteredNewLines.join('\n')
					}
				}

				// 创建新的 rules 规则
				const rulesData: RuleFormData = {
					name: t('toast.routeRuleName', { name: pendingRuleProviderData.name }),
					type: 'rules',
					mode: 'append',
					content: finalRuleContent,
					enabled: true
				}
				await createMutation.mutateAsync(rulesData)
				toast.success(t('toast.ruleProviderCreated'))
			} else {
				toast.success(t('toast.ruleProviderOnlyCreated'))
			}
		} catch (error) {
			console.error('Failed to create rule config:', error)
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
			case 'dns':
				return t('type.dns')
			case 'rules':
				return t('type.rules')
			case 'rule-providers':
				return t('type.ruleProviders')
			default:
				return type
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
			default:
				return ''
		}
	}

	const getModeLabel = (mode: string) => {
		switch (mode) {
			case 'replace':
				return t('mode.replace')
			case 'prepend':
				return t('mode.prepend')
			case 'append':
				return t('mode.append')
			default:
				return mode
		}
	}

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
								<CardDescription>
									{t('ruleCount', { count: rules.length })}
								</CardDescription>
							</div>
							<Tabs value={filterType} onValueChange={setFilterType}>
								<TabsList>
									<TabsTrigger value=''>{t('filterAll')}</TabsTrigger>
									<TabsTrigger value='dns'>{t('filterDns')}</TabsTrigger>
									<TabsTrigger value='rules'>{t('filterRules')}</TabsTrigger>
									<TabsTrigger value='rule-providers'>{t('filterRuleProviders')}</TabsTrigger>
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
								data={rules}
								getRowKey={(rule) => rule.id}
								emptyText={t('emptyText')}

								columns={[
									{
										header: t('columns.name'),
										cell: (rule) => rule.name,
										cellClassName: 'font-medium'
									},
									{
										header: t('columns.type'),
										cell: (rule) => (
											<Badge variant='outline' className={getTypeBadgeClass(rule.type)}>
												{getTypeLabel(rule.type)}
											</Badge>
										)
									},
									{
										header: t('columns.mode'),
										cell: (rule) => getModeLabel(rule.mode)
									},
									{
										header: t('columns.status'),
										cell: (rule) => (
											<div className='flex items-center gap-2'>
												<Switch
													checked={rule.enabled}
													onCheckedChange={(checked) => {
														toggleEnabledMutation.mutate({
															id: rule.id,
															enabled: checked,
														})
													}}
													disabled={toggleEnabledMutation.isPending}
												/>
												<span className='text-sm text-muted-foreground'>
													{rule.enabled ? t('actions.enable', { ns: 'common' }) : t('actions.disable', { ns: 'common' })}
												</span>
											</div>
										)
									},
									{
										header: t('columns.createdAt'),
										cell: (rule) => (
											<span className='text-sm text-muted-foreground'>
												{new Date(rule.created_at).toLocaleString('zh-CN')}
											</span>
										)
									},
									{
										header: t('columns.actions'),
										cell: (rule) => (
											<div className='flex justify-end gap-2'>
												<Button
													variant='ghost'
													size='icon'
													onClick={() => handleEdit(rule)}
												>
													<Pencil className='h-4 w-4' />
												</Button>
												<Button
													variant='ghost'
													size='icon'
													onClick={() => handleDelete(rule.id)}
												>
													<Trash2 className='h-4 w-4' />
												</Button>
											</div>
										),
										headerClassName: 'text-right',
										cellClassName: 'text-right'
									}
								] as DataTableColumn<CustomRule>[]}

								mobileCard={{
									header: (rule) => (
										<div className='space-y-1'>
											{/* 第一行：标签 + 名称 + 删除按钮 */}
											<div className='flex items-start justify-between gap-2'>
												<div className='flex items-center gap-2 flex-1 min-w-0'>
													<Badge variant='outline' className={`${getTypeBadgeClass(rule.type)} shrink-0`}>
														{getTypeLabel(rule.type)}
													</Badge>
													<div className='font-medium text-sm truncate flex-1 min-w-0'>{rule.name}</div>
												</div>
												<Button
													variant='outline'
													size='icon'
													className='size-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10'
													onClick={(e) => {
														e.stopPropagation()
														handleDelete(rule.id)
													}}
												>
													<Trash2 className='size-4' />
												</Button>
											</div>

											{/* 第二行：模式 + 状态 */}
											<div className='flex items-center justify-between gap-4 text-xs'>
												<div className='flex items-center gap-2 min-w-0'>
													<span className='text-muted-foreground shrink-0'>{t('mobileLabels.mode')}</span>
													<span className='truncate'>{getModeLabel(rule.mode)}</span>
												</div>
												<div className='flex items-center gap-2 shrink-0'>
													<span className='text-muted-foreground shrink-0'>{t('mobileLabels.status')}</span>
													<div className='flex items-center gap-2'>
														<Switch
															checked={rule.enabled}
															onCheckedChange={(checked) => {
																toggleEnabledMutation.mutate({
																	id: rule.id,
																	enabled: checked,
																})
															}}
															disabled={toggleEnabledMutation.isPending}
														/>
														<span>{rule.enabled ? t('actions.enable', { ns: 'common' }) : t('actions.disable', { ns: 'common' })}</span>
													</div>
												</div>
											</div>

											{/* 第三行：创建时间 */}
											<div className='flex items-center gap-2 text-xs'>
												<span className='text-muted-foreground shrink-0'>{t('mobileLabels.createdAt')}</span>
												<span>{new Date(rule.created_at).toLocaleString('zh-CN')}</span>
											</div>
										</div>
									),
									fields: [],
									actions: (rule) => (
										<Button
											variant='outline'
											size='sm'
											className='w-full'
											onClick={() => handleEdit(rule)}
										>
											<Pencil className='mr-1 h-4 w-4' />
											{t('actions.edit', { ns: 'common' })}
										</Button>
									)
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
							{editingRule ? t('dialog.editTitle') : t('dialog.createTitle')}
						</DialogTitle>
						<DialogDescription>
							{editingRule
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
							onCheckedChange={(checked) =>
								setFormData({ ...formData, enabled: checked })
							}
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
						<Button
							onClick={handleSubmit}
							disabled={
								createMutation.isPending || updateMutation.isPending
							}
						>
							{createMutation.isPending || updateMutation.isPending
								? t('actions.saving', { ns: 'common' })
								: t('actions.save', { ns: 'common' })}
						</Button>
					</div>
				</div>

					<div className='space-y-4 py-4'>
						<div className='space-y-2'>
							<Label htmlFor='name'>{t('dialog.nameLabel')}</Label>
							<Input
								id='name'
								value={formData.name}
								onChange={(e) =>
									setFormData({ ...formData, name: e.target.value })
								}
								placeholder={t('dialog.namePlaceholder')}
							/>
						</div>

						<div className={`grid gap-4 ${!editingRule ? 'grid-cols-4' : 'grid-cols-2'}`}>
							<div className='space-y-2'>
								<Label htmlFor='type'>{t('dialog.typeLabel')}</Label>
								<Select
									value={formData.type}
									onValueChange={(value: any) => {
										const newFormData = {
											...formData,
											type: value,
										}
										// DNS type always uses replace mode
										if (value === 'dns') {
											newFormData.mode = 'replace'
										}
										setFormData(newFormData)
										// Reset selected template when changing type
										setSelectedTemplate(null)
									}}
									disabled={!!editingRule}
								>
									<SelectTrigger id='type'>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value='dns'>{t('type.dns')}</SelectItem>
										<SelectItem value='rules'>{t('type.rules')}</SelectItem>
										<SelectItem value='rule-providers'>{t('type.ruleProviders')}</SelectItem>
									</SelectContent>
								</Select>
							</div>

							<div className='space-y-2'>
								<Label htmlFor='mode'>{t('dialog.modeLabel')}</Label>
								<Select
									value={formData.mode}
									onValueChange={(value: any) =>
										setFormData({ ...formData, mode: value })
									}
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
				{/* 模板选择 - 仅在新建时显示 */}
				{!editingRule && (
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

									// 检查当前名称是否为空或是某个模板的名称
									const allTemplates = RULE_TEMPLATES[formData.type as keyof typeof RULE_TEMPLATES]
									const isTemplateName = Object.values(allTemplates).some(
										(t: any) => t.name === formData.name
									)

									setFormData({
										...formData,
										// 只在名称为空或当前名称是模板名称时才更新名称
										name: (formData.name === '' || isTemplateName) ? template.name : formData.name,
										content: template.content
									})
								}
							}}
						>
							<SelectTrigger id='template'>
								<SelectValue placeholder={t('dialog.templatePlaceholder')} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value='none'>{t('dialog.noTemplate')}</SelectItem>
								{Object.entries(RULE_TEMPLATES[formData.type as keyof typeof RULE_TEMPLATES]).map(([key, template]) => (
									<SelectItem key={key} value={key}>
										{template.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						</div>
					)}
					</div>
						<div className='space-y-2'>
							<Label htmlFor='content'>{t('dialog.contentLabel')}</Label>
							<Textarea
								id='content'
								value={formData.content}
								onChange={(e) =>
									setFormData({ ...formData, content: e.target.value })
								}
								placeholder={t('dialog.contentPlaceholder')}
								className='font-mono text-sm min-h-[300px] whitespace-pre-wrap break-all [field-sizing:fixed]'
							/>
							<p className='text-xs text-muted-foreground'>
								{t('dialog.contentHint')}
							</p>
						</div>

					</div>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<AlertDialog
				open={isDeleteDialogOpen}
				onOpenChange={setIsDeleteDialogOpen}
			>
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
							onClick={() => {
								if (deletingRuleId) {
									deleteMutation.mutate(deletingRuleId)
								}
							}}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? t('deleteConfirm.deleting') : t('deleteConfirm.confirm')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Rule Provider Confirmation Dialog */}
			<AlertDialog
				open={isRuleProviderConfirmOpen}
				onOpenChange={setIsRuleProviderConfirmOpen}
			>
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
						<AlertDialogAction
							onClick={() => handleRuleProviderConfirm(true)}
						>
							{t('ruleProviderConfirm.withRuleConfig')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</main>
	)
}
