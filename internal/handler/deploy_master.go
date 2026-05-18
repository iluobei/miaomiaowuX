package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"miaomiaowux/internal/storage"
	"miaomiaowux/templates"
)

func localPanelBackend(masterURL string) string {
	u := strings.TrimPrefix(masterURL, "https://")
	u = strings.TrimPrefix(u, "http://")
	if idx := strings.Index(u, ":"); idx != -1 {
		if port := strings.Split(u[idx+1:], "/")[0]; port != "" {
			return "http://127.0.0.1:" + port
		}
	}
	return "http://127.0.0.1:12889"
}

func getDomainFromMasterURL(repo *storage.TrafficRepository, ctx context.Context) string {
	masterURL, _ := repo.GetSystemSetting(ctx, "master_url")
	if masterURL == "" {
		return ""
	}
	masterURL = strings.TrimPrefix(masterURL, "https://")
	masterURL = strings.TrimPrefix(masterURL, "http://")
	host := strings.Split(masterURL, ":")[0]
	return strings.TrimRight(host, "/")
}

func (h *CertificateHandler) findCertForDomain(ctx context.Context, domain string, serverID int64) (*storage.Certificate, error) {
	cert, err := h.repo.GetCertificateByDomain(ctx, domain, serverID)
	if err == nil && cert != nil && cert.CertPEM != "" && cert.KeyPEM != "" {
		return cert, nil
	}
	rootDomain := extractRootDomain(domain)
	wildcardDomain := "*." + rootDomain
	cert, err = h.repo.GetCertificateByDomain(ctx, wildcardDomain, serverID)
	if err == nil && cert != nil && cert.CertPEM != "" && cert.KeyPEM != "" {
		return cert, nil
	}
	if rootDomain != domain {
		cert, err = h.repo.GetCertificateByDomain(ctx, rootDomain, serverID)
		if err == nil && cert != nil && cert.CertPEM != "" && cert.KeyPEM != "" {
			return cert, nil
		}
	}
	return nil, fmt.Errorf("未找到域名 %s 的有效证书", domain)
}

// GetMasterCertStatus 返回主控证书是否待部署
func (h *CertificateHandler) GetMasterCertStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	pending, _ := h.repo.GetSystemSetting(ctx, "master_cert_pending")
	masterURL, _ := h.repo.GetSystemSetting(ctx, "master_url")
	domain := getDomainFromMasterURL(h.repo, ctx)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":       true,
		"pending":       pending == "true" && domain != "",
		"domain":        domain,
		"https_enabled": strings.HasPrefix(masterURL, "https://"),
	})
}

// DeployMasterCert 部署主控证书：安装 Nginx（如需）+ 配置 SSL + 更新 master_url
func (h *CertificateHandler) DeployMasterCert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	domain := getDomainFromMasterURL(h.repo, ctx)
	if domain == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "未配置主控域名"})
		return
	}

	cert, err := h.findCertForDomain(ctx, domain, 0)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "未找到主控域名的有效证书"})
		return
	}

	if !isNginxInstalled() {
		log.Printf("[DeployMasterCert] Nginx 未安装，开始安装...")
		if err := installNginxLocal(); err != nil {
			log.Printf("[DeployMasterCert] Nginx 安装失败: %v", err)
			respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("Nginx 安装失败: %s", err.Error())})
			return
		}
		log.Printf("[DeployMasterCert] Nginx 安装成功")
	}

	if err := deployLocalNginxWithCert(domain, cert); err != nil {
		log.Printf("[DeployMasterCert] Nginx 配置部署失败: %v", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("Nginx 配置失败: %s", err.Error())})
		return
	}

	newMasterURL := "https://" + domain
	_ = h.repo.SetSystemSetting(ctx, "master_url", newMasterURL)
	_ = h.repo.SetSystemSetting(ctx, "master_cert_pending", "")
	log.Printf("[DeployMasterCert] 主控证书部署成功，master_url 已更新为 %s", newMasterURL)

	if h.onMasterURLChanged != nil {
		go h.onMasterURLChanged(context.Background(), newMasterURL)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":        true,
		"message":        "主控证书部署成功",
		"new_master_url": newMasterURL,
	})
}

func findNginxBinary() string {
	for _, p := range []string{"/usr/local/nginx/sbin/nginx", "/usr/sbin/nginx", "/usr/bin/nginx"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	if p, err := exec.LookPath("nginx"); err == nil {
		return p
	}
	return ""
}

func isNginxInstalled() bool {
	return findNginxBinary() != ""
}

func installNginxLocal() error {
	cmd := exec.Command("bash", "-c", "curl -fsSL https://raw.githubusercontent.com/iluobei/miaomiaowuX/main/install-nginx.sh | bash")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func isPort443InUse() bool {
	ln, err := net.Listen("tcp", ":443")
	if err != nil {
		return true
	}
	ln.Close()
	return false
}

func (h *CertificateHandler) EnableHTTPS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	domain := getDomainFromMasterURL(h.repo, ctx)
	if domain == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "未配置主控域名"})
		return
	}
	domain = strings.ToLower(strings.TrimSpace(domain))
	rootDomain := extractRootDomain(domain)

	cert, err := h.findCertForDomain(ctx, domain, 0)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "未找到主控域名的有效证书"})
		return
	}

	if !isNginxInstalled() {
		log.Printf("[EnableHTTPS] Nginx 未安装，开始安装...")
		if err := installNginxLocal(); err != nil {
			respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("Nginx 安装失败: %s", err.Error())})
			return
		}
	}

	dirs := []string{"/usr/local/nginx/conf", "/usr/local/nginx/servers", "/usr/local/nginx/stream_servers", "/usr/local/nginx/cert", "/usr/local/nginx/html"}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("创建目录失败: %v", err)})
			return
		}
	}

	nginxConf, err := templates.ReadFile("tunnel/nginx.conf")
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("读取 nginx.conf 模板失败: %v", err)})
		return
	}
	if err := os.WriteFile("/usr/local/nginx/nginx.conf", nginxConf, 0644); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("写入 nginx.conf 失败: %v", err)})
		return
	}

	domainTpl, err := templates.ReadFile("tunnel/domain_proxy.conf")
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("读取 domain_proxy.conf 模板失败: %v", err)})
		return
	}
	certName := certDeployFilename(cert.Domain)
	domainConf := strings.ReplaceAll(string(domainTpl), "{domain}", domain)
	domainConf = strings.ReplaceAll(domainConf, "{root_domain}", rootDomain)
	domainConf = strings.ReplaceAll(domainConf, "{cert_name}", certName)
	masterURLRaw, _ := h.repo.GetSystemSetting(ctx, "master_url")
	domainConf = strings.ReplaceAll(domainConf, "{proxy_pass_server}", localPanelBackend(masterURLRaw))
	if err := os.WriteFile(filepath.Join("/usr/local/nginx/servers", domain+".conf"), []byte(domainConf), 0644); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("写入 domain.conf 失败: %v", err)})
		return
	}

	if !isPort443InUse() {
		fallbackTpl, err := templates.ReadFile("tunnel/xray_fallback_443.conf")
		if err != nil {
			respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("读取 xray_fallback_443.conf 模板失败: %v", err)})
			return
		}
		if err := os.WriteFile(filepath.Join("/usr/local/nginx/stream_servers", domain+"_443.conf"), fallbackTpl, 0644); err != nil {
			respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("写入 443 配置失败: %v", err)})
			return
		}
	}

	certPath := filepath.Join("/usr/local/nginx/cert", certName+".pem")
	keyPath := filepath.Join("/usr/local/nginx/cert", certName+".key")
	if err := os.WriteFile(certPath, []byte(cert.CertPEM), 0644); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("写入证书失败: %v", err)})
		return
	}
	if err := os.WriteFile(keyPath, []byte(cert.KeyPEM), 0600); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("写入密钥失败: %v", err)})
		return
	}

	nginxBin := findNginxBinary()
	if nginxBin == "" {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": "未找到 nginx 可执行文件"})
		return
	}

	if output, err := exec.Command(nginxBin, "-t").CombinedOutput(); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("Nginx 配置检测失败: %s", string(output))})
		return
	}

	if err := exec.Command(nginxBin, "-s", "reload").Run(); err != nil {
		if startErr := exec.Command("systemctl", "start", "nginx").Run(); startErr != nil {
			respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("Nginx 启动失败: %v", startErr)})
			return
		}
	}

	newMasterURL := "https://" + domain
	_ = h.repo.SetSystemSetting(ctx, "master_url", newMasterURL)
	log.Printf("[EnableHTTPS] HTTPS 已启用，master_url=%s, port443_in_use=%v", newMasterURL, isPort443InUse())

	if h.onMasterURLChanged != nil {
		go h.onMasterURLChanged(context.Background(), newMasterURL)
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"success":        true,
		"message":        fmt.Sprintf("已为 %s 开启 HTTPS 访问", domain),
		"new_master_url": newMasterURL,
	})

	// 延迟重启服务，使其重新绑定到 127.0.0.1（响应已发送）
	go func() {
		time.Sleep(2 * time.Second)
		log.Printf("[EnableHTTPS] Restarting service to bind 127.0.0.1 only")
		p, _ := os.FindProcess(os.Getpid())
		_ = p.Signal(syscall.SIGTERM)
	}()
}
