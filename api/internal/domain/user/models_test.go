package user_test

import (
	"errors"
	"strings"
	"testing"

	domainuser "github.com/pl3lee/uwplan/api/internal/domain/user"
)

func TestIdentityValidation(t *testing.T) {
	t.Parallel()
	longName := strings.Repeat("x", 256)
	for _, tc := range []struct {
		name     string
		identity domainuser.Identity
		want     error
	}{
		{"google", domainuser.Identity{Provider: domainuser.Google, Subject: "stable", Email: "user@example.test"}, nil},
		{"github", domainuser.Identity{Provider: domainuser.GitHub, Subject: "42", Email: "user@example.test"}, nil},
		{"unknown provider", domainuser.Identity{Provider: "unknown", Subject: "stable", Email: "user@example.test"}, domainuser.ErrInvalidIdentity},
		{"missing subject", domainuser.Identity{Provider: domainuser.Google, Email: "user@example.test"}, domainuser.ErrInvalidIdentity},
		{"invalid email", domainuser.Identity{Provider: domainuser.Google, Subject: "stable", Email: "person"}, domainuser.ErrInvalidIdentity},
		{"display address", domainuser.Identity{Provider: domainuser.Google, Subject: "stable", Email: "Person <user@example.test>"}, domainuser.ErrInvalidIdentity},
		{"long profile", domainuser.Identity{Provider: domainuser.Google, Subject: "stable", Email: "user@example.test", Name: &longName}, domainuser.ErrInvalidIdentity},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if err := tc.identity.Validate(); !errors.Is(err, tc.want) {
				t.Fatalf("expected %v, got %v", tc.want, err)
			}
		})
	}
}
