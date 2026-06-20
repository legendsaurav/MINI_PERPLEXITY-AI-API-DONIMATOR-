package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/proka/ai-backend/internal/browser"
	"github.com/proka/ai-backend/internal/config"
	"github.com/proka/ai-backend/internal/engine"
)

// Scheduler manages browser slot allocation with priority-based eviction.
type Scheduler struct {
	mu             sync.Mutex
	browserManager *browser.Manager
	cfg            config.BrowserConfig
}

// New creates a new Scheduler.
func New(cfg config.BrowserConfig, factory engine.EngineFactory) *Scheduler {
	return &Scheduler{
		browserManager: browser.NewManager(cfg, factory),
		cfg:            cfg,
	}
}

// Acquire obtains a browser slot for the given workspace/project/provider.
func (s *Scheduler) Acquire(ctx context.Context, workspaceID, projectID, provider string) (*browser.BrowserSlot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	slot, err := s.browserManager.Acquire(ctx, workspaceID, projectID, provider)
	if err != nil {
		return nil, fmt.Errorf("scheduler acquire failed: %w", err)
	}

	slog.Info("Scheduler: slot acquired",
		"workspace", workspaceID,
		"project", projectID,
		"provider", provider,
	)

	return slot, nil
}

// Release returns a browser slot to the pool.
func (s *Scheduler) Release(slotID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.browserManager.Release(slotID)
}

// Stats returns pool statistics.
func (s *Scheduler) Stats() browser.PoolStats {
	return s.browserManager.Stats()
}

// CleanupIdle shuts down idle browsers past their timeout.
func (s *Scheduler) CleanupIdle() int {
	return s.browserManager.CleanupIdle()
}

// Shutdown gracefully shuts down all managed browsers.
func (s *Scheduler) Shutdown() {
	s.browserManager.Shutdown()
}
