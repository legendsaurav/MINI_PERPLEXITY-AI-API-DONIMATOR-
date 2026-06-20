package scheduler

import (
	"sync"
	"time"
)

type WorkspaceRequest struct {
	WorkspaceID string
	ProjectID   string
	Priority    int
	CreatedAt   time.Time
}

type Scheduler struct {
	mu          sync.Mutex
	maxBrowsers int
	activeBrowsers int
	requestQueue []WorkspaceRequest
}

func NewScheduler(maxBrowsers int) *Scheduler {
	return &Scheduler{
		maxBrowsers: maxBrowsers,
		requestQueue: make([]WorkspaceRequest, 0),
	}
}

func (s *Scheduler) Enqueue(req WorkspaceRequest) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Simply append for now. Real implementation needs priority sorting.
	s.requestQueue = append(s.requestQueue, req)
}

func (s *Scheduler) Allocate() bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.activeBrowsers < s.maxBrowsers {
		s.activeBrowsers++
		return true
	}
	return false
}

func (s *Scheduler) Release() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.activeBrowsers > 0 {
		s.activeBrowsers--
	}
}
