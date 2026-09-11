package oauth_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/oauth"
)

func TestReturnPathStaysInsideApplication(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, input, want string
		valid             bool
	}{
		{"default", "", "/select", true},
		{"schedule", "/schedule?active=legacy-id", "/schedule?active=legacy-id", true},
		{"template creation", "/create/template", "/create/template", true},
		{"absolute URL", "https://evil.example", "", false},
		{"network path", "//evil.example", "", false},
		{"backslash", "/\\evil.example", "", false},
		{"encoded network path", "/%2fevil.example", "", false},
		{"auth callback", "/api/auth/callback/google", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := oauth.ReturnPath(tc.input)
			if tc.valid && err != nil {
				t.Fatal(err)
			}
			if !tc.valid && !errors.Is(err, oauth.ErrInvalidReturnPath) {
				t.Fatalf("expected invalid return path, got %v", err)
			}
			if diff := cmp.Diff(tc.want, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
