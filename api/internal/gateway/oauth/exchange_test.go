package oauth_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/google/go-cmp/cmp"
	domainoauth "github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	gatewayoauth "github.com/pl3lee/uwplan/api/internal/gateway/oauth"
)

type redirectTransport struct {
	target    *url.URL
	transport http.RoundTripper
}

func (r redirectTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme, clone.URL.Host = r.target.Scheme, r.target.Host
	return r.transport.RoundTrip(clone)
}

func TestGitHubExchangeUsesStableIDAndVerifiedEmail(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name     string
		verified bool
	}{{"verified", true}, {"unverified", false}} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/login/oauth/access_token":
					if err := r.ParseForm(); err != nil {
						t.Error(err)
					}
					want := url.Values{"client_id": {"client"}, "client_secret": {"secret"}, "code": {"code"}, "code_verifier": {"verifier"}, "grant_type": {"authorization_code"}, "redirect_uri": {"https://uwplan.com/api/auth/callback/github"}}
					if diff := cmp.Diff(want, r.PostForm); diff != "" {
						t.Error(diff)
					}
					json.NewEncoder(w).Encode(map[string]string{"access_token": "test-access-token", "token_type": "bearer"})
				case "/user":
					if diff := cmp.Diff("Bearer test-access-token", r.Header.Get("Authorization")); diff != "" {
						t.Error(diff)
					}
					w.Write([]byte(`{"id":123456,"login":"test-login","name":null,"avatar_url":"https://avatars.githubusercontent.com/u/123456","email":"untrusted@example.test"}`))
				case "/user/emails":
					if diff := cmp.Diff("Bearer test-access-token", r.Header.Get("Authorization")); diff != "" {
						t.Error(diff)
					}
					json.NewEncoder(w).Encode([]map[string]any{{"email": "verified@example.test", "verified": tc.verified, "primary": true}})
				default:
					t.Errorf("unexpected path %s", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			target, _ := url.Parse(server.URL)
			client := &http.Client{Transport: redirectTransport{target, http.DefaultTransport}}
			gateway := gatewayoauth.NewOAuthGateway(gatewayoauth.Options{PublicOrigin: "https://uwplan.com", GitHub: gatewayoauth.Credentials{ClientID: "client", ClientSecret: "secret"}}, client)
			identity, err := gateway.Exchange(t.Context(), domainoauth.Exchange{Flow: domainoauth.Flow{Provider: user.GitHub, Verifier: "verifier"}, Code: "code", Issuer: "https://github.com/login/oauth"})
			if !tc.verified {
				if !errors.Is(err, user.ErrInvalidIdentity) {
					t.Fatalf("got %v", err)
				}
				if diff := cmp.Diff(user.Identity{}, identity); diff != "" {
					t.Fatal(diff)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			name, image := "test-login", "https://avatars.githubusercontent.com/u/123456"
			want := user.Identity{Provider: user.GitHub, Subject: "123456", Email: "verified@example.test", Name: &name, Image: &image}
			if diff := cmp.Diff(want, identity); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
