package browser

import (
	"log"
	"time"

	"github.com/antigravity/go-ai-backend/internal/engine"
	"github.com/antigravity/go-ai-backend/internal/providers"
)

type BrowserState string

const (
	StateStopped    BrowserState = "STOPPED"
	StateStarting   BrowserState = "STARTING"
	StateRunning    BrowserState = "RUNNING"
	StateBusy       BrowserState = "BUSY"
	StateIdle       BrowserState = "IDLE"
	StateRecovering BrowserState = "RECOVERING"
	StateCrashed    BrowserState = "CRASHED"
)

type BrowserInstance struct {
	WorkspaceID string
	ProjectID   string
	State       BrowserState
	Engine      engine.BrowserEngine
	Provider    providers.Provider
	LastUsed    time.Time
}

type BrowserManager struct {
	instances map[string]*BrowserInstance
}

func NewBrowserManager() *BrowserManager {
	return &BrowserManager{
		instances: make(map[string]*BrowserInstance),
	}
}

func (bm *BrowserManager) GetInstance(workspaceID, projectID string) *BrowserInstance {
	key := workspaceID + "::" + projectID
	if inst, exists := bm.instances[key]; exists {
		return inst
	}
	
	// Create a new generic engine. Provider will be injected by the router.
	e := engine.NewPlaywrightEngine()
	
	inst := &BrowserInstance{
		WorkspaceID: workspaceID,
		ProjectID:   projectID,
		State:       StateStopped,
		Engine:      e,
		LastUsed:    time.Now(),
	}
	bm.instances[key] = inst
	return inst
}

func (bm *BrowserManager) Launch(inst *BrowserInstance) error {
	inst.State = StateStarting
	err := inst.Engine.Launch()
	if err != nil {
		inst.State = StateCrashed
		return err
	}
	inst.State = StateIdle
	inst.LastUsed = time.Now()
	return nil
}

func (bm *BrowserManager) Shutdown(inst *BrowserInstance) error {
	err := inst.Engine.Shutdown()
	inst.State = StateStopped
	return err
}

func (bm *BrowserManager) Recover(inst *BrowserInstance) error {
	log.Printf("Recovering browser for workspace %s project %s", inst.WorkspaceID, inst.ProjectID)
	inst.State = StateRecovering
	_ = inst.Engine.Shutdown()
	err := inst.Engine.Launch()
	if err != nil {
		inst.State = StateCrashed
		return err
	}
	// TODO: Restore profile, check session, navigate back
	inst.State = StateIdle
	return nil
}

// CheckIdle instances and shut them down if they exceed the timeout
func (bm *BrowserManager) CleanIdle(timeout time.Duration) {
	now := time.Now()
	for key, inst := range bm.instances {
		if inst.State == StateIdle && now.Sub(inst.LastUsed) > timeout {
			log.Printf("Shutting down idle browser %s", key)
			bm.Shutdown(inst)
		}
	}
}
