package handler

import (
	"crypto/ecdh"
	"crypto/mlkem"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type XrayKeyGeneratorHandler struct{}

func NewXrayKeyGeneratorHandler() *XrayKeyGeneratorHandler {
	return &XrayKeyGeneratorHandler{}
}

type GenerateKeysRequest struct {
	Type           string `json:"type"`
	EncryptionType string `json:"encryptionType"` // "x25519"或"mlkem768"
	Appearance     string `json:"appearance"`
	TicketLifetime string `json:"ticketLifetime"`
	Padding        string `json:"padding"`
}

type GenerateKeysResponse struct {
	DecryptionConfig string `json:"decryptionConfig"`
	Encryption       string `json:"encryption"`
}

// 纯 Go 实现，与 xray vlessenc 输出格式一致
func (h *XrayKeyGeneratorHandler) GenerateKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req GenerateKeysRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Type != "mlkem768x25519plus" {
		http.Error(w, "Invalid encryption type", http.StatusBadRequest)
		return
	}
	if req.EncryptionType != "x25519" && req.EncryptionType != "mlkem768" {
		http.Error(w, "Invalid encryptionType, must be 'x25519' or 'mlkem768'", http.StatusBadRequest)
		return
	}

	var serverKey, clientKey string

	if req.EncryptionType == "x25519" {
		privBytes, pubBytes, err := genX25519Pair()
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to generate x25519 keys: %v", err), http.StatusInternalServerError)
			return
		}
		serverKey = base64.RawURLEncoding.EncodeToString(privBytes)
		clientKey = base64.RawURLEncoding.EncodeToString(pubBytes)
	} else {
		var seed [64]byte
		if _, err := rand.Read(seed[:]); err != nil {
			http.Error(w, fmt.Sprintf("Failed to generate random seed: %v", err), http.StatusInternalServerError)
			return
		}
		dk, err := mlkem.NewDecapsulationKey768(seed[:])
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to generate ML-KEM-768 keys: %v", err), http.StatusInternalServerError)
			return
		}
		serverKey = base64.RawURLEncoding.EncodeToString(seed[:])
		clientKey = base64.RawURLEncoding.EncodeToString(dk.EncapsulationKey().Bytes())
	}

	response := GenerateKeysResponse{
		DecryptionConfig: strings.Join([]string{"mlkem768x25519plus", "native", "600s", serverKey}, "."),
		Encryption:       strings.Join([]string{"mlkem768x25519plus", "native", "0rtt", clientKey}, "."),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

type GenerateX25519Response struct {
	PrivateKey string `json:"privateKey"`
	PublicKey  string `json:"publicKey"`
}

// 纯 Go 实现，与 xray x25519 输出格式一致
func (h *XrayKeyGeneratorHandler) GenerateX25519(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	privBytes, pubBytes, err := genX25519Pair()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate x25519 keys: %v", err), http.StatusInternalServerError)
		return
	}

	response := GenerateX25519Response{
		PrivateKey: base64.RawURLEncoding.EncodeToString(privBytes),
		PublicKey:  base64.RawURLEncoding.EncodeToString(pubBytes),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// genX25519Pair 生成 X25519 密钥对，与 Xray genCurve25519 逻辑一致（含 clamping）
func genX25519Pair() (privateKey, publicKey []byte, err error) {
	privateKey = make([]byte, 32)
	if _, err = rand.Read(privateKey); err != nil {
		return
	}
	privateKey[0] &= 248
	privateKey[31] &= 127
	privateKey[31] |= 64

	key, err := ecdh.X25519().NewPrivateKey(privateKey)
	if err != nil {
		return
	}
	publicKey = key.PublicKey().Bytes()
	return
}
