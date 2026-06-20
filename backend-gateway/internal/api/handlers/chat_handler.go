package handlers

import (
	"encoding/json"
	"fmt"
	"github.com/your-repo/ai-gateway-backend/internal/core/ports"
	"net/http"
)

type ChatHandler struct {
	chatService ports.ChatService
}

func NewChatHandler(chatService ports.ChatService) *ChatHandler {
	return &ChatHandler{chatService: chatService}
}

func (h *ChatHandler) HandleChatCompletions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ports.ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Stream {
		h.handleStreaming(w, r, &req)
	} else {
		h.handleNonStreaming(w, r, &req)
	}
}

func (h *ChatHandler) handleNonStreaming(w http.ResponseWriter, r *http.Request, req *ports.ChatRequest) {
	resp, err := h.chatService.Completions(r.Context(), req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *ChatHandler) handleStreaming(w http.ResponseWriter, r *http.Request, req *ports.ChatRequest) {
	chunkChan, errChan := h.chatService.StreamCompletions(r.Context(), req)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	for {
		select {
		case chunk, ok := <-chunkChan:
			if !ok {
				return
			}
			if chunk.Done {
				fmt.Fprintf(w, "data: [DONE]\n\n")
				flusher.Flush()
				return
			}
			data, _ := json.Marshal(chunk)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case err := <-errChan:
			if err != nil {
				fmt.Fprintf(w, "event: error\ndata: %s\n\n", err.Error())
				flusher.Flush()
			}
			return
		case <-r.Context().Done():
			return
		}
	}
}
