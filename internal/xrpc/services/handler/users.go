package handler

import (
	"context"

	"github.com/xtls/xray-core/app/proxyman/command"
	"github.com/xtls/xray-core/common/protocol"
	"github.com/xtls/xray-core/common/serial"
	"github.com/xtls/xray-core/proxy/shadowsocks"
	ss2022 "github.com/xtls/xray-core/proxy/shadowsocks_2022"
	"github.com/xtls/xray-core/proxy/trojan"
	"github.com/xtls/xray-core/proxy/vless"
	"github.com/xtls/xray-core/proxy/vmess"
)

// 演示了 VMess 的 AlterInbound(AddUserOperation)。
func AddVMessUser(ctx context.Context, client command.HandlerServiceClient, inboundTag, email string) error {
	req := &command.AlterInboundRequest{
		Tag: inboundTag,
		Operation: serial.ToTypedMessage(&command.AddUserOperation{
			User: &protocol.User{
				Level: 0,
				Email: email,
				Account: serial.ToTypedMessage(&vmess.Account{
					Id: randomUUID(),
					SecuritySettings: &protocol.SecurityConfig{
						Type: protocol.SecurityType_AUTO,
					},
				}),
			},
		}),
	}
	_, err := client.AlterInbound(ctx, req)
	return err
}

// 显示如何动态添加 VLESS 用户。
func AddVLESSUser(ctx context.Context, client command.HandlerServiceClient, inboundTag, email string) error {
	req := &command.AlterInboundRequest{
		Tag: inboundTag,
		Operation: serial.ToTypedMessage(&command.AddUserOperation{
			User: &protocol.User{
				Level: 0,
				Email: email,
				Account: serial.ToTypedMessage(&vless.Account{
					Id:         randomUUID(),
					Encryption: "none",
				}),
			},
		}),
	}
	_, err := client.AlterInbound(ctx, req)
	return err
}

// 将特洛伊木马密码添加到入站处理程序。
func AddTrojanUser(ctx context.Context, client command.HandlerServiceClient, inboundTag, email, password string) error {
	req := &command.AlterInboundRequest{
		Tag: inboundTag,
		Operation: serial.ToTypedMessage(&command.AddUserOperation{
			User: &protocol.User{
				Level: 0,
				Email: email,
				Account: serial.ToTypedMessage(&trojan.Account{
					Password: password,
				}),
			},
		}),
	}
	_, err := client.AlterInbound(ctx, req)
	return err
}

// 设置 Shadowsocks AEAD 凭据。
func AddShadowsocksUser(ctx context.Context, client command.HandlerServiceClient, inboundTag, email, password string) error {
	req := &command.AlterInboundRequest{
		Tag: inboundTag,
		Operation: serial.ToTypedMessage(&command.AddUserOperation{
			User: &protocol.User{
				Level: 0,
				Email: email,
				Account: serial.ToTypedMessage(&shadowsocks.Account{
					Password:   password,
					CipherType: shadowsocks.CipherType_CHACHA20_POLY1305,
				}),
			},
		}),
	}
	_, err := client.AlterInbound(ctx, req)
	return err
}

// 涵盖 SS2022 的密钥轮换。
func AddShadowsocks2022User(ctx context.Context, client command.HandlerServiceClient, inboundTag, email string) error {
	req := &command.AlterInboundRequest{
		Tag: inboundTag,
		Operation: serial.ToTypedMessage(&command.AddUserOperation{
			User: &protocol.User{
				Email: email,
				Account: serial.ToTypedMessage(&ss2022.Account{
					Key: randomUUID(),
				}),
			},
		}),
	}
	_, err := client.AlterInbound(ctx, req)
	return err
}

// 从入站中删除任何用户（通过电子邮件标识）。
func RemoveUser(ctx context.Context, client command.HandlerServiceClient, inboundTag, email string) error {
	req := &command.AlterInboundRequest{
		Tag: inboundTag,
		Operation: serial.ToTypedMessage(&command.RemoveUserOperation{
			Email: email,
		}),
	}
	_, err := client.AlterInbound(ctx, req)
	return err
}
