package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pl3lee/uwplan/api/internal/api"
	"github.com/pl3lee/uwplan/api/internal/config"
	healthgateway "github.com/pl3lee/uwplan/api/internal/gateway/health"
	oauthgateway "github.com/pl3lee/uwplan/api/internal/gateway/oauth"
	oauthrepository "github.com/pl3lee/uwplan/api/internal/repository/oauth"
	sessionrepository "github.com/pl3lee/uwplan/api/internal/repository/session"
	userrepository "github.com/pl3lee/uwplan/api/internal/repository/user"
	authservice "github.com/pl3lee/uwplan/api/internal/service/auth"
	oauthservice "github.com/pl3lee/uwplan/api/internal/service/oauth"
	"github.com/redis/go-redis/v9"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", "uwplan-api"))
	if err := run(); err != nil {
		// Connection parsers and provider errors may contain credentials. Report only
		// the error type; never serialize environment values or the raw error here.
		slog.Error("api.stopped", "event", "api.stopped", "error_type", fmt.Sprintf("%T", err))
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	safeRelease, _ := cfg.Release.Public()
	slog.SetDefault(slog.Default().With("release_digest", safeRelease.Digest, "release_revision", safeRelease.Revision))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	databaseConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("configure database: %w", err)
	}
	databaseConfig.MaxConns = 8
	databaseConfig.ConnConfig.ConnectTimeout = 2 * time.Second
	database, err := pgxpool.NewWithConfig(ctx, databaseConfig)
	if err != nil {
		return fmt.Errorf("create database pool: %w", err)
	}
	defer database.Close()
	redisConfig, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("configure Redis: %w", err)
	}
	redisConfig.ContextTimeoutEnabled = true
	redisConfig.DialTimeout = 2 * time.Second
	redisConfig.ReadTimeout = 2 * time.Second
	redisConfig.WriteTimeout = 2 * time.Second
	redisConfig.MaxRetries = 1
	redisClient := redis.NewClient(redisConfig)
	defer redisClient.Close()
	auth, err := authservice.NewAuthService(userrepository.NewUserRepository(database), sessionrepository.NewSessionRepository(redisClient), cfg.SessionTTL)
	if err != nil {
		return err
	}
	providerGateway := oauthgateway.NewOAuthGateway(oauthgateway.Options{PublicOrigin: cfg.PublicOrigin, Google: oauthgateway.Credentials{ClientID: cfg.Google.ClientID, ClientSecret: cfg.Google.ClientSecret}, GitHub: oauthgateway.Credentials{ClientID: cfg.GitHub.ClientID, ClientSecret: cfg.GitHub.ClientSecret}}, nil)
	oauth := oauthservice.NewOAuthService(oauthrepository.NewOAuthRepository(redisClient), providerGateway, auth)
	router, _ := api.NewRouter(cfg, api.Dependencies{Auth: auth, Health: healthgateway.NewHealthGateway(database, redisClient), OAuth: oauth})
	server := &http.Server{Addr: cfg.HTTPAddress, Handler: router, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	stopped := make(chan error, 1)
	go func() { stopped <- server.ListenAndServe() }()
	slog.Info("api.started", "event", "api.started")
	select {
	case err := <-stopped:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve API: %w", err)
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			server.Close()
			return fmt.Errorf("shutdown API: %w", err)
		}
		slog.Info("api.shutdown", "event", "api.shutdown")
		return nil
	}
}
