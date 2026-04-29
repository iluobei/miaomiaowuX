package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"miaomiaowu/internal/storage"
	"miaomiaowu/templates"
)

func (h *RemoteManageHandler) deployTunnelConfig(ctx context.Context, server *storage.RemoteServer) error {
	domain := strings.ToLower(strings.TrimSpace(server.Domain))
	rootDomain := extractRootDomain(domain)
	proxyDomain := strings.ToLower(strings.TrimSpace(server.PullAddress))

	nginxConf, err := templates.ReadFile("tunnel/nginx.conf")
	if err != nil {
		return fmt.Errorf("读取 tunnel/nginx.conf 模板失败: %w", err)
	}

	domainTplPath := "tunnel/domain_static.conf"
	if server.SiteType == "proxy" {
		domainTplPath = "tunnel/domain_proxy.conf"
	}
	domainTpl, err := templates.ReadFile(domainTplPath)
	if err != nil {
		return fmt.Errorf("读取 %s 模板失败: %w", domainTplPath, err)
	}
	domainConf := strings.ReplaceAll(string(domainTpl), "{domain}", domain)
	domainConf = strings.ReplaceAll(domainConf, "{root_domain}", rootDomain)
	domainConf = strings.ReplaceAll(domainConf, "{static_root_path}", server.SiteValue)
	domainConf = strings.ReplaceAll(domainConf, "{proxy_pass_server}", server.SiteValue)

	sslPayload, _ := json.Marshal(map[string]any{
		"domain":        domain,
		"nginx_config":  string(nginxConf),
		"domain_config": domainConf,
	})
	if _, err := h.forwardToRemoteServer(ctx, server.ID, http.MethodPost, "/api/child/nginx/setup-ssl", sslPayload); err != nil {
		return fmt.Errorf("配置 Nginx SSL 失败: %w", err)
	}
	log.Printf("[DeployTunnel] Deployed nginx config to server %d (%s)", server.ID, server.Name)

	configFile := "tunnel/config.json"
	if proxyDomain == "" || proxyDomain == domain {
		configFile = "tunnel/config_ip.json"
	}
	configTpl, err := templates.ReadFile(configFile)
	if err != nil {
		return fmt.Errorf("读取 %s 模板失败: %w", configFile, err)
	}
	configJSON := strings.ReplaceAll(string(configTpl), "{proxy_domain}", proxyDomain)
	configJSON = strings.ReplaceAll(configJSON, "{nginx_domain}", domain)

	configPayload, _ := json.Marshal(map[string]string{
		"config": configJSON,
	})
	if _, err := h.forwardToRemoteServer(ctx, server.ID, http.MethodPost, "/api/child/xray/config", configPayload); err != nil {
		return fmt.Errorf("下发 Xray 配置失败: %w", err)
	}
	log.Printf("[DeployTunnel] Deployed xray config to server %d (%s)", server.ID, server.Name)

	if h.certHandler != nil {
		cert, certErr := h.repo.GetCertificateByDomain(ctx, rootDomain, server.ID)
		if certErr == nil && cert != nil && cert.CertPEM != "" && cert.KeyPEM != "" {
			payload := WSCertDeployPayload{
				Domain:   rootDomain,
				CertPEM:  cert.CertPEM,
				KeyPEM:   cert.KeyPEM,
				CertPath: fmt.Sprintf("/usr/local/nginx/cert/%s.pem", rootDomain),
				KeyPath:  fmt.Sprintf("/usr/local/nginx/cert/%s.key", rootDomain),
				Reload:   "nginx",
			}
			h.certHandler.deployToRemoteServer(server, payload)
			log.Printf("[DeployTunnel] Deployed certificate for %s to server %d", rootDomain, server.ID)
		} else {
			h.certHandler.DeployAutoDeployCertificates(server.ID)
			log.Printf("[DeployTunnel] Triggered auto-deploy certificates for server %d", server.ID)
		}
	}

	if err := h.restartXrayWithRecovery(ctx, server.ID, "DeployTunnel"); err != nil {
		log.Printf("[DeployTunnel] %v", err)
	}

	log.Printf("[DeployTunnel] Completed tunnel config deployment for server %d (%s), domain=%s", server.ID, server.Name, domain)
	return nil
}
