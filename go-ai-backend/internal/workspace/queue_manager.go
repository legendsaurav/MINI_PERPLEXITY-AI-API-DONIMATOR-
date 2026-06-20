package workspace

import (
	"errors"
	"fmt"
	"sync"

	"github.com/antigravity/go-ai-backend/internal/providers"
)

type QueueManager struct {
	mu         sync.Mutex
	workspaces map[string]*ProjectQueue
}

type ProjectQueue struct {
	WorkspaceID string
	ProjectID   string
	mu          sync.Mutex
	requests    []providers.MessageRequest
	isProcessing bool
}

func NewQueueManager() *QueueManager {
	return &QueueManager{
		workspaces: make(map[string]*ProjectQueue),
	}
}

func (qm *QueueManager) getQueue(workspaceID, projectID string) *ProjectQueue {
	qm.mu.Lock()
	defer qm.mu.Unlock()
	key := fmt.Sprintf("%s::%s", workspaceID, projectID)
	if q, exists := qm.workspaces[key]; exists {
		return q
	}
	q := &ProjectQueue{
		WorkspaceID: workspaceID,
		ProjectID:   projectID,
		requests:    make([]providers.MessageRequest, 0),
	}
	qm.workspaces[key] = q
	return q
}

func (qm *QueueManager) Enqueue(workspaceID, projectID string, req providers.MessageRequest) error {
	q := qm.getQueue(workspaceID, projectID)
	q.mu.Lock()
	defer q.mu.Unlock()

	// In a real system, limit queue size
	q.requests = append(q.requests, req)
	return nil
}

func (qm *QueueManager) Dequeue(workspaceID, projectID string) (*providers.MessageRequest, error) {
	q := qm.getQueue(workspaceID, projectID)
	q.mu.Lock()
	defer q.mu.Unlock()

	if len(q.requests) == 0 {
		return nil, errors.New("queue is empty")
	}

	req := q.requests[0]
	q.requests = q.requests[1:]
	return &req, nil
}

func (qm *QueueManager) LockProcessing(workspaceID, projectID string) bool {
	q := qm.getQueue(workspaceID, projectID)
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.isProcessing {
		return false
	}
	q.isProcessing = true
	return true
}

func (qm *QueueManager) UnlockProcessing(workspaceID, projectID string) {
	q := qm.getQueue(workspaceID, projectID)
	q.mu.Lock()
	defer q.mu.Unlock()
	q.isProcessing = false
}

func (qm *QueueManager) Length(workspaceID, projectID string) int {
	q := qm.getQueue(workspaceID, projectID)
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.requests)
}
