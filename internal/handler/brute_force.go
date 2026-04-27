package handler

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"miaomiaowu/internal/logger"
)

var globalBruteForceProtector *BruteForceProtector

type bruteForceRecord struct {
	count      int
	firstTime  time.Time
	blockUntil time.Time
}

type BruteForceProtector struct {
	attempts      sync.Map // IP -> *bruteForceRecord
	maxFailures   int
	window        time.Duration
	blockDuration time.Duration
}

func NewBruteForceProtector() *BruteForceProtector {
	p := &BruteForceProtector{
		maxFailures:   20,
		window:        10 * time.Minute,
		blockDuration: time.Hour,
	}
	globalBruteForceProtector = p
	return p
}

func GetBruteForceProtector() *BruteForceProtector {
	return globalBruteForceProtector
}

func (p *BruteForceProtector) IsBlocked(ip, path string) bool {
	val, ok := p.attempts.Load(ip)
	if !ok {
		return false
	}
	rec := val.(*bruteForceRecord)

	now := time.Now()
	if !rec.blockUntil.IsZero() && now.Before(rec.blockUntil) {
		logger.Warn("🚫🚫🚫 [BRUTE_FORCE] 已封禁IP尝试访问，已拦截",
			"ip", ip,
			"访问路径", path,
			"封禁剩余", rec.blockUntil.Sub(now).Round(time.Second).String(),
		)
		return true
	}

	if !rec.blockUntil.IsZero() {
		logger.Info("✅ [BRUTE_FORCE] IP封禁已过期，已自动解除",
			"ip", ip,
		)
		p.attempts.Delete(ip)
	}
	return false
}

func (p *BruteForceProtector) RecordFailure(ip, path string) {
	now := time.Now()

	val, loaded := p.attempts.Load(ip)
	if !loaded {
		logger.Warn("⚠️ [BRUTE_FORCE] 订阅探测失败",
			"ip", ip,
			"访问路径", path,
			"次数", fmt.Sprintf("1/%d", p.maxFailures),
		)
		p.attempts.Store(ip, &bruteForceRecord{
			count:     1,
			firstTime: now,
		})
		return
	}

	rec := val.(*bruteForceRecord)

	if !rec.blockUntil.IsZero() && now.Before(rec.blockUntil) {
		return
	}

	if now.Sub(rec.firstTime) > p.window {
		logger.Warn("⚠️ [BRUTE_FORCE] 订阅探测失败（窗口重置）",
			"ip", ip,
			"访问路径", path,
			"次数", fmt.Sprintf("1/%d", p.maxFailures),
		)
		p.attempts.Store(ip, &bruteForceRecord{
			count:     1,
			firstTime: now,
		})
		return
	}

	rec.count++
	if rec.count >= p.maxFailures {
		rec.blockUntil = now.Add(p.blockDuration)
		logger.Warn("🚫🚫🚫 [BRUTE_FORCE] IP 已被封禁！",
			"ip", ip,
			"触发路径", path,
			"失败次数", rec.count,
			"封禁至", rec.blockUntil.Format("2006-01-02 15:04:05"),
		)
	} else {
		logger.Warn("⚠️ [BRUTE_FORCE] 订阅探测失败",
			"ip", ip,
			"访问路径", path,
			"次数", fmt.Sprintf("%d/%d", rec.count, p.maxFailures),
		)
	}
}

func (p *BruteForceProtector) RecordSuccess(ip string) {
	p.attempts.Delete(ip)
}

// StatusRecorder wraps http.ResponseWriter to capture the status code.
type StatusRecorder struct {
	http.ResponseWriter
	StatusCode int
}

func (r *StatusRecorder) WriteHeader(code int) {
	r.StatusCode = code
	r.ResponseWriter.WriteHeader(code)
}
