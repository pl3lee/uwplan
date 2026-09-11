package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/stretchr/testify/mock"
)

func TestAdminUserListUsesAuthenticatedActorAndSafeResponses(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		err    error
		status int
		body   map[string]any
	}{
		{"profiles", nil, 200, map[string]any{"users": []any{map[string]any{"id": "legacy-user", "email": "student@example.test", "name": nil, "image": nil, "role": "user"}}}},
		{"forbidden", user.ErrForbidden, 403, map[string]any{"title": "Forbidden", "status": float64(403), "detail": "Forbidden"}},
		{"unavailable", errors.New("credential-sentinel"), 500, map[string]any{"title": "Internal Server Error", "status": float64(500), "detail": "Internal Server Error"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			auth, service := NewAuthServiceMock(t), NewAdminServiceMock(t)
			actor := user.User{ID: "admin", Role: user.RoleAdmin}
			auth.EXPECT().Authenticate(mock.Anything, mock.Anything).Return(actor, nil).Once()
			service.EXPECT().ListUsers(mock.Anything, actor).Return([]user.User{{ID: "legacy-user", Email: "student@example.test", Role: user.RoleUser}}, tc.err).Once()
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
			router, _ := NewRouter(cfg, Dependencies{Auth: auth, Admin: service})
			request := httptest.NewRequest("GET", "/api/v1/admin/users", nil)
			request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assertJSON(t, response, tc.status, tc.body)
		})
	}
}
