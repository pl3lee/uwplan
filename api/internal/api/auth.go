package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
)

type UserBody struct {
	ID    string  `json:"id"`
	Email string  `json:"email"`
	Name  *string `json:"name"`
	Image *string `json:"image"`
	Role  string  `json:"role" enum:"user,moderator,admin"`
}
type UserResponse struct{ Body UserBody }
type LogoutResponse struct {
	SetCookie http.Cookie `header:"Set-Cookie"`
}

func registerAuth(app huma.API, cfg config.Config, service AuthService) {
	huma.Register(app, huma.Operation{OperationID: "getCurrentUser", Method: http.MethodGet, Path: "/api/v1/me", Summary: "Get the signed-in user", Security: []map[string][]string{{"session": {}}}, Errors: []int{401, 500}}, func(ctx context.Context, input *struct{}) (*UserResponse, error) {
		credentials := getRequest(ctx).Credentials
		if !credentials.Valid() {
			return nil, huma.Error401Unauthorized("Unauthorized")
		}
		person, err := service.Authenticate(ctx, credentials)
		if errors.Is(err, session.ErrInvalid) {
			return nil, huma.Error401Unauthorized("Unauthorized")
		}
		if err != nil {
			return nil, internalError(ctx, err)
		}
		return &UserResponse{Body: UserBody{ID: person.ID, Email: person.Email, Name: person.Name, Image: person.Image, Role: string(person.Role)}}, nil
	})
	huma.Register(app, huma.Operation{OperationID: "logout", Method: http.MethodPost, Path: "/api/v1/auth/logout", Summary: "Revoke the current session", Description: "Requires the configured public origin in the Origin header. Expired sessions can be logged out again.", Security: []map[string][]string{{"session": {}}, {}}, Errors: []int{403, 500}}, func(ctx context.Context, input *struct{}) (*LogoutResponse, error) {
		request := getRequest(ctx)
		if request.Origin == "" || request.Origin != cfg.PublicOrigin || request.FetchSite == "cross-site" {
			return nil, huma.Error403Forbidden("Forbidden")
		}
		if err := service.Logout(ctx, request.Credentials); err != nil {
			return nil, internalError(ctx, err)
		}
		return &LogoutResponse{SetCookie: http.Cookie{Name: cfg.CookieName(), Path: "/", MaxAge: -1, Expires: time.Unix(1, 0).UTC(), HttpOnly: true, Secure: cfg.SecureCookies, SameSite: http.SameSiteLaxMode}}, nil
	})
}
