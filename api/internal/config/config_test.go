package config_test

import (
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/health"
)

func TestConfigurationRequiresSecurePublicOrigin(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		origin        string
		secure, valid bool
	}{
		{"https://uwplan.com", true, true},
		{"http://localhost:5000", false, true},
		{"http://127.0.0.1:5000", false, true},
		{"http://uwplan.com", false, false},
		{"https://uwplan.com/path", false, false},
		{"https://user:password@uwplan.com", false, false},
		{"https://uwplan.com?redirect=evil", false, false},
		{"", false, false},
	} {
		t.Run(tc.origin, func(t *testing.T) {
			t.Parallel()
			values := map[string]string{"DATABASE_URL": "postgres://fixture", "REDIS_URL": "redis://fixture", "PUBLIC_ORIGIN": tc.origin}
			got, err := config.Load(func(key string) string { return values[key] })
			if !tc.valid {
				if err == nil {
					t.Fatal("expected configuration rejection")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			want := config.Config{HTTPAddress: ":8080", DatabaseURL: values["DATABASE_URL"], RedisURL: values["REDIS_URL"], PublicOrigin: tc.origin, SecureCookies: tc.secure, SessionTTL: 30 * 24 * time.Hour, Release: health.Release{Digest: "unavailable", Revision: "unknown"}}
			if diff := cmp.Diff(want, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
