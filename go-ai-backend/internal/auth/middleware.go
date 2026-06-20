package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/antigravity/go-ai-backend/internal/db"
)

type contextKey string

const (
	ContextKeyUserID      contextKey = "userID"
	ContextKeyWorkspaceID contextKey = "workspaceID"
	ContextKeyProjectID   contextKey = "projectID"
)

// Middleware validates API keys via the Authorization header
func Middleware(dbClient *db.Client) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, "missing authorization header", http.StatusUnauthorized)
				return
			}

			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || parts[0] != "Bearer" {
				http.Error(w, "invalid authorization format", http.StatusUnauthorized)
				return
			}

			apiKey := parts[1]

			// Resolve the API key to a User, Workspace, and Project
			userID, workspaceID, projectID, err := resolveAPIKey(dbClient, apiKey)
			if err != nil {
				http.Error(w, "invalid api key", http.StatusUnauthorized)
				return
			}

			// Inject into context
			ctx := context.WithValue(r.Context(), ContextKeyUserID, userID)
			ctx = context.WithValue(ctx, ContextKeyWorkspaceID, workspaceID)
			ctx = context.WithValue(ctx, ContextKeyProjectID, projectID)

			next.ServeHTTP(w, r.WithContext(ctx))
		}
	}
}

// In a real system you'd hash the API key and lookup the hash in DB
func resolveAPIKey(dbClient *db.Client, key string) (string, string, string, error) {
	// Simple SHA256 hash or similar should be used here. Assuming 'key' is the hash for now.
	apiKeyRecord, err := dbClient.ResolveAPIKey(key)
	if err != nil || apiKeyRecord == nil {
		return "", "", "", errors.New("not found")
	}

	// Here we just return dummy project ID because API keys map to workspaces in our schema,
	// and clients supply the project ID in their requests. For simplicity, we just extract workspace.
	return apiKeyRecord.UserID, apiKeyRecord.WorkspaceID, "project_from_request", nil
}

