package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	"github.com/pl3lee/uwplan/api/internal/gateway/uwflow"
	courserepository "github.com/pl3lee/uwplan/api/internal/repository/course"
	"github.com/pl3lee/uwplan/api/internal/service/catalog"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := execute(ctx, os.Args[1:], os.Getenv("DATABASE_URL"), uwflow.DefaultEndpoint, os.Stdout)
	cancel()
	os.Exit(code)
}

func execute(ctx context.Context, args []string, databaseURL, endpoint string, output io.Writer) int {
	const usage = "usage: courses-update (requires DATABASE_URL)"
	if len(args) == 1 && (args[0] == "-h" || args[0] == "--help") {
		fmt.Fprintln(output, usage)
		return 0
	}
	logger := slog.New(slog.NewJSONHandler(output, nil)).With("service", "uwplan-catalog")
	if len(args) != 0 {
		logger.Error(usage, "event", "catalog.config.invalid")
		return 1
	}
	if databaseURL == "" {
		logger.Error("DATABASE_URL is required", "event", "catalog.config.invalid")
		return 1
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Minute)
	defer cancel()
	result, err := update(ctx, databaseURL, endpoint)
	if err != nil {
		// Driver and upstream errors may contain credentials or private response
		// details. The process reports failure without serializing those errors.
		logger.Error("course catalog update failed", "event", "catalog.failed")
		return 1
	}
	logger.Info("course catalog updated", "event", "catalog.completed", "courses", result.Courses)
	return 0
}

func update(ctx context.Context, databaseURL, endpoint string) (course.ImportResult, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return course.ImportResult{}, err
	}
	config.MaxConns = 2
	config.ConnConfig.ConnectTimeout = 10 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return course.ImportResult{}, err
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return course.ImportResult{}, err
	}
	return catalog.NewCatalogService(uwflow.NewUWFlowGateway(endpoint, nil), courserepository.NewCourseRepository(pool)).Update(ctx)
}
