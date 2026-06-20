package engine

// BrowserEngine defines the low-level primitives required to interact with a browser.
// The engine itself does not know about any specific provider logic (e.g. selectors).
type BrowserEngine interface {
	Launch() error
	Shutdown() error
	RestoreProfile(path string) error
	Navigate(url string) error
	Click(selector string) error
	Type(selector, text string) error
	WaitFor(selector string) error
	EvaluateJS(script string) (string, error)
	Screenshot() ([]byte, error)
	Upload(selector, filePath string) error
	StreamDOM() (<-chan string, error)
}
