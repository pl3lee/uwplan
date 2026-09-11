package config

import (
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/pl3lee/uwplan/api/internal/domain/health"
)

type Config struct {
	HTTPAddress    string
	DatabaseURL    string
	RedisURL       string
	PublicOrigin   string
	SecureCookies  bool
	SessionTTL     time.Duration
	Release        health.Release
	Google, GitHub ProviderCredentials
}

type ProviderCredentials struct{ ClientID, ClientSecret string }

func Load(getenv func(string) string) (Config, error) {
	origin := getenv("PUBLIC_ORIGIN")
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return Config{}, errors.New("PUBLIC_ORIGIN must be an origin without credentials, path, query, or fragment")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	hostname := strings.ToLower(parsed.Hostname())
	secure := parsed.Scheme == "https"
	if !secure && (parsed.Scheme != "http" || (hostname != "localhost" && hostname != "127.0.0.1" && hostname != "::1")) {
		return Config{}, errors.New("PUBLIC_ORIGIN must use HTTPS except on loopback")
	}
	port := parsed.Port()
	if port != "" {
		number, err := strconv.ParseUint(port, 10, 16)
		if err != nil {
			return Config{}, errors.New("PUBLIC_ORIGIN has an invalid port")
		}
		port = strconv.FormatUint(number, 10)
		if (secure && port == "443") || (!secure && port == "80") {
			port = ""
		}
	}
	host := hostname
	if port != "" {
		host = net.JoinHostPort(hostname, port)
	} else if strings.Contains(hostname, ":") {
		host = "[" + hostname + "]"
	}
	origin = parsed.Scheme + "://" + host
	cfg := Config{HTTPAddress: getenv("HTTP_ADDR"), DatabaseURL: getenv("DATABASE_URL"), RedisURL: getenv("REDIS_URL"), PublicOrigin: origin, SecureCookies: secure, SessionTTL: 30 * 24 * time.Hour, Release: health.Release{Digest: getenv("RELEASE_DIGEST"), Revision: getenv("RELEASE_REVISION")}}
	if cfg.DatabaseURL == "" || cfg.RedisURL == "" {
		return Config{}, errors.New("DATABASE_URL and REDIS_URL are required")
	}
	if cfg.HTTPAddress == "" {
		cfg.HTTPAddress = ":8080"
	}
	cfg.Google = ProviderCredentials{ClientID: getenv("AUTH_GOOGLE_ID"), ClientSecret: getenv("AUTH_GOOGLE_SECRET")}
	cfg.GitHub = ProviderCredentials{ClientID: getenv("AUTH_GITHUB_ID"), ClientSecret: getenv("AUTH_GITHUB_SECRET")}
	for _, provider := range []ProviderCredentials{cfg.Google, cfg.GitHub} {
		if (provider.ClientID == "") != (provider.ClientSecret == "") {
			return Config{}, errors.New("OAuth providers require both client ID and secret")
		}
	}
	return cfg, nil
}

func (c Config) CookieName() string {
	if c.SecureCookies {
		return "__Host-uwplan_session"
	}
	return "uwplan_session"
}
