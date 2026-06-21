package providers

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/proka/ai-backend/internal/config"
	"github.com/proka/ai-backend/internal/engine"
	"github.com/proka/ai-backend/internal/scheduler"
)

// VerificationState represents the current health state of a provider.
type VerificationState string

const (
	StateUnknown      VerificationState = "unknown"
	StateStarting     VerificationState = "starting"
	StateAuthRequired VerificationState = "auth_required"
	StateVerifying    VerificationState = "verifying"
	StateReady        VerificationState = "ready"
	StateDegraded     VerificationState = "degraded"
	StateFailed       VerificationState = "failed"
	StateRecovering   VerificationState = "recovering"
)

const (
	DefaultVerificationPrompt  = "Respond with exactly READY"
	DefaultVerificationRetries = 3
)

// Verifier manages authentication and session verification for all providers.
type Verifier struct {
	mu       sync.RWMutex
	states   map[string]VerificationState
	sched    *scheduler.Scheduler
	registry *Registry
	cfg      *config.Config
}

// NewVerifier creates a new Verifier instance.
func NewVerifier(sched *scheduler.Scheduler, registry *Registry, cfg *config.Config) *Verifier {
	states := make(map[string]VerificationState)
	// Initialize all registered providers to UNKNOWN state
	for _, name := range registry.List() {
		states[name] = StateUnknown
	}
	return &Verifier{
		states:   states,
		sched:    sched,
		registry: registry,
		cfg:      cfg,
	}
}

// GetStates returns a copy of the current provider states.
func (v *Verifier) GetStates() map[string]string {
	v.mu.RLock()
	defer v.mu.RUnlock()

	res := make(map[string]string, len(v.states))
	for name, state := range v.states {
		res[name] = string(state)
	}
	return res
}

// UpdateState sets the state of a provider in a thread-safe way.
func (v *Verifier) UpdateState(providerName string, state VerificationState) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.states[providerName] = state
	slog.Info("[Verifier] Provider state transition", "provider", providerName, "state", state)
}

// StartVerification runs the verification flow for all configured providers sequentially.
func (v *Verifier) StartVerification(ctx context.Context) {
	slog.Info("[Verifier] Starting sequential provider verification flow...")
	for _, name := range v.registry.List() {
		v.verifyWithRetries(ctx, name)
	}
	slog.Info("[Verifier] Sequential provider verification flow completed.")
}

func (v *Verifier) verifyWithRetries(ctx context.Context, providerName string) {
	v.UpdateState(providerName, StateStarting)

	retries := DefaultVerificationRetries
	if pCfg, ok := v.cfg.Providers[providerName]; ok && pCfg.VerificationRetries > 0 {
		retries = pCfg.VerificationRetries
	}

	for attempt := 1; attempt <= retries; attempt++ {
		slog.Info("[Verifier] Verifying provider", "provider", providerName, "attempt", attempt, "max_retries", retries)
		err := v.VerifyProvider(ctx, providerName)
		if err == nil {
			return // Success! Already marked as READY inside VerifyProvider
		}

		// Check if the verification failed because of explicit auth required
		v.mu.RLock()
		state := v.states[providerName]
		v.mu.RUnlock()
		if state == StateAuthRequired {
			slog.Warn("[Verifier] Session check determined authentication is required, skipping further retries", "provider", providerName)
			return
		}

		slog.Error("[Verifier] Verification failed", "provider", providerName, "attempt", attempt, "error", err)
		if attempt < retries {
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
		}
	}

	// If we exhausted retries and are not in a final state, mark as FAILED
	v.mu.RLock()
	state := v.states[providerName]
	v.mu.RUnlock()
	if state != StateReady && state != StateAuthRequired {
		v.UpdateState(providerName, StateFailed)
	}
}

// VerifyProvider runs the complete verification step for a single provider.
func (v *Verifier) VerifyProvider(ctx context.Context, providerName string) error {
	v.UpdateState(providerName, StateVerifying)

	// Acquire a browser slot using a dedicated project ID to preserve real user sessions
	slot, err := v.sched.Acquire(ctx, "default", "verification", providerName)
	if err != nil {
		return fmt.Errorf("failed to acquire browser slot: %w", err)
	}
	defer v.sched.Release(slot.ID)

	// Bypass live browser interactions if using a StubEngine (local/test development)
	if _, isStub := slot.Engine.(*engine.StubEngine); isStub {
		slog.Info("[Verifier] Stub engine detected, auto-marking as READY", "provider", providerName)
		v.UpdateState(providerName, StateReady)
		return nil
	}

	// Create provider instance
	provider, err := v.registry.Create(providerName, slot.Engine)
	if err != nil {
		return fmt.Errorf("failed to create provider instance: %w", err)
	}

	// Initialize provider
	if err := provider.Initialize(ctx); err != nil {
		return fmt.Errorf("failed to initialize provider: %w", err)
	}

	// Navigate to provider (OpenWorkspace with nil projectMetadata starts a fresh, empty conversation)
	if err := provider.OpenWorkspace(ctx, nil); err != nil {
		return fmt.Errorf("failed to navigate to provider: %w", err)
	}

	// Verify session exists
	isLoggedIn, err := provider.CheckSession(ctx)
	if err != nil {
		return fmt.Errorf("failed to verify session status: %w", err)
	}

	if !isLoggedIn {
		v.UpdateState(providerName, StateAuthRequired)
		return fmt.Errorf("user is not authenticated")
	}

	// Send verification prompt
	prompt := DefaultVerificationPrompt
	if pCfg, ok := v.cfg.Providers[providerName]; ok && pCfg.VerificationPrompt != "" {
		prompt = pCfg.VerificationPrompt
	}

	req := MessageRequest{
		Text: prompt,
	}
	if err := provider.SendMessage(ctx, req); err != nil {
		return fmt.Errorf("failed to send verification message: %w", err)
	}

	// Stream and validate response content
	respCh, err := provider.StreamResponse(ctx)
	if err != nil {
		return fmt.Errorf("failed to open response stream: %w", err)
	}

	var sb strings.Builder
	for chunk := range respCh {
		if chunk.Type == "text" {
			sb.WriteString(chunk.Content)
		} else if chunk.Type == "error" {
			return fmt.Errorf("error during streaming: %s", chunk.Content)
		}
	}

	responseText := sb.String()
	slog.Info("[Verifier] Response received", "provider", providerName, "length", len(responseText))

	// Validation rule: response should contain "READY" (case-insensitive)
	expected := "ready"
	if !strings.Contains(strings.ToLower(responseText), expected) {
		return fmt.Errorf("response validation failed (expected text containing %q, got %q)", expected, responseText)
	}

	v.UpdateState(providerName, StateReady)
	return nil
}
