package acme

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/go-acme/lego/v4/certcrypto"
	"github.com/go-acme/lego/v4/certificate"
	"github.com/go-acme/lego/v4/challenge/dns01"
	"github.com/go-acme/lego/v4/challenge/http01"
	"github.com/go-acme/lego/v4/lego"
	"github.com/go-acme/lego/v4/registration"
)

// CertResult表示证书颁发的结果。
type CertResult struct {
	Domain     string
	CertPath   string
	KeyPath    string
	CertPEM    string
	KeyPEM     string
	IssueDate  time.Time
	ExpiryDate time.Time
}

// CertRequest 包含证书请求的所有参数。
type CertRequest struct {
	Email          string
	Domain         string
	Provider       string // CA 提供商名称（letsencrypt、zerossl、buypass）
	ChallengeMode  string // 独立、webroot、dns
	WebrootPath    string
	DNSProvider    string            // DNS-01 的 DNS 提供商类型（cloudflare、alidns 等）
	DNSCredentials map[string]string // DNS API 凭据
	EABKid         string            // 外部帐户绑定密钥 ID（用于 ZeroSSL 等）
	EABHmacKey     string            // 外部账户绑定HMAC密钥
}

// User 实现了乐高的 acme.User 接口。
type User struct {
	Email        string
	Registration *registration.Resource
	key          *rsa.PrivateKey
}

func (u *User) GetEmail() string                        { return u.Email }
func (u *User) GetRegistration() *registration.Resource { return u.Registration }
func (u *User) GetPrivateKey() crypto.PrivateKey        { return u.key }

// 客户端包装了乐高 ACME 客户端。
type Client struct {
	certDir    string
	staging    bool
	httpPort   string
	webrootDir string
}

// ClientOption 配置客户端。
type ClientOption func(*Client)

// 设置证书存储目录。
func WithCertDir(dir string) ClientOption {
	return func(c *Client) { c.certDir = dir }
}

// 启用暂存环境。
func WithStaging(staging bool) ClientOption {
	return func(c *Client) { c.staging = staging }
}

// 设置 HTTP-01 质询的端口（默认值：“:80”）。
func WithHTTPPort(port string) ClientOption {
	return func(c *Client) { c.httpPort = port }
}

// 设置 webroot 挑战模式的 webroot 目录。
func WithWebrootDir(dir string) ClientOption {
	return func(c *Client) { c.webrootDir = dir }
}

// 创建一个新的 ACME 客户端。
func NewClient(opts ...ClientOption) *Client {
	c := &Client{
		certDir:  "data/certs",
		staging:  false,
		httpPort: ":80",
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// acquireCertificate 请求新证书（仅向后兼容 HTTP-01）。
func (c *Client) ObtainCertificate(ctx context.Context, email, domain string, useWebroot bool) (*CertResult, error) {
	mode := "standalone"
	if useWebroot {
		mode = "webroot"
	}
	return c.ObtainCertificateV2(ctx, CertRequest{
		Email:         email,
		Domain:        domain,
		Provider:      CALetsEncrypt,
		ChallengeMode: mode,
		WebrootPath:   c.webrootDir,
	})
}

// GetCertificateV2 请求具有完整选项支持的新证书。
func (c *Client) ObtainCertificateV2(ctx context.Context, req CertRequest) (*CertResult, error) {
	if req.Email == "" {
		return nil, errors.New("email is required")
	}
	if req.Domain == "" {
		return nil, errors.New("domain is required")
	}

	client, err := c.buildLegoClient(req)
	if err != nil {
		return nil, err
	}

	// 索取证书
	obtainReq := certificate.ObtainRequest{
		Domains: []string{req.Domain},
		Bundle:  true,
	}

	certificates, err := client.Certificate.Obtain(obtainReq)
	if err != nil {
		return nil, fmt.Errorf("obtain certificate: %w", err)
	}

	return c.ProcessCertResult(req.Domain, certificates.Certificate, certificates.PrivateKey)
}

// 续订现有证书（向后兼容）。
func (c *Client) RenewCertificate(ctx context.Context, email, domain, certPEM, keyPEM string, useWebroot bool) (*CertResult, error) {
	mode := "standalone"
	if useWebroot {
		mode = "webroot"
	}
	return c.RenewCertificateV2(ctx, CertRequest{
		Email:         email,
		Domain:        domain,
		Provider:      CALetsEncrypt,
		ChallengeMode: mode,
		WebrootPath:   c.webrootDir,
	}, certPEM, keyPEM)
}

// 使用完整选项更新现有证书。
func (c *Client) RenewCertificateV2(ctx context.Context, req CertRequest, certPEM, keyPEM string) (*CertResult, error) {
	if certPEM == "" || keyPEM == "" {
		return c.ObtainCertificateV2(ctx, req)
	}

	client, err := c.buildLegoClient(req)
	if err != nil {
		return nil, err
	}

	certRes := &certificate.Resource{
		Domain:      req.Domain,
		Certificate: []byte(certPEM),
		PrivateKey:  []byte(keyPEM),
	}

	newCert, err := client.Certificate.Renew(*certRes, true, false, "")
	if err != nil {
		return nil, fmt.Errorf("renew certificate: %w", err)
	}

	return c.ProcessCertResult(req.Domain, newCert.Certificate, newCert.PrivateKey)
}

// 根据请求创建并配置乐高客户端。
func (c *Client) buildLegoClient(req CertRequest) (*lego.Client, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("generate private key: %w", err)
	}

	user := &User{Email: req.Email, key: privateKey}

	config := lego.NewConfig(user)
	provider := req.Provider
	if provider == "" {
		provider = CALetsEncrypt
	}
	config.CADirURL = ResolveCADirectoryURL(provider, c.staging)
	config.Certificate.KeyType = certcrypto.RSA2048

	client, err := lego.NewClient(config)
	if err != nil {
		return nil, fmt.Errorf("create lego client: %w", err)
	}

	// 设置挑战提供者
	switch req.ChallengeMode {
	case "dns":
		if err := c.setupDNSChallenge(client, req); err != nil {
			return nil, err
		}
	case "webroot":
		if err := c.setupWebrootChallenge(client, req); err != nil {
			return nil, err
		}
	default: // 独立的
		p := http01.NewProviderServer("", c.httpPort)
		if err := client.Challenge.SetHTTP01Provider(p); err != nil {
			return nil, fmt.Errorf("set http01 provider: %w", err)
		}
	}

	// 注册用户（如果需要，使用 EAB）
	if req.EABKid != "" && req.EABHmacKey != "" {
		reg, err := client.Registration.RegisterWithExternalAccountBinding(registration.RegisterEABOptions{
			TermsOfServiceAgreed: true,
			Kid:                  req.EABKid,
			HmacEncoded:          req.EABHmacKey,
		})
		if err != nil {
			return nil, fmt.Errorf("register with EAB: %w", err)
		}
		user.Registration = reg
	} else {
		reg, err := client.Registration.Register(registration.RegisterOptions{TermsOfServiceAgreed: true})
		if err != nil {
			return nil, fmt.Errorf("register with ACME: %w", err)
		}
		user.Registration = reg
	}

	return client, nil
}

func (c *Client) setupDNSChallenge(client *lego.Client, req CertRequest) error {
	if req.DNSProvider == "" {
		return errors.New("dns_provider is required for DNS-01 challenge")
	}

	// 为乐高 DNS 提供商设置环境变量
	if len(req.DNSCredentials) > 0 {
		cleanup, err := SetDNSCredentialEnv(req.DNSProvider, req.DNSCredentials)
		if err != nil {
			return fmt.Errorf("set DNS credentials: %w", err)
		}
		// 注意：清理延迟 - 环境变量在请求期间持续存在。
		// 这是可以接受的，因为证书操作是按域序列化的。
		defer cleanup()
	}

	provider, err := NewDNSProviderByName(req.DNSProvider)
	if err != nil {
		return fmt.Errorf("create DNS provider %s: %w", req.DNSProvider, err)
	}

	if err := client.Challenge.SetDNS01Provider(provider,
		dns01.PropagationWait(20*time.Second, true),
	); err != nil {
		return fmt.Errorf("set DNS-01 provider: %w", err)
	}
	return nil
}

func (c *Client) setupWebrootChallenge(client *lego.Client, req CertRequest) error {
	webrootDir := req.WebrootPath
	if webrootDir == "" {
		webrootDir = c.webrootDir
	}
	if webrootDir == "" {
		return errors.New("webroot_path is required for webroot challenge")
	}
	provider, err := NewWebrootProvider(webrootDir)
	if err != nil {
		return fmt.Errorf("create webroot provider: %w", err)
	}
	if err := client.Challenge.SetHTTP01Provider(provider); err != nil {
		return fmt.Errorf("set webroot provider: %w", err)
	}
	return nil
}

func (c *Client) ProcessCertResult(domain string, certPEMBytes, keyPEMBytes []byte) (*CertResult, error) {
	expiryDate, issueDate, err := parseCertificateDates(certPEMBytes)
	if err != nil {
		return nil, fmt.Errorf("parse certificate: %w", err)
	}

	certPath, keyPath, err := c.saveCertificate(domain, certPEMBytes, keyPEMBytes)
	if err != nil {
		return nil, fmt.Errorf("save certificate: %w", err)
	}

	return &CertResult{
		Domain:     domain,
		CertPath:   certPath,
		KeyPath:    keyPath,
		CertPEM:    string(certPEMBytes),
		KeyPEM:     string(keyPEMBytes),
		IssueDate:  issueDate,
		ExpiryDate: expiryDate,
	}, nil
}

func (c *Client) saveCertificate(domain string, certPEM, keyPEM []byte) (string, string, error) {
	domainDir := filepath.Join(c.certDir, domain)
	if err := os.MkdirAll(domainDir, 0700); err != nil {
		return "", "", fmt.Errorf("create cert directory: %w", err)
	}

	certPath := filepath.Join(domainDir, "fullchain.pem")
	keyPath := filepath.Join(domainDir, "privkey.pem")

	if err := os.WriteFile(certPath, certPEM, 0644); err != nil {
		return "", "", fmt.Errorf("write certificate: %w", err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0600); err != nil {
		return "", "", fmt.Errorf("write private key: %w", err)
	}

	return certPath, keyPath, nil
}

func parseCertificateDates(certPEM []byte) (expiryDate, issueDate time.Time, err error) {
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return time.Time{}, time.Time{}, errors.New("failed to decode PEM block")
	}

	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("parse certificate: %w", err)
	}

	return cert.NotAfter, cert.NotBefore, nil
}

// 返回证书存储目录。
func (c *Client) GetCertDir() string {
	return c.certDir
}
