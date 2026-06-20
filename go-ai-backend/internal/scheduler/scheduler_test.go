package scheduler

import (
	"sync"
	"testing"
	"time"
)

func TestNewScheduler(t *testing.T) {
	s := NewScheduler(10)
	if s == nil {
		t.Fatal("NewScheduler returned nil")
	}
	if s.maxBrowsers != 10 {
		t.Errorf("maxBrowsers = %d; want 10", s.maxBrowsers)
	}
	if s.activeBrowsers != 0 {
		t.Errorf("activeBrowsers = %d; want 0", s.activeBrowsers)
	}
	if len(s.requestQueue) != 0 {
		t.Errorf("requestQueue length = %d; want 0", len(s.requestQueue))
	}
}

func TestNewScheduler_ZeroMax(t *testing.T) {
	s := NewScheduler(0)
	if s.maxBrowsers != 0 {
		t.Errorf("maxBrowsers = %d; want 0", s.maxBrowsers)
	}
	// Allocate should immediately fail.
	if s.Allocate() {
		t.Error("Allocate() should return false with maxBrowsers=0")
	}
}

func TestScheduler_Enqueue(t *testing.T) {
	s := NewScheduler(5)
	req := WorkspaceRequest{
		WorkspaceID: "ws-1",
		ProjectID:   "proj-1",
		Priority:    1,
		CreatedAt:   time.Now(),
	}
	s.Enqueue(req)
	if len(s.requestQueue) != 1 {
		t.Fatalf("queue length = %d; want 1", len(s.requestQueue))
	}
	if s.requestQueue[0].WorkspaceID != "ws-1" {
		t.Errorf("WorkspaceID = %q; want %q", s.requestQueue[0].WorkspaceID, "ws-1")
	}
}

func TestScheduler_EnqueueMultiple(t *testing.T) {
	s := NewScheduler(5)
	for i := 0; i < 10; i++ {
		s.Enqueue(WorkspaceRequest{WorkspaceID: "ws", ProjectID: "proj", Priority: i})
	}
	if len(s.requestQueue) != 10 {
		t.Errorf("queue length = %d; want 10", len(s.requestQueue))
	}
}

func TestScheduler_Allocate_UnderMax(t *testing.T) {
	s := NewScheduler(3)
	for i := 0; i < 3; i++ {
		if !s.Allocate() {
			t.Errorf("Allocate() returned false on call %d; want true", i+1)
		}
	}
	if s.activeBrowsers != 3 {
		t.Errorf("activeBrowsers = %d; want 3", s.activeBrowsers)
	}
}

func TestScheduler_Allocate_AtMax(t *testing.T) {
	s := NewScheduler(2)
	s.Allocate()
	s.Allocate()

	if s.Allocate() {
		t.Error("Allocate() returned true when at max; want false")
	}
	if s.activeBrowsers != 2 {
		t.Errorf("activeBrowsers = %d; want 2 (should not exceed max)", s.activeBrowsers)
	}
}

func TestScheduler_Release(t *testing.T) {
	s := NewScheduler(3)
	s.Allocate()
	s.Allocate()
	s.Release()
	if s.activeBrowsers != 1 {
		t.Errorf("activeBrowsers after release = %d; want 1", s.activeBrowsers)
	}
}

func TestScheduler_Release_AtZero(t *testing.T) {
	s := NewScheduler(5)
	// Release without any allocation should not go negative.
	s.Release()
	if s.activeBrowsers != 0 {
		t.Errorf("activeBrowsers = %d; want 0 (should not go negative)", s.activeBrowsers)
	}
}

func TestScheduler_AllocateAfterRelease(t *testing.T) {
	s := NewScheduler(1)
	if !s.Allocate() {
		t.Fatal("first Allocate() should succeed")
	}
	if s.Allocate() {
		t.Fatal("second Allocate() should fail (at max)")
	}
	s.Release()
	if !s.Allocate() {
		t.Error("Allocate() after Release() should succeed")
	}
}

func TestScheduler_ConcurrentAllocateRelease(t *testing.T) {
	s := NewScheduler(50)
	var wg sync.WaitGroup
	iterations := 1000

	// Allocate and release concurrently.
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if s.Allocate() {
				// Do some "work"
				s.Release()
			}
		}()
	}
	wg.Wait()

	// After all goroutines finish, active should be 0.
	if s.activeBrowsers != 0 {
		t.Errorf("activeBrowsers after concurrent test = %d; want 0", s.activeBrowsers)
	}
}

func TestScheduler_ConcurrentEnqueue(t *testing.T) {
	s := NewScheduler(10)
	var wg sync.WaitGroup
	n := 500

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			s.Enqueue(WorkspaceRequest{
				WorkspaceID: "ws",
				ProjectID:   "proj",
				Priority:    idx,
			})
		}(i)
	}
	wg.Wait()

	if len(s.requestQueue) != n {
		t.Errorf("queue length = %d; want %d", len(s.requestQueue), n)
	}
}
