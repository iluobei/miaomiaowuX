package acme

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/go-acme/lego/v4/challenge/http01"
)

// WebrootProvider 使用 webroot 目录实现 HTTP-01 质询。
type WebrootProvider struct {
	path string
}

// 创建一个新的 Webroot 提供程序。
func NewWebrootProvider(path string) (*WebrootProvider, error) {
	if path == "" {
		return nil, fmt.Errorf("webroot path is required")
	}

	// 确保 webroot 目录存在
	challengeDir := filepath.Join(path, http01.ChallengePath(""))
	if err := os.MkdirAll(challengeDir, 0755); err != nil {
		return nil, fmt.Errorf("create challenge directory: %w", err)
	}

	return &WebrootProvider{path: path}, nil
}

// 将质询令牌写入 webroot 目录。
func (w *WebrootProvider) Present(domain, token, keyAuth string) error {
	challengePath := filepath.Join(w.path, http01.ChallengePath(token))

	// 确保父目录存在
	if err := os.MkdirAll(filepath.Dir(challengePath), 0755); err != nil {
		return fmt.Errorf("create challenge directory: %w", err)
	}

	// 将密钥授权写入质询文件
	if err := os.WriteFile(challengePath, []byte(keyAuth), 0644); err != nil {
		return fmt.Errorf("write challenge file: %w", err)
	}

	return nil
}

// 删除质询令牌文件。
func (w *WebrootProvider) CleanUp(domain, token, keyAuth string) error {
	challengePath := filepath.Join(w.path, http01.ChallengePath(token))
	if err := os.Remove(challengePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove challenge file: %w", err)
	}
	return nil
}
