package db

import (
	"github.com/antigravity/go-ai-backend/internal/config"
	"github.com/nedpals/supabase-go"
)

type Client struct {
	sb *supabase.Client
}

func NewClient(cfg *config.Config) *Client {
	// We use the Service Role Key to bypass RLS policies since this is a backend
	sb := supabase.CreateClient(cfg.SupabaseURL, cfg.SupabaseKey)
	return &Client{
		sb: sb,
	}
}

// Below are models representing Supabase tables

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Status   string `json:"status"`
}

type APIKey struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	KeyHash     string `json:"key_hash"`
	WorkspaceID string `json:"workspace_id"`
}

type Workspace struct {
	ID               string                 `json:"id"`
	UserID           string                 `json:"user_id"`
	Provider         string                 `json:"provider"`
	ProviderMetadata map[string]interface{} `json:"provider_metadata"`
}

type Project struct {
	ID                 string                 `json:"id"`
	WorkspaceID        string                 `json:"workspace_id"`
	Name               string                 `json:"name"`
	ProviderMetadata   map[string]interface{} `json:"provider_metadata"`
	BrowserProfilePath string                 `json:"browser_profile_path"`
}

// FetchWorkspace Example wrapper
func (c *Client) FetchWorkspace(id string) (*Workspace, error) {
	var results []Workspace
	err := c.sb.DB.From("workspaces").Select("*").Eq("id", id).Execute(&results)
	if err != nil {
		return nil, err
	}
	if len(results) == 0 {
		return nil, nil // Not found
	}
	return &results[0], nil
}

func (c *Client) FetchProject(id string) (*Project, error) {
	var results []Project
	err := c.sb.DB.From("projects").Select("*").Eq("id", id).Execute(&results)
	if err != nil {
		return nil, err
	}
	if len(results) == 0 {
		return nil, nil // Not found
	}
	return &results[0], nil
}

func (c *Client) ResolveAPIKey(keyHash string) (*APIKey, error) {
	var results []APIKey
	err := c.sb.DB.From("api_keys").Select("*").Eq("key_hash", keyHash).Execute(&results)
	if err != nil {
		return nil, err
	}
	if len(results) == 0 {
		return nil, nil // Not found
	}
	return &results[0], nil
}

func (c *Client) CreateProject(project *Project) error {
	var results []Project
	err := c.sb.DB.From("projects").Insert(project).Execute(&results)
	if err != nil {
		return err
	}
	if len(results) > 0 {
		*project = results[0]
	}
	return nil
}

func (c *Client) ListProjects(workspaceID string) ([]Project, error) {
	var results []Project
	err := c.sb.DB.From("projects").Select("*").Eq("workspace_id", workspaceID).Execute(&results)
	if err != nil {
		return nil, err
	}
	return results, nil
}

func (c *Client) DeleteProject(workspaceID, name string) error {
	var results []Project
	err := c.sb.DB.From("projects").Delete().Eq("workspace_id", workspaceID).Eq("name", name).Execute(&results)
	return err
}
