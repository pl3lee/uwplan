package admin_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	service "github.com/pl3lee/uwplan/api/internal/service/admin"
	"github.com/stretchr/testify/mock"
)

func TestOnlyIdentifiedAdminsCanListUsers(t *testing.T) {
	t.Parallel()
	for _, actor := range []user.User{{}, {Role: user.RoleAdmin}, {ID: "student", Role: user.RoleUser}, {ID: "moderator", Role: user.RoleModerator}} {
		t.Run(actor.ID+string(actor.Role), func(t *testing.T) {
			t.Parallel()
			repo := service.NewUserRepositoryMock(t)
			_, err := service.NewAdminService(repo).ListUsers(t.Context(), actor)
			if !errors.Is(err, user.ErrForbidden) {
				t.Fatalf("got %v", err)
			}
		})
	}
}

func TestAdminListPreservesProfilesAndStorageErrors(t *testing.T) {
	t.Parallel()
	repo := service.NewUserRepositoryMock(t)
	svc := service.NewAdminService(repo)
	actor := user.User{ID: "admin", Role: user.RoleAdmin}
	want := []user.User{{ID: "legacy-user", Email: "student@example.test", Role: user.RoleUser}}
	repo.EXPECT().List(mock.Anything).Return(want, nil).Once()
	got, err := svc.ListUsers(t.Context(), actor)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	unavailable := errors.New("database unavailable")
	repo.EXPECT().List(mock.Anything).Return(nil, unavailable).Once()
	if _, err := svc.ListUsers(t.Context(), actor); !errors.Is(err, unavailable) {
		t.Fatalf("got %v", err)
	}
}
