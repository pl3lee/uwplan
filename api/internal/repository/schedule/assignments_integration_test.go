//go:build integration

package schedule_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	"github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	repository "github.com/pl3lee/uwplan/api/internal/repository/schedule"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

func TestScheduleViewAndAssignmentsEnforceOwnership(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'),('other','other@example.test');
INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','owner');
INSERT INTO schedule(id,name,plan_id) VALUES ('22222222-2222-4222-8222-222222222222','Default','11111111-1111-4111-8111-111111111111');
INSERT INTO course(id,code,name,useful_rating,num_ratings) VALUES ('33333333-3333-4333-8333-333333333333','CS135','Designing Functional Programs',4.250,10);
INSERT INTO template(id,name) VALUES ('44444444-4444-4444-8444-444444444444','Fixture');
INSERT INTO template_item(id,template_id,type,order_index) VALUES ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','requirement',0);
INSERT INTO course_item(id,requirement_id,type,course_id) VALUES ('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555','fixed','33333333-3333-4333-8333-333333333333');
INSERT INTO selected_course(plan_id,course_item_id,selected) VALUES ('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',true);
INSERT INTO user_term_range(user_id,start_term,start_year,end_term,end_year) VALUES ('owner','Fall',2026,'Fall',2031);`)
	if err != nil {
		t.Fatal(err)
	}
	repo := repository.NewScheduleRepository(pool)
	ref := schedule.Reference{UserID: "owner", ID: uuid.MustParse("22222222-2222-4222-8222-222222222222")}
	foreign := schedule.Reference{UserID: "other", ID: ref.ID}
	courseID := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	fall := term.Term{Season: term.Fall, Year: 2026}
	winter := term.Term{Season: term.Winter, Year: 2027}
	if _, err := repo.View(t.Context(), foreign); !errors.Is(err, schedule.ErrNotFound) {
		t.Fatalf("foreign view: %v", err)
	}
	if err := repo.Assign(t.Context(), schedule.Assign{Reference: foreign, CourseID: courseID, Term: fall}); !errors.Is(err, schedule.ErrNotFound) {
		t.Fatalf("foreign assignment: %v", err)
	}
	for _, assignedTerm := range []term.Term{fall, winter} {
		if err := repo.Assign(t.Context(), schedule.Assign{Reference: ref, CourseID: courseID, Term: assignedTerm}); err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.RemoveCourse(t.Context(), schedule.RemoveCourse{Reference: foreign, CourseID: courseID}); !errors.Is(err, schedule.ErrNotFound) {
		t.Fatalf("foreign removal: %v", err)
	}
	rangeValue := term.Range{Start: fall, End: term.Term{Season: term.Winter, Year: 2028}}
	if err := repo.ChangeTermRange(t.Context(), schedule.TermRangeChange{UserID: "owner", Range: rangeValue}); err != nil {
		t.Fatal(err)
	}
	gotRange, err := repo.GetTermRange(t.Context(), user.User{ID: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(rangeValue, gotRange); diff != "" {
		t.Fatal(diff)
	}
	rating, count := "4.250", int32(10)
	catalogCourse := course.Course{ID: courseID, Code: "CS135", Name: "Designing Functional Programs", UsefulRating: &rating, NumRatings: &count}
	want := schedule.View{Schedule: schedule.Schedule{ID: ref.ID, Name: "Default"}, Selected: []course.Course{catalogCourse}, Assigned: []schedule.Assignment{{Course: catalogCourse, Term: winter}}, TermRange: rangeValue}
	got, err := repo.View(t.Context(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	for range 2 {
		if err := repo.RemoveCourse(t.Context(), schedule.RemoveCourse{Reference: ref, CourseID: courseID}); err != nil {
			t.Fatal(err)
		}
	}
	got, err = repo.View(t.Context(), ref)
	if err != nil {
		t.Fatal(err)
	}
	want.Assigned = []schedule.Assignment{}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
}
