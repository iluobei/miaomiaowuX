package handler

import (
	"context"

	"github.com/xtls/xray-core/app/proxyman/command"
	cnet "github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/common/protocol"
	"github.com/xtls/xray-core/common/serial"
	"github.com/xtls/xray-core/proxy/blackhole"
	"github.com/xtls/xray-core/proxy/dns"
	"github.com/xtls/xray-core/proxy/freedom"
	"github.com/xtls/xray-core/proxy/http"
	"github.com/xtls/xray-core/proxy/shadowsocks"
	ss2022 "github.com/xtls/xray-core/proxy/shadowsocks_2022"
	"github.com/xtls/xray-core/proxy/socks"
	"github.com/xtls/xray-core/proxy/trojan"
	"github.com/xtls/xray-core/proxy/vless"
	vlessout "github.com/xtls/xray-core/proxy/vless/outbound"
	"github.com/xtls/xray-core/proxy/vmess"
	vmessout "github.com/xtls/xray-core/proxy/vmess/outbound"
	"github.com/xtls/xray-core/proxy/wireguard"
	"github.com/xtls/xray-core/transport/internet"
)

func AddFreedomOutbound(ctx context.Context, client command.HandlerServiceClient, tag string) error {
	cfg := outboundConfig(
		tag,
		senderSettings(),
		serial.ToTypedMessage(&freedom.Config{
			DomainStrategy: internet.DomainStrategy_AS_IS,
			UserLevel:      0,
			Fragment: &freedom.Fragment{
				PacketsFrom: 5,
				PacketsTo:   10,
				LengthMin:   50,
				LengthMax:   150,
				IntervalMin: 10,
				IntervalMax: 20,
			},
		}),
	)
	_, err := client.AddOutbound(ctx, &command.AddOutboundRequest{Outbound: cfg})
	return err
}

func AddBlackholeOutbound(ctx context.Context, client command.HandlerServiceClient, tag string) error {
	cfg := outboundConfig(
		tag,
		senderSettings(),
		serial.ToTypedMessage(&blackhole.Config{
			Response: serial.ToTypedMessage(&blackhole.HTTPResponse{}),
		}),
	)
	_, err := client.AddOutbound(ctx, &command.AddOutboundRequest{Outbound: cfg})
	return err
}

func AddDNSOutbound(ctx context.Context, client command.HandlerServiceClient, tag string, upstream string) error {
	endpointCfg := &cnet.Endpoint{
		Network: cnet.Network_UDP,
		Address: cnet.NewIPOrDomain(cnet.ParseAddress(upstream)),
		Port:    53,
	}
	cfg := outboundConfig(
		tag,
		senderSettings(),
		serial.ToTypedMessage(&dns.Config{
			Server:     endpointCfg,
			UserLevel:  0,
			BlockTypes: []int32{1, 28},
		}),
	)
	_, err := client.AddOutbound(ctx, &command.AddOutboundRequest{Outbound: cfg})
	return err
}

func AddHTTPOutbound(ctx context.Context, client command.HandlerServiceClient, tag string) error {
	cfg := outboundConfig(
		tag,
		senderSettings(),
		serial.ToTypedMessage(&http.ClientConfig{
			Server: endpoint("example.com", 80, nil),
			Header: []*http.Header{
				{Key: "User-Agent", Value: "miaomiaowu"},
			},
		}),
	)
	_, err := client.AddOutbound(ctx, &command.AddOutboundRequest{Outbound: cfg})
	return err
}

func AddSocksOutbound(ctx context.Context, client command.HandlerServiceClient, tag string) error {
	cfg := outboundConfig(
		tag,
		senderSettings(),
		serial.ToTypedMessage(&socks.ClientConfig{
			Server: endpoint("127.0.0.1", 1080, nil),
		}),
	)
	_, err := client.AddOutbound(ctx, &command.AddOutboundRequest{Outbound: cfg})
	return err
}

func AddTrojanOutbound(ctx context.Context, client command.HandlerServiceClient, tag string, password string) error {
	user := &protocol.User{
		Email: "trojan@client.local",
		Level: 0,
		Account: serial.ToTypedMessage(&trojan.Account{
			Password: password,
		}),
	}
	cfg := outboundConfig(
		tag,
		senderSettings(),
		serial.ToTypedMessage(&trojan.ClientConfig{
			Server: endpoint("trojan.example.com", 443, user),
		}),
	)
	_, err := client.AddOutbound(ctx, &command.AddOutboundRequest{Outbound: cfg})
	return err
}

func AddShadowsocksOutbound(ctx context.Context, client command.HandlerServiceClient, tag string) error {
	user := &protocol.User{
		Email: "ss@client.local",
		Account: serial.ToTypedMessage(&shadowsocks.Account{
			Password:   "client-pass",
			CipherType: shadowsocks.CipherType_AES_256_GCM,
		}),
	}
	cfg := outboundConfig(
		tag,
		senderSettings(),
		serial.ToTypedMessage(&shadowsocks.ClientConfig{
			Server: endpoint("ss.example.com", 8388, user),
		}),
	)
	_, err := client.AddOutbound(ctx, &command.AddOutboundRequest{Outbound: cfg})
	return err
}

func AddShadowsocks2022Outbound(ctx context.Context, client command.HandlerServiceClient, tag string) error {
	cfg := outboundConfig(
		tag,
		senderSettings(),
		serial.ToTypedMessage(&ss2022.ClientConfig{
			Address:           cnetOrDomain("203.0.113.2"),
			Port:              8389,
			Method:            "2022-blake3-aes-256-gcm",
			Key:               "clientkeybase64==",
			UdpOverTcp:        true,
			UdpOverTcpVersion: 2,
		}),
	)
	_, err := client.AddOutbound(ctx, &command.AddOutboundRequest{Outbound: cfg})
	return err
}

func AddVLESSOutbound(ctx context.Context, client command.HandlerServiceClient, tag string) error {
	user := &protocol.User{
		Email: "vless@client.local",
		Account: serial.ToTypedMessage(&vless.Account{
			Id:         randomUUID(),
			Encryption: "none",
		}),
	}
	cfg := outboundConfig(
		tag,
		senderSettings(),
		serial.ToTypedMessage(&vlessout.Config{
			Vnext: endpoint("vless.example.com", 443, user),
		}),
	)
	_, err := client.AddOutbound(ctx, &command.AddOutboundRequest{Outbound: cfg})
	return err
}

func AddVMessOutbound(ctx context.Context, client command.HandlerServiceClient, tag string) error {
	user := &protocol.User{
		Email: "vmess@client.local",
		Account: serial.ToTypedMessage(&vmess.Account{
			Id: randomUUID(),
			SecuritySettings: &protocol.SecurityConfig{
				Type: protocol.SecurityType_AUTO,
			},
		}),
	}
	cfg := outboundConfig(
		tag,
		senderSettings(),
		serial.ToTypedMessage(&vmessout.Config{
			Receiver: endpoint("vmess.example.com", 443, user),
		}),
	)
	_, err := client.AddOutbound(ctx, &command.AddOutboundRequest{Outbound: cfg})
	return err
}

func AddWireGuardOutbound(ctx context.Context, client command.HandlerServiceClient, tag string) error {
	cfg := outboundConfig(
		tag,
		senderSettings(),
		serial.ToTypedMessage(&wireguard.DeviceConfig{
			SecretKey:      "clientSecretKeyBase64==",
			Endpoint:       []string{"198.51.100.2:51820"},
			IsClient:       true,
			Mtu:            1420,
			DomainStrategy: wireguard.DeviceConfig_FORCE_IP4,
			Peers: []*wireguard.PeerConfig{
				{
					PublicKey:  "serverPublicKeyBase64==",
					AllowedIps: []string{"0.0.0.0/0"},
					KeepAlive:  30,
				},
			},
		}),
	)
	_, err := client.AddOutbound(ctx, &command.AddOutboundRequest{Outbound: cfg})
	return err
}
