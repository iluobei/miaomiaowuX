package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"miaomiaowu/internal/auth"
	"miaomiaowu/internal/storage"
)

type userTokenHandler struct {
	repo *storage.TrafficRepository
}

type userTokenResponse struct {
	Token string `json:"token"`
}

// 返回一个经过身份验证的处理程序，用于检索和重置用户令牌。
func NewUserTokenHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("user token handler requires repository")
	}

	return &userTokenHandler{repo: repo}
}

func (h *userTokenHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		writeError(w, http.StatusUnauthorized, errors.New("unauthorized"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.handleGet(w, r, username)
	case http.MethodPost:
		h.handleReset(w, r, username)
	default:
		writeError(w, http.StatusMethodNotAllowed, errors.New("only GET and POST are supported"))
	}
}

func (h *userTokenHandler) handleGet(w http.ResponseWriter, r *http.Request, username string) {
	token, err := h.repo.GetOrCreateUserToken(r.Context(), username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	respondWithToken(w, token)
}

func (h *userTokenHandler) handleReset(w http.ResponseWriter, r *http.Request, username string) {
	token, err := h.repo.ResetUserToken(r.Context(), username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	respondWithToken(w, token)
}

func respondWithToken(w http.ResponseWriter, token string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(userTokenResponse{Token: token})
}
