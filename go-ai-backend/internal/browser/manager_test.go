package browser

import (
	"testing"
)

func TestNewBrowserManager(t *testing.T) {
	bm := NewBrowserManager()
	if bm == nil {
		t.Fatal("expected non-nil BrowserManager")
	}
	if bm.instances == nil {
		t.Fatal("expected instances map to be initialized")
	}
}

func TestGetInstance_CreatesNew(t *testing.T) {
	bm := NewBrowserManager()
	inst := bm.GetInstance("ws-1", "proj-1")
	if inst == nil {
		t.Fatal("expected non-nil instance")
	}
	if inst.WorkspaceID != "ws-1" {
		t.Errorf("expected WorkspaceID=ws-1, got %s", inst.WorkspaceID)
	}
	if inst.ProjectID != "proj-1" {
		t.Errorf("expected ProjectID=proj-1, got %s", inst.ProjectID)
	}
}

func TestGetInstance_ReturnsSameForSameKey(t *testing.T) {
	bm := NewBrowserManager()
	inst1 := bm.GetInstance("ws-1", "proj-1")
	inst2 := bm.GetInstance("ws-1", "proj-1")
	if inst1 != inst2 {
		t.Error("expected same instance for same workspace+project key")
	}
}

func TestGetInstance_ReturnsDifferentForDifferentKeys(t *testing.T) {
	bm := NewBrowserManager()
	inst1 := bm.GetInstance("ws-1", "proj-1")
	inst2 := bm.GetInstance("ws-2", "proj-1")
	inst3 := bm.GetInstance("ws-1", "proj-2")
	if inst1 == inst2 {
		t.Error("expected different instances for different workspace IDs")
	}
	if inst1 == inst3 {
		t.Error("expected different instances for different project IDs")
	}
	if inst2 == inst3 {
		t.Error("expected different instances for different keys")
	}
}

func TestGetInstance_StartsInStateStopped(t *testing.T) {
	bm := NewBrowserManager()
	inst := bm.GetInstance("ws-1", "proj-1")
	if inst.State != StateStopped {
		t.Errorf("expected State=STOPPED, got %s", inst.State)
	}
}

func TestGetInstance_HasEngine(t *testing.T) {
	bm := NewBrowserManager()
	inst := bm.GetInstance("ws-1", "proj-1")
	if inst.Engine == nil {
		t.Error("expected non-nil Engine on new instance")
	}
}

func TestGetInstance_HasLastUsed(t *testing.T) {
	bm := NewBrowserManager()
	inst := bm.GetInstance("ws-1", "proj-1")
	if inst.LastUsed.IsZero() {
		t.Error("expected LastUsed to be set")
	}
}

func TestBrowserStates_Constants(t *testing.T) {
	states := map[BrowserState]string{
		StateStopped:    "STOPPED",
		StateStarting:   "STARTING",
		StateRunning:    "RUNNING",
		StateBusy:       "BUSY",
		StateIdle:       "IDLE",
		StateRecovering: "RECOVERING",
		StateCrashed:    "CRASHED",
	}
	for state, expected := range states {
		if string(state) != expected {
			t.Errorf("expected %s, got %s", expected, string(state))
		}
	}
}

func TestMultipleInstances_StoredCorrectly(t *testing.T) {
	bm := NewBrowserManager()
	_ = bm.GetInstance("ws-a", "proj-a")
	_ = bm.GetInstance("ws-b", "proj-b")
	_ = bm.GetInstance("ws-c", "proj-c")

	if len(bm.instances) != 3 {
		t.Errorf("expected 3 instances, got %d", len(bm.instances))
	}
}
