package api

import (
	"errors"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/stretchr/testify/mock"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCatalogHTTPContract(t *testing.T) {
	t.Parallel()
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	for _, tc := range []struct {
		name           string
		token          bool
		authErr, error error
		rows           []course.Course
		status         int
		body           map[string]any
	}{
		{name: "anonymous", status: 401, body: map[string]any{"title": "Unauthorized", "status": float64(401), "detail": "Unauthorized"}},
		{name: "expired", token: true, authErr: session.ErrInvalid, status: 401, body: map[string]any{"title": "Unauthorized", "status": float64(401), "detail": "Unauthorized"}},
		{name: "empty", token: true, status: 200, body: map[string]any{"courses": []any{}}},
		{name: "catalog", token: true, rows: []course.Course{{ID: id, Code: "CS135", Name: "Functional Programs"}}, status: 200, body: map[string]any{"courses": []any{map[string]any{"id": id.String(), "code": "CS135", "name": "Functional Programs", "description": "", "prereqs": "", "antireqs": "", "coreqs": "", "useful_rating": nil, "liked_rating": nil, "easy_rating": nil, "num_ratings": nil}}}},
		{name: "unavailable", token: true, error: errors.New("credential-sentinel"), status: 500, body: map[string]any{"title": "Internal Server Error", "status": float64(500), "detail": "Internal Server Error"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			auth, catalog := NewAuthServiceMock(t), NewCourseServiceMock(t)
			if tc.token {
				auth.EXPECT().Authenticate(mock.Anything, mock.Anything).Return(user.User{ID: "legacy-user"}, tc.authErr).Once()
			}
			if tc.token && tc.authErr == nil {
				catalog.EXPECT().List(mock.Anything).Return(tc.rows, tc.error).Once()
			}
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
			router, _ := NewRouter(cfg, Dependencies{Auth: auth, Courses: catalog})
			request := httptest.NewRequest(http.MethodGet, "/api/v1/courses", nil)
			if tc.token {
				request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assertJSON(t, response, tc.status, tc.body)
		})
	}
}
