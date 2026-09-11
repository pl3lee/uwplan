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
	adminservice "github.com/pl3lee/uwplan/api/internal/service/admin"
	authservice "github.com/pl3lee/uwplan/api/internal/service/auth"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
	"github.com/redis/go-redis/v9"
)

func TestAdminUserListChecksCurrentRoleAndSession(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email,name,role) VALUES ('admin','admin@example.test','Admin','admin'),('moderator','moderator@example.test',NULL,'moderator'),('student','student@example.test',NULL,'user');
INSERT INTO account(user_id,type,provider,provider_account_id) VALUES ('admin','oauth','google','admin-subject'),('moderator','oauth','google','moderator-subject'),('student','oauth','google','student-subject');`)
	if err != nil {
		t.Fatal(err)
	}
	redisServer := miniredis.RunT(t)
	redisClient := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { redisClient.Close() })
	users := userrepository.NewUserRepository(pool)
	auth, err := authservice.NewAuthService(users, sessionrepository.NewSessionRepository(redisClient), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
	cookies := map[string]*http.Cookie{}
	for _, actor := range []string{"admin", "moderator", "student"} {
		grant, err := auth.Login(t.Context(), user.Identity{Provider: user.Google, Subject: actor + "-subject", Email: actor + "@example.test"})
		if err != nil {
			t.Fatal(err)
		}
		cookies[actor] = &http.Cookie{Name: cfg.CookieName(), Value: grant.Credentials.Token}
	}
	router, _ := NewRouter(cfg, Dependencies{Auth: auth, Admin: adminservice.NewAdminService(users)})
	request := func(actor string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/api/v1/admin/users", nil)
		if cookie := cookies[actor]; cookie != nil {
			r.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, r)
		return response
	}
	unauthorized := map[string]any{"title": "Unauthorized", "status": float64(401), "detail": "Unauthorized"}
	forbidden := map[string]any{"title": "Forbidden", "status": float64(403), "detail": "Forbidden"}
	assertJSON(t, request(""), 401, unauthorized)
	assertJSON(t, request("student"), 403, forbidden)
	assertJSON(t, request("moderator"), 403, forbidden)
	assertJSON(t, request("admin"), 200, map[string]any{"users": []any{
		map[string]any{"id": "admin", "email": "admin@example.test", "name": "Admin", "image": nil, "role": "admin"},
		map[string]any{"id": "moderator", "email": "moderator@example.test", "name": nil, "image": nil, "role": "moderator"},
		map[string]any{"id": "student", "email": "student@example.test", "name": nil, "image": nil, "role": "user"},
	}})
	if _, err := pool.Exec(t.Context(), `UPDATE "user" SET role='user' WHERE id='admin'`); err != nil {
		t.Fatal(err)
	}
	assertJSON(t, request("admin"), 403, forbidden)
	redisServer.FastForward(2 * time.Hour)
	assertJSON(t, request("admin"), 401, unauthorized)
}
