// Xray protocol configuration structure
export const XRAY_CONFIG = {
  xray: [
    { Shadowsocks2022: ['2022'] },
    { Socks5: ['TLS'] },
    {
      Trojan: [
        { GRPC: ['REALITY'] },
        { TCP: ['REALITY', 'TLS'] },
      ],
    },
    {
      VLESS: [
        { GRPC: ['REALITY'] },
        { TCP: ['REALITY', 'TLS', 'TLS-WS', 'XTLS-Vision', 'XTLS-Vision-REALITY'] },
        'WSS',
        { XHTTP: ['REALITY'] },
      ],
    },
    {
      VMess: [
        { TCP: ['None', 'TLS'] },
        { Websocket: ['None', 'TLS'] },
      ],
    },
    { Hysteria2: ['TLS'] },
    { HTTP: ['None'] },
    { Tunnel: ['None'] },
  ],
}

// Parse transport and security options from the config structure
export function getTransportOptions(protocol: string): Array<string | { [key: string]: string[] }> {
  const protocolEntry = XRAY_CONFIG.xray.find((item: any) => {
    const key = Object.keys(item)[0]
    return key.toLowerCase() === protocol.toLowerCase()
  })

  if (!protocolEntry) return []

  const key = Object.keys(protocolEntry)[0]
  return (protocolEntry as any)[key] as Array<string | { [key: string]: string[] }>
}

export function getSecurityOptions(protocol: string, transport: string): string[] {
  const transports = getTransportOptions(protocol)

  for (const item of transports) {
    if (typeof item === 'object') {
      const transportKey = Object.keys(item)[0]
      if (transportKey.toLowerCase() === transport.toLowerCase()) {
        return item[transportKey]
      }
    }
  }

  return []
}

export function getAllProtocols(): string[] {
  return XRAY_CONFIG.xray.map((item) => Object.keys(item)[0])
}

// 出站专用协议列表（包含 Freedom 和 Blackhole）
export function getOutboundProtocols(): string[] {
  return [...getAllProtocols(), 'Freedom', 'Blackhole']
}
