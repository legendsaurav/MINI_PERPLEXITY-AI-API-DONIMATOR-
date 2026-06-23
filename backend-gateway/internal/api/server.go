package api

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/your-repo/ai-gateway-backend/internal/api/handlers"
	apiMiddleware "github.com/your-repo/ai-gateway-backend/internal/api/middleware"
	"github.com/your-repo/ai-gateway-backend/internal/core/ports"
	"net/http"
)

type Server struct {
	router *chi.Mux
}

func NewServer(chatService ports.ChatService, apiKey, supabaseURL, supabaseKey string) *Server {
	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Route("/v1", func(r chi.Router) {
		r.Use(apiMiddleware.AuthMiddleware(apiKey, supabaseURL, supabaseKey))
		
		chatHandler := handlers.NewChatHandler(chatService)
		r.Post("/chat/completions", chatHandler.HandleChatCompletions)
	})

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OK"))
	})

	return &Server{router: r}
}

func (s *Server) Start(addr string) error {
	return http.ListenAndServe(addr, s.router)
}
