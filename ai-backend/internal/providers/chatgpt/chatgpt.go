package chatgpt

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/proka/ai-backend/internal/engine"
	"github.com/proka/ai-backend/internal/providers"
)

// DOM selectors for ChatGPT
const (
	selectorTextarea     = "#prompt-textarea"
	selectorSendButton   = `button[data-testid="send-button"]`
	selectorResponseLast = ".markdown.prose"
	selectorLoginButton  = `[data-testid="login-button"]`
	selectorStopButton   = `button[aria-label="Stop generating"]`
)

// ChatGPTProvider implements the Provider interface for ChatGPT.
type ChatGPTProvider struct {
	engine  engine.BrowserEngine
	baseURL string
}

// New creates a new ChatGPT provider.
func New(eng engine.BrowserEngine) providers.Provider {
	return &ChatGPTProvider{
		engine:  eng,
		baseURL: "https://chatgpt.com",
	}
}

func (p *ChatGPTProvider) Name() string {
	return "chatgpt"
}

func (p *ChatGPTProvider) Initialize(ctx context.Context, eng engine.BrowserEngine) error {
	p.engine = eng
	slog.Info("[ChatGPT] Provider initialized")
	return nil
}

func (p *ChatGPTProvider) CheckSession(ctx context.Context) (bool, error) {
	// Check if we're on the ChatGPT domain
	url, err := p.engine.GetURL(ctx)
	if err != nil {
		return false, fmt.Errorf("failed to get URL: %w", err)
	}

	if !strings.Contains(url, "chatgpt.com") {
		return false, nil
	}

	// Check for login button presence
	visible, err := p.engine.IsElementVisible(ctx, selectorLoginButton)
	if err != nil {
		return false, fmt.Errorf("failed to check login button: %w", err)
	}

	isLoggedIn := !visible
	slog.Debug("[ChatGPT] Session check", "logged_in", isLoggedIn)
	return isLoggedIn, nil
}

func (p *ChatGPTProvider) OpenConversation(ctx context.Context, conversationURL string) error {
	if conversationURL == "" {
		// Navigate to base URL for a new conversation
		slog.Info("[ChatGPT] Opening new conversation")
		return p.engine.Navigate(ctx, p.baseURL)
	}

	// Navigate to existing conversation
	fullURL := conversationURL
	if !strings.HasPrefix(conversationURL, "http") {
		fullURL = p.baseURL + conversationURL
	}

	slog.Info("[ChatGPT] Restoring conversation", "url", fullURL)
	if err := p.engine.Navigate(ctx, fullURL); err != nil {
		return fmt.Errorf("failed to navigate to conversation: %w", err)
	}

	// Wait for the page to load
	return p.engine.WaitForSelector(ctx, selectorTextarea, 10000)
}

func (p *ChatGPTProvider) SendMessage(ctx context.Context, req providers.MessageRequest) error {
	if req.Text == "" {
		return fmt.Errorf("message text cannot be empty")
	}

	slog.Info("[ChatGPT] Sending message", "text_len", len(req.Text))

	// Wait for textarea to be ready
	if err := p.engine.WaitForSelector(ctx, selectorTextarea, 10000); err != nil {
		return fmt.Errorf("textarea not found: %w", err)
	}

	// Type the message using insertText for rich content support
	typeScript := fmt.Sprintf(`
		const textarea = document.querySelector('%s');
		if (textarea) {
			textarea.focus();
			document.execCommand('insertText', false, %q);
		}
	`, selectorTextarea, req.Text)

	if _, err := p.engine.EvaluateJS(ctx, typeScript); err != nil {
		return fmt.Errorf("failed to type message: %w", err)
	}

	// Small delay to let the UI process
	time.Sleep(200 * time.Millisecond)

	// Click send button
	if err := p.engine.Click(ctx, selectorSendButton); err != nil {
		// Fallback: press Enter
		slog.Warn("[ChatGPT] Send button click failed, trying Enter key", "error", err)
		if err := p.engine.PressKey(ctx, "Enter"); err != nil {
			return fmt.Errorf("failed to submit message: %w", err)
		}
	}

	slog.Info("[ChatGPT] Message submitted")
	return nil
}

func (p *ChatGPTProvider) StreamResponse(ctx context.Context) (<-chan providers.StreamChunk, error) {
	ch := make(chan providers.StreamChunk, 100)

	go func() {
		defer close(ch)

		// Attach a MutationObserver via JS to watch for response changes
		observerScript := `
			new Promise((resolve) => {
				let lastText = '';
				let stableCount = 0;
				const interval = setInterval(() => {
					const elements = document.querySelectorAll('.markdown.prose');
					const lastEl = elements[elements.length - 1];
					if (!lastEl) return;
					const currentText = lastEl.innerText;
					if (currentText === lastText) {
						stableCount++;
						if (stableCount > 10) {
							clearInterval(interval);
							resolve(currentText);
						}
					} else {
						stableCount = 0;
						lastText = currentText;
					}
				}, 500);

				// Timeout after 3 minutes
				setTimeout(() => {
					clearInterval(interval);
					resolve(lastText || 'Response timeout');
				}, 180000);
			});
		`

		// Poll for response text changes
		var lastText string
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()

		timeout := time.After(3 * time.Minute)
		stableCount := 0

		for {
			select {
			case <-ctx.Done():
				ch <- providers.StreamChunk{Error: "cancelled"}
				return
			case <-timeout:
				ch <- providers.StreamChunk{Data: lastText, Done: true}
				return
			case <-ticker.C:
				script := `
					(() => {
						const elements = document.querySelectorAll('.markdown.prose');
						const lastEl = elements[elements.length - 1];
						return lastEl ? lastEl.innerText : '';
					})();
				`
				text, err := p.engine.EvaluateJS(ctx, script)
				if err != nil {
					continue
				}

				if text != lastText && text != "" {
					stableCount = 0
					// Send the delta
					if len(text) > len(lastText) {
						delta := text[len(lastText):]
						ch <- providers.StreamChunk{Data: delta}
					}
					lastText = text
				} else {
					stableCount++
					if stableCount > 10 && lastText != "" {
						ch <- providers.StreamChunk{Data: "", Done: true}
						return
					}
				}
			}
		}

		// Suppress unused variable warning for observerScript
		_ = observerScript
	}()

	return ch, nil
}

func (p *ChatGPTProvider) Cancel(ctx context.Context) error {
	slog.Info("[ChatGPT] Cancelling generation")
	return p.engine.Click(ctx, selectorStopButton)
}

func (p *ChatGPTProvider) Shutdown(ctx context.Context) error {
	slog.Info("[ChatGPT] Shutting down")
	return p.engine.Shutdown(ctx)
}

func (p *ChatGPTProvider) Capabilities() providers.ProviderCapabilities {
	return providers.ProviderCapabilities{
		SupportsStreaming: true,
		SupportsVision:   true,
		SupportsFiles:    true,
		MaxImageSize:     20 * 1024 * 1024, // 20MB
	}
}
