package event

// EventType 事件类型
type EventType string

const (
	EventInboundAdded   EventType = "inbound.added"
	EventInboundRemoved EventType = "inbound.removed"
	EventInboundUpdated EventType = "inbound.updated"
)

// InboundEvent 入站事件数据
type InboundEvent struct {
	Type     EventType
	ServerID int64          // 服务器 ID
	Tag      string         // 入站 Tag
	Protocol string         // 协议类型
	Port     int            // 端口
	Inbound  map[string]any // 完整入站配置 (添加/更新时)
}

// Listener 事件监听器接口
type Listener interface {
	Handle(event InboundEvent)
}
