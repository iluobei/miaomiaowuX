package handler

import (
	"encoding/base64"
	"io"
	"log"
	"net/http"
	"strings"
	"sync/atomic"

	"miaomiaowux/internal/securechan"
)

// CryptoConfig 统一加密配置，所有 handler 共享同一个实例
type CryptoConfig struct {
	Identity     *securechan.MasterIdentity
	SessionCache *securechan.SessionCache
	reqEnc       atomic.Bool
}

func NewCryptoConfig(identity *securechan.MasterIdentity, cache *securechan.SessionCache) *CryptoConfig {
	return &CryptoConfig{Identity: identity, SessionCache: cache}
}

func (c *CryptoConfig) RequireEncryption() bool  { return c.reqEnc.Load() }
func (c *CryptoConfig) SetRequireEncryption(v bool) { c.reqEnc.Store(v) }

// httpCryptoResult 包含 HTTP 加密中间件处理结果
type httpCryptoResult struct {
	Body    []byte
	Session *securechan.Session
	Token   string
}

// handleHTTPCrypto 处理 HTTP 请求的加密协商和解密。
// 返回解密后的 body 和 session（用于加密响应）。
func handleHTTPCrypto(r *http.Request, w http.ResponseWriter, cc *CryptoConfig) (*httpCryptoResult, error) {
	token := extractToken(r)
	body, _ := io.ReadAll(r.Body)

	identity := cc.Identity
	cache := cc.SessionCache

	// 1. 密钥交换请求
	if kxHeader := r.Header.Get("X-Key-Exchange"); kxHeader != "" && identity != nil {
		agentEphPub, err := base64.StdEncoding.DecodeString(kxHeader)
		if err != nil || len(agentEphPub) != 32 {
			http.Error(w, `{"success":false,"error":"invalid key exchange"}`, http.StatusBadRequest)
			return nil, err
		}

		masterEphPriv, masterEphPub, err := securechan.GenerateEphemeral()
		if err != nil {
			http.Error(w, `{"success":false,"error":"key generation failed"}`, http.StatusInternalServerError)
			return nil, err
		}

		sharedSecret, err := securechan.ComputeSharedSecret(masterEphPriv, agentEphPub)
		if err != nil {
			http.Error(w, `{"success":false,"error":"ECDH failed"}`, http.StatusInternalServerError)
			return nil, err
		}

		session, err := securechan.DeriveSession(sharedSecret, agentEphPub, masterEphPub, true)
		if err != nil {
			http.Error(w, `{"success":false,"error":"session derivation failed"}`, http.StatusInternalServerError)
			return nil, err
		}

		sig := securechan.Sign(identity.PrivateKey, masterEphPub)
		w.Header().Set("X-Key-Exchange", base64.StdEncoding.EncodeToString(masterEphPub)+"|"+base64.StdEncoding.EncodeToString(sig))

		if token != "" {
			cache.Set(token, session)
		}

		log.Printf("[HTTP Crypto] Key exchange completed for token %s...%s", safePrefix(token, 8), safeSuffix(token, 4))

		// 密钥交换阶段，响应用明文返回（Agent 尚未建立 session）
		return &httpCryptoResult{Body: body, Session: nil, Token: token}, nil
	}

	// 2. 加密请求
	if r.Header.Get("X-Encrypted") == "1" && token != "" {
		session := cache.Get(token)
		if session == nil {
			http.Error(w, `{"success":false,"error":"no session, re-negotiate"}`, http.StatusPreconditionFailed)
			return nil, nil
		}

		plaintext, err := session.Decrypt(body)
		if err != nil {
			http.Error(w, `{"success":false,"error":"decrypt failed"}`, http.StatusBadRequest)
			return nil, err
		}

		return &httpCryptoResult{Body: plaintext, Session: session, Token: token}, nil
	}

	// 3. 明文请求
	if cc.RequireEncryption() && identity != nil {
		http.Error(w, `{"success":false,"error":"encryption required"}`, http.StatusForbidden)
		return nil, nil
	}

	return &httpCryptoResult{Body: body, Token: token}, nil
}

// writeHTTPCryptoResponse 写入可能加密的 HTTP 响应
func writeHTTPCryptoResponse(w http.ResponseWriter, session *securechan.Session, data []byte) {
	if session != nil {
		encrypted, err := session.Encrypt(data)
		if err == nil {
			w.Header().Set("X-Encrypted", "1")
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Write(encrypted)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func extractToken(r *http.Request) string {
	if token := r.Header.Get("X-Remote-Token"); token != "" {
		return token
	}
	auth := r.Header.Get("Authorization")
	if after, ok := strings.CutPrefix(auth, "Bearer "); ok {
		return after
	}
	return ""
}

func safePrefix(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func safeSuffix(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}
