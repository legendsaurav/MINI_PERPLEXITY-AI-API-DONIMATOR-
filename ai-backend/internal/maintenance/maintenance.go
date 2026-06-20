package maintenance

import (
	"context"
	"log/slog"
	"time"

	"github.com/proka/ai-backend/internal/scheduler"
)

// Worker runs background maintenance tasks.
type Worker struct {
	scheduler *scheduler.Scheduler
	cancel    context.CancelFunc
}

// NewWorker creates a new maintenance worker.
func NewWorker(sched *scheduler.Scheduler) *Worker {
	return &Worker{scheduler: sched}
}

// Start launches the background maintenance goroutines.
func (w *Worker) Start(ctx context.Context) {
	ctx, w.cancel = context.WithCancel(ctx)

	slog.Info("[Maintenance] Worker started")

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
}

// Stop cancels all background tasks.
func (w *Worker) Stop() {
	if w.cancel != nil {
		w.cancel()
		slog.Info("[Maintenance] Worker stopped")
	}
}
