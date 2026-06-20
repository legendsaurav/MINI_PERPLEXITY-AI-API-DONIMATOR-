package workspace

import (
	"fmt"
	"sync"
)

type Workspace struct {
	ID        string
	ProjectID string
	mu        sync.Mutex
}

type WorkspaceManager struct {
	workspaces map[string]*Workspace
	globalMu   sync.Mutex
}

func NewWorkspaceManager() *WorkspaceManager {
	return &WorkspaceManager{
		workspaces: make(map[string]*Workspace),
	}
}

func (wm *WorkspaceManager) GetWorkspace(id string, projectID string) *Workspace {
	wm.globalMu.Lock()
	defer wm.globalMu.Unlock()

	key := fmt.Sprintf("%d:%s::%s", len(id), id, projectID)

	ws, exists := wm.workspaces[key]
	if !exists {
		ws = &Workspace{
			ID:        id,
			ProjectID: projectID,
		}
		wm.workspaces[key] = ws
	}
	return ws
}

func (w *Workspace) Lock() {
	w.mu.Lock()
}

func (w *Workspace) Unlock() {
	w.mu.Unlock()
}
