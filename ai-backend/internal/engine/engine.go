package engine

import "context"

// BrowserEngine is the low-level browser automation abstraction.
// Provider logic (selectors, timeouts) is NOT leaked here.
// Implementations include Playwright-Go, Puppeteer, or stubs for testing.
type BrowserEngine interface {
	// Launch starts a browser instance with the given persistent profile path.
	Launch(ctx context.Context, profilePath string) error

	// Shutdown gracefully closes the browser instance.
	Shutdown(ctx context.Context) error

	// Navigate loads the given URL in the browser.
	Navigate(ctx context.Context, url string) error

	// WaitForSelector waits until the given CSS selector appears in the DOM.
	WaitForSelector(ctx context.Context, selector string, timeoutMs int) error

	// Click clicks the element matching the CSS selector.
	Click(ctx context.Context, selector string) error

	// Type types text into the element matching the CSS selector.
	Type(ctx context.Context, selector string, text string) error

	// ClearAndType clears the element's content, then types new text.
	ClearAndType(ctx context.Context, selector string, text string) error

	// PressKey simulates a keyboard key press (e.g., "Enter", "Escape").
	PressKey(ctx context.Context, key string) error

	// EvaluateJS executes JavaScript in the browser and returns the result as a string.
	EvaluateJS(ctx context.Context, script string) (string, error)

	// Screenshot captures the current page as a PNG image.
	Screenshot(ctx context.Context) ([]byte, error)

	// UploadFile triggers a file upload via the given file input selector.
	UploadFile(ctx context.Context, selector string, filePath string) error

	// GetURL returns the current page URL.
	GetURL(ctx context.Context) (string, error)

	// GetPageTitle returns the current page title.
	GetPageTitle(ctx context.Context) (string, error)

	// IsElementVisible checks if a CSS selector is visible on the page.
	IsElementVisible(ctx context.Context, selector string) (bool, error)
}

// EngineFactory creates new BrowserEngine instances.
type EngineFactory interface {
	Create() (BrowserEngine, error)
}
