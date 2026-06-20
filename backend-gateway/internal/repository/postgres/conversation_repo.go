package postgres

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/your-repo/ai-gateway-backend/internal/core/domain"
)

type ConversationRepository struct {
	pool *pgxpool.Pool
}

func NewConversationRepository(pool *pgxpool.Pool) *ConversationRepository {
	return &ConversationRepository{pool: pool}
}

func (r *ConversationRepository) GetByID(ctx context.Context, id string) (*domain.Conversation, error) {
	var conv domain.Conversation
	err := r.pool.QueryRow(ctx, 
		"SELECT id, owner_id, title, created_at, updated_at, metadata FROM conversations WHERE id = $1", 
		id).Scan(&conv.ID, &conv.OwnerID, &conv.Title, &conv.CreatedAt, &conv.UpdatedAt, &conv.Metadata)
	if err != nil {
		return nil, err
	}
	return &conv, nil
}

func (r *ConversationRepository) Create(ctx context.Context, conv *domain.Conversation) error {
	_, err := r.pool.Exec(ctx, 
		"INSERT INTO conversations (id, owner_id, title, created_at, updated_at, metadata) VALUES ($1, $2, $3, $4, $5, $6)",
		conv.ID, conv.OwnerID, conv.Title, conv.CreatedAt, conv.UpdatedAt, conv.Metadata)
	return err
}

func (r *ConversationRepository) Update(ctx context.Context, conv *domain.Conversation) error {
	_, err := r.pool.Exec(ctx, 
		"UPDATE conversations SET title = $1, updated_at = $2, metadata = $3 WHERE id = $4",
		conv.Title, conv.UpdatedAt, conv.Metadata, conv.ID)
	return err
}

func (r *ConversationRepository) ListByOwner(ctx context.Context, ownerID string) ([]*domain.Conversation, error) {
	rows, err := r.pool.Query(ctx, 
		"SELECT id, owner_id, title, created_at, updated_at, metadata FROM conversations WHERE owner_id = $1", 
		ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var convs []*domain.Conversation
	for rows.Next() {
		var conv domain.Conversation
		if err := rows.Scan(&conv.ID, &conv.OwnerID, &conv.Title, &conv.CreatedAt, &conv.UpdatedAt, &conv.Metadata); err != nil {
			return nil, err
		}
		convs = append(convs, &conv)
	}
	return convs, nil
}
