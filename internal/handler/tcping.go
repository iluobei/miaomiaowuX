package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"time"
)

// TCPingRequest 表示 TCP ping 请求
type TCPingRequest struct {
	Host    string `json:"host"`
	Port    int    `json:"port"`
	Timeout int    `json:"timeout"` // 超时时间，单位毫秒，默认5000
}

// TCPingResponse 表示 TCP ping 响应
type TCPingResponse struct {
	Success bool    `json:"success"`
	Latency float64 `json:"latency"` // 延迟（以毫秒为单位）
	Error   string  `json:"error,omitempty"`
}

// 创建一个新的 TCP ping 处理程序
func NewTCPingHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "only POST is supported"})
			return
		}

		var req TCPingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
			return
		}

		if req.Host == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "host is required"})
			return
		}

		if req.Port <= 0 || req.Port > 65535 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid port"})
			return
		}

		timeout := req.Timeout
		if timeout <= 0 {
			timeout = 5000
		}
		if timeout > 30000 {
			timeout = 30000
		}

		address := net.JoinHostPort(req.Host, fmt.Sprintf("%d", req.Port))
		timeoutDuration := time.Duration(timeout) * time.Millisecond

		log.Printf("[TCPing] Testing %s with timeout %dms", address, timeout)

		start := time.Now()
		conn, err := net.DialTimeout("tcp", address, timeoutDuration)
		latency := float64(time.Since(start).Microseconds()) / 1000.0

		resp := TCPingResponse{}

		if err != nil {
			log.Printf("[TCPing] Connection failed: %s - %v", address, err)
			resp.Success = false
			resp.Error = err.Error()
		} else {
			conn.Close()
			log.Printf("[TCPing] Connection succeeded: %s - %.2fms", address, latency)
			resp.Success = true
			resp.Latency = latency
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	})
}

// 创建批处理 TCP ping 处理程序
func NewTCPingBatchHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "only POST is supported"})
			return
		}

		var requests []TCPingRequest
		if err := json.NewDecoder(r.Body).Decode(&requests); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body"})
			return
		}

		if len(requests) == 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "no nodes to test"})
			return
		}

		if len(requests) > 200 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "max 200 nodes allowed"})
			return
		}

		results := make([]TCPingResponse, len(requests))
		done := make(chan struct{}, len(requests))

		for i, req := range requests {
			go func(idx int, r TCPingRequest) {
				defer func() { done <- struct{}{} }()

				if r.Host == "" || r.Port <= 0 || r.Port > 65535 {
					results[idx] = TCPingResponse{Success: false, Error: "invalid host or port"}
					return
				}

				timeout := r.Timeout
				if timeout <= 0 {
					timeout = 5000
				}
				if timeout > 30000 {
					timeout = 30000
				}

				address := net.JoinHostPort(r.Host, fmt.Sprintf("%d", r.Port))
				timeoutDuration := time.Duration(timeout) * time.Millisecond

				start := time.Now()
				conn, err := net.DialTimeout("tcp", address, timeoutDuration)
				latency := float64(time.Since(start).Microseconds()) / 1000.0

				if err != nil {
					results[idx] = TCPingResponse{Success: false, Error: err.Error()}
				} else {
					conn.Close()
					results[idx] = TCPingResponse{Success: true, Latency: latency}
				}
			}(i, req)
		}

		for range requests {
			<-done
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(results)
	})
}
