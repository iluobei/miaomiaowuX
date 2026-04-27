package agentlog

import (
	"log"
	"sync/atomic"
)

var enabled atomic.Bool

func SetEnabled(v bool) { enabled.Store(v) }
func Enabled() bool     { return enabled.Load() }

func Printf(format string, args ...any) {
	if enabled.Load() {
		log.Printf(format, args...)
	}
}
