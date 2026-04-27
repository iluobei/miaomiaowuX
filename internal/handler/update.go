package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"miaomiaowu/internal/logger"
	"miaomiaowu/internal/version"
)

const (
	githubRepo   = "Jimleerx/miaomiaowu"
	githubAPIURL = "https://api.github.com/repos/%s/releases/latest"
)

// UpdateInfo包含版本更新信息
type UpdateInfo struct {
	CurrentVersion string `json:"current_version"`
	LatestVersion  string `json:"latest_version"`
	HasUpdate      bool   `json:"has_update"`
	ReleaseURL     string `json:"release_url"`
	DownloadURL    string `json:"download_url"`
	ReleaseNotes   string `json:"release_notes"`
}

// UpdateProgress 表示更新操作的进度
type UpdateProgress struct {
	Step     string `json:"step"`     // 检查、下载、备份、替换、重新启动、完成、错误
	Progress int    `json:"progress"` // 下载步数 0-100
	Message  string `json:"message"`
}

// GitHubRelease 表示版本的 GitHub API 响应
type GitHubRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
	Body    string `json:"body"`
	Assets  []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

// 返回一个检查更新的处理程序
func NewUpdateCheckHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeUpdateError(w, http.StatusMethodNotAllowed, errors.New("only GET is supported"))
			return
		}

		info, err := checkLatestVersion()
		if err != nil {
			writeUpdateError(w, http.StatusInternalServerError, fmt.Errorf("检查更新失败: %w", err))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(info)
	})
}

// 返回应用更新的处理程序
func NewUpdateApplyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeUpdateError(w, http.StatusMethodNotAllowed, errors.New("only POST is supported"))
			return
		}

		// 1.获取最新版本信息
		info, err := checkLatestVersion()
		if err != nil {
			writeUpdateError(w, http.StatusInternalServerError, fmt.Errorf("检查更新失败: %w", err))
			return
		}

		if !info.HasUpdate {
			writeUpdateError(w, http.StatusBadRequest, errors.New("已是最新版本"))
			return
		}

		if info.DownloadURL == "" {
			writeUpdateError(w, http.StatusInternalServerError, errors.New("未找到适合当前系统的下载链接"))
			return
		}

		// 2. 将新的二进制文件下载到临时文件
		logger.Info("[系统更新] 开始下载更新", "url", info.DownloadURL)
		tempFile, err := downloadBinary(info.DownloadURL)
		if err != nil {
			writeUpdateError(w, http.StatusInternalServerError, fmt.Errorf("下载失败: %w", err))
			return
		}
		defer os.Remove(tempFile)

		// 3. 获取二进制文件的目标路径
		targetPath, err := getUpdateTargetPath()
		if err != nil {
			writeUpdateError(w, http.StatusInternalServerError, fmt.Errorf("获取程序路径失败: %w", err))
			return
		}

		// 4. 备份当前版本（仅适用于非Docker）
		if !isDocker() {
			backupPath := targetPath + ".bak"
			if err := copyFile(targetPath, backupPath); err != nil {
				logger.Warn("[系统更新] 备份当前版本失败（非致命错误）", "error", err)
			}
		}

		// 5. 替换二进制文件
		logger.Info("[系统更新] 正在替换二进制文件", "from", tempFile, "to", targetPath)
		if err := replaceBinary(tempFile, targetPath); err != nil {
			writeUpdateError(w, http.StatusInternalServerError, fmt.Errorf("替换失败: %w", err))
			return
		}

		// 6.设置执行权限
		if err := os.Chmod(targetPath, 0755); err != nil {
			writeUpdateError(w, http.StatusInternalServerError, fmt.Errorf("设置权限失败: %w", err))
			return
		}

		logger.Info("[系统更新] 更新成功，准备重启服务器")

		// 7.返回成功响应
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":  "success",
			"message": "更新完成，正在重启...",
		})

		// 8.异步重启（给客户端时间接收响应）
		go func() {
			time.Sleep(500 * time.Millisecond)
			restartSelf(targetPath)
		}()
	})
}

// 返回一个处理程序，该处理程序根据 SSE 进度应用更新
func NewUpdateApplySSEHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 设置 SSE 标头
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no") // 禁用 nginx 缓冲

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "SSE not supported", http.StatusInternalServerError)
			return
		}

		// 发送进度的助手
		sendProgress := func(step string, progress int, message string) {
			p := UpdateProgress{Step: step, Progress: progress, Message: message}
			data, _ := json.Marshal(p)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}

		// 1.检查版本
		sendProgress("checking", 0, "正在检查版本信息...")

		info, err := checkLatestVersion()
		if err != nil {
			sendProgress("error", 0, fmt.Sprintf("检查更新失败: %v", err))
			return
		}

		if !info.HasUpdate {
			sendProgress("error", 0, "已是最新版本")
			return
		}

		if info.DownloadURL == "" {
			sendProgress("error", 0, "未找到适合当前系统的下载链接")
			return
		}

		// 2.有进度下载
		sendProgress("downloading", 0, "正在下载更新...")
		logger.Info("[系统更新] 开始下载更新", "url", info.DownloadURL)

		lastProgress := 0
		tempFile, err := downloadBinaryWithProgressAndRetry(info.DownloadURL, func(downloaded, total int64) {
			progress := int(downloaded * 100 / total)
			// 仅每 5% 发送一次更新以减少流量
			if progress >= lastProgress+5 || progress == 100 {
				lastProgress = progress
				sendProgress("downloading", progress, fmt.Sprintf("正在下载... %d%%", progress))
			}
		}, func(proxyURL string) {
			// 切换到代理时重置进度并提示用户
			lastProgress = 0
			sendProgress("downloading", 0, "直接下载失败，正在使用代理重试...")
		})
		if err != nil {
			sendProgress("error", 0, fmt.Sprintf("下载失败: %v", err))
			return
		}
		defer os.Remove(tempFile)

		// 3. 获取目标路径
		targetPath, err := getUpdateTargetPath()
		if err != nil {
			sendProgress("error", 0, fmt.Sprintf("获取程序路径失败: %v", err))
			return
		}

		// 4. 备份当前版本（仅适用于非Docker）
		if !isDocker() {
			sendProgress("backing_up", 0, "正在备份当前版本...")
			backupPath := targetPath + ".bak"
			if err := copyFile(targetPath, backupPath); err != nil {
				logger.Warn("[系统更新] 备份当前版本失败（非致命错误）", "error", err)
			}
		}

		// 5. 替换二进制文件
		sendProgress("replacing", 0, "正在替换文件...")
		logger.Info("[系统更新] 正在替换二进制文件", "from", tempFile, "to", targetPath)
		if err := replaceBinary(tempFile, targetPath); err != nil {
			sendProgress("error", 0, fmt.Sprintf("替换失败: %v", err))
			return
		}

		// 6.设置执行权限
		if err := os.Chmod(targetPath, 0755); err != nil {
			sendProgress("error", 0, fmt.Sprintf("设置权限失败: %v", err))
			return
		}

		// 7.发送重启状态
		sendProgress("restarting", 0, "更新完成，正在重启服务...")
		logger.Info("[系统更新] 更新成功，准备重启服务器")

		// 8. 发送完成状态
		sendProgress("done", 100, "更新完成")

		// 9.异步重启（给客户端时间接收响应）
		go func() {
			time.Sleep(500 * time.Millisecond)
			restartSelf(targetPath)
		}()
	})
}

// 从 GitHub 获取最新版本信息
func checkLatestVersion() (*UpdateInfo, error) {
	url := fmt.Sprintf(githubAPIURL, githubRepo)

	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "miaomiaowu-updater")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API 返回状态码: %d", resp.StatusCode)
	}

	var release GitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("解析 GitHub 响应失败: %w", err)
	}

	// 根据当前操作系统/架构选择下载 URL
	arch := runtime.GOARCH
	osName := runtime.GOOS
	binaryName := fmt.Sprintf("mmw-%s-%s", osName, arch)

	var downloadURL string
	for _, asset := range release.Assets {
		if asset.Name == binaryName {
			downloadURL = asset.BrowserDownloadURL
			break
		}
	}

	latestVersion := strings.TrimPrefix(release.TagName, "v")
	hasUpdate := compareVersions(version.Version, latestVersion)

	return &UpdateInfo{
		CurrentVersion: version.Version,
		LatestVersion:  latestVersion,
		HasUpdate:      hasUpdate,
		ReleaseURL:     release.HTMLURL,
		DownloadURL:    downloadURL,
		ReleaseNotes:   release.Body,
	}, nil
}

// 如果最新 > 当前，compareVersions 返回 true
func compareVersions(current, latest string) bool {
	currentParts := parseVersion(current)
	latestParts := parseVersion(latest)

	for i := 0; i < len(latestParts) || i < len(currentParts); i++ {
		var cp, lp int
		if i < len(currentParts) {
			cp = currentParts[i]
		}
		if i < len(latestParts) {
			lp = latestParts[i]
		}

		if lp > cp {
			return true
		}
		if lp < cp {
			return false
		}
	}
	return false
}

// 将版本字符串拆分为整数部分
func parseVersion(v string) []int {
	v = strings.TrimPrefix(v, "v")
	parts := strings.Split(v, ".")
	result := make([]int, len(parts))
	for i, p := range parts {
		var num int
		fmt.Sscanf(p, "%d", &num)
		result[i] = num
	}
	return result
}

// downloadBinary 将二进制文件下载到临时文件
// GitHub 代理地址
const githubProxyURL = "https://1ms.cc/"

func downloadBinary(url string) (string, error) {
	return downloadBinaryWithProgress(url, nil)
}

// downloadBinaryWithProgress 使用进度回调将二进制文件下载到临时文件
// 如果直接下载失败或超时，会尝试使用 GitHub 代理重试
func downloadBinaryWithProgress(url string, onProgress func(downloaded, total int64)) (string, error) {
	return downloadBinaryWithProgressAndRetry(url, onProgress, nil)
}

// 下载二进制文件，支持进度回调和重试通知
func downloadBinaryWithProgressAndRetry(url string, onProgress func(downloaded, total int64), onRetry func(proxyURL string)) (string, error) {
	// 首先尝试直接下载，使用较短的超时时间
	tempFile, err := downloadBinaryDirect(url, onProgress, 60*time.Second)
	if err == nil {
		return tempFile, nil
	}

	logger.Warn("[系统更新] 直接下载失败，尝试使用代理下载", "error", err)

	// 使用 GitHub 代理重试
	proxyURL := githubProxyURL + url
	logger.Info("[系统更新] 使用代理下载", "url", proxyURL)

	// 通知切换到代理
	if onRetry != nil {
		onRetry(proxyURL)
	}

	tempFile, err = downloadBinaryDirect(proxyURL, onProgress, 5*time.Minute)
	if err != nil {
		return "", fmt.Errorf("代理下载也失败: %w", err)
	}

	return tempFile, nil
}

// 直接下载二进制文件（不含重试逻辑）
func downloadBinaryDirect(url string, onProgress func(downloaded, total int64), timeout time.Duration) (string, error) {
	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载返回状态码: %d", resp.StatusCode)
	}

	tempFile, err := os.CreateTemp("", "mmw-update-*")
	if err != nil {
		return "", err
	}

	totalSize := resp.ContentLength
	var downloaded int64

	// 如果没有进度回调或未知大小，请使用简单复制
	if onProgress == nil || totalSize <= 0 {
		if _, err := io.Copy(tempFile, resp.Body); err != nil {
			tempFile.Close()
			os.Remove(tempFile.Name())
			return "", err
		}
	} else {
		// 复制并跟踪进度
		buf := make([]byte, 32*1024) // 32KB缓冲区
		for {
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				if _, writeErr := tempFile.Write(buf[:n]); writeErr != nil {
					tempFile.Close()
					os.Remove(tempFile.Name())
					return "", writeErr
				}
				downloaded += int64(n)
				onProgress(downloaded, totalSize)
			}
			if readErr != nil {
				if readErr == io.EOF {
					break
				}
				tempFile.Close()
				os.Remove(tempFile.Name())
				return "", readErr
			}
		}
	}

	tempFile.Close()
	return tempFile.Name(), nil
}

// 返回二进制文件应放置的路径
func getUpdateTargetPath() (string, error) {
	if isDocker() {
		// 在Docker中，写入持久数据目录
		targetPath := "/app/data/server"
		// 确保数据目录存在
		if err := os.MkdirAll("/app/data", 0755); err != nil {
			return "", err
		}
		return targetPath, nil
	}

	// 非 Docker：获取当前可执行路径
	execPath, err := os.Executable()
	if err != nil {
		return "", err
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return "", err
	}
	return execPath, nil
}

// 检查是否在 Docker 容器内运行
func isDocker() bool {
	// 检查 /.dockerenv 文件
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}

	// 检查 DOCKER 环境变量
	if os.Getenv("DOCKER") == "1" {
		return true
	}

	// 检查 docker 的 cgroup
	data, err := os.ReadFile("/proc/1/cgroup")
	if err == nil && strings.Contains(string(data), "docker") {
		return true
	}

	return false
}

// ReplaceBinary 将目标替换为新的二进制文件
func replaceBinary(src, dst string) error {
	// 在 Linux 上，我们可以删除正在运行的二进制文件（它保留在内存中）
	// 然后重命名新文件以取代它的位置

	// 首先，尝试删除旧的二进制文件
	if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
		// 如果删除失败（例如权限被拒绝），请尝试直接重命名
		if err := os.Rename(src, dst); err == nil {
			return nil
		}
		// 如果重命名也失败，请尝试复制
		return copyFile(src, dst)
	}

	// 旧的二进制文件已删除（或不存在），现在重命名新的二进制文件
	if err := os.Rename(src, dst); err != nil {
		// 重命名失败（跨设备），请尝试复制
		return copyFile(src, dst)
	}

	return nil
}

// 将文件从 src 复制到 dst
func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	// 创建目标文件（如果存在则截断）
	dstFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return err
	}

	return dstFile.Sync()
}

// 重新启动当前进程
func restartSelf(execPath string) {
	logger.Info("[系统重启] 正在重启服务器", "exec_path", execPath)

	// 使用syscall.Exec替换当前进程（PID保持不变）
	// 这对于 Docker 来说很重要，因为 PID 1 必须保持活动状态
	err := syscall.Exec(execPath, os.Args, os.Environ())
	if err != nil {
		logger.Warn("[系统重启] syscall.Exec失败，尝试启动新进程", "error", err)

		// Fallback：启动新进程并退出
		cmd := exec.Command(execPath, os.Args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Stdin = os.Stdin

		if err := cmd.Start(); err != nil {
			logger.Error("[系统重启] 启动新进程失败", "error", err)
			return
		}

		logger.Info("[系统重启] 新进程已启动，退出当前进程", "new_pid", cmd.Process.Pid)
		os.Exit(0)
	}
}

func writeUpdateError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": err.Error(),
	})
}
