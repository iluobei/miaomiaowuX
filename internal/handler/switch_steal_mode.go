package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
)

func (h *RemoteManageHandler) HandleSwitchStealMode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		remoteWriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	id, err := strconv.ParseInt(r.URL.Query().Get("server_id"), 10, 64)
	if err != nil || id <= 0 {
		remoteWriteError(w, http.StatusBadRequest, "invalid server_id")
		return
	}

	var req struct {
		StealMode string `json:"steal_mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		remoteWriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.StealMode != "tunnel" && req.StealMode != "fallback" && req.StealMode != "default" {
		remoteWriteError(w, http.StatusBadRequest, "steal_mode must be tunnel, fallback, or default")
		return
	}

	ctx := r.Context()
	server, err := h.repo.GetRemoteServer(ctx, id)
	if err != nil {
		remoteWriteError(w, http.StatusNotFound, "server not found")
		return
	}

	oldMode := server.StealMode
	if oldMode == "" {
		oldMode = "tunnel"
	}
	if oldMode == req.StealMode {
		remoteWriteJSON(w, http.StatusOK, map[string]any{"success": true, "message": "模式未变更"})
		return
	}

	// Step 1: 读取当前远程 Xray 配置
	configResult, err := h.forwardToRemoteServer(ctx, id, http.MethodGet, "/api/child/xray/config", nil)
	if err != nil {
		remoteWriteError(w, http.StatusBadGateway, fmt.Sprintf("读取远程 Xray 配置失败: %v", err))
		return
	}

	var configResp struct {
		Success bool   `json:"success"`
		Config  string `json:"config"`
	}
	if err := json.Unmarshal(configResult, &configResp); err != nil || !configResp.Success {
		remoteWriteError(w, http.StatusBadGateway, "解析远程 Xray 配置失败")
		return
	}

	var xrayConfig map[string]any
	if err := json.Unmarshal([]byte(configResp.Config), &xrayConfig); err != nil {
		remoteWriteError(w, http.StatusBadGateway, "解析 Xray JSON 配置失败")
		return
	}

	// Step 2: 提取用户入站（过滤 api 和 tunnel）
	userInbounds := extractUserInbounds(xrayConfig)

	// Step 3: 转换用户入站的 listen 地址
	convertInboundsForMode(userInbounds, oldMode, req.StealMode)

	// Step 4: 更新 DB steal_mode
	if err := h.repo.UpdateRemoteServerStealMode(ctx, id, req.StealMode); err != nil {
		remoteWriteError(w, http.StatusInternalServerError, fmt.Sprintf("更新 steal_mode 失败: %v", err))
		return
	}

	// Step 5: 部署新模式基础配置（nginx + xray 模板）
	if req.StealMode != "default" && server.Domain != "" {
		if err := h.DeployStealSelfConfig(ctx, id); err != nil {
			log.Printf("[SwitchStealMode] Deploy config failed for server %d: %v", id, err)
		}
	}

	// Step 6: 将用户入站注入新配置
	if len(userInbounds) > 0 {
		h.injectUserInbounds(ctx, id, userInbounds, req.StealMode)
	}

	// Step 7: 重启 xray
	h.forwardToRemoteServer(ctx, id, http.MethodPost, "/api/child/services/control", []byte(`{"service":"xray","action":"restart"}`))

	// Step 8: 删除旧节点并重新同步
	if deleted, err := h.repo.DeleteNodesByOriginalServer(ctx, server.Name); err == nil && deleted > 0 {
		log.Printf("[SwitchStealMode] Deleted %d old nodes for server %s", deleted, server.Name)
	}
	syncResult := h.syncInboundsToNodesInternal(ctx, id)
	log.Printf("[SwitchStealMode] Sync result: synced=%d, skipped=%d", syncResult.SyncedCount, syncResult.SkippedCount)

	remoteWriteJSON(w, http.StatusOK, map[string]any{
		"success":      true,
		"message":      fmt.Sprintf("模式已从 %s 切换为 %s", oldMode, req.StealMode),
		"synced_count": syncResult.SyncedCount,
	})
}

func extractUserInbounds(config map[string]any) []map[string]any {
	inboundsRaw, ok := config["inbounds"].([]any)
	if !ok {
		return nil
	}
	var result []map[string]any
	for _, item := range inboundsRaw {
		inbound, ok := item.(map[string]any)
		if !ok {
			continue
		}
		tag, _ := inbound["tag"].(string)
		protocol, _ := inbound["protocol"].(string)
		if tag == "api" || protocol == "tunnel" || tag == "tunnel-in" {
			continue
		}
		result = append(result, inbound)
	}
	return result
}

func convertInboundsForMode(inbounds []map[string]any, oldMode, newMode string) {
	toTunnel := newMode == "tunnel"
	fromTunnel := oldMode == "tunnel"

	if fromTunnel && !toTunnel {
		for _, inbound := range inbounds {
			listen, _ := inbound["listen"].(string)
			if listen == "127.0.0.1" {
				inbound["listen"] = "0.0.0.0"
			}
		}
	} else if !fromTunnel && toTunnel {
		for _, inbound := range inbounds {
			listen, _ := inbound["listen"].(string)
			if listen == "0.0.0.0" || listen == "" {
				inbound["listen"] = "127.0.0.1"
			}
		}
	}
}

func (h *RemoteManageHandler) injectUserInbounds(ctx context.Context, serverID int64, userInbounds []map[string]any, newMode string) {
	configResult, err := h.forwardToRemoteServer(ctx, serverID, http.MethodGet, "/api/child/xray/config", nil)
	if err != nil {
		log.Printf("[SwitchStealMode] Failed to re-read config after deploy: %v", err)
		return
	}

	var configResp struct {
		Success bool   `json:"success"`
		Config  string `json:"config"`
	}
	if err := json.Unmarshal(configResult, &configResp); err != nil || !configResp.Success {
		log.Printf("[SwitchStealMode] Failed to parse re-read config")
		return
	}

	var newConfig map[string]any
	if err := json.Unmarshal([]byte(configResp.Config), &newConfig); err != nil {
		log.Printf("[SwitchStealMode] Failed to parse new config JSON")
		return
	}

	// 追加用户入站
	existingInbounds, _ := newConfig["inbounds"].([]any)
	for _, ub := range userInbounds {
		existingInbounds = append(existingInbounds, ub)
	}
	newConfig["inbounds"] = existingInbounds

	// 清理 tunnel 相关路由规则（如果切离 tunnel）
	if newMode != "tunnel" {
		cleanTunnelRoutingRules(newConfig)
	}

	// 保存
	configJSON, err := json.Marshal(newConfig)
	if err != nil {
		log.Printf("[SwitchStealMode] Failed to marshal merged config")
		return
	}

	payload, _ := json.Marshal(map[string]string{"config": string(configJSON)})
	if _, err := h.forwardToRemoteServer(ctx, serverID, http.MethodPost, "/api/child/xray/config", payload); err != nil {
		log.Printf("[SwitchStealMode] Failed to save merged config: %v", err)
	}
}

func cleanTunnelRoutingRules(config map[string]any) {
	routing, ok := config["routing"].(map[string]any)
	if !ok {
		return
	}
	rulesRaw, ok := routing["rules"].([]any)
	if !ok {
		return
	}

	var cleaned []any
	for _, item := range rulesRaw {
		rule, ok := item.(map[string]any)
		if !ok {
			cleaned = append(cleaned, item)
			continue
		}
		tagsRaw, ok := rule["inboundTag"].([]any)
		if !ok {
			cleaned = append(cleaned, item)
			continue
		}
		isTunnelRule := false
		for _, t := range tagsRaw {
			if tag, ok := t.(string); ok && tag == "tunnel-in" {
				isTunnelRule = true
				break
			}
		}
		if !isTunnelRule {
			cleaned = append(cleaned, item)
		}
	}
	routing["rules"] = cleaned

	// 清理 nginx outbound
	if outboundsRaw, ok := config["outbounds"].([]any); ok {
		var cleanedOB []any
		for _, item := range outboundsRaw {
			ob, ok := item.(map[string]any)
			if !ok {
				cleanedOB = append(cleanedOB, item)
				continue
			}
			if tag, _ := ob["tag"].(string); tag == "nginx" {
				continue
			}
			cleanedOB = append(cleanedOB, item)
		}
		config["outbounds"] = cleanedOB
	}
}
