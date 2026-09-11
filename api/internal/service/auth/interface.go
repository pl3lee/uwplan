package auth

import (
	"context"
	domainsession "github.com/pl3lee/uwplan/api/internal/domain/session"
	domainuser "github.com/pl3lee/uwplan/api/internal/domain/user"
)

type UserRepository interface {
	ResolveAccount(context.Context, domainuser.Provisioning) (domainuser.User, error)
	GetUser(context.Context, domainuser.User) (domainuser.User, error)
}

type SessionRepository interface {
	Create(context.Context, domainsession.Session) error
	Get(context.Context, domainsession.Session) (domainsession.Session, error)
	Revoke(context.Context, domainsession.Session) error
}
