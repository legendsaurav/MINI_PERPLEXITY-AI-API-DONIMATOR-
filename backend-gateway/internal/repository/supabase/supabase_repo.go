package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/your-repo/ai-gateway-backend/internal/core/domain"
)

type SupabaseClient struct {
	url        string
	key        string
	httpClient *http.Client
}

func NewSupabaseClient(url, key string) *SupabaseClient {
	return &SupabaseClient{
		url:        url,
		key:        key,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *SupabaseClient) request(ctx context.Context, method, path string, body interface{}, target interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.url+"/rest/v1/"+path, bodyReader)
	if err != nil {
		return err
	}

	req.Header.Set("apikey", c.key)
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Content-Type", "application/json")
	if method == http.MethodPost || method == http.MethodPatch {
		req.Header.Set("Prefer", "return=representation")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("supabase api error (%d): %s", resp.StatusCode, string(respBody))
	}

	if target != nil {
		return json.NewDecoder(resp.Body).Decode(target)
	}
	return nil
}

// Conversation Repository
type ConversationRepository struct {
	client *SupabaseClient
}

func NewConversationRepository(client *SupabaseClient) *ConversationRepository {
	return &ConversationRepository{client: client}
}

func (r *ConversationRepository) GetByID(ctx context.Context, id string) (*domain.Conversation, error) {
	var results []domain.Conversation
	path := fmt.Sprintf("conversations?id=eq.%s&select=*", id)
	err := r.client.request(ctx, http.MethodGet, path, nil, &results)
	if err != nil {
		return nil, err
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("conversation not found")
	}
	return &results[0], nil
}

func (r *ConversationRepository) Create(ctx context.Context, conv *domain.Conversation) error {
	var results []domain.Conversation
	err := r.client.request(ctx, http.MethodPost, "conversations", conv, &results)
	if err != nil {
		return err
	}
	if len(results) > 0 {
		*conv = results[0]
	}
	return nil
}

func (r *ConversationRepository) Update(ctx context.Context, conv *domain.Conversation) error {
	path := fmt.Sprintf("conversations?id=eq.%s", conv.ID)
	updateData := map[string]interface{}{
		"title":      conv.Title,
		"updated_at": conv.UpdatedAt,
		"metadata":   conv.Metadata,
	}
	return r.client.request(ctx, http.MethodPatch, path, updateData, nil)
}

func (r *ConversationRepository) ListByOwner(ctx context.Context, ownerID string) ([]*domain.Conversation, error) {
	var results []*domain.Conversation
	path := fmt.Sprintf("conversations?owner_id=eq.%s&select=*", ownerID)
	err := r.client.request(ctx, http.MethodGet, path, nil, &results)
	return results, err
}

// Message Repository
type MessageRepository struct {
	client *SupabaseClient
}

func NewMessageRepository(client *SupabaseClient) *MessageRepository {
	return &MessageRepository{client: client}
}

func (r *MessageRepository) GetByConversationID(ctx context.Context, convID string) ([]*domain.Message, error) {
	var results []*domain.Message
	path := fmt.Sprintf("messages?conversation_id=eq.%s&select=*&order=created_at.asc", convID)
	err := r.client.request(ctx, http.MethodGet, path, nil, &results)
	return results, err
}

func (r *MessageRepository) AddMessage(ctx context.Context, msg *domain.Message) error {
	var results []domain.Message
	err := r.client.request(ctx, http.MethodPost, "messages", msg, &results)
	if err != nil {
		return err
	}
	if len(results) > 0 {
		*msg = results[0]
	}
	return nil
}

func (r *MessageRepository) DeleteByID(ctx context.Context, id string) error {
	path := fmt.Sprintf("messages?id=eq.%s", id)
	return r.client.request(ctx, http.MethodDelete, path, nil, nil)
}

// Memory Repository
type MemoryRepository struct {
	client *SupabaseClient
}

func NewMemoryRepository(client *SupabaseClient) *MemoryRepository {
	return &MemoryRepository{client: client}
}

func (r *MemoryRepository) AddMemory(ctx context.Context, mem *domain.Memory) error {
	var results []domain.Memory
	err := r.client.request(ctx, http.MethodPost, "memories", mem, &results)
	if err != nil {
		return err
	}
	if len(results) > 0 {
		*mem = results[0]
	}
	return nil
}

func (r *MemoryRepository) Search(ctx context.Context, convID string, embedding []float32, limit int) ([]*domain.Memory, error) {
	// PostgREST doesn't support vector similarity distance calculations directly via query string,
	// so we retrieve the memories for this conversation and return them as a fallback.
	var results []*domain.Memory
	path := fmt.Sprintf("memories?conversation_id=eq.%s&select=*&limit=%d", convID, limit)
	err := r.client.request(ctx, http.MethodGet, path, nil, &results)
	return results, err
}
