package handler

import (
	"github.com/xtls/xray-core/app/proxyman"
	cnet "github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/common/protocol"
	"github.com/xtls/xray-core/common/serial"
	"github.com/xtls/xray-core/common/uuid"
	"github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/transport/internet"
)

func receiverSettings(port uint32, enableSniff bool) *serial.TypedMessage {
	pr := cnet.SinglePortRange(cnet.Port(port))
	rc := &proxyman.ReceiverConfig{
		PortList: &cnet.PortList{Range: []*cnet.PortRange{pr}},
		Listen:   cnet.NewIPOrDomain(cnet.AnyIP),
		StreamSettings: &internet.StreamConfig{
			ProtocolName: "tcp",
		},
	}
	if enableSniff {
		rc.SniffingSettings = &proxyman.SniffingConfig{
			Enabled:             true,
			DestinationOverride: []string{"http", "tls"},
		}
	}
	return serial.ToTypedMessage(rc)
}

func senderSettings() *serial.TypedMessage {
	return serial.ToTypedMessage(&proxyman.SenderConfig{
		StreamSettings: &internet.StreamConfig{
			ProtocolName: "tcp",
		},
		MultiplexSettings: &proxyman.MultiplexingConfig{
			Enabled:         true,
			Concurrency:     8,
			XudpProxyUDP443: "reject",
		},
		TargetStrategy: internet.DomainStrategy_USE_IP,
	})
}

func endpoint(address string, port uint32, user *protocol.User) *protocol.ServerEndpoint {
	return &protocol.ServerEndpoint{
		Address: cnet.NewIPOrDomain(cnet.ParseAddress(address)),
		Port:    port,
		User:    user,
	}
}

func randomUUID() string {
	u := uuid.New()
	return (&u).String()
}

func cnetOrDomain(value string) *cnet.IPOrDomain {
	return cnet.NewIPOrDomain(cnet.ParseAddress(value))
}

func inboundConfig(tag string, receiver *serial.TypedMessage, proxy *serial.TypedMessage) *core.InboundHandlerConfig {
	return &core.InboundHandlerConfig{
		Tag:              tag,
		ReceiverSettings: receiver,
		ProxySettings:    proxy,
	}
}

func outboundConfig(tag string, sender *serial.TypedMessage, proxy *serial.TypedMessage) *core.OutboundHandlerConfig {
	return &core.OutboundHandlerConfig{
		Tag:            tag,
		SenderSettings: sender,
		ProxySettings:  proxy,
	}
}
