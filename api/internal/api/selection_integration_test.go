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
	selectionrepository "github.com/pl3lee/uwplan/api/internal/repository/selection"
	sessionrepository "github.com/pl3lee/uwplan/api/internal/repository/session"
	userrepository "github.com/pl3lee/uwplan/api/internal/repository/user"
	authservice "github.com/pl3lee/uwplan/api/internal/service/auth"
	selectionservice "github.com/pl3lee/uwplan/api/internal/service/selection"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
	"github.com/redis/go-redis/v9"
)

func TestSelectionHTTPPersistsChoicesAndEnforcesSessionOwnership(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `
INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'),('other','other@example.test');
INSERT INTO account(user_id,type,provider,provider_account_id) VALUES ('owner','oauth','google','owner-subject'),('other','oauth','google','other-subject');
INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','owner'),('22222222-2222-4222-8222-222222222222','other');
INSERT INTO template(id,name) VALUES ('33333333-3333-4333-8333-333333333333','Core');
INSERT INTO template_item(id,template_id,type,description,order_index) VALUES
('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','requirement','Core',0),
('88888888-8888-4888-8888-888888888888','33333333-3333-4333-8333-333333333333','requirement','Elective',1);
INSERT INTO course(id,code,name) VALUES ('77777777-7777-4777-8777-777777777777','CS135','Functional Programs'),('99999999-9999-4999-8999-999999999999','CS136','Algorithms');
INSERT INTO course_item(id,requirement_id,type,course_id) VALUES ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','fixed','77777777-7777-4777-8777-777777777777'),('66666666-6666-4666-8666-666666666666','88888888-8888-4888-8888-888888888888','free',NULL);
`)
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
	cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
	cookies := map[string]*http.Cookie{}
	for _, actor := range []string{"owner", "other"} {
		grant, err := auth.Login(t.Context(), user.Identity{Provider: user.Google, Subject: actor + "-subject", Email: actor + "@example.test"})
		if err != nil {
			t.Fatal(err)
		}
		cookies[actor] = &http.Cookie{Name: cfg.CookieName(), Value: grant.Credentials.Token}
	}
	router, _ := NewRouter(cfg, Dependencies{Auth: auth, Selections: selectionservice.NewSelectionService(selectionrepository.NewSelectionRepository(pool))})
	request := func(actor, method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
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
	noContent := func(response *httptest.ResponseRecorder) {
		t.Helper()
		if diff := cmp.Diff(204, response.Code); diff != "" {
			t.Fatalf("%s body=%s", diff, response.Body.String())
		}
		if diff := cmp.Diff("", response.Body.String()); diff != "" {
			t.Fatal(diff)
		}
	}
	state := func(actor string, want PlanStateBody) {
		t.Helper()
		response := request(actor, "GET", "/api/v1/plan", "")
		if diff := cmp.Diff(200, response.Code); diff != "" {
			t.Fatalf("%s body=%s", diff, response.Body.String())
		}
		var got PlanStateBody
		if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if diff := cmp.Diff(want, got); diff != "" {
			t.Fatal(diff)
		}
	}
	unauthorized := map[string]any{"title": "Unauthorized", "status": float64(401), "detail": "Unauthorized"}
	notFound := map[string]any{"title": "Not Found", "status": float64(404), "detail": "Planning resource not found"}
	empty := PlanStateBody{TemplateIDs: []uuid.UUID{}, Choices: []PlanChoiceBody{}, SelectedCourseIDs: []uuid.UUID{}}
	templateID := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	fixedID := uuid.MustParse("55555555-5555-4555-8555-555555555555")
	freeID := uuid.MustParse("66666666-6666-4666-8666-666666666666")
	first := uuid.MustParse("77777777-7777-4777-8777-777777777777")
	second := uuid.MustParse("99999999-9999-4999-8999-999999999999")
	membershipPath := "/api/v1/plan/templates/" + templateID.String()
	fixedPath := "/api/v1/plan/items/" + fixedID.String()
	freePath := "/api/v1/plan/items/" + freeID.String()
	assertJSON(t, request("", "GET", "/api/v1/plan", ""), 401, unauthorized)
	assertJSON(t, request("", "PUT", membershipPath, `{"selected":true}`), 401, unauthorized)
	state("owner", empty)
	assertJSON(t, request("owner", "PUT", fixedPath+"/selection", `{"selected":true}`), 404, notFound)
	assertJSON(t, request("owner", "PUT", membershipPath, `{"selected":true,"user_id":"other"}`), 422, map[string]any{
		"title": "Unprocessable Entity", "status": float64(422), "detail": "validation failed",
		"errors": []any{map[string]any{"message": "unexpected property", "location": "body.user_id", "value": map[string]any{"selected": true, "user_id": "other"}}},
	})
	state("owner", empty)
	noContent(request("owner", "PUT", membershipPath, `{"selected":true}`))
	state("other", empty)
	assertJSON(t, request("other", "PUT", freePath+"/course", `{"course_id":"77777777-7777-4777-8777-777777777777"}`), 404, notFound)
	noContent(request("owner", "PUT", fixedPath+"/selection", `{"selected":true}`))
	noContent(request("owner", "PUT", freePath+"/course", `{"course_id":"77777777-7777-4777-8777-777777777777"}`))
	noContent(request("owner", "PUT", freePath+"/selection", `{"selected":true}`))
	state("owner", PlanStateBody{TemplateIDs: []uuid.UUID{templateID}, Choices: []PlanChoiceBody{{ItemID: fixedID, CourseID: &first, Selected: true}, {ItemID: freeID, CourseID: &first, Selected: true}}, SelectedCourseIDs: []uuid.UUID{first}})
	noContent(request("owner", "PUT", freePath+"/course", `{"course_id":"99999999-9999-4999-8999-999999999999"}`))
	state("owner", PlanStateBody{TemplateIDs: []uuid.UUID{templateID}, Choices: []PlanChoiceBody{{ItemID: fixedID, CourseID: &first, Selected: true}, {ItemID: freeID, CourseID: &second, Selected: true}}, SelectedCourseIDs: []uuid.UUID{first, second}})
	noContent(request("owner", "PUT", freePath+"/course", `{"course_id":null}`))
	state("owner", PlanStateBody{TemplateIDs: []uuid.UUID{templateID}, Choices: []PlanChoiceBody{{ItemID: fixedID, CourseID: &first, Selected: true}, {ItemID: freeID, Selected: true}}, SelectedCourseIDs: []uuid.UUID{first}})
	noContent(request("owner", "PUT", freePath+"/course", `{"course_id":"77777777-7777-4777-8777-777777777777"}`))
	noContent(request("owner", "DELETE", "/api/v1/plan/courses/"+first.String(), ""))
	state("owner", PlanStateBody{TemplateIDs: []uuid.UUID{templateID}, Choices: []PlanChoiceBody{{ItemID: fixedID, CourseID: &first}, {ItemID: freeID, CourseID: &first}}, SelectedCourseIDs: []uuid.UUID{}})
	noContent(request("owner", "PUT", membershipPath, `{"selected":false}`))
	state("owner", empty)
	noContent(request("owner", "PUT", membershipPath, `{"selected":true}`))
	state("owner", PlanStateBody{TemplateIDs: []uuid.UUID{templateID}, Choices: []PlanChoiceBody{{ItemID: fixedID, CourseID: &first}, {ItemID: freeID, CourseID: &first}}, SelectedCourseIDs: []uuid.UUID{}})
	redisServer.FastForward(2 * time.Hour)
	assertJSON(t, request("owner", "GET", "/api/v1/plan", ""), 401, unauthorized)
}
