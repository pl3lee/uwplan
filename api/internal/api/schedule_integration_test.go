//go:build integration

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	schedulerepository "github.com/pl3lee/uwplan/api/internal/repository/schedule"
	sessionrepository "github.com/pl3lee/uwplan/api/internal/repository/session"
	userrepository "github.com/pl3lee/uwplan/api/internal/repository/user"
	authservice "github.com/pl3lee/uwplan/api/internal/service/auth"
	scheduleservice "github.com/pl3lee/uwplan/api/internal/service/schedule"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
	"github.com/redis/go-redis/v9"
)

func TestScheduleHTTPFlowPreservesOwnershipAndPersistence(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'),('other','other@example.test');
INSERT INTO account(user_id,type,provider,provider_account_id) VALUES ('owner','oauth','google','owner-subject'),('other','oauth','google','other-subject');
INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','owner'),('22222222-2222-4222-8222-222222222222','other');
INSERT INTO schedule(id,name,plan_id) VALUES ('33333333-3333-4333-8333-333333333333','Default','11111111-1111-4111-8111-111111111111'),('44444444-4444-4444-8444-444444444444','Default','22222222-2222-4222-8222-222222222222');
INSERT INTO user_term_range(user_id,start_term,start_year,end_term,end_year) VALUES ('owner','Fall',2026,'Fall',2031),('other','Fall',2026,'Fall',2031);
INSERT INTO course(id,code,name) VALUES ('55555555-5555-4555-8555-555555555555','CS135','Designing Functional Programs');`)
	if err != nil {
		t.Fatal(err)
	}
	redisServer := miniredis.RunT(t)
	redisClient := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { redisClient.Close() })
	auth, err := authservice.NewAuthService(userrepository.NewUserRepository(pool), sessionrepository.NewSessionRepository(redisClient), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	cookies := map[string]*http.Cookie{}
	cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
	for _, name := range []string{"owner", "other"} {
		grant, err := auth.Login(t.Context(), user.Identity{Provider: user.Google, Subject: name + "-subject", Email: name + "@example.test"})
		if err != nil {
			t.Fatal(err)
		}
		cookies[name] = &http.Cookie{Name: cfg.CookieName(), Value: grant.Credentials.Token}
	}
	router, _ := NewRouter(cfg, Dependencies{Auth: auth, Schedules: scheduleservice.NewScheduleService(schedulerepository.NewScheduleRepository(pool))})
	request := func(actor, method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", cfg.PublicOrigin)
		if cookie := cookies[actor]; cookie != nil {
			r.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, r)
		return response
	}
	assertEmpty := func(response *httptest.ResponseRecorder) {
		t.Helper()
		if diff := cmp.Diff(204, response.Code); diff != "" {
			t.Fatalf("%s body=%s", diff, response.Body.String())
		}
		if diff := cmp.Diff("", response.Body.String()); diff != "" {
			t.Fatal(diff)
		}
	}
	id := "33333333-3333-4333-8333-333333333333"
	courseID := "55555555-5555-4555-8555-555555555555"
	path := "/api/v1/schedules/" + id
	assertJSON(t, request("", "GET", "/api/v1/schedules", ""), 401, map[string]any{"title": "Unauthorized", "status": float64(401), "detail": "Unauthorized"})
	assertJSON(t, request("owner", "GET", "/api/v1/schedules", ""), 200, map[string]any{"schedules": []any{map[string]any{"id": id, "name": "Default"}}})
	for _, tc := range []struct{ method, suffix, body string }{{"GET", "", ""}, {"GET", "/export", ""}, {"PATCH", "", `{"name":"Stolen"}`}, {"DELETE", "", ""}, {"PUT", "/courses/" + courseID, `{"term":"Fall 2026"}`}, {"DELETE", "/courses/" + courseID, ""}} {
		assertJSON(t, request("other", tc.method, path+tc.suffix, tc.body), 404, map[string]any{"title": "Not Found", "status": float64(404), "detail": "Schedule or course not found"})
	}
	created := request("owner", "POST", "/api/v1/schedules", `{"name":"Alternative"}`)
	var createdBody map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &createdBody); err != nil {
		t.Fatal(err)
	}
	createdID, err := uuid.Parse(createdBody["id"].(string))
	if err != nil || createdID.Version() != 7 {
		t.Fatalf("invalid created schedule ID %v", err)
	}
	assertJSON(t, created, 201, map[string]any{"id": createdID.String(), "name": "Alternative"})
	assertEmpty(request("owner", "PATCH", "/api/v1/schedules/"+createdID.String(), `{"name":"Renamed"}`))
	assertEmpty(request("owner", "DELETE", "/api/v1/schedules/"+createdID.String(), ""))
	assertJSON(t, request("owner", "DELETE", path, ""), 409, map[string]any{"title": "Conflict", "status": float64(409), "detail": "Cannot delete the only schedule"})
	for _, body := range []string{`{"term":"Fall 2026"}`, `{"term":"Winter 2027"}`} {
		assertEmpty(request("owner", "PUT", path+"/courses/"+courseID, body))
	}
	assertEmpty(request("owner", "PATCH", "/api/v1/term-range", `{"start_term":"Fall","start_year":2026,"end_term":"Winter","end_year":2028}`))
	assertJSON(t, request("owner", "GET", "/api/v1/term-range", ""), 200, map[string]any{"start_term": "Fall", "start_year": float64(2026), "end_term": "Winter", "end_year": float64(2028)})
	if diff := cmp.Diff("Selected Courses:\n\nScheduled Courses:\nWinter 2027\nCS135\n", request("owner", "GET", path+"/export", "").Body.String()); diff != "" {
		t.Fatal(diff)
	}
	assertEmpty(request("owner", "DELETE", path+"/courses/"+courseID, ""))
	if diff := cmp.Diff("Selected Courses:\n\nScheduled Courses:\n\n", request("owner", "GET", path+"/export", "").Body.String()); diff != "" {
		t.Fatal(diff)
	}
}
