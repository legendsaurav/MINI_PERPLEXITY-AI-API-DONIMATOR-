package context

import (
	"context"
	"github.com/your-repo/ai-gateway-backend/internal/core/domain"
	"github.com/your-repo/ai-gateway-backend/internal/core/ports"
)

type ContextEngine struct {
	msgRepo ports.MessageRepository
	memRepo ports.MemoryRepository
}

func NewContextEngine(msgRepo ports.MessageRepository, memRepo ports.MemoryRepository) *ContextEngine {
	return &ContextEngine{
		msgRepo: msgRepo,
		memRepo: memRepo,
	}
}

func (e *ContextEngine) ReconstructHistory(ctx context.Context, convID string) ([]domain.Message, error) {
	msgs, err := e.msgRepo.GetByConversationID(ctx, convID)
	if err != nil {
		return nil, err
	}

	result := make([]domain.Message, len(msgs))
	for i, m := range msgs {
		result[i] = *m
	}
	return result, nil
}

// TODO: Implement summarization and vector memory injection
func (e *ContextEngine) BuildPrompt(ctx context.Context, convID string, currentMsg domain.Message) ([]domain.Message, error) {
	history, err := e.ReconstructHistory(ctx, convID)
	if err != nil {
		return nil, err
	}

	// For now, just append current message to history
	return append(history, currentMsg), nil
}
