import { AxiosError } from 'axios'
import { toast } from 'sonner'
import i18n from '@/lib/i18n'

export function handleServerError(error: unknown) {
  // eslint-disable-next-line no-console
  console.log(error)

  let errMsg = i18n.t('errors:server.somethingWentWrong')

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number((error as { status?: unknown }).status) === 204
  ) {
    errMsg = i18n.t('errors:server.contentNotFound')
  }

  if (error instanceof AxiosError) {
    const data = error.response?.data as Record<string, unknown> | string | undefined
    if (typeof data === 'string') {
      errMsg = data
    } else if (data) {
      const record = data as Record<string, unknown>
      const messageFields = ['msg', 'message', 'error', 'title'] as const
      for (const field of messageFields) {
        const value = record[field]
        if (typeof value === 'string' && value.trim()) {
          errMsg = value
          break
        }
      }
    }
  }

  toast.error(errMsg)
}
