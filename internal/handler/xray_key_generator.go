package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
)

type XrayKeyGeneratorHandler struct{}

func NewXrayKeyGeneratorHandler() *XrayKeyGeneratorHandler {
	return &XrayKeyGeneratorHandler{}
}

type GenerateKeysRequest struct {
	Type           string `json:"type"`
	EncryptionType string `json:"encryptionType"` // “x25519”或“mlkem768”
	Appearance     string `json:"appearance"`
	TicketLifetime string `json:"ticketLifetime"`
	Padding        string `json:"padding"`
}

type GenerateKeysResponse struct {
	DecryptionConfig string `json:"decryptionConfig"`
	Encryption       string `json:"encryption"`
}

// 处理 VLESS 后量子加密的密钥生成
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

	// 验证类型
	if req.Type != "mlkem768x25519plus" {
		http.Error(w, "Invalid encryption type", http.StatusBadRequest)
		return
	}

	// 验证加密类型
	if req.EncryptionType != "x25519" && req.EncryptionType != "mlkem768" {
		http.Error(w, "Invalid encryptionType, must be 'x25519' or 'mlkem768'", http.StatusBadRequest)
		return
	}

	// 使用 xray vlessenc 生成 VLESS 加密密钥
	vlessencCmd := exec.Command("xray", "vlessenc")
	vlessencOutput, err := vlessencCmd.CombinedOutput()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate vless encryption keys: %v", err), http.StatusInternalServerError)
		return
	}

	// 解析输出以提取解密和加密值
	// 输出格式：
	// 认证：X25519，非后量子
	// “解密”：“mlkem768x25519plus.native.600s.xxx”
	// “加密”：“mlkem768x25519plus.native.0rtt.yyy”
	//
	// 认证：ML-KEM-768，后量子
	// “解密”：“mlkem768x25519plus.native.600s.zzz”
	// “加密”：“mlkem768x25519plus.native.0rtt.www”

	lines := strings.Split(string(vlessencOutput), "\n")
	var decryption, encryption string
	inTargetSection := false

	for _, line := range lines {
		line = strings.TrimSpace(line)

		// 检查我们是否处于目标身份验证部分
		if req.EncryptionType == "x25519" && strings.Contains(line, "Authentication: X25519") {
			inTargetSection = true
			continue
		} else if req.EncryptionType == "mlkem768" && strings.Contains(line, "Authentication: ML-KEM-768") {
			inTargetSection = true
			continue
		}

		// 如果我们位于目标部分，请提取值
		if inTargetSection {
			// 检查解密行：“decryption”：“value”
			if strings.HasPrefix(line, `"decryption":`) {
				// 提取冒号后引号之间的值
				// 格式：“解密”：“值”
				parts := strings.SplitN(line, `"`, 5)
				if len(parts) >= 4 {
					decryption = parts[3]
				}
			} else if strings.HasPrefix(line, `"encryption":`) {
				// 提取冒号后引号之间的值
				// 格式：“加密”：“值”
				parts := strings.SplitN(line, `"`, 5)
				if len(parts) >= 4 {
					encryption = parts[3]
				}
				// 我们已经得到了两个值，停止解析
				break
			} else if strings.Contains(line, "Authentication:") && (decryption != "" || encryption != "") {
				// 点击下一个身份验证部分，如果有任何数据则停止
				break
			}
		}
	}

	if decryption == "" || encryption == "" {
		http.Error(w, fmt.Sprintf("Failed to parse vlessenc output: decryption=%s, encryption=%s", decryption, encryption), http.StatusInternalServerError)
		return
	}

	response := GenerateKeysResponse{
		DecryptionConfig: decryption,
		Encryption:       encryption,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

type GenerateX25519Response struct {
	PrivateKey string `json:"privateKey"`
	PublicKey  string `json:"publicKey"`
}

// 处理为 REALITY/XTLS 生成 x25519 私钥/公钥
func (h *XrayKeyGeneratorHandler) GenerateX25519(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 生成 X25519 密钥
	x25519Cmd := exec.Command("xray", "x25519")
	x25519Output, err := x25519Cmd.CombinedOutput()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate x25519 keys: %v", err), http.StatusInternalServerError)
		return
	}

	// 解析 X25519 输出以提取私钥和公钥
	// 输出格式：私钥：xxx\n密码：xxx\nHash32：xxx
	lines := strings.Split(string(x25519Output), "\n")
	var privateKey, publicKey string
	for _, line := range lines {
		if strings.HasPrefix(line, "PrivateKey:") {
			privateKey = strings.TrimSpace(strings.TrimPrefix(line, "PrivateKey:"))
		} else if strings.HasPrefix(line, "Password (PublicKey):") {
			publicKey = strings.TrimSpace(strings.TrimPrefix(line, "Password (PublicKey):"))
		} else if strings.HasPrefix(line, "Password:") {
			publicKey = strings.TrimSpace(strings.TrimPrefix(line, "Password:"))
		}
	}

	if privateKey == "" || publicKey == "" {
		http.Error(w, fmt.Sprintf("Failed to parse x25519 keys: output=%s", string(x25519Output)), http.StatusInternalServerError)
		return
	}

	response := GenerateX25519Response{
		PrivateKey: privateKey,
		PublicKey:  publicKey,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
