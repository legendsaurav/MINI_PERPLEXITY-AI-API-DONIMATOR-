package ports

import (
	"context"
	"github.com/your-repo/ai-gateway-backend/internal/core/domain"
)

type ChatService interface {
	StreamCompletions(ctx context.Context, req *ChatRequest) (<-chan *ChatResponseChunk, <-chan error)
	Completions(ctx context.Context, req *ChatRequest) (*ChatResponse, error)
}

type ChatRequest struct {
	ConversationID string           `json:"conversation_id"`
	UserID         string           `json:"user_id"`
	Model          string           `json:"model"`
	Messages       []domain.Message `json:"messages"`
	Stream         bool             `json:"stream"`
}

type ChatResponse struct {
	ID      string           `json:"id"`
	Content string           `json:"content"`
	Model   string           `json:"model"`
	Usage   Usage            `json:"usage"`
}

type ChatResponseChunk struct {
	Content string `json:"content"`
	Done    bool   `json:"done"`
}

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}
