package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
)

// FileKeyRecord matches the keygen output format.
type FileKeyRecord struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	KeyHash     string `json:"key_hash"`
	WorkspaceID string `json:"workspace_id"`
	Provider    string `json:"provider"`
	Permissions string `json:"permissions"`
	Status      string `json:"status"`
	DeviceName  string `json:"device_name"`
}

// FileKeyStore holds all records from the JSON key file.
type FileKeyStore struct {
	Keys []FileKeyRecord `json:"keys"`
}

// FileAuthProvider validates API keys from a JSON file on disk.
// This is the lightweight alternative to PostgreSQL for single-machine setups.
type FileAuthProvider struct {
	mu       sync.RWMutex
	filePath string
	keys     map[string]*FileKeyRecord // keyHash -> record
}

// NewFileAuthProvider creates a new file-based auth provider.
func NewFileAuthProvider(filePath string) (*FileAuthProvider, error) {
	p := &FileAuthProvider{
		filePath: filePath,
		keys:     make(map[string]*FileKeyRecord),
	}

	if err := p.Reload(); err != nil {
		return nil, err
	}

	return p, nil
}

// Reload reads the key store file from disk.
func (p *FileAuthProvider) Reload() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	data, err := os.ReadFile(p.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			slog.Warn("[FileAuth] Key store file not found — no API keys loaded", "path", p.filePath)
			return nil
		}
		return fmt.Errorf("failed to read key store: %w", err)
	}

	var store FileKeyStore
	if err := json.Unmarshal(data, &store); err != nil {
		return fmt.Errorf("failed to parse key store: %w", err)
	}

	p.keys = make(map[string]*FileKeyRecord, len(store.Keys))
	for i := range store.Keys {
		rec := &store.Keys[i]
		if rec.Status == "active" {
			p.keys[rec.KeyHash] = rec
		}
	}

	slog.Info("[FileAuth] API keys loaded", "active_keys", len(p.keys), "path", p.filePath)
	return nil
}

// GetRecordByWorkspaceID finds a key record by its workspace ID.
func (p *FileAuthProvider) GetRecordByWorkspaceID(workspaceID string) (*FileKeyRecord, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for _, rec := range p.keys {
		if rec.WorkspaceID == workspaceID {
			return rec, true
		}
	}
	return nil, false
}

// FileMiddleware returns HTTP middleware that validates Bearer tokens
// against the file-based key store.
func FileMiddleware(provider *FileAuthProvider) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

			hash := sha256.Sum256([]byte(rawKey))
			keyHash := hex.EncodeToString(hash[:])

			provider.mu.RLock()
			record, ok := provider.keys[keyHash]
			provider.mu.RUnlock()

			if !ok {
				slog.Warn("[FileAuth] Invalid API key attempt")
				http.Error(w, `{"error":"Invalid API key"}`, http.StatusUnauthorized)
				return
			}

			// Inject into context
			ctx := context.WithValue(r.Context(), ctxUserID, record.UserID)
			ctx = context.WithValue(ctx, ctxWorkspaceID, record.WorkspaceID)

			slog.Debug("[FileAuth] Authenticated",
				"user", record.Username,
				"device", record.DeviceName,
				"workspace", record.WorkspaceID,
			)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
