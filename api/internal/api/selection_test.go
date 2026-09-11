package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/selection"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/stretchr/testify/mock"
)

func TestPlanStateUsesAuthenticatedUserAndIncludesUniqueSelections(t *testing.T) {
	t.Parallel()
	auth, service := NewAuthServiceMock(t), NewSelectionServiceMock(t)
	actor := user.User{ID: "owner"}
	auth.EXPECT().Authenticate(mock.Anything, mock.Anything).Return(actor, nil).Once()
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	second := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	service.EXPECT().State(mock.Anything, actor).Return(selection.State{TemplateIDs: []uuid.UUID{id}, Choices: []selection.Choice{{ItemID: id, CourseID: &second, Selected: true}, {ItemID: second}}}, nil).Once()
	cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
	router, _ := NewRouter(cfg, Dependencies{Auth: auth, Selections: service})
	request := httptest.NewRequest("GET", "/api/v1/plan", nil)
	request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assertJSON(t, response, 200, map[string]any{"template_ids": []any{id.String()}, "selected_course_ids": []any{second.String()}, "choices": []any{
		map[string]any{"item_id": id.String(), "course_id": second.String(), "selected": true},
		map[string]any{"item_id": second.String(), "course_id": nil, "selected": false},
	}})
}

func TestSelectionMutationsRejectForeignOrigins(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct{ method, path, body string }{
		{"PUT", "/templates/11111111-1111-4111-8111-111111111111", `{"selected":true}`},
		{"PUT", "/items/11111111-1111-4111-8111-111111111111/selection", `{"selected":true}`},
		{"PUT", "/items/11111111-1111-4111-8111-111111111111/course", `{"course_id":null}`},
		{"DELETE", "/courses/11111111-1111-4111-8111-111111111111", ""},
	} {
		t.Run(tc.path, func(t *testing.T) {
			t.Parallel()
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
			router, _ := NewRouter(cfg, Dependencies{Auth: NewAuthServiceMock(t), Selections: NewSelectionServiceMock(t)})
			request := httptest.NewRequest(tc.method, "/api/v1/plan"+tc.path, strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Origin", "https://evil.example")
			request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assertJSON(t, response, 403, map[string]any{"title": "Forbidden", "status": float64(403), "detail": "Forbidden"})
		})
	}
}

func TestSelectionErrorsHaveSafeCompleteBodies(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name          string
		err           error
		status        int
		title, detail string
	}{
		{"missing", selection.ErrNotFound, 404, "Not Found", "Planning resource not found"},
		{"invalid", selection.ErrInvalid, 400, "Bad Request", "Invalid course selection"},
		{"infrastructure", errors.New("credential-sentinel"), 500, "Internal Server Error", "Internal Server Error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			auth, service := NewAuthServiceMock(t), NewSelectionServiceMock(t)
			actor := user.User{ID: "owner"}
			auth.EXPECT().Authenticate(mock.Anything, mock.Anything).Return(actor, nil).Once()
			id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
			service.EXPECT().RemoveCourse(mock.Anything, selection.Removal{UserID: actor.ID, CourseID: id}).Return(tc.err).Once()
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
			router, _ := NewRouter(cfg, Dependencies{Auth: auth, Selections: service})
			request := httptest.NewRequest("DELETE", "/api/v1/plan/courses/"+id.String(), nil)
			request.Header.Set("Origin", cfg.PublicOrigin)
			request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assertJSON(t, response, tc.status, map[string]any{"title": tc.title, "status": float64(tc.status), "detail": tc.detail})
		})
	}
}
