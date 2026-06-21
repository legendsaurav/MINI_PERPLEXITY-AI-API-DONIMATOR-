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
	selectorFileInput    = `input[type="file"]`
	selectorAttachment   = `[data-testid="attachment-item"], .file-attachment`
	selectorProgress     = `div[role="progressbar"], .spinner, .upload-spinner`
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

func (p *ChatGPTProvider) Initialize(ctx context.Context) error {
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

func (p *ChatGPTProvider) OpenWorkspace(ctx context.Context, projectMetadata map[string]interface{}) error {
	var conversationURL string
	if projectMetadata != nil {
		if val, ok := projectMetadata["conversation_url"]; ok {
			conversationURL, _ = val.(string)
		} else if val, ok := projectMetadata["conversation_reference"]; ok {
			conversationURL, _ = val.(string)
		}
	}

	if conversationURL == "" {
		slog.Info("[ChatGPT] Opening new conversation")
		return p.engine.Navigate(ctx, p.baseURL)
	}

	fullURL := conversationURL
	if !strings.HasPrefix(conversationURL, "http") {
		fullURL = p.baseURL + conversationURL
	}

	slog.Info("[ChatGPT] Restoring conversation", "url", fullURL)
	if err := p.engine.Navigate(ctx, fullURL); err != nil {
		return fmt.Errorf("failed to navigate to conversation: %w", err)
	}

	return p.engine.WaitForSelector(ctx, selectorTextarea, 10000)
}

func (p *ChatGPTProvider) UploadFiles(ctx context.Context, files []providers.FileAttachment) error {
	if len(files) == 0 {
		return nil
	}

	slog.Info("[ChatGPT] Uploading files", "count", len(files))

	// Check if stub engine is used
	if _, ok := p.engine.(*engine.StubEngine); ok {
		slog.Debug("[ChatGPT] StubEngine detected: simulating uploads")
		return nil
	}

	// Make sure file input element is ready
	if err := p.engine.WaitForSelector(ctx, selectorFileInput, 10000); err != nil {
		// Sometimes file inputs are added dynamically; try a small delay or inject if needed.
		slog.Warn("[ChatGPT] File input input[type='file'] not found immediately, trying fallback")
	}

	// Upload each file
	for _, file := range files {
		var err error
		// Retry loop (max 3 attempts)
		for attempt := 1; attempt <= 3; attempt++ {
			slog.Info("[ChatGPT] Uploading file", "path", file.Filename, "attempt", attempt)
			err = p.engine.UploadFile(ctx, selectorFileInput, file.Filename)
			if err == nil {
				break
			}
			slog.Warn("[ChatGPT] File upload attempt failed", "attempt", attempt, "error", err)
			time.Sleep(1 * time.Second)
		}
		if err != nil {
			return fmt.Errorf("failed to upload file %s after 3 attempts: %w", file.Filename, err)
		}
	}

	return nil
}

func (p *ChatGPTProvider) WaitForUploadCompletion(ctx context.Context) error {
	// Check if stub engine is used
	if _, ok := p.engine.(*engine.StubEngine); ok {
		time.Sleep(1 * time.Second) // Simulate progress delay
		return nil
	}

	// Wait for progress spinners to disappear and attachment items to appear
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	timeout := time.After(3 * time.Minute)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timeout:
			return fmt.Errorf("timeout waiting for upload completion")
		case <-ticker.C:
			// Run a JS evaluation checking if upload is complete and progress is 100% (no active spinners inside attachment)
			checkScript := `
				(() => {
					const attachments = document.querySelectorAll('[data-testid="attachment-item"], .file-attachment');
					if (attachments.length === 0) return 'no_attachments';
					for (const att of attachments) {
						const progress = att.querySelector('div[role="progressbar"], .spinner, .upload-spinner, .progressbar');
						if (progress) {
							const rect = progress.getBoundingClientRect();
							if (rect.width > 0 && rect.height > 0) {
								return 'uploading';
							}
						}
					}
					return 'ready';
				})()
			`
			res, err := p.engine.EvaluateJS(ctx, checkScript)
			if err == nil && res == "ready" {
				slog.Info("[ChatGPT] File upload verified successfully (all attachments ready)")
				return nil
			}
		}
	}
}

func (p *ChatGPTProvider) WaitForAnalysisCompletion(ctx context.Context) error {
	// Check if stub engine is used
	if _, ok := p.engine.(*engine.StubEngine); ok {
		time.Sleep(1 * time.Second)
		return nil
	}

	// Wait until:
	// 1. Textarea is not disabled and not aria-disabled
	// 2. No progress indicators/spinners exist in body or attachments
	// 3. No "Analyzing", "indexing", or "uploading" text in the DOM
	// 4. Send button is present, enabled, and not aria-disabled
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	timeout := time.After(5 * time.Minute)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timeout:
			return fmt.Errorf("timeout waiting for provider analysis completion")
		case <-ticker.C:
			// Run a JS evaluation checking all conditions
			checkScript := `
				(() => {
					// 1. Check if textarea is active and editable
					const textarea = document.querySelector('#prompt-textarea');
					if (!textarea) return 'no_textarea';
					if (textarea.disabled || textarea.getAttribute('aria-disabled') === 'true') {
						return 'textarea_disabled';
					}

					// 2. Check if any progress spinners or upload indicators are visible
					const spinners = document.querySelectorAll('div[role="progressbar"], .spinner, .upload-spinner, .progressbar');
					for (const spinner of spinners) {
						const rect = spinner.getBoundingClientRect();
						if (rect.width > 0 && rect.height > 0) {
							return 'spinners_visible';
						}
					}

					// 3. Check attachments specifically
					const attachments = document.querySelectorAll('[data-testid="attachment-item"], .file-attachment');
					for (const att of attachments) {
						const progress = att.querySelector('div[role="progressbar"], .spinner, .upload-spinner, .progressbar');
						if (progress) return 'attachment_spinner_visible';
					}

					// 4. Check for any "Analyzing", "indexing", or "uploading" labels in the DOM
					const bodyText = document.body.innerText || "";
					const lowerText = bodyText.toLowerCase();
					if (lowerText.includes("analyzing") || lowerText.includes("indexing") || lowerText.includes("uploading")) {
						return 'analyzing_or_indexing';
					}

					// 5. Check if send button is present and enabled
					const sendBtn = document.querySelector('button[data-testid="send-button"]');
					if (!sendBtn) return 'no_send_button';
					if (sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true') {
						return 'send_button_disabled';
					}

					return 'ready';
				})()
			`

			res, err := p.engine.EvaluateJS(ctx, checkScript)
			if err == nil && res == "ready" {
				slog.Info("[ChatGPT] Provider analysis complete. Ready for prompt.")
				return nil
			} else if err != nil {
				slog.Debug("[ChatGPT] EvaluateJS error in WaitForAnalysisCompletion", "error", err)
			} else {
				slog.Debug("[ChatGPT] Waiting for readiness", "status", res)
			}
		}
	}
}

func (p *ChatGPTProvider) SendMessage(ctx context.Context, req providers.MessageRequest) error {
	if req.Text == "" {
		return fmt.Errorf("message text cannot be empty")
	}

	slog.Info("[ChatGPT] Submitting prompt", "text_len", len(req.Text))

	if err := p.engine.WaitForSelector(ctx, selectorTextarea, 10000); err != nil {
		return fmt.Errorf("textarea not found: %w", err)
	}

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

	time.Sleep(200 * time.Millisecond)

	if err := p.engine.Click(ctx, selectorSendButton); err != nil {
		slog.Warn("[ChatGPT] Send button click failed, trying Enter key", "error", err)
		if err := p.engine.PressKey(ctx, "Enter"); err != nil {
			return fmt.Errorf("failed to submit message: %w", err)
		}
	}

	slog.Info("[ChatGPT] Prompt submitted")
	return nil
}

func (p *ChatGPTProvider) StreamResponse(ctx context.Context) (<-chan providers.StreamChunk, error) {
	ch := make(chan providers.StreamChunk, 100)

	go func() {
		defer close(ch)

		// Check if stub engine is used
		if _, ok := p.engine.(*engine.StubEngine); ok {
			// Simulate response stream
			tokens := []string{"Here ", "is ", "a ", "simulated ", "response ", "from ", "ChatGPT ", "stub."}
			for _, token := range tokens {
				select {
				case <-ctx.Done():
					return
				default:
					ch <- providers.StreamChunk{
						Type:    "text",
						Content: token,
					}
					time.Sleep(200 * time.Millisecond)
				}
			}
			return
		}

		var lastText string
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()

		timeout := time.After(3 * time.Minute)
		stableCount := 0

		for {
			select {
			case <-ctx.Done():
				ch <- providers.StreamChunk{Type: "error", Content: "cancelled"}
				return
			case <-timeout:
				ch <- providers.StreamChunk{Type: "done", Content: ""}
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
					if len(text) > len(lastText) {
						delta := text[len(lastText):]
						ch <- providers.StreamChunk{
							Type:    "text",
							Content: delta,
						}
					}
					lastText = text
				} else {
					stableCount++
					if stableCount > 15 && lastText != "" {
						ch <- providers.StreamChunk{Type: "done", Content: ""}
						return
					}
				}
			}
		}
	}()

	return ch, nil
}

func (p *ChatGPTProvider) Cancel(ctx context.Context) error {
	slog.Info("[ChatGPT] Cancelling generation")
	return p.engine.Click(ctx, selectorStopButton)
}

func (p *ChatGPTProvider) Health(ctx context.Context) error {
	_, err := p.engine.GetURL(ctx)
	if err != nil {
		return fmt.Errorf("failed to check browser engine status: %w", err)
	}
	return nil
}

func (p *ChatGPTProvider) Shutdown(ctx context.Context) error {
	slog.Info("[ChatGPT] Shutting down")
	return p.engine.Shutdown(ctx)
}

func (p *ChatGPTProvider) Capabilities() providers.ProviderCapabilities {
	return providers.ProviderCapabilities{
		Streaming:     true,
		Vision:        true,
		FileUpload:    true,
		ImageUpload:   true,
		AudioUpload:   true,
		CodeExecution: true,
		ZipUpload:     true, // ChatGPT supports direct ZIP archives
	}
}
