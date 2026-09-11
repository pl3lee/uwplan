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
		normalized    string
	}{
		{"https://uwplan.com", true, true, ""},
		{"https://UWPLAN.com", true, true, "https://uwplan.com"},
		{"https://uwplan.com:443", true, true, "https://uwplan.com"},
		{"https://uwplan.com:0443", true, true, "https://uwplan.com"},
		{"http://LOCALHOST:80", false, true, "http://localhost"},
		{"http://[::1]:5000", false, true, "http://[::1]:5000"},
		{"http://localhost:5000", false, true, ""},
		{"http://127.0.0.1:5000", false, true, ""},
		{"http://uwplan.com", false, false, ""},
		{"https://uwplan.com/path", false, false, ""},
		{"https://user:password@uwplan.com", false, false, ""},
		{"https://uwplan.com?redirect=evil", false, false, ""},
		{"", false, false, ""},
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
			expectedOrigin := tc.origin
			if tc.normalized != "" {
				expectedOrigin = tc.normalized
			}
			want := config.Config{HTTPAddress: ":8080", DatabaseURL: values["DATABASE_URL"], RedisURL: values["REDIS_URL"], PublicOrigin: expectedOrigin, SecureCookies: tc.secure, SessionTTL: 30 * 24 * time.Hour, Release: health.Release{}}
			if diff := cmp.Diff(want, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestOAuthCredentialsKeepExistingEnvironmentNames(t *testing.T) {
	t.Parallel()
	for _, provider := range []string{"GOOGLE", "GITHUB"} {
		t.Run(provider, func(t *testing.T) {
			t.Parallel()
			values := map[string]string{"DATABASE_URL": "postgres://fixture", "REDIS_URL": "redis://fixture", "PUBLIC_ORIGIN": "https://uwplan.com", "AUTH_" + provider + "_ID": "fixture-id", "AUTH_" + provider + "_SECRET": "fixture-secret"}
			got, err := config.Load(func(key string) string { return values[key] })
			if err != nil {
				t.Fatal(err)
			}
			credentials := got.Google
			if provider == "GITHUB" {
				credentials = got.GitHub
			}
			if diff := cmp.Diff(config.ProviderCredentials{ClientID: "fixture-id", ClientSecret: "fixture-secret"}, credentials); diff != "" {
				t.Fatal(diff)
			}
			delete(values, "AUTH_"+provider+"_SECRET")
			if _, err := config.Load(func(key string) string { return values[key] }); err == nil {
				t.Fatal("partial provider configuration must fail")
			}
		})
	}
}
