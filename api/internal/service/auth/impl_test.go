package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	domainsession "github.com/pl3lee/uwplan/api/internal/domain/session"
	domainuser "github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/stretchr/testify/mock"
)

func TestLoginStoresOnlyHashedCredential(t *testing.T) {
	t.Parallel()
	users := NewUserRepositoryMock(t)
	sessions := NewSessionRepositoryMock(t)
	identity := domainuser.Identity{Provider: domainuser.Google, Subject: "subject", Email: "person@example.test"}
	person := domainuser.User{ID: "legacy-person", Email: identity.Email, Role: domainuser.RoleUser}
	users.EXPECT().ResolveAccount(mock.Anything, domainuser.NewProvisioning(identity, time.Now())).Return(person, nil).Once()
	var stored domainsession.Session
	sessions.EXPECT().Create(mock.Anything, mock.Anything).RunAndReturn(func(_ context.Context, value domainsession.Session) error { stored = value; return nil }).Once()
	service, err := NewAuthService(users, sessions, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	before := time.Now()
	grant, err := service.Login(t.Context(), identity)
	if err != nil {
		t.Fatal(err)
	}
	if !grant.Credentials.Valid() {
		t.Fatal("expected a 256-bit opaque credential")
	}
	if diff := cmp.Diff(person, grant.User); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff(stored, grant.Session); diff != "" {
		t.Fatal(diff)
	}
	expected := domainsession.Session{ID: stored.ID, UserID: person.ID, TokenHash: grant.Credentials.Hash(), CreatedAt: stored.CreatedAt, ExpiresAt: stored.CreatedAt.Add(24 * time.Hour)}
	if diff := cmp.Diff(expected, stored); diff != "" {
		t.Fatal(diff)
	}
	id, err := uuid.Parse(stored.ID)
	if err != nil || id.Version() != 7 {
		t.Fatalf("expected UUIDv7 session ID, got %q", stored.ID)
	}
	if stored.CreatedAt.Before(before) || stored.CreatedAt.After(time.Now()) {
		t.Fatal("session creation time outside login")
	}
}

func TestAuthenticateKeepsInfrastructureFailuresDistinct(t *testing.T) {
	t.Parallel()
	infrastructure := errors.New("infrastructure failure")
	credentials := domainsession.Credentials{Token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
	person := domainuser.User{ID: "legacy-user", Role: domainuser.RoleAdmin}
	active := domainsession.Session{UserID: person.ID, ExpiresAt: time.Now().Add(time.Hour)}
	expired := domainsession.Session{UserID: person.ID, ExpiresAt: time.Now().Add(-time.Hour)}
	for _, tc := range []struct {
		name                  string
		stored                domainsession.Session
		sessionErr, errorUser error
		want                  domainuser.User
		wantErr               error
		readUser              bool
	}{
		{name: "current role", stored: active, want: person, readUser: true},
		{name: "expired", stored: expired, wantErr: domainsession.ErrInvalid},
		{name: "missing session", sessionErr: domainsession.ErrInvalid, wantErr: domainsession.ErrInvalid},
		{name: "Redis failure", sessionErr: infrastructure, wantErr: infrastructure},
		{name: "removed user", stored: active, errorUser: domainuser.ErrNotFound, wantErr: domainsession.ErrInvalid, readUser: true},
		{name: "database failure", stored: active, errorUser: infrastructure, wantErr: infrastructure, readUser: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			users := NewUserRepositoryMock(t)
			sessions := NewSessionRepositoryMock(t)
			sessions.EXPECT().Get(mock.Anything, domainsession.Session{TokenHash: credentials.Hash()}).Return(tc.stored, tc.sessionErr).Once()
			if tc.readUser {
				users.EXPECT().GetUser(mock.Anything, domainuser.User{ID: person.ID}).Return(person, tc.errorUser).Once()
			}
			service, err := NewAuthService(users, sessions, time.Hour)
			if err != nil {
				t.Fatal(err)
			}
			got, err := service.Authenticate(t.Context(), credentials)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("expected %v, got %v", tc.wantErr, err)
			}
			if diff := cmp.Diff(tc.want, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestLogoutRevokesOnlyPresentedCredential(t *testing.T) {
	t.Parallel()
	credentials := domainsession.Credentials{Token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
	infrastructure := errors.New("Redis unavailable")
	for _, tc := range []struct {
		name        string
		credentials domainsession.Credentials
		revokeErr   error
		revoke      bool
	}{
		{name: "valid", credentials: credentials, revoke: true},
		{name: "missing"},
		{name: "malformed", credentials: domainsession.Credentials{Token: "bad"}},
		{name: "Redis failure", credentials: credentials, revoke: true, revokeErr: infrastructure},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			users := NewUserRepositoryMock(t)
			sessions := NewSessionRepositoryMock(t)
			if tc.revoke {
				sessions.EXPECT().Revoke(mock.Anything, domainsession.Session{TokenHash: tc.credentials.Hash()}).Return(tc.revokeErr).Once()
			}
			service, err := NewAuthService(users, sessions, time.Hour)
			if err != nil {
				t.Fatal(err)
			}
			if err = service.Logout(t.Context(), tc.credentials); !errors.Is(err, tc.revokeErr) {
				t.Fatalf("expected %v, got %v", tc.revokeErr, err)
			}
		})
	}
}

func TestLoginFailureNeverReturnsCredential(t *testing.T) {
	t.Parallel()
	identity := domainuser.Identity{Provider: domainuser.GitHub, Subject: "123", Email: "person@example.test"}
	person := domainuser.User{ID: "legacy-user", Role: domainuser.RoleUser}
	infrastructure := errors.New("Redis unavailable")
	for _, tc := range []struct {
		name                            string
		identity                        domainuser.Identity
		accountErr, sessionErr, wantErr error
		resolve, create                 bool
	}{
		{name: "invalid identity", wantErr: domainuser.ErrInvalidIdentity},
		{name: "unlinked email", identity: identity, accountErr: domainuser.ErrAccountNotLinked, wantErr: domainuser.ErrAccountNotLinked, resolve: true},
		{name: "session write failure", identity: identity, sessionErr: infrastructure, wantErr: infrastructure, resolve: true, create: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			users := NewUserRepositoryMock(t)
			sessions := NewSessionRepositoryMock(t)
			if tc.resolve {
				users.EXPECT().ResolveAccount(mock.Anything, domainuser.NewProvisioning(tc.identity, time.Now())).Return(person, tc.accountErr).Once()
			}
			if tc.create {
				sessions.EXPECT().Create(mock.Anything, mock.Anything).Return(tc.sessionErr).Once()
			}
			service, err := NewAuthService(users, sessions, time.Hour)
			if err != nil {
				t.Fatal(err)
			}
			grant, err := service.Login(t.Context(), tc.identity)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("expected %v, got %v", tc.wantErr, err)
			}
			if diff := cmp.Diff(domainsession.Grant{}, grant); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestMalformedCredentialsDoNotReadStorage(t *testing.T) {
	t.Parallel()
	users := NewUserRepositoryMock(t)
	sessions := NewSessionRepositoryMock(t)
	service, err := NewAuthService(users, sessions, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{"", "bad", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", " AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"} {
		got, err := service.Authenticate(t.Context(), domainsession.Credentials{Token: token})
		if !errors.Is(err, domainsession.ErrInvalid) {
			t.Fatalf("expected invalid credential, got %v", err)
		}
		if diff := cmp.Diff(domainuser.User{}, got); diff != "" {
			t.Fatal(diff)
		}
	}
}
