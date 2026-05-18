package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"miaomiaowux/internal/storage"
	"miaomiaowux/templates"
)

func (h *RemoteManageHandler) deployFallbackConfig(ctx context.Context, server *storage.RemoteServer) error {
	domain := strings.ToLower(strings.TrimSpace(server.Domain))
	rootDomain := extractRootDomain(domain)

	nginxConf, err := templates.ReadFile("fallback/nginx.conf")
	if err != nil {
		return fmt.Errorf("读取 fallback/nginx.conf 模板失败: %w", err)
	}

	domainTplPath := "fallback/domain_static.conf"
	if server.SiteType == "proxy" {
		domainTplPath = "fallback/domain_proxy.conf"
	}
	domainTpl, err := templates.ReadFile(domainTplPath)
	if err != nil {
		return fmt.Errorf("读取 %s 模板失败: %w", domainTplPath, err)
	}
	certName := "_." + rootDomain
	if cert, certErr := h.repo.GetCertificateByDomain(ctx, rootDomain, server.ID); certErr == nil && cert != nil {
		certName = certDeployFilename(cert.Domain)
	}
	domainConf := strings.ReplaceAll(string(domainTpl), "{domain}", domain)
	domainConf = strings.ReplaceAll(domainConf, "{root_domain}", rootDomain)
	domainConf = strings.ReplaceAll(domainConf, "{cert_name}", certName)
	staticRoot := server.SiteValue
	if staticRoot == "" {
		staticRoot = "/usr/local/nginx/html"
	}
	domainConf = strings.ReplaceAll(domainConf, "{static_root_path}", staticRoot)
	domainConf = strings.ReplaceAll(domainConf, "{proxy_pass_server}", server.SiteValue)

	sslPayload, _ := json.Marshal(map[string]any{
		"domain":        domain,
		"nginx_config":  string(nginxConf),
		"domain_config": domainConf,
	})
	if _, err := h.forwardToRemoteServer(ctx, server.ID, http.MethodPost, "/api/child/nginx/setup-ssl", sslPayload); err != nil {
		return fmt.Errorf("配置 Nginx SSL 失败: %w", err)
	}
	log.Printf("[DeployFallback] Deployed nginx config to server %d (%s)", server.ID, server.Name)

	configTpl, err := templates.ReadFile("default/config.json")
	if err != nil {
		return fmt.Errorf("读取 default/config.json 模板失败: %w", err)
	}

	configPayload, _ := json.Marshal(map[string]string{
		"config": string(configTpl),
	})
	if _, err := h.forwardToRemoteServer(ctx, server.ID, http.MethodPost, "/api/child/xray/config", configPayload); err != nil {
		return fmt.Errorf("下发 Xray 配置失败: %w", err)
	}
	log.Printf("[DeployFallback] Deployed xray config to server %d (%s)", server.ID, server.Name)

	if h.certHandler != nil {
		cert, certErr := h.repo.GetCertificateByDomain(ctx, rootDomain, server.ID)
		if certErr == nil && cert != nil && cert.CertPEM != "" && cert.KeyPEM != "" {
			payload := WSCertDeployPayload{
				Domain:   rootDomain,
				CertPEM:  cert.CertPEM,
				KeyPEM:   cert.KeyPEM,
				CertPath: fmt.Sprintf("/usr/local/nginx/cert/%s.pem", certDeployFilename(cert.Domain)),
				KeyPath:  fmt.Sprintf("/usr/local/nginx/cert/%s.key", certDeployFilename(cert.Domain)),
				Reload:   "nginx",
			}
			h.certHandler.deployToRemoteServer(server, payload)
			log.Printf("[DeployFallback] Deployed certificate for %s to server %d", rootDomain, server.ID)
		} else {
			h.certHandler.DeployAutoDeployCertificates(server.ID)
			log.Printf("[DeployFallback] Triggered auto-deploy certificates for server %d", server.ID)
		}
	}

	if err := h.restartXrayWithRecovery(ctx, server.ID, "DeployFallback"); err != nil {
		log.Printf("[DeployFallback] %v", err)
	}

	log.Printf("[DeployFallback] Completed fallback config deployment for server %d (%s), domain=%s", server.ID, server.Name, domain)

	// 通知 agent 更新本地 steal_mode
	if h.wsHandler != nil {
		_ = h.wsHandler.SendConfigUpdate(server.ID, map[string]string{"steal_mode": "fallback"})
	}

	return nil
}
