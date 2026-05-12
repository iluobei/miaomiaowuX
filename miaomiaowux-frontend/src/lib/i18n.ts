import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

const modules = import.meta.glob('../locales/**/*.json', { eager: true }) as Record<
  string,
  { default?: Record<string, unknown> } & Record<string, unknown>
>

const resources: Record<string, Record<string, Record<string, unknown>>> = {}

for (const path in modules) {
  const match = path.match(/\.\.\/locales\/([^/]+)\/([^/]+)\.json$/)
  if (match) {
    const [, lang, ns] = match
    resources[lang] ??= {}
    resources[lang][ns] = modules[path].default ?? (modules[path] as Record<string, unknown>)
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh-CN',
    supportedLngs: ['zh-CN', 'en'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['cookie', 'navigator'],
      lookupCookie: 'mmw-language',
      caches: ['cookie'],
      cookieOptions: { path: '/', sameSite: 'lax' },
    },
  })

export default i18n
