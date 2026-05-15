package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"miaomiaowux/internal/acme"
	"miaomiaowux/internal/auth"
	"miaomiaowux/internal/storage"
)

// CertificateHandler 处理证书管理 API 端点。

// certDeployFilename 根据证书域名生成部署文件名。
// 泛域名 *.example.com → _.example.com，单域名保持原样。
func certDeployFilename(domain string) string {
	if strings.HasPrefix(domain, "*.") {
		return "_." + domain[2:]
	}
	return domain
}

// certDeployPaths 根据证书域名和基础目录生成部署路径。
func certDeployPaths(domain, dir string) (certPath, keyPath string) {
	name := certDeployFilename(domain)
	return filepath.Join(dir, name+".pem"), filepath.Join(dir, name+".key")
}

type CertificateHandler struct {
	repo                *storage.TrafficRepository
	wsHandler           *RemoteWSHandler
	acmeClient          *acme.Client
	onMasterURLChanged  func(ctx context.Context, newURL string)
}

func (h *CertificateHandler) SetOnMasterURLChanged(fn func(ctx context.Context, newURL string)) {
	h.onMasterURLChanged = fn
}

// 创建一个新的CertificateHandler。
func NewCertificateHandler(repo *storage.TrafficRepository, wsHandler *RemoteWSHandler) *CertificateHandler {
	h := &CertificateHandler{
		repo:       repo,
		wsHandler:  wsHandler,
		acmeClient: acme.NewClient(),
	}
	// 注册来自远程服务器的证书更新回调
	if wsHandler != nil {
		wsHandler.SetCertUpdateHandler(h.HandleCertUpdate)
	}
	return h
}

// CertificateRequest 表示创建或更新证书的请求。
type CertificateRequest struct {
	Domain         string `json:"domain"`
	Email          string `json:"email"`
	RemoteServerID int64  `json:"remote_server_id"` // 0 = 主控
	Provider       string `json:"provider"`         // 详见上下文
	ChallengeMode  string `json:"challenge_mode"`   // 独立 |网站根目录 |域名系统
	WebrootPath    string `json:"webroot_path"`     // 仅适用于 webroot 模式
	AutoRenew      bool   `json:"auto_renew"`
	DNSProviderID  int64  `json:"dns_provider_id"` // 参考 dns_providers 表
	DeployTarget   string `json:"deploy_target"`   // 无、nginx、xray、两者
	DeployCertPath string `json:"deploy_cert_path"`
	DeployKeyPath  string `json:"deploy_key_path"`
	AutoDeploy     bool   `json:"auto_deploy"`
}

// CertificateResponse 表示 API 响应中的证书。
type CertificateResponse struct {
	ID               int64   `json:"id"`
	Domain           string  `json:"domain"`
	Email            string  `json:"email"`
	Provider         string  `json:"provider"`
	CertPath         string  `json:"cert_path"`
	KeyPath          string  `json:"key_path"`
	Status           string  `json:"status"`
	ExpiryDate       *string `json:"expiry_date"`
	IssueDate        *string `json:"issue_date"`
	AutoRenew        bool    `json:"auto_renew"`
	ChallengeMode    string  `json:"challenge_mode"`
	RemoteServerID   int64   `json:"remote_server_id"`
	RemoteServerName string  `json:"remote_server_name,omitempty"`
	Message          string  `json:"message,omitempty"`
	DNSProviderID    int64   `json:"dns_provider_id"`
	DeployTarget     string  `json:"deploy_target"`
	DeployCertPath   string  `json:"deploy_cert_path,omitempty"`
	DeployKeyPath    string  `json:"deploy_key_path,omitempty"`
	AutoDeploy       bool    `json:"auto_deploy"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

// ListCertificatesResponse 表示列出证书的响应。
type ListCertificatesResponse struct {
	Success      bool                  `json:"success"`
	Message      string                `json:"message,omitempty"`
	Certificates []CertificateResponse `json:"certificates"`
}

// SingleCertificateResponse 表示具有单个证书的响应。
type SingleCertificateResponse struct {
	Success     bool                 `json:"success"`
	Message     string               `json:"message,omitempty"`
	Certificate *CertificateResponse `json:"certificate,omitempty"`
}

func certificateToResponse(cert *storage.Certificate) CertificateResponse {
	resp := CertificateResponse{
		ID:             cert.ID,
		Domain:         cert.Domain,
		Email:          cert.Email,
		Provider:       cert.Provider,
		CertPath:       cert.CertPath,
		KeyPath:        cert.KeyPath,
		Status:         cert.Status,
		AutoRenew:      cert.AutoRenew,
		ChallengeMode:  cert.ChallengeMode,
		RemoteServerID: cert.RemoteServerID,
		Message:        cert.Message,
		DNSProviderID:  cert.DNSProviderID,
		DeployTarget:   cert.DeployTarget,
		DeployCertPath: cert.DeployCertPath,
		DeployKeyPath:  cert.DeployKeyPath,
		AutoDeploy:     cert.AutoDeploy,
		CreatedAt:      cert.CreatedAt.Format(time.RFC3339),
		UpdatedAt:      cert.UpdatedAt.Format(time.RFC3339),
	}
	if cert.ExpiryDate != nil {
		t := cert.ExpiryDate.Format(time.RFC3339)
		resp.ExpiryDate = &t
	}
	if cert.IssueDate != nil {
		t := cert.IssueDate.Format(time.RFC3339)
		resp.IssueDate = &t
	}
	return resp
}

// 检查当前用户是否是管理员
func (h *CertificateHandler) requireAdmin(r *http.Request) bool {
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		return false
	}
	user, err := h.repo.GetUser(r.Context(), username)
	if err != nil {
		return false
	}
	return user.Role == storage.RoleAdmin
}

// 处理 GET /api/admin/certificates
func (h *CertificateHandler) ListCertificates(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	// 检查 server_id 过滤器
	serverIDStr := r.URL.Query().Get("server_id")
	var certs []storage.Certificate
	var err error

	if serverIDStr != "" {
		serverID, parseErr := strconv.ParseInt(serverIDStr, 10, 64)
		if parseErr != nil {
			respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的服务器ID"})
			return
		}
		certs, err = h.repo.ListCertificatesByServer(ctx, serverID)
	} else {
		certs, err = h.repo.ListCertificates(ctx)
	}

	if err != nil {
		log.Printf("[Certificate] ListCertificates error: %v", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": "获取证书列表失败"})
		return
	}

	// 获取远程服务器名称以进行显示
	serverNames := make(map[int64]string)
	servers, _ := h.repo.ListRemoteServers(ctx)
	for _, s := range servers {
		serverNames[s.ID] = s.Name
	}

	responses := make([]CertificateResponse, len(certs))
	for i, cert := range certs {
		responses[i] = certificateToResponse(&cert)
		if cert.RemoteServerID > 0 {
			responses[i].RemoteServerName = serverNames[cert.RemoteServerID]
		} else {
			responses[i].RemoteServerName = "本地服务器"
		}
	}

	respondJSON(w, http.StatusOK, ListCertificatesResponse{
		Success:      true,
		Certificates: responses,
	})
}

// 处理 GET /api/admin/certificates/{id}
func (h *CertificateHandler) GetCertificate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/admin/certificates/")
	idStr = strings.Split(idStr, "/")[0]
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的证书ID"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	cert, err := h.repo.GetCertificate(ctx, id)
	if err != nil {
		if err == storage.ErrCertificateNotFound {
			respondJSON(w, http.StatusNotFound, map[string]any{"success": false, "message": "证书不存在"})
			return
		}
		log.Printf("[Certificate] GetCertificate error: %v", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": "获取证书失败"})
		return
	}

	resp := certificateToResponse(cert)
	if cert.RemoteServerID > 0 {
		server, _ := h.repo.GetRemoteServer(ctx, cert.RemoteServerID)
		if server != nil {
			resp.RemoteServerName = server.Name
		}
	} else {
		resp.RemoteServerName = "本地服务器"
	}

	respondJSON(w, http.StatusOK, SingleCertificateResponse{
		Success:     true,
		Certificate: &resp,
	})
}

// 处理 POST /api/admin/certificates
func (h *CertificateHandler) CreateCertificate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	var req CertificateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的请求数据"})
		return
	}

	req.Domain = strings.TrimSpace(req.Domain)
	req.Email = strings.TrimSpace(req.Email)

	if req.Domain == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "域名不能为空"})
		return
	}
	if req.Email == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "邮箱不能为空"})
		return
	}

	if req.Provider == "" {
		req.Provider = "letsencrypt"
	}
	if req.ChallengeMode == "" {
		req.ChallengeMode = storage.CertChallengeStandalone
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()

	// 检查现有证书
	existing, err := h.repo.GetCertificateByDomain(ctx, req.Domain, req.RemoteServerID)
	if err == nil && existing != nil {
		respondJSON(w, http.StatusConflict, map[string]any{"success": false, "message": "该域名的证书已存在"})
		return
	}

	if req.DeployTarget == "" {
		req.DeployTarget = "none"
	}

	// 先创建证书记录
	cert := &storage.Certificate{
		Domain:         req.Domain,
		Email:          req.Email,
		Provider:       req.Provider,
		Status:         storage.CertStatusPending,
		AutoRenew:      req.AutoRenew,
		ChallengeMode:  req.ChallengeMode,
		WebrootPath:    req.WebrootPath,
		RemoteServerID: req.RemoteServerID,
		DNSProviderID:  req.DNSProviderID,
		DeployTarget:   req.DeployTarget,
		DeployCertPath: req.DeployCertPath,
		DeployKeyPath:  req.DeployKeyPath,
		AutoDeploy:     req.AutoDeploy,
	}

	if err := h.repo.CreateCertificate(ctx, cert); err != nil {
		if err == storage.ErrCertificateExists {
			respondJSON(w, http.StatusConflict, map[string]any{"success": false, "message": "该域名的证书已存在"})
			return
		}
		log.Printf("[Certificate] CreateCertificate error: %v", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": "创建证书记录失败"})
		return
	}

	if req.RemoteServerID == 0 {
		// 本地证书请求
		go h.requestLocalCertificate(cert)
		respondJSON(w, http.StatusAccepted, SingleCertificateResponse{
			Success:     true,
			Message:     "证书申请已提交，正在处理中...",
			Certificate: &CertificateResponse{ID: cert.ID, Domain: cert.Domain, Status: storage.CertStatusPending},
		})
	} else {
		// 通过WebSocket远程证书请求
		go h.requestRemoteCertificate(cert)
		respondJSON(w, http.StatusAccepted, SingleCertificateResponse{
			Success:     true,
			Message:     "证书申请已发送到远程服务器...",
			Certificate: &CertificateResponse{ID: cert.ID, Domain: cert.Domain, Status: storage.CertStatusPending},
		})
	}
}

// 使用 ACME 在本地请求证书。
func (h *CertificateHandler) requestLocalCertificate(cert *storage.Certificate) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	appendLog := func(msg string) {
		_ = h.repo.AppendCertificateLog(ctx, cert.ID, msg)
	}

	appendLog("开始申请证书: " + cert.Domain)

	certReq, err := h.buildCertRequest(ctx, cert)
	if err != nil {
		log.Printf("[Certificate] buildCertRequest failed for %s: %v", cert.Domain, err)
		appendLog("构建请求失败: " + err.Error())
		_ = h.repo.UpdateCertificateStatus(ctx, cert.ID, storage.CertStatusFailed, err.Error())
		return
	}

	appendLog(fmt.Sprintf("验证方式: %s, CA: %s", certReq.ChallengeMode, certReq.Provider))
	if certReq.ChallengeMode == "dns" {
		appendLog("DNS 提供商: " + certReq.DNSProvider)
	}
	appendLog("正在向 CA 请求证书...")

	result, err := h.acmeClient.ObtainCertificateV2(ctx, certReq)
	if err != nil {
		log.Printf("[Certificate] ObtainCertificate failed for %s: %v", cert.Domain, err)
		appendLog("证书申请失败: " + err.Error())
		_ = h.repo.UpdateCertificateStatus(ctx, cert.ID, storage.CertStatusFailed, err.Error())
		return
	}

	appendLog(fmt.Sprintf("证书颁发成功, 有效期至 %s", result.ExpiryDate.Format("2006-01-02")))

	if err := h.repo.UpdateCertificateIssued(ctx, cert.ID, result.CertPath, result.KeyPath, result.CertPEM, result.KeyPEM, result.IssueDate, result.ExpiryDate); err != nil {
		log.Printf("[Certificate] UpdateCertificateIssued failed for %s: %v", cert.Domain, err)
		return
	}

	log.Printf("[Certificate] Successfully issued certificate for %s, expires %s", cert.Domain, result.ExpiryDate.Format("2006-01-02"))

	// 如果配置则本地部署
	h.deployAfterIssue(cert, result)
	h.checkMasterCertReady(cert)
}

// 通过 WebSocket 向远程代理发送证书请求。
func (h *CertificateHandler) requestRemoteCertificate(cert *storage.Certificate) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	appendLog := func(msg string) {
		_ = h.repo.AppendCertificateLog(ctx, cert.ID, msg)
	}

	appendLog("开始远程证书申请: " + cert.Domain)

	// 获取远程服务器令牌
	server, err := h.repo.GetRemoteServer(ctx, cert.RemoteServerID)
	if err != nil {
		log.Printf("[Certificate] GetRemoteServer failed: %v", err)
		appendLog("获取远程服务器信息失败: " + err.Error())
		_ = h.repo.UpdateCertificateStatus(ctx, cert.ID, storage.CertStatusFailed, "获取远程服务器信息失败")
		return
	}

	appendLog("目标服务器: " + server.Name)

	if !h.wsHandler.IsConnected(server.Token) {
		log.Printf("[Certificate] Remote server %s is not connected", server.Name)
		appendLog("远程服务器未连接")
		_ = h.repo.UpdateCertificateStatus(ctx, cert.ID, storage.CertStatusFailed, "远程服务器未连接")
		return
	}

	// 如果需要，解析 DNS 凭据
	var dnsProviderType string
	var dnsCredentials string
	if cert.ChallengeMode == storage.CertChallengeDNS && cert.DNSProviderID > 0 {
		dnsProvider, dnsErr := h.repo.GetDNSProvider(ctx, cert.DNSProviderID)
		if dnsErr != nil {
			log.Printf("[Certificate] GetDNSProvider failed: %v", dnsErr)
			appendLog("获取 DNS 凭证失败")
			_ = h.repo.UpdateCertificateStatus(ctx, cert.ID, storage.CertStatusFailed, "获取DNS凭证失败")
			return
		}
		dnsProviderType = dnsProvider.ProviderType
		dnsCredentials = dnsProvider.Credentials
		appendLog("DNS 提供商: " + dnsProviderType)
	}

	appendLog("正在通过 WebSocket 发送证书请求...")

	// 通过 WebSocket 发送证书请求
	payload := WSCertRequestPayload{
		CertID:         cert.ID,
		Domain:         cert.Domain,
		Email:          cert.Email,
		Provider:       cert.Provider,
		ChallengeMode:  cert.ChallengeMode,
		WebrootPath:    cert.WebrootPath,
		DNSProvider:    dnsProviderType,
		DNSCredentials: dnsCredentials,
	}

	if err := h.wsHandler.SendCertRequest(server.Token, payload); err != nil {
		log.Printf("[Certificate] SendCertRequest failed: %v", err)
		_ = h.repo.UpdateCertificateStatus(ctx, cert.ID, storage.CertStatusFailed, "发送证书请求失败")
		return
	}

	log.Printf("[Certificate] Sent certificate request to remote server %s for domain %s", server.Name, cert.Domain)
}

// 处理 POST /api/admin/certificates/renew
func (h *CertificateHandler) RenewCertificate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == 0 {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的证书ID"})
		return
	}
	id := req.ID

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	cert, err := h.repo.GetCertificate(ctx, id)
	if err != nil {
		if err == storage.ErrCertificateNotFound {
			respondJSON(w, http.StatusNotFound, map[string]any{"success": false, "message": "证书不存在"})
			return
		}
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": "获取证书失败"})
		return
	}

	// 将状态更新为待处理
	_ = h.repo.UpdateCertificateStatus(ctx, cert.ID, storage.CertStatusPending, "正在续期...")

	if cert.RemoteServerID == 0 {
		go h.renewLocalCertificate(cert)
	} else {
		go h.requestRemoteCertificate(cert)
	}

	respondJSON(w, http.StatusAccepted, map[string]any{"success": true, "message": "证书续期已提交"})
}

// 在本地更新证书。
func (h *CertificateHandler) renewLocalCertificate(cert *storage.Certificate) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	certReq, err := h.buildCertRequest(ctx, cert)
	if err != nil {
		log.Printf("[Certificate] buildCertRequest failed for %s: %v", cert.Domain, err)
		_ = h.repo.UpdateCertificateStatus(ctx, cert.ID, storage.CertStatusFailed, err.Error())
		return
	}

	result, err := h.acmeClient.RenewCertificateV2(ctx, certReq, cert.CertPEM, cert.KeyPEM)
	if err != nil {
		log.Printf("[Certificate] RenewCertificate failed for %s: %v", cert.Domain, err)
		_ = h.repo.UpdateCertificateStatus(ctx, cert.ID, storage.CertStatusFailed, err.Error())
		return
	}

	if err := h.repo.UpdateCertificateIssued(ctx, cert.ID, result.CertPath, result.KeyPath, result.CertPEM, result.KeyPEM, result.IssueDate, result.ExpiryDate); err != nil {
		log.Printf("[Certificate] UpdateCertificateIssued failed for %s: %v", cert.Domain, err)
		return
	}

	log.Printf("[Certificate] Successfully renewed certificate for %s, expires %s", cert.Domain, result.ExpiryDate.Format("2006-01-02"))

	// 如果配置则本地部署
	h.deployAfterIssue(cert, result)
	h.checkMasterCertReady(cert)
}

// 处理 PATCH /api/admin/certificates/auto-renew
func (h *CertificateHandler) SetAutoRenew(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	var req struct {
		ID        int64 `json:"id"`
		AutoRenew bool  `json:"auto_renew"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == 0 {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的请求数据"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := h.repo.SetCertificateAutoRenew(ctx, req.ID, req.AutoRenew); err != nil {
		if err == storage.ErrCertificateNotFound {
			respondJSON(w, http.StatusNotFound, map[string]any{"success": false, "message": "证书不存在"})
			return
		}
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": "更新失败"})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"success": true, "message": "已更新"})
}

// 处理 PATCH /api/admin/certificates/auto-deploy
func (h *CertificateHandler) SetAutoDeploy(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	var req struct {
		ID         int64 `json:"id"`
		AutoDeploy bool  `json:"auto_deploy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == 0 {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的请求数据"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := h.repo.SetCertificateAutoDeploy(ctx, req.ID, req.AutoDeploy); err != nil {
		if err == storage.ErrCertificateNotFound {
			respondJSON(w, http.StatusNotFound, map[string]any{"success": false, "message": "证书不存在"})
			return
		}
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": "更新失败"})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"success": true, "message": "已更新"})
}

// 处理 DELETE /api/admin/certificates/delete
func (h *CertificateHandler) DeleteCertificate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == 0 {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的证书ID"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := h.repo.DeleteCertificate(ctx, req.ID); err != nil {
		if err == storage.ErrCertificateNotFound {
			respondJSON(w, http.StatusNotFound, map[string]any{"success": false, "message": "证书不存在"})
			return
		}
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": "删除失败"})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"success": true, "message": "证书已删除"})
}

// 处理 GET /api/admin/certificates/valid
func (h *CertificateHandler) ListValidCertificates(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	certs, err := h.repo.ListValidCertificates(ctx)
	if err != nil {
		log.Printf("[Certificate] ListValidCertificates error: %v", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": "获取证书列表失败"})
		return
	}

	// 获取远程服务器名称
	serverNames := make(map[int64]string)
	servers, _ := h.repo.ListRemoteServers(ctx)
	for _, s := range servers {
		serverNames[s.ID] = s.Name
	}

	responses := make([]CertificateResponse, len(certs))
	for i, cert := range certs {
		responses[i] = certificateToResponse(&cert)
		if cert.RemoteServerID > 0 {
			responses[i].RemoteServerName = serverNames[cert.RemoteServerID]
		} else {
			responses[i].RemoteServerName = "本地服务器"
		}
	}

	respondJSON(w, http.StatusOK, ListCertificatesResponse{
		Success:      true,
		Certificates: responses,
	})
}

// 启动一个 goroutine 来检查过期的证书。
func (h *CertificateHandler) StartRenewalChecker(ctx context.Context) {
	go func() {
		// 启动后初步检查
		time.Sleep(1 * time.Minute)
		h.checkAndRenewCertificates()

		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.checkAndRenewCertificates()
			}
		}
	}()
}

// 检查过期证书并更新它们。
func (h *CertificateHandler) checkAndRenewCertificates() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// 启用 auto_renew 后获取 30 天后到期的证书
	certs, err := h.repo.ListExpiringCertificates(ctx, 30)
	if err != nil {
		log.Printf("[Certificate] ListExpiringCertificates error: %v", err)
		return
	}

	for _, cert := range certs {
		log.Printf("[Certificate] Auto-renewing certificate for %s (expires %s)", cert.Domain, cert.ExpiryDate.Format("2006-01-02"))

		_ = h.repo.UpdateCertificateStatus(ctx, cert.ID, storage.CertStatusPending, "自动续期中...")

		if cert.RemoteServerID == 0 {
			go h.renewLocalCertificate(&cert)
		} else {
			go h.requestRemoteCertificate(&cert)
		}
	}

	if len(certs) > 0 {
		log.Printf("[Certificate] Initiated renewal for %d certificates", len(certs))
	}
}

// 处理来自远程代理的证书更新通知。
func (h *CertificateHandler) HandleCertUpdate(serverID int64, payload WSCertUpdatePayload) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if payload.Success {
		if err := h.repo.UpdateCertificateIssued(ctx, payload.CertID, payload.CertPath, payload.KeyPath, payload.CertPEM, payload.KeyPEM, payload.IssueDate, payload.ExpiryDate); err != nil {
			log.Printf("[Certificate] HandleCertUpdate UpdateCertificateIssued failed: %v", err)
			return
		}
		log.Printf("[Certificate] Remote certificate issued for domain from cert_update, cert_id=%d, server_id=%d", payload.CertID, serverID)

		// 部署到主服务器和所有远程服务器（如果配置）
		cert, err := h.repo.GetCertificate(ctx, payload.CertID)
		if err == nil && cert.DeployCertPath != "" && cert.DeployKeyPath != "" {
			deployTarget := cert.DeployTarget
			if cert.AutoDeploy {
				deployTarget = "both"
			}
			if deployTarget != "" && deployTarget != "none" {
				if deployErr := acme.Deploy(payload.CertPEM, payload.KeyPEM, cert.DeployCertPath, cert.DeployKeyPath, deployTarget); deployErr != nil {
					log.Printf("[Certificate] Local deploy from cert_update failed: %v", deployErr)
				}
				h.deployToAllRemotes(cert.Domain, payload.CertPEM, payload.KeyPEM, cert.DeployCertPath, cert.DeployKeyPath, deployTarget)
			}
		}
	} else {
		if err := h.repo.UpdateCertificateStatus(ctx, payload.CertID, storage.CertStatusFailed, payload.Error); err != nil {
			log.Printf("[Certificate] HandleCertUpdate UpdateCertificateStatus failed: %v", err)
			return
		}
		log.Printf("[Certificate] Remote certificate failed for cert_id=%d, server_id=%d: %s", payload.CertID, serverID, payload.Error)
	}
}

// buildCertRequest 从 storage.Certificate 构造 acme.CertRequest，
// 从数据库解析 DNS 提供商凭据。
func (h *CertificateHandler) buildCertRequest(ctx context.Context, cert *storage.Certificate) (acme.CertRequest, error) {
	req := acme.CertRequest{
		Email:         cert.Email,
		Domain:        cert.Domain,
		Provider:      cert.Provider,
		ChallengeMode: cert.ChallengeMode,
		WebrootPath:   cert.WebrootPath,
	}

	// 如果使用 DNS-01，则解析 DNS 提供商凭据
	if cert.ChallengeMode == storage.CertChallengeDNS && cert.DNSProviderID > 0 {
		dnsProvider, err := h.repo.GetDNSProvider(ctx, cert.DNSProviderID)
		if err != nil {
			return req, fmt.Errorf("get DNS provider: %w", err)
		}
		req.DNSProvider = dnsProvider.ProviderType

		// 解析凭证 JSON
		var creds map[string]string
		if err := json.Unmarshal([]byte(dnsProvider.Credentials), &creds); err != nil {
			return req, fmt.Errorf("parse DNS credentials: %w", err)
		}
		req.DNSCredentials = creds
	}

	return req, nil
}

// 处理颁发后的证书部署 - 部署到主服务器和所有远程服务器。
func (h *CertificateHandler) deployAfterIssue(cert *storage.Certificate, result *acme.CertResult) {
	deployTarget := cert.DeployTarget
	if cert.AutoDeploy && cert.DeployCertPath != "" && cert.DeployKeyPath != "" {
		deployTarget = "both"
	}
	if deployTarget == "" || deployTarget == "none" {
		return
	}
	if cert.DeployCertPath == "" || cert.DeployKeyPath == "" {
		return
	}

	// 本地部署（主）
	if err := acme.Deploy(result.CertPEM, result.KeyPEM, cert.DeployCertPath, cert.DeployKeyPath, deployTarget); err != nil {
		log.Printf("[Certificate] Local deploy failed for %s: %v", cert.Domain, err)
	} else {
		log.Printf("[Certificate] Local deploy succeeded for %s to %s", cert.Domain, cert.DeployCertPath)
	}

	// 部署到所有远程服务器
	h.deployToAllRemotes(cert.Domain, result.CertPEM, result.KeyPEM, cert.DeployCertPath, cert.DeployKeyPath, deployTarget)
}

func (h *CertificateHandler) checkMasterCertReady(cert *storage.Certificate) {
	if cert.RemoteServerID != 0 {
		return
	}
	ctx := context.Background()
	domain := getDomainFromMasterURL(h.repo, ctx)
	if domain == "" {
		return
	}
	rootDomain := extractRootDomain(domain)
	certDomain := strings.ToLower(cert.Domain)
	if !strings.EqualFold(certDomain, domain) && certDomain != "*."+rootDomain && certDomain != rootDomain {
		return
	}
	masterURL, _ := h.repo.GetSystemSetting(ctx, "master_url")
	if strings.HasPrefix(masterURL, "https://") {
		return
	}
	_ = h.repo.SetSystemSetting(ctx, "master_cert_pending", "true")
	log.Printf("[Certificate] 主控域名证书已签发，等待用户确认部署: %s", cert.Domain)
}

// 将 cert_deploy 消息发送到特定的远程代理。
func (h *CertificateHandler) deployRemoteCertificate(cert *storage.Certificate, certPEM, keyPEM string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	server, err := h.repo.GetRemoteServer(ctx, cert.RemoteServerID)
	if err != nil {
		log.Printf("[Certificate] GetRemoteServer for deploy failed: %v", err)
		return
	}

	payload := WSCertDeployPayload{
		Domain:   cert.Domain,
		CertPEM:  certPEM,
		KeyPEM:   keyPEM,
		CertPath: filepath.Join(filepath.Dir(cert.DeployCertPath), certDeployFilename(cert.Domain)+filepath.Ext(cert.DeployCertPath)),
		KeyPath:  filepath.Join(filepath.Dir(cert.DeployKeyPath), certDeployFilename(cert.Domain)+filepath.Ext(cert.DeployKeyPath)),
		Reload:   cert.DeployTarget,
	}

	h.deployToRemoteServer(server, payload)
}

// 通过 WS 或 HTTP 将证书发送到特定的远程服务器。
func (h *CertificateHandler) deployToRemoteServer(server *storage.RemoteServer, payload WSCertDeployPayload) {
	if h.wsHandler != nil && h.wsHandler.IsConnected(server.Token) {
		if err := h.wsHandler.SendCertDeploy(server.Token, payload); err == nil {
			log.Printf("[Certificate] Sent cert_deploy via WS to %s for %s", server.Name, payload.Domain)
			return
		}
		log.Printf("[Certificate] WS cert_deploy failed for %s, falling back to HTTP", server.Name)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := h.deployRemoteCertificateHTTP(ctx, server, payload); err != nil {
		log.Printf("[Certificate] HTTP cert_deploy failed for %s: %v", server.Name, err)
	} else {
		log.Printf("[Certificate] Sent cert_deploy via HTTP to %s for %s", server.Name, payload.Domain)
	}
}

// 将证书部署到所有连接的远程服务器。
func (h *CertificateHandler) deployToAllRemotes(domain, certPEM, keyPEM, certPath, keyPath, reloadTarget string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	servers, err := h.repo.ListRemoteServers(ctx)
	if err != nil || len(servers) == 0 {
		return
	}

	payload := WSCertDeployPayload{
		Domain:   domain,
		CertPEM:  certPEM,
		KeyPEM:   keyPEM,
		CertPath: filepath.Join(filepath.Dir(certPath), certDeployFilename(domain)+filepath.Ext(certPath)),
		KeyPath:  filepath.Join(filepath.Dir(keyPath), certDeployFilename(domain)+filepath.Ext(keyPath)),
		Reload:   reloadTarget,
	}

	for i := range servers {
		go h.deployToRemoteServer(&servers[i], payload)
	}
	log.Printf("[Certificate] Initiated deploy to %d remote server(s) for %s", len(servers), domain)
}

// 通过 HTTP POST 将证书推送到代理
func (h *CertificateHandler) deployRemoteCertificateHTTP(ctx context.Context, server *storage.RemoteServer, payload WSCertDeployPayload) error {
	if server.IPAddress == "" {
		return fmt.Errorf("server IP address unknown")
	}

	ip := server.IPAddress
	if idx := strings.LastIndex(ip, ":"); idx != -1 {
		if !strings.Contains(ip, "[") {
			ip = ip[:idx]
		}
	}

	port := "23889"
	if server.ListenPort > 0 {
		port = fmt.Sprintf("%d", server.ListenPort)
	}

	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("http://%s:%s/api/child/cert/deploy", ip, port)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+server.Token)
	req.Header.Set("User-Agent", "miaomiaowux/0.1")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// 处理 POST /api/admin/certificates/deploy — 手动部署证书。
func (h *CertificateHandler) DeployCertificate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}
	if r.Method != http.MethodPost {
		respondJSON(w, http.StatusMethodNotAllowed, map[string]any{"success": false, "message": "Method not allowed"})
		return
	}

	var req struct {
		ID             int64  `json:"id"`
		DeployTarget   string `json:"deploy_target"`
		DeployCertPath string `json:"deploy_cert_path"`
		DeployKeyPath  string `json:"deploy_key_path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "请求格式错误"})
		return
	}
	if req.ID == 0 || req.DeployTarget == "" || req.DeployCertPath == "" || req.DeployKeyPath == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "缺少必要参数"})
		return
	}

	cert, err := h.repo.GetCertificate(r.Context(), req.ID)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{"success": false, "message": "证书不存在"})
		return
	}
	if cert.Status != "valid" || cert.CertPEM == "" || cert.KeyPEM == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "证书状态无效或缺少证书数据"})
		return
	}

	// 更新部署设置
	cert.DeployTarget = req.DeployTarget
	cert.DeployCertPath = req.DeployCertPath
	cert.DeployKeyPath = req.DeployKeyPath
	if err := h.repo.UpdateCertificate(r.Context(), cert); err != nil {
		log.Printf("[Certificate] UpdateCertificate deploy settings failed: %v", err)
	}

	// 本地部署（主）
	if err := acme.Deploy(cert.CertPEM, cert.KeyPEM, req.DeployCertPath, req.DeployKeyPath, req.DeployTarget); err != nil {
		log.Printf("[Certificate] Local deploy failed for %s: %v", cert.Domain, err)
	}

	// 部署到所有远程服务器
	h.deployToAllRemotes(cert.Domain, cert.CertPEM, cert.KeyPEM, req.DeployCertPath, req.DeployKeyPath, req.DeployTarget)

	respondJSON(w, http.StatusOK, map[string]any{"success": true, "message": "证书已部署到主服务器和所有远程服务器"})
}

// DeployAutoDeployCertificates 将所有 auto_deploy 证书部署到特定的远程服务器。
// 在远程服务器安装 nginx/xray 后调用。
func (h *CertificateHandler) DeployAutoDeployCertificates(serverID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	certs, err := h.repo.ListAutoDeployCertificates(ctx)
	if err != nil || len(certs) == 0 {
		return
	}

	server, err := h.repo.GetRemoteServer(ctx, serverID)
	if err != nil {
		log.Printf("[Certificate] DeployAutoDeployCertificates: GetRemoteServer(%d) failed: %v", serverID, err)
		return
	}

	for _, cert := range certs {
		payload := WSCertDeployPayload{
			Domain:   cert.Domain,
			CertPEM:  cert.CertPEM,
			KeyPEM:   cert.KeyPEM,
			CertPath: filepath.Join(filepath.Dir(cert.DeployCertPath), certDeployFilename(cert.Domain)+filepath.Ext(cert.DeployCertPath)),
			KeyPath:  filepath.Join(filepath.Dir(cert.DeployKeyPath), certDeployFilename(cert.Domain)+filepath.Ext(cert.DeployKeyPath)),
			Reload:   "both",
		}
		go h.deployToRemoteServer(server, payload)
	}
	log.Printf("[Certificate] Triggered auto-deploy of %d cert(s) to server %s", len(certs), server.Name)
}

// --- DNS 提供商 API 处理程序 ---

// DNSProviderRequest 表示 DNS 提供商创建/更新请求。
type DNSProviderRequest struct {
	Name         string `json:"name"`
	ProviderType string `json:"provider_type"`
	Credentials  string `json:"credentials"` // JSON 字符串
}

// 处理 GET /api/admin/dns-providers
func (h *CertificateHandler) ListDNSProviders(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	providers, err := h.repo.ListDNSProviders(ctx)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": "获取DNS提供商列表失败"})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"success": true, "providers": providers})
}

// 处理 POST /api/admin/dns-providers
func (h *CertificateHandler) CreateDNSProvider(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	var req DNSProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的请求数据"})
		return
	}

	if req.Name == "" || req.ProviderType == "" || req.Credentials == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "名称、类型和凭证不能为空"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	p := &storage.DNSProvider{
		Name:         req.Name,
		ProviderType: req.ProviderType,
		Credentials:  req.Credentials,
	}

	if err := h.repo.CreateDNSProvider(ctx, p); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("创建DNS提供商失败: %v", err)})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"success": true, "provider": p})
}

// 处理 PUT /api/admin/dns-providers/{id}
func (h *CertificateHandler) UpdateDNSProvider(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/admin/dns-providers/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的ID"})
		return
	}

	var req DNSProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的请求数据"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	p := &storage.DNSProvider{
		ID:           id,
		Name:         req.Name,
		ProviderType: req.ProviderType,
		Credentials:  req.Credentials,
	}

	if err := h.repo.UpdateDNSProvider(ctx, p); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("更新DNS提供商失败: %v", err)})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"success": true, "message": "更新成功"})
}

// 处理 DELETE /api/admin/dns-providers/{id}
func (h *CertificateHandler) DeleteDNSProvider(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "管理员权限不足"})
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/admin/dns-providers/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的ID"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := h.repo.DeleteDNSProvider(ctx, id); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("删除DNS提供商失败: %v", err)})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"success": true, "message": "删除成功"})
}

// UploadCertificate 处理手动上传证书（UI 和 API Token 均可调用）。
// POST /api/admin/certificates/upload
// 参数: domain, cert_pem (base64), key_pem (base64)
func (h *CertificateHandler) UploadCertificate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondJSON(w, http.StatusMethodNotAllowed, map[string]any{"success": false, "message": "Method not allowed"})
		return
	}
	if !h.requireAdmin(r) {
		respondJSON(w, http.StatusForbidden, map[string]any{"success": false, "message": "权限不足"})
		return
	}

	var req struct {
		Domain  string `json:"domain"`
		CertPEM string `json:"cert_pem"`
		KeyPEM  string `json:"key_pem"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "请求格式错误"})
		return
	}

	req.Domain = strings.TrimSpace(req.Domain)
	if req.Domain == "" || req.CertPEM == "" || req.KeyPEM == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "domain、cert_pem、key_pem 不能为空"})
		return
	}

	certBytes, err := base64.StdEncoding.DecodeString(req.CertPEM)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "cert_pem base64 解码失败"})
		return
	}
	keyBytes, err := base64.StdEncoding.DecodeString(req.KeyPEM)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "key_pem base64 解码失败"})
		return
	}

	result, err := h.acmeClient.ProcessCertResult(req.Domain, certBytes, keyBytes)
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": fmt.Sprintf("证书处理失败: %v", err)})
		return
	}

	deployCertPath, deployKeyPath := certDeployPaths(req.Domain, "/usr/local/nginx/cert")

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	existing, err := h.repo.GetCertificateByDomain(ctx, req.Domain, 0)
	if err == nil && existing != nil {
		if err := h.repo.UpdateCertificateIssued(ctx, existing.ID, result.CertPath, result.KeyPath, result.CertPEM, result.KeyPEM, result.IssueDate, result.ExpiryDate); err != nil {
			respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("更新证书失败: %v", err)})
			return
		}
		if existing.DeployCertPath == "" {
			existing.DeployCertPath = deployCertPath
			existing.DeployKeyPath = deployKeyPath
			_ = h.repo.UpdateCertificate(ctx, existing)
		}
		h.checkMasterCertReady(existing)
		respondJSON(w, http.StatusOK, map[string]any{"success": true, "message": "证书已更新", "certificate_id": existing.ID})
		return
	}

	cert := &storage.Certificate{
		Domain:         req.Domain,
		Email:          auth.UsernameFromContext(r.Context()) + "@upload",
		Provider:       "manual",
		Status:         storage.CertStatusPending,
		AutoRenew:      false,
		ChallengeMode:  "manual",
		DeployTarget:   "none",
		DeployCertPath: deployCertPath,
		DeployKeyPath:  deployKeyPath,
	}

	if err := h.repo.CreateCertificate(ctx, cert); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "message": fmt.Sprintf("创建证书记录失败: %v", err)})
		return
	}

	if err := h.repo.UpdateCertificateIssued(ctx, cert.ID, result.CertPath, result.KeyPath, result.CertPEM, result.KeyPEM, result.IssueDate, result.ExpiryDate); err != nil {
		log.Printf("[Certificate] UpdateCertificateIssued after upload failed: %v", err)
	}

	h.checkMasterCertReady(cert)

	respondJSON(w, http.StatusOK, map[string]any{"success": true, "message": "证书上传成功", "certificate_id": cert.ID})
}
