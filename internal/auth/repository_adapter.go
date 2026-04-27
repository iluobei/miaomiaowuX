package auth

import (
	"context"
	"miaomiaowu/internal/storage"
)

// RepositoryAdapter 适配 storage.TrafficRepository 来实现 UserRepository 接口。
type RepositoryAdapter struct {
	repo *storage.TrafficRepository
}

// 为流量存储库创建一个新适配器。
func NewRepositoryAdapter(repo *storage.TrafficRepository) UserRepository {
	return &RepositoryAdapter{repo: repo}
}

// 从存储库中检索用户信息。
func (a *RepositoryAdapter) GetUser(ctx context.Context, username string) (User, error) {
	storageUser, err := a.repo.GetUser(ctx, username)
	if err != nil {
		return User{}, err
	}

	return User{
		Username: storageUser.Username,
		Role:     storageUser.Role,
		IsActive: storageUser.IsActive,
	}, nil
}

// 从存储仓库获取 API token
func (a *RepositoryAdapter) GetAPIToken(ctx context.Context) (string, error) {
	return a.repo.GetAPIToken(ctx)
}
