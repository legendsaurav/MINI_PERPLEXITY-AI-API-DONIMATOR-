package postgres

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/your-repo/ai-gateway-backend/internal/core/domain"
)

type MessageRepository struct {
	pool *pgxpool.Pool
}

func NewMessageRepository(pool *pgxpool.Pool) *MessageRepository {
	return &MessageRepository{pool: pool}
}

func (r *MessageRepository) GetByConversationID(ctx context.Context, convID string) ([]*domain.Message, error) {
	rows, err := r.pool.Query(ctx, 
		"SELECT id, conversation_id, role, content, device_id, user_id, model, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC", 
		convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []*domain.Message
	for rows.Next() {
		var msg domain.Message
		if err := rows.Scan(&msg.ID, &msg.ConversationID, &msg.Role, &msg.Content, &msg.DeviceID, &msg.UserID, &msg.Model, &msg.CreatedAt); err != nil {
			return nil, err
		}
		msgs = append(msgs, &msg)
	}
	return msgs, nil
}

func (r *MessageRepository) AddMessage(ctx context.Context, msg *domain.Message) error {
	_, err := r.pool.Exec(ctx, 
		"INSERT INTO messages (conversation_id, role, content, device_id, user_id, model, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
		msg.ConversationID, msg.Role, msg.Content, msg.DeviceID, msg.UserID, msg.Model, msg.CreatedAt)
	return err
}

func (r *MessageRepository) DeleteByID(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, "DELETE FROM messages WHERE id = $1", id)
	return err
}
