//go:build integration

package main

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/pl3lee/uwplan/api/internal/gateway/builtin"
	repository "github.com/pl3lee/uwplan/api/internal/repository/template"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

func TestSeedCommandPreservesLegacyDefinitionsAndIsSafeToRerun(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	repo := repository.NewTemplateRepository(pool)
	var output bytes.Buffer
	url := pool.Config().ConnString()
	if code := execute(t.Context(), nil, url, &output); code != 1 {
		t.Fatalf("missing catalog: exit code %d", code)
	}
	list, err := repo.List(t.Context(), template.List{Actor: user.User{ID: "reader"}})
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]template.Template{}, list); diff != "" {
		t.Fatal(diff)
	}
	definitions, err := builtin.NewBuiltinGateway().Fetch(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	// These names and counts are the legacy seed's five public definitions.
	wantCounts := map[string]int{"Bachelor of Mathematics Degree - 2024": 18, "Computational Mathematics Major - 2024": 22, "Free Electives - 10 Courses": 1, "Free Electives - 5 Courses": 1, "Free Electives - 15 Courses": 1}
	counts := make(map[string]int)
	courseIDs := make(map[string]uuid.UUID)
	for _, definition := range definitions.Templates {
		counts[definition.Name] = len(definition.Items)
		for _, item := range definition.Items {
			for _, code := range item.CourseCodes {
				if _, ok := courseIDs[code]; ok {
					continue
				}
				id := uuid.New()
				courseIDs[code] = id
				if _, err := pool.Exec(t.Context(), `INSERT INTO course(id,code,name) VALUES($1,$2,$2)`, id, code); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	if diff := cmp.Diff(wantCounts, counts); diff != "" {
		t.Fatal(diff)
	}
	for run := range 2 {
		output.Reset()
		if code := execute(t.Context(), nil, url, &output); code != 0 {
			t.Fatalf("exit code %d: %s", code, &output)
		}
		var log map[string]any
		if err := json.Unmarshal(output.Bytes(), &log); err != nil {
			t.Fatal(err)
		}
		delete(log, "time")
		created, existing := float64(5), float64(0)
		if run == 1 {
			created, existing = 0, 5
		}
		wantLog := map[string]any{"level": "INFO", "msg": "built-in templates seeded", "service": "uwplan-seed", "event": "seed.completed", "created": created, "existing": existing}
		if diff := cmp.Diff(wantLog, log); diff != "" {
			t.Fatal(diff)
		}
	}
	list, err = repo.List(t.Context(), template.List{Actor: user.User{ID: "reader"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 5 {
		t.Fatalf("templates=%d", len(list))
	}
	byName := make(map[string]template.Blueprint)
	for _, definition := range definitions.Templates {
		byName[definition.Name] = definition
	}
	for _, summary := range list {
		definition := byName[summary.Name]
		got, err := repo.Get(t.Context(), template.Reference{ID: summary.ID, Actor: user.User{ID: "reader"}})
		if err != nil {
			t.Fatal(err)
		}
		if len(got.Items) != len(definition.Items) {
			t.Fatal("item count changed")
		}
		want := template.Definition{Template: template.Template{ID: summary.ID, Name: definition.Name, Description: definition.Description}, Items: make([]template.Item, len(definition.Items))}
		for i, item := range definition.Items {
			actual := got.Items[i]
			if actual.ID.Version() != 7 {
				t.Fatal("item ID is not UUIDv7")
			}
			courses := make([]template.CourseItem, 0, len(item.CourseCodes)+item.CourseCount)
			if len(actual.Courses) != cap(courses) {
				t.Fatal("course item count changed")
			}
			for j, code := range item.CourseCodes {
				id := courseIDs[code]
				courses = append(courses, template.CourseItem{ID: actual.Courses[j].ID, Type: template.Fixed, CourseID: &id, CourseCode: &code})
			}
			for j := range item.CourseCount {
				courses = append(courses, template.CourseItem{ID: actual.Courses[j].ID, Type: template.Free})
			}
			for _, course := range actual.Courses {
				if course.ID.Version() != 7 {
					t.Fatal("course item ID is not UUIDv7")
				}
			}
			want.Items[i] = template.Item{ID: actual.ID, Type: item.Type, Description: item.Description, OrderIndex: int32(i), Courses: courses}
		}
		if summary.ID.Version() != 7 {
			t.Fatal("template ID is not UUIDv7")
		}
		if diff := cmp.Diff(want, got); diff != "" {
			t.Fatal(diff)
		}
	}
}
