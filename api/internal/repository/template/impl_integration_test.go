//go:build integration

package template_test

import (
	"errors"
	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	repository "github.com/pl3lee/uwplan/api/internal/repository/template"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
	"testing"
)

func TestCoursePositionsPreserveOrderIndependentlyOfUUIDs(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO template(id,name) VALUES ('11111111-1111-4111-8111-111111111111','Positioned');
        INSERT INTO template_item(id,template_id,type,order_index) VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','requirement',0);
        INSERT INTO course(id,code,name) VALUES ('33333333-3333-4333-8333-333333333333','CS135','First'),('44444444-4444-4444-8444-444444444444','CS136','Second');
        INSERT INTO course_item(id,requirement_id,type,course_id,order_index) VALUES
        ('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','fixed','44444444-4444-4444-8444-444444444444',0),
        ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','fixed','33333333-3333-4333-8333-333333333333',1)`)
	if err != nil {
		t.Fatal(err)
	}
	definition, err := repository.NewTemplateRepository(pool).Get(t.Context(), template.Reference{Actor: user.User{ID: "reader"}, ID: uuid.MustParse("11111111-1111-4111-8111-111111111111")})
	if err != nil {
		t.Fatal(err)
	}
	codes := []string{}
	for _, slot := range definition.Items[0].Courses {
		codes = append(codes, *slot.CourseCode)
	}
	if diff := cmp.Diff([]string{"CS136", "CS135"}, codes); diff != "" {
		t.Fatal(diff)
	}
}

func TestTemplateCreationAndCopyPreserveItemsAtomically(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'),('other','other@example.test');
 INSERT INTO course(id,code,name) VALUES ('11111111-1111-4111-8111-111111111111','CS135','Functional Programs');`)
	if err != nil {
		t.Fatal(err)
	}
	repo := repository.NewTemplateRepository(pool)
	owner := user.User{ID: "owner"}
	text := "Complete the core"
	draft := template.Draft{Actor: owner, Name: "Mathematics", Items: []template.DraftItem{
		{Type: template.Instruction, Description: &text},
		{Type: template.Requirement, Description: &text, CourseType: template.Fixed, CourseCodes: []string{"CS135"}},
		{Type: template.Separator},
		{Type: template.Requirement, Description: &text, CourseType: template.Free, CourseCount: 2},
	}}
	created, err := repo.Create(t.Context(), draft)
	if err != nil {
		t.Fatal(err)
	}
	if created.ID.Version() != 7 {
		t.Fatal("template ID must be UUIDv7")
	}
	got, err := repo.Get(t.Context(), template.Reference{Actor: user.User{ID: "other"}, ID: created.ID})
	if err != nil {
		t.Fatal(err)
	}
	courseID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	code := "CS135"
	ownerID := "owner"
	if len(got.Items) != 4 {
		t.Fatalf("items=%d", len(got.Items))
	}
	for _, item := range got.Items {
		if item.ID.Version() != 7 {
			t.Fatal("item ID must be UUIDv7")
		}
		for _, course := range item.Courses {
			if course.ID.Version() != 7 {
				t.Fatal("course item ID must be UUIDv7")
			}
		}
	}
	want := template.Definition{Template: template.Template{ID: created.ID, Name: "Mathematics", CreatedBy: &ownerID}, Items: []template.Item{
		{ID: got.Items[0].ID, Type: template.Instruction, Description: &text, OrderIndex: 0, Courses: []template.CourseItem{}},
		{ID: got.Items[1].ID, Type: template.Requirement, Description: &text, OrderIndex: 1, Courses: []template.CourseItem{{ID: got.Items[1].Courses[0].ID, Type: template.Fixed, CourseID: &courseID, CourseCode: &code}}},
		{ID: got.Items[2].ID, Type: template.Separator, OrderIndex: 2, Courses: []template.CourseItem{}},
		{ID: got.Items[3].ID, Type: template.Requirement, Description: &text, OrderIndex: 3, Courses: []template.CourseItem{{ID: got.Items[3].Courses[0].ID, Type: template.Free}, {ID: got.Items[3].Courses[1].ID, Type: template.Free}}},
	}}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	if _, err := repo.Create(t.Context(), draft); !errors.Is(err, template.ErrNameExists) {
		t.Fatalf("duplicate: %v", err)
	}
	copyDraft := draft
	copyDraft.Actor = user.User{ID: "other"}
	copyDraft.Name = "Copy"
	copied, err := repo.Create(t.Context(), copyDraft)
	if err != nil {
		t.Fatal(err)
	}
	copyView, err := repo.Get(t.Context(), template.Reference{Actor: owner, ID: copied.ID})
	if err != nil {
		t.Fatal(err)
	}
	if copyView.Items[0].ID == got.Items[0].ID {
		t.Fatal("copy reused original item ID")
	}
	failed := draft
	failed.Name = "Missing course"
	failed.Items = append([]template.DraftItem(nil), draft.Items...)
	failed.Items[1].CourseCodes = []string{"UNKNOWN"}
	if _, err := repo.Create(t.Context(), failed); !errors.Is(err, template.ErrCourseNotFound) {
		t.Fatalf("missing course: %v", err)
	}
	list, err := repo.List(t.Context(), template.List{Actor: owner})
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]template.Template{copied, created}, list); diff != "" {
		t.Fatal(diff)
	}
}

func TestTemplateManagementRequiresOwnerOrAdmin(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'),('other','other@example.test'),('admin','admin@example.test');
 INSERT INTO template(id,name) VALUES ('11111111-1111-4111-8111-111111111111','Built-in');`)
	if err != nil {
		t.Fatal(err)
	}
	repo := repository.NewTemplateRepository(pool)
	owner := user.User{ID: "owner"}
	admin := user.User{ID: "admin", Role: user.RoleAdmin}
	created, err := repo.Create(t.Context(), template.Draft{Actor: owner, Name: "Original"})
	if err != nil {
		t.Fatal(err)
	}
	otherTemplate, err := repo.Create(t.Context(), template.Draft{Actor: user.User{ID: "other"}, Name: "Existing"})
	if err != nil {
		t.Fatal(err)
	}
	ownList, err := repo.List(t.Context(), template.List{Actor: owner, OwnedOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]template.Template{created}, ownList); diff != "" {
		t.Fatal(diff)
	}
	for _, actor := range []user.User{{ID: "other", Role: user.RoleUser}, {ID: "other", Role: user.RoleModerator}, {ID: "admin", Role: user.RoleUser}} {
		reference := template.Reference{Actor: actor, ID: created.ID}
		if err := repo.Rename(t.Context(), template.Rename{Reference: reference, Name: "Forbidden"}); !errors.Is(err, template.ErrNotFound) {
			t.Fatalf("foreign rename: %v", err)
		}
		if err := repo.Delete(t.Context(), reference); !errors.Is(err, template.ErrNotFound) {
			t.Fatalf("foreign delete: %v", err)
		}
	}
	ownRef := template.Reference{Actor: owner, ID: created.ID}
	if err := repo.Rename(t.Context(), template.Rename{Reference: ownRef, Name: otherTemplate.Name}); !errors.Is(err, template.ErrNameExists) {
		t.Fatalf("duplicate rename: %v", err)
	}
	description := "Updated description"
	if err := repo.Rename(t.Context(), template.Rename{Reference: ownRef, Name: "Renamed", Description: &description}); err != nil {
		t.Fatal(err)
	}
	adminRef := template.Reference{Actor: admin, ID: created.ID}
	if err := repo.Rename(t.Context(), template.Rename{Reference: adminRef, Name: "Admin rename", Description: &description}); err != nil {
		t.Fatal(err)
	}
	got, err := repo.Get(t.Context(), ownRef)
	if err != nil {
		t.Fatal(err)
	}
	expected := created
	expected.Name = "Admin rename"
	expected.Description = &description
	if diff := cmp.Diff(template.Definition{Template: expected, Items: []template.Item{}}, got); diff != "" {
		t.Fatal(diff)
	}
	builtin := template.Reference{Actor: owner, ID: uuid.MustParse("11111111-1111-4111-8111-111111111111")}
	if err := repo.Delete(t.Context(), builtin); !errors.Is(err, template.ErrNotFound) {
		t.Fatalf("built-in owner: %v", err)
	}
	builtin.Actor = admin
	if err := repo.Delete(t.Context(), builtin); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(t.Context(), ownRef); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Get(t.Context(), ownRef); !errors.Is(err, template.ErrNotFound) {
		t.Fatalf("deleted template: %v", err)
	}
	if err := repo.Delete(t.Context(), template.Reference{Actor: admin, ID: otherTemplate.ID}); err != nil {
		t.Fatal(err)
	}
	empty, err := repo.List(t.Context(), template.List{Actor: owner})
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]template.Template{}, empty); diff != "" {
		t.Fatal(diff)
	}
}
