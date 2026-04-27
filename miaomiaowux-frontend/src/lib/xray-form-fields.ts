// @ts-nocheck
// Field type definitions for Xray inbound configuration forms

export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'textarea'
  | 'array'
  | 'password'
  | 'host-port'

export interface FieldOption {
  label: string
  value: string | number
}

export interface BaseField {
  name: string
  label: string
  type: FieldType
  placeholder?: string
  defaultValue?: any
  required?: boolean
  description?: string
  validation?: (value: any) => boolean
}

export interface TextField extends BaseField {
  type: 'text' | 'password' | 'textarea'
  generateKey?: boolean  // If true, shows a generate button for keys
}

export interface NumberField extends BaseField {
  type: 'number'
  min?: number
  max?: number
}

export interface SelectField extends BaseField {
  type: 'select'
  options: FieldOption[]
  renderAs?: 'dropdown' | 'radio'  // How to render: dropdown (default) or radio buttons
}

export interface CheckboxField extends BaseField {
  type: 'checkbox'
}

export interface ArrayField extends BaseField {
  type: 'array'
  itemFields: Field[]
  addButtonText?: string
}

export interface HostPortField extends BaseField {
  type: 'host-port'
  defaultPort?: number
}

export type Field = TextField | NumberField | SelectField | CheckboxField | ArrayField | HostPortField

// Common fields for all inbound configurations
export const commonFields: Field[] = [
  {
    name: 'port',
    label: '端口',
    type: 'number',
    placeholder: '443',
    required: true,
    min: 1,
    max: 65535,
    description: '监听端口号',
  },
  {
    name: 'listen',
    label: '监听地址',
    type: 'text',
    placeholder: '0.0.0.0',
    defaultValue: '0.0.0.0',
    description: '监听地址，0.0.0.0 表示监听所有网卡',
  },
  {
    name: 'tag',
    label: '入站标识',
    type: 'text',
    placeholder: 'vless-tcp-reality-443',
    description: '入站标识，用于路由规则。会根据协议-传输-安全-端口自动生成',
  },
  {
    name: 'sniffing',
    label: '启用流量嗅探',
    type: 'checkbox',
    defaultValue: true,
    description: '自动识别并覆盖目标地址',
  },
]

// Common fields for all outbound configurations
export const outboundCommonFields: Field[] = [
  {
    name: 'address',
    label: '服务器地址',
    type: 'text',
    placeholder: 'example.com 或 1.2.3.4',
    required: true,
    description: '远程服务器地址（域名或IP）',
  },
  {
    name: 'port',
    label: '服务器端口',
    type: 'number',
    placeholder: '443',
    required: true,
    min: 1,
    max: 65535,
    description: '远程服务器端口号',
  },
  {
    name: 'tag',
    label: '出站标识',
    type: 'text',
    placeholder: 'proxy',
    defaultValue: 'proxy',
    description: '出站标识，用于路由规则',
  },
]

// Transport-specific fields
export const transportFields: Record<string, Field[]> = {
  None: [],
  TCP: [],
  HTTP: [
    {
      name: 'path',
      label: '路径',
      type: 'text',
      placeholder: '/path',
      defaultValue: '/',
      description: 'HTTP路径',
    },
    {
      name: 'host',
      label: '主机名',
      type: 'text',
      placeholder: 'example.com',
      description: '主机名，多个用逗号分隔',
    },
  ],
  HTTP2: [
    {
      name: 'path',
      label: '路径',
      type: 'text',
      placeholder: '/path',
      defaultValue: '/',
      description: 'HTTP/2路径',
    },
    {
      name: 'host',
      label: '主机名',
      type: 'text',
      placeholder: 'example.com',
      description: '主机名，多个用逗号分隔',
    },
  ],
  Websocket: [
    {
      name: 'path',
      label: 'WebSocket路径',
      type: 'text',
      placeholder: '/ws',
      defaultValue: '/ws',
      description: 'WebSocket连接路径',
    },
  ],
  GRPC: [
    {
      name: 'serviceName',
      label: '服务名称',
      type: 'text',
      placeholder: 'GunService',
      required: true,
      description: 'gRPC服务名称',
    },
  ],
  XHTTP: [
    {
      name: 'path',
      label: 'XHTTP路径',
      type: 'text',
      placeholder: '/yourpath',
      defaultValue: '/xhttp',
      description: 'XHTTP连接路径',
    },
    {
      name: 'mode',
      label: '传输模式',
      type: 'select',
      options: [
        { label: 'auto', value: 'auto' },
        { label: 'stream-up', value: 'stream-up' },
        { label: 'stream-one', value: 'stream-one' },
      ],
      defaultValue: 'auto',
      description: 'XHTTP传输模式',
    },
    {
      name: 'host',
      label: 'Host',
      type: 'text',
      placeholder: '',
      description: '自定义Host头，留空使用默认',
    },
  ],
  WSS: [
    {
      name: 'path',
      label: 'WebSocket路径',
      type: 'text',
      placeholder: '/wss',
      defaultValue: '/wss',
      description: 'WebSocket Secure路径',
    },
  ],
}

// Security-specific fields
export const securityFields: Record<string, Field[]> = {
  None: [],
  TLS: [
    {
      name: 'serverName',
      label: '服务器名称(SNI)',
      type: 'text',
      placeholder: 'example.com',
      description: 'TLS服务器名称',
    },
    {
      name: 'certificateFile',
      label: '证书文件路径',
      type: 'text',
      placeholder: '/path/to/fullchain.crt',
      required: true,
      description: '证书文件的绝对路径',
    },
    {
      name: 'keyFile',
      label: '密钥文件路径',
      type: 'text',
      placeholder: '/path/to/private.key',
      required: true,
      description: '私钥文件的绝对路径',
    },
    {
      name: 'alpn',
      label: 'ALPN',
      type: 'text',
      placeholder: 'h2,http/1.1',
      defaultValue: 'h2,http/1.1',
      description: 'ALPN协议列表，逗号分隔',
    },
    {
      name: 'minVersion',
      label: '最低TLS版本',
      type: 'select',
      options: [
        { label: 'TLS 1.2', value: '1.2' },
        { label: 'TLS 1.3', value: '1.3' },
      ],
      defaultValue: '1.2',
    },
  ],
  REALITY: [
    {
      name: 'dest',
      label: '目标网站',
      type: 'host-port',
      placeholder: 'example.com',
      defaultPort: 443,
      required: true,
      description: '支持TLS 1.3和H2的目标网站',
    },
    {
      name: 'serverNames',
      label: '服务器名称列表',
      type: 'text',
      placeholder: 'example.com,www.example.com',
      description: '目标网站证书中的服务器名称，逗号分隔',
    },
    {
      name: 'privateKey',
      label: '私钥',
      type: 'password',
      placeholder: '执行 xray x25519 生成',
      required: true,
      description: '使用 xray x25519 命令生成的私钥',
      generateKey: true,
    },
    {
      name: 'shortIds',
      label: 'Short IDs',
      type: 'text',
      placeholder: '留空,0123456789abcdef',
      defaultValue: '',
      description: '短ID列表，逗号分隔，留空表示客户端可为空',
    },
  ],
  'XTLS-Vision': [
    {
      name: 'certificateFile',
      label: '证书文件路径',
      type: 'text',
      placeholder: '/path/to/fullchain.crt',
      required: true,
      description: '证书文件的绝对路径',
    },
    {
      name: 'keyFile',
      label: '密钥文件路径',
      type: 'text',
      placeholder: '/path/to/private.key',
      required: true,
      description: '私钥文件的绝对路径',
    },
    {
      name: 'minVersion',
      label: '最低TLS版本',
      type: 'select',
      options: [
        { label: 'TLS 1.2', value: '1.2' },
        { label: 'TLS 1.3', value: '1.3' },
      ],
      defaultValue: '1.2',
    },
  ],
  'XTLS-Vision-REALITY': [
    {
      name: 'dest',
      label: '目标网站',
      type: 'host-port',
      placeholder: 'example.com',
      defaultPort: 443,
      required: true,
      description: '支持TLS 1.3和H2的目标网站',
    },
    {
      name: 'serverNames',
      label: '服务器名称列表',
      type: 'text',
      placeholder: 'example.com,www.example.com',
      description: '目标网站证书中的服务器名称，逗号分隔',
    },
    {
      name: 'privateKey',
      label: '私钥',
      type: 'password',
      placeholder: '执行 xray x25519 生成',
      required: true,
      description: '使用 xray x25519 命令生成的私钥',
      generateKey: true,
    },
    {
      name: 'shortIds',
      label: 'Short IDs',
      type: 'text',
      placeholder: '留空,0123456789abcdef',
      defaultValue: '',
      description: '短ID列表，逗号分隔，留空表示客户端可为空',
    },
  ],
}

// Protocol-specific fields
export const protocolFields: Record<string, Field[]> = {
  Shadowsocks2022: [
    {
      name: 'method',
      label: '加密方法',
      type: 'select',
      required: true,
      options: [
        { label: '2022-blake3-aes-128-gcm', value: '2022-blake3-aes-128-gcm' },
        { label: '2022-blake3-aes-256-gcm', value: '2022-blake3-aes-256-gcm' },
        { label: '2022-blake3-chacha20-poly1305', value: '2022-blake3-chacha20-poly1305' },
      ],
      defaultValue: '2022-blake3-aes-128-gcm',
      renderAs: 'radio',
    },
    {
      name: 'serverPassword',
      label: '服务器密码 (PSK)',
      type: 'password',
      required: true,
      placeholder: '输入密码或点击生成随机密码',
      description: '输入密码后会自动进行 Base64 编码',
      generateKey: true,
    },
    {
      name: 'network',
      label: '网络类型',
      type: 'select',
      options: [
        { label: 'TCP+UDP', value: 'tcp,udp' },
        { label: 'TCP', value: 'tcp' },
        { label: 'UDP', value: 'udp' },
      ],
      defaultValue: 'tcp,udp',
      renderAs: 'radio',
    },
  ],
  Socks5: [
    {
      name: 'auth',
      label: '认证方式',
      type: 'select',
      required: true,
      options: [
        { label: '密码认证', value: 'password' },
        { label: '无认证', value: 'noauth' },
      ],
      defaultValue: 'password',
      renderAs: 'radio',
    },
    {
      name: 'udp',
      label: '启用UDP',
      type: 'checkbox',
      defaultValue: true,
      description: '是否支持UDP代理',
    },
  ],
  Trojan: [],
  VLESS: [
    {
      name: 'decryption',
      label: '解密方式',
      type: 'select',
      options: [
        { label: 'none (无加密)', value: 'none' },
        { label: 'mlkem768x25519plus (后量子加密)', value: 'mlkem768x25519plus' },
      ],
      defaultValue: 'none',
      description: 'VLESS解密方式，支持后量子加密',
      renderAs: 'radio',
    },
    {
      name: 'encryption',
      label: '加密方式',
      type: 'select',
      options: [{ label: 'none', value: 'none' }],
      defaultValue: 'none',
      description: '客户端加密方式',
      renderAs: 'radio',
    },
  ],
  VMess: [],
  Hysteria2: [
    {
      name: 'obfs',
      label: '混淆类型',
      type: 'select',
      options: [
        { label: '无混淆', value: '' },
        { label: 'Salamander', value: 'salamander' },
      ],
      defaultValue: '',
      renderAs: 'radio',
      description: '可选的流量混淆，启用后需设置混淆密码',
    },
    {
      name: 'obfsPassword',
      label: '混淆密码',
      type: 'password',
      placeholder: '混淆密码',
      description: '启用混淆时必填',
    },
  ],
  HTTP: [
    {
      name: 'auth',
      label: '认证方式',
      type: 'select',
      required: true,
      options: [
        { label: '无认证', value: 'noauth' },
        { label: '密码认证', value: 'password' },
      ],
      defaultValue: 'noauth',
      renderAs: 'radio',
      description: 'HTTP代理认证方式',
    },
    {
      name: 'udp',
      label: '启用UDP',
      type: 'checkbox',
      defaultValue: true,
      description: '是否支持UDP代理',
    },
    {
      name: 'allowTransparent',
      label: '允许透明代理',
      type: 'checkbox',
      defaultValue: false,
      description: '当为true时，会转发所有HTTP请求，而非只是代理请求',
    },
  ],
  Tunnel: [
    {
      name: 'address',
      label: '转发地址',
      type: 'text',
      required: true,
      placeholder: 'example.com',
      description: '转发到的目标地址(域名或IP)',
    },
    {
      name: 'forwardPort',
      label: '转发端口',
      type: 'number',
      required: true,
      placeholder: '25565',
      min: 1,
      max: 65535,
      description: '转发到的目标端口',
    },
    {
      name: 'network',
      label: '网络类型',
      type: 'select',
      options: [
        { label: 'TCP', value: 'tcp' },
        { label: 'UDP', value: 'udp' },
        { label: 'TCP+UDP', value: 'tcp,udp' },
      ],
      defaultValue: 'tcp',
      renderAs: 'radio',
      description: '协议类型',
    },
    {
      name: 'followRedirect',
      label: '跟随重定向',
      type: 'checkbox',
      defaultValue: false,
      description: '当值为 true 时，tunnel 会识别出由 iptables 转发而来的数据',
    },
    {
      name: 'userLevel',
      label: '用户等级',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
      description: '用户等级，所有连接使用这一等级',
    },
  ],
  // Freedom 出站协议配置
  Freedom: [
    {
      name: 'domainStrategy',
      label: '域名策略',
      type: 'select',
      options: [
        { label: 'AsIs (推荐)', value: 'AsIs' },
        { label: 'UseIP', value: 'UseIP' },
        { label: 'UseIPv4', value: 'UseIPv4' },
        { label: 'UseIPv6', value: 'UseIPv6' },
        { label: 'UseIPv4v6', value: 'UseIPv4v6' },
        { label: 'UseIPv6v4', value: 'UseIPv6v4' },
        { label: 'ForceIP', value: 'ForceIP' },
        { label: 'ForceIPv4', value: 'ForceIPv4' },
        { label: 'ForceIPv6', value: 'ForceIPv6' },
        { label: 'ForceIPv4v6', value: 'ForceIPv4v6' },
        { label: 'ForceIPv6v4', value: 'ForceIPv6v4' },
      ],
      defaultValue: 'AsIs',
      description: '使用 AsIs 才可以把域名交给后面的 sockopt 模块处理',
    },
  ],
  // Blackhole 出站协议配置（无需配置）
  Blackhole: [],
}

// Client configuration fields for protocols that use client arrays
export const clientFields: Record<string, Field[]> = {
  Shadowsocks2022: [
    {
      name: 'password',
      label: '用户密码 (PSK)',
      type: 'password',
      required: true,
      placeholder: '输入密码或点击生成随机密码',
      description: '输入密码后会自动进行 Base64 编码',
      generateKey: true,
    },
    {
      name: 'email',
      label: '邮箱（用于流量统计）',
      type: 'text',
      placeholder: 'user@example.com',
      description: '用于标识用户',
    },
    {
      name: 'level',
      label: '用户等级',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
      description: '用户等级，默认为0',
    },
  ],
  Socks5: [
    {
      name: 'user',
      label: '用户名',
      type: 'text',
      required: true,
      placeholder: 'username',
    },
    {
      name: 'pass',
      label: '密码',
      type: 'password',
      required: true,
      placeholder: 'password',
    },
    {
      name: 'email',
      label: '邮箱（用于流量统计）',
      type: 'text',
      placeholder: 'user@example.com',
      description: '用于标识用户',
    },
    {
      name: 'level',
      label: '用户等级',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
      description: '用户等级，默认为0',
    },
  ],
  Trojan: [
    {
      name: 'password',
      label: '密码',
      type: 'password',
      required: true,
      placeholder: '用户密码',
    },
    {
      name: 'email',
      label: '邮箱（用于流量统计）',
      type: 'text',
      placeholder: 'user@example.com',
      description: '用于标识用户',
    },
    {
      name: 'level',
      label: '用户等级',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
      description: '用户等级，默认为0',
    },
  ],
  VLESS: [
    {
      name: 'id',
      label: 'UUID',
      type: 'text',
      required: true,
      placeholder: '执行 xray uuid 生成',
      description: '用户UUID，使用 xray uuid 命令生成',
    },
    {
      name: 'email',
      label: '邮箱（用于流量统计）',
      type: 'text',
      placeholder: 'user@example.com',
      description: '用于标识用户',
    },
    {
      name: 'level',
      label: '用户等级',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
    },
  ],
  VMess: [
    {
      name: 'id',
      label: 'UUID',
      type: 'text',
      required: true,
      placeholder: '执行 xray uuid 生成',
      description: '用户UUID，使用 xray uuid 命令生成',
    },
    {
      name: 'email',
      label: '邮箱（用于流量统计）',
      type: 'text',
      placeholder: 'user@example.com',
      description: '用于标识用户',
    },
    {
      name: 'level',
      label: '用户等级',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
    },
  ],
  HTTP: [
    {
      name: 'user',
      label: '用户名',
      type: 'text',
      required: true,
      placeholder: 'username',
    },
    {
      name: 'pass',
      label: '密码',
      type: 'password',
      required: true,
      placeholder: 'password',
    },
    {
      name: 'email',
      label: '邮箱（用于流量统计）',
      type: 'text',
      placeholder: 'user@example.com',
      description: '用于标识用户',
    },
    {
      name: 'level',
      label: '用户等级',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
      description: '用户等级，默认为0',
    },
  ],
  Hysteria2: [
    {
      name: 'auth',
      label: '认证密码',
      type: 'password',
      required: true,
      placeholder: '用户认证密码',
      description: '客户端连接时使用的密码',
    },
    {
      name: 'email',
      label: '邮箱（用于流量统计）',
      type: 'text',
      placeholder: 'user@example.com',
      description: '用于标识用户',
    },
    {
      name: 'level',
      label: '用户等级',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
    },
  ],
}

// Check if protocol requires flow field (for XTLS)
export function requiresFlow(protocol: string, security: string): boolean {
  return (
    (protocol === 'VLESS' || protocol === 'Trojan') &&
    (security === 'XTLS-Vision' || security === 'XTLS-Vision-REALITY')
  )
}

// Get flow field for protocols that support it
export function getFlowField(): Field {
  return {
    name: 'flow',
    label: '流控',
    type: 'select',
    options: [
      { label: 'xtls-rprx-vision', value: 'xtls-rprx-vision' },
    ],
    defaultValue: 'xtls-rprx-vision',
    description: 'XTLS流控模式',
  }
}
