package health_test

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/health"
)

func TestReleaseIdentityValidationAndRedaction(t *testing.T) {
	t.Parallel()
	digest := "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	for _, tc := range []struct {
		name        string
		input, want health.Release
		valid       bool
	}{
		{"valid", health.Release{Digest: digest, Revision: "release-v1.2"}, health.Release{Digest: digest, Revision: "release-v1.2"}, true},
		{"missing", health.Release{}, health.Release{Digest: "unavailable", Revision: "unknown"}, false},
		{"bad digest", health.Release{Digest: "credential-sentinel", Revision: "revision"}, health.Release{Digest: "unavailable", Revision: "revision"}, false},
		{"bad revision", health.Release{Digest: digest, Revision: "https://credential-sentinel"}, health.Release{Digest: digest, Revision: "unknown"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, valid := tc.input.Public()
			if diff := cmp.Diff(tc.want, got); diff != "" {
				t.Fatal(diff)
			}
			if diff := cmp.Diff(tc.valid, valid); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
