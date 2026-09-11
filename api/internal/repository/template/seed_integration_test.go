//go:build integration

package template_test

import (
	"errors"
	"sync"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	repository "github.com/pl3lee/uwplan/api/internal/repository/template"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

func TestSeedRetainsExistingDefinitionsAndSavedSelections(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'); INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','owner')`)
	if err != nil {
		t.Fatal(err)
	}
	repo := repository.NewTemplateRepository(pool)
	text := "Pick any course"
	seed := template.Seed{Templates: []template.Blueprint{{Name: "Electives", Description: &text, Items: []template.DraftItem{{Type: template.Requirement, Description: &text, CourseType: template.Free, CourseCount: 2}}}}}
	got, err := repo.Seed(t.Context(), seed)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(template.SeedResult{Created: 1}, got); diff != "" {
		t.Fatal(diff)
	}
	list, err := repo.List(t.Context(), template.List{Actor: user.User{ID: "owner"}})
	if err != nil || len(list) != 1 {
		t.Fatalf("list=%v err=%v", list, err)
	}
	ref := template.Reference{Actor: user.User{ID: "owner"}, ID: list[0].ID}
	before, err := repo.Get(t.Context(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if before.Template.CreatedBy != nil || before.Template.ID.Version() != 7 || len(before.Items) != 1 || len(before.Items[0].Courses) != 2 {
		t.Fatalf("seed definition=%+v", before)
	}
	for _, item := range before.Items {
		if item.ID.Version() != 7 {
			t.Fatal("expected UUIDv7 item")
		}
		for _, course := range item.Courses {
			if course.ID.Version() != 7 {
				t.Fatal("expected UUIDv7 course item")
			}
		}
	}
	_, err = pool.Exec(t.Context(), `INSERT INTO plan_template(plan_id,template_id) VALUES ('11111111-1111-4111-8111-111111111111',$1)`, ref.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(t.Context(), `INSERT INTO selected_course(plan_id,course_item_id,selected) VALUES ('11111111-1111-4111-8111-111111111111',$1,true)`, before.Items[0].Courses[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	seed.Templates[0].Description = nil
	seed.Templates[0].Items = nil
	got, err = repo.Seed(t.Context(), seed)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(template.SeedResult{Existing: 1}, got); diff != "" {
		t.Fatal(diff)
	}
	after, err := repo.Get(t.Context(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(before, after); diff != "" {
		t.Fatal(diff)
	}
	var selected bool
	err = pool.QueryRow(t.Context(), `SELECT sc.selected FROM selected_course sc JOIN plan_template pt ON pt.plan_id=sc.plan_id AND pt.template_id=$1 WHERE sc.course_item_id=$2`, ref.ID, before.Items[0].Courses[0].ID).Scan(&selected)
	if err != nil || !selected {
		t.Fatalf("saved selection=%v err=%v", selected, err)
	}
}

func TestSeedRollsBackWholeBatchAndDoesNotTakeOwnership(t *testing.T) {
	t.Parallel()
	for _, scenario := range []string{"missing course", "owned collision"} {
		t.Run(scenario, func(t *testing.T) {
			t.Parallel()
			pool := postgres.NewPool(t)
			repo := repository.NewTemplateRepository(pool)
			seed := template.Seed{Templates: []template.Blueprint{{Name: "A first"}, {Name: "Z later"}}}
			wantError := template.ErrCourseNotFound
			if scenario == "missing course" {
				text := "Missing course"
				seed.Templates[1].Items = []template.DraftItem{{Type: template.Requirement, Description: &text, CourseType: template.Fixed, CourseCodes: []string{"UNKNOWN"}}}
			} else {
				_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'); INSERT INTO template(id,name,created_by) VALUES ('22222222-2222-4222-8222-222222222222','Z later','owner')`)
				if err != nil {
					t.Fatal(err)
				}
				wantError = template.ErrNameExists
			}
			before, err := repo.List(t.Context(), template.List{Actor: user.User{ID: "owner"}})
			if err != nil {
				t.Fatal(err)
			}
			got, err := repo.Seed(t.Context(), seed)
			if !errors.Is(err, wantError) {
				t.Fatalf("got %v", err)
			}
			if diff := cmp.Diff(template.SeedResult{}, got); diff != "" {
				t.Fatal(diff)
			}
			after, err := repo.List(t.Context(), template.List{Actor: user.User{ID: "owner"}})
			if err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(before, after); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestConcurrentSeedsCreateOneDefinition(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	repo := repository.NewTemplateRepository(pool)
	seed := template.Seed{Templates: []template.Blueprint{{Name: "Electives"}}}
	results := make([]template.SeedResult, 2)
	errors := make([]error, 2)
	var workers sync.WaitGroup
	for i := range 2 {
		workers.Go(func() { results[i], errors[i] = repo.Seed(t.Context(), seed) })
	}
	workers.Wait()
	for _, err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	total := template.SeedResult{Created: results[0].Created + results[1].Created, Existing: results[0].Existing + results[1].Existing}
	if diff := cmp.Diff(template.SeedResult{Created: 1, Existing: 1}, total); diff != "" {
		t.Fatal(diff)
	}
}
