package workspace

import (
	"sync"
	"testing"

	"github.com/antigravity/go-ai-backend/internal/providers"
)

func TestNewQueueManager(t *testing.T) {
	qm := NewQueueManager()
	if qm == nil {
		t.Fatal("NewQueueManager returned nil")
	}
}

func TestQueueManager_EnqueueDequeue_FIFO(t *testing.T) {
	qm := NewQueueManager()

	msgs := []providers.MessageRequest{
		{Project: "p1", Text: "first"},
		{Project: "p2", Text: "second"},
		{Project: "p3", Text: "third"},
	}

	for _, m := range msgs {
		if err := qm.Enqueue("ws1", "proj1", m); err != nil {
			t.Fatalf("Enqueue error: %v", err)
		}
	}

	for i, want := range msgs {
		got, err := qm.Dequeue("ws1", "proj1")
		if err != nil {
			t.Fatalf("Dequeue %d error: %v", i, err)
		}
		if got.Text != want.Text {
			t.Errorf("Dequeue %d: Text = %q; want %q", i, got.Text, want.Text)
		}
		if got.Project != want.Project {
			t.Errorf("Dequeue %d: Project = %q; want %q", i, got.Project, want.Project)
		}
	}
}

func TestQueueManager_Dequeue_EmptyQueue(t *testing.T) {
	qm := NewQueueManager()
	_, err := qm.Dequeue("ws1", "proj1")
	if err == nil {
		t.Error("Dequeue on empty queue should return error")
	}
	if err.Error() != "queue is empty" {
		t.Errorf("error message = %q; want %q", err.Error(), "queue is empty")
	}
}

func TestQueueManager_Dequeue_AfterDrain(t *testing.T) {
	qm := NewQueueManager()
	qm.Enqueue("ws", "proj", providers.MessageRequest{Text: "only"})
	qm.Dequeue("ws", "proj")

	_, err := qm.Dequeue("ws", "proj")
	if err == nil {
		t.Error("Dequeue on drained queue should return error")
	}
}

func TestQueueManager_LockProcessing(t *testing.T) {
	qm := NewQueueManager()

	// First lock should succeed.
	if !qm.LockProcessing("ws1", "proj1") {
		t.Error("first LockProcessing should return true")
	}

	// Second lock should fail (already processing).
	if qm.LockProcessing("ws1", "proj1") {
		t.Error("second LockProcessing should return false (already locked)")
	}
}

func TestQueueManager_UnlockProcessing(t *testing.T) {
	qm := NewQueueManager()

	qm.LockProcessing("ws1", "proj1")
	qm.UnlockProcessing("ws1", "proj1")

	// After unlock, lock should succeed again.
	if !qm.LockProcessing("ws1", "proj1") {
		t.Error("LockProcessing after UnlockProcessing should return true")
	}
}

func TestQueueManager_LockProcessing_IsolatedQueues(t *testing.T) {
	qm := NewQueueManager()

	qm.LockProcessing("ws1", "proj1")

	// Different queue should still be lockable.
	if !qm.LockProcessing("ws1", "proj2") {
		t.Error("LockProcessing on different project should succeed")
	}
	if !qm.LockProcessing("ws2", "proj1") {
		t.Error("LockProcessing on different workspace should succeed")
	}
}

func TestQueueManager_Length(t *testing.T) {
	qm := NewQueueManager()

	if qm.Length("ws", "proj") != 0 {
		t.Error("Length of new queue should be 0")
	}

	qm.Enqueue("ws", "proj", providers.MessageRequest{Text: "a"})
	qm.Enqueue("ws", "proj", providers.MessageRequest{Text: "b"})

	if qm.Length("ws", "proj") != 2 {
		t.Errorf("Length = %d; want 2", qm.Length("ws", "proj"))
	}

	qm.Dequeue("ws", "proj")
	if qm.Length("ws", "proj") != 1 {
		t.Errorf("Length after dequeue = %d; want 1", qm.Length("ws", "proj"))
	}
}

func TestQueueManager_IsolatedQueues(t *testing.T) {
	qm := NewQueueManager()

	qm.Enqueue("ws1", "proj1", providers.MessageRequest{Text: "msg-ws1-proj1"})
	qm.Enqueue("ws1", "proj2", providers.MessageRequest{Text: "msg-ws1-proj2"})
	qm.Enqueue("ws2", "proj1", providers.MessageRequest{Text: "msg-ws2-proj1"})

	if qm.Length("ws1", "proj1") != 1 {
		t.Errorf("ws1/proj1 length = %d; want 1", qm.Length("ws1", "proj1"))
	}
	if qm.Length("ws1", "proj2") != 1 {
		t.Errorf("ws1/proj2 length = %d; want 1", qm.Length("ws1", "proj2"))
	}
	if qm.Length("ws2", "proj1") != 1 {
		t.Errorf("ws2/proj1 length = %d; want 1", qm.Length("ws2", "proj1"))
	}

	got, _ := qm.Dequeue("ws1", "proj1")
	if got.Text != "msg-ws1-proj1" {
		t.Errorf("wrong message from ws1/proj1: %q", got.Text)
	}

	got, _ = qm.Dequeue("ws1", "proj2")
	if got.Text != "msg-ws1-proj2" {
		t.Errorf("wrong message from ws1/proj2: %q", got.Text)
	}

	got, _ = qm.Dequeue("ws2", "proj1")
	if got.Text != "msg-ws2-proj1" {
		t.Errorf("wrong message from ws2/proj1: %q", got.Text)
	}
}

func TestQueueManager_EnqueueReturnsNilError(t *testing.T) {
	qm := NewQueueManager()
	err := qm.Enqueue("ws", "proj", providers.MessageRequest{Text: "hello"})
	if err != nil {
		t.Errorf("Enqueue returned unexpected error: %v", err)
	}
}

func TestQueueManager_DequeueReturnsPointer(t *testing.T) {
	qm := NewQueueManager()
	qm.Enqueue("ws", "proj", providers.MessageRequest{Text: "test"})
	got, err := qm.Dequeue("ws", "proj")
	if err != nil {
		t.Fatalf("Dequeue error: %v", err)
	}
	if got == nil {
		t.Fatal("Dequeue returned nil pointer")
	}
	if got.Text != "test" {
		t.Errorf("Text = %q; want %q", got.Text, "test")
	}
}

func TestQueueManager_EnqueueWithAttachments(t *testing.T) {
	qm := NewQueueManager()
	req := providers.MessageRequest{
		Project: "myproject",
		Text:    "with attachments",
		Images: []providers.ImageAttachment{
			{Path: "/img.png", MimeType: "image/png"},
		},
		Files: []providers.FileAttachment{
			{Path: "/doc.pdf", MimeType: "application/pdf"},
		},
		Metadata: map[string]string{"key": "value"},
	}
	qm.Enqueue("ws", "proj", req)
	got, _ := qm.Dequeue("ws", "proj")
	if len(got.Images) != 1 {
		t.Errorf("Images count = %d; want 1", len(got.Images))
	}
	if len(got.Files) != 1 {
		t.Errorf("Files count = %d; want 1", len(got.Files))
	}
	if got.Metadata["key"] != "value" {
		t.Errorf("Metadata[key] = %q; want %q", got.Metadata["key"], "value")
	}
}

func TestQueueManager_ConcurrentEnqueue(t *testing.T) {
	qm := NewQueueManager()
	var wg sync.WaitGroup
	n := 500

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			qm.Enqueue("ws", "proj", providers.MessageRequest{Text: "msg"})
		}(i)
	}
	wg.Wait()

	if qm.Length("ws", "proj") != n {
		t.Errorf("Length = %d; want %d", qm.Length("ws", "proj"), n)
	}
}

func TestQueueManager_ConcurrentEnqueueDequeue(t *testing.T) {
	qm := NewQueueManager()
	var wg sync.WaitGroup
	n := 200

	// Enqueue n items first.
	for i := 0; i < n; i++ {
		qm.Enqueue("ws", "proj", providers.MessageRequest{Text: "msg"})
	}

	dequeued := 0
	var mu sync.Mutex

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := qm.Dequeue("ws", "proj")
			if err == nil {
				mu.Lock()
				dequeued++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if dequeued != n {
		t.Errorf("dequeued = %d; want %d", dequeued, n)
	}
	if qm.Length("ws", "proj") != 0 {
		t.Errorf("remaining length = %d; want 0", qm.Length("ws", "proj"))
	}
}

func TestQueueManager_ConcurrentLockProcessing(t *testing.T) {
	qm := NewQueueManager()
	var wg sync.WaitGroup
	n := 100
	successCount := 0
	var mu sync.Mutex

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if qm.LockProcessing("ws", "proj") {
				mu.Lock()
				successCount++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	// Only one goroutine should have successfully locked.
	if successCount != 1 {
		t.Errorf("successful locks = %d; want 1", successCount)
	}
}
