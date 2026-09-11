package session_test

import (
	"errors"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/go-cmp/cmp"
	domainsession "github.com/pl3lee/uwplan/api/internal/domain/session"
	repositorysession "github.com/pl3lee/uwplan/api/internal/repository/session"
	"github.com/redis/go-redis/v9"
)

func TestSessionExpiresAndLogoutRevokes(t *testing.T) {
	t.Parallel()
	for _, action := range []string{"expiry", "logout"} {
		t.Run(action, func(t *testing.T) {
			t.Parallel()
			server := miniredis.RunT(t)
			client := redis.NewClient(&redis.Options{Addr: server.Addr()})
			t.Cleanup(func() { client.Close() })
			repo := repositorysession.NewSessionRepository(client)
			now := time.Now().UTC()
			credentials := domainsession.Credentials{Token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
			value := domainsession.Session{ID: "session-id", UserID: "legacy-user-id", TokenHash: credentials.Hash(), CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
			if err := repo.Create(t.Context(), value); err != nil {
				t.Fatal(err)
			}
			got, err := repo.Get(t.Context(), domainsession.Session{TokenHash: value.TokenHash})
			if err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(value, got); diff != "" {
				t.Fatal(diff)
			}
			if action == "expiry" {
				server.FastForward(2 * time.Hour)
			} else {
				if err := repo.Revoke(t.Context(), value); err != nil {
					t.Fatal(err)
				}
				if err := repo.Revoke(t.Context(), value); err != nil {
					t.Fatalf("idempotent logout: %v", err)
				}
			}
			_, err = repo.Get(t.Context(), domainsession.Session{TokenHash: value.TokenHash})
			if !errors.Is(err, domainsession.ErrInvalid) {
				t.Fatalf("expected invalid session, got %v", err)
			}
		})
	}
}

func TestExpiredSessionCannotBecomePersistent(t *testing.T) {
	t.Parallel()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { client.Close() })
	repo := repositorysession.NewSessionRepository(client)
	err := repo.Create(t.Context(), domainsession.Session{ID: "expired", UserID: "user", TokenHash: "hash", ExpiresAt: time.Now().Add(-time.Minute)})
	if !errors.Is(err, domainsession.ErrInvalid) {
		t.Fatalf("expected expired write rejection, got %v", err)
	}
	if diff := cmp.Diff([]string{}, server.Keys()); diff != "" {
		t.Fatalf("expired session retained: %s", diff)
	}
}

func TestRedisOutageIsNotReportedAsMissingSession(t *testing.T) {
	t.Parallel()
	server := miniredis.RunT(t)
	server.SetError("fixture outage")
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	t.Cleanup(func() { client.Close() })
	repo := repositorysession.NewSessionRepository(client)
	_, err := repo.Get(t.Context(), domainsession.Session{TokenHash: "hash"})
	if err == nil || errors.Is(err, domainsession.ErrInvalid) {
		t.Fatalf("expected infrastructure failure, got %v", err)
	}
}
