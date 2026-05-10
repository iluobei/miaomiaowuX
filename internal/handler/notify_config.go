package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"miaomiaowux/internal/notify"
	"miaomiaowux/internal/storage"
)

type notifyConfigResponse struct {
	NotifyEnabled               bool   `json:"notify_enabled"`
	TelegramBotToken            string `json:"telegram_bot_token"`
	TelegramChatID              string `json:"telegram_chat_id"`
	NotifyLogin                 bool   `json:"notify_login"`
	NotifySubscribeFetch        bool   `json:"notify_subscribe_fetch"`
	NotifyDailyTraffic          bool   `json:"notify_daily_traffic"`
	NotifyServerOffline         bool   `json:"notify_server_offline"`
	NotifyServerOnline          bool   `json:"notify_server_online"`
	NotifyTrafficThreshold      bool   `json:"notify_traffic_threshold"`
	NotifyDailyTrafficTime      string `json:"notify_daily_traffic_time"`
	NotifyTrafficThresholdPct   int    `json:"notify_traffic_threshold_percent"`
}

type notifyConfigRequest struct {
	NotifyEnabled               bool   `json:"notify_enabled"`
	TelegramBotToken            string `json:"telegram_bot_token"`
	TelegramChatID              string `json:"telegram_chat_id"`
	NotifyLogin                 bool   `json:"notify_login"`
	NotifySubscribeFetch        bool   `json:"notify_subscribe_fetch"`
	NotifyDailyTraffic          bool   `json:"notify_daily_traffic"`
	NotifyServerOffline         bool   `json:"notify_server_offline"`
	NotifyServerOnline          bool   `json:"notify_server_online"`
	NotifyTrafficThreshold      bool   `json:"notify_traffic_threshold"`
	NotifyDailyTrafficTime      string `json:"notify_daily_traffic_time"`
	NotifyTrafficThresholdPct   int    `json:"notify_traffic_threshold_percent"`
}

type NotifyConfigHandler struct {
	repo *storage.TrafficRepository
}

func NewNotifyConfigHandler(repo *storage.TrafficRepository) *NotifyConfigHandler {
	return &NotifyConfigHandler{repo: repo}
}

func (h *NotifyConfigHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/test") && r.Method == http.MethodPost {
		h.handleTest(w, r)
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.handleGet(w, r)
	case http.MethodPut:
		h.handleUpdate(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *NotifyConfigHandler) handleGet(w http.ResponseWriter, r *http.Request) {
	sysCfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	maskedToken := sysCfg.TelegramBotToken
	if len(maskedToken) > 4 {
		maskedToken = strings.Repeat("*", len(maskedToken)-4) + maskedToken[len(maskedToken)-4:]
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(notifyConfigResponse{
		NotifyEnabled:             sysCfg.NotifyEnabled,
		TelegramBotToken:          maskedToken,
		TelegramChatID:            sysCfg.TelegramChatID,
		NotifyLogin:               sysCfg.NotifyLogin,
		NotifySubscribeFetch:      sysCfg.NotifySubscribeFetch,
		NotifyDailyTraffic:        sysCfg.NotifyDailyTraffic,
		NotifyServerOffline:       sysCfg.NotifyServerOffline,
		NotifyServerOnline:        sysCfg.NotifyServerOnline,
		NotifyTrafficThreshold:    sysCfg.NotifyTrafficThreshold,
		NotifyDailyTrafficTime:    sysCfg.NotifyDailyTrafficTime,
		NotifyTrafficThresholdPct: sysCfg.NotifyTrafficThresholdPercent,
	})
}

func (h *NotifyConfigHandler) handleUpdate(w http.ResponseWriter, r *http.Request) {
	var req notifyConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	sysCfg, err := h.repo.GetSystemConfig(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	if req.TelegramBotToken != "" && !strings.Contains(req.TelegramBotToken, "*") {
		sysCfg.TelegramBotToken = req.TelegramBotToken
	}

	sysCfg.NotifyEnabled = req.NotifyEnabled
	sysCfg.TelegramChatID = req.TelegramChatID
	sysCfg.NotifyLogin = req.NotifyLogin
	sysCfg.NotifySubscribeFetch = req.NotifySubscribeFetch
	sysCfg.NotifyDailyTraffic = req.NotifyDailyTraffic
	sysCfg.NotifyServerOffline = req.NotifyServerOffline
	sysCfg.NotifyServerOnline = req.NotifyServerOnline
	sysCfg.NotifyTrafficThreshold = req.NotifyTrafficThreshold
	if req.NotifyDailyTrafficTime != "" {
		sysCfg.NotifyDailyTrafficTime = req.NotifyDailyTrafficTime
	}
	if req.NotifyTrafficThresholdPct > 0 && req.NotifyTrafficThresholdPct <= 100 {
		sysCfg.NotifyTrafficThresholdPercent = req.NotifyTrafficThresholdPct
	}

	if err := h.repo.UpdateSystemConfig(r.Context(), sysCfg); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	if n := GetNotifier(); n != nil {
		n.UpdateConfig(notify.Config{
			Enabled:                 sysCfg.NotifyEnabled,
			BotToken:                sysCfg.TelegramBotToken,
			ChatID:                  sysCfg.TelegramChatID,
			NotifyLogin:             sysCfg.NotifyLogin,
			NotifySubscribeFetch:    sysCfg.NotifySubscribeFetch,
			NotifyDailyTraffic:      sysCfg.NotifyDailyTraffic,
			NotifyServerOffline:     sysCfg.NotifyServerOffline,
			NotifyServerOnline:      sysCfg.NotifyServerOnline,
			NotifyTrafficThreshold:  sysCfg.NotifyTrafficThreshold,
			DailyTrafficTime:        sysCfg.NotifyDailyTrafficTime,
			TrafficThresholdPercent: sysCfg.NotifyTrafficThresholdPercent,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *NotifyConfigHandler) handleTest(w http.ResponseWriter, r *http.Request) {
	n := GetNotifier()
	if n == nil {
		writeError(w, http.StatusInternalServerError, nil)
		return
	}

	if err := n.SendTest(r.Context()); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
