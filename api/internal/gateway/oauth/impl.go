package oauth

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"io"
	"net/http"
	"strconv"
	"time"

	domainoauth "github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

type Credentials struct{ ClientID, ClientSecret string }
type Options struct {
	PublicOrigin   string
	Google, GitHub Credentials
}
type OAuthGatewayImpl struct {
	options        Options
	client         *http.Client
	googleVerifier *oidc.IDTokenVerifier
}

func NewOAuthGateway(options Options, client *http.Client) *OAuthGatewayImpl {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	keys := oidc.NewRemoteKeySet(oidc.ClientContext(context.Background(), client), "https://www.googleapis.com/oauth2/v3/certs")
	return &OAuthGatewayImpl{options: options, client: client, googleVerifier: oidc.NewVerifier("https://accounts.google.com", keys, &oidc.Config{ClientID: options.Google.ClientID})}
}
func (g *OAuthGatewayImpl) AuthorizationURL(ctx context.Context, input domainoauth.Authorization) (domainoauth.Redirect, error) {
	config, err := g.providerConfig(input.Flow.Provider)
	if err != nil {
		return domainoauth.Redirect{}, err
	}
	options := []oauth2.AuthCodeOption{oauth2.S256ChallengeOption(input.Flow.Verifier)}
	if input.Flow.Provider == user.Google {
		options = append(options, oauth2.SetAuthURLParam("nonce", input.Flow.Nonce))
	}
	return domainoauth.Redirect{URL: config.AuthCodeURL(input.State, options...)}, nil
}

func (g *OAuthGatewayImpl) providerConfig(provider user.Provider) (*oauth2.Config, error) {
	var credentials Credentials
	config := &oauth2.Config{RedirectURL: g.options.PublicOrigin + "/api/auth/callback/" + string(provider)}
	switch provider {
	case user.Google:
		credentials = g.options.Google
		config.Endpoint = oauth2.Endpoint{AuthURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token", AuthStyle: oauth2.AuthStyleInParams}
		config.Scopes = []string{"openid", "profile", "email"}
	case user.GitHub:
		credentials = g.options.GitHub
		config.Endpoint = oauth2.Endpoint{AuthURL: "https://github.com/login/oauth/authorize", TokenURL: "https://github.com/login/oauth/access_token", AuthStyle: oauth2.AuthStyleInParams}
		config.Scopes = []string{"read:user", "user:email"}
	default:
		return nil, domainoauth.ErrProviderUnavailable
	}
	if credentials.ClientID == "" || credentials.ClientSecret == "" {
		return nil, domainoauth.ErrProviderUnavailable
	}
	config.ClientID, config.ClientSecret = credentials.ClientID, credentials.ClientSecret
	return config, nil
}
func (g *OAuthGatewayImpl) Exchange(ctx context.Context, input domainoauth.Exchange) (user.Identity, error) {
	config, err := g.providerConfig(input.Flow.Provider)
	if err != nil {
		return user.Identity{}, err
	}
	issuer := "https://accounts.google.com"
	if input.Flow.Provider == user.GitHub {
		issuer = "https://github.com/login/oauth"
	}
	if input.Issuer != "" && input.Issuer != issuer {
		return user.Identity{}, user.ErrInvalidIdentity
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, g.client)
	token, err := config.Exchange(ctx, input.Code, oauth2.VerifierOption(input.Flow.Verifier))
	if err != nil {
		return user.Identity{}, fmt.Errorf("exchange OAuth code: %w", err)
	}
	if input.Flow.Provider == user.GitHub {
		return g.githubIdentity(ctx, token.AccessToken)
	}
	return g.googleIdentity(ctx, token, input.Flow.Nonce)
}

func (g *OAuthGatewayImpl) googleIdentity(ctx context.Context, token *oauth2.Token, nonce string) (user.Identity, error) {
	raw, ok := token.Extra("id_token").(string)
	if !ok || raw == "" {
		return user.Identity{}, user.ErrInvalidIdentity
	}
	idToken, err := g.googleVerifier.Verify(ctx, raw)
	if err != nil {
		return user.Identity{}, user.ErrInvalidIdentity
	}
	if nonce == "" || subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(nonce)) != 1 {
		return user.Identity{}, user.ErrInvalidIdentity
	}
	var claims struct {
		Email           string  `json:"email"`
		EmailVerified   bool    `json:"email_verified"`
		Name            *string `json:"name"`
		Image           *string `json:"picture"`
		AuthorizedParty string  `json:"azp"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return user.Identity{}, user.ErrInvalidIdentity
	}
	if !claims.EmailVerified || (claims.AuthorizedParty != "" && claims.AuthorizedParty != g.options.Google.ClientID) {
		return user.Identity{}, user.ErrInvalidIdentity
	}
	if idToken.AccessTokenHash != "" {
		if err := idToken.VerifyAccessToken(token.AccessToken); err != nil {
			return user.Identity{}, user.ErrInvalidIdentity
		}
	}
	identity := user.Identity{Provider: user.Google, Subject: idToken.Subject, Email: claims.Email, Name: claims.Name, Image: claims.Image}
	if err := identity.Validate(); err != nil {
		return user.Identity{}, err
	}
	return identity, nil
}

func (g *OAuthGatewayImpl) githubIdentity(ctx context.Context, token string) (user.Identity, error) {
	var profile struct {
		ID    int64   `json:"id"`
		Login string  `json:"login"`
		Name  *string `json:"name"`
		Image *string `json:"avatar_url"`
	}
	if err := g.githubJSON(ctx, "https://api.github.com/user", token, &profile); err != nil {
		return user.Identity{}, err
	}
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := g.githubJSON(ctx, "https://api.github.com/user/emails", token, &emails); err != nil {
		return user.Identity{}, err
	}
	email := ""
	for _, candidate := range emails {
		if candidate.Verified && (email == "" || candidate.Primary) {
			email = candidate.Email
			if candidate.Primary {
				break
			}
		}
	}
	if profile.ID <= 0 || email == "" {
		return user.Identity{}, user.ErrInvalidIdentity
	}
	if profile.Name == nil || *profile.Name == "" {
		profile.Name = &profile.Login
	}
	identity := user.Identity{Provider: user.GitHub, Subject: strconv.FormatInt(profile.ID, 10), Email: email, Name: profile.Name, Image: profile.Image}
	if err := identity.Validate(); err != nil {
		return user.Identity{}, err
	}
	return identity, nil
}

func (g *OAuthGatewayImpl) githubJSON(ctx context.Context, endpoint, token string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create GitHub request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "UWPlan")
	response, err := g.client.Do(req)
	if err != nil {
		return fmt.Errorf("request GitHub identity: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub identity response status %d", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(target); err != nil {
		return fmt.Errorf("decode GitHub identity: %w", err)
	}
	return nil
}
