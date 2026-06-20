package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/proka/ai-backend/internal/database"
)

type contextKey string

const (
	ctxUserID      contextKey = "user_id"
	ctxWorkspaceID contextKey = "workspace_id"
)

// HashAPIKey produces a SHA-256 hex hash of the given API key.
func HashAPIKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

// GenerateAPIKey creates a new API key with the given prefix.
func GenerateAPIKey(prefix string) string {
	id := uuid.New().String()
	clean := strings.ReplaceAll(id, "-", "")
	return prefix + clean
}

// Middleware returns HTTP middleware that validates the Bearer token,
// looks it up in the database, and injects user_id and workspace_id
// into the request context.
func Middleware(db *database.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if db == nil {
				http.Error(w, `{"error":"Database not connected. Auth unavailable."}`, http.StatusServiceUnavailable)
				return
			}

			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"error":"Missing Authorization header"}`, http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				http.Error(w, `{"error":"Invalid Authorization format. Use: Bearer <API_KEY>"}`, http.StatusUnauthorized)
				return
			}

			rawKey := strings.TrimSpace(parts[1])
			if rawKey == "" {
				http.Error(w, `{"error":"Empty API key"}`, http.StatusUnauthorized)
				return
			}

			keyHash := HashAPIKey(rawKey)

			var apiKey database.APIKey
			err := db.QueryRowContext(r.Context(),
				`SELECT id, user_id, key_hash, workspace_id, permissions, status
				 FROM api_keys WHERE key_hash = $1`, keyHash,
			).Scan(
				&apiKey.ID, &apiKey.UserID, &apiKey.KeyHash,
				&apiKey.WorkspaceID, &apiKey.Permissions, &apiKey.Status,
			)

			if err != nil {
				slog.Warn("API key lookup failed", "error", err)
				http.Error(w, `{"error":"Invalid API key"}`, http.StatusUnauthorized)
				return
			}

			if apiKey.Status != "active" {
				http.Error(w, `{"error":"API key is inactive"}`, http.StatusForbidden)
				return
			}

			// Update last_used timestamp (fire-and-forget)
			go func() {
				_, _ = db.Exec(`UPDATE api_keys SET last_used = NOW() WHERE id = $1`, apiKey.ID)
			}()

			// Inject into context
			ctx := context.WithValue(r.Context(), ctxUserID, apiKey.UserID)
			ctx = context.WithValue(ctx, ctxWorkspaceID, apiKey.WorkspaceID)

			slog.Debug("Authenticated request",
				"user_id", apiKey.UserID,
				"workspace_id", apiKey.WorkspaceID,
			)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserIDFromContext extracts the user_id from the request context.
func UserIDFromContext(ctx context.Context) (string, error) {
	v, ok := ctx.Value(ctxUserID).(string)
	if !ok || v == "" {
		return "", fmt.Errorf("user_id not found in context")
	}
	return v, nil
}

// WorkspaceIDFromContext extracts the workspace_id from the request context.
func WorkspaceIDFromContext(ctx context.Context) (string, error) {
	v, ok := ctx.Value(ctxWorkspaceID).(string)
	if !ok || v == "" {
		return "", fmt.Errorf("workspace_id not found in context")
	}
	return v, nil
}
