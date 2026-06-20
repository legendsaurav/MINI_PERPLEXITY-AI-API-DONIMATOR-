package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/antigravity/go-ai-backend/internal/auth"
	"github.com/antigravity/go-ai-backend/internal/browser"
	"github.com/antigravity/go-ai-backend/internal/config"
	"github.com/antigravity/go-ai-backend/internal/db"
	"github.com/antigravity/go-ai-backend/internal/providers"
	"github.com/antigravity/go-ai-backend/internal/scheduler"
)

// Server holds all dependencies for the HTTP handlers.
type Server struct {
	cfg            *config.Config
	dbClient       *db.Client
	browserManager *browser.BrowserManager
	allocator      *scheduler.BrowserAllocator
	registry       *providers.Registry
}

// NewServer creates a new Server with all dependencies.
func NewServer(cfg *config.Config, dbClient *db.Client, bm *browser.BrowserManager, alloc *scheduler.BrowserAllocator, reg *providers.Registry) *Server {
	return &Server{
		cfg:            cfg,
		dbClient:       dbClient,
		browserManager: bm,
		allocator:      alloc,
		registry:       reg,
	}
}

// SetupRouter creates the HTTP router with all routes.
func SetupRouter(cfg *config.Config, dbClient *db.Client) *http.ServeMux {
	bm := browser.NewBrowserManager()
	alloc := scheduler.NewBrowserAllocator(cfg.Browser.MaxRunning)
	reg := providers.NewRegistry()
	srv := NewServer(cfg, dbClient, bm, alloc, reg)
	return srv.Routes()
}

func (s *Server) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	authMiddleware := auth.Middleware(s.dbClient)

	// Protected endpoints
	mux.HandleFunc("POST /v1/chat", authMiddleware(s.handleChat))
	mux.HandleFunc("POST /v1/chat/stream", authMiddleware(s.handleChatStream))
	mux.HandleFunc("POST /v1/project/create", authMiddleware(s.handleCreateProject))
	mux.HandleFunc("GET /v1/projects", authMiddleware(s.handleListProjects))
	mux.HandleFunc("DELETE /v1/project/{name}", authMiddleware(s.handleDeleteProject))
	mux.HandleFunc("GET /v1/providers", authMiddleware(s.handleProviders))
	mux.HandleFunc("GET /v1/workspace", authMiddleware(s.handleWorkspace))

	// Public endpoints
	mux.HandleFunc("GET /v1/health", s.handleHealth)

	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	health := map[string]interface{}{
		"status":           "healthy",
		"running_browsers": s.allocator.ActiveCount(),
		"queued_requests":  0,
		"idle_workspaces":  0,
		"providers": map[string]string{
			"chatgpt": "ok",
		},
	}
	json.NewEncoder(w).Encode(health)
}

// ChatRequest is the JSON body for non-streaming chat.
type ChatRequest struct {
	Message  string `json:"message"`
	Project  string `json:"project"`
	Provider string `json:"provider"`
}

func (s *Server) handleChat(w http.ResponseWriter, r *http.Request) {
	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Message == "" {
		http.Error(w, "message is required", http.StatusBadRequest)
		return
	}
	if req.Provider == "" {
		req.Provider = "chatgpt"
	}
	if !s.registry.Has(req.Provider) {
		http.Error(w, "unknown provider: "+req.Provider, http.StatusBadRequest)
		return
	}

	// Get workspace/project from auth context
	workspaceID := r.Context().Value(auth.ContextKeyWorkspaceID).(string)

	// Get or create browser instance
	inst := s.browserManager.GetInstance(workspaceID, req.Project)
	if inst.Provider == nil {
		prov, err := s.registry.Create(req.Provider, inst.Engine)
		if err != nil {
			http.Error(w, "failed to create provider", http.StatusInternalServerError)
			return
		}
		inst.Provider = prov
	}

	// Send message
	msgReq := providers.MessageRequest{
		Project: req.Project,
		Text:    req.Message,
	}
	if err := inst.Provider.SendMessage(msgReq); err != nil {
		http.Error(w, "failed to send message: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Collect full response
	ch, err := inst.Provider.StreamResponse()
	if err != nil {
		http.Error(w, "failed to stream response", http.StatusInternalServerError)
		return
	}

	var fullText strings.Builder
	for chunk := range ch {
		if chunk.Error != nil {
			http.Error(w, "provider error: "+chunk.Error.Error(), http.StatusInternalServerError)
			return
		}
		fullText.WriteString(chunk.Text)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"response": fullText.String(),
		"provider": req.Provider,
		"project":  req.Project,
	})
}

func (s *Server) handleChatStream(w http.ResponseWriter, r *http.Request) {
	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Message == "" {
		http.Error(w, "message is required", http.StatusBadRequest)
		return
	}
	if req.Provider == "" {
		req.Provider = "chatgpt"
	}

	workspaceID := r.Context().Value(auth.ContextKeyWorkspaceID).(string)
	inst := s.browserManager.GetInstance(workspaceID, req.Project)
	if inst.Provider == nil {
		prov, err := s.registry.Create(req.Provider, inst.Engine)
		if err != nil {
			http.Error(w, "failed to create provider", http.StatusInternalServerError)
			return
		}
		inst.Provider = prov
	}

	msgReq := providers.MessageRequest{
		Project: req.Project,
		Text:    req.Message,
	}
	if err := inst.Provider.SendMessage(msgReq); err != nil {
		http.Error(w, "failed to send message: "+err.Error(), http.StatusInternalServerError)
		return
	}

	ch, err := inst.Provider.StreamResponse()
	if err != nil {
		http.Error(w, "failed to stream response", http.StatusInternalServerError)
		return
	}

	StreamResponse(w, r, ch)
}

type CreateProjectRequest struct {
	Name     string `json:"name"`
	Provider string `json:"provider"`
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var req CreateProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if req.Provider == "" {
		req.Provider = "chatgpt"
	}

	workspaceID := r.Context().Value(auth.ContextKeyWorkspaceID).(string)

	// Create project in DB
	project := &db.Project{
		WorkspaceID: workspaceID,
		Name:        req.Name,
		ProviderMetadata: map[string]interface{}{
			"provider": req.Provider,
		},
	}

	err := s.dbClient.CreateProject(project)
	if err != nil {
		log.Printf("Failed to create project: %v", err)
		http.Error(w, "failed to create project", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "created",
		"project": project,
	})
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.Context().Value(auth.ContextKeyWorkspaceID).(string)

	projects, err := s.dbClient.ListProjects(workspaceID)
	if err != nil {
		log.Printf("Failed to list projects: %v", err)
		http.Error(w, "failed to list projects", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"projects": projects,
	})
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "project name is required", http.StatusBadRequest)
		return
	}

	workspaceID := r.Context().Value(auth.ContextKeyWorkspaceID).(string)

	err := s.dbClient.DeleteProject(workspaceID, name)
	if err != nil {
		log.Printf("Failed to delete project: %v", err)
		http.Error(w, "failed to delete project", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "deleted",
		"name":   name,
	})
}

func (s *Server) handleProviders(w http.ResponseWriter, r *http.Request) {
	names := s.registry.List()
	result := make([]map[string]interface{}, 0, len(names))
	for _, name := range names {
		result = append(result, map[string]interface{}{
			"name":   name,
			"status": "available",
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"providers": result,
	})
}

func (s *Server) handleWorkspace(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.Context().Value(auth.ContextKeyWorkspaceID).(string)

	workspace, err := s.dbClient.FetchWorkspace(workspaceID)
	if err != nil {
		log.Printf("Failed to fetch workspace: %v", err)
		http.Error(w, "failed to fetch workspace", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"workspace": workspace,
	})
}
