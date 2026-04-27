import { get as _get } from 'lodash'
import { ProxyNode } from '@/lib/proxy-parser'

// source: https://stackoverflow.com/a/36760050
const IPV4_REGEX = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)(\.(?!$)|$)){4}$/

// source: https://ihateregex.io/expr/ipv6/
const IPV6_REGEX =
  /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/

export class Result {
  proxy: any
  output: string[]

  constructor(proxy: any) {
    this.proxy = proxy
    this.output = []
  }

  append(data: string): void {
    if (typeof data === 'undefined') {
      throw new Error('required field is missing')
    }
    this.output.push(data)
  }

  appendIfPresent(data: string, attr: string): void {
    if (isPresent(this.proxy, attr)) {
      this.append(data)
    }
  }

  toString(): string {
    return this.output.join('')
  }
}

export function isPresent(obj: any, attr?: string): boolean {
  if (typeof attr === 'undefined') {
    // When called with single argument, check if obj itself is present
    return typeof obj !== 'undefined' && obj !== null
  }
  // When called with two arguments, use lodash get
  const data = _get(obj, attr)
  return typeof data !== 'undefined' && data !== null
}

/**
 * 检查是否是 IP 地址（支持方括号包裹的 IPv6）
 */
export function isIP(str: string): boolean {
  const normalized = str.replace(/^\[/, '').replace(/\]$/, '')
  return isIPv4(normalized) || isIPv6(normalized)
}

export function isIPv4(ip: string): boolean {
  return IPV4_REGEX.test(ip)
}

export function isIPv6(ip: string): boolean {
  return IPV6_REGEX.test(ip)
}

export function isValidPortNumber(port: string | number): boolean {
  return /^((6553[0-5])|(655[0-2][0-9])|(65[0-4][0-9]{2})|(6[0-4][0-9]{3})|([1-5][0-9]{4})|([0-5]{0,5})|([0-9]{1,4}))$/.test(
    String(port)
  )
}

export function isNotBlank(str: string): boolean {
  return typeof str === 'string' && str.trim().length > 0
}

export function getIfNotBlank(str: string, defaultValue: string): string {
  return isNotBlank(str) ? str : defaultValue
}

export function getIfPresent<T>(obj: T | null | undefined, defaultValue: T): T {
  return isPresent(obj) ? obj! : defaultValue
}

export function getPolicyDescriptor(str: string): { 'policy-descriptor'?: string; policy?: string } {
  if (!str) return {}
  return /^.+?\s*?=\s*?.+?\s*?,.+?/.test(str)
    ? {
        'policy-descriptor': str,
      }
    : {
        policy: str,
      }
}

export function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min)
  max = Math.floor(max)
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function getRandomPort(portString: string): number {
  const portParts = portString.split(/,|\//)
  const randomPart = portParts[Math.floor(Math.random() * portParts.length)]
  if (randomPart.includes('-')) {
    const [min, max] = randomPart.split('-').map(Number)
    return getRandomInt(min, max)
  } else {
    return Number(randomPart)
  }
}

export function numberToString(value: number | bigint): string {
  return Number.isSafeInteger(value) ? String(value) : BigInt(value).toString()
}

export function isValidUUID(uuid: string): boolean {
  return (
    typeof uuid === 'string' &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(uuid)
  )
}

export function formatDateTime(date: Date | string | number, format = 'YYYY-MM-DD_HH-mm-ss'): string {
  const d = date instanceof Date ? date : new Date(date)

  if (isNaN(d.getTime())) {
    return ''
  }

  const pad = (num: number): string => String(num).padStart(2, '0')

  const replacements: Record<string, string | number> = {
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  }

  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (match) => String(replacements[match]))
}



/**
 * 返回第一个已定义（允许空字符串）的值
 */
export function pickFirstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value
    }
  }
  return undefined
}


/**
 * 判断节点是否需要执行 TLS SNI 回填逻辑
 */
export function shouldApplyTlsSniFallback(node: ProxyNode): boolean {
  return (
    node.tls === true ||
    node.security === 'tls' ||
    node.security === 'reality' ||
    ['trojan', 'hysteria', 'hysteria2', 'tuic', 'anytls'].includes(node.type)
  )
}

/**
 * 从传输层配置中提取 Host（优先 headers.Host，其次 h2/http 的 host）
 */
export function getTransportHost(node: ProxyNode): string {
  const network = typeof node.network === 'string' ? node.network : ''
  if (!network) return ''

  const optsKeys = [(`${network}-opts`)]
  if (network === 'http' || network === 'h2') {
    optsKeys.push('h2-opts')
  }

  for (const optsKey of optsKeys) {
    const transportOpts = node[optsKey] as Record<string, unknown> | undefined
    if (!transportOpts) continue

    const headers = transportOpts.headers as Record<string, unknown> | undefined
    let transportHost = headers?.Host ?? headers?.host

    if (Array.isArray(transportHost)) {
      transportHost = transportHost[0]
    }

    if ((!transportHost || typeof transportHost !== 'string') && (network === 'h2' || network === 'http')) {
      let h2Host = transportOpts.host
      if (Array.isArray(h2Host)) {
        h2Host = h2Host[0]
      }
      if (typeof h2Host === 'string') {
        transportHost = h2Host
      }
    }

    if (typeof transportHost === 'string' && transportHost) {
      return transportHost
    }
  }

  return ''
}

/**
 * TLS 节点的 SNI 后处理
 * 1. 允许显式设置 sni 为空字符串（不回填）
 * 2. 未设置 sni 时优先使用传输层 Host，再回退到非 IP 的 server
 * // THIRD-PARTY BUG FIX
 * 允许设置 sni 为空字符串且为防止影响其他逻辑, 这里先改成这样判断
 * 本质上是为了防止本来应该使用 server 作为 sni 的情况下, 若之后进行了域名解析, 导致 server 变成 ip 丢失了 sni
 * 为了兼容性, 暂时先这么改
 * see https://github.com/sub-store-org/Sub-Store/commit/38e49e508b620dac29ae87178cfca80f750468ac
 */
export function applyTlsSniFallback(node: ProxyNode): void {
  if (!shouldApplyTlsSniFallback(node) || node.sni !== undefined) {
    return
  }

  const transportHost = getTransportHost(node)
  if (transportHost) {
    node.sni = transportHost
    return
  }

  if (!node.sni && !isIP(node.server)) {
    node.sni = node.server
  }
}
