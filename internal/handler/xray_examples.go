package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type XrayExamplesHandler struct {
	examplesPath string
}

func NewXrayExamplesHandler(examplesPath string) *XrayExamplesHandler {
	return &XrayExamplesHandler{
		examplesPath: examplesPath,
	}
}

// ProtocolCombination 表示协议、传输和安全组合
type ProtocolCombination struct {
	DirName   string                 `json:"dir_name"`   // 原目录名
	Protocol  string                 `json:"protocol"`   // vless、vmess、木马等
	Transport string                 `json:"transport"`  // tcp、ws、grpc 等
	Security  string                 `json:"security"`   // tls、xtls、现实、nginx、球童、无
	Config    map[string]interface{} `json:"config"`     // 解析的 config_server.jsonc
	HasConfig bool                   `json:"has_config"` // config_server.jsonc是否存在
}

// GetProtocolCombinationsResponse 是响应结构
type GetProtocolCombinationsResponse struct {
	Success      bool                  `json:"success"`
	Combinations []ProtocolCombination `json:"combinations"`
}

// 扫描 Xray-examples 目录并返回所有协议组合
func (h *XrayExamplesHandler) HandleGetProtocolCombinations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	combinations, err := h.scanExamplesDirectory()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to scan examples: %v", err), http.StatusInternalServerError)
		return
	}

	response := GetProtocolCombinationsResponse{
		Success:      true,
		Combinations: combinations,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// 扫描 Xray-examples 目录并解析所有组合
func (h *XrayExamplesHandler) scanExamplesDirectory() ([]ProtocolCombination, error) {
	var combinations []ProtocolCombination

	// 读取目录条目
	entries, err := os.ReadDir(h.examplesPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read examples directory: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		dirName := entry.Name()

		// 跳过特殊目录
		if strings.HasPrefix(dirName, ".") ||
			dirName == "ReverseProxy" ||
			dirName == "All-in-One-fallbacks-Nginx" ||
			dirName == "MITM-Domain-Fronting" ||
			dirName == "Serverless-for-Iran" {
			continue
		}

		combination := h.parseDirName(dirName)
		combination.DirName = dirName

		// 尝试读取config_server.jsonc
		configPath := filepath.Join(h.examplesPath, dirName, "config_server.jsonc")
		config, hasConfig := h.readConfig(configPath)
		combination.Config = config
		combination.HasConfig = hasConfig

		combinations = append(combinations, combination)
	}

	return combinations, nil
}

// 解析目录名以提取协议、传输和安全性
func (h *XrayExamplesHandler) parseDirName(dirName string) ProtocolCombination {
	// 删除括号中的所有内容并修剪
	cleanName := dirName
	if idx := strings.Index(cleanName, "("); idx != -1 {
		cleanName = strings.TrimSpace(cleanName[:idx])
	}

	parts := strings.Split(cleanName, "-")

	combination := ProtocolCombination{}

	if len(parts) >= 1 {
		combination.Protocol = strings.ToLower(parts[0])
	}

	if len(parts) >= 2 {
		combination.Transport = strings.ToLower(parts[1])
	}

	if len(parts) >= 3 {
		securityPart := strings.ToLower(parts[2])
		if strings.Contains(securityPart, "nginx") || strings.Contains(securityPart, "caddy") {
			combination.Security = "none" // Nginx/Caddy 表示外部代理，无 Xray 安全性
		} else {
			combination.Security = securityPart
		}
	} else {
		combination.Security = "none"
	}

	return combination
}

// 读取并解析 config_server.jsonc 文件
func (h *XrayExamplesHandler) readConfig(configPath string) (map[string]interface{}, bool) {
	file, err := os.Open(configPath)
	if err != nil {
		return nil, false
	}
	defer file.Close()

	// 读取文件
	content, err := io.ReadAll(file)
	if err != nil {
		return nil, false
	}

	// 删除 JSONC 注释（简单方法 - 只需删除 // 注释）
	lines := strings.Split(string(content), "\n")
	var cleanedLines []string
	for _, line := range lines {
		// 删除单行注释
		if idx := strings.Index(line, "//"); idx != -1 {
			line = line[:idx]
		}
		cleanedLines = append(cleanedLines, line)
	}
	cleanedContent := strings.Join(cleanedLines, "\n")

	// 解析 JSON
	var config map[string]interface{}
	if err := json.Unmarshal([]byte(cleanedContent), &config); err != nil {
		return nil, false
	}

	return config, true
}
