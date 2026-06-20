package providers

import (
	"fmt"
	"sync"

	"github.com/antigravity/go-ai-backend/internal/engine"
)

// ProviderFactory creates a new Provider instance given a BrowserEngine.
type ProviderFactory func(e engine.BrowserEngine) Provider

// Registry is a thread-safe provider registry.
type Registry struct {
	mu        sync.RWMutex
	factories map[string]ProviderFactory
}

// NewRegistry creates a new provider registry with built-in providers pre-registered.
func NewRegistry() *Registry {
	r := &Registry{
		factories: make(map[string]ProviderFactory),
	}
	// Register built-in providers
	r.Register("chatgpt", func(e engine.BrowserEngine) Provider {
		return NewChatGPTProvider(e)
	})
	return r
}

// Register adds a provider factory to the registry.
func (r *Registry) Register(name string, factory ProviderFactory) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.factories[name] = factory
}

// Create instantiates a new provider by name.
func (r *Registry) Create(name string, e engine.BrowserEngine) (Provider, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	factory, exists := r.factories[name]
	if !exists {
		return nil, fmt.Errorf("unknown provider: %s", name)
	}
	return factory(e), nil
}

// List returns all registered provider names.
func (r *Registry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.factories))
	for name := range r.factories {
		names = append(names, name)
	}
	return names
}

// Has checks if a provider is registered.
func (r *Registry) Has(name string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, exists := r.factories[name]
	return exists
}
