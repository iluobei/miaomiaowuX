package child

import (
	"testing"
	"time"
)

func TestCalculateBackoffExponentialAndCapped(t *testing.T) {
	client := &Client{}

	want := []time.Duration{
		5 * time.Second,
		10 * time.Second,
		20 * time.Second,
		40 * time.Second,
		80 * time.Second,
		160 * time.Second,
		5 * time.Minute,
		5 * time.Minute,
	}

	for i, expected := range want {
		got := client.calculateBackoff()
		if got != expected {
			t.Fatalf("attempt %d: expected %v, got %v", i+1, expected, got)
		}
	}
}

func TestCalculateBackoffResetStartsFromBase(t *testing.T) {
	client := &Client{}

	_ = client.calculateBackoff()
	_ = client.calculateBackoff()
	_ = client.calculateBackoff()

	client.reconnects = 0

	if got := client.calculateBackoff(); got != reconnectBackoffBase {
		t.Fatalf("expected reset backoff %v, got %v", reconnectBackoffBase, got)
	}
}
