package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/proka/ai-backend/internal/api"
	"github.com/proka/ai-backend/internal/auth"
	"github.com/proka/ai-backend/internal/config"
	"github.com/proka/ai-backend/internal/database"
	"github.com/proka/ai-backend/internal/engine"
	"github.com/proka/ai-backend/internal/maintenance"
	"github.com/proka/ai-backend/internal/providers"
	"github.com/proka/ai-backend/internal/providers/chatgpt"
	"github.com/proka/ai-backend/internal/providers/claude"
	"github.com/proka/ai-backend/internal/providers/deepseek"
	"github.com/proka/ai-backend/internal/providers/gemini"
	"github.com/proka/ai-backend/internal/providers/googlesearch"
	"github.com/proka/ai-backend/internal/providers/kimi"
	"github.com/proka/ai-backend/internal/scheduler"
	"github.com/proka/ai-backend/internal/workspace"
)

func main() {
	// ── Setup structured logging ────────────────────────────────────
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	})))

	slog.Info("═══════════════════════════════════════════════")
	slog.Info("  AI Backend — Centralized Workspace Gateway")
	slog.Info("═══════════════════════════════════════════════")

	// ── Load configuration ──────────────────────────────────────────
	cfg, err := config.Load("config.yaml")
	if err != nil {
		slog.Error("Failed to load configuration", "error", err)
		os.Exit(1)
	}

	// ── Connect to database ─────────────────────────────────────────
	db, err := database.New(cfg.Database)
	if err != nil {
		slog.Warn("Database connection failed — running in standalone mode", "error", err)
		// In standalone mode, the server still starts but auth-required
		// endpoints will reject all requests (no API keys to validate).
		db = nil
	}
	if db != nil {
		defer db.Close()
	}

	// ── Create services ─────────────────────────────────────────────

	// Workspace service
	var workspaceSvc *workspace.Service
	if db != nil {
		workspaceSvc = workspace.NewService(db)
	}

	// Browser engine factory (stub for now — swap with Playwright later)
	engineFactory := &engine.StubEngineFactory{}

	// Scheduler
	sched := scheduler.New(cfg.Browser, engineFactory)
	defer sched.Shutdown()

	// Provider registry
	registry := providers.NewRegistry()
	registry.Register("chatgpt", func(eng engine.BrowserEngine) providers.Provider {
		return chatgpt.New(eng)
	})
	registry.Register("gemini", func(eng engine.BrowserEngine) providers.Provider {
		return gemini.New(eng)
	})
	registry.Register("claude", func(eng engine.BrowserEngine) providers.Provider {
		return claude.New(eng)
	})
	registry.Register("kimi", func(eng engine.BrowserEngine) providers.Provider {
		return kimi.New(eng)
	})
	registry.Register("deepseek", func(eng engine.BrowserEngine) providers.Provider {
		return deepseek.New(eng)
	})
	registry.Register("googlesearch", func(eng engine.BrowserEngine) providers.Provider {
		return googlesearch.New(eng)
	})

	slog.Info("Registered providers", "providers", registry.List())

	// ── Build dependencies ──────────────────────────────────────────
	deps := &api.Dependencies{
		DB:               db,
		WorkspaceService: workspaceSvc,
		Scheduler:        sched,
		ProviderRegistry: registry,
		Config:           cfg,
	}

	// ── File-based auth (standalone mode) ───────────────────────────
	if db == nil {
		fileAuth, err := auth.NewFileAuthProvider("data/api_keys.json")
		if err != nil {
			slog.Warn("File auth provider failed to load", "error", err)
		} else {
			deps.FileAuth = fileAuth
			slog.Info("File-based auth enabled — generate keys with: go run cmd/keygen/main.go -user <name>")
		}
	}

	// ── Create router ───────────────────────────────────────────────
	router := api.NewRouter(deps)

	// ── Start maintenance worker ────────────────────────────────────
	maintenanceWorker := maintenance.NewWorker(sched, cfg.Uploads.TempDir)
	maintenanceWorker.Start(context.Background())
	defer maintenanceWorker.Stop()

	// ── Start HTTP server with graceful shutdown ────────────────────
	server := &http.Server{
		Addr:         cfg.Server.Addr(),
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 5 * time.Minute, // Long timeout for SSE streaming
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown channel
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		slog.Info("═══════════════════════════════════════════════")
		slog.Info(fmt.Sprintf("  Server listening on %s", cfg.Server.Addr()))
		slog.Info("  Health check: GET /v1/health")
		slog.Info("  Chat:         POST /v1/chat")
		slog.Info("═══════════════════════════════════════════════")

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("Server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for shutdown signal
	sig := <-quit
	slog.Info("Shutdown signal received", "signal", sig)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		slog.Error("Server forced shutdown", "error", err)
	}

	slog.Info("Server stopped gracefully. Goodbye.")
}
