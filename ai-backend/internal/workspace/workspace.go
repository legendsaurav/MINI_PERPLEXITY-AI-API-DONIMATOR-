package workspace

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/proka/ai-backend/internal/database"
)

// Service handles workspace and project resolution.
type Service struct {
	db *database.DB
}

// NewService creates a new workspace service.
func NewService(db *database.DB) *Service {
	return &Service{db: db}
}

// ResolveWorkspace fetches a workspace by ID and updates its last_used timestamp.
func (s *Service) ResolveWorkspace(ctx context.Context, workspaceID string) (*database.Workspace, error) {
	var ws database.Workspace
	err := s.db.QueryRowContext(ctx,
		`UPDATE workspaces SET last_used = NOW()
		 WHERE id = $1
		 RETURNING id, user_id, provider, browser_profile_path, created_at, updated_at, last_used`,
		workspaceID,
	).Scan(&ws.ID, &ws.UserID, &ws.Provider, &ws.BrowserProfilePath,
		&ws.CreatedAt, &ws.UpdatedAt, &ws.LastUsed)

	if err != nil {
		return nil, fmt.Errorf("workspace not found: %w", err)
	}

	slog.Debug("Workspace resolved", "workspace_id", ws.ID, "provider", ws.Provider)
	return &ws, nil
}

// ResolveProject fetches or auto-creates a project within a workspace.
func (s *Service) ResolveProject(ctx context.Context, workspaceID string, projectName string) (*database.Project, error) {
	var proj database.Project
	err := s.db.QueryRowContext(ctx,
		`SELECT id, workspace_id, name, provider_metadata, conversation_id, conversation_url, created_at, updated_at
		 FROM projects WHERE workspace_id = $1 AND name = $2`,
		workspaceID, projectName,
	).Scan(&proj.ID, &proj.WorkspaceID, &proj.Name, &proj.ProviderMetadata,
		&proj.ConversationID, &proj.ConversationURL, &proj.CreatedAt, &proj.UpdatedAt)

	if err == sql.ErrNoRows {
		slog.Info("Project not found, auto-creating", "workspace_id", workspaceID, "project", projectName)
		return s.CreateProject(ctx, workspaceID, projectName)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to resolve project: %w", err)
	}

	// Update last accessed
	_, _ = s.db.ExecContext(ctx, `UPDATE projects SET updated_at = NOW() WHERE id = $1`, proj.ID)

	slog.Debug("Project resolved", "project_id", proj.ID, "name", proj.Name)
	return &proj, nil
}

// CreateProject creates a new project within a workspace.
func (s *Service) CreateProject(ctx context.Context, workspaceID string, name string) (*database.Project, error) {
	id := uuid.New().String()
	now := time.Now()
	metadata, _ := json.Marshal(map[string]interface{}{})

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO projects (id, workspace_id, name, provider_metadata, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		id, workspaceID, name, metadata, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create project: %w", err)
	}

	proj := &database.Project{
		ID:               id,
		WorkspaceID:      workspaceID,
		Name:             name,
		ProviderMetadata: metadata,
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	slog.Info("Project created", "project_id", id, "workspace_id", workspaceID, "name", name)
	return proj, nil
}

// ListProjects returns all projects for a workspace.
func (s *Service) ListProjects(ctx context.Context, workspaceID string) ([]database.Project, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, workspace_id, name, provider_metadata, conversation_id, conversation_url, created_at, updated_at
		 FROM projects WHERE workspace_id = $1 ORDER BY updated_at DESC`,
		workspaceID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list projects: %w", err)
	}
	defer rows.Close()

	var projects []database.Project
	for rows.Next() {
		var p database.Project
		if err := rows.Scan(&p.ID, &p.WorkspaceID, &p.Name, &p.ProviderMetadata,
			&p.ConversationID, &p.ConversationURL, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan project: %w", err)
		}
		projects = append(projects, p)
	}

	return projects, nil
}
