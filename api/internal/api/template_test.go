package api

import (
	"errors"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/stretchr/testify/mock"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTemplateListsUseAuthenticatedScope(t *testing.T) {
	t.Parallel()
	for _, scope := range []string{"all", "mine"} {
		t.Run(scope, func(t *testing.T) {
			t.Parallel()
			auth, service := NewAuthServiceMock(t), NewTemplateServiceMock(t)
			actor := user.User{ID: "owner", Role: user.RoleUser}
			auth.EXPECT().Authenticate(mock.Anything, mock.Anything).Return(actor, nil).Once()
			id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
			owner := "owner"
			service.EXPECT().List(mock.Anything, template.List{Actor: actor, OwnedOnly: scope == "mine"}).Return([]template.Template{{ID: id, Name: "Mathematics", CreatedBy: &owner}}, nil).Once()
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
			router, _ := NewRouter(cfg, Dependencies{Auth: auth, Templates: service})
			request := httptest.NewRequest("GET", "/api/v1/templates?scope="+scope, nil)
			request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assertJSON(t, response, 200, map[string]any{"templates": []any{map[string]any{"id": id.String(), "name": "Mathematics", "description": nil, "created_by": "owner"}}})
		})
	}
}

func TestTemplateDefinitionKeepsItemIdentityAndNullCourseSlots(t *testing.T) {
	t.Parallel()
	auth, service := NewAuthServiceMock(t), NewTemplateServiceMock(t)
	actor := user.User{ID: "student"}
	auth.EXPECT().Authenticate(mock.Anything, mock.Anything).Return(actor, nil).Once()
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	itemID := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	slotID := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	description := "Elective"
	service.EXPECT().Get(mock.Anything, template.Reference{Actor: actor, ID: id}).Return(template.Definition{Template: template.Template{ID: id, Name: "Plan"}, Items: []template.Item{{ID: itemID, Type: template.Requirement, Description: &description, OrderIndex: 2, Courses: []template.CourseItem{{ID: slotID, Type: template.Free}}}}}, nil).Once()
	cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
	router, _ := NewRouter(cfg, Dependencies{Auth: auth, Templates: service})
	request := httptest.NewRequest("GET", "/api/v1/templates/"+id.String(), nil)
	request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assertJSON(t, response, 200, map[string]any{"template": map[string]any{"id": id.String(), "name": "Plan", "description": nil, "created_by": nil}, "items": []any{map[string]any{"id": itemID.String(), "type": "requirement", "description": "Elective", "order_index": float64(2), "courses": []any{map[string]any{"id": slotID.String(), "type": "free", "course_id": nil, "course_code": nil}}}}})
}

func TestTemplateMutationsRejectForeignOrigins(t *testing.T) {
	t.Parallel()
	for _, method := range []string{"POST", "PATCH", "DELETE"} {
		t.Run(method, func(t *testing.T) {
			t.Parallel()
			path := "/api/v1/templates"
			body := `{"name":"Plan","items":[]}`
			if method != "POST" {
				path += "/11111111-1111-4111-8111-111111111111"
				body = `{"name":"Plan"}`
			}
			if method == "DELETE" {
				body = ""
			}
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
			router, _ := NewRouter(cfg, Dependencies{Auth: NewAuthServiceMock(t), Templates: NewTemplateServiceMock(t)})
			request := httptest.NewRequest(method, path, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Origin", "https://evil.example")
			request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assertJSON(t, response, 403, map[string]any{"title": "Forbidden", "status": float64(403), "detail": "Forbidden"})
		})
	}
}

func TestTemplateErrorsHaveSafeCompleteBodies(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name          string
		err           error
		status        int
		title, detail string
	}{
		{"not found", template.ErrNotFound, 404, "Not Found", "Template not found"},
		{"duplicate", template.ErrNameExists, 409, "Conflict", "Academic plan name already exists"},
		{"invalid", template.ErrInvalid, 400, "Bad Request", "Invalid template"},
		{"missing course", template.ErrCourseNotFound, 400, "Bad Request", "One or more courses were not found"},
		{"infrastructure", errors.New("credential-sentinel"), 500, "Internal Server Error", "Internal Server Error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			auth, service := NewAuthServiceMock(t), NewTemplateServiceMock(t)
			actor := user.User{ID: "owner"}
			auth.EXPECT().Authenticate(mock.Anything, mock.Anything).Return(actor, nil).Once()
			service.EXPECT().Create(mock.Anything, template.Draft{Actor: actor, Name: "Plan", Items: []template.DraftItem{}}).Return(template.Template{}, tc.err).Once()
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
			router, _ := NewRouter(cfg, Dependencies{Auth: auth, Templates: service})
			request := httptest.NewRequest("POST", "/api/v1/templates", strings.NewReader(`{"name":"Plan","items":[]}`))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Origin", cfg.PublicOrigin)
			request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assertJSON(t, response, tc.status, map[string]any{"title": tc.title, "status": float64(tc.status), "detail": tc.detail})
		})
	}
}
