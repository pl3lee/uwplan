package api

import (
	"context"
	"errors"
	"github.com/danielgtaylor/huma/v2"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"net/http"
	"time"
)

type OAuthStartInput struct {
	Provider string `path:"provider" enum:"google,github"`
	ReturnTo string `query:"return_to" maxLength:"2048"`
}
type OAuthRedirectResponse struct {
	Location  string        `header:"Location"`
	SetCookie []http.Cookie `header:"Set-Cookie"`
}

type OAuthCallbackInput struct {
	Provider string `path:"provider" enum:"google,github"`
	Code     string `query:"code" maxLength:"4096"`
	State    string `query:"state" maxLength:"128"`
	Issuer   string `query:"iss" maxLength:"256"`
	Error    string `query:"error" maxLength:"256"`
}

func oauthCookieName(cfg config.Config, provider user.Provider) string {
	name := "uwplan_oauth_" + string(provider)
	if cfg.SecureCookies {
		name = "__Host-" + name
	}
	return name
}

func registerOAuth(app huma.API, cfg config.Config, service OAuthService) {
	huma.Register(app, huma.Operation{OperationID: "startOAuth", Method: http.MethodGet, Path: "/api/auth/signin/{provider}", Summary: "Start provider sign-in", DefaultStatus: http.StatusFound, Errors: []int{400, 500, 503}}, func(ctx context.Context, input *OAuthStartInput) (*OAuthRedirectResponse, error) {
		if service == nil {
			return nil, huma.Error503ServiceUnavailable("Provider unavailable")
		}
		redirect, err := service.Begin(ctx, oauth.Start{Provider: user.Provider(input.Provider), ReturnTo: input.ReturnTo})
		if errors.Is(err, oauth.ErrProviderUnavailable) {
			return nil, huma.Error503ServiceUnavailable("Provider unavailable")
		}
		if errors.Is(err, oauth.ErrInvalidReturnPath) {
			return nil, huma.Error400BadRequest("Invalid return path")
		}
		if err != nil {
			return nil, internalError(ctx, err)
		}
		cookie := http.Cookie{Name: oauthCookieName(cfg, user.Provider(input.Provider)), Value: redirect.State, Path: "/", Expires: redirect.ExpiresAt, MaxAge: int(oauth.Lifetime.Seconds()), Secure: cfg.SecureCookies, HttpOnly: true, SameSite: http.SameSiteLaxMode}
		return &OAuthRedirectResponse{Location: redirect.URL, SetCookie: []http.Cookie{cookie}}, nil
	})
	huma.Register(app, huma.Operation{OperationID: "completeOAuth", Method: http.MethodGet, Path: "/api/auth/callback/{provider}", Summary: "Complete provider sign-in", Description: "Requires the matching browser state cookie. Invalid callbacks redirect to sign-in without creating a session.", DefaultStatus: http.StatusFound}, func(ctx context.Context, input *OAuthCallbackInput) (*OAuthRedirectResponse, error) {
		provider := user.Provider(input.Provider)
		response := &OAuthRedirectResponse{Location: "/signin?error=OAuthCallback", SetCookie: []http.Cookie{{Name: oauthCookieName(cfg, provider), Path: "/", Expires: time.Unix(1, 0).UTC(), MaxAge: -1, HttpOnly: true, Secure: cfg.SecureCookies, SameSite: http.SameSiteLaxMode}}}
		if service == nil || input.Error != "" {
			return response, nil
		}
		request := getRequest(ctx)
		login, err := service.Complete(ctx, oauth.Callback{Provider: provider, Code: input.Code, State: input.State, BrowserState: request.OAuthStates[provider], Issuer: input.Issuer, PreviousSession: request.Credentials})
		if err != nil {
			if errors.Is(err, user.ErrAccountNotLinked) {
				response.Location = "/signin?error=OAuthAccountNotLinked"
			} else if !errors.Is(err, oauth.ErrInvalidState) && !errors.Is(err, oauth.ErrInvalidReturnPath) && !errors.Is(err, user.ErrInvalidIdentity) && !errors.Is(err, oauth.ErrProviderUnavailable) {
				return nil, huma.ErrorWithHeaders(internalError(ctx, err), http.Header{"Set-Cookie": {response.SetCookie[0].String()}})
			}
			return response, nil
		}
		response.Location = login.ReturnTo
		response.SetCookie = append(response.SetCookie, http.Cookie{Name: cfg.CookieName(), Value: login.Grant.Credentials.Token, Path: "/", Expires: login.Grant.Session.ExpiresAt, MaxAge: int(cfg.SessionTTL.Seconds()), HttpOnly: true, Secure: cfg.SecureCookies, SameSite: http.SameSiteLaxMode})
		return response, nil
	})
}
