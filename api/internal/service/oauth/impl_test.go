package oauth

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	domainoauth "github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/stretchr/testify/mock"
)

func TestBeginBindsRedirectToStoredChallenge(t *testing.T) {
	t.Parallel()
	repository := NewOAuthRepositoryMock(t)
	gateway := NewOAuthGatewayMock(t)
	auth := NewAuthServiceMock(t)
	var authorization domainoauth.Authorization
	gateway.EXPECT().AuthorizationURL(mock.Anything, mock.Anything).RunAndReturn(func(_ context.Context, input domainoauth.Authorization) (domainoauth.Redirect, error) {
		authorization = input
		return domainoauth.Redirect{URL: "https://provider.example/authorize"}, nil
	}).Once()
	var stored domainoauth.Flow
	repository.EXPECT().Create(mock.Anything, mock.Anything).RunAndReturn(func(_ context.Context, input domainoauth.Flow) error { stored = input; return nil }).Once()
	service := NewOAuthService(repository, gateway, auth)
	before := time.Now()
	result, err := service.Begin(t.Context(), domainoauth.Start{Provider: user.Google, ReturnTo: "/schedule"})
	if err != nil {
		t.Fatal(err)
	}
	if !(session.Credentials{Token: result.State}).Valid() {
		t.Fatal("state must contain 256 random bits")
	}
	if !(session.Credentials{Token: stored.Nonce}).Valid() {
		t.Fatal("nonce must contain 256 random bits")
	}
	if len(stored.Verifier) < 43 {
		t.Fatal("PKCE verifier too short")
	}
	if stored.ExpiresAt.Before(before.Add(domainoauth.Lifetime)) || stored.ExpiresAt.After(time.Now().Add(domainoauth.Lifetime)) {
		t.Fatal("incorrect state expiry")
	}
	want := domainoauth.Flow{StateHash: session.Credentials{Token: result.State}.Hash(), Provider: user.Google, Verifier: stored.Verifier, Nonce: stored.Nonce, ReturnTo: "/schedule", ExpiresAt: result.ExpiresAt}
	if diff := cmp.Diff(want, stored); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff(domainoauth.Authorization{Flow: want, State: result.State}, authorization); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff("https://provider.example/authorize", result.URL); diff != "" {
		t.Fatal(diff)
	}
}

func TestCallbackIsBoundToBrowserAndProvider(t *testing.T) {
	t.Parallel()
	state := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	identity := user.Identity{Provider: user.Google, Subject: "legacy-subject", Email: "person@example.test"}
	grant := session.Grant{User: user.User{ID: "legacy-user", Role: user.RoleUser}, Credentials: session.Credentials{Token: "new-session"}}
	active := domainoauth.Flow{StateHash: session.Credentials{Token: state}.Hash(), Provider: user.Google, Verifier: "verifier", Nonce: "nonce", ReturnTo: "/schedule", ExpiresAt: time.Now().UTC().Add(time.Minute)}
	otherProvider := active
	otherProvider.Provider = user.GitHub
	expired := active
	expired.ExpiresAt = time.Now().Add(-time.Minute)
	infrastructure := errors.New("dependency unavailable")
	for _, tc := range []struct {
		name, browserState                        string
		flow                                      domainoauth.Flow
		consume, exchange, login                  bool
		storageErr, gatewayErr, loginErr, wantErr error
	}{
		{name: "valid", browserState: state, flow: active, consume: true, exchange: true, login: true},
		{name: "wrong browser", browserState: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE", wantErr: domainoauth.ErrInvalidState},
		{name: "missing cookie", wantErr: domainoauth.ErrInvalidState},
		{name: "wrong provider", browserState: state, flow: otherProvider, consume: true, wantErr: domainoauth.ErrInvalidState},
		{name: "expired flow", browserState: state, flow: expired, consume: true, wantErr: domainoauth.ErrInvalidState},
		{name: "already consumed", browserState: state, consume: true, storageErr: domainoauth.ErrInvalidState, wantErr: domainoauth.ErrInvalidState},
		{name: "storage outage", browserState: state, consume: true, storageErr: infrastructure, wantErr: infrastructure},
		{name: "provider rejection", browserState: state, flow: active, consume: true, exchange: true, gatewayErr: infrastructure, wantErr: infrastructure},
		{name: "account not linked", browserState: state, flow: active, consume: true, exchange: true, login: true, loginErr: user.ErrAccountNotLinked, wantErr: user.ErrAccountNotLinked},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			repository := NewOAuthRepositoryMock(t)
			gateway := NewOAuthGatewayMock(t)
			auth := NewAuthServiceMock(t)
			if tc.consume {
				repository.EXPECT().Consume(mock.Anything, domainoauth.Flow{StateHash: active.StateHash}).Return(tc.flow, tc.storageErr).Once()
			}
			if tc.exchange {
				gateway.EXPECT().Exchange(mock.Anything, domainoauth.Exchange{Flow: tc.flow, Code: "code"}).Return(identity, tc.gatewayErr).Once()
			}
			if tc.login {
				auth.EXPECT().Login(mock.Anything, identity).Return(grant, tc.loginErr).Once()
			}
			service := NewOAuthService(repository, gateway, auth)
			got, err := service.Complete(t.Context(), domainoauth.Callback{Provider: user.Google, State: state, BrowserState: tc.browserState, Code: "code"})
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("expected %v, got %v", tc.wantErr, err)
			}
			want := domainoauth.Login{}
			if tc.wantErr == nil {
				want = domainoauth.Login{Grant: grant, ReturnTo: "/schedule"}
			}
			if diff := cmp.Diff(want, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestCallbackRevokesPreviousBrowserSession(t *testing.T) {
	t.Parallel()
	state := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	previous := session.Credentials{Token: state}
	flow := domainoauth.Flow{StateHash: previous.Hash(), Provider: user.Google, ReturnTo: "/select", ExpiresAt: time.Now().Add(time.Minute)}
	identity := user.Identity{Provider: user.Google, Subject: "subject", Email: "person@example.test"}
	grant := session.Grant{User: user.User{ID: "person"}, Credentials: session.Credentials{Token: "new-session"}}
	for _, failure := range []error{nil, errors.New("revocation unavailable")} {
		t.Run(fmt.Sprint(failure), func(t *testing.T) {
			t.Parallel()
			repository := NewOAuthRepositoryMock(t)
			gateway := NewOAuthGatewayMock(t)
			auth := NewAuthServiceMock(t)
			repository.EXPECT().Consume(mock.Anything, domainoauth.Flow{StateHash: flow.StateHash}).Return(flow, nil).Once()
			gateway.EXPECT().Exchange(mock.Anything, domainoauth.Exchange{Flow: flow, Code: "code"}).Return(identity, nil).Once()
			auth.EXPECT().Login(mock.Anything, identity).Return(grant, nil).Once()
			auth.EXPECT().Logout(mock.Anything, previous).Return(failure).Once()
			service := NewOAuthService(repository, gateway, auth)
			got, err := service.Complete(t.Context(), domainoauth.Callback{Provider: user.Google, State: state, BrowserState: state, Code: "code", PreviousSession: previous})
			if !errors.Is(err, failure) {
				t.Fatalf("expected %v, got %v", failure, err)
			}
			want := domainoauth.Login{}
			if failure == nil {
				want = domainoauth.Login{Grant: grant, ReturnTo: "/select"}
			}
			if diff := cmp.Diff(want, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
