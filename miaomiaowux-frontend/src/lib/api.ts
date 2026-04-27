import axios, { AxiosError } from 'axios'
import { useAuthStore } from '@/stores/auth-store'

const AUTH_HEADER = 'MM-Authorization'
const rawConfiguredBaseURL = (import.meta.env.VITE_API_BASE_URL ?? '').trim()

// Determine baseURL based on environment
let baseURL: string | undefined = undefined

if (rawConfiguredBaseURL) {
  // Use configured baseURL, but clear it in production if it's localhost:12889
  baseURL = import.meta.env.PROD && rawConfiguredBaseURL === 'http://localhost:12889'
    ? undefined
    : rawConfiguredBaseURL
} else if (typeof window !== 'undefined' && window.location) {
  // Auto-detect based on current location
  const { protocol, hostname } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    // Development: use port 12889
    baseURL = `${protocol}//${hostname}:12889`
  }
  // Production: leave undefined to use relative paths (same origin)
}

export const api = axios.create({
  baseURL,
  withCredentials: false,
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().auth.accessToken
  if (token) {
    config.headers = config.headers ?? {}
    config.headers[AUTH_HEADER] = token
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error instanceof AxiosError) {
      if (error.response?.status === 401) {
        useAuthStore.getState().auth.reset()
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  }
)
