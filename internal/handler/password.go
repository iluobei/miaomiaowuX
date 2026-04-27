package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"miaomiaowu/internal/auth"
)

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func NewPasswordHandler(manager *auth.Manager) http.Handler {
	if manager == nil {
		panic("password handler requires manager")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
			return
		}

		username := auth.UsernameFromContext(r.Context())
		if strings.TrimSpace(username) == "" {
			writeError(w, http.StatusUnauthorized, errors.New("unauthorized"))
			return
		}

		var payload changePasswordRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		current := strings.TrimSpace(payload.CurrentPassword)
		newPassword := strings.TrimSpace(payload.NewPassword)
		if current == "" || newPassword == "" {
			writeError(w, http.StatusBadRequest, errors.New("current and new passwords are required"))
			return
		}

		if len(newPassword) < 8 {
			writeError(w, http.StatusBadRequest, errors.New("new password must be at least 8 characters"))
			return
		}

		// 使用当前密码进行身份验证并更新为新密码
		if err := manager.ChangePassword(r.Context(), username, current, newPassword); err != nil {
			writeError(w, http.StatusBadRequest, errors.New("current password is incorrect or update failed"))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "password_updated"})
	})
}
