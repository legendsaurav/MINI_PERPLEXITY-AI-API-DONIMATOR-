package googlesearch

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/proka/ai-backend/internal/engine"
	"github.com/proka/ai-backend/internal/providers"
)

// DOM selectors for Google Search AI
const (
	selectorTextarea     = `textarea[type="search"], input[name="q"]`
	selectorSendButton   = `input[type="submit"], button[type="submit"]`
	selectorLoginButton  = `a[href*="accounts.google.com"]`
	selectorStopButton   = `button.stop-btn`
	selectorFileInput    = `input[type="file"]`
	selectorAttachment   = `.attachment-preview`
	selectorProgress     = `.spinner, #loading`
)

type GoogleSearchProvider struct {
	engine  engine.BrowserEngine
	baseURL string
}

func New(eng engine.BrowserEngine) providers.Provider {
	return &GoogleSearchProvider{
		engine:  eng,
		baseURL: "https://www.google.com",
	}
}

func (p *GoogleSearchProvider) Name() string {
	return "googlesearch"
}

func (p *GoogleSearchProvider) Initialize(ctx context.Context) error {
	slog.Info("[GoogleSearch] Provider initialized")
	return nil
}

func (p *GoogleSearchProvider) CheckSession(ctx context.Context) (bool, error) {
	// Google Search is public, session is always considered active/valid
	return true, nil
}

func (p *GoogleSearchProvider) OpenWorkspace(ctx context.Context, projectMetadata map[string]interface{}) error {
	slog.Info("[GoogleSearch] Opening search workspace")
	return p.engine.Navigate(ctx, p.baseURL)
}

func (p *GoogleSearchProvider) UploadFiles(ctx context.Context, files []providers.FileAttachment) error {
	// Standard Google Search does not support direct file uploads
	if len(files) > 0 {
		return fmt.Errorf("file uploads not supported on Google Search AI Mode")
	}
	return nil
}

func (p *GoogleSearchProvider) WaitForUploadCompletion(ctx context.Context) error {
	return nil
}

func (p *GoogleSearchProvider) WaitForAnalysisCompletion(ctx context.Context) error {
	return nil
}

func (p *GoogleSearchProvider) SendMessage(ctx context.Context, req providers.MessageRequest) error {
	if req.Text == "" {
		return fmt.Errorf("message text cannot be empty")
	}

	slog.Info("[GoogleSearch] Submitting query", "text_len", len(req.Text))

	if err := p.engine.WaitForSelector(ctx, selectorTextarea, 10000); err != nil {
		return fmt.Errorf("textarea not found: %w", err)
	}

	typeScript := fmt.Sprintf(`
		const textarea = document.querySelector('%s');
		if (textarea) {
			textarea.focus();
			textarea.value = %q;
		}
	`, selectorTextarea, req.Text)

	if _, err := p.engine.EvaluateJS(ctx, typeScript); err != nil {
		return fmt.Errorf("failed to type query: %w", err)
	}

	time.Sleep(200 * time.Millisecond)

	if err := p.engine.PressKey(ctx, "Enter"); err != nil {
		return fmt.Errorf("failed to submit search: %w", err)
	}

	slog.Info("[GoogleSearch] Query submitted")
	return nil
}

func (p *GoogleSearchProvider) StreamResponse(ctx context.Context) (<-chan providers.StreamChunk, error) {
	ch := make(chan providers.StreamChunk, 100)

	go func() {
		defer close(ch)

		if _, ok := p.engine.(*engine.StubEngine); ok {
			tokens := []string{"Google ", "search ", "results ", "stub ", "overview."}
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

		// Wait for search results container to load
		time.Sleep(2 * time.Second)

		// Fetch search overview text
		script := `
			(() => {
				// Try to find the AI Mode turn response first (udm=50 conversational search)
				let aiModeText = '';
				const turns = Array.from(document.querySelectorAll('div[data-scope-id="turn"]'));
				if (turns.length > 0) {
					const lastTurn = turns[turns.length - 1];
					
					// Target .mZJni container if present (reliable for complete answer text)
					const mZJni = lastTurn.querySelector('.mZJni');
					if (mZJni) {
						const responseEl = mZJni.children[0] || mZJni;
						const text = (responseEl.innerText || '').trim();
						if (text) {
							aiModeText = text;
						}
					}
					
					if (!aiModeText) {
						// Fallback: Find closest common ancestor of all response blocks (.n6owBd, .pTRUV, .ALfJzf)
						const blocks = Array.from(lastTurn.querySelectorAll('.n6owBd, .pTRUV, .ALfJzf'));
						if (blocks.length > 0) {
							let ancestor = blocks[0];
							if (blocks.length > 1) {
								let temp = blocks[0].parentElement;
								while (temp && lastTurn.contains(temp)) {
									if (blocks.every(b => temp.contains(b))) {
										ancestor = temp;
										break;
									}
									temp = temp.parentElement;
								}
							}
							const text = (ancestor.innerText || '').trim();
							if (text) {
								aiModeText = text;
							}
						}
					}
					
					if (!aiModeText) {
						// Ultimate fallback: Turn inner text cleaned of feedback noise
						aiModeText = (lastTurn.innerText || '')
							.replace(/copy/gi, '')
							.replace(/(?:was this helpful\?|send feedback|learn more|feedback)/gi, '')
							.trim();
					}
				} else {
					// If turn container not found, search globally for .mZJni or .n6owBd or .pTRUV
					const mZJni = document.querySelector('.mZJni');
					if (mZJni) {
						const responseEl = mZJni.children[0] || mZJni;
						aiModeText = (responseEl.innerText || '').trim();
					}
					if (!aiModeText) {
						const responseEl = document.querySelector('.n6owBd') || document.querySelector('.pTRUV');
						if (responseEl) {
							aiModeText = (responseEl.innerText || '').trim();
						}
					}
				}

				// Try to find the AI Overview element heuristically
				const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span'));
				let aiHeader = null;
				for (const el of headings) {
					if (el.textContent.trim().toLowerCase() === 'ai overview') {
						aiHeader = el;
						break;
					}
				}
				
				let aiOverviewText = '';
				if (aiHeader) {
					let container = aiHeader.parentElement;
					for (let i = 0; i < 5; i++) {
						if (container) {
							const text = container.innerText || '';
							if (text.length > 150) {
								aiOverviewText = text
									.replace(/ai overview/gi, '')
									.replace(/(?:was this helpful\?|send feedback|learn more|feedback)/gi, '')
									.trim();
								break;
							}
							container = container.parentElement;
						}
					}
				}

				if (aiModeText) {
					return aiModeText;
				} else if (aiOverviewText) {
					return aiOverviewText;
				}

				// Fallback to standard search results
				const searchResults = document.querySelector('#search');
				if (searchResults) {
					const gElements = Array.from(document.querySelectorAll('.g'));
					if (gElements.length > 0) {
						let resultsText = "## 🔍 Search Results (AI Overview not generated)\n\n";
						gElements.slice(0, 5).forEach((el, index) => {
							const titleEl = el.querySelector('h3');
							const title = titleEl ? titleEl.innerText : 'Result ' + (index + 1);
							const linkEl = el.querySelector('a');
							const link = linkEl ? linkEl.getAttribute('href') : '';
							const snippetEl = el.querySelector('div[style*="webkit-line-clamp"], .VwiC3d, .yD755b');
							const snippet = snippetEl ? snippetEl.innerText : el.innerText.substring(0, 300);
							
							resultsText += '### ' + title + '\n';
							if (link) {
								resultsText += 'Link: [' + title + '](' + link + ')\n';
							}
							resultsText += snippet + '\n\n';
						});
						return resultsText;
					}
					return searchResults.innerText.substring(0, 2000);
				}
				return 'No results found.';
			})();
		`
		text, err := p.engine.EvaluateJS(ctx, script)
		if err != nil {
			ch <- providers.StreamChunk{Type: "error", Content: err.Error()}
			return
		}

		// Stream the result back
		words := strings.Split(text, " ")
		for _, word := range words {
			select {
			case <-ctx.Done():
				return
			default:
				ch <- providers.StreamChunk{
					Type:    "text",
					Content: word + " ",
				}
				time.Sleep(20 * time.Millisecond)
			}
		}
		ch <- providers.StreamChunk{Type: "done", Content: ""}
	}()

	return ch, nil
}

func (p *GoogleSearchProvider) Cancel(ctx context.Context) error {
	return nil
}

func (p *GoogleSearchProvider) Health(ctx context.Context) error {
	_, err := p.engine.GetURL(ctx)
	return err
}

func (p *GoogleSearchProvider) Shutdown(ctx context.Context) error {
	return p.engine.Shutdown(ctx)
}

func (p *GoogleSearchProvider) Capabilities() providers.ProviderCapabilities {
	return providers.ProviderCapabilities{
		Streaming:     true,
		Vision:        false,
		FileUpload:    false,
		ImageUpload:   false,
		AudioUpload:   false,
		CodeExecution: false,
		ZipUpload:     false,
	}
}
