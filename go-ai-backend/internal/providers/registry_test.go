package providers

import (
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/antigravity/go-ai-backend/internal/engine"
)

func TestNewRegistry_HasChatGPT(t *testing.T) {
	r := NewRegistry()
	if !r.Has("chatgpt") {
		t.Fatal("expected NewRegistry to have 'chatgpt' registered")
	}
}

func TestRegistry_Register(t *testing.T) {
	r := NewRegistry()
	r.Register("gemini", func(e engine.BrowserEngine) Provider {
		return NewChatGPTProvider(e) // reuse for simplicity
	})
	if !r.Has("gemini") {
		t.Fatal("expected 'gemini' to be registered after Register")
	}
}

func TestRegistry_Create_Known(t *testing.T) {
	r := NewRegistry()
	mock := &MockBrowserEngine{}
	p, err := r.Create("chatgpt", mock)
	if err != nil {
		t.Fatalf("Create returned unexpected error: %v", err)
	}
	if p == nil {
		t.Fatal("expected non-nil provider")
	}
	// Verify the returned provider satisfies the Provider interface
	caps := p.Capabilities()
	if !caps.Streaming {
		t.Error("expected ChatGPT provider to report Streaming=true")
	}
}

func TestRegistry_Create_Unknown(t *testing.T) {
	r := NewRegistry()
	mock := &MockBrowserEngine{}
	p, err := r.Create("nonexistent", mock)
	if err == nil {
		t.Fatal("expected error for unknown provider")
	}
	if p != nil {
		t.Fatal("expected nil provider for unknown name")
	}
	if !strings.Contains(err.Error(), "unknown provider") {
		t.Fatalf("expected 'unknown provider' in error, got: %v", err)
	}
}

func TestRegistry_List(t *testing.T) {
	r := NewRegistry()
	r.Register("gemini", func(e engine.BrowserEngine) Provider {
		return NewChatGPTProvider(e)
	})
	r.Register("claude", func(e engine.BrowserEngine) Provider {
		return NewChatGPTProvider(e)
	})

	names := r.List()
	sort.Strings(names)

	expected := []string{"chatgpt", "claude", "gemini"}
	if len(names) != len(expected) {
		t.Fatalf("expected %d providers, got %d: %v", len(expected), len(names), names)
	}
	for i, name := range expected {
		if names[i] != name {
			t.Errorf("expected names[%d]=%q, got %q", i, name, names[i])
		}
	}
}

func TestRegistry_Has(t *testing.T) {
	r := NewRegistry()

	if !r.Has("chatgpt") {
		t.Error("expected Has('chatgpt') = true")
	}
	if r.Has("nonexistent") {
		t.Error("expected Has('nonexistent') = false")
	}
}

func TestRegistry_ConcurrentAccess(t *testing.T) {
	r := NewRegistry()
	mock := &MockBrowserEngine{}

	const goroutines = 50
	var wg sync.WaitGroup
	wg.Add(goroutines * 2)

	// Half the goroutines register new providers
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			name := strings.Repeat("p", idx+1) // unique names: "p", "pp", "ppp", ...
			r.Register(name, func(e engine.BrowserEngine) Provider {
				return NewChatGPTProvider(e)
			})
		}(i)
	}

	// Half the goroutines try to create the built-in chatgpt provider
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			p, err := r.Create("chatgpt", mock)
			if err != nil {
				t.Errorf("concurrent Create returned error: %v", err)
				return
			}
			if p == nil {
				t.Error("concurrent Create returned nil provider")
			}
		}()
	}

	wg.Wait()

	// Verify all registrations went through
	for i := 0; i < goroutines; i++ {
		name := strings.Repeat("p", i+1)
		if !r.Has(name) {
			t.Errorf("expected provider %q to be registered after concurrent access", name)
		}
	}
}
