package maintenance

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/proka/ai-backend/internal/scheduler"
)

// Worker runs background maintenance tasks.
type Worker struct {
	scheduler *scheduler.Scheduler
	tempDir   string
	cancel    context.CancelFunc
}

// NewWorker creates a new maintenance worker.
func NewWorker(sched *scheduler.Scheduler, tempDir string) *Worker {
	return &Worker{
		scheduler: sched,
		tempDir:   tempDir,
	}
}

// Start launches the background maintenance goroutines.
func (w *Worker) Start(ctx context.Context) {
	ctx, w.cancel = context.WithCancel(ctx)

	slog.Info("[Maintenance] Worker started", "temp_dir", w.tempDir)

	// Idle browser cleanup — every 60 seconds
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				slog.Info("[Maintenance] Idle cleanup goroutine stopped")
				return
			case <-ticker.C:
				cleaned := w.scheduler.CleanupIdle()
				if cleaned > 0 {
					slog.Info("[Maintenance] Cleaned up idle browsers", "count", cleaned)
				}
			}
		}
	}()

	// Pool stats logging — every 5 minutes
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				slog.Info("[Maintenance] Stats logger goroutine stopped")
				return
			case <-ticker.C:
				stats := w.scheduler.Stats()
				slog.Info("[Maintenance] Pool stats",
					"total", stats.Total,
					"busy", stats.Busy,
					"idle", stats.Idle,
					"capacity", stats.Capacity,
				)
			}
		}
	}()

	// Uploads sweep — every 30 minutes
	go func() {
		ticker := time.NewTicker(30 * time.Minute)
		defer ticker.Stop()

		// Run immediate sweep on startup
		w.sweepUploads()

		for {
			select {
			case <-ctx.Done():
				slog.Info("[Maintenance] Uploads sweep goroutine stopped")
				return
			case <-ticker.C:
				w.sweepUploads()
			}
		}
	}()
}

func (w *Worker) sweepUploads() {
	if w.tempDir == "" {
		return
	}

	cutoff := time.Now().Add(-2 * time.Hour)
	slog.Info("[Maintenance] Sweeping temporary uploads folder", "cutoff", cutoff)

	// Ensure folder exists before walking
	if _, err := os.Stat(w.tempDir); os.IsNotExist(err) {
		return
	}

	err := filepath.Walk(w.tempDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if path == w.tempDir {
			return nil
		}

		if info.ModTime().Before(cutoff) {
			slog.Info("[Maintenance] Sweeping expired temp resource", "path", path, "mod_time", info.ModTime())
			_ = os.RemoveAll(path)
			if info.IsDir() {
				return filepath.SkipDir
			}
		}

		return nil
	})

	if err != nil {
		slog.Error("[Maintenance] Sweeping uploads failed", "error", err)
	}
}

// Stop cancels all background tasks.
func (w *Worker) Stop() {
	if w.cancel != nil {
		w.cancel()
		slog.Info("[Maintenance] Worker stopped")
	}
}
