package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/your-repo/ai-gateway-backend/internal/core/domain"
	"github.com/your-repo/ai-gateway-backend/internal/core/ports"
	contextSvc "github.com/your-repo/ai-gateway-backend/internal/services/context"
	routerSvc "github.com/your-repo/ai-gateway-backend/internal/services/router"
	"io"
	"net/http"
	"time"
	"bufio"
	"strings"
)

type ChatService struct {
	msgRepo       ports.MessageRepository
	convRepo      ports.ConversationRepository
	contextEngine *contextSvc.ContextEngine
	router        *routerSvc.ModelRouter
	httpClient    *http.Client
}

func NewChatService(
	msgRepo ports.MessageRepository,
	convRepo ports.ConversationRepository,
	contextEngine *contextSvc.ContextEngine,
	router *routerSvc.ModelRouter,
) *ChatService {
	return &ChatService{
		msgRepo:       msgRepo,
		convRepo:      convRepo,
		contextEngine: contextEngine,
		router:        router,
		httpClient:    &http.Client{Timeout: 5 * time.Minute},
	}
}

func (s *ChatService) Completions(ctx context.Context, req *ports.ChatRequest) (*ports.ChatResponse, error) {
	// 1. Ensure conversation exists
	_, err := s.convRepo.GetByID(ctx, req.ConversationID)
	if err != nil {
		s.convRepo.Create(ctx, &domain.Conversation{
			ID:        req.ConversationID,
			OwnerID:   req.UserID,
			Title:     "New Conversation",
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		})
	}

	// 2. Save user message
	userMsg := domain.Message{
		ConversationID: req.ConversationID,
		Role:           "user",
		Content:        req.Messages[len(req.Messages)-1].Content,
		UserID:         req.UserID,
		Model:          req.Model,
		CreatedAt:      time.Now(),
	}
	s.msgRepo.AddMessage(ctx, &userMsg)

	// 3. Build full prompt with history
	fullPrompt, err := s.contextEngine.BuildPrompt(ctx, req.ConversationID, userMsg)
	if err != nil {
		return nil, err
	}

	// 4. Route to model
	endpoint, err := s.router.GetEndpoint(req.Model)
	if err != nil {
		return nil, err
	}

	// 5. Forward request to downstream model
	payload := map[string]interface{}{
		"model":    req.Model,
		"messages": fullPrompt,
		"stream":   false,
	}
	body, _ := json.Marshal(payload)
	
	proxyReq, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/chat/completions", endpoint), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	proxyReq.Header.Set("Content-Type", "application/json")
	// Note: Authentication for downstream models (e.g. OpenAI Key) should be handled via env/config
	// For now, assume the endpoint is either local or pre-authenticated/proxied.

	resp, err := s.httpClient.Do(proxyReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("downstream error (%d): %s", resp.StatusCode, string(respBody))
	}

	var openAIResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage ports.Usage `json:"usage"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&openAIResp); err != nil {
		return nil, err
	}

	if len(openAIResp.Choices) == 0 {
		return nil, fmt.Errorf("no choices returned from model")
	}

	content := openAIResp.Choices[0].Message.Content

	// 6. Save assistant message
	assistantMsg := domain.Message{
		ConversationID: req.ConversationID,
		Role:           "assistant",
		Content:        content,
		UserID:         "gateway",
		Model:          req.Model,
		CreatedAt:      time.Now(),
	}
	s.msgRepo.AddMessage(ctx, &assistantMsg)

	return &ports.ChatResponse{
		ID:      "msg_" + time.Now().Format("20060102150405"),
		Content: content,
		Model:   req.Model,
		Usage:   openAIResp.Usage,
	}, nil
}

func (s *ChatService) StreamCompletions(ctx context.Context, req *ports.ChatRequest) (<-chan *ports.ChatResponseChunk, <-chan error) {
	chunkChan := make(chan *ports.ChatResponseChunk)
	errChan := make(chan error, 1)

	go func() {
		defer close(chunkChan)
		defer close(errChan)

		// 1. Ensure conversation exists
		_, err := s.convRepo.GetByID(ctx, req.ConversationID)
		if err != nil {
			s.convRepo.Create(ctx, &domain.Conversation{
				ID:        req.ConversationID,
				OwnerID:   req.UserID,
				Title:     "New Conversation",
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			})
		}

		// 2. Save user message
		userMsg := domain.Message{
			ConversationID: req.ConversationID,
			Role:           "user",
			Content:        req.Messages[len(req.Messages)-1].Content,
			UserID:         req.UserID,
			Model:          req.Model,
			CreatedAt:      time.Now(),
		}
		s.msgRepo.AddMessage(ctx, &userMsg)

		// 3. Build full prompt with history
		fullPrompt, err := s.contextEngine.BuildPrompt(ctx, req.ConversationID, userMsg)
		if err != nil {
			errChan <- err
			return
		}

		// 4. Route to model
		endpoint, err := s.router.GetEndpoint(req.Model)
		if err != nil {
			errChan <- err
			return
		}

		// 5. Forward request to downstream model
		payload := map[string]interface{}{
			"model":    req.Model,
			"messages": fullPrompt,
			"stream":   true,
		}
		body, _ := json.Marshal(payload)

		proxyReq, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/chat/completions", endpoint), bytes.NewReader(body))
		if err != nil {
			errChan <- err
			return
		}
		proxyReq.Header.Set("Content-Type", "application/json")

		resp, err := s.httpClient.Do(proxyReq)
		if err != nil {
			errChan <- err
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			respBody, _ := io.ReadAll(resp.Body)
			errChan <- fmt.Errorf("downstream error (%d): %s", resp.StatusCode, string(respBody))
			return
		}

		// 6. Process Stream
		reader := bufio.NewReader(resp.Body)
		var fullContent strings.Builder

		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				if err == io.EOF {
					break
				}
				errChan <- err
				return
			}

			line = strings.TrimSpace(line)
			if line == "" || !strings.HasPrefix(line, "data: ") {
				continue
			}

			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				break
			}

			var streamResp struct {
				Choices []struct {
					Delta struct {
						Content string `json:"content"`
					} `json:"delta"`
				} `json:"choices"`
			}

			if err := json.Unmarshal([]byte(data), &streamResp); err != nil {
				continue
			}

			if len(streamResp.Choices) > 0 {
				contentChunk := streamResp.Choices[0].Delta.Content
				fullContent.WriteString(contentChunk)
				chunkChan <- &ports.ChatResponseChunk{Content: contentChunk}
			}
		}

		chunkChan <- &ports.ChatResponseChunk{Done: true}

		// 7. Save final message
		assistantMsg := domain.Message{
			ConversationID: req.ConversationID,
			Role:           "assistant",
			Content:        fullContent.String(),
			UserID:         "gateway",
			Model:          req.Model,
			CreatedAt:      time.Now(),
		}
		s.msgRepo.AddMessage(context.Background(), &assistantMsg)
	}()

	return chunkChan, errChan
}

