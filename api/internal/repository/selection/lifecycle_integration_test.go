//go:build integration

package selection_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/selection"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	schedrepo "github.com/pl3lee/uwplan/api/internal/repository/schedule"
	selrepo "github.com/pl3lee/uwplan/api/internal/repository/selection"
	tplrepo "github.com/pl3lee/uwplan/api/internal/repository/template"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

// Exercise the complete selection-to-scheduling lifecycle against PostgreSQL.
func lifecycleID(n byte) uuid.UUID { var id uuid.UUID; id[15] = n; return id }

func lifecycleFixture(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p := postgres.NewPool(t)
	_, err := p.Exec(t.Context(), `
 INSERT INTO "user"(id,email) VALUES ('audit','audit@example.test');
 INSERT INTO plan(id,user_id) VALUES ('00000000-0000-0000-0000-000000000001','audit');
 INSERT INTO schedule(id,name,plan_id) VALUES ('00000000-0000-0000-0000-000000000002','Audit','00000000-0000-0000-0000-000000000001');
 INSERT INTO user_term_range(user_id,start_term,start_year,end_term,end_year) VALUES ('audit','Fall',2026,'Winter',2027);
 INSERT INTO course(id,code,name) VALUES ('00000000-0000-0000-0000-000000000003','CS135','First'),('00000000-0000-0000-0000-000000000004','CS136','Second');
 INSERT INTO template(id,name,created_by) VALUES ('00000000-0000-0000-0000-000000000005','Audit','audit'),('00000000-0000-0000-0000-000000000008','Other','audit');
 INSERT INTO template_item(id,template_id,type,order_index) VALUES ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000005','requirement',0),('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000008','requirement',0);
 INSERT INTO course_item(id,requirement_id,type,course_id) VALUES ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000006','fixed','00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000009','fixed','00000000-0000-0000-0000-000000000003');
 `)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSelectionChangesReconcileScheduledCourses(t *testing.T) {
	t.Parallel()
	for _, mode := range []string{"detach", "deselect", "free_replace", "free_clear", "template_delete", "shared_detach", "shared_last_detach", "explicit_remove", "assign_unselected"} {
		t.Run(mode, func(t *testing.T) {
			t.Parallel()
			p := lifecycleFixture(t)
			ctx := t.Context()
			sr := selrepo.NewSelectionRepository(p)
			sch := schedrepo.NewScheduleRepository(p)
			ref := schedule.Reference{UserID: "audit", ID: lifecycleID(2)}
			must := func(err error) {
				t.Helper()
				if err != nil {
					t.Fatal(err)
				}
			}
			must(sr.SetTemplate(ctx, selection.Membership{UserID: "audit", TemplateID: lifecycleID(5), Selected: true}))
			if mode == "free_replace" || mode == "free_clear" {
				_, err := p.Exec(ctx, "UPDATE course_item SET type='free',course_id=NULL WHERE id=$1", lifecycleID(7))
				must(err)
				id := lifecycleID(3)
				must(sr.ChangeFreeCourse(ctx, selection.FreeCourseChange{UserID: "audit", ItemID: lifecycleID(7), CourseID: &id}))
			}
			if mode != "assign_unselected" {
				must(sr.SetChoice(ctx, selection.Toggle{UserID: "audit", ItemID: lifecycleID(7), Selected: true}))
			}
			if mode == "shared_detach" || mode == "shared_last_detach" {
				must(sr.SetTemplate(ctx, selection.Membership{UserID: "audit", TemplateID: lifecycleID(8), Selected: true}))
				must(sr.SetChoice(ctx, selection.Toggle{UserID: "audit", ItemID: lifecycleID(10), Selected: true}))
			}
			assignmentError := sch.Assign(ctx, schedule.Assign{Reference: ref, CourseID: lifecycleID(3), Term: term.Term{Season: term.Fall, Year: 2026}})
			if mode == "assign_unselected" {
				if !errors.Is(assignmentError, schedule.ErrNotFound) {
					t.Fatalf("unselected assignment: %v", assignmentError)
				}
			} else {
				must(assignmentError)
			}
			switch mode {
			case "detach", "shared_detach", "shared_last_detach":
				must(sr.SetTemplate(ctx, selection.Membership{UserID: "audit", TemplateID: lifecycleID(5)}))
				if mode == "shared_last_detach" {
					must(sr.SetTemplate(ctx, selection.Membership{UserID: "audit", TemplateID: lifecycleID(8)}))
				}
			case "deselect":
				must(sr.SetChoice(ctx, selection.Toggle{UserID: "audit", ItemID: lifecycleID(7)}))
			case "free_replace":
				id := lifecycleID(4)
				must(sr.ChangeFreeCourse(ctx, selection.FreeCourseChange{UserID: "audit", ItemID: lifecycleID(7), CourseID: &id}))
			case "free_clear":
				must(sr.ChangeFreeCourse(ctx, selection.FreeCourseChange{UserID: "audit", ItemID: lifecycleID(7)}))
			case "template_delete":
				must(tplrepo.NewTemplateRepository(p).Delete(ctx, template.Reference{Actor: user.User{ID: "audit"}, ID: lifecycleID(5)}))
			case "explicit_remove":
				must(sr.RemoveCourse(ctx, selection.Removal{UserID: "audit", CourseID: lifecycleID(3)}))
			}
			view, err := sch.View(ctx, ref)
			must(err)
			got := struct{ Selected, Assigned int }{len(view.Selected), len(view.Assigned)}
			want := struct{ Selected, Assigned int }{0, 0}
			if mode == "shared_detach" || mode == "free_replace" {
				want.Selected = 1
			}
			if mode == "shared_detach" {
				want.Assigned = 1
			}
			if diff := cmp.Diff(want, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestPlanningConstraintsRejectInvalidState(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct{ name, sql string }{
		{"fixed_without_course", `UPDATE course_item SET course_id=NULL`},
		{"free_with_fixed_course", `UPDATE course_item SET type='free'`},
		{"course_under_separator", `UPDATE template_item SET type='separator'`},
		{"duplicate_item_position", `INSERT INTO template_item(id,template_id,type,order_index) SELECT gen_random_uuid(),template_id,type,order_index FROM template_item`},
		{"invalid_term_range", `UPDATE user_term_range SET start_year=99999,end_year=-1`},
		{"duplicate_email", `INSERT INTO "user"(id,email) VALUES ('duplicate','AUDIT@example.test')`},
		{"invalid_assignment_term", `INSERT INTO schedule_course VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','not a term')`},
		{"fill_fixed_item_without_membership", `INSERT INTO free_course(course_item_id,user_id,filled_course_id) VALUES ('00000000-0000-0000-0000-000000000007','audit','00000000-0000-0000-0000-000000000003')`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			p := lifecycleFixture(t)
			if _, err := p.Exec(t.Context(), tc.sql); err == nil {
				t.Fatal("invalid state was accepted")
			}
		})
	}
}

func TestUnattachedChoicesAreExcludedFromBothReaders(t *testing.T) {
	t.Parallel()
	p := lifecycleFixture(t)
	_, err := p.Exec(t.Context(), `INSERT INTO selected_course VALUES ($1,$2,true)`, lifecycleID(1), lifecycleID(7))
	if err != nil {
		t.Fatal(err)
	}
	state, err := selrepo.NewSelectionRepository(p).State(t.Context(), user.User{ID: "audit"})
	if err != nil {
		t.Fatal(err)
	}
	view, err := schedrepo.NewScheduleRepository(p).View(t.Context(), schedule.Reference{UserID: "audit", ID: lifecycleID(2)})
	if err != nil {
		t.Fatal(err)
	}
	got := []int{len(state.TemplateIDs), len(state.Choices), len(view.Selected)}
	if diff := cmp.Diff([]int{0, 0, 0}, got); diff != "" {
		t.Fatal(diff)
	}
}

func TestConcurrentSourceRemovalCannotLeaveAnAssignment(t *testing.T) {
	t.Parallel()
	for _, mode := range []string{"detach", "deselect", "remove", "delete"} {
		t.Run(mode, func(t *testing.T) {
			t.Parallel()
			for attempt := 0; attempt < 8; attempt++ {
				p := lifecycleFixture(t)
				sr := selrepo.NewSelectionRepository(p)
				sch := schedrepo.NewScheduleRepository(p)
				ctx := t.Context()
				if err := sr.SetTemplate(ctx, selection.Membership{UserID: "audit", TemplateID: lifecycleID(5), Selected: true}); err != nil {
					t.Fatal(err)
				}
				if err := sr.SetChoice(ctx, selection.Toggle{UserID: "audit", ItemID: lifecycleID(7), Selected: true}); err != nil {
					t.Fatal(err)
				}
				assigned, removed := make(chan error, 1), make(chan error, 1)
				ref := schedule.Reference{UserID: "audit", ID: lifecycleID(2)}
				go func() {
					assigned <- sch.Assign(ctx, schedule.Assign{Reference: ref, CourseID: lifecycleID(3), Term: term.Term{Season: term.Fall, Year: 2026}})
				}()
				go func() {
					switch mode {
					case "detach":
						removed <- sr.SetTemplate(ctx, selection.Membership{UserID: "audit", TemplateID: lifecycleID(5)})
					case "deselect":
						removed <- sr.SetChoice(ctx, selection.Toggle{UserID: "audit", ItemID: lifecycleID(7)})
					case "remove":
						removed <- sr.RemoveCourse(ctx, selection.Removal{UserID: "audit", CourseID: lifecycleID(3)})
					case "delete":
						removed <- tplrepo.NewTemplateRepository(p).Delete(ctx, template.Reference{Actor: user.User{ID: "audit"}, ID: lifecycleID(5)})
					}
				}()
				if err := <-assigned; err != nil && !errors.Is(err, schedule.ErrNotFound) {
					t.Fatal(err)
				}
				if err := <-removed; err != nil {
					t.Fatal(err)
				}
				view, err := sch.View(ctx, ref)
				if err != nil {
					t.Fatal(err)
				}
				if diff := cmp.Diff([]int{0, 0}, []int{len(view.Selected), len(view.Assigned)}); diff != "" {
					t.Fatal(diff)
				}
				p.Close()
			}
		})
	}
}

func TestDetachAndTemplateDeletionReconcileEveryAffectedSchedule(t *testing.T) {
	t.Parallel()
	p := lifecycleFixture(t)
	ctx := t.Context()
	if _, err := p.Exec(ctx, `INSERT INTO "user"(id,email) VALUES ('other','other@example.test');
        INSERT INTO plan(id,user_id) VALUES ('00000000-0000-0000-0000-00000000000b','other');
        INSERT INTO user_term_range(user_id,start_term,start_year,end_term,end_year) VALUES ('other','Fall',2026,'Winter',2027)`); err != nil {
		t.Fatal(err)
	}
	sr := selrepo.NewSelectionRepository(p)
	sch := schedrepo.NewScheduleRepository(p)
	refs := []schedule.Reference{{UserID: "audit", ID: lifecycleID(2)}}
	for _, actor := range []string{"audit", "other"} {
		created, err := sch.Create(ctx, schedule.Create{UserID: actor, Name: "Alternative"})
		if err != nil {
			t.Fatal(err)
		}
		refs = append(refs, schedule.Reference{UserID: actor, ID: created.ID})
		if err := sr.SetTemplate(ctx, selection.Membership{UserID: actor, TemplateID: lifecycleID(5), Selected: true}); err != nil {
			t.Fatal(err)
		}
		if err := sr.SetChoice(ctx, selection.Toggle{UserID: actor, ItemID: lifecycleID(7), Selected: true}); err != nil {
			t.Fatal(err)
		}
	}
	for _, ref := range refs {
		if err := sch.Assign(ctx, schedule.Assign{Reference: ref, CourseID: lifecycleID(3), Term: term.Term{Season: term.Fall, Year: 2026}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := sr.SetTemplate(ctx, selection.Membership{UserID: "audit", TemplateID: lifecycleID(5)}); err != nil {
		t.Fatal(err)
	}
	for _, ref := range refs {
		view, err := sch.View(ctx, ref)
		if err != nil {
			t.Fatal(err)
		}
		count := 0
		if ref.UserID == "other" {
			count = 1
		}
		if diff := cmp.Diff([]int{count, count}, []int{len(view.Selected), len(view.Assigned)}); diff != "" {
			t.Fatal(diff)
		}
	}
	if err := tplrepo.NewTemplateRepository(p).Delete(ctx, template.Reference{Actor: user.User{ID: "audit"}, ID: lifecycleID(5)}); err != nil {
		t.Fatal(err)
	}
	for _, ref := range refs {
		view, err := sch.View(ctx, ref)
		if err != nil {
			t.Fatal(err)
		}
		if diff := cmp.Diff([]int{0, 0}, []int{len(view.Selected), len(view.Assigned)}); diff != "" {
			t.Fatal(diff)
		}
	}
}
