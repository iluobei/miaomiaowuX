package notify

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const telegramAPIBase = "https://api.telegram.org/bot"

var httpClient = &http.Client{Timeout: 10 * time.Second}

func sendTelegram(ctx context.Context, botToken, chatID, text string) error {
	if botToken == "" || chatID == "" {
		return fmt.Errorf("bot token or chat ID is empty")
	}

	endpoint := telegramAPIBase + botToken + "/sendMessage"
	params := url.Values{
		"chat_id":    {chatID},
		"text":       {text},
		"parse_mode": {"Markdown"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.URL.RawQuery = params.Encode()

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send telegram: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var result struct {
			OK          bool   `json:"ok"`
			Description string `json:"description"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&result)
		return fmt.Errorf("telegram API error (status %d): %s", resp.StatusCode, result.Description)
	}

	return nil
}
