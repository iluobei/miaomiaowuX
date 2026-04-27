package logger

import (
	"context"
	"time"

	loggerpb "github.com/xtls/xray-core/app/log/command"
)

// RestartLogger触发LoggerService restartLogger RPC并等待完成。
func RestartLogger(ctx context.Context, client loggerpb.LoggerServiceClient) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_, err := client.RestartLogger(ctx, &loggerpb.RestartLoggerRequest{})
	return err
}
