package database

import (
	"encoding/json"
	"time"
)

// User represents a registered user.
type User struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

// APIKey represents a hashed API key record.
type APIKey struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	KeyHash     string     `json:"key_hash"`
	WorkspaceID string     `json:"workspace_id"`
	Permissions string     `json:"permissions"`
	LastUsed    time.Time  `json:"last_used"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"created_at"`
}

// Workspace represents an isolated AI workspace.
type Workspace struct {
	ID                 string    `json:"id"`
	UserID             string    `json:"user_id"`
	Provider           string    `json:"provider"`
	BrowserProfilePath string    `json:"browser_profile_path"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
	LastUsed           time.Time `json:"last_used"`
}

// Project represents a conversation project within a workspace.
type Project struct {
	ID               string          `json:"id"`
	WorkspaceID      string          `json:"workspace_id"`
	Name             string          `json:"name"`
	ProviderMetadata json.RawMessage `json:"provider_metadata,omitempty"`
	ConversationID   string          `json:"conversation_id,omitempty"`
	ConversationURL  string          `json:"conversation_url,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}
