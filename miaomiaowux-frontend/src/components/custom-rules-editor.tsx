import { useState } from 'react'
import { Collapsible } from '@/components/ui/collapsible'
import type { CustomRule } from '@/lib/sublink/types'

interface CustomRulesEditorProps {
  rules: CustomRule[]
  onChange: (rules: CustomRule[]) => void
}

export function CustomRulesEditor(_props: CustomRulesEditorProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      {/* <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle>{t('editor.title')}</CardTitle>
              <CardDescription>
                {t('editor.description')}
              </CardDescription>
            </div>
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
        </CardHeader>

        <CollapsibleContent>
          <CardContent className='space-y-4'>
            {rules.length === 0 ? (
              <div className='rounded-lg border border-dashed p-8 text-center'>
                <p className='mb-4 text-sm text-muted-foreground'>
                  {t('editor.emptyHint')}
                </p>
                <Button onClick={handleAddRule} variant='outline'>
                  <Plus className='mr-2 h-4 w-4' />
                  {t('editor.addRule')}
                </Button>
              </div>
            ) : (
              <>
                <div className='space-y-4'>
                  {rules.map((rule, index) => (
                    <Card key={index} className='border-muted'>
                      <CardHeader className='pb-3'>
                        <div className='flex items-center justify-between'>
                          <CardTitle className='text-base'>
                            {t('editor.ruleIndex', { index: index + 1 })}
                            {rule.name && ` - ${rule.name}`}
                          </CardTitle>
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => handleRemoveRule(index)}
                          >
                            <Trash2 className='h-4 w-4 text-destructive' />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className='space-y-3'>
                        <div className='grid gap-3 sm:grid-cols-2'>
                          <div className='space-y-1.5'>
                            <Label htmlFor={`rule-${index}-name`}>
                              {t('editor.outboundName')} <span className='text-destructive'>*</span>
                            </Label>
                            <Input
                              id={`rule-${index}-name`}
                              placeholder={t('editor.outboundPlaceholder')}
                              value={rule.name}
                              onChange={(e) =>
                                handleUpdateRule(index, 'name', e.target.value)
                              }
                            />
                            <p className='text-xs text-muted-foreground'>
                              {t('editor.willCreateGroup')}
                            </p>
                          </div>

                          <div className='space-y-1.5'>
                            <Label htmlFor={`rule-${index}-site`}>GeoSite</Label>
                            <Input
                              id={`rule-${index}-site`}
                              placeholder={t('editor.geositePlaceholder')}
                              value={rule.site || ''}
                              onChange={(e) =>
                                handleUpdateRule(index, 'site', e.target.value)
                              }
                            />
                            <p className='text-xs text-muted-foreground'>
                              {t('editor.multipleCommaSeparated')}
                            </p>
                          </div>
                        </div>

                        <div className='grid gap-3 sm:grid-cols-2'>
                          <div className='space-y-1.5'>
                            <Label htmlFor={`rule-${index}-domain-suffix`}>
                              {t('editor.domainSuffix')}
                            </Label>
                            <Input
                              id={`rule-${index}-domain-suffix`}
                              placeholder={t('editor.domainSuffixPlaceholder')}
                              value={rule.domain_suffix || ''}
                              onChange={(e) =>
                                handleUpdateRule(index, 'domain_suffix', e.target.value)
                              }
                            />
                          </div>

                          <div className='space-y-1.5'>
                            <Label htmlFor={`rule-${index}-domain-keyword`}>
                              {t('editor.domainKeyword')}
                            </Label>
                            <Input
                              id={`rule-${index}-domain-keyword`}
                              placeholder={t('editor.domainKeywordPlaceholder')}
                              value={rule.domain_keyword || ''}
                              onChange={(e) =>
                                handleUpdateRule(index, 'domain_keyword', e.target.value)
                              }
                            />
                          </div>
                        </div>

                        <div className='grid gap-3 sm:grid-cols-2'>
                          <div className='space-y-1.5'>
                            <Label htmlFor={`rule-${index}-ip`}>GeoIP</Label>
                            <Input
                              id={`rule-${index}-ip`}
                              placeholder={t('editor.geoipPlaceholder')}
                              value={rule.ip || ''}
                              onChange={(e) =>
                                handleUpdateRule(index, 'ip', e.target.value)
                              }
                            />
                          </div>

                          <div className='space-y-1.5'>
                            <Label htmlFor={`rule-${index}-ip-cidr`}>IP-CIDR</Label>
                            <Input
                              id={`rule-${index}-ip-cidr`}
                              placeholder={t('editor.ipCidrPlaceholder')}
                              value={rule.ip_cidr || ''}
                              onChange={(e) =>
                                handleUpdateRule(index, 'ip_cidr', e.target.value)
                              }
                            />
                          </div>
                        </div>

                        <div className='space-y-1.5'>
                          <Label htmlFor={`rule-${index}-protocol`}>{t('editor.protocol')}</Label>
                          <Input
                            id={`rule-${index}-protocol`}
                            placeholder={t('editor.protocolPlaceholder')}
                            value={rule.protocol || ''}
                            onChange={(e) =>
                              handleUpdateRule(index, 'protocol', e.target.value)
                            }
                          />
                          <p className='text-xs text-muted-foreground'>
                            {t('editor.multipleCommaSeparated')}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Button onClick={handleAddRule} variant='outline' className='w-full'>
                  <Plus className='mr-2 h-4 w-4' />
                  {t('editor.addRule')}
                </Button>
              </>
            )}

            <div className='rounded-lg border bg-muted/50 p-4'>
              <h4 className='mb-2 text-sm font-semibold'>{t('editor.helpTitle')}</h4>
              <ul className='space-y-1 text-xs text-muted-foreground'>
                <li>• {t('editor.helpOutbound')}</li>
                <li>• {t('editor.helpGeosite')}</li>
                <li>• {t('editor.helpDomainSuffix')}</li>
                <li>• {t('editor.helpDomainKeyword')}</li>
                <li>• {t('editor.helpGeoip')}</li>
                <li>• {t('editor.helpIpCidr')}</li>
                <li>• {t('editor.helpProtocol')}</li>
              </ul>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card> */}
    </Collapsible>
  )
}
