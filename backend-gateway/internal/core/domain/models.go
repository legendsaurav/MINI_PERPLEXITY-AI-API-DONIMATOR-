package domain

import (
	"time"
)

type Conversation struct {
	ID        string    `json:"id"`
	OwnerID   string    `json:"owner_id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Metadata  map[string]interface{} `json:"metadata"`
}

type Message struct {
	ID             string    `json:"id,omitempty"`
	ConversationID string    `json:"conversation_id"`
	Role           string    `json:"role"`
	Content        string    `json:"content"`
	DeviceID       string    `json:"device_id,omitempty"`
	UserID         string    `json:"user_id"`
	Model          string    `json:"model"`
	CreatedAt      time.Time `json:"created_at"`
}

type Memory struct {
	ID             string    `json:"id,omitempty"`
	ConversationID string    `json:"conversation_id"`
	Content        string    `json:"content"`
	Embedding      []float32 `json:"embedding"`
	CreatedAt      time.Time `json:"created_at"`
}
