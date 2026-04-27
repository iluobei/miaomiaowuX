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

type RuleTemplatesHandler struct{}

func NewRuleTemplatesHandler() *RuleTemplatesHandler {
	return &RuleTemplatesHandler{}
}

func (h *RuleTemplatesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 删除 /api/rule-templates 前缀
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/rule-templates")

	switch {
	case path == "" || path == "/":
		// 列出模板
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.handleListTemplates(w, r)
	case path == "/upload":
		// 上传模板
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.handleUploadTemplate(w, r)
	case path == "/rename":
		// 重命名模板
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.handleRenameTemplate(w, r)
	default:
		// 从路径中提取模板名称（删除前导斜杠）
		templateName := strings.TrimPrefix(path, "/")

		switch r.Method {
		case http.MethodGet:
			// 获取具体模板内容
			h.handleGetTemplate(w, r, templateName)
		case http.MethodPut:
			// 更新模板内容
			h.handleUpdateTemplate(w, r, templateName)
		case http.MethodDelete:
			// 删除模板
			h.handleDeleteTemplate(w, r, templateName)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func (h *RuleTemplatesHandler) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	templatesDir := "rule_templates"

	// 读取目录
	entries, err := os.ReadDir(templatesDir)
	if err != nil {
		http.Error(w, "Failed to read templates directory", http.StatusInternalServerError)
		return
	}

	// 过滤 YAML 文件
	var templates []string
	for _, entry := range entries {
		if !entry.IsDir() && (strings.HasSuffix(entry.Name(), ".yaml") || strings.HasSuffix(entry.Name(), ".yml")) {
			templates = append(templates, entry.Name())
		}
	}

	// 返回 JSON 响应
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"templates": templates,
	})
}

func (h *RuleTemplatesHandler) handleGetTemplate(w http.ResponseWriter, r *http.Request, templateName string) {
	// 安全性：防止目录遍历
	if strings.Contains(templateName, "..") || strings.Contains(templateName, "/") || strings.Contains(templateName, "\\") {
		http.Error(w, "Invalid template name", http.StatusBadRequest)
		return
	}

	templatesDir := "rule_templates"
	templatePath := filepath.Join(templatesDir, templateName)

	// 检查文件是否存在
	if _, err := os.Stat(templatePath); os.IsNotExist(err) {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}

	// 读取文件内容
	content, err := os.ReadFile(templatePath)
	if err != nil {
		http.Error(w, "Failed to read template", http.StatusInternalServerError)
		return
	}

	// 返回包含内容的 JSON 响应
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"content": string(content),
	})
}

func (h *RuleTemplatesHandler) handleUpdateTemplate(w http.ResponseWriter, r *http.Request, templateName string) {
	// 安全性：防止目录遍历
	if strings.Contains(templateName, "..") || strings.Contains(templateName, "/") || strings.Contains(templateName, "\\") {
		http.Error(w, "Invalid template name", http.StatusBadRequest)
		return
	}

	templatesDir := "rule_templates"
	templatePath := filepath.Join(templatesDir, templateName)

	// 检查文件是否存在
	if _, err := os.Stat(templatePath); os.IsNotExist(err) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "模板文件不存在",
		})
		return
	}

	// 解析请求体
	var payload struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 将内容写入文件
	if err := os.WriteFile(templatePath, []byte(payload.Content), 0644); err != nil {
		http.Error(w, "Failed to save template", http.StatusInternalServerError)
		return
	}

	// 返回成功响应
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "模板保存成功",
	})
}

func (h *RuleTemplatesHandler) handleDeleteTemplate(w http.ResponseWriter, r *http.Request, templateName string) {
	// 安全性：防止目录遍历
	if strings.Contains(templateName, "..") || strings.Contains(templateName, "/") || strings.Contains(templateName, "\\") {
		http.Error(w, "Invalid template name", http.StatusBadRequest)
		return
	}

	templatesDir := "rule_templates"
	templatePath := filepath.Join(templatesDir, templateName)

	// 检查文件是否存在
	if _, err := os.Stat(templatePath); os.IsNotExist(err) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "模板文件不存在",
		})
		return
	}

	// 删除文件
	if err := os.Remove(templatePath); err != nil {
		http.Error(w, "Failed to delete template", http.StatusInternalServerError)
		return
	}

	// 返回成功响应
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "模板删除成功",
	})
}

func (h *RuleTemplatesHandler) handleRenameTemplate(w http.ResponseWriter, r *http.Request) {
	// 解析请求体
	var payload struct {
		OldName string `json:"old_name"`
		NewName string `json:"new_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	oldName := strings.TrimSpace(payload.OldName)
	newName := strings.TrimSpace(payload.NewName)

	// 验证姓名
	if oldName == "" || newName == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "文件名不能为空",
		})
		return
	}

	// 安全性：防止目录遍历
	if strings.Contains(oldName, "..") || strings.Contains(oldName, "/") || strings.Contains(oldName, "\\") ||
		strings.Contains(newName, "..") || strings.Contains(newName, "/") || strings.Contains(newName, "\\") {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}

	// 确保新名称具有 .yaml 或 .yml 扩展名
	if !strings.HasSuffix(newName, ".yaml") && !strings.HasSuffix(newName, ".yml") {
		newName = newName + ".yaml"
	}

	templatesDir := "rule_templates"
	oldPath := filepath.Join(templatesDir, oldName)
	newPath := filepath.Join(templatesDir, newName)

	// 检查旧文件是否存在
	if _, err := os.Stat(oldPath); os.IsNotExist(err) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "原文件不存在",
		})
		return
	}

	// 检查新文件是否已存在
	if _, err := os.Stat(newPath); err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "目标文件名已存在",
		})
		return
	}

	// 重命名文件
	if err := os.Rename(oldPath, newPath); err != nil {
		http.Error(w, "Failed to rename template", http.StatusInternalServerError)
		return
	}

	// 返回成功响应
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":  "模板重命名成功",
		"filename": newName,
	})
}

func (h *RuleTemplatesHandler) handleUploadTemplate(w http.ResponseWriter, r *http.Request) {
	// 解析多部分表单（限制为 10MB）
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "Failed to parse form data", http.StatusBadRequest)
		return
	}

	// 从表单中获取文件
	file, header, err := r.FormFile("template")
	if err != nil {
		http.Error(w, "Failed to get file from request", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// 验证文件扩展名
	filename := header.Filename
	if !strings.HasSuffix(filename, ".yaml") && !strings.HasSuffix(filename, ".yml") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "只支持 .yaml 或 .yml 文件",
		})
		return
	}

	// 安全性：清理文件名
	filename = filepath.Base(filename)
	if strings.Contains(filename, "..") {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}

	// 如果不存在则创建模板目录
	templatesDir := "rule_templates"
	if err := os.MkdirAll(templatesDir, 0755); err != nil {
		http.Error(w, "Failed to create templates directory", http.StatusInternalServerError)
		return
	}

	// 创建目标文件
	templatePath := filepath.Join(templatesDir, filename)

	// 检查文件是否已经存在
	if _, err := os.Stat(templatePath); err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": fmt.Sprintf("模板文件 %s 已存在", filename),
		})
		return
	}

	dst, err := os.Create(templatePath)
	if err != nil {
		http.Error(w, "Failed to create template file", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	// 复制文件内容
	if _, err := io.Copy(dst, file); err != nil {
		// 清理错误
		os.Remove(templatePath)
		http.Error(w, "Failed to save template file", http.StatusInternalServerError)
		return
	}

	// 返回带有文件名的成功响应
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"filename": filename,
		"message":  "模板上传成功",
	})
}
