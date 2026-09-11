package oauth

import (
	"context"
	domainoauth "github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

type OAuthRepository interface {
	Create(context.Context, domainoauth.Flow) error
	Consume(context.Context, domainoauth.Flow) (domainoauth.Flow, error)
}
type OAuthGateway interface {
	AuthorizationURL(context.Context, domainoauth.Authorization) (domainoauth.Redirect, error)
	Exchange(context.Context, domainoauth.Exchange) (user.Identity, error)
}
type AuthService interface {
	Login(context.Context, user.Identity) (session.Grant, error)
	Logout(context.Context, session.Credentials) error
}
