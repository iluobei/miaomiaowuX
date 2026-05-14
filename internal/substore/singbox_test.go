package substore

import (
	"encoding/json"
	"testing"
)

func TestPassthroughExtraFields(t *testing.T) {
	p := NewSingboxProducer()

	tests := []struct {
		name       string
		proxy      Proxy
		parsed     map[string]interface{}
		wantKeys   map[string]interface{}
		absentKeys []string
	}{
		{
			name: "custom kebab-case field passes through as snake_case",
			proxy: Proxy{
				"name":           "test",
				"type":           "vmess",
				"server":         "1.2.3.4",
				"port":           443,
				"interface-name": "eth0",
				"routing-mark":   100,
			},
			parsed: map[string]interface{}{
				"tag":         "test",
				"type":        "vmess",
				"server":      "1.2.3.4",
				"server_port": 443,
			},
			wantKeys: map[string]interface{}{
				"interface_name": "eth0",
				"routing_mark":   100,
			},
			absentKeys: []string{"name", "port"},
		},
		{
			name: "consumed Clash fields are not passed through",
			proxy: Proxy{
				"name":     "node1",
				"type":     "trojan",
				"server":   "example.com",
				"port":     443,
				"password": "secret",
				"sni":      "example.com",
				"udp":      true,
			},
			parsed: map[string]interface{}{
				"tag":         "node1",
				"type":        "trojan",
				"server":      "example.com",
				"server_port": 443,
				"password":    "secret",
			},
			wantKeys:   map[string]interface{}{},
			absentKeys: []string{"name", "port", "sni", "udp"},
		},
		{
			name: "snake_case field not already in parsed passes through",
			proxy: Proxy{
				"name":            "test",
				"type":            "vless",
				"server":          "1.2.3.4",
				"port":            443,
				"custom_option":   "value1",
				"another_setting": 42,
			},
			parsed: map[string]interface{}{
				"tag":         "test",
				"type":        "vless",
				"server":      "1.2.3.4",
				"server_port": 443,
			},
			wantKeys: map[string]interface{}{
				"custom_option":   "value1",
				"another_setting": 42,
			},
			absentKeys: []string{"name", "port"},
		},
		{
			name: "does not overwrite existing parsed field",
			proxy: Proxy{
				"name":   "test",
				"type":   "ss",
				"server": "1.2.3.4",
				"port":   443,
			},
			parsed: map[string]interface{}{
				"tag":         "test",
				"type":        "shadowsocks",
				"server":      "1.2.3.4",
				"server_port": 443,
			},
			wantKeys:   map[string]interface{}{"type": "shadowsocks"},
			absentKeys: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p.passthroughExtraFields(tt.proxy, tt.parsed)

			for key, want := range tt.wantKeys {
				got, exists := tt.parsed[key]
				if !exists {
					t.Errorf("expected key %q in parsed, but not found", key)
					continue
				}
				if got != want {
					t.Errorf("key %q = %v, want %v", key, got, want)
				}
			}

			for _, key := range tt.absentKeys {
				if _, exists := tt.parsed[key]; exists {
					t.Errorf("key %q should not be in parsed, but found", key)
				}
			}
		})
	}
}

func TestSingboxProducePassthroughIntegration(t *testing.T) {
	p := NewSingboxProducer()

	proxies := []Proxy{
		{
			"name":            "vmess-node",
			"type":            "vmess",
			"server":          "1.2.3.4",
			"port":            443,
			"uuid":            "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
			"alterId":         0,
			"cipher":          "auto",
			"interface-name":  "eth0",
			"routing-mark":    255,
			"mptcp":           true,
			"my-custom-field": "hello",
		},
	}

	result, err := p.Produce(proxies, "external", nil)
	if err != nil {
		t.Fatalf("Produce failed: %v", err)
	}

	jsonStr, ok := result.(string)
	if !ok {
		t.Fatalf("expected string result, got %T", result)
	}

	var output map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &output); err != nil {
		t.Fatalf("failed to parse JSON output: %v", err)
	}

	outbounds, ok := output["outbounds"].([]interface{})
	if !ok || len(outbounds) == 0 {
		t.Fatalf("expected outbounds array with at least 1 entry")
	}

	node, ok := outbounds[0].(map[string]interface{})
	if !ok {
		t.Fatalf("expected outbound to be a map")
	}

	checks := map[string]interface{}{
		"interface_name":  "eth0",
		"routing_mark":    float64(255),
		"mptcp":           true,
		"my_custom_field": "hello",
	}

	for key, want := range checks {
		got, exists := node[key]
		if !exists {
			t.Errorf("expected key %q in output, not found. Full node: %v", key, node)
			continue
		}
		if got != want {
			t.Errorf("key %q = %v (%T), want %v (%T)", key, got, got, want, want)
		}
	}

	for _, key := range []string{"name", "port", "cipher", "alterId"} {
		if _, exists := node[key]; exists {
			t.Errorf("consumed Clash key %q should not appear in output", key)
		}
	}
}
