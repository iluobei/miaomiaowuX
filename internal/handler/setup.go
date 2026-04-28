package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"miaomiaowu/internal/logger"
	"miaomiaowu/internal/storage"
	"miaomiaowu/templates"
)

type setupStatusResponse struct {
	NeedsSetup bool `json:"needs_setup"`
}

type setupRequest struct {
	Username  string `json:"username"`
	Password  string `json:"password"`
	Nickname  string `json:"nickname"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
	Domain    string `json:"domain"`
}

type setupResponse struct {
	Username    string `json:"username"`
	Nickname    string `json:"nickname"`
	Email       string `json:"email"`
	NginxSetup  bool   `json:"nginx_setup,omitempty"`
	RedirectURL string `json:"redirect_url,omitempty"`
}

// 返回一个处理程序，用于检查是否需要初始设置
func NewSetupStatusHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("setup status handler requires repository")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logger.Info("[初始化检查] 收到初始化状态检查请求",
			"method", r.Method,
			"remote_addr", r.RemoteAddr,
		)

		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, errors.New("only GET is supported"))
			return
		}

		users, err := repo.ListUsers(r.Context(), 10)
		if err != nil {
			logger.Error("[初始化检查] 查询用户列表失败", "error", err)
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		needsSetup := len(users) == 0

		if len(users) > 0 {
			usernames := make([]string, len(users))
			for i, u := range users {
				usernames[i] = u.Username
			}
			logger.Info("[初始化检查] 数据库中已存在用户",
				"user_count", len(users),
				"usernames", usernames,
				"needs_setup", needsSetup,
			)
		} else {
			logger.Info("[初始化检查] 数据库中没有用户，需要初始化",
				"user_count", 0,
				"needs_setup", needsSetup,
			)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(setupStatusResponse{NeedsSetup: needsSetup})
	})
}

// 处理第一个管理员用户的创建
func NewInitialSetupHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("initial setup handler requires repository")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logger.Info("[初始化] 收到初始化请求",
			"method", r.Method,
			"remote_addr", r.RemoteAddr,
		)

		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
			return
		}

		// 检查是否还需要设置
		users, err := repo.ListUsers(r.Context(), 1)
		if err != nil {
			logger.Error("[初始化] 查询用户列表失败", "error", err)
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		if len(users) > 0 {
			logger.Warn("[初始化] 系统已初始化，拒绝重复初始化",
				"existing_user_count", len(users),
				"first_user", users[0].Username,
			)
			writeError(w, http.StatusConflict, errors.New("系统已初始化，无法再次注册"))
			return
		}

		var payload setupRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			logger.Error("[初始化] 解析请求体失败", "error", err)
			writeError(w, http.StatusBadRequest, err)
			return
		}

		username := strings.TrimSpace(payload.Username)
		password := strings.TrimSpace(payload.Password)
		nickname := strings.TrimSpace(payload.Nickname)
		email := strings.TrimSpace(payload.Email)
		avatarURL := strings.TrimSpace(payload.AvatarURL)

		logger.Info("[初始化] 准备创建管理员用户",
			"username", username,
			"nickname", nickname,
			"email", email,
		)

		if username == "" {
			writeError(w, http.StatusBadRequest, errors.New("用户名不能为空"))
			return
		}

		if password == "" {
			writeError(w, http.StatusBadRequest, errors.New("密码不能为空"))
			return
		}

		if nickname == "" {
			nickname = username
		}

		// 对密码进行哈希处理
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			logger.Error("[初始化] 密码哈希失败", "error", err)
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		// 创建管理员用户
		if err := repo.CreateUser(r.Context(), username, email, nickname, string(hash), storage.RoleAdmin, ""); err != nil {
			if errors.Is(err, storage.ErrUserExists) {
				logger.Warn("[初始化] 用户已存在", "username", username)
				writeError(w, http.StatusConflict, errors.New("用户已存在"))
				return
			}
			logger.Error("[初始化] 创建用户失败", "username", username, "error", err)
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		// 确保用户设置为管理员且处于活动状态
		_ = repo.UpdateUserRole(r.Context(), username, storage.RoleAdmin)
		_ = repo.UpdateUserStatus(r.Context(), username, true)

		if avatarURL != "" || email != "" || nickname != "" {
			_ = repo.UpdateUserProfile(r.Context(), username, storage.UserProfileUpdate{
				Email:     email,
				Nickname:  nickname,
				AvatarURL: avatarURL,
			})
		}

		logger.Info("[初始化] 管理员用户创建成功",
			"username", username,
			"nickname", nickname,
			"role", storage.RoleAdmin,
		)

		resp := setupResponse{
			Username: username,
			Nickname: nickname,
			Email:    email,
		}

		domain := strings.TrimSpace(payload.Domain)
		if domain != "" {
			domain = strings.ToLower(domain)

			port := "12889"
			if _, p, err := net.SplitHostPort(r.Host); err == nil && p != "" {
				port = p
			}
			masterURL := fmt.Sprintf("http://%s:%s", domain, port)
			_ = repo.SetSystemSetting(r.Context(), "master_url", masterURL)
			resp.RedirectURL = masterURL
			logger.Info("[初始化] 已保存 master_url", "master_url", masterURL)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(resp)
	})
}

// NewVerifyDomainHandler 验证域名 DNS 解析是否指向本机出口 IP
func NewVerifyDomainHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
			return
		}

		var req struct {
			Domain string `json:"domain"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		domain := strings.TrimSpace(strings.ToLower(req.Domain))
		if domain == "" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "域名不能为空"})
			return
		}

		domainIPs, err := net.LookupHost(domain)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"success": true, "match": false,
				"domain_ips": []string{}, "server_ip": "",
				"message": fmt.Sprintf("域名解析失败: %s", err.Error()),
			})
			return
		}

		serverIP := getOutboundIP()

		match := false
		for _, ip := range domainIPs {
			if ip == serverIP {
				match = true
				break
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"success":    true,
			"match":      match,
			"domain_ips": domainIPs,
			"server_ip":  serverIP,
		})
	})
}

func getOutboundIP() string {
	client := &http.Client{Timeout: 5 * time.Second}
	for _, url := range []string{"https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"} {
		resp, err := client.Get(url)
		if err != nil {
			continue
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			continue
		}
		ip := strings.TrimSpace(string(body))
		if net.ParseIP(ip) != nil {
			return ip
		}
	}
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return ""
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

func deployLocalNginx(domain string, repo *storage.TrafficRepository) error {
	nginxConf, err := templates.ReadFile("single_nginx.conf")
	if err != nil {
		return fmt.Errorf("读取 single_nginx.conf 模板失败: %w", err)
	}

	domainTpl, err := templates.ReadFile("mmwx_domain.conf")
	if err != nil {
		return fmt.Errorf("读取 mmwx_domain.conf 模板失败: %w", err)
	}
	domainConf := strings.ReplaceAll(string(domainTpl), "{domain}", domain)

	dirs := []string{
		"/usr/local/nginx/conf",
		"/usr/local/nginx/servers",
		"/usr/local/nginx/cert",
		"/usr/local/nginx/html",
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("创建目录 %s 失败: %w", dir, err)
		}
	}

	if err := os.WriteFile("/usr/local/nginx/conf/nginx.conf", nginxConf, 0644); err != nil {
		return fmt.Errorf("写入 nginx.conf 失败: %w", err)
	}

	serverConfPath := filepath.Join("/usr/local/nginx/servers", domain+".conf")
	if err := os.WriteFile(serverConfPath, []byte(domainConf), 0644); err != nil {
		return fmt.Errorf("写入 domain.conf 失败: %w", err)
	}

	if repo != nil {
		deployCertToLocal(domain, repo)
	}

	if err := exec.Command("nginx", "-s", "reload").Run(); err != nil {
		logger.Warn("[本机Nginx] reload 失败，尝试启动", "error", err)
		if startErr := exec.Command("systemctl", "start", "nginx").Run(); startErr != nil {
			return fmt.Errorf("nginx 启动失败: %w", startErr)
		}
	}

	return nil
}

func deployCertToLocal(domain string, repo *storage.TrafficRepository) {
	ctx := context.Background()
	cert, err := repo.GetCertificateByDomain(ctx, domain, 0)
	if err != nil || cert == nil || cert.CertPEM == "" || cert.KeyPEM == "" {
		logger.Warn("[本机Nginx] 未找到域名证书，跳过证书部署", "domain", domain)
		return
	}
	certPath := filepath.Join("/usr/local/nginx/cert", domain+".pem")
	keyPath := filepath.Join("/usr/local/nginx/cert", domain+".key")
	if err := os.WriteFile(certPath, []byte(cert.CertPEM), 0644); err != nil {
		logger.Error("[本机Nginx] 写入证书失败", "error", err)
		return
	}
	if err := os.WriteFile(keyPath, []byte(cert.KeyPEM), 0600); err != nil {
		logger.Error("[本机Nginx] 写入密钥失败", "error", err)
		return
	}
	logger.Info("[本机Nginx] 证书部署成功", "domain", domain)
}
