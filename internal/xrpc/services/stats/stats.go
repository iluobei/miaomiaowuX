package stats

import (
	"context"
	"time"

	statspb "github.com/xtls/xray-core/app/stats/command"
)

func QueryTraffic(ctx context.Context, client statspb.StatsServiceClient, pattern string, reset bool) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	resp, err := client.QueryStats(ctx, &statspb.QueryStatsRequest{
		Pattern: pattern,
		Reset_:  reset,
	})
	if err != nil {
		return -1, err
	}
	if len(resp.GetStat()) == 0 {
		return -1, nil
	}
	return resp.GetStat()[0].GetValue(), nil
}

func GetSystemStats(ctx context.Context, client statspb.StatsServiceClient) (*statspb.SysStatsResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return client.GetSysStats(ctx, &statspb.SysStatsRequest{})
}
