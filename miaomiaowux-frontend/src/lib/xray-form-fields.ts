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
    label: 'fields.port',
    type: 'number',
    placeholder: '443',
    required: true,
    min: 1,
    max: 65535,
    description: 'fields.portDesc',
  },
  {
    name: 'listen',
    label: 'fields.listen',
    type: 'text',
    placeholder: '0.0.0.0',
    defaultValue: '0.0.0.0',
    description: 'fields.listenDesc',
  },
  {
    name: 'tag',
    label: 'fields.tag',
    type: 'text',
    placeholder: 'vless-tcp-reality-443',
    description: 'fields.tagDesc',
  },
  {
    name: 'sniffing',
    label: 'fields.sniffing',
    type: 'checkbox',
    defaultValue: true,
    description: 'fields.sniffingDesc',
  },
]

// Common fields for all outbound configurations
export const outboundCommonFields: Field[] = [
  {
    name: 'address',
    label: 'fields.serverAddress',
    type: 'text',
    placeholder: 'example.com / 1.2.3.4',
    required: true,
    description: 'fields.serverAddressDesc',
  },
  {
    name: 'port',
    label: 'fields.serverPort',
    type: 'number',
    placeholder: '443',
    required: true,
    min: 1,
    max: 65535,
    description: 'fields.serverPortDesc',
  },
  {
    name: 'tag',
    label: 'fields.outboundTag',
    type: 'text',
    placeholder: 'proxy',
    defaultValue: 'proxy',
    description: 'fields.outboundTagDesc',
  },
]

// Transport-specific fields
export const transportFields: Record<string, Field[]> = {
  None: [],
  TCP: [],
  HTTP: [
    {
      name: 'path',
      label: 'fields.path',
      type: 'text',
      placeholder: '/path',
      defaultValue: '/',
      description: 'fields.pathDesc_http',
    },
    {
      name: 'host',
      label: 'fields.host',
      type: 'text',
      placeholder: 'example.com',
      description: 'fields.hostDesc',
    },
  ],
  HTTP2: [
    {
      name: 'path',
      label: 'fields.path',
      type: 'text',
      placeholder: '/path',
      defaultValue: '/',
      description: 'fields.pathDesc_http2',
    },
    {
      name: 'host',
      label: 'fields.host',
      type: 'text',
      placeholder: 'example.com',
      description: 'fields.hostDesc',
    },
  ],
  Websocket: [
    {
      name: 'path',
      label: 'fields.path',
      type: 'text',
      placeholder: '/ws',
      defaultValue: '/ws',
      description: 'fields.pathDesc_ws',
    },
  ],
  GRPC: [
    {
      name: 'serviceName',
      label: 'fields.serviceName',
      type: 'text',
      placeholder: 'GunService',
      required: true,
      description: 'fields.serviceNameDesc',
    },
  ],
  XHTTP: [
    {
      name: 'path',
      label: 'fields.path',
      type: 'text',
      placeholder: '/yourpath',
      defaultValue: '/xhttp',
      description: 'fields.pathDesc_xhttp',
    },
    {
      name: 'mode',
      label: 'fields.transportMode',
      type: 'select',
      options: [
        { label: 'auto', value: 'auto' },
        { label: 'stream-up', value: 'stream-up' },
        { label: 'stream-one', value: 'stream-one' },
      ],
      defaultValue: 'auto',
      description: 'fields.transportModeDesc',
    },
    {
      name: 'host',
      label: 'Host',
      type: 'text',
      placeholder: '',
      description: 'fields.hostCustomDesc',
    },
  ],
  WSS: [
    {
      name: 'path',
      label: 'fields.path',
      type: 'text',
      placeholder: '/wss',
      defaultValue: '/wss',
      description: 'fields.pathDesc_wss',
    },
  ],
}

// Security-specific fields
export const securityFields: Record<string, Field[]> = {
  None: [],
  TLS: [
    {
      name: 'serverName',
      label: 'fields.serverName_sni',
      type: 'text',
      placeholder: 'example.com',
      description: 'fields.serverNameDesc_tls',
    },
    {
      name: 'certificateFile',
      label: 'fields.certFilePath',
      type: 'text',
      placeholder: '/path/to/fullchain.crt',
      required: true,
      description: 'fields.certFilePathDesc',
    },
    {
      name: 'keyFile',
      label: 'fields.keyFilePath',
      type: 'text',
      placeholder: '/path/to/private.key',
      required: true,
      description: 'fields.keyFilePathDesc',
    },
    {
      name: 'alpn',
      label: 'fields.alpn',
      type: 'text',
      placeholder: 'h2,http/1.1',
      defaultValue: 'h2,http/1.1',
      description: 'fields.alpnDesc',
    },
    {
      name: 'minVersion',
      label: 'fields.minTlsVersion',
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
      label: 'fields.dest',
      type: 'host-port',
      placeholder: 'example.com',
      defaultPort: 443,
      required: true,
      description: 'fields.destDesc',
    },
    {
      name: 'serverNames',
      label: 'fields.serverNames',
      type: 'text',
      placeholder: 'example.com,www.example.com',
      description: 'fields.serverNamesDesc',
    },
    {
      name: 'privateKey',
      label: 'fields.privateKey',
      type: 'password',
      placeholder: 'xray x25519',
      required: true,
      description: 'fields.privateKeyDesc',
      generateKey: true,
    },
    {
      name: 'shortIds',
      label: 'fields.shortIds',
      type: 'text',
      placeholder: ',0123456789abcdef',
      defaultValue: '',
      description: 'fields.shortIdsDesc',
    },
  ],
  'XTLS-Vision': [
    {
      name: 'certificateFile',
      label: 'fields.certFilePath',
      type: 'text',
      placeholder: '/path/to/fullchain.crt',
      required: true,
      description: 'fields.certFilePathDesc',
    },
    {
      name: 'keyFile',
      label: 'fields.keyFilePath',
      type: 'text',
      placeholder: '/path/to/private.key',
      required: true,
      description: 'fields.keyFilePathDesc',
    },
    {
      name: 'minVersion',
      label: 'fields.minTlsVersion',
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
      label: 'fields.dest',
      type: 'host-port',
      placeholder: 'example.com',
      defaultPort: 443,
      required: true,
      description: 'fields.destDesc',
    },
    {
      name: 'serverNames',
      label: 'fields.serverNames',
      type: 'text',
      placeholder: 'example.com,www.example.com',
      description: 'fields.serverNamesDesc',
    },
    {
      name: 'privateKey',
      label: 'fields.privateKey',
      type: 'password',
      placeholder: 'xray x25519',
      required: true,
      description: 'fields.privateKeyDesc',
      generateKey: true,
    },
    {
      name: 'shortIds',
      label: 'fields.shortIds',
      type: 'text',
      placeholder: ',0123456789abcdef',
      defaultValue: '',
      description: 'fields.shortIdsDesc',
    },
  ],
}

// Protocol-specific fields
export const protocolFields: Record<string, Field[]> = {
  Shadowsocks2022: [
    {
      name: 'method',
      label: 'fields.encryptionMethod',
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
      label: 'fields.serverPassword',
      type: 'password',
      required: true,
      placeholder: 'fields.serverPasswordDesc',
      description: 'fields.serverPasswordDesc',
      generateKey: true,
    },
    {
      name: 'network',
      label: 'fields.networkType',
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
      label: 'fields.authMethod',
      type: 'select',
      required: true,
      options: [
        { label: 'fields.authPassword', value: 'password' },
        { label: 'fields.authNone', value: 'noauth' },
      ],
      defaultValue: 'password',
      renderAs: 'radio',
    },
    {
      name: 'udp',
      label: 'fields.enableUdp',
      type: 'checkbox',
      defaultValue: true,
      description: 'fields.enableUdpDesc',
    },
  ],
  Trojan: [],
  VLESS: [
    {
      name: 'decryption',
      label: 'fields.decryption',
      type: 'select',
      options: [
        { label: 'none', value: 'none' },
        { label: 'mlkem768x25519plus', value: 'mlkem768x25519plus' },
      ],
      defaultValue: 'none',
      description: 'fields.decryptionDesc',
      renderAs: 'radio',
    },
    {
      name: 'encryption',
      label: 'fields.encryption',
      type: 'select',
      options: [{ label: 'none', value: 'none' }],
      defaultValue: 'none',
      description: 'fields.encryptionDesc',
      renderAs: 'radio',
    },
  ],
  VMess: [],
  Hysteria2: [
    {
      name: 'obfs',
      label: 'fields.obfsType',
      type: 'select',
      options: [
        { label: 'fields.obfsNone', value: '' },
        { label: 'Salamander', value: 'salamander' },
      ],
      defaultValue: '',
      renderAs: 'radio',
      description: 'fields.obfsDesc',
    },
    {
      name: 'obfsPassword',
      label: 'fields.obfsPassword',
      type: 'password',
      placeholder: 'fields.obfsPassword',
      description: 'fields.obfsPasswordDesc',
    },
  ],
  HTTP: [
    {
      name: 'auth',
      label: 'fields.authMethod',
      type: 'select',
      required: true,
      options: [
        { label: 'fields.authNone', value: 'noauth' },
        { label: 'fields.authPassword', value: 'password' },
      ],
      defaultValue: 'noauth',
      renderAs: 'radio',
      description: 'fields.httpAuthDesc',
    },
    {
      name: 'udp',
      label: 'fields.enableUdp',
      type: 'checkbox',
      defaultValue: true,
      description: 'fields.enableUdpDesc',
    },
    {
      name: 'allowTransparent',
      label: 'fields.allowTransparent',
      type: 'checkbox',
      defaultValue: false,
      description: 'fields.allowTransparentDesc',
    },
  ],
  Tunnel: [
    {
      name: 'address',
      label: 'fields.forwardAddress',
      type: 'text',
      required: true,
      placeholder: 'example.com',
      description: 'fields.forwardAddressDesc',
    },
    {
      name: 'forwardPort',
      label: 'fields.forwardPort',
      type: 'number',
      required: true,
      placeholder: '25565',
      min: 1,
      max: 65535,
      description: 'fields.forwardPortDesc',
    },
    {
      name: 'network',
      label: 'fields.networkType',
      type: 'select',
      options: [
        { label: 'TCP', value: 'tcp' },
        { label: 'UDP', value: 'udp' },
        { label: 'TCP+UDP', value: 'tcp,udp' },
      ],
      defaultValue: 'tcp',
      renderAs: 'radio',
      description: 'fields.protocolType',
    },
    {
      name: 'followRedirect',
      label: 'fields.followRedirect',
      type: 'checkbox',
      defaultValue: false,
      description: 'fields.followRedirectDesc',
    },
    {
      name: 'userLevel',
      label: 'fields.userLevel',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
      description: 'fields.userLevelAllDesc',
    },
  ],
  // Freedom outbound protocol config
  Freedom: [
    {
      name: 'domainStrategy',
      label: 'fields.domainStrategy',
      type: 'select',
      options: [
        { label: 'AsIs', value: 'AsIs' },
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
      description: 'fields.domainStrategyDesc',
    },
  ],
  // Blackhole outbound protocol config (no config needed)
  Blackhole: [],
}

// Client configuration fields for protocols that use client arrays
export const clientFields: Record<string, Field[]> = {
  Shadowsocks2022: [
    {
      name: 'password',
      label: 'fields.userPassword_psk',
      type: 'password',
      required: true,
      placeholder: 'fields.userPasswordDesc_psk',
      description: 'fields.userPasswordDesc_psk',
      generateKey: true,
    },
    {
      name: 'email',
      label: 'fields.email',
      type: 'text',
      placeholder: 'user@example.com',
      description: 'fields.emailDesc',
    },
    {
      name: 'level',
      label: 'fields.userLevel',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
      description: 'fields.userLevelDesc',
    },
  ],
  Socks5: [
    {
      name: 'user',
      label: 'fields.username',
      type: 'text',
      required: true,
      placeholder: 'username',
    },
    {
      name: 'pass',
      label: 'fields.password',
      type: 'password',
      required: true,
      placeholder: 'password',
    },
    {
      name: 'email',
      label: 'fields.email',
      type: 'text',
      placeholder: 'user@example.com',
      description: 'fields.emailDesc',
    },
    {
      name: 'level',
      label: 'fields.userLevel',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
      description: 'fields.userLevelDesc',
    },
  ],
  Trojan: [
    {
      name: 'password',
      label: 'fields.password',
      type: 'password',
      required: true,
      placeholder: 'password',
    },
    {
      name: 'email',
      label: 'fields.email',
      type: 'text',
      placeholder: 'user@example.com',
      description: 'fields.emailDesc',
    },
    {
      name: 'level',
      label: 'fields.userLevel',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
      description: 'fields.userLevelDesc',
    },
  ],
  VLESS: [
    {
      name: 'id',
      label: 'fields.uuid',
      type: 'text',
      required: true,
      placeholder: 'xray uuid',
      description: 'fields.uuidDesc',
    },
    {
      name: 'email',
      label: 'fields.email',
      type: 'text',
      placeholder: 'user@example.com',
      description: 'fields.emailDesc',
    },
    {
      name: 'level',
      label: 'fields.userLevel',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
    },
  ],
  VMess: [
    {
      name: 'id',
      label: 'fields.uuid',
      type: 'text',
      required: true,
      placeholder: 'xray uuid',
      description: 'fields.uuidDesc',
    },
    {
      name: 'email',
      label: 'fields.email',
      type: 'text',
      placeholder: 'user@example.com',
      description: 'fields.emailDesc',
    },
    {
      name: 'level',
      label: 'fields.userLevel',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
    },
  ],
  HTTP: [
    {
      name: 'user',
      label: 'fields.username',
      type: 'text',
      required: true,
      placeholder: 'username',
    },
    {
      name: 'pass',
      label: 'fields.password',
      type: 'password',
      required: true,
      placeholder: 'password',
    },
    {
      name: 'email',
      label: 'fields.email',
      type: 'text',
      placeholder: 'user@example.com',
      description: 'fields.emailDesc',
    },
    {
      name: 'level',
      label: 'fields.userLevel',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 255,
      description: 'fields.userLevelDesc',
    },
  ],
  Hysteria2: [
    {
      name: 'auth',
      label: 'fields.authPasswordField',
      type: 'password',
      required: true,
      placeholder: 'password',
      description: 'fields.authPasswordFieldDesc',
    },
    {
      name: 'email',
      label: 'fields.email',
      type: 'text',
      placeholder: 'user@example.com',
      description: 'fields.emailDesc',
    },
    {
      name: 'level',
      label: 'fields.userLevel',
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
    label: 'fields.flow',
    type: 'select',
    options: [
      { label: 'xtls-rprx-vision', value: 'xtls-rprx-vision' },
    ],
    defaultValue: 'xtls-rprx-vision',
    description: 'fields.flowDesc',
  }
}
