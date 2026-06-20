package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/antigravity/go-ai-backend/internal/config"
	"github.com/antigravity/go-ai-backend/internal/db"
)

// setupTestRouter creates a router backed by a real (but unreachable) db.Client,
// which means every auth-protected call will fail key resolution → 401.
func setupTestRouter(t *testing.T) *http.ServeMux {
	t.Helper()
	cfg, err := config.LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	dbClient := db.NewClient(cfg)
	return SetupRouter(cfg, dbClient)
}

// ---------- Health endpoint (public) ----------

func TestHealthReturns200(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestHealthReturnsCorrectJSON(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	var body map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}

	if body["status"] != "healthy" {
		t.Errorf("expected status=healthy, got %v", body["status"])
	}

	providers, ok := body["providers"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected providers to be a map, got %T", body["providers"])
	}
	if providers["chatgpt"] != "ok" {
		t.Errorf("expected providers.chatgpt=ok, got %v", providers["chatgpt"])
	}

	if _, exists := body["running_browsers"]; !exists {
		t.Error("expected running_browsers field in health response")
	}
	if _, exists := body["queued_requests"]; !exists {
		t.Error("expected queued_requests field in health response")
	}
	if _, exists := body["idle_workspaces"]; !exists {
		t.Error("expected idle_workspaces field in health response")
	}
}

func TestHealthReturnsApplicationJSON(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Errorf("expected Content-Type application/json, got %s", ct)
	}
}

// ---------- POST /v1/chat (auth protected) ----------

func TestChatWithoutAuth(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestChatWithInvalidBearerToken(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat", nil)
	req.Header.Set("Authorization", "Bearer totally-invalid-key")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// ---------- POST /v1/project/create (auth protected) ----------

func TestCreateProjectWithoutAuth(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/v1/project/create", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// ---------- GET /v1/providers (auth protected) ----------

func TestProvidersWithoutAuth(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/v1/providers", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// ---------- GET /v1/workspace (auth protected) ----------

func TestWorkspaceWithoutAuth(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/v1/workspace", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// ---------- Invalid auth format ----------

func TestInvalidAuthFormat_NoBearer(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat", nil)
	req.Header.Set("Authorization", "Basic some-creds")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestInvalidAuthFormat_TokenOnly(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat", nil)
	req.Header.Set("Authorization", "some-bare-token")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestInvalidAuthFormat_EmptyBearer(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/v1/providers", nil)
	req.Header.Set("Authorization", "Bearer")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestInvalidAuthFormat_TooManyParts(t *testing.T) {
	mux := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/v1/workspace", nil)
	req.Header.Set("Authorization", "Bearer token extra")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
