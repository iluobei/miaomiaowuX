package handler

import (
	"encoding/json"
	"net/http"

	"miaomiaowux/internal/agentlog"
	"miaomiaowux/internal/storage"
)

type SystemSettingsHandler struct {
	repo   *storage.TrafficRepository
	crypto *CryptoConfig
}

func NewSystemSettingsHandler(repo *storage.TrafficRepository, crypto *CryptoConfig) *SystemSettingsHandler {
	return &SystemSettingsHandler{repo: repo, crypto: crypto}
}

type GetAPITokenResponse struct {
	Success bool   `json:"success"`
	Token   string `json:"token,omitempty"`
	Message string `json:"message,omitempty"`
}

// 返回当前的 API token
func (h *SystemSettingsHandler) GetAPIToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	token, err := h.repo.GetAPIToken(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(GetAPITokenResponse{
			Success: false,
			Message: "获取 API token 失败",
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(GetAPITokenResponse{
		Success: true,
		Token:   token,
	})
}

// 生成新的 API token
func (h *SystemSettingsHandler) RegenerateAPIToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	token, err := h.repo.RegenerateAPIToken(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(GetAPITokenResponse{
			Success: false,
			Message: "重新生成 API token 失败",
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(GetAPITokenResponse{
		Success: true,
		Token:   token,
		Message: "API token 重新生成成功",
	})
}

// 获取主服务器地址
func (h *SystemSettingsHandler) GetMasterURL(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	value, err := h.repo.GetSystemSetting(r.Context(), "master_url")
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "获取主服务器地址失败"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "master_url": value})
}

// 设置主服务器地址
func (h *SystemSettingsHandler) SetMasterURL(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		MasterURL string `json:"master_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "请求格式错误"})
		return
	}

	if err := h.repo.SetSystemSetting(r.Context(), "master_url", req.MasterURL); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "保存失败"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "message": "主服务器地址已更新"})
}

func (h *SystemSettingsHandler) GetShortLinkEnabled(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "获取设置失败"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "enable_short_link": cfg.EnableShortLink})
}

func (h *SystemSettingsHandler) SetShortLinkEnabled(w http.ResponseWriter, r *http.Request) {
	var req struct {
		EnableShortLink bool `json:"enable_short_link"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "请求格式错误"})
		return
	}
	cfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "获取设置失败"})
		return
	}
	cfg.EnableShortLink = req.EnableShortLink
	if err := h.repo.UpdateSystemConfig(r.Context(), cfg); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "保存失败"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "message": "短链接设置已更新"})
}

func (h *SystemSettingsHandler) GetIntervals(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "获取设置失败"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":                  true,
		"speed_collect_interval":   cfg.SpeedCollectInterval,
		"traffic_collect_interval": cfg.TrafficCollectInterval,
		"traffic_check_interval":   cfg.TrafficCheckInterval,
		"heartbeat_interval":       cfg.HeartbeatInterval,
	})
}

func (h *SystemSettingsHandler) SetIntervals(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SpeedCollectInterval   int `json:"speed_collect_interval"`
		TrafficCollectInterval int `json:"traffic_collect_interval"`
		TrafficCheckInterval   int `json:"traffic_check_interval"`
		HeartbeatInterval      int `json:"heartbeat_interval"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "请求格式错误"})
		return
	}
	if req.SpeedCollectInterval < 1 {
		req.SpeedCollectInterval = 3
	}
	if req.TrafficCollectInterval < 10 {
		req.TrafficCollectInterval = 60
	}
	if req.TrafficCheckInterval < 10 {
		req.TrafficCheckInterval = 120
	}
	if req.HeartbeatInterval < 5 {
		req.HeartbeatInterval = 30
	}

	cfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "获取设置失败"})
		return
	}
	cfg.SpeedCollectInterval = req.SpeedCollectInterval
	cfg.TrafficCollectInterval = req.TrafficCollectInterval
	cfg.TrafficCheckInterval = req.TrafficCheckInterval
	cfg.HeartbeatInterval = req.HeartbeatInterval
	if err := h.repo.UpdateSystemConfig(r.Context(), cfg); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "保存失败"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"message": "定时配置已更新，重启服务后生效",
	})
}

func (h *SystemSettingsHandler) GetAgentLogEnabled(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "获取设置失败"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "agent_log_enabled": cfg.AgentLogEnabled})
}

func (h *SystemSettingsHandler) SetAgentLogEnabled(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AgentLogEnabled bool `json:"agent_log_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "请求格式错误"})
		return
	}
	cfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "获取设置失败"})
		return
	}
	cfg.AgentLogEnabled = req.AgentLogEnabled
	if err := h.repo.UpdateSystemConfig(r.Context(), cfg); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "保存失败"})
		return
	}
	agentlog.SetEnabled(req.AgentLogEnabled)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "message": "Agent日志设置已更新"})
}

func (h *SystemSettingsHandler) GetOverrideScriptsEnabled(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "获取设置失败"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "enable_override_scripts": cfg.EnableOverrideScripts})
}

func (h *SystemSettingsHandler) SetOverrideScriptsEnabled(w http.ResponseWriter, r *http.Request) {
	var req struct {
		EnableOverrideScripts bool `json:"enable_override_scripts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "请求格式错误"})
		return
	}
	cfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "获取设置失败"})
		return
	}
	cfg.EnableOverrideScripts = req.EnableOverrideScripts
	if err := h.repo.UpdateSystemConfig(r.Context(), cfg); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "保存失败"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "message": "覆写脚本设置已更新"})
}

func (h *SystemSettingsHandler) GetSilentMode(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "获取设置失败"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"success":              true,
		"silent_mode":          cfg.SilentMode,
		"silent_mode_timeout":  cfg.SilentModeTimeout,
	})
}

func (h *SystemSettingsHandler) SetSilentMode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SilentMode        bool `json:"silent_mode"`
		SilentModeTimeout int  `json:"silent_mode_timeout"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "请求格式错误"})
		return
	}
	if req.SilentModeTimeout <= 0 {
		req.SilentModeTimeout = 15
	}
	cfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "获取设置失败"})
		return
	}
	cfg.SilentMode = req.SilentMode
	cfg.SilentModeTimeout = req.SilentModeTimeout
	if err := h.repo.UpdateSystemConfig(r.Context(), cfg); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "保存失败"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "message": "静默模式设置已更新"})
}

func (h *SystemSettingsHandler) GetRequireEncryption(w http.ResponseWriter, r *http.Request) {
	value, _ := h.repo.GetSystemSetting(r.Context(), "require_encryption")
	enabled := value == "true"
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "require_encryption": enabled})
}

func (h *SystemSettingsHandler) SetRequireEncryption(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequireEncryption bool `json:"require_encryption"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "请求格式错误"})
		return
	}

	value := "false"
	if req.RequireEncryption {
		value = "true"
	}
	if err := h.repo.SetSystemSetting(r.Context(), "require_encryption", value); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "message": "保存失败"})
		return
	}

	if h.crypto != nil {
		h.crypto.SetRequireEncryption(req.RequireEncryption)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "message": "加密设置已更新"})
}
