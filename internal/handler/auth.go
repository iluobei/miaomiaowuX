package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"miaomiaowu/internal/auth"
	"miaomiaowu/internal/logger"
	"miaomiaowu/internal/storage"
)

type loginRequest struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	RememberMe bool   `json:"remember_me"`
}

type loginResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Nickname  string    `json:"nickname"`
	Avatar    string    `json:"avatar_url"`
	Role      string    `json:"role"`
	IsAdmin   bool      `json:"is_admin"`
}

type credentialsRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// GetClientIP extracts the client IP address from the request
func GetClientIP(r *http.Request) string {
	// 首先检查 X-Forwarded-For 标头（对于代理请求）
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ips := strings.Split(xff, ",")
		if len(ips) > 0 {
			return strings.TrimSpace(ips[0])
		}
	}

	// 检查 X-Real-IP 标头
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}

	// 回退到 RemoteAddr
	ip := r.RemoteAddr
	if idx := strings.LastIndex(ip, ":"); idx != -1 {
		ip = ip[:idx]
	}
	return ip
}

func NewLoginHandler(manager *auth.Manager, tokens *auth.TokenStore, repo *storage.TrafficRepository, rateLimiter *LoginRateLimiter) http.Handler {
	if manager == nil || tokens == nil {
		panic("login handler requires manager and token store")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
			return
		}

		var payload loginRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if strings.TrimSpace(payload.Username) == "" || payload.Password == "" {
			writeError(w, http.StatusBadRequest, errors.New("username and password are required"))
			return
		}

		username := strings.TrimSpace(payload.Username)
		clientIP := GetClientIP(r)

		if rateLimiter != nil {
			if err := rateLimiter.Check(clientIP, username); err != nil {
				writeError(w, http.StatusTooManyRequests, errors.New("too many login attempts, please try again later"))
				return
			}
		}

		ok, err := manager.Authenticate(r.Context(), username, payload.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		if !ok {
			if rateLimiter != nil {
				rateLimiter.RecordFailure(clientIP, username)
			}
			logger.Warn("🔐 [LOGIN_FAIL] 登录失败",
				"username", username,
				"client_ip", clientIP,
				"time", time.Now().Format("2006-01-02 15:04:05"))
			writeError(w, http.StatusUnauthorized, errors.New("invalid credentials"))
			return
		}

		if rateLimiter != nil {
			rateLimiter.RecordSuccess(clientIP, username)
		}

		user, err := manager.User(r.Context(), username)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		if repo != nil {
			if _, err := repo.GetOrCreateUserToken(r.Context(), username); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
		}

		// 根据 Remember_me 标志确定令牌 TTL
		var ttl time.Duration
		if payload.RememberMe {
			ttl = 30 * 24 * time.Hour // 1个月
		} else {
			ttl = 24 * time.Hour // 1 天（默认）
		}

		token, expiry, err := tokens.IssueWithTTL(username, ttl)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		// 如果存储库可用，则将会话保留到数据库
		if repo != nil {
			if err := repo.CreateSession(r.Context(), token, username, expiry); err != nil {
				logger.Warn("[认证] 会话持久化失败", "username", username, "error", err)
				// 不要登录失败，只记录错误
			}
		}

		// 记录登录成功
		logger.Info("[认证] 登录成功",
			"username", username,
			"client_ip", clientIP,
			"remember_me", payload.RememberMe,
			"expires_at", expiry.Format("2006-01-02 15:04:05"))

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(loginResponse{
			Token:     token,
			ExpiresAt: expiry,
			Username:  user.Username,
			Email:     user.Email,
			Nickname:  user.Nickname,
			Avatar:    user.AvatarURL,
			Role:      user.Role,
			IsAdmin:   user.Role == storage.RoleAdmin,
		})
	})
}

func NewCredentialsHandler(manager *auth.Manager, tokens *auth.TokenStore) http.Handler {
	if manager == nil || tokens == nil {
		panic("credentials handler requires manager and token store")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, errors.New("only PUT is supported"))
			return
		}

		var payload credentialsRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		trimmedUsername := strings.TrimSpace(payload.Username)

		if trimmedUsername == "" && payload.Password == "" {
			writeError(w, http.StatusBadRequest, errors.New("username or password must be provided"))
			return
		}

		if err := manager.Update(r.Context(), trimmedUsername, payload.Password); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		tokens.RevokeAll()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
	})
}
