package api

import (
	"context"

	"github.com/pl3lee/uwplan/api/internal/domain/health"
	"github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

type AuthService interface {
	Authenticate(context.Context, session.Credentials) (user.User, error)
	Logout(context.Context, session.Credentials) error
}

type HealthGateway interface {
	Check(context.Context) health.Report
}

type OAuthService interface {
	Begin(context.Context, oauth.Start) (oauth.Redirect, error)
	Complete(context.Context, oauth.Callback) (oauth.Login, error)
}
