//go:build integration

package selection_test

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	"github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/selection"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	schedulerepo "github.com/pl3lee/uwplan/api/internal/repository/schedule"
	repository "github.com/pl3lee/uwplan/api/internal/repository/selection"
	templaterepo "github.com/pl3lee/uwplan/api/internal/repository/template"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

func TestRemovingCourseClearsDuplicatesAndOnlyTheUsersSchedules(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `
INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'),('other','other@example.test');
INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','owner'),('22222222-2222-4222-8222-222222222222','other');
INSERT INTO user_term_range(user_id,start_term,start_year,end_term,end_year) VALUES ('owner','Fall',2026,'Winter',2027),('other','Fall',2026,'Winter',2027);
INSERT INTO course(id,code,name,description,prereqs,antireqs,coreqs) VALUES
('55555555-5555-4555-8555-555555555555','CS135','Functional Programs','','','',''),
('88888888-8888-4888-8888-888888888888','CS136','Algorithms','','','','');
`)
	if err != nil {
		t.Fatal(err)
	}
	owner := user.User{ID: "owner"}
	first := course.Course{ID: uuid.MustParse("55555555-5555-4555-8555-555555555555"), Code: "CS135", Name: "Functional Programs"}
	second := course.Course{ID: uuid.MustParse("88888888-8888-4888-8888-888888888888"), Code: "CS136", Name: "Algorithms"}
	description := "Choose courses"
	templates := templaterepo.NewTemplateRepository(pool)
	repo := repository.NewSelectionRepository(pool)
	definitions := []template.Definition{}
	for _, draft := range []template.Draft{
		{Actor: owner, Name: "A", Items: []template.DraftItem{
			{Type: template.Requirement, Description: &description, CourseType: template.Fixed, CourseCodes: []string{"CS135", "CS136"}},
			{Type: template.Requirement, Description: &description, CourseType: template.Free, CourseCount: 1},
		}},
		{Actor: owner, Name: "B", Items: []template.DraftItem{{Type: template.Requirement, Description: &description, CourseType: template.Fixed, CourseCodes: []string{"CS135"}}}},
	} {
		created, err := templates.Create(t.Context(), draft)
		if err != nil {
			t.Fatal(err)
		}
		definition, err := templates.Get(t.Context(), template.Reference{Actor: owner, ID: created.ID})
		if err != nil {
			t.Fatal(err)
		}
		definitions = append(definitions, definition)
		for _, id := range []string{"owner", "other"} {
			if err := repo.SetTemplate(t.Context(), selection.Membership{UserID: id, TemplateID: created.ID, Selected: true}); err != nil {
				t.Fatal(err)
			}
			for _, item := range definition.Items {
				for _, slot := range item.Courses {
					if err := repo.SetChoice(t.Context(), selection.Toggle{UserID: id, ItemID: slot.ID, Selected: true}); err != nil {
						t.Fatal(err)
					}
				}
			}
		}
	}
	freeID := definitions[0].Items[1].Courses[0].ID
	for _, id := range []string{"owner", "other"} {
		if err := repo.ChangeFreeCourse(t.Context(), selection.FreeCourseChange{UserID: id, ItemID: freeID, CourseID: &first.ID}); err != nil {
			t.Fatal(err)
		}
	}
	schedules := schedulerepo.NewScheduleRepository(pool)
	refs := []schedule.Reference{}
	fall := term.Term{Season: term.Fall, Year: 2026}
	for _, id := range []string{"owner", "owner", "other"} {
		created, err := schedules.Create(t.Context(), schedule.Create{UserID: id, Name: "Default"})
		if err != nil {
			t.Fatal(err)
		}
		ref := schedule.Reference{UserID: id, ID: created.ID}
		refs = append(refs, ref)
		for _, courseID := range []uuid.UUID{first.ID, second.ID} {
			if err := schedules.Assign(t.Context(), schedule.Assign{Reference: ref, CourseID: courseID, Term: fall}); err != nil {
				t.Fatal(err)
			}
		}
	}
	for range 2 {
		if err := repo.RemoveCourse(t.Context(), selection.Removal{UserID: owner.ID, CourseID: first.ID}); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{"owner", "other"} {
		got, err := repo.State(t.Context(), user.User{ID: id})
		if err != nil {
			t.Fatal(err)
		}
		retained := id == "other"
		want := selection.State{TemplateIDs: []uuid.UUID{definitions[0].Template.ID, definitions[1].Template.ID}, Choices: []selection.Choice{
			{ItemID: definitions[0].Items[0].Courses[0].ID, CourseID: &first.ID, Selected: retained},
			{ItemID: definitions[0].Items[0].Courses[1].ID, CourseID: &second.ID, Selected: true},
			{ItemID: freeID, CourseID: &first.ID, Selected: retained},
			{ItemID: definitions[1].Items[0].Courses[0].ID, CourseID: &first.ID, Selected: retained},
		}}
		if diff := cmp.Diff(want, got); diff != "" {
			t.Fatal(diff)
		}
	}
	for _, ref := range refs {
		got, err := schedules.View(t.Context(), ref)
		if err != nil {
			t.Fatal(err)
		}
		want := schedule.View{Schedule: schedule.Schedule{ID: ref.ID, Name: "Default"}, Selected: []course.Course{second}, Assigned: []schedule.Assignment{{Course: second, Term: fall}}, TermRange: term.Range{Start: fall, End: term.Term{Season: term.Winter, Year: 2027}}}
		if ref.UserID == "other" {
			// Schedule exports retain each selected item occurrence in the legacy CSV.
			want.Selected = []course.Course{first, first, first, second}
			want.Assigned = []schedule.Assignment{{Course: first, Term: fall}, {Course: second, Term: fall}}
		}
		if diff := cmp.Diff(want, got); diff != "" {
			t.Fatal(diff)
		}
	}
}
