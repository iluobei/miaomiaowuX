package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"miaomiaowu/internal/storage"
	"miaomiaowu/internal/substore"
)

type templateRequest struct {
	Name             string `json:"name"`
	Category         string `json:"category"`
	TemplateURL      string `json:"template_url"`
	RuleSource       string `json:"rule_source"`
	UseProxy         bool   `json:"use_proxy"`
	EnableIncludeAll bool   `json:"enable_include_all"`
}

type templateResponse struct {
	ID               int64  `json:"id"`
	Name             string `json:"name"`
	Category         string `json:"category"`
	TemplateURL      string `json:"template_url"`
	RuleSource       string `json:"rule_source"`
	UseProxy         bool   `json:"use_proxy"`
	EnableIncludeAll bool   `json:"enable_include_all"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

type convertRulesRequest struct {
	TemplateURL      string   `json:"template_url"`
	RuleSource       string   `json:"rule_source"`
	Category         string   `json:"category"`
	UseProxy         bool     `json:"use_proxy"`
	EnableIncludeAll bool     `json:"enable_include_all"`
	ProxyNames       []string `json:"proxy_names"` // 节点名称列表，用于显式填充 proxies 字段
}

type convertRulesResponse struct {
	Content string `json:"content"`
}

// 处理模板列表和创建操作
func NewTemplatesHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("templates handler requires repository")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handleListTemplates(w, r, repo)
		case http.MethodPost:
			handleCreateTemplate(w, r, repo)
		default:
			writeError(w, http.StatusMethodNotAllowed, errors.New("only GET and POST are supported"))
		}
	})
}

// 处理单个模板操作（GET、PUT、DELETE）
func NewTemplateHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("template handler requires repository")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 从 URL 路径中提取模板 ID
		path := strings.TrimPrefix(r.URL.Path, "/api/admin/templates/")
		idStr := strings.TrimSpace(path)
		if idStr == "" {
			writeError(w, http.StatusBadRequest, errors.New("template id is required"))
			return
		}

		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid template id"))
			return
		}

		switch r.Method {
		case http.MethodGet:
			handleGetTemplate(w, r, repo, id)
		case http.MethodPut:
			handleUpdateTemplate(w, r, repo, id)
		case http.MethodDelete:
			handleDeleteTemplate(w, r, repo, id)
		default:
			writeError(w, http.StatusMethodNotAllowed, errors.New("only GET, PUT and DELETE are supported"))
		}
	})
}

// 处理规则转换
func NewTemplateConvertHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
			return
		}

		var req convertRulesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if req.RuleSource == "" {
			writeError(w, http.StatusBadRequest, errors.New("rule_source is required"))
			return
		}

		if req.Category == "" {
			req.Category = "clash"
		}

		// 从 URL 获取模板内容
		var templateContent string
		if req.TemplateURL != "" {
			content, err := fetchRemoteContent(req.TemplateURL, 30*time.Second)
			if err != nil {
				writeError(w, http.StatusBadRequest, errors.New("failed to fetch template: "+err.Error()))
				return
			}
			templateContent = content
		}

		// 检测模板类型并验证
		detectedType := substore.DetectTemplateType(templateContent)
		if detectedType != "" && detectedType != req.Category {
			writeError(w, http.StatusBadRequest, errors.New("template type mismatch: detected "+detectedType+" but requested "+req.Category))
			return
		}

		// 如果为空则使用默认模板
		if strings.TrimSpace(templateContent) == "" {
			if req.Category == "surge" {
				templateContent = substore.GetDefaultSurgeTemplate()
			} else {
				templateContent = substore.GetDefaultClashTemplate()
			}
		}

		// 获取 ACL 配置
		aclContent, err := fetchRemoteContent(req.RuleSource, 30*time.Second)
		if err != nil {
			writeError(w, http.StatusBadRequest, errors.New("failed to fetch rule source: "+err.Error()))
			return
		}

		// 解析ACL配置
		rulesets, proxyGroups := substore.ParseACLConfig(aclContent)

		// 处理req.ProxyNames里的特殊字符
		// 对包含特殊字符的节点名称加上引号，避免 YAML 解析错误
		for i, name := range req.ProxyNames {
			needsQuote := strings.ContainsAny(name, ":#[],") || strings.HasPrefix(name, "@")
			if needsQuote {
				req.ProxyNames[i] = `"` + name + `"`
			}
		}

		// 根据类别生成代理组和规则
		var finalContent string
		if req.Category == "surge" {
			proxyGroupsStr := substore.GenerateSurgeProxyGroups(proxyGroups, req.EnableIncludeAll)
			rulesStr, err := substore.GenerateSurgeRules(rulesets)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			finalContent = substore.MergeToSurgeTemplate(templateContent, proxyGroupsStr, rulesStr)
		} else {
			proxyGroupsStr := substore.GenerateClashProxyGroups(proxyGroups, req.ProxyNames)
			rulesStr, providersStr, err := substore.GenerateClashRules(rulesets)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			finalContent = substore.MergeToClashTemplate(templateContent, proxyGroupsStr, rulesStr, providersStr)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(convertRulesResponse{Content: finalContent})
	})
}

func handleListTemplates(w http.ResponseWriter, r *http.Request, repo *storage.TrafficRepository) {
	templates, err := repo.ListTemplates(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	response := make([]templateResponse, 0, len(templates))
	for _, t := range templates {
		response = append(response, templateToResponse(t))
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"templates": response})
}

func handleGetTemplate(w http.ResponseWriter, r *http.Request, repo *storage.TrafficRepository, id int64) {
	t, err := repo.GetTemplateByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, storage.ErrTemplateNotFound) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(templateToResponse(t))
}

func handleCreateTemplate(w http.ResponseWriter, r *http.Request, repo *storage.TrafficRepository) {
	var req templateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	if strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusBadRequest, errors.New("name is required"))
		return
	}

	t := storage.Template{
		Name:             req.Name,
		Category:         req.Category,
		TemplateURL:      req.TemplateURL,
		RuleSource:       req.RuleSource,
		UseProxy:         req.UseProxy,
		EnableIncludeAll: req.EnableIncludeAll,
	}

	id, err := repo.CreateTemplate(r.Context(), t)
	if err != nil {
		if errors.Is(err, storage.ErrTemplateExists) {
			writeError(w, http.StatusConflict, err)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	created, _ := repo.GetTemplateByID(r.Context(), id)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(templateToResponse(created))
}

func handleUpdateTemplate(w http.ResponseWriter, r *http.Request, repo *storage.TrafficRepository, id int64) {
	var req templateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	if strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusBadRequest, errors.New("name is required"))
		return
	}

	t := storage.Template{
		ID:               id,
		Name:             req.Name,
		Category:         req.Category,
		TemplateURL:      req.TemplateURL,
		RuleSource:       req.RuleSource,
		UseProxy:         req.UseProxy,
		EnableIncludeAll: req.EnableIncludeAll,
	}

	if err := repo.UpdateTemplate(r.Context(), t); err != nil {
		if errors.Is(err, storage.ErrTemplateNotFound) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, storage.ErrTemplateExists) {
			writeError(w, http.StatusConflict, err)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	updated, _ := repo.GetTemplateByID(r.Context(), id)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(templateToResponse(updated))
}

func handleDeleteTemplate(w http.ResponseWriter, r *http.Request, repo *storage.TrafficRepository, id int64) {
	if err := repo.DeleteTemplate(r.Context(), id); err != nil {
		if errors.Is(err, storage.ErrTemplateNotFound) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
}

func templateToResponse(t storage.Template) templateResponse {
	return templateResponse{
		ID:               t.ID,
		Name:             t.Name,
		Category:         t.Category,
		TemplateURL:      t.TemplateURL,
		RuleSource:       t.RuleSource,
		UseProxy:         t.UseProxy,
		EnableIncludeAll: t.EnableIncludeAll,
		CreatedAt:        t.CreatedAt.Format("2006-01-02 15:04:05"),
		UpdatedAt:        t.UpdatedAt.Format("2006-01-02 15:04:05"),
	}
}

func fetchRemoteContent(url string, timeout time.Duration) (string, error) {
	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", errors.New("HTTP " + resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(body), nil
}

type fetchSourceRequest struct {
	URL      string `json:"url"`
	UseProxy bool   `json:"use_proxy"`
}

type fetchSourceResponse struct {
	Content string `json:"content"`
}

// 处理获取模板源文件内容
func NewTemplateFetchSourceHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
			return
		}

		var req fetchSourceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if req.URL == "" {
			writeError(w, http.StatusBadRequest, errors.New("url is required"))
			return
		}

		// 如果启用代理，通过 1ms.cc 代理获取
		fetchURL := req.URL
		if req.UseProxy && !strings.HasPrefix(req.URL, "https://1ms.cc/") {
			fetchURL = "https://1ms.cc/" + req.URL
		}

		content, err := fetchRemoteContent(fetchURL, 30*time.Second)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(fetchSourceResponse{Content: content})
	})
}
