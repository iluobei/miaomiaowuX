import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useProxyGroupCategories } from '@/hooks/use-proxy-groups'
import type { PredefinedRuleSetType } from '@/lib/sublink/types'

interface RuleSelectorProps {
  ruleSet: PredefinedRuleSetType
  onRuleSetChange: (value: PredefinedRuleSetType) => void
  selectedCategories: string[]
  onCategoriesChange: (categories: string[]) => void
}

export function RuleSelector({
  ruleSet,
  onRuleSetChange,
  selectedCategories,
  onCategoriesChange,
}: RuleSelectorProps) {
  const { t } = useTranslation('subscribe')
  const [isOpen, setIsOpen] = useState(true)
  const { data: categories = [], isLoading, isError } = useProxyGroupCategories()

  // Track the previous ruleset to detect changes
  const [prevRuleSet, setPrevRuleSet] = useState<PredefinedRuleSetType>(ruleSet)
  // Track whether we've initialized
  const [initialized, setInitialized] = useState(false)

  // Initialize selected categories on first load when categories are available
  useEffect(() => {
    if (!initialized && categories.length > 0 && ruleSet !== 'custom') {
      // Calculate preset categories for initial ruleset
      let presetCategories: string[] = []
      if (ruleSet === 'minimal') {
        presetCategories = categories.filter((c) => c.presets.includes('minimal')).map((c) => c.name)
      } else if (ruleSet === 'balanced') {
        presetCategories = categories.filter((c) => c.presets.includes('balanced')).map((c) => c.name)
      } else if (ruleSet === 'comprehensive') {
        presetCategories = categories.map((c) => c.name)
      }

      if (presetCategories.length > 0) {
        onCategoriesChange(presetCategories)
        setInitialized(true)
      }
    }
  }, [categories, ruleSet, initialized, onCategoriesChange])

  // Update selected categories when ruleset changes (not on initial load)
  useEffect(() => {
    // Only run when ruleSet actually changes after initialization
    if (!initialized) {
      return
    }

    if (ruleSet === prevRuleSet) {
      return
    }

    setPrevRuleSet(ruleSet)

    if (ruleSet !== 'custom') {
      // Calculate preset categories directly to avoid dependency on predefinedRuleSets
      let presetCategories: string[] = []
      if (ruleSet === 'minimal') {
        presetCategories = categories.filter((c) => c.presets.includes('minimal')).map((c) => c.name)
      } else if (ruleSet === 'balanced') {
        presetCategories = categories.filter((c) => c.presets.includes('balanced')).map((c) => c.name)
      } else if (ruleSet === 'comprehensive') {
        presetCategories = categories.map((c) => c.name)
      }
      onCategoriesChange(presetCategories)
    }
  }, [ruleSet, categories, prevRuleSet, initialized, onCategoriesChange])

  const handleCategoryToggle = (categoryName: string) => {
    if (selectedCategories.includes(categoryName)) {
      onCategoriesChange(selectedCategories.filter((c) => c !== categoryName))
    } else {
      // After adding a new category, sort by the order in categories
      const newCategories = [...selectedCategories, categoryName]
      const orderedCategories = categories
        .map((c) => c.name)
        .filter((name) => newCategories.includes(name))
      onCategoriesChange(orderedCategories)
    }
  }

  const handleRuleSetChange = (value: string) => {
    const newRuleSet = value as PredefinedRuleSetType
    onRuleSetChange(newRuleSet)

    // Always show categories, expanded by default
    setIsOpen(true)
  }

  return (
    <div className='space-y-2'>
      <div className='flex items-center gap-2'>
        <Label htmlFor='ruleset'>{t('ruleSelector.label')}</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className='h-4 w-4 text-muted-foreground' />
            </TooltipTrigger>
            <TooltipContent className='max-w-xs'>
              <p>{t('ruleSelector.tooltip')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Select value={ruleSet} onValueChange={handleRuleSetChange}>
        <SelectTrigger id='ruleset'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='custom'>{t('ruleSelector.custom')}</SelectItem>
          <SelectItem value='minimal'>{t('ruleSelector.minimal')}</SelectItem>
          <SelectItem value='balanced'>{t('ruleSelector.balanced')}</SelectItem>
          <SelectItem value='comprehensive'>{t('ruleSelector.comprehensive')}</SelectItem>
        </SelectContent>
      </Select>

      <p className='text-sm text-muted-foreground'>
        {ruleSet === 'custom' && t('ruleSelector.customDesc')}
        {ruleSet === 'minimal' && t('ruleSelector.minimalDesc')}
        {ruleSet === 'balanced' && t('ruleSelector.balancedDesc')}
        {ruleSet === 'comprehensive' && t('ruleSelector.comprehensiveDesc')}
      </p>

      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className='rounded-lg border p-4'>
          <div className='mb-3 flex items-center justify-between'>
            <p className='text-sm font-medium'>
              {t('ruleSelector.selectedCount', { count: selectedCategories.length })}
            </p>
            <CollapsibleTrigger asChild>
              <Button variant='ghost' size='sm'>
                {isOpen ? (
                  <ChevronUp className='h-4 w-4' />
                ) : (
                  <ChevronDown className='h-4 w-4' />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent>
            {isLoading && (
              <p className='text-sm text-muted-foreground'>{t('ruleSelector.loadingCategories')}</p>
            )}
            {isError && (
              <p className='text-sm text-destructive'>
                {t('ruleSelector.loadError')}
              </p>
            )}
            {!isLoading && !isError && categories.length === 0 && (
              <p className='text-sm text-muted-foreground'>{t('ruleSelector.noCategories')}</p>
            )}
            {!isLoading && !isError && categories.length > 0 && (
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                {categories.map((category) => (
                  <div
                    key={category.name}
                    className='flex cursor-pointer items-center space-x-2'
                    onClick={() => handleCategoryToggle(category.name)}
                  >
                    <Checkbox
                      id={`category-${category.name}`}
                      checked={selectedCategories.includes(category.name)}
                      onCheckedChange={() => {}}
                    />
                    <div className='flex items-center gap-1.5 text-sm leading-none'>
                      <span>{category.icon}</span>
                      <span>{category.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  )
}
