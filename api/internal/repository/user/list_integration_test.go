//go:build integration

package user_test

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	repository "github.com/pl3lee/uwplan/api/internal/repository/user"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

func TestUserListPreservesLegacyProfilesAndNullableFields(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	repo := repository.NewUserRepository(pool)
	empty, err := repo.List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]user.User{}, empty); diff != "" {
		t.Fatal(diff)
	}
	_, err = pool.Exec(t.Context(), `INSERT INTO "user"(id,email,name,image,role) VALUES ('legacy-student','z@example.test',NULL,NULL,'moderator'),('legacy-admin','a@example.test','Admin','https://example.test/avatar.png','admin');`)
	if err != nil {
		t.Fatal(err)
	}
	name, image := "Admin", "https://example.test/avatar.png"
	want := []user.User{{ID: "legacy-admin", Email: "a@example.test", Name: &name, Image: &image, Role: user.RoleAdmin}, {ID: "legacy-student", Email: "z@example.test", Role: user.RoleModerator}}
	got, err := repo.List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
}
