package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	ServerAddress string
	Browser       BrowserConfig
	Workspace     WorkspaceConfig
	Provider      ProviderConfig
	SupabaseURL string
	SupabaseKey string
}

type BrowserConfig struct {
	MaxRunning  int
	IdleTimeout time.Duration
	ProfilePath string
}

type WorkspaceConfig struct {
	QueueSize int
}

type ProviderConfig struct {
	StartupTimeout time.Duration
}

func LoadConfig() (*Config, error) {
	// Simple env based config for now
	maxRunning := getEnvAsInt("BROWSER_MAX_RUNNING", 20)
	idleTimeoutStr := getEnv("BROWSER_IDLE_TIMEOUT", "15m")
	idleTimeout, _ := time.ParseDuration(idleTimeoutStr)

	queueSize := getEnvAsInt("WORKSPACE_QUEUE_SIZE", 100)

	startupTimeoutStr := getEnv("PROVIDER_STARTUP_TIMEOUT", "60s")
	startupTimeout, _ := time.ParseDuration(startupTimeoutStr)

	return &Config{
		ServerAddress: getEnv("SERVER_ADDRESS", ":8080"),
		SupabaseURL:   getEnv("SUPABASE_URL", "https://cowmafailphyzkvodjdl.supabase.co"),
		SupabaseKey:   getEnv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvd21hZmFpbHBoeXprdm9kamRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQzOTU1NCwiZXhwIjoyMDk3MDE1NTU0fQ.B9Zl7KYSldGO_8B-LxL-yiaupT0K9jccRChs079VsDU"),
		Browser: BrowserConfig{
			MaxRunning:  maxRunning,
			IdleTimeout: idleTimeout,
			ProfilePath: getEnv("BROWSER_PROFILE_PATH", "./data/browser_profiles"),
		},
		Workspace: WorkspaceConfig{
			QueueSize: queueSize,
		},
		Provider: ProviderConfig{
			StartupTimeout: startupTimeout,
		},
	}, nil
}

func getEnv(key string, defaultVal string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultVal
}

func getEnvAsInt(name string, defaultVal int) int {
	valueStr := getEnv(name, "")
	if value, err := strconv.Atoi(valueStr); err == nil {
		return value
	}
	return defaultVal
}
