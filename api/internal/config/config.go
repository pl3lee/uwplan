package config

import (
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/pl3lee/uwplan/api/internal/domain/health"
)

type Config struct {
	HTTPAddress   string
	DatabaseURL   string
	RedisURL      string
	PublicOrigin  string
	SecureCookies bool
	SessionTTL    time.Duration
	Release       health.Release
}

func Load(getenv func(string) string) (Config, error) {
	origin := getenv("PUBLIC_ORIGIN")
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return Config{}, errors.New("PUBLIC_ORIGIN must be an origin without credentials, path, query, or fragment")
	}
	secure := parsed.Scheme == "https"
	if !secure && (parsed.Scheme != "http" || (parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "::1")) {
		return Config{}, errors.New("PUBLIC_ORIGIN must use HTTPS except on loopback")
	}
	cfg := Config{HTTPAddress: getenv("HTTP_ADDR"), DatabaseURL: getenv("DATABASE_URL"), RedisURL: getenv("REDIS_URL"), PublicOrigin: strings.TrimSuffix(origin, "/"), SecureCookies: secure, SessionTTL: 30 * 24 * time.Hour, Release: health.Release{Digest: getenv("RELEASE_DIGEST"), Revision: getenv("RELEASE_REVISION")}}
	if cfg.DatabaseURL == "" || cfg.RedisURL == "" {
		return Config{}, errors.New("DATABASE_URL and REDIS_URL are required")
	}
	if cfg.HTTPAddress == "" {
		cfg.HTTPAddress = ":8080"
	}
	if cfg.Release.Digest == "" {
		cfg.Release.Digest = "unavailable"
	}
	if cfg.Release.Revision == "" {
		cfg.Release.Revision = "unknown"
	}
	return cfg, nil
}

func (c Config) CookieName() string {
	if c.SecureCookies {
		return "__Host-uwplan_session"
	}
	return "uwplan_session"
}
