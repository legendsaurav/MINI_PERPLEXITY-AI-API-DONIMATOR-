package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/proka/ai-backend/internal/auth"
	"github.com/proka/ai-backend/internal/database"
	"github.com/proka/ai-backend/internal/providers"
	"github.com/proka/ai-backend/internal/streaming"
	"github.com/proka/ai-backend/internal/uploads"
)

// HandleChat is the main chat endpoint handler.
// POST /v1/chat
// Body: {"project": "Coding", "text": "Hello", "images": [], "files": [], "metadata": {}}
func HandleChat(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID, err := auth.WorkspaceIDFromContext(r.Context())
		if err != nil {
			respondError(w, http.StatusUnauthorized, "Invalid workspace context")
			return
		}

		// Decode into intermediate structure for backward compatibility
		var rawReq struct {
			Project  string                      `json:"project"`
			Provider string                      `json:"provider"` // Allow override
			Text     string                      `json:"text"`
			Message  string                      `json:"message"` // Fallback
			Images   []providers.ImageAttachment `json:"images,omitempty"`
			Files    []providers.FileAttachment  `json:"files,omitempty"`
			Metadata map[string]string           `json:"metadata,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&rawReq); err != nil {
			respondError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		req := providers.MessageRequest{
			Project:  rawReq.Project,
			Text:     rawReq.Text,
			Images:   rawReq.Images,
			Files:    rawReq.Files,
			Metadata: rawReq.Metadata,
		}
		if req.Text == "" {
			req.Text = rawReq.Message
		}

		if req.Project == "" {
			req.Project = "General"
		}
		if req.Text == "" && len(req.Files) == 0 && len(req.Images) == 0 {
			respondError(w, http.StatusBadRequest, "Prompt or files must be provided")
			return
		}

		slog.Info("[API] Chat request received",
			"workspace", workspaceID,
			"project", req.Project,
			"message_len", len(req.Text),
			"files_count", len(req.Files),
			"images_count", len(req.Images),
		)

		ch := make(chan providers.StreamChunk, 100)

		// Start background execution goroutine
		go func() {
			defer close(ch)

			ctx := r.Context()

			// 1. Resolve workspace and project
			ch <- providers.StreamChunk{Type: "status", Content: "Resolving workspace..."}
			var ws *database.Workspace
			var proj *database.Project
			
			if deps.WorkspaceService != nil {
				ws, err = deps.WorkspaceService.ResolveWorkspace(ctx, workspaceID)
				if err != nil {
					ch <- providers.StreamChunk{Type: "error", Content: "Workspace not found"}
					return
				}
				proj, err = deps.WorkspaceService.ResolveProject(ctx, workspaceID, req.Project)
				if err != nil {
					ch <- providers.StreamChunk{Type: "error", Content: "Failed to resolve project"}
					return
				}
			} else {
				// Standalone mode: retrieve workspace provider from FileAuth keys
				providerName := "chatgpt" // default fallback
				if deps.FileAuth != nil {
					if rec, ok := deps.FileAuth.GetRecordByWorkspaceID(workspaceID); ok {
						providerName = rec.Provider
					}
				}
				ws = &database.Workspace{
					ID:       workspaceID,
					Provider: providerName,
				}
				proj = &database.Project{
					ID:          "default_project_id",
					WorkspaceID: workspaceID,
					Name:        req.Project,
				}
			}

			// Allow overriding the provider via request body or metadata
			providerName := ws.Provider
			if rawReq.Provider != "" {
				providerName = rawReq.Provider
			} else if req.Metadata != nil && req.Metadata["provider"] != "" {
				providerName = req.Metadata["provider"]
			}

			// 3. Acquire browser slot
			ch <- providers.StreamChunk{Type: "status", Content: "Acquiring browser slot..."}
			slot, err := deps.Scheduler.Acquire(ctx, workspaceID, proj.ID, providerName)
			if err != nil {
				ch <- providers.StreamChunk{Type: "error", Content: "No browser slots available"}
				return
			}
			defer deps.Scheduler.Release(slot.ID)

			// 4. Create provider
			provider, err := deps.ProviderRegistry.Create(providerName, slot.Engine)
			if err != nil {
				ch <- providers.StreamChunk{Type: "error", Content: "Failed to create provider"}
				return
			}

			// 5. Initialize provider
			if err := provider.Initialize(ctx); err != nil {
				ch <- providers.StreamChunk{Type: "error", Content: "Failed to initialize provider: " + err.Error()}
				return
			}

			// 6. Open workspace
			ch <- providers.StreamChunk{Type: "status", Content: "Opening workspace session..."}
			metadata := map[string]interface{}{
				"conversation_url": proj.ConversationURL,
			}
			if err := provider.OpenWorkspace(ctx, metadata); err != nil {
				slog.Warn("[API] Failed to open workspace, starting fresh", "error", err)
			}

			// 7. Process uploads (validation, zip extraction, temp files on disk)
			var processedFiles []providers.FileAttachment
			var uploadID string
			if len(req.Files) > 0 || len(req.Images) > 0 {
				uploadMgr := uploads.NewManager(deps.Config.Uploads)
				var cleanup func()
				processedFiles, uploadID, cleanup, err = uploadMgr.ProcessUploads(ctx, workspaceID, req, provider.Capabilities(), ch)
				if err != nil {
					ch <- providers.StreamChunk{Type: "error", Content: "Upload processing failed: " + err.Error()}
					return
				}
				if cleanup != nil {
					defer cleanup()
				}

				// Transition to Processing
				uploads.LogTransition(uploadID, uploads.Uploaded, uploads.Processing)

				// Upload files using the provider
				ch <- providers.StreamChunk{Type: "status", Content: "Uploading files..."}
				if err := provider.UploadFiles(ctx, processedFiles); err != nil {
					uploads.LogTransition(uploadID, uploads.Processing, uploads.ProcessingFailed)
					ch <- providers.StreamChunk{Type: "error", Content: "Provider upload failed: " + err.Error()}
					return
				}

				// Wait for upload completion verification
				ch <- providers.StreamChunk{Type: "status", Content: "Upload completed."}
				if err := provider.WaitForUploadCompletion(ctx); err != nil {
					uploads.LogTransition(uploadID, uploads.Processing, uploads.ProcessingFailed)
					ch <- providers.StreamChunk{Type: "error", Content: "Upload verification failed: " + err.Error()}
					return
				}

				// Wait for analysis/indexing
				ch <- providers.StreamChunk{Type: "status", Content: "Analyzing repository..."}
				if err := provider.WaitForAnalysisCompletion(ctx); err != nil {
					uploads.LogTransition(uploadID, uploads.Processing, uploads.ProcessingFailed)
					ch <- providers.StreamChunk{Type: "error", Content: "Provider analysis failed: " + err.Error()}
					return
				}

				// Transition to Ready
				uploads.LogTransition(uploadID, uploads.Processing, uploads.Ready)
			}

			// 8. Submit prompt
			if uploadID != "" {
				uploads.LogTransition(uploadID, uploads.Ready, uploads.PromptSubmitted)
			}
			ch <- providers.StreamChunk{Type: "status", Content: "Generating response..."}
			if err := provider.SendMessage(ctx, req); err != nil {
				if uploadID != "" {
					uploads.LogTransition(uploadID, uploads.PromptSubmitted, uploads.ProcessingFailed)
				}
				ch <- providers.StreamChunk{Type: "error", Content: "Failed to send message: " + err.Error()}
				return
			}

			// 9. Stream response
			if uploadID != "" {
				uploads.LogTransition(uploadID, uploads.PromptSubmitted, uploads.Generating)
			}
			respCh, err := provider.StreamResponse(ctx)
			if err != nil {
				if uploadID != "" {
					uploads.LogTransition(uploadID, uploads.Generating, uploads.ProcessingFailed)
				}
				ch <- providers.StreamChunk{Type: "error", Content: "Failed to start streaming: " + err.Error()}
				return
			}

			for chunk := range respCh {
				ch <- chunk
			}

			if uploadID != "" {
				uploads.LogTransition(uploadID, uploads.Generating, uploads.Completed)
			}
		}()

		// Stream to client
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

		var proj *database.Project
		if deps.WorkspaceService != nil {
			var err error
			proj, err = deps.WorkspaceService.CreateProject(r.Context(), workspaceID, req.Name)
			if err != nil {
				respondError(w, http.StatusInternalServerError, "Failed to create project: "+err.Error())
				return
			}
		} else {
			proj = &database.Project{
				ID:          "mock_project_id",
				WorkspaceID: workspaceID,
				Name:        req.Name,
			}
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

		var projects []database.Project
		if deps.WorkspaceService != nil {
			var err error
			projects, err = deps.WorkspaceService.ListProjects(r.Context(), workspaceID)
			if err != nil {
				respondError(w, http.StatusInternalServerError, "Failed to list projects")
				return
			}
		} else {
			projects = []database.Project{
				{
					ID:          "default_project_id",
					WorkspaceID: workspaceID,
					Name:        "General",
				},
			}
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

		var ws *database.Workspace
		if deps.WorkspaceService != nil {
			var err error
			ws, err = deps.WorkspaceService.ResolveWorkspace(r.Context(), workspaceID)
			if err != nil {
				respondError(w, http.StatusNotFound, "Workspace not found")
				return
			}
		} else {
			providerName := "chatgpt"
			if deps.FileAuth != nil {
				if rec, ok := deps.FileAuth.GetRecordByWorkspaceID(workspaceID); ok {
					providerName = rec.Provider
				}
			}
			ws = &database.Workspace{
				ID:       workspaceID,
				Provider: providerName,
			}
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

		providersState := make(map[string]string)
		if deps.Verifier != nil {
			providersState = deps.Verifier.GetStates()
		} else {
			for _, name := range deps.ProviderRegistry.List() {
				providersState[name] = "unknown"
			}
		}

		respondJSON(w, http.StatusOK, map[string]interface{}{
			"status":           "healthy",
			"running_browsers": stats.Total,
			"busy_browsers":    stats.Busy,
			"idle_browsers":    stats.Idle,
			"browser_capacity": stats.Capacity,
			"providers":        providersState,
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
