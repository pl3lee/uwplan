package api

import (
	"github.com/google/go-cmp/cmp"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	"github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/stretchr/testify/mock"
)

func TestScheduleListUsesAuthenticatedUser(t *testing.T) {
	t.Parallel()
	auth := NewAuthServiceMock(t)
	service := NewScheduleServiceMock(t)
	token := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	person := user.User{ID: "legacy-user", Email: "user@example.test", Role: user.RoleUser}
	auth.EXPECT().Authenticate(mock.Anything, session.Credentials{Token: token}).Return(person, nil).Once()
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	service.EXPECT().List(mock.Anything, person).Return(schedule.Collection{Schedules: []schedule.Schedule{{ID: id, Name: "Default"}}}, nil).Once()
	cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
	router, _ := NewRouter(cfg, Dependencies{Auth: auth, Schedules: service})
	r := httptest.NewRequest(http.MethodGet, "/api/v1/schedules", nil)
	r.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: token})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, r)
	assertJSON(t, response, 200, map[string]any{"schedules": []any{map[string]any{"id": id.String(), "name": "Default"}}})
}

func TestScheduleViewAndExportContract(t *testing.T) {
	t.Parallel()
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	courseID := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	for _, suffix := range []string{"", "/export"} {
		t.Run(suffix, func(t *testing.T) {
			t.Parallel()
			auth, service := NewAuthServiceMock(t), NewScheduleServiceMock(t)
			actor := user.User{ID: "legacy-user"}
			auth.EXPECT().Authenticate(mock.Anything, mock.Anything).Return(actor, nil).Once()
			item := course.Course{ID: courseID, Code: "CS135", Name: "Designing Functional Programs"}
			winter := term.Term{Season: term.Winter, Year: 2027}
			service.EXPECT().View(mock.Anything, schedule.Reference{UserID: actor.ID, ID: id}).Return(schedule.View{Schedule: schedule.Schedule{ID: id, Name: "Default"}, Selected: []course.Course{item}, Assigned: []schedule.Assignment{{Course: item, Term: winter}}, TermRange: term.Range{Start: winter, End: winter}}, nil).Once()
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
			router, _ := NewRouter(cfg, Dependencies{Auth: auth, Schedules: service})
			r := httptest.NewRequest(http.MethodGet, "/api/v1/schedules/"+id.String()+suffix, nil)
			r.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, r)
			if suffix == "/export" {
				if diff := cmp.Diff(200, response.Code); diff != "" {
					t.Fatal(diff)
				}
				if diff := cmp.Diff("Selected Courses:\nCS135 - Designing Functional Programs\n\nScheduled Courses:\nWinter 2027\nCS135\n", response.Body.String()); diff != "" {
					t.Fatal(diff)
				}
				if diff := cmp.Diff("text/csv; charset=utf-8", response.Header().Get("Content-Type")); diff != "" {
					t.Fatal(diff)
				}
				if diff := cmp.Diff(`attachment; filename="schedule.csv"`, response.Header().Get("Content-Disposition")); diff != "" {
					t.Fatal(diff)
				}
				return
			}
			courseBody := map[string]any{"id": courseID.String(), "code": "CS135", "name": "Designing Functional Programs", "description": "", "prereqs": "", "antireqs": "", "coreqs": "", "useful_rating": nil, "liked_rating": nil, "easy_rating": nil, "num_ratings": nil}
			assertJSON(t, response, 200, map[string]any{"schedule": map[string]any{"id": id.String(), "name": "Default"}, "selected": []any{courseBody}, "assigned": []any{map[string]any{"course": courseBody, "term": "Winter 2027"}}, "term_range": map[string]any{"start_term": "Winter", "start_year": float64(2027), "end_term": "Winter", "end_year": float64(2027)}})
		})
	}
}

func TestScheduleMutationsRejectForeignOriginsBeforePersistence(t *testing.T) {
	t.Parallel()
	id := "11111111-1111-4111-8111-111111111111"
	for _, tc := range []struct{ method, path, body string }{
		{"POST", "/api/v1/schedules", `{"name":"New"}`},
		{"PATCH", "/api/v1/schedules/" + id, `{"name":"Renamed"}`},
		{"DELETE", "/api/v1/schedules/" + id, ""},
		{"PUT", "/api/v1/schedules/" + id + "/courses/" + id, `{"term":"Fall 2027"}`},
		{"DELETE", "/api/v1/schedules/" + id + "/courses/" + id, ""},
		{"PATCH", "/api/v1/term-range", `{"start_term":"Fall","start_year":2026,"end_term":"Fall","end_year":2031}`},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			t.Parallel()
			cfg := config.Config{PublicOrigin: "https://uwplan.com", SecureCookies: true}
			router, _ := NewRouter(cfg, Dependencies{Auth: NewAuthServiceMock(t), Schedules: NewScheduleServiceMock(t)})
			r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Origin", "https://evil.example")
			r.AddCookie(&http.Cookie{Name: cfg.CookieName(), Value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, r)
			assertJSON(t, response, 403, map[string]any{"title": "Forbidden", "status": float64(403), "detail": "Forbidden"})
		})
	}
}
