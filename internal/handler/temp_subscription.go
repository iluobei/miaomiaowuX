package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"miaomiaowu/internal/util"

	"gopkg.in/yaml.v3"
)

// TempSubscription代表临时订阅
type TempSubscription struct {
	ID          string    `json:"id"`
	Proxies     []any     `json:"proxies"`
	MaxAccess   int       `json:"max_access"`
	AccessCount int       `json:"access_count"`
	ExpireAt    time.Time `json:"expire_at"`
	CreatedAt   time.Time `json:"created_at"`
}

// TempSubscriptionStore 管理内存中的临时订阅
type TempSubscriptionStore struct {
	mu            sync.RWMutex
	subscriptions map[string]*TempSubscription
}

// 临时订阅的全球商店
var tempSubStore = &TempSubscriptionStore{
	subscriptions: make(map[string]*TempSubscription),
}

// generateShortCode 生成随机 8 个字符的十六进制代码
func generateTempSubCode() string {
	bytes := make([]byte, 4)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// 创建一个新的临时订阅
func (s *TempSubscriptionStore) Create(proxies []any, maxAccess int, expireSeconds int) *TempSubscription {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 清理过期订阅
	s.cleanupLocked()

	id := generateTempSubCode()
	// 确保唯一ID
	for s.subscriptions[id] != nil {
		id = generateTempSubCode()
	}

	sub := &TempSubscription{
		ID:          id,
		Proxies:     proxies,
		MaxAccess:   maxAccess,
		AccessCount: 0,
		ExpireAt:    time.Now().Add(time.Duration(expireSeconds) * time.Second),
		CreatedAt:   time.Now(),
	}

	s.subscriptions[id] = sub
	return sub
}

// 通过 ID 检索临时订阅并增加访问计数
func (s *TempSubscriptionStore) Get(id string) (*TempSubscription, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sub, exists := s.subscriptions[id]
	if !exists {
		return nil, errors.New("subscription not found")
	}

	// 检查是否过期
	if time.Now().After(sub.ExpireAt) {
		delete(s.subscriptions, id)
		return nil, errors.New("subscription expired")
	}

	// 检查是否达到最大访问权限
	if sub.AccessCount >= sub.MaxAccess {
		delete(s.subscriptions, id)
		return nil, errors.New("subscription access limit reached")
	}

	// 增加访问计数
	sub.AccessCount++

	// 如果这是最后一次允许的访问，请将其删除
	if sub.AccessCount >= sub.MaxAccess {
		delete(s.subscriptions, id)
	}

	return sub, nil
}

// 删除过期的订阅（必须在持有锁的情况下调用）
func (s *TempSubscriptionStore) cleanupLocked() {
	now := time.Now()
	for id, sub := range s.subscriptions {
		if now.After(sub.ExpireAt) || sub.AccessCount >= sub.MaxAccess {
			delete(s.subscriptions, id)
		}
	}
}

// TempSubscriptionHandler 处理临时订阅请求
type TempSubscriptionHandler struct{}

// 为临时订阅创建新的处理程序
func NewTempSubscriptionHandler() http.Handler {
	return &TempSubscriptionHandler{}
}

func (h *TempSubscriptionHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		h.handleCreate(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
	}
}

// CreateTempSubRequest 表示创建临时订阅的请求
type CreateTempSubRequest struct {
	Proxies       []any `json:"proxies"`
	MaxAccess     int   `json:"max_access"`
	ExpireSeconds int   `json:"expire_seconds"`
}

// CreateTempSubResponse 表示创建临时订阅后的响应
type CreateTempSubResponse struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	MaxAccess int       `json:"max_access"`
	ExpireAt  time.Time `json:"expire_at"`
}

func (h *TempSubscriptionHandler) handleCreate(w http.ResponseWriter, r *http.Request) {
	var req CreateTempSubRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}

	if len(req.Proxies) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("proxies cannot be empty"))
		return
	}

	// 设置默认值
	if req.MaxAccess <= 0 {
		req.MaxAccess = 1
	}
	if req.ExpireSeconds <= 0 {
		req.ExpireSeconds = 60
	}

	// 限制最大值以确保安全
	if req.MaxAccess > 100 {
		req.MaxAccess = 100
	}
	if req.ExpireSeconds > 3600 {
		req.ExpireSeconds = 3600 // 最多 1 小时
	}

	sub := tempSubStore.Create(req.Proxies, req.MaxAccess, req.ExpireSeconds)

	resp := CreateTempSubResponse{
		ID:        sub.ID,
		URL:       "/t/" + sub.ID,
		MaxAccess: sub.MaxAccess,
		ExpireAt:  sub.ExpireAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// TempSubscriptionAccessHandler 处理对临时订阅的访问
type TempSubscriptionAccessHandler struct{}

// 创建用于访问临时订阅的处理程序
func NewTempSubscriptionAccessHandler() http.Handler {
	return &TempSubscriptionAccessHandler{}
}

func (h *TempSubscriptionAccessHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.NotFound(w, r)
		return
	}

	// 验证用户代理：必须包含 ClashMetaForAndroid 或 Mihomo（不区分大小写）
	userAgent := strings.ToLower(r.Header.Get("User-Agent"))
	if !strings.Contains(userAgent, "clashmetaforandroid") && !strings.Contains(userAgent, "mihomo") {
		http.Error(w, "Invalid client", http.StatusForbidden)
		return
	}

	// 从 URL 路径中提取 ID：/t/{id}
	path := strings.TrimPrefix(r.URL.Path, "/t/")
	id := strings.TrimSuffix(path, "/")

	if id == "" || len(id) != 8 {
		http.NotFound(w, r)
		return
	}

	sub, err := tempSubStore.Get(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	// 使用 yaml.Node 构建具有有序代理属性的 YAML
	rootNode := &yaml.Node{
		Kind: yaml.MappingNode,
	}

	// 添加“代理”键
	proxiesKeyNode := &yaml.Node{Kind: yaml.ScalarNode, Value: "proxies"}
	proxiesListNode := &yaml.Node{Kind: yaml.SequenceNode}

	for _, proxy := range sub.Proxies {
		if proxyMap, ok := proxy.(map[string]any); ok {
			proxiesListNode.Content = append(proxiesListNode.Content, util.ReorderProxyFieldsToNode(proxyMap))
		}
	}

	rootNode.Content = append(rootNode.Content, proxiesKeyNode, proxiesListNode)

	yamlData, err := MarshalYAMLWithIndent(rootNode)
	if err != nil {
		writeError(w, http.StatusInternalServerError, errors.New("failed to generate subscription"))
		return
	}

	// 修复 YAML 输出中的表情符号转义序列
	result := RemoveUnicodeEscapeQuotes(string(yamlData))

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(result))
}
