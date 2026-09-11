package oauth_test

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/go-cmp/cmp"
	domainoauth "github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	repositoryoauth "github.com/pl3lee/uwplan/api/internal/repository/oauth"
	"github.com/redis/go-redis/v9"
)

func TestOAuthStateCanOnlyBeConsumedOnce(t *testing.T) {
	t.Parallel()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { client.Close() })
	repo := repositoryoauth.NewOAuthRepository(client)
	flow := domainoauth.Flow{StateHash: "hashed-state", Provider: user.Google, Verifier: "pkce-verifier", Nonce: "oidc-nonce", ReturnTo: "/schedule", ExpiresAt: time.Now().UTC().Add(10 * time.Minute)}
	if err := repo.Create(t.Context(), flow); err != nil {
		t.Fatal(err)
	}
	var results [8]domainoauth.Flow
	var failures [8]error
	var group sync.WaitGroup
	for index := range 8 {
		group.Go(func() {
			results[index], failures[index] = repo.Consume(t.Context(), domainoauth.Flow{StateHash: flow.StateHash})
		})
	}
	group.Wait()
	successes := 0
	for index, err := range failures {
		if err == nil {
			successes++
			if diff := cmp.Diff(flow, results[index]); diff != "" {
				t.Fatal(diff)
			}
		} else if !errors.Is(err, domainoauth.ErrInvalidState) {
			t.Fatalf("unexpected consume failure: %v", err)
		}
	}
	if diff := cmp.Diff(1, successes); diff != "" {
		t.Fatal(diff)
	}
}

func TestOAuthStateExpiryAndStorageFailures(t *testing.T) {
	t.Parallel()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	t.Cleanup(func() { client.Close() })
	repo := repositoryoauth.NewOAuthRepository(client)
	flow := domainoauth.Flow{StateHash: "state-hash", Provider: user.GitHub, Verifier: "pkce", Nonce: "nonce", ReturnTo: "/select", ExpiresAt: time.Now().UTC().Add(10 * time.Minute)}
	if err := repo.Create(t.Context(), flow); err != nil {
		t.Fatal(err)
	}
	if err := repo.Create(t.Context(), flow); !errors.Is(err, domainoauth.ErrInvalidState) {
		t.Fatalf("expected collision rejection, got %v", err)
	}
	server.FastForward(11 * time.Minute)
	if _, err := repo.Consume(t.Context(), flow); !errors.Is(err, domainoauth.ErrInvalidState) {
		t.Fatalf("expected expiry rejection, got %v", err)
	}
	flow.ExpiresAt = time.Now().Add(-time.Minute)
	if err := repo.Create(t.Context(), flow); !errors.Is(err, domainoauth.ErrInvalidState) {
		t.Fatalf("expected expired write rejection, got %v", err)
	}
	server.SetError("fixture outage")
	if _, err := repo.Consume(t.Context(), flow); err == nil || errors.Is(err, domainoauth.ErrInvalidState) {
		t.Fatalf("expected infrastructure failure, got %v", err)
	}
}
