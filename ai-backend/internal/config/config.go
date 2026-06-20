package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

// Config holds all application configuration.
type Config struct {
	Server    ServerConfig              `yaml:"server"`
	Database  DatabaseConfig            `yaml:"database"`
	Browser   BrowserConfig             `yaml:"browser"`
	Auth      AuthConfig                `yaml:"auth"`
	Providers map[string]ProviderConfig `yaml:"providers"`
}

// ServerConfig holds HTTP server settings.
type ServerConfig struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
}

// Addr returns the listen address string.
func (s ServerConfig) Addr() string {
	return fmt.Sprintf("%s:%d", s.Host, s.Port)
}

// DatabaseConfig holds PostgreSQL connection settings.
type DatabaseConfig struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	DBName   string `yaml:"dbname"`
	SSLMode  string `yaml:"sslmode"`
}

// DSN returns the PostgreSQL connection string.
func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.DBName, d.SSLMode,
	)
}

// BrowserConfig holds browser pool settings.
type BrowserConfig struct {
	MaxRunning      int    `yaml:"max_running"`
	IdleTimeoutSecs int    `yaml:"idle_timeout_secs"`
	ProfileBasePath string `yaml:"profile_base_path"`
}

// AuthConfig holds authentication settings.
type AuthConfig struct {
	APIKeyPrefix string `yaml:"api_key_prefix"`
}

// ProviderConfig holds per-provider settings.
type ProviderConfig struct {
	BaseURL            string `yaml:"base_url"`
	LoginURL           string `yaml:"login_url"`
	StartupTimeoutSecs int    `yaml:"startup_timeout_secs"`
}

// Load reads config from a YAML file with environment variable overrides.
func Load(path string) (*Config, error) {
	cfg := &Config{
		Server: ServerConfig{Host: "0.0.0.0", Port: 8080},
		Database: DatabaseConfig{
			Host: "localhost", Port: 5432, User: "postgres",
			Password: "postgres", DBName: "ai_backend", SSLMode: "disable",
		},
		Browser: BrowserConfig{
			MaxRunning: 3, IdleTimeoutSecs: 300,
			ProfileBasePath: "./data/browser_profiles",
		},
		Auth:      AuthConfig{APIKeyPrefix: "sk-"},
		Providers: make(map[string]ProviderConfig),
	}

	data, err := os.ReadFile(path)
	if err != nil {
		slog.Warn("Config file not found, using defaults", "path", path, "error", err)
	} else {
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("failed to parse config: %w", err)
		}
	}

	// Environment variable overrides
	if v := os.Getenv("AI_BACKEND_SERVER_HOST"); v != "" {
		cfg.Server.Host = v
	}
	if v := os.Getenv("AI_BACKEND_SERVER_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = p
		}
	}
	if v := os.Getenv("AI_BACKEND_DB_HOST"); v != "" {
		cfg.Database.Host = v
	}
	if v := os.Getenv("AI_BACKEND_DB_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.Database.Port = p
		}
	}
	if v := os.Getenv("AI_BACKEND_DB_USER"); v != "" {
		cfg.Database.User = v
	}
	if v := os.Getenv("AI_BACKEND_DB_PASSWORD"); v != "" {
		cfg.Database.Password = v
	}
	if v := os.Getenv("AI_BACKEND_DB_NAME"); v != "" {
		cfg.Database.DBName = v
	}
	if v := os.Getenv("AI_BACKEND_BROWSER_MAX"); v != "" {
		if m, err := strconv.Atoi(v); err == nil {
			cfg.Browser.MaxRunning = m
		}
	}
	if v := os.Getenv("AI_BACKEND_BROWSER_IDLE_TIMEOUT"); v != "" {
		if t, err := strconv.Atoi(v); err == nil {
			cfg.Browser.IdleTimeoutSecs = t
		}
	}
	if v := os.Getenv("AI_BACKEND_BROWSER_PROFILE_PATH"); v != "" {
		cfg.Browser.ProfileBasePath = v
	}

	slog.Info("Configuration loaded",
		"server", cfg.Server.Addr(),
		"db_host", cfg.Database.Host,
		"browser_max", cfg.Browser.MaxRunning,
	)

	return cfg, nil
}
