//go:build integration

package course_test

import (
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	"github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	repository "github.com/pl3lee/uwplan/api/internal/repository/course"
	schedulerepository "github.com/pl3lee/uwplan/api/internal/repository/schedule"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

func TestCourseImportPreservesIDsAndReferencesAndCommitsAtomically(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test');
INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','owner');
INSERT INTO user_term_range(user_id,start_term,start_year,end_term,end_year) VALUES ('owner','Fall',2026,'Winter',2027);
INSERT INTO course(id,code,name,useful_rating) VALUES ('22222222-2222-4222-8222-222222222222','CS135','Old name',0.5),('33333333-3333-4333-8333-333333333333','MATH135','Algebra',NULL);
INSERT INTO template(id,name) VALUES ('44444444-4444-4444-8444-444444444444','Core');
INSERT INTO template_item(id,template_id,type,order_index) VALUES ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','requirement',0);
INSERT INTO course_item(id,requirement_id,type,course_id) VALUES ('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555','fixed','22222222-2222-4222-8222-222222222222');
INSERT INTO selected_course(plan_id,course_item_id,selected) VALUES ('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',true);
INSERT INTO schedule(id,plan_id,name) VALUES ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','Default');
INSERT INTO schedule_course(schedule_id,course_id,term) VALUES ('77777777-7777-4777-8777-777777777777','22222222-2222-4222-8222-222222222222','Fall 2026');`)
	if err != nil {
		t.Fatal(err)
	}
	repo := repository.NewCourseRepository(pool)
	rating, zero := "0.9", "0"
	count := int32(5)
	input := course.Import{Courses: []course.Course{{Code: "CS135", Name: "Functional Programs", Description: "Updated description", Prereqs: "Prerequisite", Antireqs: "Antirequisite", Coreqs: "Corequisite", UsefulRating: &rating, EasyRating: &zero, NumRatings: &count}, {Code: "CS136", Name: "Algorithms"}}}
	if err := repo.Import(t.Context(), input); err != nil {
		t.Fatal(err)
	}
	got, err := repo.List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[1].ID.Version() != 7 {
		t.Fatalf("new catalog identity missing: %+v", got)
	}
	storedRating, storedZero := "0.900", "0"
	updated := course.Course{ID: uuid.MustParse("22222222-2222-4222-8222-222222222222"), Code: "CS135", Name: "Functional Programs", Description: "Updated description", Prereqs: "Prerequisite", Antireqs: "Antirequisite", Coreqs: "Corequisite", UsefulRating: &storedRating, EasyRating: &storedZero, NumRatings: &count}
	want := []course.Course{updated, {ID: got[1].ID, Code: "CS136", Name: "Algorithms"}, {ID: uuid.MustParse("33333333-3333-4333-8333-333333333333"), Code: "MATH135", Name: "Algebra"}}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	ref := schedule.Reference{UserID: "owner", ID: uuid.MustParse("77777777-7777-4777-8777-777777777777")}
	view, err := schedulerepository.NewScheduleRepository(pool).View(t.Context(), ref)
	if err != nil {
		t.Fatal(err)
	}
	fall := term.Term{Season: term.Fall, Year: 2026}
	expectedView := schedule.View{Schedule: schedule.Schedule{ID: ref.ID, Name: "Default"}, Selected: []course.Course{updated}, Assigned: []schedule.Assignment{{Course: updated, Term: fall}}, TermRange: term.Range{Start: fall, End: term.Term{Season: term.Winter, Year: 2027}}}
	if diff := cmp.Diff(expectedView, view); diff != "" {
		t.Fatal(diff)
	}
	invalid := course.Import{Courses: []course.Course{{Code: "CS135", Name: "Must roll back"}, {Code: "ZZZ999", Name: strings.Repeat("X", 256)}}}
	if err := repo.Import(t.Context(), invalid); err == nil {
		t.Fatal("expected persistence failure")
	}
	after, err := repo.List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(want, after); diff != "" {
		t.Fatal(diff)
	}
}
