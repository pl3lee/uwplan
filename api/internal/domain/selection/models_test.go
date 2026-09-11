package selection_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/selection"
)

func TestSelectionCommandsRejectMissingIdentityOrTarget(t *testing.T) {
	t.Parallel()
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	nilID := uuid.Nil
	for _, tc := range []struct {
		name     string
		validate func() error
	}{
		{"membership actor", (selection.Membership{TemplateID: id}).Validate},
		{"membership template", (selection.Membership{UserID: "owner"}).Validate},
		{"toggle actor", (selection.Toggle{ItemID: id}).Validate},
		{"toggle item", (selection.Toggle{UserID: "owner"}).Validate},
		{"free actor", (selection.FreeCourseChange{ItemID: id}).Validate},
		{"free item", (selection.FreeCourseChange{UserID: "owner"}).Validate},
		{"free course", (selection.FreeCourseChange{UserID: "owner", ItemID: id, CourseID: &nilID}).Validate},
		{"removal actor", (selection.Removal{CourseID: id}).Validate},
		{"removal course", (selection.Removal{UserID: "owner"}).Validate},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.validate(); !errors.Is(err, selection.ErrInvalid) {
				t.Fatalf("got %v", err)
			}
		})
	}
	if err := (selection.FreeCourseChange{UserID: "owner", ItemID: id}).Validate(); err != nil {
		t.Fatalf("clearing a valid free slot: %v", err)
	}
}

func TestSelectedCourseIDsDeduplicateFilledSelections(t *testing.T) {
	t.Parallel()
	first := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	second := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	state := selection.State{Choices: []selection.Choice{
		{CourseID: &first, Selected: true},
		{CourseID: &second},
		{Selected: true},
		{CourseID: &first, Selected: true},
		{CourseID: &second, Selected: true},
	}}
	if diff := cmp.Diff([]uuid.UUID{first, second}, state.SelectedCourseIDs()); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff([]uuid.UUID{}, (selection.State{}).SelectedCourseIDs()); diff != "" {
		t.Fatal(diff)
	}
}
