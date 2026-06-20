package database

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"github.com/proka/ai-backend/internal/config"
	_ "github.com/lib/pq"
)

// DB wraps the standard sql.DB with helper methods.
type DB struct {
	*sql.DB
}

// New opens a PostgreSQL connection and verifies it with a ping.
func New(cfg config.DatabaseConfig) (*DB, error) {
	db, err := sql.Open("postgres", cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	slog.Info("Database connected", "host", cfg.Host, "dbname", cfg.DBName)
	return &DB{db}, nil
}

// Close gracefully closes the database connection.
func (d *DB) Close() error {
	slog.Info("Closing database connection")
	return d.DB.Close()
}
