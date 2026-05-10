package notify

type EventType string

const (
	EventLogin            EventType = "login"
	EventSubscribeFetch   EventType = "subscribe_fetch"
	EventDailyTraffic     EventType = "daily_traffic"
	EventServerOffline    EventType = "server_offline"
	EventServerOnline     EventType = "server_online"
	EventTrafficThreshold EventType = "traffic_threshold"
)

type Config struct {
	Enabled                      bool
	BotToken                     string
	ChatID                       string
	NotifyLogin                  bool
	NotifySubscribeFetch         bool
	NotifyDailyTraffic           bool
	NotifyServerOffline          bool
	NotifyServerOnline           bool
	NotifyTrafficThreshold       bool
	DailyTrafficTime             string // "HH:MM"
	TrafficThresholdPercent      int    // 0-100
}

type Event struct {
	Type    EventType
	Title   string
	Message string
}
