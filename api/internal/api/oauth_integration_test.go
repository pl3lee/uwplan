//go:build integration

package api

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	oauthrepository "github.com/pl3lee/uwplan/api/internal/repository/oauth"
	sessionrepository "github.com/pl3lee/uwplan/api/internal/repository/session"
	userrepository "github.com/pl3lee/uwplan/api/internal/repository/user"
	authservice "github.com/pl3lee/uwplan/api/internal/service/auth"
	oauthservice "github.com/pl3lee/uwplan/api/internal/service/oauth"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/mock"
)

func TestOAuthCallbackPreservesLegacyAccountAndRejectsReplay(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	if _, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email,role) VALUES ('legacy-oauth-user','legacy@example.test','moderator'); INSERT INTO account(user_id,type,provider,provider_account_id) VALUES ('legacy-oauth-user','oauth','google','legacy-subject')`); err != nil {
		t.Fatal(err)
	}
	redisServer := miniredis.RunT(t)
	redisClient := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { redisClient.Close() })
	auth, err := authservice.NewAuthService(userrepository.NewUserRepository(pool), sessionrepository.NewSessionRepository(redisClient), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	gateway := oauthservice.NewOAuthGatewayMock(t)
	gateway.EXPECT().AuthorizationURL(mock.Anything, mock.Anything).Return(oauth.Redirect{URL: "https://accounts.google.com/fixture"}, nil).Once()
	gateway.EXPECT().Exchange(mock.Anything, mock.Anything).Return(user.Identity{Provider: user.Google, Subject: "legacy-subject", Email: "legacy@example.test"}, nil).Once()
	service := oauthservice.NewOAuthService(oauthrepository.NewOAuthRepository(redisClient), gateway, auth)
	cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true, SessionTTL: time.Hour}
	router, _ := NewRouter(cfg, Dependencies{Auth: auth, OAuth: service})
	request := func(path string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		for _, cookie := range cookies {
			r.AddCookie(cookie)
		}
		result := httptest.NewRecorder()
		router.ServeHTTP(result, r)
		return result
	}
	start := request("/api/auth/signin/google?return_to=%2Fschedule")
	if diff := cmp.Diff(302, start.Code); diff != "" {
		t.Fatal(diff)
	}
	cookies := start.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one state cookie, got %d", len(cookies))
	}
	callback := "/api/auth/callback/google?code=fixture-code&state=" + url.QueryEscape(cookies[0].Value)
	rejected := request(callback)
	if diff := cmp.Diff("/signin?error=OAuthCallback", rejected.Header().Get("Location")); diff != "" {
		t.Fatal(diff)
	}
	completed := request(callback, cookies[0])
	if diff := cmp.Diff("/schedule", completed.Header().Get("Location")); diff != "" {
		t.Fatal(diff)
	}
	var sessionCookie *http.Cookie
	for _, cookie := range completed.Result().Cookies() {
		if cookie.Name == cfg.CookieName() {
			sessionCookie = cookie
		}
	}
	if sessionCookie == nil {
		t.Fatal("callback did not issue session cookie")
	}
	assertJSON(t, request("/api/v1/me", sessionCookie), 200, map[string]any{"id": "legacy-oauth-user", "email": "legacy@example.test", "name": nil, "image": nil, "role": "moderator"})
	replay := request(callback, cookies[0])
	if diff := cmp.Diff("/signin?error=OAuthCallback", replay.Header().Get("Location")); diff != "" {
		t.Fatal(diff)
	}
	for _, cookie := range replay.Result().Cookies() {
		if cookie.Name == cfg.CookieName() {
			t.Fatal("replayed callback issued a session")
		}
	}
}
