package handler

import (
	"net/http"

	"miaomiaowu/internal/storage"
)

type subscribeFilesListHandler struct {
	repo *storage.TrafficRepository
}

// 返回一个用于列出订阅文件的处理程序（对于所有经过身份验证的用户）。
func NewSubscribeFilesListHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("subscribe files list handler requires repository")
	}

	return &subscribeFilesListHandler{
		repo: repo,
	}
}

func (h *subscribeFilesListHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}

	files, err := h.repo.ListSubscribeFiles(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	// 转换为DTO格式
	result := make([]subscribeFileDTO, 0, len(files))
	for _, file := range files {
		result = append(result, subscribeFileDTO{
			ID:          file.ID,
			Name:        file.Name,
			Description: file.Description,
			Type:        file.Type,
			Filename:    file.Filename,
			ExpireAt:    file.ExpireAt,
			CreatedAt:   file.CreatedAt,
			UpdatedAt:   file.UpdatedAt,
		})
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"files": result,
	})
}
