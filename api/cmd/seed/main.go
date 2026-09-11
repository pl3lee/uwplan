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
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/gateway/builtin"
	templaterepository "github.com/pl3lee/uwplan/api/internal/repository/template"
	"github.com/pl3lee/uwplan/api/internal/service/seed"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := execute(ctx, os.Args[1:], os.Getenv("DATABASE_URL"), os.Stdout)
	cancel()
	os.Exit(code)
}

func execute(ctx context.Context, args []string, databaseURL string, output io.Writer) int {
	const usage = "usage: seed (requires DATABASE_URL)"
	if len(args) == 1 && (args[0] == "-h" || args[0] == "--help") {
		fmt.Fprintln(output, usage)
		return 0
	}
	logger := slog.New(slog.NewJSONHandler(output, nil)).With("service", "uwplan-seed")
	if len(args) != 0 {
		logger.Error(usage, "event", "seed.config.invalid")
		return 1
	}
	if databaseURL == "" {
		logger.Error("DATABASE_URL is required", "event", "seed.config.invalid")
		return 1
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	result, err := run(ctx, databaseURL)
	if err != nil {
		// Driver errors may contain credentials; report failure without printing them.
		logger.Error("template seed failed", "event", "seed.failed")
		return 1
	}
	logger.Info("built-in templates seeded", "event", "seed.completed", "created", result.Created, "existing", result.Existing)
	return 0
}

func run(ctx context.Context, databaseURL string) (template.SeedResult, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return template.SeedResult{}, err
	}
	config.MaxConns = 2
	config.ConnConfig.ConnectTimeout = 10 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return template.SeedResult{}, err
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return template.SeedResult{}, err
	}
	return seed.NewSeedService(builtin.NewBuiltinGateway(), templaterepository.NewTemplateRepository(pool)).Seed(ctx)
}
