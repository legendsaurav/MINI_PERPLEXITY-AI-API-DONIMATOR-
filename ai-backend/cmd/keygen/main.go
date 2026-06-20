package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

// KeyRecord represents a stored API key entry.
type KeyRecord struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	KeyHash     string `json:"key_hash"`
	WorkspaceID string `json:"workspace_id"`
	Provider    string `json:"provider"`
	Permissions string `json:"permissions"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
	DeviceName  string `json:"device_name"`
}

// KeyStore holds all API key records.
type KeyStore struct {
	Keys []KeyRecord `json:"keys"`
}

func main() {
	username := flag.String("user", "", "Username for the new API key (required)")
	device := flag.String("device", "default", "Device name for identification (e.g., laptop, phone)")
	provider := flag.String("provider", "chatgpt", "Default AI provider (chatgpt, gemini, claude)")
	storePath := flag.String("store", "data/api_keys.json", "Path to the API key store file")
	flag.Parse()

	if *username == "" {
		fmt.Println("╔══════════════════════════════════════════════╗")
		fmt.Println("║   AI Backend — API Key Generator             ║")
		fmt.Println("╚══════════════════════════════════════════════╝")
		fmt.Println()
		fmt.Println("Usage:")
		fmt.Println("  keygen -user <username> [-device <name>] [-provider <name>]")
		fmt.Println()
		fmt.Println("Examples:")
		fmt.Println("  keygen -user proka -device laptop")
		fmt.Println("  keygen -user proka -device phone -provider gemini")
		fmt.Println("  keygen -user friend1 -device desktop")
		fmt.Println()
		fmt.Println("Flags:")
		flag.PrintDefaults()
		os.Exit(1)
	}

	// Generate IDs
	userID := uuid.New().String()
	workspaceID := uuid.New().String()
	keyID := uuid.New().String()

	// Generate the plaintext API key
	rawKey := "sk-" + strings.ReplaceAll(uuid.New().String(), "-", "")

	// Hash the key (SHA-256)
	hash := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(hash[:])

	// Create the record
	record := KeyRecord{
		ID:          keyID,
		UserID:      userID,
		Username:    *username,
		KeyHash:     keyHash,
		WorkspaceID: workspaceID,
		Provider:    *provider,
		Permissions: "full",
		Status:      "active",
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
		DeviceName:  *device,
	}

	// Load or create the store
	store := &KeyStore{}
	absPath := *storePath

	if data, err := os.ReadFile(absPath); err == nil {
		_ = json.Unmarshal(data, store)
	}

	// Check if user already exists — reuse their user_id and workspace_id
	for _, existing := range store.Keys {
		if existing.Username == *username {
			userID = existing.UserID
			workspaceID = existing.WorkspaceID
			record.UserID = userID
			record.WorkspaceID = workspaceID
			break
		}
	}

	store.Keys = append(store.Keys, record)

	// Ensure directory exists
	dir := filepath.Dir(absPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating directory: %v\n", err)
		os.Exit(1)
	}

	// Save the store
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error marshaling store: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(absPath, data, 0600); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing store: %v\n", err)
		os.Exit(1)
	}

	// Output
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════╗")
	fmt.Println("║              🔑  API KEY GENERATED SUCCESSFULLY             ║")
	fmt.Println("╠══════════════════════════════════════════════════════════════╣")
	fmt.Printf("║  User:        %-45s ║\n", *username)
	fmt.Printf("║  Device:      %-45s ║\n", *device)
	fmt.Printf("║  Provider:    %-45s ║\n", *provider)
	fmt.Printf("║  Workspace:   %-45s ║\n", workspaceID[:20]+"...")
	fmt.Println("╠══════════════════════════════════════════════════════════════╣")
	fmt.Println("║                                                              ║")
	fmt.Printf("║  API Key:  %-48s ║\n", rawKey)
	fmt.Println("║                                                              ║")
	fmt.Println("╠══════════════════════════════════════════════════════════════╣")
	fmt.Println("║  ⚠  SAVE THIS KEY NOW — it will NOT be shown again!         ║")
	fmt.Println("║                                                              ║")
	fmt.Println("║  Usage:                                                      ║")
	fmt.Println("║    Authorization: Bearer <API_KEY>                           ║")
	fmt.Println("║                                                              ║")
	fmt.Println("║  Example:                                                    ║")
	displayKey := rawKey
	if len(displayKey) > 20 {
		displayKey = displayKey[:20] + "..."
	}
	fmt.Printf("║    curl -H \"Authorization: Bearer %s\"          ║\n", displayKey)
	fmt.Println("║         http://localhost:8080/v1/health                       ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════╝")
	fmt.Println()
}
