package ports

import (
	"context"
	"github.com/your-repo/ai-gateway-backend/internal/core/domain"
)

type ConversationRepository interface {
	GetByID(ctx context.Context, id string) (*domain.Conversation, error)
	Create(ctx context.Context, conv *domain.Conversation) error
	Update(ctx context.Context, conv *domain.Conversation) error
	ListByOwner(ctx context.Context, ownerID string) ([]*domain.Conversation, error)
}

type MessageRepository interface {
	GetByConversationID(ctx context.Context, convID string) ([]*domain.Message, error)
	AddMessage(ctx context.Context, msg *domain.Message) error
}

type MemoryRepository interface {
	AddMemory(ctx context.Context, mem *domain.Memory) error
	Search(ctx context.Context, convID string, embedding []float32, limit int) ([]*domain.Memory, error)
}
