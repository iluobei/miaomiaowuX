package handler

import (
	"context"
	"log"
	"time"

	"miaomiaowux/internal/storage"
)

type TrafficLimitEnforcer struct {
	repo         *storage.TrafficRepository
	remoteManage *RemoteManageHandler
}

func NewTrafficLimitEnforcer(repo *storage.TrafficRepository, remoteManage *RemoteManageHandler) *TrafficLimitEnforcer {
	return &TrafficLimitEnforcer{repo: repo, remoteManage: remoteManage}
}

func (e *TrafficLimitEnforcer) Start(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	log.Printf("[TrafficLimitEnforcer] Starting with interval: %v", interval)
	e.CheckAll(ctx)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.CheckAll(ctx)
		}
	}
}

func (e *TrafficLimitEnforcer) CheckAll(ctx context.Context) {
	users, err := e.repo.ListUsersWithPackage(ctx)
	if err != nil {
		log.Printf("[TrafficLimitEnforcer] Failed to list users: %v", err)
		return
	}

	pkgCache := make(map[int64]*storage.Package)
	now := time.Now()

	for _, user := range users {
		// 套餐到期检查：到期后移除入站并清除套餐绑定
		if user.PackageEndDate != nil && now.After(*user.PackageEndDate) {
			log.Printf("[TrafficLimitEnforcer] User %s package expired at %s, removing from inbounds and clearing package",
				user.Username, user.PackageEndDate.Format("2006-01-02"))
			e.removeUserFromAllInbounds(ctx, user.Username)
			if err := e.repo.DeleteUserInboundConfigs(ctx, user.Username); err != nil {
				log.Printf("[TrafficLimitEnforcer] Failed to delete inbound configs for %s: %v", user.Username, err)
			}
			if err := e.repo.RemovePackageFromUser(ctx, user.Username); err != nil {
				log.Printf("[TrafficLimitEnforcer] Failed to remove package from %s: %v", user.Username, err)
			}
			continue
		}

		pkg, ok := pkgCache[user.PackageID]
		if !ok {
			p, err := e.repo.GetPackage(ctx, user.PackageID)
			if err != nil {
				log.Printf("[TrafficLimitEnforcer] Failed to get package %d: %v", user.PackageID, err)
				continue
			}
			pkg = p
			pkgCache[user.PackageID] = pkg
		}

		if pkg.TrafficLimitBytes <= 0 {
			continue
		}

		totalTraffic, err := e.repo.GetUserTotalTraffic(ctx, user.Username)
		if err != nil {
			log.Printf("[TrafficLimitEnforcer] Failed to get traffic for %s: %v", user.Username, err)
			continue
		}

		wasOverLimit, _ := e.repo.IsUserOverLimit(ctx, user.Username)
		isOverLimit := totalTraffic >= pkg.TrafficLimitBytes

		if isOverLimit && !wasOverLimit {
			log.Printf("[TrafficLimitEnforcer] User %s exceeded limit (%d/%d bytes), removing from inbounds",
				user.Username, totalTraffic, pkg.TrafficLimitBytes)
			e.removeUserFromAllInbounds(ctx, user.Username)
			e.repo.UpdateUserOverLimit(ctx, user.Username, true)
		} else if !isOverLimit && wasOverLimit {
			log.Printf("[TrafficLimitEnforcer] User %s back under limit (%d/%d bytes), restoring inbounds",
				user.Username, totalTraffic, pkg.TrafficLimitBytes)
			e.restoreUserToInbounds(ctx, user)
			e.repo.UpdateUserOverLimit(ctx, user.Username, false)
		}
	}
}

func (e *TrafficLimitEnforcer) removeUserFromAllInbounds(ctx context.Context, username string) {
	configs, err := e.repo.GetUserInboundConfigs(ctx, username)
	if err != nil {
		log.Printf("[TrafficLimitEnforcer] Failed to get inbound configs for %s: %v", username, err)
		return
	}
	for _, cfg := range configs {
		if err := removeUserFromInbound(ctx, e.remoteManage, cfg); err != nil {
			log.Printf("[TrafficLimitEnforcer] Failed to remove %s from %s on server %d: %v",
				username, cfg.InboundTag, cfg.ServerID, err)
		}
	}
}

func (e *TrafficLimitEnforcer) restoreUserToInbounds(ctx context.Context, user storage.User) {
	configs, err := e.repo.GetUserInboundConfigs(ctx, user.Username)
	if err != nil {
		log.Printf("[TrafficLimitEnforcer] Failed to get inbound configs for %s: %v", user.Username, err)
		return
	}
	for _, cfg := range configs {
		if err := addUserToInbound(ctx, e.remoteManage, e.repo, user, cfg.ServerID, cfg.InboundTag); err != nil {
			log.Printf("[TrafficLimitEnforcer] Failed to restore %s to %s on server %d: %v",
				user.Username, cfg.InboundTag, cfg.ServerID, err)
		}
	}
}
