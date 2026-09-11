//go:build integration

package selection_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/selection"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	repository "github.com/pl3lee/uwplan/api/internal/repository/selection"
	templaterepo "github.com/pl3lee/uwplan/api/internal/repository/template"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

func TestFreeCourseChangesStayPrivateAndPreserveSelection(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `
INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'),('other','other@example.test');
INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','owner'),('22222222-2222-4222-8222-222222222222','other');
INSERT INTO course(id,code,name,description,prereqs,antireqs,coreqs) VALUES
('55555555-5555-4555-8555-555555555555','CS135','Functional Programs','','','',''),
('88888888-8888-4888-8888-888888888888','CS136','Algorithms','','','','');
`)
	if err != nil {
		t.Fatal(err)
	}
	owner := user.User{ID: "owner"}
	description := "Choose courses"
	templates := templaterepo.NewTemplateRepository(pool)
	created, err := templates.Create(t.Context(), template.Draft{Actor: owner, Name: "Core", Items: []template.DraftItem{
		{Type: template.Requirement, Description: &description, CourseType: template.Fixed, CourseCodes: []string{"CS135"}},
		{Type: template.Requirement, Description: &description, CourseType: template.Free, CourseCount: 1},
	}})
	if err != nil {
		t.Fatal(err)
	}
	definition, err := templates.Get(t.Context(), template.Reference{Actor: owner, ID: created.ID})
	if err != nil {
		t.Fatal(err)
	}
	fixedID, freeID := definition.Items[0].Courses[0].ID, definition.Items[1].Courses[0].ID
	first := uuid.MustParse("55555555-5555-4555-8555-555555555555")
	second := uuid.MustParse("88888888-8888-4888-8888-888888888888")
	repo := repository.NewSelectionRepository(pool)
	for _, id := range []string{"owner", "other"} {
		if err := repo.SetTemplate(t.Context(), selection.Membership{UserID: id, TemplateID: created.ID, Selected: true}); err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.SetChoice(t.Context(), selection.Toggle{UserID: owner.ID, ItemID: freeID, Selected: true}); err != nil {
		t.Fatal(err)
	}
	for _, courseID := range []*uuid.UUID{&first, &second, nil, &first} {
		if err := repo.ChangeFreeCourse(t.Context(), selection.FreeCourseChange{UserID: owner.ID, ItemID: freeID, CourseID: courseID}); err != nil {
			t.Fatal(err)
		}
		got, err := repo.State(t.Context(), owner)
		if err != nil {
			t.Fatal(err)
		}
		want := selection.State{TemplateIDs: []uuid.UUID{created.ID}, Choices: []selection.Choice{{ItemID: fixedID, CourseID: &first}, {ItemID: freeID, CourseID: courseID, Selected: true}}}
		if diff := cmp.Diff(want, got); diff != "" {
			t.Fatal(diff)
		}
	}
	other, err := repo.State(t.Context(), user.User{ID: "other"})
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(selection.State{TemplateIDs: []uuid.UUID{created.ID}, Choices: []selection.Choice{{ItemID: fixedID, CourseID: &first}, {ItemID: freeID}}}, other); diff != "" {
		t.Fatal(diff)
	}
	missing := uuid.MustParse("99999999-9999-4999-8999-999999999999")
	for _, change := range []selection.FreeCourseChange{
		{UserID: owner.ID, ItemID: fixedID, CourseID: &second},
		{UserID: owner.ID, ItemID: freeID, CourseID: &missing},
		{UserID: "missing", ItemID: freeID, CourseID: &first},
		{UserID: owner.ID, ItemID: missing},
	} {
		if err := repo.ChangeFreeCourse(t.Context(), change); !errors.Is(err, selection.ErrNotFound) {
			t.Fatalf("invalid free course target: %v", err)
		}
	}
	if err := repo.SetTemplate(t.Context(), selection.Membership{UserID: "other", TemplateID: created.ID}); err != nil {
		t.Fatal(err)
	}
	if err := repo.ChangeFreeCourse(t.Context(), selection.FreeCourseChange{UserID: "other", ItemID: freeID, CourseID: &first}); !errors.Is(err, selection.ErrNotFound) {
		t.Fatalf("free course outside plan: %v", err)
	}
}
