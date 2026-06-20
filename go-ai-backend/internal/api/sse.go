package api

import (
	"fmt"
	"net/http"

	"github.com/antigravity/go-ai-backend/internal/providers"
)

// StreamResponse streams Server-Sent Events to the client.
func StreamResponse(w http.ResponseWriter, r *http.Request, chunkChan <-chan providers.StreamChunk) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// Optional CORS headers if needed
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	for {
		select {
		case chunk, open := <-chunkChan:
			if !open {
				// Channel closed
				return
			}

			if chunk.Error != nil {
				fmt.Fprintf(w, "event: error\ndata: %s\n\n", chunk.Error.Error())
				flusher.Flush()
				return
			}

			if chunk.Done {
				fmt.Fprintf(w, "data: [DONE]\n\n")
				flusher.Flush()
				return
			}

			// In a real implementation we would serialize a JSON payload similar to OpenAI
			fmt.Fprintf(w, "data: %s\n\n", chunk.Text)
			flusher.Flush()

		case <-r.Context().Done():
			// Client disconnected
			return
		}
	}
}
