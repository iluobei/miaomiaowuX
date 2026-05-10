package handler

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"miaomiaowux/internal/notify"
	"miaomiaowux/internal/storage"
)

func StartNotifyScheduler(ctx context.Context, repo *storage.TrafficRepository) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	var lastDailyRun string

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			n := GetNotifier()
			if n == nil {
				continue
			}
			cfg := n.GetConfig()

			if cfg.NotifyDailyTraffic {
				today := now.Format("2006-01-02")
				nowTime := now.Format("15:04")
				targetTime := cfg.DailyTrafficTime
				if targetTime == "" {
					targetTime = "08:00"
				}
				if nowTime == targetTime && lastDailyRun != today {
					lastDailyRun = today
					go sendDailyTrafficNotification(ctx, repo, n)
				}
			}

			if cfg.NotifyTrafficThreshold && cfg.TrafficThresholdPercent > 0 {
				go checkTrafficThreshold(ctx, repo, n, cfg.TrafficThresholdPercent)
			}
		}
	}
}

func sendDailyTrafficNotification(ctx context.Context, repo *storage.TrafficRepository, n *notify.Notifier) {
	servers, err := repo.ListRemoteServers(ctx)
	if err != nil {
		log.Printf("[Notify] 获取服务器列表失败: %v", err)
		return
	}

	if len(servers) == 0 {
		return
	}

	var lines []string
	for _, s := range servers {
		if s.Status != "connected" {
			continue
		}
		used, _ := repo.GetServerTrafficUsed(ctx, s.ID)
		if s.TrafficLimit > 0 {
			usedGB := float64(used) / (1024 * 1024 * 1024)
			limitGB := float64(s.TrafficLimit) / (1024 * 1024 * 1024)
			pct := float64(used) / float64(s.TrafficLimit) * 100
			lines = append(lines, fmt.Sprintf("• %s: %.1fGB/%.0fGB (%.0f%%)", s.Name, usedGB, limitGB, pct))
		} else {
			usedGB := float64(used) / (1024 * 1024 * 1024)
			lines = append(lines, fmt.Sprintf("• %s: %.1fGB (不限)", s.Name, usedGB))
		}
	}

	if len(lines) == 0 {
		return
	}

	_ = n.Send(ctx, notify.Event{
		Type:    notify.EventDailyTraffic,
		Title:   "每日流量统计",
		Message: strings.Join(lines, "\n"),
	})
}

func checkTrafficThreshold(ctx context.Context, repo *storage.TrafficRepository, n *notify.Notifier, thresholdPct int) {
	servers, err := repo.ListRemoteServers(ctx)
	if err != nil {
		return
	}

	for _, s := range servers {
		if s.TrafficLimit <= 0 || s.Status != "connected" {
			continue
		}
		used, _ := repo.GetServerTrafficUsed(ctx, s.ID)
		pct := int(float64(used) / float64(s.TrafficLimit) * 100)
		if pct >= thresholdPct {
			alreadyNotified, _ := repo.IsTrafficThresholdNotified(ctx, s.ID)
			if alreadyNotified {
				continue
			}
			usedGB := float64(used) / (1024 * 1024 * 1024)
			limitGB := float64(s.TrafficLimit) / (1024 * 1024 * 1024)
			_ = n.Send(ctx, notify.Event{
				Type:  notify.EventTrafficThreshold,
				Title: "流量告警",
				Message: fmt.Sprintf("服务器 `%s` 流量已达 %d%%\n已用: %.1fGB / %.0fGB",
					s.Name, pct, usedGB, limitGB),
			})
			_ = repo.MarkTrafficThresholdNotified(ctx, s.ID)
		}
	}
}

func SendServerOnlineNotification(ctx context.Context, serverName, ip string) {
	n := GetNotifier()
	if n == nil {
		return
	}
	go n.Send(ctx, notify.Event{
		Type:    notify.EventServerOnline,
		Title:   "服务器上线",
		Message: fmt.Sprintf("服务器: `%s`\nIP: `%s`", serverName, ip),
	})
}

func SendServerOfflineNotification(ctx context.Context, serverName, ip string) {
	n := GetNotifier()
	if n == nil {
		return
	}
	go n.Send(ctx, notify.Event{
		Type:    notify.EventServerOffline,
		Title:   "服务器离线",
		Message: fmt.Sprintf("服务器: `%s`\nIP: `%s`", serverName, ip),
	})
}

func SendLoginNotification(ctx context.Context, username, ip string) {
	n := GetNotifier()
	if n == nil {
		return
	}
	go n.Send(ctx, notify.Event{
		Type:    notify.EventLogin,
		Title:   "用户登录",
		Message: fmt.Sprintf("用户: `%s`\nIP: `%s`", username, ip),
	})
}

func SendSubscribeFetchNotification(ctx context.Context, username, clientType, ip string) {
	n := GetNotifier()
	if n == nil {
		return
	}
	go n.Send(ctx, notify.Event{
		Type:    notify.EventSubscribeFetch,
		Title:   "订阅获取",
		Message: fmt.Sprintf("用户: `%s`\n客户端: `%s`\nIP: `%s`", username, clientType, ip),
	})
}
