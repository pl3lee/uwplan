package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pl3lee/uwplan/api/migrations"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		logger.Error("migration configuration missing", "event", "migration.config.invalid")
		os.Exit(1)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	ctx, timeout := context.WithTimeout(ctx, 5*time.Minute)
	defer timeout()
	if err := run(ctx, url); err != nil {
		if errors.Is(err, migrations.ErrSchemaMismatch) {
			logger.Error("public schema differs from the verified baseline; adoption rejected", "event", "migration.schema.mismatch")
		} else {
			logger.Error("database migration failed", "event", "migration.failed", "error_type", fmt.Sprintf("%T", err))
		}
		os.Exit(1)
	}
	logger.Info("database schema is current", "event", "migration.completed")
}

func run(ctx context.Context, url string) error {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return err
	}
	defer db.Close()
	return migrations.Up(ctx, db)
}
