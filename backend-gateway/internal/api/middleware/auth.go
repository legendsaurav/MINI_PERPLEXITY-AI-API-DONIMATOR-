package middleware

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type SupabaseKeyConfig struct {
	ID       string `json:"id"`
	Metadata struct {
		Type            string   `json:"type"`
		Username        string   `json:"username"`
		PasswordHash    string   `json:"password_hash"`
		AvailableModels []string `json:"available_models"`
		ConversationID  string   `json:"conversation_id"`
		Status          string   `json:"status"`
		CreatedAt       string   `json:"created_at"`
	} `json:"metadata"`
}

func AuthMiddleware(apiKey, supabaseURL, supabaseKey string) func(http.Handler) http.Handler {
	httpClient := &http.Client{Timeout: 5 * time.Second}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get("Authorization")
			if key == "" {
				key = r.Header.Get("x-api-key")
			} else if len(key) > 7 && key[:7] == "Bearer " {
				key = key[7:]
			}

			if key == "" {
				http.Error(w, "Unauthorized: API Key missing", http.StatusUnauthorized)
				return
			}

			// 1. Static API Key check for fallback/development
			if apiKey != "" && key == apiKey {
				next.ServeHTTP(w, r)
				return
			}

			// 2. Query Supabase for dynamic API key stored as a conversation config
			if supabaseURL == "" || supabaseKey == "" {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			// Query REST: conversations?id=eq.{key}&select=*
			path := fmt.Sprintf("%s/rest/v1/conversations?id=eq.%s&select=*", supabaseURL, key)
			req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, path, nil)
			if err != nil {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}
			req.Header.Set("apikey", supabaseKey)
			req.Header.Set("Authorization", "Bearer "+supabaseKey)

			resp, err := httpClient.Do(req)
			if err != nil {
				http.Error(w, "Authentication service unavailable", http.StatusServiceUnavailable)
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				http.Error(w, "Unauthorized: Invalid API Key", http.StatusUnauthorized)
				return
			}

			var results []SupabaseKeyConfig
			if err := json.NewDecoder(resp.Body).Decode(&results); err != nil || len(results) == 0 {
				http.Error(w, "Unauthorized: Invalid API Key", http.StatusUnauthorized)
				return
			}

			keyConfig := results[0]
			if keyConfig.Metadata.Type != "api_key_config" {
				http.Error(w, "Unauthorized: Invalid API Key format", http.StatusUnauthorized)
				return
			}

			if keyConfig.Metadata.Status != "active" {
				http.Error(w, "Unauthorized: Revoked or inactive API Key", http.StatusUnauthorized)
				return
			}

			// 3. Read and parse request body to validate model and enforce ConversationID
			bodyBytes, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}

			var bodyMap map[string]interface{}
			if err := json.Unmarshal(bodyBytes, &bodyMap); err != nil {
				http.Error(w, "Invalid JSON body", http.StatusBadRequest)
				return
			}

			// Validate Model Access
			reqModel, _ := bodyMap["model"].(string)
			modelAllowed := false
			for _, m := range keyConfig.Metadata.AvailableModels {
				if m == "*" || strings.ToLower(m) == strings.ToLower(reqModel) {
					modelAllowed = true
					break
				}
			}
			if !modelAllowed {
				http.Error(w, fmt.Sprintf("Forbidden: API Key does not have access to model '%s'", reqModel), http.StatusForbidden)
				return
			}

			// Enforce ConversationID mapping / context boundaries
			reqConvID, _ := bodyMap["conversation_id"].(string)
			linkedConvID := keyConfig.Metadata.ConversationID

			if reqConvID == "" {
				bodyMap["conversation_id"] = linkedConvID
			} else if reqConvID != linkedConvID {
				http.Error(w, "Forbidden: Conversation ID does not match API Key context", http.StatusForbidden)
				return
			}

			// Set the user_id to username from the key metadata if not provided
			if _, ok := bodyMap["user_id"]; !ok {
				bodyMap["user_id"] = keyConfig.Metadata.Username
			}

			// Marshal body back
			newBodyBytes, err := json.Marshal(bodyMap)
			if err != nil {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}

			r.Body = io.NopCloser(bytes.NewBuffer(newBodyBytes))
			r.ContentLength = int64(len(newBodyBytes))
			r.Header.Set("Content-Length", fmt.Sprintf("%d", len(newBodyBytes)))

			next.ServeHTTP(w, r)
		})
	}
}
