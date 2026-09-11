package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/health"
	"github.com/stretchr/testify/mock"
)

func assertJSON(t *testing.T, response *httptest.ResponseRecorder, status int, want map[string]any) {
	t.Helper()
	if diff := cmp.Diff(status, response.Code); diff != "" {
		t.Fatal(diff)
	}
	var got map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
}

func TestLivenessDoesNotRequireDependencies(t *testing.T) {
	t.Parallel()
	router, _ := NewRouter(config.Config{}, Dependencies{})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/live", nil))
	assertJSON(t, response, 200, map[string]any{"status": "live"})
}

func TestReadinessRequiresDatabaseAndRedis(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		report health.Report
		status int
		state  string
	}{
		{"ready", health.Report{Database: health.Available, Redis: health.Available}, 200, "ready"},
		{"database unavailable", health.Report{Database: health.Unavailable, Redis: health.Available}, 503, "unready"},
		{"Redis unavailable", health.Report{Database: health.Available, Redis: health.Unavailable}, 503, "unready"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			gateway := NewHealthGatewayMock(t)
			gateway.EXPECT().Check(mock.Anything).Return(tc.report).Once()
			cfg := config.Config{Release: health.Release{Digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Revision: "revision"}}
			router, _ := NewRouter(cfg, Dependencies{Health: gateway})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/ready", nil))
			assertJSON(t, response, tc.status, map[string]any{"status": tc.state, "release": map[string]any{"digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "revision": "revision"}, "dependencies": map[string]any{"database": string(tc.report.Database), "redis": string(tc.report.Redis)}})
		})
	}
}

func TestReadinessRejectsAndRedactsInvalidReleaseIdentity(t *testing.T) {
	t.Parallel()
	gateway := NewHealthGatewayMock(t)
	gateway.EXPECT().Check(mock.Anything).Return(health.Report{Database: health.Available, Redis: health.Available}).Once()
	cfg := config.Config{Release: health.Release{Digest: "credential-sentinel", Revision: "invalid/credential-sentinel"}}
	router, _ := NewRouter(cfg, Dependencies{Health: gateway})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/ready", nil))
	assertJSON(t, response, 503, map[string]any{"status": "unready", "release": map[string]any{"digest": "unavailable", "revision": "unknown"}, "dependencies": map[string]any{"database": "available", "redis": "available"}})
}
