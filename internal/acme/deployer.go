package acme

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// 将证书和密钥 PEM 写入指定的路径。
func DeployCertFiles(certPEM, keyPEM, certPath, keyPath string) error {
	if certPath == "" || keyPath == "" {
		return fmt.Errorf("deploy paths are required")
	}

	// 确保父目录存在
	if err := os.MkdirAll(filepath.Dir(certPath), 0755); err != nil {
		return fmt.Errorf("create cert dir: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(keyPath), 0755); err != nil {
		return fmt.Errorf("create key dir: %w", err)
	}

	if err := os.WriteFile(certPath, []byte(certPEM), 0644); err != nil {
		return fmt.Errorf("write cert: %w", err)
	}
	if err := os.WriteFile(keyPath, []byte(keyPEM), 0600); err != nil {
		return fmt.Errorf("write key: %w", err)
	}
	return nil
}

// 向 nginx 发送重新加载信号。
func ReloadNginx() error {
	// 首先尝试常见的 nginx 二进制路径，然后回退到 systemctl
	for _, nginxBin := range []string{"/usr/local/nginx/sbin/nginx", "nginx"} {
		if path, err := exec.LookPath(nginxBin); err == nil {
			cmd := exec.Command(path, "-s", "reload")
			if output, err := cmd.CombinedOutput(); err != nil {
				return fmt.Errorf("nginx reload: %s: %w", string(output), err)
			}
			return nil
		}
	}
	// 后备：systemctl
	cmd := exec.Command("systemctl", "reload", "nginx")
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("nginx reload via systemctl: %s: %w", string(output), err)
	}
	return nil
}

// RestartXray通过systemctl重新启动xray服务。
func RestartXray() error {
	cmd := exec.Command("systemctl", "restart", "xray")
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("xray restart: %s: %w", string(output), err)
	}
	return nil
}

// 部署写入证书文件并可选择重新加载服务。
// reloadTarget：“nginx”、“xray”、“两者”或“无”。
func Deploy(certPEM, keyPEM, certPath, keyPath, reloadTarget string) error {
	if err := DeployCertFiles(certPEM, keyPEM, certPath, keyPath); err != nil {
		return err
	}

	switch reloadTarget {
	case "nginx":
		return ReloadNginx()
	case "xray":
		return RestartXray()
	case "both":
		if err := ReloadNginx(); err != nil {
			return err
		}
		return RestartXray()
	}
	return nil
}
