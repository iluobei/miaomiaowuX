package proxygroups

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// 代理组配置管理
type Store struct {
	mu           sync.RWMutex
	data         []byte    // JSON 原始数据
	lastSource   string    // 上次同步的数据源 URL
	lastSyncedAt time.Time // 上次同步时间
}

// 创建一个新的存储实例
func NewStore(initial []byte, source string) (*Store, error) {
	// 空配置时使用空数组作为默认值
	if len(initial) == 0 {
		initial = []byte("[]")
	}

	// 规范化并验证 JSON
	normalized, err := NormalizeConfig(initial)
	if err != nil {
		return nil, fmt.Errorf("invalid initial config: %w", err)
	}

	// 创建配置的副本,避免外部修改影响内部状态
	dataCopy := make([]byte, len(normalized))
	copy(dataCopy, normalized)

	return &Store{
		data:         dataCopy,
		lastSource:   source,
		lastSyncedAt: time.Now(),
	}, nil
}

// 获取当前配置
func (s *Store) Snapshot() ([]byte, string, time.Time) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// 返回数据的副本,避免外部修改
	dataCopy := make([]byte, len(s.data))
	copy(dataCopy, s.data)

	return dataCopy, s.lastSource, s.lastSyncedAt
}

// 更新内存中的配置, 只有在新数据通过 JSON 验证后才会替换现有数据
func (s *Store) Update(data []byte, source string, syncedAt time.Time) error {
	// 先规范化并验证,验证失败时不修改内部状态
	normalized, err := NormalizeConfig(data)
	if err != nil {
		return fmt.Errorf("invalid config data: %w", err)
	}

	if syncedAt.IsZero() {
		syncedAt = time.Now()
	}

	// 创建数据副本
	dataCopy := make([]byte, len(normalized))
	copy(dataCopy, normalized)

	// 持锁替换内部状态
	s.mu.Lock()
	s.data = dataCopy
	s.lastSource = source
	s.lastSyncedAt = syncedAt
	s.mu.Unlock()

	return nil
}

// json Unmarshal 将当前配置解析到目标变量
func (s *Store) Unmarshal(v any) error {
	if v == nil {
		return nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	return json.Unmarshal(s.data, v)
}
