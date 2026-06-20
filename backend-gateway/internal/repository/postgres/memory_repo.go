package postgres

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/your-repo/ai-gateway-backend/internal/core/domain"
	"github.com/pgvector/pgvector-go"
)

type MemoryRepository struct {
	pool *pgxpool.Pool
}

func NewMemoryRepository(pool *pgxpool.Pool) *MemoryRepository {
	return &MemoryRepository{pool: pool}
}

func (r *MemoryRepository) AddMemory(ctx context.Context, mem *domain.Memory) error {
	_, err := r.pool.Exec(ctx, 
		"INSERT INTO memories (conversation_id, content, embedding) VALUES ($1, $2, $3)",
		mem.ConversationID, mem.Content, pgvector.NewVector(mem.Embedding))
	return err
}

func (r *MemoryRepository) Search(ctx context.Context, convID string, embedding []float32, limit int) ([]*domain.Memory, error) {
	rows, err := r.pool.Query(ctx, 
		"SELECT id, conversation_id, content, created_at FROM memories WHERE conversation_id = $1 ORDER BY embedding <=> $2 LIMIT $3", 
		convID, pgvector.NewVector(embedding), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var mems []*domain.Memory
	for rows.Next() {
		var mem domain.Memory
		if err := rows.Scan(&mem.ID, &mem.ConversationID, &mem.Content, &mem.CreatedAt); err != nil {
			return nil, err
		}
		mems = append(mems, &mem)
	}
	return mems, nil
}
