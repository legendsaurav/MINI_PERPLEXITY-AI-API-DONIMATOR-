package providers

import (
	"context"

	"github.com/proka/ai-backend/internal/engine"
)

// MessageRequest holds the data for a chat message.
type MessageRequest struct {
	Project  string            `json:"project"`
	Text     string            `json:"message"`
	Images   []ImageAttachment `json:"images,omitempty"`
	Files    []FileAttachment  `json:"files,omitempty"`
	Metadata map[string]string `json:"metadata,omitempty"`
}

// ImageAttachment represents an attached image.
type ImageAttachment struct {
	Data     []byte `json:"data"`
	MimeType string `json:"mime_type"`
	Filename string `json:"filename"`
}

// FileAttachment represents an attached file.
type FileAttachment struct {
	Data     []byte `json:"data"`
	MimeType string `json:"mime_type"`
	Filename string `json:"filename"`
}

// StreamChunk represents a single piece of a streamed response.
type StreamChunk struct {
	Data  string `json:"data"`
	Done  bool   `json:"done"`
	Error string `json:"error,omitempty"`
}

// ProviderCapabilities describes what a provider supports.
type ProviderCapabilities struct {
	SupportsStreaming bool  `json:"supports_streaming"`
	SupportsVision   bool  `json:"supports_vision"`
	SupportsFiles    bool  `json:"supports_files"`
	MaxImageSize     int64 `json:"max_image_size"`
}

// Provider is the interface that all AI provider implementations must satisfy.
// Providers use the BrowserEngine for all DOM interactions — they never
// manage browser lifecycle directly.
type Provider interface {
	// Name returns the provider identifier (e.g., "chatgpt", "gemini", "claude").
	Name() string

	// Initialize sets up the provider with a browser engine instance.
	Initialize(ctx context.Context, eng engine.BrowserEngine) error

	// CheckSession verifies that the user is logged in.
	CheckSession(ctx context.Context) (bool, error)

	// OpenConversation navigates to an existing conversation URL (or starts new).
	OpenConversation(ctx context.Context, conversationURL string) error

	// SendMessage types and submits a message to the AI provider.
	SendMessage(ctx context.Context, req MessageRequest) error

	// StreamResponse returns a channel that emits response chunks.
	StreamResponse(ctx context.Context) (<-chan StreamChunk, error)

	// Cancel attempts to stop the current generation.
	Cancel(ctx context.Context) error

	// Shutdown cleanly tears down the provider.
	Shutdown(ctx context.Context) error

	// Capabilities returns what this provider supports.
	Capabilities() ProviderCapabilities
}
