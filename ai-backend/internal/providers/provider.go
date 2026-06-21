package providers

import (
	"context"
)

// MessageRequest holds the data for a chat message.
type MessageRequest struct {
	Project  string            `json:"project"`
	Text     string            `json:"text"`
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
	Type    string `json:"type"`
	Content string `json:"content"`
}

// ProviderCapabilities describes what a provider supports.
type ProviderCapabilities struct {
	Streaming     bool `json:"supports_streaming"`
	Vision        bool `json:"supports_vision"`
	FileUpload    bool `json:"supports_files"`
	ImageUpload   bool `json:"supports_images"`
	AudioUpload   bool `json:"supports_audio"`
	CodeExecution bool `json:"supports_code_execution"`
	ZipUpload     bool `json:"supports_zip"`
}

// Provider is the interface that all AI provider implementations must satisfy.
// Providers use the BrowserEngine for all DOM interactions — they never
// manage browser lifecycle directly.
type Provider interface {
	// Name returns the provider identifier (e.g., "chatgpt", "gemini", "claude").
	Name() string

	// Initialize sets up the provider.
	Initialize(ctx context.Context) error

	// CheckSession verifies that the user is logged in.
	CheckSession(ctx context.Context) (bool, error)

	// OpenWorkspace navigates to the active conversation or starts fresh.
	OpenWorkspace(ctx context.Context, projectMetadata map[string]interface{}) error

	// UploadFiles uploads the given files to the active session.
	UploadFiles(ctx context.Context, files []FileAttachment) error

	// WaitForUploadCompletion waits for file uploads to be verified by the provider.
	WaitForUploadCompletion(ctx context.Context) error

	// WaitForAnalysisCompletion waits for background indexing/processing to finish.
	WaitForAnalysisCompletion(ctx context.Context) error

	// SendMessage types and submits a message to the AI provider.
	SendMessage(ctx context.Context, req MessageRequest) error

	// StreamResponse returns a channel that emits response chunks.
	StreamResponse(ctx context.Context) (<-chan StreamChunk, error)

	// Cancel attempts to stop the current generation.
	Cancel(ctx context.Context) error

	// Health verifies provider readiness and health.
	Health(ctx context.Context) error

	// Shutdown cleanly tears down the provider.
	Shutdown(ctx context.Context) error

	// Capabilities returns what this provider supports.
	Capabilities() ProviderCapabilities
}
