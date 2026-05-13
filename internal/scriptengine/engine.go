package scriptengine

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"miaomiaowux/internal/logger"
	"miaomiaowux/internal/substore"

	"github.com/dop251/goja"
)

const defaultTimeout = 5 * time.Second

func setupVM(vm *goja.Runtime) {
	console := vm.NewObject()
	makeLogFn := func(level string) func(goja.FunctionCall) goja.Value {
		return func(call goja.FunctionCall) goja.Value {
			parts := make([]string, len(call.Arguments))
			for i, arg := range call.Arguments {
				parts[i] = fmt.Sprintf("%v", arg.Export())
			}
			msg := strings.Join(parts, " ")
			switch level {
			case "warn":
				logger.Warn("[OverrideScript]", "console.warn", msg)
			case "error":
				logger.Error("[OverrideScript]", "console.error", msg)
			default:
				logger.Info("[OverrideScript]", "console.log", msg)
			}
			return goja.Undefined()
		}
	}
	console.Set("log", makeLogFn("log"))
	console.Set("warn", makeLogFn("warn"))
	console.Set("error", makeLogFn("error"))
	vm.Set("console", console)

	vm.Set("produce", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) < 2 {
			panic(vm.ToValue("produce(proxies, targetFormat): requires 2 arguments"))
		}

		proxiesRaw := call.Arguments[0].Export()
		targetFormat := call.Arguments[1].String()

		arr, ok := proxiesRaw.([]interface{})
		if !ok {
			panic(vm.ToValue("produce: first argument must be an array of proxy objects"))
		}

		proxies := make([]substore.Proxy, 0, len(arr))
		for _, item := range arr {
			if m, ok := item.(map[string]interface{}); ok {
				proxies = append(proxies, substore.Proxy(m))
			}
		}

		result, err := substore.GetDefaultFactory().ConvertProxies(proxies, targetFormat, &substore.ProduceOptions{})
		if err != nil {
			panic(vm.ToValue("produce: " + err.Error()))
		}

		return vm.ToValue(result)
	})
}

// RunPostFetch executes a "post_fetch" script against a full config map.
// The script must define: function main(config) { ... return config; }
func RunPostFetch(ctx context.Context, script string, config map[string]interface{}) (map[string]interface{}, error) {
	vm := goja.New()
	setupVM(vm)

	jsonBytes, err := json.Marshal(config)
	if err != nil {
		return nil, fmt.Errorf("marshal config to JSON: %w", err)
	}

	if err := vm.Set("__raw_json__", string(jsonBytes)); err != nil {
		return nil, fmt.Errorf("set raw json: %w", err)
	}

	result, err := runWithTimeout(ctx, vm, "var __input__ = JSON.parse(__raw_json__);\n"+script+";\nmain(__input__);")
	if err != nil {
		return nil, err
	}

	exported := result.Export()
	if exported == nil {
		return config, nil
	}

	resultMap, ok := exported.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("script must return an object, got %T", exported)
	}

	return resultMap, nil
}

// RunPreSaveNodes executes a "pre_save_nodes" script against a proxies array.
// The script must define: function main(proxies) { ... return proxies; }
func RunPreSaveNodes(ctx context.Context, script string, proxies []map[string]interface{}) ([]map[string]interface{}, error) {
	vm := goja.New()
	setupVM(vm)

	jsonBytes, err := json.Marshal(proxies)
	if err != nil {
		return nil, fmt.Errorf("marshal proxies to JSON: %w", err)
	}

	if err := vm.Set("__raw_json__", string(jsonBytes)); err != nil {
		return nil, fmt.Errorf("set raw json: %w", err)
	}

	result, err := runWithTimeout(ctx, vm, "var __input__ = JSON.parse(__raw_json__);\n"+script+";\nmain(__input__);")
	if err != nil {
		return nil, err
	}

	exported := result.Export()
	if exported == nil {
		return proxies, nil
	}

	resultSlice, ok := exported.([]interface{})
	if !ok {
		return nil, fmt.Errorf("script must return an array, got %T", exported)
	}

	out := make([]map[string]interface{}, 0, len(resultSlice))
	for _, item := range resultSlice {
		if m, ok := item.(map[string]interface{}); ok {
			out = append(out, m)
		}
	}

	return out, nil
}

func runWithTimeout(ctx context.Context, vm *goja.Runtime, code string) (goja.Value, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	vm.ClearInterrupt()

	go func() {
		<-timeoutCtx.Done()
		if timeoutCtx.Err() == context.DeadlineExceeded {
			vm.Interrupt("script execution timeout (5s)")
		}
	}()

	result, err := vm.RunString(code)
	if err != nil {
		if interrupted, ok := err.(*goja.InterruptedError); ok {
			return nil, fmt.Errorf("script interrupted: %s", interrupted.Value())
		}
		return nil, fmt.Errorf("script error: %w", err)
	}

	return result, nil
}
