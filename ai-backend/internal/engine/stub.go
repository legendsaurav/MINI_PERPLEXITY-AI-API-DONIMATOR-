package engine

import (
	"context"
	"log/slog"
)

// StubEngine is a no-op implementation of BrowserEngine for testing
// and development without a real browser runtime installed.
type StubEngine struct {
	currentURL   string
	currentTitle string
	launched     bool
}

// NewStubEngine creates a new stub engine.
func NewStubEngine() *StubEngine {
	return &StubEngine{}
}

func (s *StubEngine) Launch(ctx context.Context, profilePath string) error {
	slog.Debug("[StubEngine] Launch", "profile", profilePath)
	s.launched = true
	return nil
}

func (s *StubEngine) Shutdown(ctx context.Context) error {
	slog.Debug("[StubEngine] Shutdown")
	s.launched = false
	return nil
}

func (s *StubEngine) Navigate(ctx context.Context, url string) error {
	slog.Debug("[StubEngine] Navigate", "url", url)
	s.currentURL = url
	s.currentTitle = "Stub Page"
	return nil
}

func (s *StubEngine) WaitForSelector(ctx context.Context, selector string, timeoutMs int) error {
	slog.Debug("[StubEngine] WaitForSelector", "selector", selector)
	return nil
}

func (s *StubEngine) Click(ctx context.Context, selector string) error {
	slog.Debug("[StubEngine] Click", "selector", selector)
	return nil
}

func (s *StubEngine) Type(ctx context.Context, selector string, text string) error {
	slog.Debug("[StubEngine] Type", "selector", selector, "text_len", len(text))
	return nil
}

func (s *StubEngine) ClearAndType(ctx context.Context, selector string, text string) error {
	slog.Debug("[StubEngine] ClearAndType", "selector", selector)
	return nil
}

func (s *StubEngine) PressKey(ctx context.Context, key string) error {
	slog.Debug("[StubEngine] PressKey", "key", key)
	return nil
}

func (s *StubEngine) EvaluateJS(ctx context.Context, script string) (string, error) {
	slog.Debug("[StubEngine] EvaluateJS", "script_len", len(script))
	return "{}", nil
}

func (s *StubEngine) Screenshot(ctx context.Context) ([]byte, error) {
	slog.Debug("[StubEngine] Screenshot")
	return []byte{}, nil
}

func (s *StubEngine) UploadFile(ctx context.Context, selector string, filePath string) error {
	slog.Debug("[StubEngine] UploadFile", "selector", selector, "file", filePath)
	return nil
}

func (s *StubEngine) GetURL(ctx context.Context) (string, error) {
	return s.currentURL, nil
}

func (s *StubEngine) GetPageTitle(ctx context.Context) (string, error) {
	return s.currentTitle, nil
}

func (s *StubEngine) IsElementVisible(ctx context.Context, selector string) (bool, error) {
	slog.Debug("[StubEngine] IsElementVisible", "selector", selector)
	return true, nil
}

// StubEngineFactory creates StubEngine instances.
type StubEngineFactory struct{}

func (f *StubEngineFactory) Create() (BrowserEngine, error) {
	return NewStubEngine(), nil
}
