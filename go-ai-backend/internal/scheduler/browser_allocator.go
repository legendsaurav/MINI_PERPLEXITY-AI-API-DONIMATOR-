package scheduler

import (
	"sync"
)

// BrowserAllocator handles limiting the global concurrent browser pool.
type BrowserAllocator struct {
	maxBrowsers    int
	activeBrowsers int
	mu             sync.Mutex
}

func NewBrowserAllocator(max int) *BrowserAllocator {
	return &BrowserAllocator{
		maxBrowsers: max,
	}
}

func (a *BrowserAllocator) Allocate() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.activeBrowsers < a.maxBrowsers {
		a.activeBrowsers++
		return true
	}
	return false
}

func (a *BrowserAllocator) Release() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.activeBrowsers > 0 {
		a.activeBrowsers--
	}
}

func (a *BrowserAllocator) ActiveCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.activeBrowsers
}
