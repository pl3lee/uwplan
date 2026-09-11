//go:build integration

package api

import (
	"encoding/json"
	"github.com/alicebob/miniredis/v2"
	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	sessionrepository "github.com/pl3lee/uwplan/api/internal/repository/session"
	templaterepository "github.com/pl3lee/uwplan/api/internal/repository/template"
	userrepository "github.com/pl3lee/uwplan/api/internal/repository/user"
	authservice "github.com/pl3lee/uwplan/api/internal/service/auth"
	templateservice "github.com/pl3lee/uwplan/api/internal/service/template"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
	"github.com/redis/go-redis/v9"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTemplateHTTPFlowEnforcesOwnershipAndAtomicCreation(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email,role) VALUES ('owner','owner@example.test','user'),('other','other@example.test','user'),('admin','admin@example.test','admin');
 INSERT INTO account(user_id,type,provider,provider_account_id) VALUES ('owner','oauth','google','owner-subject'),('other','oauth','google','other-subject'),('admin','oauth','google','admin-subject');
 INSERT INTO course(id,code,name) VALUES ('11111111-1111-4111-8111-111111111111','CS135','Functional Programs');`)
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
	for _, actor := range []string{"owner", "other", "admin"} {
		grant, err := auth.Login(t.Context(), user.Identity{Provider: user.Google, Subject: actor + "-subject", Email: actor + "@example.test"})
		if err != nil {
			t.Fatal(err)
		}
		cookies[actor] = &http.Cookie{Name: cfg.CookieName(), Value: grant.Credentials.Token}
	}
	router, _ := NewRouter(cfg, Dependencies{Auth: auth, Templates: templateservice.NewTemplateService(templaterepository.NewTemplateRepository(pool))})
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
	noContent := func(response *httptest.ResponseRecorder) {
		t.Helper()
		if diff := cmp.Diff(204, response.Code); diff != "" {
			t.Fatalf("%s body=%s", diff, response.Body.String())
		}
		if diff := cmp.Diff("", response.Body.String()); diff != "" {
			t.Fatal(diff)
		}
	}
	assertJSON(t, request("", "GET", "/api/v1/templates", ""), 401, map[string]any{"title": "Unauthorized", "status": float64(401), "detail": "Unauthorized"})
	body := `{"name":"Mathematics","description":"Demo","items":[{"type":"instruction","description":"Complete the core"},{"type":"requirement","description":"Core","course_type":"fixed","course_codes":["cs 135"]},{"type":"separator"},{"type":"requirement","description":"Electives","course_type":"free","course_count":2}]}`
	created := request("owner", "POST", "/api/v1/templates", body)
	var decoded map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	idValue, ok := decoded["id"].(string)
	if !ok {
		t.Fatalf("creation failed: %s", created.Body.String())
	}
	id, err := uuid.Parse(idValue)
	if err != nil || id.Version() != 7 {
		t.Fatalf("invalid new template ID: %v", err)
	}
	basic := map[string]any{"id": id.String(), "name": "Mathematics", "description": "Demo", "created_by": "owner"}
	assertJSON(t, created, 201, basic)
	assertJSON(t, request("other", "GET", "/api/v1/templates?scope=mine", ""), 200, map[string]any{"templates": []any{}})
	assertJSON(t, request("other", "GET", "/api/v1/templates", ""), 200, map[string]any{"templates": []any{basic}})
	path := "/api/v1/templates/" + id.String()
	viewed := request("other", "GET", path, "")
	var view TemplateDefinitionResponse
	if err := json.Unmarshal(viewed.Body.Bytes(), &view.Body); err != nil {
		t.Fatal(err)
	}
	if len(view.Body.Items) != 4 || len(view.Body.Items[1].Courses) != 1 || len(view.Body.Items[3].Courses) != 2 {
		t.Fatalf("incomplete template: %s", viewed.Body.String())
	}
	text := func(value string) *string { return &value }
	courseID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	expected := struct {
		Template TemplateBody       `json:"template"`
		Items    []TemplateItemBody `json:"items"`
	}{
		Template: TemplateBody{ID: id, Name: "Mathematics", Description: text("Demo"), CreatedBy: text("owner")},
		Items: []TemplateItemBody{
			{ID: view.Body.Items[0].ID, Type: "instruction", Description: text("Complete the core"), OrderIndex: 0, Courses: []TemplateCourseItemBody{}},
			{ID: view.Body.Items[1].ID, Type: "requirement", Description: text("Core"), OrderIndex: 1, Courses: []TemplateCourseItemBody{{ID: view.Body.Items[1].Courses[0].ID, Type: "fixed", CourseID: &courseID, CourseCode: text("CS135")}}},
			{ID: view.Body.Items[2].ID, Type: "separator", OrderIndex: 2, Courses: []TemplateCourseItemBody{}},
			{ID: view.Body.Items[3].ID, Type: "requirement", Description: text("Electives"), OrderIndex: 3, Courses: []TemplateCourseItemBody{{ID: view.Body.Items[3].Courses[0].ID, Type: "free"}, {ID: view.Body.Items[3].Courses[1].ID, Type: "free"}}},
		},
	}
	if diff := cmp.Diff(200, viewed.Code); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff(expected, view.Body); diff != "" {
		t.Fatal(diff)
	}
	assertJSON(t, request("owner", "POST", "/api/v1/templates", body), 409, map[string]any{"title": "Conflict", "status": float64(409), "detail": "Academic plan name already exists"})
	invalid := `{"name":"Invalid","items":[{"type":"requirement","description":"Elective","course_type":"free","course_count":0}]}`
	assertJSON(t, request("owner", "POST", "/api/v1/templates", invalid), 400, map[string]any{"title": "Bad Request", "status": float64(400), "detail": "Invalid template"})
	missing := `{"name":"Missing","items":[{"type":"instruction","description":"Roll this back"},{"type":"requirement","description":"Core","course_type":"fixed","course_codes":["UNKNOWN"]}]}`
	assertJSON(t, request("owner", "POST", "/api/v1/templates", missing), 400, map[string]any{"title": "Bad Request", "status": float64(400), "detail": "One or more courses were not found"})
	assertJSON(t, request("owner", "GET", "/api/v1/templates?scope=mine", ""), 200, map[string]any{"templates": []any{basic}})
	notFound := map[string]any{"title": "Not Found", "status": float64(404), "detail": "Template not found"}
	assertJSON(t, request("other", "PATCH", path, `{"name":"Stolen"}`), 404, notFound)
	assertJSON(t, request("other", "DELETE", path, ""), 404, notFound)
	noContent(request("admin", "PATCH", path, `{"name":"Admin rename","description":"Updated"}`))
	if _, err := pool.Exec(t.Context(), `UPDATE "user" SET role='user' WHERE id='admin'`); err != nil {
		t.Fatal(err)
	}
	assertJSON(t, request("admin", "PATCH", path, `{"name":"Stale role"}`), 404, notFound)
	noContent(request("owner", "PATCH", path, `{"name":"Owner rename","description":"Updated"}`))
	noContent(request("owner", "DELETE", path, ""))
	assertJSON(t, request("owner", "GET", path, ""), 404, notFound)
	assertJSON(t, request("owner", "GET", "/api/v1/templates", ""), 200, map[string]any{"templates": []any{}})
}
