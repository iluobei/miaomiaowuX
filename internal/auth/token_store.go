package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type session struct {
	username string
	expiry   time.Time
}

type contextKey string

const (
	userContextKey contextKey = "miaomiaowu/auth/username"
)

const AuthHeader = "MM-Authorization"

type TokenStore struct {
	mu     sync.RWMutex
	tokens map[string]session
	ttl    time.Duration
	secret []byte // HMAC signing secret; nil = use plain random tokens
}

func NewTokenStore(ttl time.Duration) *TokenStore {
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	return &TokenStore{
		tokens: make(map[string]session),
		ttl:    ttl,
	}
}

func (s *TokenStore) SetSecret(secret string) {
	if secret != "" {
		s.secret = []byte(secret)
	}
}

func (s *TokenStore) Issue(username string) (string, time.Time, error) {
	return s.IssueWithTTL(username, s.ttl)
}

// 使用自定义 TTL 为指定用户名创建新令牌。
func (s *TokenStore) IssueWithTTL(username string, ttl time.Duration) (string, time.Time, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", time.Time{}, errors.New("username is required")
	}

	if ttl <= 0 {
		ttl = s.ttl
	}

	token, err := s.generateToken()
	if err != nil {
		return "", time.Time{}, err
	}

	expiry := time.Now().Add(ttl)

	s.mu.Lock()
	s.tokens[token] = session{username: username, expiry: expiry}
	s.mu.Unlock()

	return token, expiry, nil
}

func (s *TokenStore) Validate(token string) bool {
	_, ok := s.Lookup(token)
	return ok
}

func (s *TokenStore) Revoke(token string) {
	token = strings.TrimSpace(token)
	if token == "" {
		return
	}

	s.mu.Lock()
	delete(s.tokens, token)
	s.mu.Unlock()
}

func (s *TokenStore) RevokeAll() {
	s.mu.Lock()
	s.tokens = make(map[string]session)
	s.mu.Unlock()
}

// 将会话添加到内存存储中。用于在启动时从数据库恢复会话。
func (s *TokenStore) LoadSession(token, username string, expiry time.Time) {
	token = strings.TrimSpace(token)
	username = strings.TrimSpace(username)
	if token == "" || username == "" {
		return
	}

	// 跳过过期的会话
	if time.Now().After(expiry) {
		return
	}

	s.mu.Lock()
	s.tokens[token] = session{username: username, expiry: expiry}
	s.mu.Unlock()
}

// 将内存中的会话从 oldUsername 重写为 newUsername。
func (s *TokenStore) UpdateUsername(oldUsername, newUsername string) {
	oldUsername = strings.TrimSpace(oldUsername)
	newUsername = strings.TrimSpace(newUsername)
	if oldUsername == "" || newUsername == "" || oldUsername == newUsername {
		return
	}

	s.mu.Lock()
	for token, sess := range s.tokens {
		if sess.username == oldUsername {
			s.tokens[token] = session{username: newUsername, expiry: sess.expiry}
		}
	}
	s.mu.Unlock()
}

// 如果会话有效，查找将返回与所提供的令牌关联的用户名。
func (s *TokenStore) Lookup(token string) (string, bool) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", false
	}

	// 如果设置了 secret，验证 HMAC 签名
	if s.secret != nil {
		parts := strings.SplitN(token, ".", 2)
		if len(parts) != 2 {
			return "", false
		}
		mac := hmac.New(sha256.New, s.secret)
		mac.Write([]byte(parts[0]))
		expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
		if !hmac.Equal([]byte(parts[1]), []byte(expectedSig)) {
			return "", false
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.tokens[token]
	if !ok {
		return "", false
	}

	if time.Now().After(session.expiry) {
		delete(s.tokens, token)
		return "", false
	}

	return session.username, true
}

func ContextWithUsername(ctx context.Context, username string) context.Context {
	return context.WithValue(ctx, userContextKey, username)
}

// 从请求上下文中检索经过身份验证的用户名。
func UsernameFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	username, _ := ctx.Value(userContextKey).(string)
	return username
}

// 返回用户名（如果存在），否则返回提供的后备值。
func UsernameOrDefault(ctx context.Context, fallback string) string {
	if name := UsernameFromContext(ctx); name != "" {
		return name
	}
	return fallback
}

func randomToken(length int) (string, error) {
	buf := make([]byte, length)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func (s *TokenStore) generateToken() (string, error) {
	raw, err := randomToken(32)
	if err != nil {
		return "", err
	}
	if s.secret == nil {
		return raw, nil
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(raw))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return raw + "." + sig, nil
}

func RequireToken(store *TokenStore, repo UserRepository, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 首先尝试标题
		token := strings.TrimSpace(r.Header.Get(AuthHeader))
		// 回退到查询参数（对于不支持自定义标头的 SSE）
		if token == "" {
			token = strings.TrimSpace(r.URL.Query().Get("token"))
		}

		// 首先检查是否是有效的会话 token
		if username, ok := store.Lookup(token); ok {
			ctx := ContextWithUsername(r.Context(), username)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		// 如果不是会话 token，检查是否是 API token
		if repo != nil {
			apiToken, err := repo.GetAPIToken(r.Context())
			if err == nil && token == apiToken && apiToken != "" {
				// API token 有效，设置特殊的管理员用户名
				ctx := ContextWithUsername(r.Context(), "api-token-admin")
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
		}

		WriteUnauthorizedResponse(w)
	})
}

// UserRepository 提供用户信息以进行授权检查。
type UserRepository interface {
	GetUser(ctx context.Context, username string) (User, error)
	GetAPIToken(ctx context.Context) (string, error)
}

// User表示授权所需的基本用户信息。
type User struct {
	Username string
	Role     string
	IsActive bool
}

// 确保已认证的用户具有管理员角色
func RequireAdmin(store *TokenStore, repo UserRepository, next http.Handler) http.Handler {
	return RequireToken(store, repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username := UsernameFromContext(r.Context())
		if username == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"forbidden"}`))
			return
		}

		// 如果通过 API token 认证，授予管理员权限
		if username == "api-token-admin" {
			next.ServeHTTP(w, r)
			return
		}

		user, err := repo.GetUser(r.Context(), username)
		if err != nil || user.Role != "admin" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"forbidden"}`))
			return
		}

		next.ServeHTTP(w, r)
	}))
}

func WriteUnauthorizedResponse(w http.ResponseWriter) {
	if w == nil {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"code": http.StatusUnauthorized,
		"msg":  "无效凭据",
	})
}
