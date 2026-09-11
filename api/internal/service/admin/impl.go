package admin

import (
	"context"
	"fmt"

	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

type AdminServiceImpl struct{ users UserRepository }

func NewAdminService(users UserRepository) *AdminServiceImpl {
	return &AdminServiceImpl{users: users}
}

func (s *AdminServiceImpl) ListUsers(ctx context.Context, actor user.User) ([]user.User, error) {
	if actor.ID == "" || !actor.IsAdmin() {
		return nil, user.ErrForbidden
	}
	users, err := s.users.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("list users for administration: %w", err)
	}
	return users, nil
}
