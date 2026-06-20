package providers

import (
	"testing"

	"github.com/antigravity/go-ai-backend/internal/engine"
)

// MockBrowserEngine satisfies engine.BrowserEngine with no-op implementations.
type MockBrowserEngine struct {
	ShutdownCalled bool
}

var _ engine.BrowserEngine = (*MockBrowserEngine)(nil)

func (m *MockBrowserEngine) Launch() error                         { return nil }
func (m *MockBrowserEngine) Shutdown() error                       { m.ShutdownCalled = true; return nil }
func (m *MockBrowserEngine) RestoreProfile(path string) error      { return nil }
func (m *MockBrowserEngine) Navigate(url string) error             { return nil }
func (m *MockBrowserEngine) Click(selector string) error           { return nil }
func (m *MockBrowserEngine) Type(selector, text string) error      { return nil }
func (m *MockBrowserEngine) WaitFor(selector string) error         { return nil }
func (m *MockBrowserEngine) EvaluateJS(script string) (string, error) { return "", nil }
func (m *MockBrowserEngine) Screenshot() ([]byte, error)           { return nil, nil }
func (m *MockBrowserEngine) Upload(selector, filePath string) error { return nil }
func (m *MockBrowserEngine) StreamDOM() (<-chan string, error) {
	ch := make(chan string)
	close(ch)
	return ch, nil
}

// ---------- Tests ----------

func TestNewChatGPTProvider(t *testing.T) {
	mock := &MockBrowserEngine{}
	p := NewChatGPTProvider(mock)
	if p == nil {
		t.Fatal("expected non-nil provider")
	}
	if p.engine == nil {
		t.Fatal("expected engine to be set")
	}
}

func TestChatGPTProvider_Initialize(t *testing.T) {
	p := NewChatGPTProvider(&MockBrowserEngine{})
	if err := p.Initialize(); err != nil {
		t.Fatalf("Initialize returned error: %v", err)
	}
}

func TestChatGPTProvider_CheckSession(t *testing.T) {
	p := NewChatGPTProvider(&MockBrowserEngine{})
	ok, err := p.CheckSession()
	if err != nil {
		t.Fatalf("CheckSession returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected CheckSession to return true")
	}
}

func TestChatGPTProvider_SendMessage_EmptyText(t *testing.T) {
	p := NewChatGPTProvider(&MockBrowserEngine{})
	err := p.SendMessage(MessageRequest{Text: ""})
	if err == nil {
		t.Fatal("expected error for empty prompt")
	}
	if err.Error() != "empty prompt" {
		t.Fatalf("expected 'empty prompt' error, got: %v", err)
	}
}

func TestChatGPTProvider_SendMessage_ValidText(t *testing.T) {
	p := NewChatGPTProvider(&MockBrowserEngine{})
	err := p.SendMessage(MessageRequest{Text: "hello"})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestChatGPTProvider_StreamResponse(t *testing.T) {
	p := NewChatGPTProvider(&MockBrowserEngine{})
	ch, err := p.StreamResponse()
	if err != nil {
		t.Fatalf("StreamResponse returned error: %v", err)
	}
	if ch == nil {
		t.Fatal("expected non-nil channel")
	}

	// Read all chunks
	var chunks []StreamChunk
	for chunk := range ch {
		chunks = append(chunks, chunk)
	}

	if len(chunks) == 0 {
		t.Fatal("expected at least one chunk")
	}
	last := chunks[len(chunks)-1]
	if !last.Done {
		t.Error("expected last chunk to have Done=true")
	}
}

func TestChatGPTProvider_Capabilities(t *testing.T) {
	p := NewChatGPTProvider(&MockBrowserEngine{})
	caps := p.Capabilities()

	if !caps.Streaming {
		t.Error("expected Streaming=true")
	}
	if !caps.Vision {
		t.Error("expected Vision=true")
	}
	if !caps.FileUpload {
		t.Error("expected FileUpload=true")
	}
	if !caps.ImageUpload {
		t.Error("expected ImageUpload=true")
	}
	if caps.AudioUpload {
		t.Error("expected AudioUpload=false")
	}
	if caps.CodeExecution {
		t.Error("expected CodeExecution=false")
	}
}

func TestChatGPTProvider_Shutdown(t *testing.T) {
	mock := &MockBrowserEngine{}
	p := NewChatGPTProvider(mock)

	err := p.Shutdown()
	if err != nil {
		t.Fatalf("Shutdown returned error: %v", err)
	}
	if !mock.ShutdownCalled {
		t.Error("expected engine.Shutdown to be called")
	}
}

func TestChatGPTProvider_Cancel(t *testing.T) {
	p := NewChatGPTProvider(&MockBrowserEngine{})
	if err := p.Cancel(); err != nil {
		t.Fatalf("Cancel returned error: %v", err)
	}
}

func TestChatGPTProvider_Health(t *testing.T) {
	p := NewChatGPTProvider(&MockBrowserEngine{})
	if err := p.Health(); err != nil {
		t.Fatalf("Health returned error: %v", err)
	}
}

func TestChatGPTProvider_OpenWorkspace(t *testing.T) {
	p := NewChatGPTProvider(&MockBrowserEngine{})
	if err := p.OpenWorkspace(nil); err != nil {
		t.Fatalf("OpenWorkspace returned error: %v", err)
	}
}
