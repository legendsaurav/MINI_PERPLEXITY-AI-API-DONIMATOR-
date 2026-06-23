package main

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/your-repo/ai-gateway-backend/internal/api"
	"github.com/your-repo/ai-gateway-backend/internal/core/ports"
	"github.com/your-repo/ai-gateway-backend/internal/repository/postgres"
	"github.com/your-repo/ai-gateway-backend/internal/repository/supabase"
	"github.com/your-repo/ai-gateway-backend/internal/services/chat"
	contextSvc "github.com/your-repo/ai-gateway-backend/internal/services/context"
	routerSvc "github.com/your-repo/ai-gateway-backend/internal/services/router"
	"github.com/your-repo/ai-gateway-backend/pkg/config"
	"github.com/your-repo/ai-gateway-backend/pkg/logger"
	"os"
)

func main() {
	// 1. Load Configuration
	cfgPath := "config.json"
	if envPath := os.Getenv("CONFIG_PATH"); envPath != "" {
		cfgPath = envPath
	}

	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		logger.ErrorLog.Printf("Failed to load config from %s: %v. Falling back to environment variables.", cfgPath, err)
		cfg = &config.Config{
			Models: make(map[string]string),
		}
	}

	// Environment overrides
	if dbURL := os.Getenv("DATABASE_URL"); dbURL != "" {
		cfg.DatabaseURL = dbURL
	}
	if apiKey := os.Getenv("API_KEY"); apiKey != "" {
		cfg.APIKey = apiKey
	}
	if port := os.Getenv("PORT"); port != "" {
		cfg.Port = port
	}
	if sbURL := os.Getenv("SUPABASE_URL"); sbURL != "" {
		cfg.SupabaseURL = sbURL
	}
	if sbKey := os.Getenv("SUPABASE_KEY"); sbKey != "" {
		cfg.SupabaseKey = sbKey
	}

	// 2. Database/Repository Setup
	var convRepo ports.ConversationRepository
	var msgRepo ports.MessageRepository
	var memRepo ports.MemoryRepository

	if cfg.SupabaseURL != "" && cfg.SupabaseKey != "" {
		logger.InfoLog.Printf("Using remote Supabase REST API for repositories: %s\n", cfg.SupabaseURL)
		sbClient := supabase.NewSupabaseClient(cfg.SupabaseURL, cfg.SupabaseKey)
		convRepo = supabase.NewConversationRepository(sbClient)
		msgRepo = supabase.NewMessageRepository(sbClient)
		memRepo = supabase.NewMemoryRepository(sbClient)
	} else {
		if cfg.DatabaseURL == "" {
			logger.ErrorLog.Fatal("DATABASE_URL is required when Supabase configurations are not set")
		}
		logger.InfoLog.Printf("Connecting to local database: %s\n", cfg.DatabaseURL)
		pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
		if err != nil {
			logger.ErrorLog.Fatalf("Unable to connect to database: %v", err)
		}
		defer pool.Close()

		convRepo = postgres.NewConversationRepository(pool)
		msgRepo = postgres.NewMessageRepository(pool)
		memRepo = postgres.NewMemoryRepository(pool)
	}

	// 4. Initialize Services
	contextEngine := contextSvc.NewContextEngine(msgRepo, memRepo)
	modelRouter := routerSvc.NewModelRouter()
	
	// Register models from config
	for name, endpoint := range cfg.Models {
		modelRouter.RegisterModel(name, endpoint)
		logger.InfoLog.Printf("Registered model: %s -> %s", name, endpoint)
	}

	chatService := chat.NewChatService(msgRepo, convRepo, contextEngine, modelRouter)

	// 5. Initialize and Start Server
	server := api.NewServer(chatService, cfg.APIKey, cfg.SupabaseURL, cfg.SupabaseKey)

	logger.InfoLog.Printf("AI Gateway Backend starting on :%s\n", cfg.Port)
	if err := server.Start(":" + cfg.Port); err != nil {
		logger.ErrorLog.Fatalf("Server failed: %v", err)
	}
}

