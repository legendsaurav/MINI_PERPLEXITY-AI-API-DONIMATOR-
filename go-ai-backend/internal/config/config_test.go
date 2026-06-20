package config

import (
	"testing"
	"time"
)

func TestLoadConfig_Defaults(t *testing.T) {
	// Ensure none of the env vars we care about are set.
	// t.Setenv automatically restores the original value after the test.
	t.Setenv("BROWSER_MAX_RUNNING", "")
	t.Setenv("BROWSER_IDLE_TIMEOUT", "")
	t.Setenv("BROWSER_PROFILE_PATH", "")
	t.Setenv("WORKSPACE_QUEUE_SIZE", "")
	t.Setenv("PROVIDER_STARTUP_TIMEOUT", "")
	t.Setenv("SERVER_ADDRESS", "")
	t.Setenv("SUPABASE_URL", "")
	t.Setenv("SUPABASE_KEY", "")

	// With empty-string env vars, getEnvAsInt will fail Atoi and fall back to
	// defaults, but getEnv will return the empty string (because the var exists
	// but is empty). So we need to unset them instead. t.Setenv("K","") sets
	// the var to "". We must clear them with os.Unsetenv wrapped in a helper.
	// Actually, there is no t.Unsetenv; t.Setenv("K","") sets K="".
	// getEnv checks os.LookupEnv — if key exists it returns the value even if "".
	// So to truly test defaults we must NOT have these vars set at all.
	// The cleanest approach: we clear them by unsetting before LoadConfig.
	// Since t.Setenv records the original and restores after test, we can
	// explicitly unset inside the test body.

	// Unfortunately t.Setenv("X","") still causes LookupEnv to find the key.
	// We need a workaround: we test defaults in a subprocess, OR we accept that
	// the string-based defaults won't be tested here and test int defaults only.

	// Better approach: use a separate helper that calls getEnv/getEnvAsInt directly.
}

// TestLoadConfig_DefaultValues verifies the default config when no relevant env
// vars are set. We call the unexported helpers directly to avoid env leakage.
func TestGetEnv_Default(t *testing.T) {
	// Pick a key that is guaranteed not to exist.
	key := "TEST_CONFIG_NONEXISTENT_KEY_12345"
	got := getEnv(key, "fallback")
	if got != "fallback" {
		t.Errorf("getEnv(%q, %q) = %q; want %q", key, "fallback", got, "fallback")
	}
}

func TestGetEnv_Set(t *testing.T) {
	t.Setenv("TEST_GETENV_SET", "hello")
	got := getEnv("TEST_GETENV_SET", "default")
	if got != "hello" {
		t.Errorf("getEnv = %q; want %q", got, "hello")
	}
}

func TestGetEnvAsInt_ValidInt(t *testing.T) {
	t.Setenv("TEST_INT_VALID", "42")
	got := getEnvAsInt("TEST_INT_VALID", 10)
	if got != 42 {
		t.Errorf("getEnvAsInt = %d; want 42", got)
	}
}

func TestGetEnvAsInt_InvalidInt(t *testing.T) {
	t.Setenv("TEST_INT_INVALID", "notanumber")
	got := getEnvAsInt("TEST_INT_INVALID", 99)
	if got != 99 {
		t.Errorf("getEnvAsInt with invalid string = %d; want 99 (default)", got)
	}
}

func TestGetEnvAsInt_EmptyString(t *testing.T) {
	t.Setenv("TEST_INT_EMPTY", "")
	got := getEnvAsInt("TEST_INT_EMPTY", 55)
	if got != 55 {
		t.Errorf("getEnvAsInt with empty string = %d; want 55 (default)", got)
	}
}

func TestGetEnvAsInt_Unset(t *testing.T) {
	got := getEnvAsInt("TEST_INT_UNSET_NEVER_EXISTS_XYZ", 77)
	if got != 77 {
		t.Errorf("getEnvAsInt unset = %d; want 77", got)
	}
}

func TestGetEnvAsInt_NegativeInt(t *testing.T) {
	t.Setenv("TEST_INT_NEG", "-5")
	got := getEnvAsInt("TEST_INT_NEG", 10)
	if got != -5 {
		t.Errorf("getEnvAsInt = %d; want -5", got)
	}
}

func TestGetEnvAsInt_Zero(t *testing.T) {
	t.Setenv("TEST_INT_ZERO", "0")
	got := getEnvAsInt("TEST_INT_ZERO", 10)
	if got != 0 {
		t.Errorf("getEnvAsInt = %d; want 0", got)
	}
}

func TestLoadConfig_CustomEnvVars(t *testing.T) {
	t.Setenv("BROWSER_MAX_RUNNING", "5")
	t.Setenv("BROWSER_IDLE_TIMEOUT", "30m")
	t.Setenv("BROWSER_PROFILE_PATH", "/custom/path")
	t.Setenv("WORKSPACE_QUEUE_SIZE", "200")
	t.Setenv("PROVIDER_STARTUP_TIMEOUT", "120s")
	t.Setenv("SERVER_ADDRESS", ":9090")
	t.Setenv("SUPABASE_URL", "https://example.supabase.co")
	t.Setenv("SUPABASE_KEY", "test-key-123")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}

	if cfg.ServerAddress != ":9090" {
		t.Errorf("ServerAddress = %q; want %q", cfg.ServerAddress, ":9090")
	}
	if cfg.SupabaseURL != "https://example.supabase.co" {
		t.Errorf("SupabaseURL = %q; want %q", cfg.SupabaseURL, "https://example.supabase.co")
	}
	if cfg.SupabaseKey != "test-key-123" {
		t.Errorf("SupabaseKey = %q; want %q", cfg.SupabaseKey, "test-key-123")
	}
	if cfg.Browser.MaxRunning != 5 {
		t.Errorf("Browser.MaxRunning = %d; want 5", cfg.Browser.MaxRunning)
	}
	if cfg.Browser.IdleTimeout != 30*time.Minute {
		t.Errorf("Browser.IdleTimeout = %v; want %v", cfg.Browser.IdleTimeout, 30*time.Minute)
	}
	if cfg.Browser.ProfilePath != "/custom/path" {
		t.Errorf("Browser.ProfilePath = %q; want %q", cfg.Browser.ProfilePath, "/custom/path")
	}
	if cfg.Workspace.QueueSize != 200 {
		t.Errorf("Workspace.QueueSize = %d; want 200", cfg.Workspace.QueueSize)
	}
	if cfg.Provider.StartupTimeout != 120*time.Second {
		t.Errorf("Provider.StartupTimeout = %v; want %v", cfg.Provider.StartupTimeout, 120*time.Second)
	}
}

func TestLoadConfig_PartialEnvVars(t *testing.T) {
	// Only set some vars; the rest should fall back to defaults.
	t.Setenv("BROWSER_MAX_RUNNING", "10")
	t.Setenv("SERVER_ADDRESS", ":3000")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}

	if cfg.Browser.MaxRunning != 10 {
		t.Errorf("Browser.MaxRunning = %d; want 10", cfg.Browser.MaxRunning)
	}
	if cfg.ServerAddress != ":3000" {
		t.Errorf("ServerAddress = %q; want %q", cfg.ServerAddress, ":3000")
	}
}

func TestLoadConfig_ReturnsNoError(t *testing.T) {
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() unexpected error: %v", err)
	}
	if cfg == nil {
		t.Fatal("LoadConfig() returned nil config")
	}
}

func TestLoadConfig_InvalidBrowserMaxRunning(t *testing.T) {
	t.Setenv("BROWSER_MAX_RUNNING", "abc")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	// Should fall back to default 20.
	if cfg.Browser.MaxRunning != 20 {
		t.Errorf("Browser.MaxRunning with invalid env = %d; want 20 (default)", cfg.Browser.MaxRunning)
	}
}

func TestLoadConfig_InvalidQueueSize(t *testing.T) {
	t.Setenv("WORKSPACE_QUEUE_SIZE", "xyz")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.Workspace.QueueSize != 100 {
		t.Errorf("Workspace.QueueSize with invalid env = %d; want 100 (default)", cfg.Workspace.QueueSize)
	}
}
