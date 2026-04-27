package handler

import (
	"context"

	"github.com/xtls/xray-core/app/proxyman/command"
	"github.com/xtls/xray-core/common/protocol"
	"github.com/xtls/xray-core/common/serial"
)

func RemoveInbound(ctx context.Context, client command.HandlerServiceClient, tag string) error {
	_, err := client.RemoveInbound(ctx, &command.RemoveInboundRequest{Tag: tag})
	return err
}

func RemoveOutbound(ctx context.Context, client command.HandlerServiceClient, tag string) error {
	_, err := client.RemoveOutbound(ctx, &command.RemoveOutboundRequest{Tag: tag})
	return err
}

func ListInboundTags(ctx context.Context, client command.HandlerServiceClient) ([]string, error) {
	resp, err := client.ListInbounds(ctx, &command.ListInboundsRequest{IsOnlyTags: true})
	if err != nil {
		return nil, err
	}
	tags := make([]string, 0, len(resp.GetInbounds()))
	for _, inbound := range resp.GetInbounds() {
		tags = append(tags, inbound.GetTag())
	}
	return tags, nil
}

func GetInboundUsers(ctx context.Context, client command.HandlerServiceClient, inboundTag string) ([]*protocol.User, error) {
	resp, err := client.GetInboundUsers(ctx, &command.GetInboundUserRequest{
		Tag: inboundTag,
	})
	if err != nil {
		return nil, err
	}
	return resp.GetUsers(), nil
}

func GetInboundUsersCount(ctx context.Context, client command.HandlerServiceClient, inboundTag string) (int64, error) {
	resp, err := client.GetInboundUsersCount(ctx, &command.GetInboundUserRequest{
		Tag: inboundTag,
	})
	if err != nil {
		return 0, err
	}
	return resp.GetCount(), nil
}

func AlterOutbound(ctx context.Context, client command.HandlerServiceClient, tag string, operation *serial.TypedMessage) error {
	_, err := client.AlterOutbound(ctx, &command.AlterOutboundRequest{
		Tag:       tag,
		Operation: operation,
	})
	return err
}
