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

	clearPayload, _ := json.Marshal(map[string]int{"port": 443})
	if _, err := h.forwardToRemoteServer(ctx, server.ID, http.MethodPost, "/api/child/nginx/clear-stream-port", clearPayload); err != nil {
		log.Printf("[DeployTunnel] clear stream port 443 on server %d: %v (non-fatal)", server.ID, err)
	}

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

	var xrayConfig map[string]any
	if err := json.Unmarshal([]byte(configJSON), &xrayConfig); err != nil {
		return fmt.Errorf("解析 Xray 模板配置失败: %w", err)
	}

	// 同机部署时，主控域名路由到 nginx，否则主控 HTTPS 不可达
	if server.IPAddress == "127.0.0.1" {
		if masterDomain := getDomainFromMasterURL(h.repo, ctx); masterDomain != "" && masterDomain != domain {
			h.addWebsiteTunnelConfig(xrayConfig, masterDomain)
		}
	} else {
		// 非主控部署直接使用服务器添加时的domain
		h.addWebsiteTunnelConfig(xrayConfig, domain)
	}

	updatedConfig, _ := json.MarshalIndent(xrayConfig, "", "    ")

	configPayload, _ := json.Marshal(map[string]string{
		"config": string(updatedConfig),
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
				CertPath: fmt.Sprintf("/usr/local/nginx/cert/%s.pem", certDeployFilename(cert.Domain)),
				KeyPath:  fmt.Sprintf("/usr/local/nginx/cert/%s.key", certDeployFilename(cert.Domain)),
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

	// 通知 agent 更新本地 steal_mode
	if h.wsHandler != nil {
		_ = h.wsHandler.SendConfigUpdate(server.ID, map[string]string{"steal_mode": "tunnel"})
	}

	return nil
}
