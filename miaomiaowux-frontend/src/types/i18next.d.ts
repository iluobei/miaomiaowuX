import type common from '../locales/zh-CN/common.json'
import type auth from '../locales/zh-CN/auth.json'
import type settings from '../locales/zh-CN/settings.json'
import type system from '../locales/zh-CN/system.json'
import type nodes from '../locales/zh-CN/nodes.json'
import type xray from '../locales/zh-CN/xray.json'
import type certificates from '../locales/zh-CN/certificates.json'
import type users from '../locales/zh-CN/users.json'
import type packages from '../locales/zh-CN/packages.json'
import type templates from '../locales/zh-CN/templates.json'
import type subscribe from '../locales/zh-CN/subscribe.json'
import type dashboard from '../locales/zh-CN/dashboard.json'
import type errors from '../locales/zh-CN/errors.json'
import type customRules from '../locales/zh-CN/customRules.json'
import type rules from '../locales/zh-CN/rules.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof common
      auth: typeof auth
      settings: typeof settings
      system: typeof system
      nodes: typeof nodes
      xray: typeof xray
      certificates: typeof certificates
      users: typeof users
      packages: typeof packages
      templates: typeof templates
      subscribe: typeof subscribe
      dashboard: typeof dashboard
      errors: typeof errors
      customRules: typeof customRules
      rules: typeof rules
    }
  }
}
