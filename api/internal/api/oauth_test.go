package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/stretchr/testify/mock"
)

func TestOAuthStartBindsBrowserWithSecureCookie(t *testing.T) {
	t.Parallel()
	service := NewOAuthServiceMock(t)
	expires := time.Now().UTC().Add(oauth.Lifetime).Truncate(time.Second)
	service.EXPECT().Begin(mock.Anything, oauth.Start{Provider: user.Google, ReturnTo: "/schedule"}).Return(oauth.Redirect{URL: "https://accounts.google.com/o/oauth2/v2/auth?state=fixture", State: "fixture", ExpiresAt: expires}, nil).Once()
	router, _ := NewRouter(config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}, Dependencies{OAuth: service})
	request := httptest.NewRequest(http.MethodGet, "/api/auth/signin/google?return_to=%2Fschedule", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if diff := cmp.Diff(http.StatusFound, response.Code); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff("", response.Body.String()); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff("https://accounts.google.com/o/oauth2/v2/auth?state=fixture", response.Header().Get("Location")); diff != "" {
		t.Fatal(diff)
	}
	cookies := response.Result().Cookies()
	for _, cookie := range cookies {
		cookie.Raw = ""
		cookie.RawExpires = ""
	}
	want := []*http.Cookie{{Name: "__Host-uwplan_oauth_google", Value: "fixture", Path: "/", Expires: expires, MaxAge: 600, Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode}}
	if diff := cmp.Diff(want, cookies); diff != "" {
		t.Fatal(diff)
	}
}

func TestOAuthCallbackSetsSessionOnlyAfterSuccessfulVerification(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name     string
		err      error
		location string
	}{
		{"success", nil, "/schedule?active=legacy"},
		{"invalid state", oauth.ErrInvalidState, "/signin?error=OAuthCallback"},
		{"account not linked", user.ErrAccountNotLinked, "/signin?error=OAuthAccountNotLinked"},
		{"invalid identity", user.ErrInvalidIdentity, "/signin?error=OAuthCallback"},
		{"provider failure", errors.New("provider-secret-must-not-leak"), ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			service := NewOAuthServiceMock(t)
			expires := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
			grant := session.Grant{Credentials: session.Credentials{Token: "new-token"}, Session: session.Session{ExpiresAt: expires}}
			callback := oauth.Callback{Provider: user.Google, Code: "code", State: "state", BrowserState: "browser-state", Issuer: "https://accounts.google.com", PreviousSession: session.Credentials{Token: "previous-session"}}
			service.EXPECT().Complete(mock.Anything, callback).Return(oauth.Login{Grant: grant, ReturnTo: "/schedule?active=legacy"}, tc.err).Once()
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true, SessionTTL: time.Hour}
			router, _ := NewRouter(cfg, Dependencies{OAuth: service})
			request := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google?code=code&state=state&iss=https%3A%2F%2Faccounts.google.com", nil)
			request.AddCookie(&http.Cookie{Name: "__Host-uwplan_oauth_google", Value: "browser-state"})
			request.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "previous-session"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if tc.name == "provider failure" {
				assertJSON(t, response, 500, map[string]any{"title": "Internal Server Error", "status": float64(500), "detail": "Internal Server Error"})
			} else {
				if diff := cmp.Diff(http.StatusFound, response.Code); diff != "" {
					t.Fatal(diff)
				}
				if diff := cmp.Diff("", response.Body.String()); diff != "" {
					t.Fatal(diff)
				}
			}
			if diff := cmp.Diff(tc.location, response.Header().Get("Location")); diff != "" {
				t.Fatal(diff)
			}
			cookies := response.Result().Cookies()
			for _, cookie := range cookies {
				cookie.Raw = ""
				cookie.RawExpires = ""
			}
			want := []*http.Cookie{{Name: "__Host-uwplan_oauth_google", Path: "/", Expires: time.Unix(1, 0).UTC(), MaxAge: -1, Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode}}
			if tc.err == nil {
				want = append(want, &http.Cookie{Name: cfg.CookieName(), Value: "new-token", Path: "/", Expires: expires, MaxAge: 3600, Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode})
			}
			if diff := cmp.Diff(want, cookies); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
