package main

import (
	"log"
	"net/http"
	"time"

	"github.com/antigravity/go-ai-backend/internal/api"
	"github.com/antigravity/go-ai-backend/internal/browser"
	"github.com/antigravity/go-ai-backend/internal/config"
	"github.com/antigravity/go-ai-backend/internal/db"
	"github.com/antigravity/go-ai-backend/internal/maintenance"
	"github.com/antigravity/go-ai-backend/internal/providers"
	"github.com/antigravity/go-ai-backend/internal/scheduler"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize database client
	dbClient := db.NewClient(cfg)

	// Initialize browser manager and allocator
	bm := browser.NewBrowserManager()
	alloc := scheduler.NewBrowserAllocator(cfg.Browser.MaxRunning)

	// Initialize provider registry
	reg := providers.NewRegistry()

	// Start maintenance worker
	mw := maintenance.NewWorker(bm, cfg.Browser.IdleTimeout)
	mw.Start()
	defer mw.Stop()

	// Create server and routes
	srv := api.NewServer(cfg, dbClient, bm, alloc, reg)
	router := srv.Routes()

	log.Printf("AI Backend starting on %s", cfg.ServerAddress)
	log.Printf("Browser pool: max=%d, idle_timeout=%s", cfg.Browser.MaxRunning, cfg.Browser.IdleTimeout)
	log.Printf("Registered providers: %v", reg.List())

	httpServer := &http.Server{
		Addr:         cfg.ServerAddress,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	if err := httpServer.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
