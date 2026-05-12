import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Shield, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

interface Certificate {
  id: number
  domain: string
  cert_path: string
  key_path: string
  status: string
  expiry_date: string
  remote_server_id: number
}

interface CertSelectFieldProps {
  value: number | null
  onChange: (certId: number | null, certPath: string, keyPath: string) => void
  remoteServerId?: number // Filter certificates by server
  label?: string
  description?: string
}

export function CertSelectField({
  value,
  onChange,
  remoteServerId = 0,
  label,
  description,
}: CertSelectFieldProps) {
  const { t } = useTranslation('xray')
  const { auth } = useAuthStore()

  // Fetch valid certificates
  const { data: certificates, isLoading } = useQuery({
    queryKey: ['certificates-valid', remoteServerId],
    queryFn: async () => {
      const response = await api.get('/api/admin/certificates/valid')
      const certs = response.data.certificates as Certificate[]
      // Filter by server if specified
      if (remoteServerId !== undefined) {
        return certs.filter(c => c.remote_server_id === remoteServerId)
      }
      return certs
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 60 * 1000, // Cache for 1 minute
  })

  const selectedCert = certificates?.find(c => c.id === value)

  const handleChange = (certIdStr: string) => {
    if (certIdStr === 'none') {
      onChange(null, '', '')
      return
    }
    const certId = parseInt(certIdStr)
    const cert = certificates?.find(c => c.id === certId)
    if (cert) {
      onChange(certId, cert.cert_path, cert.key_path)
    }
  }

  const getDaysUntilExpiry = (expiryDate: string) => {
    if (!expiryDate) return null
    const expiry = new Date(expiryDate)
    const now = new Date()
    return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  }

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        <Shield className="h-4 w-4" />
        {label || t('certSelect.selectCert')}
      </Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <Select
        value={value ? String(value) : 'none'}
        onValueChange={handleChange}
        disabled={isLoading}
      >
        <SelectTrigger>
          <SelectValue placeholder={isLoading ? t('certSelect.loading') : t('certSelect.selectAppliedCert')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            <span className="text-muted-foreground">{t('certSelect.noManagedCert')}</span>
          </SelectItem>
          {certificates?.length === 0 && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 mx-auto mb-2" />
              {t('certSelect.noCerts')}
              <br />
              <span className="text-xs">{t('certSelect.noCertsDesc')}</span>
            </div>
          )}
          {certificates?.map((cert) => {
            const days = getDaysUntilExpiry(cert.expiry_date)
            return (
              <SelectItem key={cert.id} value={String(cert.id)}>
                <div className="flex items-center gap-2">
                  <span>{cert.domain}</span>
                  {days !== null && days <= 30 && (
                    <Badge variant={days <= 7 ? 'destructive' : 'outline'} className="text-xs">
                      {t('certSelect.daysExpiry', { days })}
                    </Badge>
                  )}
                </div>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      {selectedCert && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div>{t('certSelect.certPath')}: {selectedCert.cert_path}</div>
          <div>{t('certSelect.keyPath')}: {selectedCert.key_path}</div>
        </div>
      )}
    </div>
  )
}
