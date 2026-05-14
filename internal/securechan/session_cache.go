package securechan

import (
	"sync"
	"time"
)

type cacheEntry struct {
	session   *Session
	expiresAt time.Time
}

type SessionCache struct {
	mu      sync.RWMutex
	entries map[string]*cacheEntry
	ttl     time.Duration
}

func NewSessionCache(ttl time.Duration) *SessionCache {
	c := &SessionCache{
		entries: make(map[string]*cacheEntry),
		ttl:     ttl,
	}
	go c.cleanupLoop()
	return c
}

func (c *SessionCache) Get(token string) *Session {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[token]
	if !ok || time.Now().After(e.expiresAt) {
		return nil
	}
	return e.session
}

func (c *SessionCache) Set(token string, s *Session) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[token] = &cacheEntry{
		session:   s,
		expiresAt: time.Now().Add(c.ttl),
	}
}

func (c *SessionCache) Delete(token string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, token)
}

func (c *SessionCache) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		c.mu.Lock()
		now := time.Now()
		for k, e := range c.entries {
			if now.After(e.expiresAt) {
				delete(c.entries, k)
			}
		}
		c.mu.Unlock()
	}
}
