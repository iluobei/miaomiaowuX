package handler

import "miaomiaowux/internal/notify"

var globalNotifier *notify.Notifier

func InitNotifier(cfg notify.Config) {
	globalNotifier = notify.New(cfg)
}

func GetNotifier() *notify.Notifier {
	return globalNotifier
}
