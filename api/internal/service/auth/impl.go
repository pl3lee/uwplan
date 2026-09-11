package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	domainsession "github.com/pl3lee/uwplan/api/internal/domain/session"
	domainuser "github.com/pl3lee/uwplan/api/internal/domain/user"
)

type AuthServiceImpl struct {
	users    UserRepository
	sessions SessionRepository
	ttl      time.Duration
}

func NewAuthService(users UserRepository, sessions SessionRepository, ttl time.Duration) (*AuthServiceImpl, error) {
	if ttl <= 0 {
		return nil, errors.New("session lifetime must be positive")
	}
	return &AuthServiceImpl{users: users, sessions: sessions, ttl: ttl}, nil
}

func (s *AuthServiceImpl) Login(ctx context.Context, identity domainuser.Identity) (domainsession.Grant, error) {
	if err := identity.Validate(); err != nil {
		return domainsession.Grant{}, err
	}
	person, err := s.users.ResolveAccount(ctx, domainuser.NewProvisioning(identity, time.Now()))
	if err != nil {
		return domainsession.Grant{}, fmt.Errorf("resolve account: %w", err)
	}
	token := make([]byte, 32)
	if _, err = rand.Read(token); err != nil {
		return domainsession.Grant{}, fmt.Errorf("generate session credential: %w", err)
	}
	credentials := domainsession.Credentials{Token: base64.RawURLEncoding.EncodeToString(token)}
	id, err := uuid.NewV7()
	if err != nil {
		return domainsession.Grant{}, fmt.Errorf("generate session ID: %w", err)
	}
	now := time.Now().UTC()
	value := domainsession.Session{ID: id.String(), UserID: person.ID, TokenHash: credentials.Hash(), CreatedAt: now, ExpiresAt: now.Add(s.ttl)}
	if err = s.sessions.Create(ctx, value); err != nil {
		return domainsession.Grant{}, fmt.Errorf("create login session: %w", err)
	}
	return domainsession.Grant{User: person, Session: value, Credentials: credentials}, nil
}

func (s *AuthServiceImpl) Authenticate(ctx context.Context, credentials domainsession.Credentials) (domainuser.User, error) {
	if !credentials.Valid() {
		return domainuser.User{}, domainsession.ErrInvalid
	}
	value, err := s.sessions.Get(ctx, domainsession.Session{TokenHash: credentials.Hash()})
	if err != nil {
		return domainuser.User{}, fmt.Errorf("authenticate session: %w", err)
	}
	if !value.IsActive(time.Now()) {
		return domainuser.User{}, domainsession.ErrInvalid
	}
	person, err := s.users.GetUser(ctx, domainuser.User{ID: value.UserID})
	if errors.Is(err, domainuser.ErrNotFound) {
		return domainuser.User{}, domainsession.ErrInvalid
	}
	if err != nil {
		return domainuser.User{}, fmt.Errorf("authenticate user: %w", err)
	}
	return person, nil
}
func (s *AuthServiceImpl) Logout(ctx context.Context, credentials domainsession.Credentials) error {
	if !credentials.Valid() {
		return nil
	}
	if err := s.sessions.Revoke(ctx, domainsession.Session{TokenHash: credentials.Hash()}); err != nil {
		return fmt.Errorf("revoke login session: %w", err)
	}
	return nil
}
