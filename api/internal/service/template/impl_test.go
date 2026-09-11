package template_test

import (
	"errors"
	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	service "github.com/pl3lee/uwplan/api/internal/service/template"
	"github.com/stretchr/testify/mock"
	"testing"
)

func TestCreateNormalizesBeforeStorageAndPreservesConflicts(t *testing.T) {
	t.Parallel()
	repo := service.NewTemplateRepositoryMock(t)
	description := "Core"
	input := template.Draft{Actor: user.User{ID: "owner"}, Name: " Plan ", Items: []template.DraftItem{{Type: template.Requirement, Description: &description, CourseType: template.Fixed, CourseCodes: []string{"cs 135"}}}}
	expected := template.Draft{Actor: input.Actor, Name: "Plan", Items: []template.DraftItem{{Type: template.Requirement, Description: &description, CourseType: template.Fixed, CourseCodes: []string{"CS135"}}}}
	repo.EXPECT().Create(mock.Anything, expected).Return(template.Template{}, template.ErrNameExists).Once()
	_, err := service.NewTemplateService(repo).Create(t.Context(), input)
	if !errors.Is(err, template.ErrNameExists) {
		t.Fatalf("got %v", err)
	}
}

func TestInvalidTemplateCommandsDoNotReachStorage(t *testing.T) {
	t.Parallel()
	repo := service.NewTemplateRepositoryMock(t)
	svc := service.NewTemplateService(repo)
	for _, run := range []func() error{
		func() error { _, err := svc.Create(t.Context(), template.Draft{}); return err },
		func() error { _, err := svc.List(t.Context(), template.List{}); return err },
		func() error { _, err := svc.Get(t.Context(), template.Reference{}); return err },
		func() error { return svc.Rename(t.Context(), template.Rename{}) },
		func() error { return svc.Delete(t.Context(), template.Reference{}) },
	} {
		if err := run(); !errors.Is(err, template.ErrInvalid) {
			t.Fatalf("got %v", err)
		}
	}
}

func TestTemplateReadsAndManagementPreserveActorScope(t *testing.T) {
	t.Parallel()
	repo := service.NewTemplateRepositoryMock(t)
	svc := service.NewTemplateService(repo)
	actor := user.User{ID: "admin", Role: user.RoleAdmin}
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	reference := template.Reference{Actor: actor, ID: id}
	input := template.List{Actor: actor, OwnedOnly: true}
	want := []template.Template{{ID: id, Name: "Plan"}}
	repo.EXPECT().List(mock.Anything, input).Return(want, nil).Once()
	got, err := svc.List(t.Context(), input)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	definition := template.Definition{Template: want[0], Items: []template.Item{}}
	repo.EXPECT().Get(mock.Anything, reference).Return(definition, nil).Once()
	gotDefinition, err := svc.Get(t.Context(), reference)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(definition, gotDefinition); diff != "" {
		t.Fatal(diff)
	}
	repo.EXPECT().Rename(mock.Anything, template.Rename{Reference: reference, Name: "Renamed"}).Return(nil).Once()
	if err := svc.Rename(t.Context(), template.Rename{Reference: reference, Name: " Renamed "}); err != nil {
		t.Fatal(err)
	}
	repo.EXPECT().Delete(mock.Anything, reference).Return(template.ErrNotFound).Once()
	if err := svc.Delete(t.Context(), reference); !errors.Is(err, template.ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}
