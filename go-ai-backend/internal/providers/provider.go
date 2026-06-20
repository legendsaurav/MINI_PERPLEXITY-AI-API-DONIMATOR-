package providers

type FileAttachment struct {
	Path     string
	MimeType string
}

type ImageAttachment struct {
	Path     string
	MimeType string
}

type MessageRequest struct {
	Project  string
	Text     string
	Images   []ImageAttachment
	Files    []FileAttachment
	Metadata map[string]string
}

type ProviderCapabilities struct {
	Streaming     bool
	Vision        bool
	FileUpload    bool
	ImageUpload   bool
	AudioUpload   bool
	CodeExecution bool
}

type StreamChunk struct {
	Text  string
	Done  bool
	Error error
}

type Provider interface {
	Initialize() error
	CheckSession() (bool, error) // Validates login state
	OpenWorkspace(projectMetadata map[string]interface{}) error
	SendMessage(req MessageRequest) error
	StreamResponse() (<-chan StreamChunk, error)
	Cancel() error
	Health() error
	Shutdown() error
	Capabilities() ProviderCapabilities
}
