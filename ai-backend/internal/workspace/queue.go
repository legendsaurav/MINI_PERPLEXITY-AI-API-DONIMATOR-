package workspace

import (
	"context"
	"fmt"
	"sync"
)

// ChatRequest represents a queued chat request for a project.
type ChatRequest struct {
	ProjectID    string
	Text         string
	Images       [][]byte
	ResponseChan chan<- StreamChunk
	Ctx          context.Context
}

// StreamChunk represents a single streaming response chunk.
type StreamChunk struct {
	Data  string `json:"data"`
	Done  bool   `json:"done"`
	Error string `json:"error,omitempty"`
}

// RequestQueue is a per-project FIFO queue that ensures sequential processing.
type RequestQueue struct {
	mu      sync.Mutex
	queue   chan *ChatRequest
	maxSize int
}

// NewRequestQueue creates a queue with a given capacity.
func NewRequestQueue(maxSize int) *RequestQueue {
	return &RequestQueue{
		queue:   make(chan *ChatRequest, maxSize),
		maxSize: maxSize,
	}
}

// Enqueue adds a request to the queue. Returns error if queue is full.
func (q *RequestQueue) Enqueue(ctx context.Context, req *ChatRequest) error {
	select {
	case q.queue <- req:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	default:
		return fmt.Errorf("request queue is full (max %d)", q.maxSize)
	}
}

// Dequeue removes and returns the next request. Returns false if queue is empty.
func (q *RequestQueue) Dequeue() (*ChatRequest, bool) {
	select {
	case req := <-q.queue:
		return req, true
	default:
		return nil, false
	}
}

// Len returns the current number of items in the queue.
func (q *RequestQueue) Len() int {
	return len(q.queue)
}

// QueueManager manages per-project request queues.
type QueueManager struct {
	mu      sync.RWMutex
	queues  map[string]*RequestQueue
	maxSize int
}

// NewQueueManager creates a new queue manager.
func NewQueueManager(maxQueueSize int) *QueueManager {
	return &QueueManager{
		queues:  make(map[string]*RequestQueue),
		maxSize: maxQueueSize,
	}
}

// GetQueue returns (or creates) the queue for a given project.
func (qm *QueueManager) GetQueue(projectID string) *RequestQueue {
	qm.mu.RLock()
	q, ok := qm.queues[projectID]
	qm.mu.RUnlock()
	if ok {
		return q
	}

	qm.mu.Lock()
	defer qm.mu.Unlock()

	// Double-check after write lock
	if q, ok := qm.queues[projectID]; ok {
		return q
	}

	q = NewRequestQueue(qm.maxSize)
	qm.queues[projectID] = q
	return q
}
