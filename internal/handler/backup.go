package handler

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"miaomiaowu/internal/storage"
)

// NewBackupDownloadHandler 返回一个创建和下载备份 zip 文件的处理程序
// 该处理程序需要管理员身份验证
func NewBackupDownloadHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("backup download handler requires repository")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeBackupError(w, http.StatusMethodNotAllowed, errors.New("only GET is supported"))
			return
		}

		// 检查点 WAL 确保所有数据都写入主数据库文件
		if err := repo.Checkpoint(); err != nil {
			writeBackupError(w, http.StatusInternalServerError, fmt.Errorf("failed to checkpoint database: %w", err))
			return
		}

		// 创建 zip 文件
		filename := fmt.Sprintf("miaomiaowu-backup-%s.zip", time.Now().Format("20060102-150405"))
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))

		zipWriter := zip.NewWriter(w)
		defer zipWriter.Close()

		// 添加数据目录
		if err := addDirToZip(zipWriter, "data", "data"); err != nil {
			// 启动 zip 后无法写入错误响应，只需记录
			return
		}

		// 添加订阅目录
		if err := addDirToZip(zipWriter, "subscribes", "subscribes"); err != nil {
			return
		}
	})
}

// NewBackupRestoreHandler 返回一个从备份 zip 文件恢复的处理程序
// 该处理程序需要管理员身份验证
func NewBackupRestoreHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("backup restore handler requires repository")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeBackupError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
			return
		}

		// 将上传大小限制为 100MB
		r.Body = http.MaxBytesReader(w, r.Body, 100<<20)

		file, _, err := r.FormFile("backup")
		if err != nil {
			writeBackupError(w, http.StatusBadRequest, fmt.Errorf("failed to read backup file: %w", err))
			return
		}
		defer file.Close()

		// 将上传的文件保存到临时位置
		tempFile, err := os.CreateTemp("", "backup-*.zip")
		if err != nil {
			writeBackupError(w, http.StatusInternalServerError, fmt.Errorf("failed to create temp file: %w", err))
			return
		}
		tempPath := tempFile.Name()
		defer os.Remove(tempPath)

		if _, err := io.Copy(tempFile, file); err != nil {
			tempFile.Close()
			writeBackupError(w, http.StatusInternalServerError, fmt.Errorf("failed to save backup file: %w", err))
			return
		}
		tempFile.Close()

		// 提取备份
		if err := extractBackup(tempPath); err != nil {
			writeBackupError(w, http.StatusInternalServerError, fmt.Errorf("failed to extract backup: %w", err))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"message": "备份恢复成功，请重启服务或刷新页面",
		})
	})
}

// NewSetupRestoreBackupHandler 返回用于在初始设置期间恢复备份的处理程序
// 该处理程序不需要身份验证，但检查是否需要设置
func NewSetupRestoreBackupHandler(repo *storage.TrafficRepository) http.Handler {
	if repo == nil {
		panic("setup restore backup handler requires repository")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeBackupError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
			return
		}

		// 关键安全检查：仅在不存在用户时允许
		users, err := repo.ListUsers(r.Context(), 1)
		if err != nil {
			writeBackupError(w, http.StatusInternalServerError, err)
			return
		}

		if len(users) > 0 {
			writeBackupError(w, http.StatusForbidden, errors.New("系统已初始化，无法使用此接口恢复备份"))
			return
		}

		// 将上传大小限制为 100MB
		r.Body = http.MaxBytesReader(w, r.Body, 100<<20)

		file, _, err := r.FormFile("backup")
		if err != nil {
			writeBackupError(w, http.StatusBadRequest, fmt.Errorf("failed to read backup file: %w", err))
			return
		}
		defer file.Close()

		// 将上传的文件保存到临时位置
		tempFile, err := os.CreateTemp("", "backup-*.zip")
		if err != nil {
			writeBackupError(w, http.StatusInternalServerError, fmt.Errorf("failed to create temp file: %w", err))
			return
		}
		tempPath := tempFile.Name()
		defer os.Remove(tempPath)

		if _, err := io.Copy(tempFile, file); err != nil {
			tempFile.Close()
			writeBackupError(w, http.StatusInternalServerError, fmt.Errorf("failed to save backup file: %w", err))
			return
		}
		tempFile.Close()

		// 提取备份
		if err := extractBackup(tempPath); err != nil {
			writeBackupError(w, http.StatusInternalServerError, fmt.Errorf("failed to extract backup: %w", err))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"message": "备份恢复成功，请刷新页面后登录",
		})
	})
}

// 递归地将目录添加到 zip writer
func addDirToZip(zipWriter *zip.Writer, srcDir, baseInZip string) error {
	return filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// 跳过目录（它们是隐式创建的）
		if info.IsDir() {
			return nil
		}

		// 跳过隐藏文件和特殊文件
		if strings.HasPrefix(info.Name(), ".") {
			return nil
		}

		relPath, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		zipPath := filepath.Join(baseInZip, relPath)

		// 创建具有适当修改时间的文件头
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = zipPath
		header.Method = zip.Deflate

		writer, err := zipWriter.CreateHeader(header)
		if err != nil {
			return err
		}

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()

		_, err = io.Copy(writer, file)
		return err
	})
}

// 将备份 zip 文件提取到适当的目录
func extractBackup(zipPath string) error {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("failed to open zip: %w", err)
	}
	defer reader.Close()

	// 首先验证 zip 内容
	hasData := false
	hasSubscribes := false
	for _, f := range reader.File {
		if strings.HasPrefix(f.Name, "data/") {
			hasData = true
		}
		if strings.HasPrefix(f.Name, "subscribes/") {
			hasSubscribes = true
		}
	}

	if !hasData && !hasSubscribes {
		return errors.New("备份文件格式无效：缺少 data 或 subscribes 目录")
	}

	// 提取文件
	for _, f := range reader.File {
		// 安全检查：防止路径穿越
		if strings.Contains(f.Name, "..") {
			continue
		}

		// 只提取 data/ 和 subscribe/ 目录
		if !strings.HasPrefix(f.Name, "data/") && !strings.HasPrefix(f.Name, "subscribes/") {
			continue
		}

		destPath := f.Name

		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(destPath, 0755); err != nil {
				return fmt.Errorf("failed to create directory %s: %w", destPath, err)
			}
			continue
		}

		// 确保父目录存在
		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return fmt.Errorf("failed to create parent directory for %s: %w", destPath, err)
		}

		// 提取文件
		srcFile, err := f.Open()
		if err != nil {
			return fmt.Errorf("failed to open zip file %s: %w", f.Name, err)
		}

		destFile, err := os.Create(destPath)
		if err != nil {
			srcFile.Close()
			return fmt.Errorf("failed to create file %s: %w", destPath, err)
		}

		_, err = io.Copy(destFile, srcFile)
		srcFile.Close()
		destFile.Close()

		if err != nil {
			return fmt.Errorf("failed to extract file %s: %w", f.Name, err)
		}
	}

	return nil
}

func writeBackupError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": err.Error(),
	})
}
