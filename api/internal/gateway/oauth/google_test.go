package oauth_test

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	domainoauth "github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	gatewayoauth "github.com/pl3lee/uwplan/api/internal/gateway/oauth"
)

func TestGoogleExchangeVerifiesSignedIdentity(t *testing.T) {
	t.Parallel()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, claim string
		value       any
		valid       bool
	}{
		{name: "valid", valid: true},
		{name: "wrong issuer", claim: "iss", value: "https://attacker.example"},
		{name: "wrong audience", claim: "aud", value: "another-client"},
		{name: "expired", claim: "exp", value: time.Now().Add(-time.Hour).Unix()},
		{name: "wrong nonce", claim: "nonce", value: "another-browser"},
		{name: "unverified email", claim: "email_verified", value: false},
		{name: "wrong authorized party", claim: "azp", value: "another-client"},
		{name: "wrong access token", claim: "at_hash", value: "invalid"},
		{name: "bad signature"},
		{name: "key fetch outage"},
		{name: "invalid code"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			claims := map[string]any{"iss": "https://accounts.google.com", "aud": "client", "sub": "stable-google-subject", "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(), "nonce": "browser-nonce", "email": "google@example.test", "email_verified": true, "name": "Google User", "picture": "https://example.test/avatar.png"}
			if tc.claim != "" {
				claims[tc.claim] = tc.value
			}
			signingKey := key
			if tc.name == "bad signature" {
				var err error
				signingKey, err = rsa.GenerateKey(rand.Reader, 2048)
				if err != nil {
					t.Fatal(err)
				}
			}
			encodedHeader := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","kid":"fixture"}`))
			payload, err := json.Marshal(claims)
			if err != nil {
				t.Fatal(err)
			}
			signingInput := encodedHeader + "." + base64.RawURLEncoding.EncodeToString(payload)
			hash := sha256.Sum256([]byte(signingInput))
			signature, err := rsa.SignPKCS1v15(rand.Reader, signingKey, crypto.SHA256, hash[:])
			if err != nil {
				t.Fatal(err)
			}
			signedToken := signingInput + "." + base64.RawURLEncoding.EncodeToString(signature)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/token":
					if tc.name == "invalid code" {
						w.WriteHeader(http.StatusBadRequest)
						w.Write([]byte(`{"error":"invalid_grant"}`))
						return
					}
					if err := r.ParseForm(); err != nil {
						t.Error(err)
					}
					want := url.Values{"client_id": {"client"}, "client_secret": {"secret"}, "code": {"code"}, "code_verifier": {"verifier"}, "grant_type": {"authorization_code"}, "redirect_uri": {"https://uwplan.com/api/auth/callback/google"}}
					if diff := cmp.Diff(want, r.PostForm); diff != "" {
						t.Error(diff)
					}
					json.NewEncoder(w).Encode(map[string]string{"access_token": "access", "token_type": "bearer", "id_token": signedToken})
				case "/oauth2/v3/certs":
					if tc.name == "key fetch outage" {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{"kty": "RSA", "kid": "fixture", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}})
				default:
					t.Errorf("unexpected path %s", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			target, _ := url.Parse(server.URL)
			gateway := gatewayoauth.NewOAuthGateway(gatewayoauth.Options{PublicOrigin: "https://uwplan.com", Google: gatewayoauth.Credentials{ClientID: "client", ClientSecret: "secret"}}, &http.Client{Transport: redirectTransport{target, http.DefaultTransport}})
			identity, err := gateway.Exchange(t.Context(), domainoauth.Exchange{Flow: domainoauth.Flow{Provider: user.Google, Verifier: "verifier", Nonce: "browser-nonce"}, Code: "code", Issuer: "https://accounts.google.com"})
			if tc.name == "key fetch outage" {
				if err == nil || errors.Is(err, user.ErrInvalidIdentity) {
					t.Fatalf("expected infrastructure error, got %v", err)
				}
				return
			}
			if !tc.valid {
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
			name, image := "Google User", "https://example.test/avatar.png"
			want := user.Identity{Provider: user.Google, Subject: "stable-google-subject", Email: "google@example.test", Name: &name, Image: &image}
			if diff := cmp.Diff(want, identity); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
