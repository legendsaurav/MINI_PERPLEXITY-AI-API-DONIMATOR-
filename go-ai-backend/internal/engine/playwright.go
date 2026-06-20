package engine

import (
	"errors"

	"github.com/playwright-community/playwright-go"
)

type PlaywrightEngine struct {
	pw      *playwright.Playwright
	browser playwright.Browser
	context playwright.BrowserContext
	page    playwright.Page
}

func NewPlaywrightEngine() *PlaywrightEngine {
	return &PlaywrightEngine{}
}

func (e *PlaywrightEngine) Launch() error {
	pw, err := playwright.Run()
	if err != nil {
		return err
	}
	e.pw = pw

	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(true),
	})
	if err != nil {
		return err
	}
	e.browser = browser

	context, err := browser.NewContext()
	if err != nil {
		return err
	}
	e.context = context

	page, err := context.NewPage()
	if err != nil {
		return err
	}
	e.page = page

	return nil
}

func (e *PlaywrightEngine) Shutdown() error {
	if e.browser != nil {
		e.browser.Close()
	}
	if e.pw != nil {
		e.pw.Stop()
	}
	return nil
}

func (e *PlaywrightEngine) RestoreProfile(path string) error {
	if e.pw == nil {
		return errors.New("must launch before restoring profile")
	}
	// TODO: Load context with StorageState configuration
	return nil
}

func (e *PlaywrightEngine) Navigate(url string) error {
	if e.page == nil {
		return errors.New("page not initialized")
	}
	_, err := e.page.Goto(url)
	return err
}

func (e *PlaywrightEngine) Click(selector string) error {
	if e.page == nil {
		return errors.New("page not initialized")
	}
	return e.page.Locator(selector).Click()
}

func (e *PlaywrightEngine) Type(selector, text string) error {
	if e.page == nil {
		return errors.New("page not initialized")
	}
	return e.page.Locator(selector).Fill(text)
}

func (e *PlaywrightEngine) WaitFor(selector string) error {
	if e.page == nil {
		return errors.New("page not initialized")
	}
	_, err := e.page.WaitForSelector(selector)
	return err
}

func (e *PlaywrightEngine) EvaluateJS(script string) (string, error) {
	if e.page == nil {
		return "", errors.New("page not initialized")
	}
	val, err := e.page.Evaluate(script)
	if err != nil {
		return "", err
	}
	if strVal, ok := val.(string); ok {
		return strVal, nil
	}
	return "", errors.New("js returned non-string")
}

func (e *PlaywrightEngine) Screenshot() ([]byte, error) {
	if e.page == nil {
		return nil, errors.New("page not initialized")
	}
	return e.page.Screenshot()
}

func (e *PlaywrightEngine) Upload(selector, filePath string) error {
	if e.page == nil {
		return errors.New("page not initialized")
	}
	return e.page.Locator(selector).SetInputFiles([]string{filePath})
}

func (e *PlaywrightEngine) StreamDOM() (<-chan string, error) {
	ch := make(chan string)
	// TODO: Attach MutationObserver via exposeBinding and page.evaluate
	go func() {
		defer close(ch)
	}()
	return ch, nil
}
