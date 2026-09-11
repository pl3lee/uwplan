package oauth_test

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/google/go-cmp/cmp"
	domainoauth "github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	gatewayoauth "github.com/pl3lee/uwplan/api/internal/gateway/oauth"
	"golang.org/x/oauth2"
)

func TestAuthorizationUsesPKCEStateAndBoundCallback(t *testing.T) {
	t.Parallel()
	for _, provider := range []user.Provider{user.Google, user.GitHub} {
		t.Run(string(provider), func(t *testing.T) {
			t.Parallel()
			credentials := gatewayoauth.Credentials{ClientID: "client", ClientSecret: "secret"}
			gateway := gatewayoauth.NewOAuthGateway(gatewayoauth.Options{PublicOrigin: "https://uwplan.com", Google: credentials, GitHub: credentials}, http.DefaultClient)
			flow := domainoauth.Flow{Provider: provider, Verifier: "test-verifier", Nonce: "test-nonce"}
			redirect, err := gateway.AuthorizationURL(t.Context(), domainoauth.Authorization{Flow: flow, State: "browser-state"})
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := url.Parse(redirect.URL)
			if err != nil {
				t.Fatal(err)
			}
			want := url.Values{"client_id": {"client"}, "redirect_uri": {"https://uwplan.com/api/auth/callback/" + string(provider)}, "response_type": {"code"}, "state": {"browser-state"}, "code_challenge": {oauth2.S256ChallengeFromVerifier(flow.Verifier)}, "code_challenge_method": {"S256"}}
			host, path := "github.com", "/login/oauth/authorize"
			want.Set("scope", "read:user user:email")
			if provider == user.Google {
				host = "accounts.google.com"
				path = "/o/oauth2/v2/auth"
				want.Set("scope", "openid profile email")
				want.Set("nonce", flow.Nonce)
			}
			if diff := cmp.Diff([]string{"https", host, path}, []string{parsed.Scheme, parsed.Host, parsed.Path}); diff != "" {
				t.Fatal(diff)
			}
			if diff := cmp.Diff(want, parsed.Query()); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
