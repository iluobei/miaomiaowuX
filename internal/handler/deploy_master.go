package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
)

// GetMasterCertStatus 返回主控证书是否待部署
func (h *CertificateHandler) GetMasterCertStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	pending, _ := h.repo.GetSystemSetting(ctx, "master_cert_pending")
	domain, _ := h.repo.GetSystemSetting(ctx, "mmwx_domain")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"pending": pending == "true" && domain != "",
		"domain":  domain,
	})
}

// DeployMasterCert 部署主控证书：安装 Nginx（如需）+ 配置 SSL + 更新 master_url
func (h *CertificateHandler) DeployMasterCert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	domain, err := h.repo.GetSystemSetting(ctx, "mmwx_domain")
	if err != nil || domain == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "未配置主控域名"})
		return
	}

	cert, err := h.repo.GetCertificateByDomain(ctx, domain, 0)
	if err != nil || cert == nil || cert.CertPEM == "" {
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

	if err := deployLocalNginx(domain, h.repo); err != nil {
		log.Printf("[DeployMasterCert] Nginx 配置部署失败: %v", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("Nginx 配置失败: %s", err.Error())})
		return
	}

	newMasterURL := "https://" + domain
	_ = h.repo.SetSystemSetting(ctx, "master_url", newMasterURL)
	_ = h.repo.SetSystemSetting(ctx, "master_cert_pending", "")
	log.Printf("[DeployMasterCert] 主控证书部署成功，master_url 已更新为 %s", newMasterURL)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":        true,
		"message":        "主控证书部署成功",
		"new_master_url": newMasterURL,
	})
}

func isNginxInstalled() bool {
	paths := []string{"/usr/local/nginx/sbin/nginx", "/usr/sbin/nginx", "/usr/bin/nginx"}
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return true
		}
	}
	_, err := exec.LookPath("nginx")
	return err == nil
}

func installNginxLocal() error {
	scriptPaths := []string{"install-nginx.sh", "/app/install-nginx.sh"}
	var scriptPath string
	for _, p := range scriptPaths {
		if _, err := os.Stat(p); err == nil {
			scriptPath = p
			break
		}
	}
	if scriptPath == "" {
		return fmt.Errorf("install-nginx.sh 脚本未找到")
	}

	cmd := exec.Command("bash", scriptPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
