package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"miaomiaowu/internal/auth"
	"miaomiaowu/internal/storage"
)

type shortLinkHandler struct {
	repo                *storage.TrafficRepository
	subscriptionHandler *SubscriptionHandler
	packageHandler      http.Handler
}

func NewShortLinkHandler(repo *storage.TrafficRepository, subscriptionHandler *SubscriptionHandler, packageHandler http.Handler) *shortLinkHandler {
	if repo == nil {
		panic("short link handler requires repository")
	}
	if subscriptionHandler == nil {
		panic("short link handler requires subscription handler")
	}

	return &shortLinkHandler{
		repo:                repo,
		subscriptionHandler: subscriptionHandler,
		packageHandler:      packageHandler,
	}
}

// TryServe attempts to serve the request as a short link.
// Returns true if the request was handled, false if not matched (caller should fall through).
func (h *shortLinkHandler) TryServe(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}

	compositeCode := strings.Trim(r.URL.Path, "/")
	compositeCode = strings.TrimPrefix(compositeCode, "x/")
	if len(compositeCode) < 2 {
		return false
	}

	ctx := r.Context()

	fileCodes, err := h.repo.GetAllFileShortCodes(ctx)
	if err != nil {
		fileCodes = nil
	}
	userCodes, err := h.repo.GetAllUserShortCodes(ctx)
	if err != nil || len(userCodes) == 0 {
		return false
	}
	packageCodes, _ := h.repo.GetAllPackageShortCodes(ctx)

	if len(fileCodes) == 0 && len(packageCodes) == 0 {
		return false
	}

	var filename, username string
	var isPackage bool
	matched := false
	for i := len(compositeCode) - 1; i >= 1; i-- {
		leftCode := compositeCode[:i]
		rightCode := compositeCode[i:]
		un, uOk := userCodes[rightCode]
		if !uOk {
			continue
		}
		if fn, fOk := fileCodes[leftCode]; fOk {
			filename = fn
			username = un
			matched = true
			break
		}
		if _, pOk := packageCodes[leftCode]; pOk {
			username = un
			isPackage = true
			matched = true
			break
		}
	}

	if !matched {
		return false
	}

	if isPackage && h.packageHandler != nil {
		newCtx := auth.ContextWithUsername(ctx, username)
		newRequest := r.Clone(newCtx)
		h.packageHandler.ServeHTTP(w, newRequest)
		return true
	}

	newURL := *r.URL
	q := newURL.Query()
	q.Set("filename", filename)
	if clientType := r.URL.Query().Get("t"); clientType != "" {
		q.Set("t", clientType)
	}
	newURL.RawQuery = q.Encode()

	newCtx := auth.ContextWithUsername(ctx, username)
	newRequest := r.Clone(newCtx)
	newRequest.URL = &newURL
	h.subscriptionHandler.ServeHTTP(w, newRequest)
	return true
}

func (h *shortLinkHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.TryServe(w, r) {
		http.NotFound(w, r)
	}
}

type shortLinkResetHandler struct {
	repo *storage.TrafficRepository
}

func NewShortLinkResetHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("short link reset handler requires repository")
	}

	return &shortLinkResetHandler{repo: repo}
}

func (h *shortLinkResetHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	username := auth.UsernameFromContext(r.Context())
	if username == "" {
		writeError(w, http.StatusUnauthorized, errors.New("unauthorized"))
		return
	}

	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
		return
	}

	if err := h.repo.ResetAllSubscriptionShortURLs(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"message":"所有订阅的短链接已重置"}`)
}

// NewUserCustomShortCodeSelfHandler 用户自行设置自定义短链接
func NewUserCustomShortCodeSelfHandler(repo *storage.TrafficRepository) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username := auth.UsernameFromContext(r.Context())
		if username == "" {
			writeError(w, http.StatusUnauthorized, errors.New("unauthorized"))
			return
		}

		switch r.Method {
		case http.MethodGet:
			code, err := repo.GetUserCustomShortCode(r.Context(), username)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"custom_short_code": code})

		case http.MethodPost:
			var payload struct {
				CustomShortCode string `json:"custom_short_code"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}

			code := strings.TrimSpace(payload.CustomShortCode)
			for _, c := range code {
				if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
					writeError(w, http.StatusBadRequest, errors.New("自定义连接只能包含字母和数字"))
					return
				}
			}

			if code != "" {
				userCodes, err := repo.GetAllUserShortCodes(r.Context())
				if err == nil {
					if un, exists := userCodes[code]; exists && un != username {
						writeError(w, http.StatusConflict, errors.New("该自定义连接已被其他用户使用"))
						return
					}
				}
			}

			if err := repo.UpdateUserCustomShortCode(r.Context(), username, code); err != nil {
				writeError(w, http.StatusConflict, errors.New(err.Error()))
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"status": "updated"})

		default:
			writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		}
	})
}
