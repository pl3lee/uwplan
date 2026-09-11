package admin

import (
	"context"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

type UserRepository interface {
	List(context.Context) ([]user.User, error)
}
