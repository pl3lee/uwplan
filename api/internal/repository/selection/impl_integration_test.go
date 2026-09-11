//go:build integration

package selection_test

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/selection"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	repository "github.com/pl3lee/uwplan/api/internal/repository/selection"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

func TestTemplateMembershipPreservesOtherUsersAndRetainedChoices(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `
INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'),('other','other@example.test');
INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','owner'),('22222222-2222-4222-8222-222222222222','other');
INSERT INTO template(id,name) VALUES ('33333333-3333-4333-8333-333333333333','Core');
INSERT INTO template_item(id,template_id,type,description,order_index) VALUES ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','requirement','Elective',0);
INSERT INTO course(id,code,name,description,prereqs,antireqs,coreqs) VALUES ('55555555-5555-4555-8555-555555555555','CS135','Functional Programs','','','','');
INSERT INTO course_item(id,requirement_id,type) VALUES ('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444','free');
INSERT INTO selected_course(plan_id,course_item_id,selected) VALUES ('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',true),('22222222-2222-4222-8222-222222222222','66666666-6666-4666-8666-666666666666',true);
INSERT INTO free_course(id,user_id,course_item_id,filled_course_id) VALUES ('77777777-7777-4777-8777-777777777777','owner','66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555');
`)
	if err != nil {
		t.Fatal(err)
	}
	repo := repository.NewSelectionRepository(pool)
	templateID := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	itemID := uuid.MustParse("66666666-6666-4666-8666-666666666666")
	courseID := uuid.MustParse("55555555-5555-4555-8555-555555555555")
	for _, id := range []string{"owner", "other", "owner"} {
		if err := repo.SetTemplate(t.Context(), selection.Membership{UserID: id, TemplateID: templateID, Selected: true}); err != nil {
			t.Fatal(err)
		}
	}
	assertState := func(id string, want selection.State) {
		t.Helper()
		got, err := repo.State(t.Context(), user.User{ID: id})
		if err != nil {
			t.Fatal(err)
		}
		if diff := cmp.Diff(want, got); diff != "" {
			t.Fatal(diff)
		}
	}
	assertState("owner", selection.State{TemplateIDs: []uuid.UUID{templateID}, Choices: []selection.Choice{{ItemID: itemID, CourseID: &courseID, Selected: true}}})
	if err := repo.SetTemplate(t.Context(), selection.Membership{UserID: "owner", TemplateID: templateID}); err != nil {
		t.Fatal(err)
	}
	assertState("owner", selection.State{TemplateIDs: []uuid.UUID{}, Choices: []selection.Choice{}})
	assertState("other", selection.State{TemplateIDs: []uuid.UUID{templateID}, Choices: []selection.Choice{{ItemID: itemID, Selected: true}}})
	if err := repo.SetTemplate(t.Context(), selection.Membership{UserID: "owner", TemplateID: templateID, Selected: true}); err != nil {
		t.Fatal(err)
	}
	assertState("owner", selection.State{TemplateIDs: []uuid.UUID{templateID}, Choices: []selection.Choice{{ItemID: itemID, CourseID: &courseID, Selected: false}}})
}
