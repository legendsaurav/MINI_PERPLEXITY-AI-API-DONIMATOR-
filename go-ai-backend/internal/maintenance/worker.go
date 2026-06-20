package maintenance

import (
	"log"
	"time"

	"github.com/antigravity/go-ai-backend/internal/browser"
)

type Worker struct {
	browserManager *browser.BrowserManager
	idleTimeout    time.Duration
	stopCh         chan struct{}
}

func NewWorker(bm *browser.BrowserManager, idle time.Duration) *Worker {
	return &Worker{
		browserManager: bm,
		idleTimeout:    idle,
		stopCh:         make(chan struct{}),
	}
}

func (w *Worker) Start() {
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				log.Println("Maintenance worker: sweeping idle browsers and temp files...")
				w.browserManager.CleanIdle(w.idleTimeout)
				// TODO: Clean temporary upload directories
			case <-w.stopCh:
				log.Println("Maintenance worker stopping")
				return
			}
		}
	}()
}

func (w *Worker) Stop() {
	close(w.stopCh)
}
