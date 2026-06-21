package streaming

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/proka/ai-backend/internal/providers"
)

// StreamToClient writes StreamChunks as Server-Sent Events (SSE) to the HTTP response.
func StreamToClient(w http.ResponseWriter, r *http.Request, ch <-chan providers.StreamChunk) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, `{"error":"Streaming not supported"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	slog.Debug("[SSE] Streaming started")

	for {
		select {
		case <-r.Context().Done():
			slog.Debug("[SSE] Client disconnected")
			return

		case chunk, ok := <-ch:
			if !ok {
				// Channel closed — send DONE
				fmt.Fprintf(w, "data: [DONE]\n\n")
				flusher.Flush()
				slog.Debug("[SSE] Stream complete (channel closed)")
				return
			}

			if chunk.Type == "error" {
				errData, _ := json.Marshal(map[string]string{"error": chunk.Content})
				fmt.Fprintf(w, "event: error\ndata: %s\n\n", errData)
				flusher.Flush()
				slog.Warn("[SSE] Stream error", "error", chunk.Content)
				return
			}

			if chunk.Type == "done" {
				fmt.Fprintf(w, "data: [DONE]\n\n")
				flusher.Flush()
				slog.Debug("[SSE] Stream complete (done flag)")
				return
			}

			data, err := json.Marshal(chunk)
			if err != nil {
				slog.Error("[SSE] Failed to marshal chunk", "error", err)
				continue
			}

			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}
