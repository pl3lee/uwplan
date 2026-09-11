package api

import (
	"errors"
	"github.com/google/go-cmp/cmp"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/stretchr/testify/mock"
)

func TestCurrentUserRequiresValidSession(t *testing.T) {
	t.Parallel()
	token := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	person := user.User{ID: "legacy-user", Email: "person@example.test", Role: user.RoleAdmin}
	for _, tc := range []struct {
		name, token string
		err         error
		status      int
		expected    map[string]any
		calls       bool
	}{
		{"valid", token, nil, 200, map[string]any{"id": "legacy-user", "email": "person@example.test", "name": nil, "image": nil, "role": "admin"}, true},
		{"missing", "", nil, 401, map[string]any{"title": "Unauthorized", "status": float64(401), "detail": "Unauthorized"}, false},
		{"expired", token, session.ErrInvalid, 401, map[string]any{"title": "Unauthorized", "status": float64(401), "detail": "Unauthorized"}, true},
		{"dependency failure", token, errors.New("postgres://secret-must-not-leak"), 500, map[string]any{"title": "Internal Server Error", "status": float64(500), "detail": "Internal Server Error"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			service := NewAuthServiceMock(t)
			if tc.calls {
				service.EXPECT().Authenticate(mock.Anything, session.Credentials{Token: tc.token}).Return(person, tc.err).Once()
			}
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
			router, _ := NewRouter(cfg, Dependencies{Auth: service})
			request := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
			if tc.token != "" {
				request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: tc.token})
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assertJSON(t, response, tc.status, tc.expected)
		})
	}
}

func TestLogoutRejectsCrossOriginRequests(t *testing.T) {
	t.Parallel()
	token := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	for _, tc := range []struct {
		name, origin, site string
		backendErr         error
		status             int
		allowed            bool
	}{
		{name: "same origin", origin: "https://uwplan.com", site: "same-origin", status: 204, allowed: true},
		{name: "missing Origin", status: 403},
		{name: "null Origin", origin: "null", status: 403},
		{name: "other origin", origin: "https://evil.example", status: 403},
		{name: "subdomain", origin: "https://evil.uwplan.com", status: 403},
		{name: "cross-site metadata", origin: "https://uwplan.com", site: "cross-site", status: 403},
		{name: "backend failure", origin: "https://uwplan.com", backendErr: errors.New("redis://secret-must-not-leak"), status: 500, allowed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			service := NewAuthServiceMock(t)
			if tc.allowed {
				service.EXPECT().Logout(mock.Anything, session.Credentials{Token: token}).Return(tc.backendErr).Once()
			}
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
			router, _ := NewRouter(cfg, Dependencies{Auth: service})
			request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
			request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: token})
			request.Header.Set("Origin", tc.origin)
			request.Header.Set("Sec-Fetch-Site", tc.site)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if tc.status == 204 {
				if diff := cmp.Diff(204, response.Code); diff != "" {
					t.Fatal(diff)
				}
				if diff := cmp.Diff("", response.Body.String()); diff != "" {
					t.Fatal(diff)
				}
				cookies := response.Result().Cookies()
				if len(cookies) != 1 {
					t.Fatalf("expected exactly one deleted session cookie, got %d", len(cookies))
				}
				got := cookies[0]
				want := &http.Cookie{Name: "__Host-uwplan_session", Path: "/", MaxAge: -1, HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, Expires: time.Unix(1, 0).UTC()}
				// Raw is the parsed wire representation, not a separate cookie attribute.
				got.Raw = ""
				got.RawExpires = ""
				if diff := cmp.Diff(want, got); diff != "" {
					t.Fatal(diff)
				}
			} else {
				title := http.StatusText(tc.status)
				assertJSON(t, response, tc.status, map[string]any{"title": title, "status": float64(tc.status), "detail": title})
				if diff := cmp.Diff("", response.Header().Get("Set-Cookie")); diff != "" {
					t.Fatal(diff)
				}
			}
		})
	}
}
