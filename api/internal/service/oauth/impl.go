package oauth

import (
	"context"
	"crypto/subtle"
	"fmt"
	domainoauth "github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"golang.org/x/oauth2"
	"strings"
	"time"
)

type OAuthServiceImpl struct {
	repository OAuthRepository
	gateway    OAuthGateway
	auth       AuthService
}

func NewOAuthService(repository OAuthRepository, gateway OAuthGateway, auth AuthService) *OAuthServiceImpl {
	return &OAuthServiceImpl{repository: repository, gateway: gateway, auth: auth}
}
func (s *OAuthServiceImpl) Begin(ctx context.Context, input domainoauth.Start) (domainoauth.Redirect, error) {
	if input.Provider != user.Google && input.Provider != user.GitHub {
		return domainoauth.Redirect{}, domainoauth.ErrProviderUnavailable
	}
	returnTo, err := domainoauth.ReturnPath(input.ReturnTo)
	if err != nil {
		return domainoauth.Redirect{}, err
	}
	state := oauth2.GenerateVerifier()
	flow := domainoauth.Flow{StateHash: session.Credentials{Token: state}.Hash(), Provider: input.Provider, Verifier: oauth2.GenerateVerifier(), Nonce: oauth2.GenerateVerifier(), ReturnTo: returnTo, ExpiresAt: time.Now().UTC().Add(domainoauth.Lifetime)}
	redirect, err := s.gateway.AuthorizationURL(ctx, domainoauth.Authorization{Flow: flow, State: state})
	if err != nil {
		return domainoauth.Redirect{}, fmt.Errorf("create authorization redirect: %w", err)
	}
	if err = s.repository.Create(ctx, flow); err != nil {
		return domainoauth.Redirect{}, fmt.Errorf("store authorization flow: %w", err)
	}
	redirect.State = state
	redirect.ExpiresAt = flow.ExpiresAt
	return redirect, nil
}
func (s *OAuthServiceImpl) Complete(ctx context.Context, input domainoauth.Callback) (domainoauth.Login, error) {
	state := session.Credentials{Token: input.State}
	if !state.Valid() || subtle.ConstantTimeCompare([]byte(input.State), []byte(input.BrowserState)) != 1 || strings.TrimSpace(input.Code) == "" {
		return domainoauth.Login{}, domainoauth.ErrInvalidState
	}
	flow, err := s.repository.Consume(ctx, domainoauth.Flow{StateHash: state.Hash()})
	if err != nil {
		return domainoauth.Login{}, fmt.Errorf("consume callback state: %w", err)
	}
	if flow.Provider != input.Provider || !time.Now().Before(flow.ExpiresAt) {
		return domainoauth.Login{}, domainoauth.ErrInvalidState
	}
	returnTo, err := domainoauth.ReturnPath(flow.ReturnTo)
	if err != nil {
		return domainoauth.Login{}, err
	}
	identity, err := s.gateway.Exchange(ctx, domainoauth.Exchange{Flow: flow, Code: input.Code, Issuer: input.Issuer})
	if err != nil {
		return domainoauth.Login{}, fmt.Errorf("verify provider identity: %w", err)
	}
	if identity.Provider != flow.Provider {
		return domainoauth.Login{}, user.ErrInvalidIdentity
	}
	grant, err := s.auth.Login(ctx, identity)
	if err != nil {
		return domainoauth.Login{}, fmt.Errorf("create authenticated session: %w", err)
	}
	if input.PreviousSession.Valid() {
		if err = s.auth.Logout(ctx, input.PreviousSession); err != nil {
			return domainoauth.Login{}, fmt.Errorf("revoke previous browser session: %w", err)
		}
	}
	return domainoauth.Login{Grant: grant, ReturnTo: returnTo}, nil
}
