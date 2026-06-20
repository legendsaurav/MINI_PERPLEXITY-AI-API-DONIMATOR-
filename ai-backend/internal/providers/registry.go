package providers

import (
	"fmt"
	"sync"

	"github.com/proka/ai-backend/internal/engine"
)

// ProviderFactory creates a new Provider instance given a BrowserEngine.
type ProviderFactory func(eng engine.BrowserEngine) Provider

// Registry is a thread-safe provider registry.
type Registry struct {
	mu        sync.RWMutex
	factories map[string]ProviderFactory
}

// NewRegistry creates a new provider registry with built-in providers.
func NewRegistry() *Registry {
	r := &Registry{
		factories: make(map[string]ProviderFactory),
	}
	return r
}

// Register adds a provider factory to the registry.
func (r *Registry) Register(name string, factory ProviderFactory) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.factories[name] = factory
}

// Create instantiates a provider by name with the given engine.
func (r *Registry) Create(name string, eng engine.BrowserEngine) (Provider, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	factory, ok := r.factories[name]
	if !ok {
		return nil, fmt.Errorf("unknown provider: %s", name)
	}
	return factory(eng), nil
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
