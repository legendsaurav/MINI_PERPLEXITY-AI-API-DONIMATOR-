package claude

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/proka/ai-backend/internal/engine"
	"github.com/proka/ai-backend/internal/providers"
)

// DOM selectors for Claude
const (
	selectorTextarea     = `div[contenteditable="true"]`
	selectorSendButton   = `button[aria-label="Send Message"]`
	selectorLoginButton  = `a[href*="/login"]`
	selectorStopButton   = `button[aria-label="Stop response"]`
	selectorFileInput    = `input[type="file"]`
	selectorAttachment   = `.file-preview, [data-testid="file-attachment"]`
	selectorProgress     = `.spinner, .upload-spinner, progress`
)

type ClaudeProvider struct {
	engine  engine.BrowserEngine
	baseURL string
}

func New(eng engine.BrowserEngine) providers.Provider {
	return &ClaudeProvider{
		engine:  eng,
		baseURL: "https://claude.ai",
	}
}

func (p *ClaudeProvider) Name() string {
	return "claude"
}

func (p *ClaudeProvider) Initialize(ctx context.Context) error {
	slog.Info("[Claude] Provider initialized")
	return nil
}

func (p *ClaudeProvider) CheckSession(ctx context.Context) (bool, error) {
	url, err := p.engine.GetURL(ctx)
	if err != nil {
		return false, fmt.Errorf("failed to get URL: %w", err)
	}

	if !strings.Contains(url, "claude.ai") {
		return false, nil
	}

	visible, err := p.engine.IsElementVisible(ctx, selectorLoginButton)
	if err != nil {
		return false, fmt.Errorf("failed to check login button: %w", err)
	}

	return !visible, nil
}

func (p *ClaudeProvider) OpenWorkspace(ctx context.Context, projectMetadata map[string]interface{}) error {
	var conversationURL string
	if projectMetadata != nil {
		if val, ok := projectMetadata["conversation_url"]; ok {
			conversationURL, _ = val.(string)
		} else if val, ok := projectMetadata["conversation_reference"]; ok {
			conversationURL, _ = val.(string)
		}
	}

	if conversationURL == "" {
		slog.Info("[Claude] Opening new conversation")
		return p.engine.Navigate(ctx, p.baseURL)
	}

	fullURL := conversationURL
	if !strings.HasPrefix(conversationURL, "http") {
		fullURL = p.baseURL + conversationURL
	}

	slog.Info("[Claude] Restoring conversation", "url", fullURL)
	if err := p.engine.Navigate(ctx, fullURL); err != nil {
		return fmt.Errorf("failed to navigate to conversation: %w", err)
	}

	return p.engine.WaitForSelector(ctx, selectorTextarea, 10000)
}

func (p *ClaudeProvider) UploadFiles(ctx context.Context, files []providers.FileAttachment) error {
	if len(files) == 0 {
		return nil
	}

	slog.Info("[Claude] Uploading files", "count", len(files))

	if _, ok := p.engine.(*engine.StubEngine); ok {
		slog.Debug("[Claude] StubEngine detected: simulating uploads")
		return nil
	}

	if err := p.engine.WaitForSelector(ctx, selectorFileInput, 10000); err != nil {
		slog.Warn("[Claude] File input input[type='file'] not found immediately")
	}

	for _, file := range files {
		var err error
		for attempt := 1; attempt <= 3; attempt++ {
			slog.Info("[Claude] Uploading file", "path", file.Filename, "attempt", attempt)
			err = p.engine.UploadFile(ctx, selectorFileInput, file.Filename)
			if err == nil {
				break
			}
			slog.Warn("[Claude] File upload attempt failed", "attempt", attempt, "error", err)
			time.Sleep(1 * time.Second)
		}
		if err != nil {
			return fmt.Errorf("failed to upload file %s after 3 attempts: %w", file.Filename, err)
		}
	}

	return nil
}

func (p *ClaudeProvider) WaitForUploadCompletion(ctx context.Context) error {
	if _, ok := p.engine.(*engine.StubEngine); ok {
		time.Sleep(1 * time.Second)
		return nil
	}

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
			hasProgress, err := p.engine.IsElementVisible(ctx, selectorProgress)
			if err != nil {
				continue
			}

			hasAttachment, err := p.engine.IsElementVisible(ctx, selectorAttachment)
			if err != nil {
				continue
			}

			if !hasProgress && hasAttachment {
				slog.Info("[Claude] File upload verified successfully")
				return nil
			}
		}
	}
}

func (p *ClaudeProvider) WaitForAnalysisCompletion(ctx context.Context) error {
	if _, ok := p.engine.(*engine.StubEngine); ok {
		time.Sleep(1 * time.Second)
		return nil
	}

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	timeout := time.After(5 * time.Minute)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timeout:
			return fmt.Errorf("timeout waiting for Claude analysis completion")
		case <-ticker.C:
			checkScript := fmt.Sprintf(`
				(() => {
					// 1. Check if textarea is active
					const textarea = document.querySelector('%s');
					if (!textarea) return false;

					// 2. Check if progress bar or spinners are visible
					const spinners = document.querySelector('%s');
					if (spinners) return false;

					// 3. Verify send button is active/visible
					const sendBtn = document.querySelector('%s');
					if (!sendBtn || sendBtn.disabled) return false;

					return true;
				})()
			`, selectorTextarea, selectorProgress, selectorSendButton)

			res, err := p.engine.EvaluateJS(ctx, checkScript)
			if err == nil && res == "true" {
				slog.Info("[Claude] Claude ready for prompt.")
				return nil
			}
		}
	}
}

func (p *ClaudeProvider) SendMessage(ctx context.Context, req providers.MessageRequest) error {
	if req.Text == "" {
		return fmt.Errorf("message text cannot be empty")
	}

	slog.Info("[Claude] Submitting prompt", "text_len", len(req.Text))

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
		slog.Warn("[Claude] Send button click failed, trying Enter key", "error", err)
		if err := p.engine.PressKey(ctx, "Enter"); err != nil {
			return fmt.Errorf("failed to submit message: %w", err)
		}
	}

	slog.Info("[Claude] Prompt submitted")
	return nil
}

func (p *ClaudeProvider) StreamResponse(ctx context.Context) (<-chan providers.StreamChunk, error) {
	ch := make(chan providers.StreamChunk, 100)

	go func() {
		defer close(ch)

		if _, ok := p.engine.(*engine.StubEngine); ok {
			tokens := []string{"Hello ", "from ", "Claude ", "stub ", "response."}
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
						const elements = document.querySelectorAll('span.font-user-select-text');
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

func (p *ClaudeProvider) Cancel(ctx context.Context) error {
	return p.engine.Click(ctx, selectorStopButton)
}

func (p *ClaudeProvider) Health(ctx context.Context) error {
	_, err := p.engine.GetURL(ctx)
	return err
}

func (p *ClaudeProvider) Shutdown(ctx context.Context) error {
	return p.engine.Shutdown(ctx)
}

func (p *ClaudeProvider) Capabilities() providers.ProviderCapabilities {
	return providers.ProviderCapabilities{
		Streaming:     true,
		Vision:        true,
		FileUpload:    true,
		ImageUpload:   true,
		AudioUpload:   false,
		CodeExecution: false,
		ZipUpload:     false, // Claude does NOT support direct ZIP uploads; triggers fallback extraction
	}
}
