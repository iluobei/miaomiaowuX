package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"miaomiaowux/internal/auth"
	"miaomiaowux/internal/storage"
)

type overrideScriptRequest struct {
	Name      string `json:"name"`
	Hook      string `json:"hook"`
	Content   string `json:"content"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sort_order"`
}

type overrideScriptResponse struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Hook      string `json:"hook"`
	Content   string `json:"content"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sort_order"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

func NewOverrideScriptsHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("override scripts handler requires repository")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username := auth.UsernameFromContext(r.Context())
		if strings.TrimSpace(username) == "" {
			writeError(w, http.StatusUnauthorized, errors.New("unauthorized"))
			return
		}

		user, err := repo.GetUser(r.Context(), username)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if user.Role != storage.RoleAdmin {
			writeError(w, http.StatusForbidden, errors.New("admin access required"))
			return
		}

		pathParts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		var idStr string
		if len(pathParts) >= 4 {
			idStr = pathParts[3]
		}

		switch r.Method {
		case http.MethodGet:
			if idStr != "" {
				id, err := strconv.ParseInt(idStr, 10, 64)
				if err != nil {
					writeError(w, http.StatusBadRequest, errors.New("invalid id"))
					return
				}
				script, err := repo.GetOverrideScript(r.Context(), id, username)
				if err != nil {
					writeError(w, http.StatusNotFound, errors.New("script not found"))
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(toOverrideScriptResponse(script))
			} else {
				hook := r.URL.Query().Get("hook")
				scripts, err := repo.ListOverrideScripts(r.Context(), username, hook)
				if err != nil {
					writeError(w, http.StatusInternalServerError, err)
					return
				}
				resp := make([]overrideScriptResponse, 0, len(scripts))
				for i := range scripts {
					resp = append(resp, toOverrideScriptResponse(&scripts[i]))
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(resp)
			}

		case http.MethodPost:
			var req overrideScriptRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, errors.New("invalid request body"))
				return
			}
			if req.Name == "" || req.Hook == "" || req.Content == "" {
				writeError(w, http.StatusBadRequest, errors.New("name, hook, and content are required"))
				return
			}
			if req.Hook != "post_fetch" && req.Hook != "pre_save_nodes" {
				writeError(w, http.StatusBadRequest, errors.New("hook must be 'post_fetch' or 'pre_save_nodes'"))
				return
			}

			script := &storage.OverrideScript{
				Username:  username,
				Name:      req.Name,
				Hook:      req.Hook,
				Content:   req.Content,
				Enabled:   req.Enabled,
				SortOrder: req.SortOrder,
			}
			id, err := repo.CreateOverrideScript(r.Context(), script)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			created, _ := repo.GetOverrideScript(r.Context(), id, username)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			if created != nil {
				_ = json.NewEncoder(w).Encode(toOverrideScriptResponse(created))
			} else {
				_ = json.NewEncoder(w).Encode(map[string]int64{"id": id})
			}

		case http.MethodPut:
			if idStr == "" {
				writeError(w, http.StatusBadRequest, errors.New("id required"))
				return
			}
			id, err := strconv.ParseInt(idStr, 10, 64)
			if err != nil {
				writeError(w, http.StatusBadRequest, errors.New("invalid id"))
				return
			}

			var req overrideScriptRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, errors.New("invalid request body"))
				return
			}
			if req.Hook != "" && req.Hook != "post_fetch" && req.Hook != "pre_save_nodes" {
				writeError(w, http.StatusBadRequest, errors.New("hook must be 'post_fetch' or 'pre_save_nodes'"))
				return
			}

			script := &storage.OverrideScript{
				ID:        id,
				Username:  username,
				Name:      req.Name,
				Hook:      req.Hook,
				Content:   req.Content,
				Enabled:   req.Enabled,
				SortOrder: req.SortOrder,
			}
			if err := repo.UpdateOverrideScript(r.Context(), script); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			updated, _ := repo.GetOverrideScript(r.Context(), id, username)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			if updated != nil {
				_ = json.NewEncoder(w).Encode(toOverrideScriptResponse(updated))
			} else {
				_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
			}

		case http.MethodDelete:
			if idStr == "" {
				writeError(w, http.StatusBadRequest, errors.New("id required"))
				return
			}
			id, err := strconv.ParseInt(idStr, 10, 64)
			if err != nil {
				writeError(w, http.StatusBadRequest, errors.New("invalid id"))
				return
			}
			if err := repo.DeleteOverrideScript(r.Context(), id, username); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})

		default:
			writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		}
	})
}

func toOverrideScriptResponse(s *storage.OverrideScript) overrideScriptResponse {
	return overrideScriptResponse{
		ID:        s.ID,
		Name:      s.Name,
		Hook:      s.Hook,
		Content:   s.Content,
		Enabled:   s.Enabled,
		SortOrder: s.SortOrder,
		CreatedAt: s.CreatedAt.Format("2006-01-02 15:04:05"),
		UpdatedAt: s.UpdatedAt.Format("2006-01-02 15:04:05"),
	}
}
