package workspace

import (
	"sync"
	"testing"
)

func TestNewWorkspaceManager(t *testing.T) {
	wm := NewWorkspaceManager()
	if wm == nil {
		t.Fatal("NewWorkspaceManager returned nil")
	}
	if wm.workspaces == nil {
		t.Fatal("workspaces map is nil")
	}
	if len(wm.workspaces) != 0 {
		t.Errorf("workspaces map length = %d; want 0", len(wm.workspaces))
	}
}

func TestGetWorkspace_CreatesNew(t *testing.T) {
	wm := NewWorkspaceManager()
	ws := wm.GetWorkspace("ws-1", "proj-1")
	if ws == nil {
		t.Fatal("GetWorkspace returned nil")
	}
	if ws.ID != "ws-1" {
		t.Errorf("ID = %q; want %q", ws.ID, "ws-1")
	}
	if ws.ProjectID != "proj-1" {
		t.Errorf("ProjectID = %q; want %q", ws.ProjectID, "proj-1")
	}
}

func TestGetWorkspace_ReturnsSameForSameKey(t *testing.T) {
	wm := NewWorkspaceManager()
	ws1 := wm.GetWorkspace("ws-1", "proj-1")
	ws2 := wm.GetWorkspace("ws-1", "proj-1")

	if ws1 != ws2 {
		t.Error("GetWorkspace should return the same pointer for the same key")
	}
}

func TestGetWorkspace_DifferentKeysCreateDifferent(t *testing.T) {
	wm := NewWorkspaceManager()

	ws1 := wm.GetWorkspace("ws-1", "proj-1")
	ws2 := wm.GetWorkspace("ws-2", "proj-1")
	ws3 := wm.GetWorkspace("ws-1", "proj-2")

	if ws1 == ws2 {
		t.Error("different workspace IDs should create different workspaces")
	}
	if ws1 == ws3 {
		t.Error("different project IDs should create different workspaces")
	}
	if ws2 == ws3 {
		t.Error("ws2 and ws3 should be different workspaces")
	}
}

func TestGetWorkspace_KeyComposition(t *testing.T) {
	wm := NewWorkspaceManager()

	// Ensure that key composition "a::b" != "a::" + ":b" by checking
	// that ("a:", "b") and ("a", ":b") produce different workspaces.
	ws1 := wm.GetWorkspace("a:", "b")
	ws2 := wm.GetWorkspace("a", ":b")

	if ws1 == ws2 {
		t.Error("('a:', 'b') and ('a', ':b') should produce different workspaces")
	}
}

func TestWorkspace_LockUnlock(t *testing.T) {
	wm := NewWorkspaceManager()
	ws := wm.GetWorkspace("ws-1", "proj-1")

	// This simply verifies Lock/Unlock don't panic or deadlock.
	ws.Lock()
	ws.Unlock()
}

func TestWorkspace_LockProtectsCriticalSection(t *testing.T) {
	wm := NewWorkspaceManager()
	ws := wm.GetWorkspace("ws-1", "proj-1")

	counter := 0
	iterations := 1000
	var wg sync.WaitGroup

	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ws.Lock()
			counter++
			ws.Unlock()
		}()
	}
	wg.Wait()

	if counter != iterations {
		t.Errorf("counter = %d; want %d (race condition detected)", counter, iterations)
	}
}

func TestGetWorkspace_ConcurrentAccess(t *testing.T) {
	wm := NewWorkspaceManager()
	var wg sync.WaitGroup
	n := 500

	// All goroutines request the same key — should return the same workspace.
	results := make([]*Workspace, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			results[idx] = wm.GetWorkspace("ws-shared", "proj-shared")
		}(i)
	}
	wg.Wait()

	first := results[0]
	for i, ws := range results {
		if ws != first {
			t.Errorf("result[%d] is a different pointer than result[0]; all should be the same", i)
			break
		}
	}
}

func TestGetWorkspace_ConcurrentDifferentKeys(t *testing.T) {
	wm := NewWorkspaceManager()
	var wg sync.WaitGroup
	n := 100

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			ws := wm.GetWorkspace("ws", "proj")
			_ = ws
		}(i)
	}
	wg.Wait()

	// Should have exactly 1 entry.
	if len(wm.workspaces) != 1 {
		t.Errorf("workspaces map size = %d; want 1", len(wm.workspaces))
	}
}

func TestWorkspace_EmptyIDs(t *testing.T) {
	wm := NewWorkspaceManager()
	ws := wm.GetWorkspace("", "")
	if ws == nil {
		t.Fatal("GetWorkspace with empty IDs returned nil")
	}
	if ws.ID != "" || ws.ProjectID != "" {
		t.Errorf("expected empty IDs, got ID=%q, ProjectID=%q", ws.ID, ws.ProjectID)
	}
}
