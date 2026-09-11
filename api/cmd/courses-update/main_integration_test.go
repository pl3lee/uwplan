//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	courserepository "github.com/pl3lee/uwplan/api/internal/repository/course"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

func TestCommandImportsFixtureAndReturnsFailureWithoutChangingCatalog(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO course(id,code,name) VALUES ('11111111-1111-4111-8111-111111111111','CS135','Old name')`)
	if err != nil {
		t.Fatal(err)
	}
	var deny atomic.Bool
	var omitted atomic.Value
	omitted.Store("")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if deny.Load() {
			http.Error(w, "private upstream detail", http.StatusForbidden)
			return
		}
		var body struct {
			OperationName string `json:"operationName"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if body.OperationName == "exploreAll" {
			item := map[string]any{"course_id": 135, "code": "cs135", "name": "Functional Programs", "useful": 0.8, "liked": 0.7, "easy": 0.5, "ratings": 12}
			delete(item, omitted.Load().(string))
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"course_search_index": []any{item}}})
		} else {
			_, _ = w.Write([]byte(`{"data":{"course":[{"id":135,"code":"cs135","name":"Functional Programs","description":"Updated description","prereqs":"","antireqs":"","coreqs":""}]}}`))
		}
	}))
	defer server.Close()
	url := pool.Config().ConnString()
	var output bytes.Buffer
	if code := execute(t.Context(), nil, url, server.URL, &output); code != 0 {
		t.Fatalf("exit code %d: %s", code, &output)
	}
	var log map[string]any
	if err := json.Unmarshal(output.Bytes(), &log); err != nil {
		t.Fatal(err)
	}
	delete(log, "time")
	wantLog := map[string]any{"level": "INFO", "msg": "course catalog updated", "service": "uwplan-catalog", "event": "catalog.completed", "courses": float64(1)}
	if diff := cmp.Diff(wantLog, log); diff != "" {
		t.Fatal(diff)
	}
	useful, liked, easy := "0.800", "0.700", "0.500"
	count := int32(12)
	want := []course.Course{{ID: uuid.MustParse("11111111-1111-4111-8111-111111111111"), Code: "CS135", Name: "Functional Programs", Description: "Updated description", UsefulRating: &useful, LikedRating: &liked, EasyRating: &easy, NumRatings: &count}}
	repo := courserepository.NewCourseRepository(pool)
	for _, scenario := range []string{"success", "useful", "liked", "easy", "ratings", "upstream failure", "canceled"} {
		if scenario != "success" {
			deny.Store(scenario == "upstream failure" || scenario == "canceled")
			omitted.Store(scenario)
			ctx := t.Context()
			if scenario == "canceled" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			output.Reset()
			if code := execute(ctx, nil, url, server.URL, &output); code != 1 {
				t.Fatalf("%s: exit code %d", scenario, code)
			}
			log = nil
			if err := json.Unmarshal(output.Bytes(), &log); err != nil {
				t.Fatal(err)
			}
			delete(log, "time")
			wantError := map[string]any{"level": "ERROR", "msg": "course catalog update failed", "service": "uwplan-catalog", "event": "catalog.failed"}
			if diff := cmp.Diff(wantError, log); diff != "" {
				t.Fatal(diff)
			}
		}
		got, err := repo.List(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if diff := cmp.Diff(want, got); diff != "" {
			t.Fatalf("%s: %s", scenario, diff)
		}
	}
}
