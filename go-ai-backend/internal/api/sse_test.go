package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/antigravity/go-ai-backend/internal/providers"
)

func TestStreamResponse_TextChunks(t *testing.T) {
	ch := make(chan providers.StreamChunk, 3)
	ch <- providers.StreamChunk{Text: "Hello"}
	ch <- providers.StreamChunk{Text: " World"}
	ch <- providers.StreamChunk{Done: true}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	StreamResponse(rec, req, ch)

	body := rec.Body.String()
	if !strings.Contains(body, "data: Hello\n\n") {
		t.Errorf("expected 'data: Hello' SSE line, got:\n%s", body)
	}
	if !strings.Contains(body, "data:  World\n\n") {
		t.Errorf("expected 'data:  World' SSE line, got:\n%s", body)
	}
	if !strings.Contains(body, "data: [DONE]\n\n") {
		t.Errorf("expected 'data: [DONE]' SSE line, got:\n%s", body)
	}
}

func TestStreamResponse_DoneChunk(t *testing.T) {
	ch := make(chan providers.StreamChunk, 1)
	ch <- providers.StreamChunk{Done: true}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	StreamResponse(rec, req, ch)

	body := rec.Body.String()
	if !strings.Contains(body, "data: [DONE]\n\n") {
		t.Errorf("expected DONE event, got:\n%s", body)
	}
}

func TestStreamResponse_ErrorChunk(t *testing.T) {
	ch := make(chan providers.StreamChunk, 1)
	ch <- providers.StreamChunk{Error: errors.New("something broke")}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	StreamResponse(rec, req, ch)

	body := rec.Body.String()
	if !strings.Contains(body, "event: error") {
		t.Errorf("expected error event, got:\n%s", body)
	}
	if !strings.Contains(body, "something broke") {
		t.Errorf("expected error message in body, got:\n%s", body)
	}
}

func TestStreamResponse_ChannelClose(t *testing.T) {
	ch := make(chan providers.StreamChunk)
	close(ch) // Immediately closed

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	StreamResponse(rec, req, ch)

	body := rec.Body.String()
	// On channel close with no data, body should be empty (no panic)
	if strings.Contains(body, "data:") {
		t.Errorf("expected no data events on closed channel, got:\n%s", body)
	}
}

func TestStreamResponse_SetsSSEHeaders(t *testing.T) {
	ch := make(chan providers.StreamChunk, 1)
	ch <- providers.StreamChunk{Done: true}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	StreamResponse(rec, req, ch)

	ct := rec.Header().Get("Content-Type")
	if ct != "text/event-stream" {
		t.Errorf("expected Content-Type text/event-stream, got %s", ct)
	}

	cc := rec.Header().Get("Cache-Control")
	if cc != "no-cache" {
		t.Errorf("expected Cache-Control no-cache, got %s", cc)
	}

	conn := rec.Header().Get("Connection")
	if conn != "keep-alive" {
		t.Errorf("expected Connection keep-alive, got %s", conn)
	}
}

func TestStreamResponse_ClientDisconnect(t *testing.T) {
	// Create a channel that will never send anything
	ch := make(chan providers.StreamChunk)

	rec := httptest.NewRecorder()
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)

	done := make(chan struct{})
	go func() {
		StreamResponse(rec, req, ch)
		close(done)
	}()

	// Simulate client disconnect
	cancel()
	<-done // Should return promptly without blocking forever
}
