package event

import "sync"

// Bus 事件总线
type Bus struct {
	mu        sync.RWMutex
	listeners map[EventType][]Listener
}

var globalBus *Bus
var once sync.Once

// 获取全局事件总线单例
func GetBus() *Bus {
	once.Do(func() {
		globalBus = &Bus{
			listeners: make(map[EventType][]Listener),
		}
	})
	return globalBus
}

// 订阅事件
func (b *Bus) Subscribe(eventType EventType, listener Listener) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.listeners[eventType] = append(b.listeners[eventType], listener)
}

// 发布事件
func (b *Bus) Publish(event InboundEvent) {
	b.mu.RLock()
	listeners := b.listeners[event.Type]
	b.mu.RUnlock()

	for _, listener := range listeners {
		listener.Handle(event)
	}
}

// 异步发布事件
func (b *Bus) PublishAsync(event InboundEvent) {
	go b.Publish(event)
}
