package scheduler

import (
	"sync"
	"testing"
)

func TestNewBrowserAllocator(t *testing.T) {
	a := NewBrowserAllocator(10)
	if a == nil {
		t.Fatal("NewBrowserAllocator returned nil")
	}
	if a.maxBrowsers != 10 {
		t.Errorf("maxBrowsers = %d; want 10", a.maxBrowsers)
	}
	if a.activeBrowsers != 0 {
		t.Errorf("activeBrowsers = %d; want 0", a.activeBrowsers)
	}
}

func TestNewBrowserAllocator_ZeroMax(t *testing.T) {
	a := NewBrowserAllocator(0)
	if a.Allocate() {
		t.Error("Allocate() with max=0 should return false")
	}
	if a.ActiveCount() != 0 {
		t.Errorf("ActiveCount = %d; want 0", a.ActiveCount())
	}
}

func TestNewBrowserAllocator_OneMax(t *testing.T) {
	a := NewBrowserAllocator(1)
	if !a.Allocate() {
		t.Error("Allocate() should succeed with max=1 and no active")
	}
	if a.Allocate() {
		t.Error("Allocate() should fail when at max=1")
	}
}

func TestBrowserAllocator_AllocateUpToMax(t *testing.T) {
	max := 5
	a := NewBrowserAllocator(max)

	for i := 0; i < max; i++ {
		if !a.Allocate() {
			t.Errorf("Allocate() %d returned false; want true", i+1)
		}
	}
	if a.ActiveCount() != max {
		t.Errorf("ActiveCount = %d; want %d", a.ActiveCount(), max)
	}
}

func TestBrowserAllocator_AllocateBeyondMax(t *testing.T) {
	a := NewBrowserAllocator(3)
	a.Allocate()
	a.Allocate()
	a.Allocate()

	if a.Allocate() {
		t.Error("Allocate() beyond max should return false")
	}
	// Count should stay at max.
	if a.ActiveCount() != 3 {
		t.Errorf("ActiveCount = %d; want 3", a.ActiveCount())
	}
}

func TestBrowserAllocator_Release(t *testing.T) {
	a := NewBrowserAllocator(5)
	a.Allocate()
	a.Allocate()
	a.Allocate()

	a.Release()
	if a.ActiveCount() != 2 {
		t.Errorf("ActiveCount after Release = %d; want 2", a.ActiveCount())
	}

	a.Release()
	a.Release()
	if a.ActiveCount() != 0 {
		t.Errorf("ActiveCount after all releases = %d; want 0", a.ActiveCount())
	}
}

func TestBrowserAllocator_Release_NeverNegative(t *testing.T) {
	a := NewBrowserAllocator(5)
	// Release without allocation.
	a.Release()
	a.Release()
	if a.ActiveCount() != 0 {
		t.Errorf("ActiveCount = %d; want 0 (should not go negative)", a.ActiveCount())
	}
}

func TestBrowserAllocator_AllocateAfterRelease(t *testing.T) {
	a := NewBrowserAllocator(2)
	a.Allocate()
	a.Allocate()

	if a.Allocate() {
		t.Fatal("should be at max")
	}

	a.Release()
	if !a.Allocate() {
		t.Error("Allocate after Release should succeed")
	}
}

func TestBrowserAllocator_ActiveCount_Accurate(t *testing.T) {
	a := NewBrowserAllocator(10)

	checks := []struct {
		action string
		expect int
	}{
		{"alloc", 1},
		{"alloc", 2},
		{"alloc", 3},
		{"release", 2},
		{"alloc", 3},
		{"release", 2},
		{"release", 1},
		{"release", 0},
	}

	for i, c := range checks {
		switch c.action {
		case "alloc":
			a.Allocate()
		case "release":
			a.Release()
		}
		if got := a.ActiveCount(); got != c.expect {
			t.Errorf("step %d (%s): ActiveCount = %d; want %d", i, c.action, got, c.expect)
		}
	}
}

func TestBrowserAllocator_ConcurrentAllocateRelease(t *testing.T) {
	a := NewBrowserAllocator(100)
	var wg sync.WaitGroup
	iterations := 2000

	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if a.Allocate() {
				a.Release()
			}
		}()
	}
	wg.Wait()

	if a.ActiveCount() != 0 {
		t.Errorf("ActiveCount after concurrent ops = %d; want 0", a.ActiveCount())
	}
}

func TestBrowserAllocator_ConcurrentAllocateOnly(t *testing.T) {
	max := 50
	a := NewBrowserAllocator(max)
	var wg sync.WaitGroup
	successCount := 0
	var mu sync.Mutex

	// Attempt many more allocations than max.
	attempts := 200
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if a.Allocate() {
				mu.Lock()
				successCount++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if successCount != max {
		t.Errorf("successful allocations = %d; want %d (max)", successCount, max)
	}
	if a.ActiveCount() != max {
		t.Errorf("ActiveCount = %d; want %d", a.ActiveCount(), max)
	}
}

func TestBrowserAllocator_LargeMax(t *testing.T) {
	a := NewBrowserAllocator(1000000)
	if !a.Allocate() {
		t.Error("Allocate should succeed with large max")
	}
	if a.ActiveCount() != 1 {
		t.Errorf("ActiveCount = %d; want 1", a.ActiveCount())
	}
}
