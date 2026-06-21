package api

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/proka/ai-backend/internal/auth"
	"github.com/proka/ai-backend/internal/config"
	"github.com/proka/ai-backend/internal/database"
	"github.com/proka/ai-backend/internal/providers"
	"github.com/proka/ai-backend/internal/scheduler"
	"github.com/proka/ai-backend/internal/workspace"
)

// Dependencies holds all services required by the API handlers.
type Dependencies struct {
	DB               *database.DB
	WorkspaceService *workspace.Service
	Scheduler        *scheduler.Scheduler
	ProviderRegistry *providers.Registry
	FileAuth         *auth.FileAuthProvider // Used when DB is nil
	Config           *config.Config
	Verifier         *providers.Verifier
}

// NewRouter creates the chi router with all middleware and routes.
func NewRouter(deps *Dependencies) *chi.Mux {
	r := chi.NewRouter()

	// ── Global Middleware ────────────────────────────────────────────
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(slogMiddleware)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-API-Key"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// ── Public Routes (no auth) ─────────────────────────────────────
	r.Get("/v1/health", HandleHealth(deps))

	// ── Authenticated Routes ────────────────────────────────────────
	// Choose auth middleware: file-based (standalone) or database-backed
	var authMiddleware func(http.Handler) http.Handler
	if deps.FileAuth != nil {
		slog.Info("Using file-based API key authentication")
		authMiddleware = auth.FileMiddleware(deps.FileAuth)
	} else {
		slog.Info("Using database-backed API key authentication")
		authMiddleware = auth.Middleware(deps.DB)
	}

	r.Group(func(r chi.Router) {
		r.Use(authMiddleware)

		// Chat
		r.Post("/v1/chat", HandleChat(deps))

		// Projects
		r.Post("/v1/project/create", HandleCreateProject(deps))
		r.Get("/v1/projects", HandleListProjects(deps))

		// Workspace
		r.Get("/v1/workspace", HandleGetWorkspace(deps))

		// Providers
		r.Get("/v1/providers", HandleListProviders(deps))
	})

	slog.Info("Router initialized",
		"public_routes", []string{"/v1/health"},
		"auth_routes", []string{"/v1/chat", "/v1/project/create", "/v1/projects", "/v1/workspace", "/v1/providers"},
	)

	return r
}

// slogMiddleware logs each HTTP request using slog.
func slogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		defer func() {
			slog.Info("HTTP request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"bytes", ww.BytesWritten(),
				"remote", r.RemoteAddr,
			)
		}()
		next.ServeHTTP(ww, r)
	})
}
