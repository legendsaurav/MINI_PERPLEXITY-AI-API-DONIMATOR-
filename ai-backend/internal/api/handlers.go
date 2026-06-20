package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/proka/ai-backend/internal/auth"
	"github.com/proka/ai-backend/internal/providers"
	"github.com/proka/ai-backend/internal/streaming"
)

// HandleChat is the main chat endpoint handler.
// POST /v1/chat
// Body: {"project": "Coding", "message": "Hello", "images": []}
func HandleChat(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID, err := auth.WorkspaceIDFromContext(r.Context())
		if err != nil {
			respondError(w, http.StatusUnauthorized, "Invalid workspace context")
			return
		}

		var req struct {
			Project string `json:"project"`
			Message string `json:"message"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		if req.Project == "" {
			req.Project = "General"
		}
		if req.Message == "" {
			respondError(w, http.StatusBadRequest, "Message cannot be empty")
			return
		}

		slog.Info("[API] Chat request",
			"workspace", workspaceID,
			"project", req.Project,
			"message_len", len(req.Message),
		)

		// 1. Resolve workspace
		ws, err := deps.WorkspaceService.ResolveWorkspace(r.Context(), workspaceID)
		if err != nil {
			respondError(w, http.StatusNotFound, "Workspace not found")
			return
		}

		// 2. Resolve project (auto-creates if not exists)
		proj, err := deps.WorkspaceService.ResolveProject(r.Context(), workspaceID, req.Project)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to resolve project")
			return
		}

		// 3. Acquire browser slot
		slot, err := deps.Scheduler.Acquire(r.Context(), workspaceID, proj.ID, ws.Provider)
		if err != nil {
			respondError(w, http.StatusServiceUnavailable, "No browser slots available")
			return
		}
		defer deps.Scheduler.Release(slot.ID)

		// 4. Create provider
		provider, err := deps.ProviderRegistry.Create(ws.Provider, slot.Engine)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to create provider")
			return
		}

		// 5. Open conversation
		if err := provider.OpenConversation(r.Context(), proj.ConversationURL); err != nil {
			slog.Warn("[API] Failed to open conversation, starting fresh", "error", err)
		}

		// 6. Send message
		msgReq := providers.MessageRequest{
			Project: req.Project,
			Text:    req.Message,
		}
		if err := provider.SendMessage(r.Context(), msgReq); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to send message: "+err.Error())
			return
		}

		// 7. Stream response via SSE
		ch, err := provider.StreamResponse(r.Context())
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to start streaming")
			return
		}

		streaming.StreamToClient(w, r, ch)
	}
}

// HandleCreateProject handles project creation.
// POST /v1/project/create
// Body: {"name": "My Project"}
func HandleCreateProject(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID, err := auth.WorkspaceIDFromContext(r.Context())
		if err != nil {
			respondError(w, http.StatusUnauthorized, "Invalid workspace context")
			return
		}

		var req struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		if req.Name == "" {
			respondError(w, http.StatusBadRequest, "Project name is required")
			return
		}

		proj, err := deps.WorkspaceService.CreateProject(r.Context(), workspaceID, req.Name)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to create project: "+err.Error())
			return
		}

		respondJSON(w, http.StatusCreated, SuccessResponse{OK: true, Data: proj})
	}
}

// HandleListProjects returns all projects for the authenticated workspace.
// GET /v1/projects
func HandleListProjects(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID, err := auth.WorkspaceIDFromContext(r.Context())
		if err != nil {
			respondError(w, http.StatusUnauthorized, "Invalid workspace context")
			return
		}

		projects, err := deps.WorkspaceService.ListProjects(r.Context(), workspaceID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to list projects")
			return
		}

		respondJSON(w, http.StatusOK, SuccessResponse{OK: true, Data: projects})
	}
}

// HandleGetWorkspace returns workspace info.
// GET /v1/workspace
func HandleGetWorkspace(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID, err := auth.WorkspaceIDFromContext(r.Context())
		if err != nil {
			respondError(w, http.StatusUnauthorized, "Invalid workspace context")
			return
		}

		ws, err := deps.WorkspaceService.ResolveWorkspace(r.Context(), workspaceID)
		if err != nil {
			respondError(w, http.StatusNotFound, "Workspace not found")
			return
		}

		// Sanitize: never expose internal paths
		safeWs := map[string]interface{}{
			"id":         ws.ID,
			"provider":   ws.Provider,
			"created_at": ws.CreatedAt,
			"updated_at": ws.UpdatedAt,
			"last_used":  ws.LastUsed,
		}

		respondJSON(w, http.StatusOK, SuccessResponse{OK: true, Data: safeWs})
	}
}

// HandleHealth returns system health and metrics.
// GET /v1/health (public — no auth required)
func HandleHealth(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stats := deps.Scheduler.Stats()

		respondJSON(w, http.StatusOK, map[string]interface{}{
			"status":           "healthy",
			"running_browsers": stats.Total,
			"busy_browsers":    stats.Busy,
			"idle_browsers":    stats.Idle,
			"browser_capacity": stats.Capacity,
			"providers":        deps.ProviderRegistry.List(),
		})
	}
}

// HandleListProviders returns available AI providers.
// GET /v1/providers
func HandleListProviders(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		respondJSON(w, http.StatusOK, SuccessResponse{
			OK:   true,
			Data: deps.ProviderRegistry.List(),
		})
	}
}
