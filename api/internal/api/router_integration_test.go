//go:build integration

package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	sessionrepository "github.com/pl3lee/uwplan/api/internal/repository/session"
	userrepository "github.com/pl3lee/uwplan/api/internal/repository/user"
	authservice "github.com/pl3lee/uwplan/api/internal/service/auth"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
	"github.com/redis/go-redis/v9"
)

func TestLegacyUserSessionAcrossHTTPEndpoints(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	if _, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email) VALUES ('legacy-http-user','legacy@example.test'); INSERT INTO account(user_id,type,provider,provider_account_id) VALUES ('legacy-http-user','oauth','google','legacy-subject')`); err != nil {
		t.Fatal(err)
	}
	redisServer := miniredis.RunT(t)
	redisClient := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { redisClient.Close() })
	service, err := authservice.NewAuthService(userrepository.NewUserRepository(pool), sessionrepository.NewSessionRepository(redisClient), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	grant, err := service.Login(t.Context(), user.Identity{Provider: user.Google, Subject: "legacy-subject", Email: "legacy@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
	router, _ := NewRouter(cfg, Dependencies{Auth: service})
	request := func(method, path, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		r.Header.Set("Origin", origin)
		r.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: grant.Credentials.Token})
		result := httptest.NewRecorder()
		router.ServeHTTP(result, r)
		return result
	}
	want := map[string]any{"id": "legacy-http-user", "email": "legacy@example.test", "name": nil, "image": nil, "role": "user"}
	assertJSON(t, request(http.MethodGet, "/api/v1/me", ""), 200, want)
	if _, err := pool.Exec(t.Context(), `UPDATE "user" SET role='admin' WHERE id='legacy-http-user'`); err != nil {
		t.Fatal(err)
	}
	want["role"] = "admin"
	assertJSON(t, request(http.MethodGet, "/api/v1/me", ""), 200, want)
	assertJSON(t, request(http.MethodPost, "/api/v1/auth/logout", "https://evil.example"), 403, map[string]any{"title": "Forbidden", "status": float64(403), "detail": "Forbidden"})
	assertJSON(t, request(http.MethodGet, "/api/v1/me", ""), 200, want)
	if result := request(http.MethodPost, "/api/v1/auth/logout", cfg.PublicOrigin); result.Code != 204 {
		t.Fatalf("logout status %d", result.Code)
	}
	assertJSON(t, request(http.MethodGet, "/api/v1/me", ""), 401, map[string]any{"title": "Unauthorized", "status": float64(401), "detail": "Unauthorized"})
}
