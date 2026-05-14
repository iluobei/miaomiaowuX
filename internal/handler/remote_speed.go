package handler

import (
	"encoding/json"
	"log"
	"net/http"

	"miaomiaowux/internal/agentlog"
	"miaomiaowux/internal/storage"
	"miaomiaowux/internal/version"
)

// RemoteSpeedHandler 通过 HTTP 处理来自远程服务器的速度报告
type RemoteSpeedHandler struct {
	repo   *storage.TrafficRepository
	crypto *CryptoConfig
}

// 创建一个新的远程速度处理程序
func NewRemoteSpeedHandler(repo *storage.TrafficRepository, crypto *CryptoConfig) *RemoteSpeedHandler {
	return &RemoteSpeedHandler{
		repo:   repo,
		crypto: crypto,
	}
}

// RemoteSpeedRequest 表示来自远程服务器的速度报告
type RemoteSpeedRequest struct {
	UploadSpeed   int64 `json:"upload_speed"`   // 字节/秒
	DownloadSpeed int64 `json:"download_speed"` // 字节/秒
}

// 处理来自远程服务器的 POST 请求
func (h *RemoteSpeedHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if r.Header.Get("User-Agent") != version.AgentUserAgent {
		h.writeJSON(w, http.StatusForbidden, map[string]interface{}{
			"success": false,
			"error":   "Forbidden",
		})
		return
	}

	ctx := r.Context()

	crypto, err := handleHTTPCrypto(r, w, h.crypto)
	if crypto == nil {
		return
	}
	_ = err

	token := crypto.Token
	if token == "" {
		h.writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"success": false,
			"error":   "Missing authentication token",
		})
		return
	}

	remoteServer, err := h.repo.GetRemoteServerByToken(ctx, token)
	if err != nil {
		h.writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"success": false,
			"error":   "Invalid token",
		})
		return
	}

	var req RemoteSpeedRequest
	if err := json.Unmarshal(crypto.Body, &req); err != nil {
		h.writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"error":   "Invalid request body",
		})
		return
	}

	if err := h.repo.UpdateRemoteServerSpeed(ctx, remoteServer.ID, req.UploadSpeed, req.DownloadSpeed); err != nil {
		log.Printf("[Remote Speed] Failed to update speed from %s: %v", remoteServer.Name, err)
		h.writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   "Failed to update speed",
		})
		return
	}

	agentlog.Printf("[Remote Speed] Updated speed from %s: ↑%d B/s ↓%d B/s",
		remoteServer.Name, req.UploadSpeed, req.DownloadSpeed)

	respData, _ := json.Marshal(map[string]interface{}{
		"success": true,
		"message": "Speed data received",
	})
	writeHTTPCryptoResponse(w, crypto.Session, respData)
}

func (h *RemoteSpeedHandler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
