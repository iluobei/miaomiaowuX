// @ts-nocheck
// Helper functions to generate Xray inbound configuration JSON

export function generateInboundConfig(formData: any, protocol: string, transport: string, security: string) {
  // Map protocol name to Xray protocol identifier
  const protocolMap: Record<string, string> = {
    'Dokodemo': 'tunnel',
    'Shadowsocks2022': 'shadowsocks',
    'Socks5': 'socks',
    'Hysteria2': 'hysteria',
  }

  const config: any = {
    port: formData.port,
    protocol: protocolMap[protocol] || protocol.toLowerCase(),
  }

  // Add listen if not default
  if (formData.listen && formData.listen !== '0.0.0.0') {
    config.listen = formData.listen
  }

  // Add tag if provided
  if (formData.tag) {
    config.tag = formData.tag
  }

  // Add sniffing if enabled
  if (formData.sniffing) {
    config.sniffing = {
      enabled: true,
      destOverride: ['http', 'tls'],
    }
    // Add quic for REALITY
    if (security && security.includes('REALITY')) {
      config.sniffing.destOverride.push('quic')
    }
  }

  // Generate settings based on protocol
  config.settings = generateSettings(formData, protocol, security)

  // Generate streamSettings
  if (protocol === 'Hysteria2') {
    config.streamSettings = {
      network: 'hysteria',
      security: 'tls',
      tlsSettings: {
        certificates: [{
          certificateFile: formData.certificateFile,
          keyFile: formData.keyFile,
        }],
        alpn: ['h3'],
      },
    }
    if (formData.obfs === 'salamander' && formData.obfsPassword) {
      config.streamSettings.hysteriaSettings = {
        password: formData.obfsPassword,
      }
    }
  } else if (protocol !== 'HTTP' && protocol !== 'Dokodemo' && transport !== 'None') {
    config.streamSettings = generateStreamSettings(formData, transport, security)
  }

  return config
}

function generateSettings(formData: any, protocol: string, security: string) {
  const settings: any = {}

  switch (protocol) {
    case 'Shadowsocks2022':
      settings.method = formData.method || '2022-blake3-aes-128-gcm'
      // Password is already Base64-encoded from the key generator
      settings.password = formData.serverPassword
      settings.network = formData.network || 'tcp,udp'
      // Client passwords are also already Base64-encoded
      settings.clients = formData.clients || []
      break

    case 'Socks5':
      settings.auth = formData.auth || 'password'
      if (settings.auth === 'password') {
        settings.accounts = (formData.accounts || []).map((acc: any) => ({
          user: acc.user,
          pass: acc.pass,
        }))
      }
      settings.udp = formData.udp ?? true
      if (formData.ip) {
        settings.ip = formData.ip
      }
      break

    case 'Trojan':
      settings.clients = (formData.clients || []).map((client: any) => {
        const c: any = {
          password: client.password,
        }
        if (client.email) c.email = client.email
        // Add flow for XTLS
        if (security && (security.includes('XTLS') || security.includes('Vision'))) {
          c.flow = client.flow || 'xtls-rprx-vision'
        }
        return c
      })
      if (formData.fallbacks && formData.fallbacks.length > 0) {
        settings.fallbacks = formData.fallbacks
      }
      break

    case 'VLESS':
      settings.decryption = formData.decryption || 'none'
      // Add encryption field at settings level for mlkem768x25519plus
      if (formData.encryption) {
        settings.encryption = formData.encryption
      }
      settings.clients = (formData.clients || []).map((client: any) => {
        const c: any = {
          id: client.id,
          level: client.level ?? 0,
        }
        if (client.email) c.email = client.email
        // Add flow for XTLS
        if (security && (security.includes('XTLS') || security.includes('Vision'))) {
          c.flow = client.flow || 'xtls-rprx-vision'
        }
        return c
      })
      if (formData.fallbacks && formData.fallbacks.length > 0) {
        settings.fallbacks = formData.fallbacks
      }
      break

    case 'VMess':
      settings.clients = (formData.clients || []).map((client: any) => {
        const c: any = {
          id: client.id,
        }
        if (client.email) c.email = client.email
        if (client.level !== undefined) c.level = client.level
        return c
      })
      break

    case 'Hysteria2':
      settings.version = 2
      settings.clients = (formData.clients || []).map((client: any) => {
        const c: any = { auth: client.auth }
        if (client.email) c.email = client.email
        if (client.level !== undefined) c.level = client.level
        return c
      })
      break

    case 'HTTP':
      settings.auth = formData.auth || 'noauth'
      if (formData.auth === 'password' && formData.accounts && formData.accounts.length > 0) {
        settings.accounts = formData.accounts
      }
      if (formData.udp !== undefined) {
        settings.udp = formData.udp
      }
      if (formData.allowTransparent !== undefined) {
        settings.allowTransparent = formData.allowTransparent
      }
      break

    case 'Dokodemo':
      settings.address = formData.address
      settings.port = formData.forwardPort
      settings.network = formData.network || 'tcp'
      if (formData.followRedirect !== undefined) {
        settings.followRedirect = formData.followRedirect
      }
      if (formData.userLevel !== undefined) {
        settings.userLevel = formData.userLevel
      }
      break

    default:
      break
  }

  return settings
}

function generateStreamSettings(formData: any, transport: string, security: string) {
  const streamSettings: any = {
    network: getNetworkType(transport),
  }

  // Add transport-specific settings
  switch (transport) {
    case 'HTTP':
    case 'HTTP2':
      streamSettings.httpSettings = {
        path: formData.path || '/',
      }
      if (formData.host) {
        streamSettings.httpSettings.host = formData.host.split(',').map((h: string) => h.trim())
      }
      break

    case 'Websocket':
    case 'WSS':
      streamSettings.wsSettings = {
        path: formData.path || '/ws',
      }
      break

    case 'GRPC':
      streamSettings.grpcSettings = {
        serviceName: formData.serviceName || '',
      }
      break

    case 'XHTTP':
      streamSettings.xhttpSettings = {
        path: formData.path || '/xhttp',
        mode: formData.mode || 'auto',
      }
      if (formData.host) {
        streamSettings.xhttpSettings.host = formData.host
      }
      break
  }

  // Add security settings
  if (security && security !== 'None') {
    streamSettings.security = getSecurityType(security)

    if (security === 'TLS' || security.includes('XTLS-Vision') && !security.includes('REALITY')) {
      streamSettings.tlsSettings = {
        certificates: [
          {
            certificateFile: formData.certificateFile,
            keyFile: formData.keyFile,
          },
        ],
      }

      if (formData.serverName) {
        streamSettings.tlsSettings.serverName = formData.serverName
      }

      if (formData.alpn) {
        streamSettings.tlsSettings.alpn = formData.alpn.split(',').map((a: string) => a.trim())
      }

      if (formData.minVersion) {
        streamSettings.tlsSettings.minVersion = formData.minVersion
      }

      if (formData.rejectUnknownSni) {
        streamSettings.tlsSettings.rejectUnknownSni = true
      }
    } else if (security.includes('REALITY')) {
      streamSettings.realitySettings = {
        dest: formData.dest,
        serverNames: formData.serverNames
          ? formData.serverNames.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [],
        privateKey: formData.privateKey,
        shortIds: formData.shortIds
          ? formData.shortIds.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [''],
      }

      // Add publicKey if available
      if (formData.publicKey) {
        streamSettings.realitySettings.publicKey = formData.publicKey
      }

      if (formData.show) {
        streamSettings.realitySettings.show = true
      }

      if (formData.xver && formData.xver > 0) {
        streamSettings.realitySettings.xver = formData.xver
      }
    }
  }

  return streamSettings
}

function getNetworkType(transport: string): string {
  const mapping: Record<string, string> = {
    TCP: 'tcp',
    HTTP: 'http',
    HTTP2: 'http',
    Websocket: 'ws',
    WSS: 'ws',
    GRPC: 'grpc',
    XHTTP: 'xhttp',
  }
  return mapping[transport] || 'tcp'
}

function getSecurityType(security: string): string {
  if (security.includes('REALITY')) {
    return 'reality'
  }
  if (security.includes('TLS')) {
    return 'tls'
  }
  return 'none'
}

// Generate outbound configuration
export function generateOutboundConfig(formData: any, protocol: string, transport: string, security: string) {
  // Map protocol name to Xray protocol identifier
  const protocolMap: Record<string, string> = {
    'Shadowsocks2022': 'shadowsocks',
    'Socks5': 'socks',
    'Freedom': 'freedom',
    'Blackhole': 'blackhole',
  }

  const config: any = {
    protocol: protocolMap[protocol] || protocol.toLowerCase(),
  }

  // Add tag if provided
  if (formData.tag) {
    config.tag = formData.tag
  } else {
    // Default tags for special protocols
    if (protocol === 'Freedom') {
      config.tag = 'direct'
    } else if (protocol === 'Blackhole') {
      config.tag = 'block'
    } else {
      config.tag = 'proxy'
    }
  }

  // Generate settings based on protocol (vnext or servers structure)
  config.settings = generateOutboundSettings(formData, protocol, security)

  // Generate streamSettings if transport is not None and not simple outbound
  if (transport !== 'None' && protocol !== 'Freedom' && protocol !== 'Blackhole') {
    config.streamSettings = generateStreamSettings(formData, transport, security)
  }

  return config
}

function generateOutboundSettings(formData: any, protocol: string, security: string) {
  const settings: any = {}

  // Freedom outbound
  if (protocol === 'Freedom') {
    if (formData.domainStrategy && formData.domainStrategy !== 'AsIs') {
      settings.domainStrategy = formData.domainStrategy
    }
    return settings
  }

  // Blackhole outbound
  if (protocol === 'Blackhole') {
    // Blackhole has optional response type, but typically empty settings
    return settings
  }

  // Protocols that use vnext structure (VLESS, VMess, Trojan)
  if (protocol === 'VLESS' || protocol === 'VMess' || protocol === 'Trojan') {
    const vnext: any = {
      address: formData.address,
      port: formData.port,
      users: []
    }

    // Generate users array based on protocol
    if (protocol === 'VLESS') {
      vnext.users = (formData.users || []).map((user: any) => {
        const u: any = {
          id: user.id,
          encryption: user.encryption || 'none',
        }
        if (user.level !== undefined) u.level = user.level
        // Add flow for XTLS/Vision
        if (security && (security.includes('XTLS') || security.includes('Vision'))) {
          u.flow = user.flow || 'xtls-rprx-vision'
        }
        return u
      })
    } else if (protocol === 'VMess') {
      vnext.users = (formData.users || []).map((user: any) => {
        const u: any = {
          id: user.id,
        }
        if (user.level !== undefined) u.level = user.level
        if (user.alterId !== undefined) u.alterId = user.alterId
        if (user.security) u.security = user.security
        return u
      })
    } else if (protocol === 'Trojan') {
      vnext.users = (formData.users || []).map((user: any) => {
        const u: any = {
          password: user.password,
        }
        if (user.level !== undefined) u.level = user.level
        // Add flow for XTLS
        if (security && (security.includes('XTLS') || security.includes('Vision'))) {
          u.flow = user.flow || 'xtls-rprx-vision'
        }
        return u
      })
    }

    settings.vnext = [vnext]
  }
  // Protocols that use servers structure (Shadowsocks, Socks)
  else if (protocol === 'Shadowsocks2022') {
    const server: any = {
      address: formData.address,
      port: formData.port,
      method: formData.method || '2022-blake3-aes-128-gcm',
      password: formData.password,
    }
    if (formData.level !== undefined) server.level = formData.level
    settings.servers = [server]
  } else if (protocol === 'Socks5') {
    const server: any = {
      address: formData.address,
      port: formData.port,
    }
    if (formData.users && formData.users.length > 0) {
      server.users = formData.users.map((user: any) => ({
        user: user.user,
        pass: user.pass,
        level: user.level ?? 0,
      }))
    }
    settings.servers = [server]
  }

  return settings
}

// Convert Clash proxy config to Xray outbound config
export function clashConfigToOutbound(clashConfig: any, tag: string): any {
  const protocolMap: Record<string, string> = {
    vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan',
    ss: 'Shadowsocks2022', socks5: 'Socks5', http: 'HTTP',
  }
  const transportMap: Record<string, string> = {
    ws: 'WebSocket', grpc: 'gRPC', h2: 'HTTP/2', tcp: 'TCP',
    quic: 'QUIC', httpupgrade: 'HTTPUpgrade', splithttp: 'SplitHTTP',
  }

  const clashType = clashConfig.type?.toLowerCase() || ''
  const protocol = protocolMap[clashType] || 'VLESS'
  const network = clashConfig.network?.toLowerCase() || 'tcp'
  const transport = transportMap[network] || 'TCP'

  let security = 'None'
  if (clashConfig.tls === true || clashConfig.tls === 'true') security = 'TLS'
  else if (clashConfig.reality === true || clashConfig['reality-opts']) security = 'Reality'

  const formData: any = {
    address: clashConfig.server || '',
    port: clashConfig.port || 443,
    tag,
    decryption: 'none',
    encryption: 'none',
    domainStrategy: 'AsIs',
    users: [],
  }

  const user: any = {}
  if (protocol === 'VLESS') {
    user.id = clashConfig.uuid || ''
    if (clashConfig.flow) user.flow = clashConfig.flow
    formData.users = [user]
  } else if (protocol === 'VMess') {
    user.id = clashConfig.uuid || ''
    user.alterId = clashConfig.alterId || 0
    user.security = clashConfig.cipher || 'auto'
    formData.users = [user]
  } else if (protocol === 'Trojan') {
    user.password = clashConfig.password || ''
    formData.users = [user]
  } else if (protocol === 'Shadowsocks2022') {
    formData.method = clashConfig.cipher || '2022-blake3-aes-128-gcm'
    formData.password = clashConfig.password || ''
  } else if (protocol === 'Socks5' || protocol === 'HTTP') {
    if (clashConfig.username || clashConfig.password) {
      formData.accounts = [{ user: clashConfig.username || '', pass: clashConfig.password || '' }]
    }
  }

  if (transport === 'WebSocket') {
    const wsOpts = clashConfig['ws-opts'] || {}
    formData.path = wsOpts.path || '/'
    if (wsOpts.headers?.Host) formData.host = wsOpts.headers.Host
  } else if (transport === 'gRPC') {
    formData.serviceName = (clashConfig['grpc-opts'] || {})['grpc-service-name'] || ''
  } else if (transport === 'HTTP/2') {
    const h2Opts = clashConfig['h2-opts'] || {}
    formData.path = h2Opts.path || '/'
    if (h2Opts.host?.length > 0) formData.host = h2Opts.host[0]
  } else if (transport === 'HTTPUpgrade') {
    formData.path = clashConfig.path || '/'
    formData.host = clashConfig.host || ''
  }

  if (security === 'TLS') {
    formData.serverNames = clashConfig.sni || clashConfig.servername || clashConfig.server || ''
    formData.alpn = clashConfig.alpn?.join(',') || ''
    if (clashConfig['skip-cert-verify']) formData.allowInsecure = true
    if (clashConfig.fingerprint) formData.fingerprint = clashConfig.fingerprint
  } else if (security === 'Reality') {
    const realityOpts = clashConfig['reality-opts'] || {}
    formData.serverNames = realityOpts['server-name'] || clashConfig.sni || ''
    formData.publicKey = realityOpts['public-key'] || ''
    formData.shortId = realityOpts['short-id'] || ''
    if (clashConfig.fingerprint) formData.fingerprint = clashConfig.fingerprint
  }

  return generateOutboundConfig(formData, protocol, transport, security)
}
