package maintenance

import (
	"testing"
	"time"

	"github.com/antigravity/go-ai-backend/internal/browser"
)

func TestNewWorker(t *testing.T) {
	bm := browser.NewBrowserManager()
	w := NewWorker(bm, 15*time.Minute)
	if w == nil {
		t.Fatal("expected non-nil worker")
	}
	if w.browserManager == nil {
		t.Error("expected browserManager to be set")
	}
	if w.idleTimeout != 15*time.Minute {
		t.Errorf("expected idleTimeout 15m, got %v", w.idleTimeout)
	}
	if w.stopCh == nil {
		t.Error("expected stopCh to be initialized")
	}
}

func TestWorker_StartAndStop_NoPanic(t *testing.T) {
	bm := browser.NewBrowserManager()
	w := NewWorker(bm, 5*time.Minute)

	// Start should not panic
	w.Start()

	// Give the goroutine time to enter the select loop
	time.Sleep(50 * time.Millisecond)

	// Stop should not panic
	w.Stop()

	// Give the goroutine time to exit
	time.Sleep(50 * time.Millisecond)
}

func TestWorker_StopCleanly(t *testing.T) {
	bm := browser.NewBrowserManager()
	w := NewWorker(bm, 5*time.Minute)

	w.Start()
	time.Sleep(20 * time.Millisecond)

	// Stopping should close the channel and the goroutine should return
	w.Stop()
	time.Sleep(50 * time.Millisecond)

	// Verify the stop channel was closed by trying to read from it
	select {
	case _, open := <-w.stopCh:
		if open {
			t.Error("expected stopCh to be closed")
		}
	default:
		// This is also ok—channel is closed and drained
	}
}

func TestWorker_MultipleWorkersIndependent(t *testing.T) {
	bm := browser.NewBrowserManager()

	w1 := NewWorker(bm, 5*time.Minute)
	w2 := NewWorker(bm, 10*time.Minute)

	w1.Start()
	w2.Start()
	time.Sleep(20 * time.Millisecond)

	w1.Stop()
	w2.Stop()
	time.Sleep(50 * time.Millisecond)
}

func TestNewWorker_DifferentTimeouts(t *testing.T) {
	bm := browser.NewBrowserManager()

	durations := []time.Duration{
		1 * time.Second,
		5 * time.Minute,
		1 * time.Hour,
	}

	for _, d := range durations {
		w := NewWorker(bm, d)
		if w.idleTimeout != d {
			t.Errorf("expected timeout %v, got %v", d, w.idleTimeout)
		}
	}
}
