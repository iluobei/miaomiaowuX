package handler

import (
	"context"
	"encoding/json"
	"fmt"
	stdhttp "net/http"
	"time"

	"miaomiaowu/internal/auth"
	"miaomiaowu/internal/storage"
	"miaomiaowu/internal/xrpc/client"
	"miaomiaowu/internal/xrpc/services/handler"

	statspb "github.com/xtls/xray-core/app/stats/command"
)

type XrayHandler struct {
	repo       *storage.TrafficRepository
	httpClient *stdhttp.Client
}

func NewXrayHandler(repo *storage.TrafficRepository) *XrayHandler {
	return &XrayHandler{
		repo: repo,
		httpClient: &stdhttp.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// XrayClient 表示与 Xray gRPC API 的连接
type XrayClient struct {
	*client.Clients
}

// 建立与 Xray 实例的连接
func (h *XrayHandler) ConnectToXray(ctx context.Context, host string, port int) (*XrayClient, error) {
	clients, err := client.New(ctx, host, uint16(port))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Xray at %s:%d: %w", host, port, err)
	}
	return &XrayClient{Clients: clients}, nil
}

// 请求/响应结构
type AddOutboundRequest struct {
	Tag     string                 `json:"tag"`
	Type    string                 `json:"type"`
	Options map[string]interface{} `json:"options"`
}

type AddOutboundResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type RemoveOutboundRequest struct {
	Tag string `json:"tag"`
}

type ListOutboundsRequest struct{}

type OutboundInfo struct {
	Tag string `json:"tag"`
}

type ListOutboundsResponse struct {
	Success   bool           `json:"success"`
	Message   string         `json:"message"`
	Outbounds []OutboundInfo `json:"outbounds"`
}

type StatsRequest struct {
	Name  string `json:"name"`
	Reset bool   `json:"reset"`
}

type StatsResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Value   int64  `json:"value,omitempty"`
}

type SystemStatsResponse struct {
	Success bool                      `json:"success"`
	Message string                    `json:"message"`
	Stats   *statspb.SysStatsResponse `json:"stats,omitempty"`
}

// HTTP 处理程序

func (h *XrayHandler) AddOutbound(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost {
		stdhttp.Error(w, "Method not allowed", stdhttp.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	username := auth.UsernameFromContext(ctx)
	if username == "" {
		stdhttp.Error(w, "Unauthorized", stdhttp.StatusUnauthorized)
		return
	}

	var req AddOutboundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		stdhttp.Error(w, "Invalid request body", stdhttp.StatusBadRequest)
		return
	}

	// 从用户设置获取 Xray 连接设置或使用默认值
	xrayHost, xrayPort, err := h.getXraySettings(ctx, username)
	if err != nil {
		stdhttp.Error(w, err.Error(), stdhttp.StatusInternalServerError)
		return
	}

	client, err := h.ConnectToXray(ctx, xrayHost, xrayPort)
	if err != nil {
		h.writeErrorResponse(w, "Failed to connect to Xray", err)
		return
	}
	defer client.Connection.Close()

	var addErr error
	switch req.Type {
	case "freedom":
		addErr = handler.AddFreedomOutbound(ctx, client.Handler, req.Tag)
	case "blackhole":
		addErr = handler.AddBlackholeOutbound(ctx, client.Handler, req.Tag)
	case "http":
		addErr = handler.AddHTTPOutbound(ctx, client.Handler, req.Tag)
	case "socks":
		addErr = handler.AddSocksOutbound(ctx, client.Handler, req.Tag)
	default:
		stdhttp.Error(w, "Unsupported outbound type: "+req.Type, stdhttp.StatusBadRequest)
		return
	}

	response := AddOutboundResponse{
		Success: addErr == nil,
		Message: func() string {
			if addErr != nil {
				return addErr.Error()
			}
			return "Outbound added successfully"
		}(),
	}

	h.writeJSONResponse(w, response)
}

func (h *XrayHandler) RemoveOutbound(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodDelete {
		stdhttp.Error(w, "Method not allowed", stdhttp.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	username := auth.UsernameFromContext(ctx)
	if username == "" {
		stdhttp.Error(w, "Unauthorized", stdhttp.StatusUnauthorized)
		return
	}

	var req RemoveOutboundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		stdhttp.Error(w, "Invalid request body", stdhttp.StatusBadRequest)
		return
	}

	if req.Tag == "" {
		stdhttp.Error(w, "Tag is required", stdhttp.StatusBadRequest)
		return
	}

	// 获取 Xray 连接设置
	xrayHost, xrayPort, err := h.getXraySettings(ctx, username)
	if err != nil {
		stdhttp.Error(w, err.Error(), stdhttp.StatusInternalServerError)
		return
	}

	client, err := h.ConnectToXray(ctx, xrayHost, xrayPort)
	if err != nil {
		h.writeErrorResponse(w, "Failed to connect to Xray", err)
		return
	}
	defer client.Connection.Close()

	err = handler.RemoveOutbound(ctx, client.Handler, req.Tag)
	response := AddOutboundResponse{
		Success: err == nil,
		Message: func() string {
			if err != nil {
				return err.Error()
			}
			return "Outbound removed successfully"
		}(),
	}

	h.writeJSONResponse(w, response)
}

func (h *XrayHandler) ListOutbounds(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodGet {
		stdhttp.Error(w, "Method not allowed", stdhttp.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	username := auth.UsernameFromContext(ctx)
	if username == "" {
		stdhttp.Error(w, "Unauthorized", stdhttp.StatusUnauthorized)
		return
	}

	// 获取 Xray 连接设置
	xrayHost, xrayPort, err := h.getXraySettings(ctx, username)
	if err != nil {
		stdhttp.Error(w, err.Error(), stdhttp.StatusInternalServerError)
		return
	}

	client, err := h.ConnectToXray(ctx, xrayHost, xrayPort)
	if err != nil {
		h.writeErrorResponse(w, "Failed to connect to Xray", err)
		return
	}
	defer client.Connection.Close()

	tags, err := handler.ListInboundTags(ctx, client.Handler)
	response := ListOutboundsResponse{
		Success: err == nil,
		Message: func() string {
			if err != nil {
				return err.Error()
			}
			return "Success"
		}(),
		Outbounds: func() []OutboundInfo {
			if tags == nil {
				return []OutboundInfo{}
			}
			result := make([]OutboundInfo, len(tags))
			for i, tag := range tags {
				result[i] = OutboundInfo{Tag: tag}
			}
			return result
		}(),
	}

	h.writeJSONResponse(w, response)
}

func (h *XrayHandler) GetStats(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost {
		stdhttp.Error(w, "Method not allowed", stdhttp.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	username := auth.UsernameFromContext(ctx)
	if username == "" {
		stdhttp.Error(w, "Unauthorized", stdhttp.StatusUnauthorized)
		return
	}

	var req StatsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		stdhttp.Error(w, "Invalid request body", stdhttp.StatusBadRequest)
		return
	}

	if req.Name == "" {
		stdhttp.Error(w, "Stats name is required", stdhttp.StatusBadRequest)
		return
	}

	// 获取 Xray 连接设置
	xrayHost, xrayPort, err := h.getXraySettings(ctx, username)
	if err != nil {
		stdhttp.Error(w, err.Error(), stdhttp.StatusInternalServerError)
		return
	}

	client, err := h.ConnectToXray(ctx, xrayHost, xrayPort)
	if err != nil {
		h.writeErrorResponse(w, "Failed to connect to Xray", err)
		return
	}
	defer client.Connection.Close()

	// 使用 gRPC 查询统计信息
	statsResp, err := client.Stats.QueryStats(ctx, &statspb.QueryStatsRequest{
		Pattern: req.Name,
		Reset_:  req.Reset,
	})

	var value int64
	if statsResp != nil && len(statsResp.Stat) > 0 {
		value = statsResp.Stat[0].Value
	}

	response := StatsResponse{
		Success: err == nil,
		Message: func() string {
			if err != nil {
				return err.Error()
			}
			return "Success"
		}(),
		Value: value,
	}

	h.writeJSONResponse(w, response)
}

func (h *XrayHandler) GetSystemStats(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodGet {
		stdhttp.Error(w, "Method not allowed", stdhttp.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	username := auth.UsernameFromContext(ctx)
	if username == "" {
		stdhttp.Error(w, "Unauthorized", stdhttp.StatusUnauthorized)
		return
	}

	// 获取 Xray 连接设置
	xrayHost, xrayPort, err := h.getXraySettings(ctx, username)
	if err != nil {
		stdhttp.Error(w, err.Error(), stdhttp.StatusInternalServerError)
		return
	}

	client, err := h.ConnectToXray(ctx, xrayHost, xrayPort)
	if err != nil {
		h.writeErrorResponse(w, "Failed to connect to Xray", err)
		return
	}
	defer client.Connection.Close()

	sysStats, err := client.Stats.GetSysStats(ctx, &statspb.SysStatsRequest{})
	response := SystemStatsResponse{
		Success: err == nil,
		Message: func() string {
			if err != nil {
				return err.Error()
			}
			return "Success"
		}(),
		Stats: sysStats,
	}

	h.writeJSONResponse(w, response)
}

// 辅助函数

func (h *XrayHandler) getXraySettings(ctx context.Context, username string) (string, int, error) {
	// 默认设置
	defaultHost := "127.0.0.1"
	defaultPort := 10085

	if h.repo == nil {
		return defaultHost, defaultPort, nil
	}

	// 从用户设置中解析 Xray 设置或使用默认值
	// 您可以扩展 UserSettings 结构以包含 XrayHost 和 XrayPort
	host := defaultHost
	port := defaultPort

	// 目前，使用默认值，但您可以扩展它以从设置中读取
	return host, port, nil
}

func (h *XrayHandler) writeErrorResponse(w stdhttp.ResponseWriter, message string, err error) {
	response := AddOutboundResponse{
		Success: false,
		Message: fmt.Sprintf("%s: %v", message, err),
	}
	h.writeJSONResponse(w, response)
}

func (h *XrayHandler) writeJSONResponse(w stdhttp.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(stdhttp.StatusOK)
	json.NewEncoder(w).Encode(data)
}
