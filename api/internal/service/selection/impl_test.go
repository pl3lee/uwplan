package selection_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/selection"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	service "github.com/pl3lee/uwplan/api/internal/service/selection"
	"github.com/stretchr/testify/mock"
)

func TestInvalidSelectionCommandsDoNotReachStorage(t *testing.T) {
	t.Parallel()
	repo := service.NewSelectionRepositoryMock(t)
	svc := service.NewSelectionService(repo)
	for _, run := range []func() error{
		func() error { _, err := svc.State(t.Context(), user.User{}); return err },
		func() error { return svc.SetTemplate(t.Context(), selection.Membership{}) },
		func() error { return svc.SetChoice(t.Context(), selection.Toggle{}) },
		func() error { return svc.ChangeFreeCourse(t.Context(), selection.FreeCourseChange{}) },
		func() error { return svc.RemoveCourse(t.Context(), selection.Removal{}) },
	} {
		if err := run(); !errors.Is(err, selection.ErrInvalid) {
			t.Fatalf("got %v", err)
		}
	}
}

func TestSelectionServiceKeepsIdentityAndErrorsAcrossStorage(t *testing.T) {
	t.Parallel()
	repo := service.NewSelectionRepositoryMock(t)
	svc := service.NewSelectionService(repo)
	actor := user.User{ID: "owner"}
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	want := selection.State{TemplateIDs: []uuid.UUID{id}, Choices: []selection.Choice{{ItemID: id}}}
	repo.EXPECT().State(mock.Anything, actor).Return(want, nil).Once()
	got, err := svc.State(t.Context(), actor)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	repo.EXPECT().State(mock.Anything, actor).Return(selection.State{}, selection.ErrNotFound).Once()
	if _, err := svc.State(t.Context(), actor); !errors.Is(err, selection.ErrNotFound) {
		t.Fatalf("state error: %v", err)
	}
	membership := selection.Membership{UserID: actor.ID, TemplateID: id, Selected: true}
	toggle := selection.Toggle{UserID: actor.ID, ItemID: id, Selected: true}
	free := selection.FreeCourseChange{UserID: actor.ID, ItemID: id}
	removal := selection.Removal{UserID: actor.ID, CourseID: id}
	repo.EXPECT().SetTemplate(mock.Anything, membership).Return(selection.ErrNotFound).Once()
	repo.EXPECT().SetChoice(mock.Anything, toggle).Return(selection.ErrNotFound).Once()
	repo.EXPECT().ChangeFreeCourse(mock.Anything, free).Return(selection.ErrNotFound).Once()
	repo.EXPECT().RemoveCourse(mock.Anything, removal).Return(selection.ErrNotFound).Once()
	for _, run := range []func() error{
		func() error { return svc.SetTemplate(t.Context(), membership) },
		func() error { return svc.SetChoice(t.Context(), toggle) },
		func() error { return svc.ChangeFreeCourse(t.Context(), free) },
		func() error { return svc.RemoveCourse(t.Context(), removal) },
	} {
		if err := run(); !errors.Is(err, selection.ErrNotFound) {
			t.Fatalf("mutation error: %v", err)
		}
	}
}
