package handler

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"miaomiaowu/internal/auth"
	"miaomiaowu/internal/logger"
	"miaomiaowu/internal/storage"
)

const debugAutoCloseSeconds = 5 * 60

type debugHandler struct {
	repo           *storage.TrafficRepository
	logManager     *logger.LogManager
	mu             sync.Mutex
	autoCloseTimer *time.Timer
	debugUsername   string
}

func NewDebugHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("debug handler requires repository")
	}

	return &debugHandler{
		repo:       repo,
		logManager: logger.NewLogManager("data/logs"),
	}
}

func (h *debugHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	username := auth.UsernameFromContext(r.Context())
	if strings.TrimSpace(username) == "" {
		writeError(w, http.StatusUnauthorized, errors.New("unauthorized"))
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/user/debug")
	path = strings.Trim(path, "/")

	switch {
	case path == "enable" && r.Method == http.MethodPost:
		h.handleEnable(w, r, username)
	case path == "disable" && r.Method == http.MethodPost:
		h.handleDisable(w, r, username)
	case path == "status" && r.Method == http.MethodGet:
		h.handleStatus(w, r, username)
	case path == "download" && r.Method == http.MethodGet:
		h.handleDownload(w, r, username)
	case path == "tail" && r.Method == http.MethodGet:
		h.handleTail(w, r, username)
	default:
		allowed := []string{http.MethodGet, http.MethodPost}
		methodNotAllowed(w, allowed...)
	}
}

func (h *debugHandler) handleEnable(w http.ResponseWriter, r *http.Request, username string) {
	settings, err := h.repo.GetUserSettings(r.Context(), username)
	if err != nil {
		if errors.Is(err, storage.ErrUserSettingsNotFound) {
			settings = storage.UserSettings{
				Username: username,
			}
		} else {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
	}

	if settings.DebugEnabled {
		respondJSON(w, http.StatusOK, map[string]any{
			"status":     "already_enabled",
			"log_path":   settings.DebugLogPath,
			"started_at": settings.DebugStartedAt,
		})
		return
	}

	logPath, err := h.logManager.CreateLogFile()
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("创建日志文件失败: %w", err))
		return
	}

	if err := logger.EnableDebug(logPath); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("开启debug日志失败: %w", err))
		return
	}

	now := time.Now()
	settings.DebugEnabled = true
	settings.DebugLogPath = logPath
	settings.DebugStartedAt = &now

	if err := h.repo.UpsertUserSettings(r.Context(), settings); err != nil {
		logger.DisableDebug()
		writeError(w, http.StatusInternalServerError, fmt.Errorf("更新用户设置失败: %w", err))
		return
	}

	h.startAutoCloseTimer(username)

	logger.Info("[Debug日志] 已开启", "user", username, "log_path", logPath)

	respondJSON(w, http.StatusOK, map[string]any{
		"status":     "enabled",
		"log_path":   logPath,
		"started_at": now.Format(time.RFC3339),
	})
}

func (h *debugHandler) startAutoCloseTimer(username string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.autoCloseTimer != nil {
		h.autoCloseTimer.Stop()
	}
	h.debugUsername = username
	h.autoCloseTimer = time.AfterFunc(time.Duration(debugAutoCloseSeconds)*time.Second, func() {
		h.autoClose()
	})
}

func (h *debugHandler) stopAutoCloseTimer() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.autoCloseTimer != nil {
		h.autoCloseTimer.Stop()
		h.autoCloseTimer = nil
	}
}

func (h *debugHandler) autoClose() {
	h.mu.Lock()
	username := h.debugUsername
	h.autoCloseTimer = nil
	h.mu.Unlock()

	logPath := logger.DisableDebug()

	ctx := context.Background()
	settings, err := h.repo.GetUserSettings(ctx, username)
	if err != nil {
		logger.Error("[Debug日志] 自动关闭-读取设置失败", "user", username, "error", err)
		return
	}
	settings.DebugEnabled = false
	settings.DebugStartedAt = nil
	if err := h.repo.UpsertUserSettings(ctx, settings); err != nil {
		logger.Error("[Debug日志] 自动关闭-更新设置失败", "user", username, "error", err)
		return
	}
	logger.Info("[Debug日志] 已自动关闭（超过5分钟）", "user", username, "log_path", logPath)
}

func (h *debugHandler) handleDisable(w http.ResponseWriter, r *http.Request, username string) {
	h.stopAutoCloseTimer()

	settings, err := h.repo.GetUserSettings(r.Context(), username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	if !settings.DebugEnabled {
		respondJSON(w, http.StatusOK, map[string]any{
			"status": "already_disabled",
		})
		return
	}

	logPath := logger.DisableDebug()

	settings.DebugEnabled = false
	settings.DebugStartedAt = nil

	if err := h.repo.UpsertUserSettings(r.Context(), settings); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("更新用户设置失败: %w", err))
		return
	}

	logger.Info("[Debug日志] 已关闭", "user", username, "log_path", logPath)

	filename := filepath.Base(logPath)
	respondJSON(w, http.StatusOK, map[string]any{
		"status":       "disabled",
		"log_path":     logPath,
		"download_url": fmt.Sprintf("/api/user/debug/download?file=%s", filename),
	})
}

func (h *debugHandler) handleStatus(w http.ResponseWriter, r *http.Request, username string) {
	settings, err := h.repo.GetUserSettings(r.Context(), username)
	if err != nil {
		if errors.Is(err, storage.ErrUserSettingsNotFound) {
			respondJSON(w, http.StatusOK, map[string]any{
				"enabled": false,
			})
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	if settings.DebugEnabled && settings.DebugStartedAt != nil {
		if int(time.Since(*settings.DebugStartedAt).Seconds()) >= debugAutoCloseSeconds {
			logger.DisableDebug()
			settings.DebugEnabled = false
			settings.DebugStartedAt = nil
			_ = h.repo.UpsertUserSettings(r.Context(), settings)
			logger.Info("[Debug日志] 已清理超时残留", "user", username)
			respondJSON(w, http.StatusOK, map[string]any{"enabled": false})
			return
		}
	}

	response := map[string]any{
		"enabled": settings.DebugEnabled,
	}

	if settings.DebugEnabled && settings.DebugLogPath != "" {
		response["log_path"] = settings.DebugLogPath
		response["started_at"] = settings.DebugStartedAt

		if size, err := h.logManager.GetLogFileSize(settings.DebugLogPath); err == nil {
			response["file_size"] = formatFileSize(size)
		}

		if settings.DebugStartedAt != nil {
			duration := time.Since(*settings.DebugStartedAt)
			response["duration_seconds"] = int(duration.Seconds())
			response["duration"] = formatDuration(duration)
		}
	}

	respondJSON(w, http.StatusOK, response)
}

func (h *debugHandler) handleDownload(w http.ResponseWriter, r *http.Request, username string) {
	filename := r.URL.Query().Get("file")
	if filename == "" {
		writeError(w, http.StatusBadRequest, errors.New("文件名不能为空"))
		return
	}

	if !strings.HasPrefix(filename, "log_") || !strings.HasSuffix(filename, ".txt") {
		writeError(w, http.StatusBadRequest, errors.New("无效的文件名"))
		return
	}

	settings, err := h.repo.GetUserSettings(r.Context(), username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	if settings.DebugLogPath != "" && filepath.Base(settings.DebugLogPath) != filename {
		writeError(w, http.StatusForbidden, errors.New("无权访问该文件"))
		return
	}

	filePath := filepath.Join(h.logManager.BaseDir, filename)

	fileInfo, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, errors.New("文件不存在"))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	file, err := os.Open(filePath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size()))

	if _, err := io.Copy(w, file); err != nil {
		logger.Error("[Debug日志] 下载文件失败", "user", username, "file", filename, "error", err)
		return
	}

	logger.Info("[Debug日志] 文件已下载", "user", username, "file", filename, "size", fileInfo.Size())

	go func() {
		time.Sleep(1 * time.Second)
		if err := h.logManager.DeleteLogFile(filename); err != nil {
			logger.Error("[Debug日志] 删除文件失败", "file", filename, "error", err)
		} else {
			logger.Info("[Debug日志] 文件已删除", "file", filename)
		}
	}()
}

func (h *debugHandler) handleTail(w http.ResponseWriter, r *http.Request, username string) {
	settings, err := h.repo.GetUserSettings(r.Context(), username)
	if err != nil || !settings.DebugEnabled || settings.DebugLogPath == "" {
		respondJSON(w, http.StatusOK, map[string]any{"lines": "", "total_size": 0})
		return
	}

	lines := 200
	if v := r.URL.Query().Get("lines"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			lines = n
		}
	}

	content, err := tailFile(settings.DebugLogPath, lines)
	if err != nil {
		respondJSON(w, http.StatusOK, map[string]any{"lines": "", "total_size": 0})
		return
	}

	totalSize := int64(0)
	if size, err := h.logManager.GetLogFileSize(settings.DebugLogPath); err == nil {
		totalSize = size
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"lines":      content,
		"total_size": totalSize,
	})
}

func tailFile(path string, n int) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		return "", err
	}

	const chunkSize = 8192
	fileSize := stat.Size()
	if fileSize == 0 {
		return "", nil
	}

	var buf bytes.Buffer
	lineCount := 0
	offset := fileSize

	for offset > 0 && lineCount <= n {
		readSize := int64(chunkSize)
		if readSize > offset {
			readSize = offset
		}
		offset -= readSize

		chunk := make([]byte, readSize)
		nRead, err := f.ReadAt(chunk, offset)
		if err != nil && err != io.EOF {
			return "", err
		}
		chunk = chunk[:nRead]

		old := buf.Bytes()
		buf.Reset()
		buf.Write(chunk)
		buf.Write(old)

		lineCount = bytes.Count(buf.Bytes(), []byte{'\n'})
	}

	content := buf.Bytes()
	for len(content) > 0 && content[len(content)-1] == '\n' {
		content = content[:len(content)-1]
	}

	allLines := bytes.Split(content, []byte{'\n'})
	if len(allLines) > n {
		allLines = allLines[len(allLines)-n:]
	}

	return string(bytes.Join(allLines, []byte{'\n'})), nil
}

func formatFileSize(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(size)/float64(div), "KMGTPE"[exp])
}

func formatDuration(d time.Duration) string {
	totalSec := int(d.Seconds())
	if totalSec < 60 {
		return fmt.Sprintf("%d秒", totalSec)
	}
	min := totalSec / 60
	sec := totalSec % 60
	if min < 60 {
		if sec == 0 {
			return fmt.Sprintf("%d分钟", min)
		}
		return fmt.Sprintf("%d分%d秒", min, sec)
	}
	hour := min / 60
	min = min % 60
	return fmt.Sprintf("%d小时%d分", hour, min)
}
