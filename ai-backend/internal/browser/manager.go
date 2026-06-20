package browser

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/proka/ai-backend/internal/config"
	"github.com/proka/ai-backend/internal/engine"
)

// SlotStatus represents the state of a browser slot.
type SlotStatus string

const (
	StatusIdle     SlotStatus = "idle"
	StatusBusy     SlotStatus = "busy"
	StatusStarting SlotStatus = "starting"
	StatusStopped  SlotStatus = "stopped"
)

// BrowserSlot represents a single browser instance in the pool.
type BrowserSlot struct {
	ID          string
	WorkspaceID string
	ProjectID   string
	Provider    string
	Engine      engine.BrowserEngine
	ProfilePath string
	Status      SlotStatus
	LastUsed    time.Time
	CreatedAt   time.Time
}

// Manager manages the browser pool and profile lifecycle.
type Manager struct {
	mu            sync.Mutex
	slots         map[string]*BrowserSlot
	engineFactory engine.EngineFactory
	cfg           config.BrowserConfig
}

// NewManager creates a new browser manager.
func NewManager(cfg config.BrowserConfig, factory engine.EngineFactory) *Manager {
	return &Manager{
		slots:         make(map[string]*BrowserSlot),
		engineFactory: factory,
		cfg:           cfg,
	}
}

// slotKey generates a unique key for a browser slot.
func slotKey(workspaceID, projectID, provider string) string {
	return fmt.Sprintf("%s:%s:%s", workspaceID, projectID, provider)
}

// Acquire returns an existing or new browser slot for the given workspace/project/provider.
// If the pool is at capacity, it evicts the least recently used idle slot.
func (m *Manager) Acquire(ctx context.Context, workspaceID, projectID, provider string) (*BrowserSlot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := slotKey(workspaceID, projectID, provider)

	// Check for existing slot
	if slot, ok := m.slots[key]; ok {
		slot.Status = StatusBusy
		slot.LastUsed = time.Now()
		slog.Debug("Reusing existing browser slot", "key", key)
		return slot, nil
	}

	// Check pool capacity
	if len(m.slots) >= m.cfg.MaxRunning {
		// Try to evict an idle slot
		if !m.evictIdleLocked() {
			return nil, fmt.Errorf("browser pool is full (%d/%d), no idle slots to evict",
				len(m.slots), m.cfg.MaxRunning)
		}
	}

	// Create new browser engine
	eng, err := m.engineFactory.Create()
	if err != nil {
		return nil, fmt.Errorf("failed to create browser engine: %w", err)
	}

	// Ensure profile directory exists
	profilePath := filepath.Join(m.cfg.ProfileBasePath, provider, workspaceID, projectID)
	if err := os.MkdirAll(profilePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create profile directory: %w", err)
	}

	// Launch browser with profile
	slot := &BrowserSlot{
		ID:          key,
		WorkspaceID: workspaceID,
		ProjectID:   projectID,
		Provider:    provider,
		Engine:      eng,
		ProfilePath: profilePath,
		Status:      StatusStarting,
		LastUsed:    time.Now(),
		CreatedAt:   time.Now(),
	}

	if err := eng.Launch(ctx, profilePath); err != nil {
		return nil, fmt.Errorf("failed to launch browser: %w", err)
	}

	slot.Status = StatusBusy
	m.slots[key] = slot

	slog.Info("Browser slot created",
		"key", key,
		"provider", provider,
		"pool_size", len(m.slots),
	)

	return slot, nil
}

// Release marks a browser slot as idle.
func (m *Manager) Release(slotID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if slot, ok := m.slots[slotID]; ok {
		slot.Status = StatusIdle
		slot.LastUsed = time.Now()
		slog.Debug("Browser slot released", "key", slotID)
	}
}

// evictIdleLocked evicts the least recently used idle slot. Must be called with lock held.
func (m *Manager) evictIdleLocked() bool {
	var oldest *BrowserSlot
	var oldestKey string

	for key, slot := range m.slots {
		if slot.Status == StatusIdle {
			if oldest == nil || slot.LastUsed.Before(oldest.LastUsed) {
				oldest = slot
				oldestKey = key
			}
		}
	}

	if oldest == nil {
		return false
	}

	slog.Info("Evicting idle browser slot", "key", oldestKey)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = oldest.Engine.Shutdown(ctx)
	delete(m.slots, oldestKey)
	return true
}

// CleanupIdle shuts down browser slots that have been idle longer than the timeout.
func (m *Manager) CleanupIdle() int {
	m.mu.Lock()
	defer m.mu.Unlock()

	threshold := time.Now().Add(-time.Duration(m.cfg.IdleTimeoutSecs) * time.Second)
	cleaned := 0

	for key, slot := range m.slots {
		if slot.Status == StatusIdle && slot.LastUsed.Before(threshold) {
			slog.Info("Cleaning up idle browser", "key", key, "idle_since", slot.LastUsed)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_ = slot.Engine.Shutdown(ctx)
			cancel()
			delete(m.slots, key)
			cleaned++
		}
	}

	return cleaned
}

// Stats returns pool statistics.
type PoolStats struct {
	Total    int `json:"total"`
	Busy     int `json:"busy"`
	Idle     int `json:"idle"`
	Starting int `json:"starting"`
	Capacity int `json:"capacity"`
}

func (m *Manager) Stats() PoolStats {
	m.mu.Lock()
	defer m.mu.Unlock()

	stats := PoolStats{Capacity: m.cfg.MaxRunning}
	for _, slot := range m.slots {
		stats.Total++
		switch slot.Status {
		case StatusBusy:
			stats.Busy++
		case StatusIdle:
			stats.Idle++
		case StatusStarting:
			stats.Starting++
		}
	}
	return stats
}

// Shutdown gracefully shuts down all browser slots.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	defer m.mu.Unlock()

	slog.Info("Shutting down all browser slots", "count", len(m.slots))
	for key, slot := range m.slots {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		if err := slot.Engine.Shutdown(ctx); err != nil {
			slog.Error("Failed to shutdown browser", "key", key, "error", err)
		}
		cancel()
		delete(m.slots, key)
	}
}
