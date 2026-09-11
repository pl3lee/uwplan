package template_test

import (
	"errors"
	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"testing"
)

func TestDraftNormalizesCourseCodesAndKeepsItemOrder(t *testing.T) {
	t.Parallel()
	instruction, requirement := "Complete the core", "Core courses"
	draft := template.Draft{Actor: user.User{ID: "legacy-user"}, Name: "Mathematics", Items: []template.DraftItem{
		{Type: template.Instruction, Description: &instruction},
		{Type: template.Requirement, Description: &requirement, CourseType: template.Fixed, CourseCodes: []string{"cs 135", "MATH135"}},
		{Type: template.Separator},
		{Type: template.Requirement, Description: &requirement, CourseType: template.Free, CourseCount: 2},
	}}
	got, err := draft.Normalize()
	if err != nil {
		t.Fatal(err)
	}
	want := draft
	want.Items = append([]template.DraftItem(nil), draft.Items...)
	want.Items[1].CourseCodes = []string{"CS135", "MATH135"}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	if draft.Items[1].CourseCodes[0] != "cs 135" {
		t.Fatal("normalization mutated caller input")
	}
}

func TestDraftRejectsInvalidItemCombinations(t *testing.T) {
	t.Parallel()
	description := "Choose courses"
	for _, tc := range []struct {
		name string
		item template.DraftItem
	}{
		{"unknown", template.DraftItem{Type: "unknown"}},
		{"blank instruction", template.DraftItem{Type: template.Instruction}},
		{"separator courses", template.DraftItem{Type: template.Separator, CourseCodes: []string{"CS135"}}},
		{"missing fixed courses", template.DraftItem{Type: template.Requirement, Description: &description, CourseType: template.Fixed}},
		{"blank code", template.DraftItem{Type: template.Requirement, Description: &description, CourseType: template.Fixed, CourseCodes: []string{" "}}},
		{"free codes", template.DraftItem{Type: template.Requirement, Description: &description, CourseType: template.Free, CourseCount: 1, CourseCodes: []string{"CS135"}}},
		{"zero free courses", template.DraftItem{Type: template.Requirement, Description: &description, CourseType: template.Free}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := (template.Draft{Actor: user.User{ID: "owner"}, Name: "Plan", Items: []template.DraftItem{tc.item}}).Normalize()
			if !errors.Is(err, template.ErrInvalid) {
				t.Fatalf("got %v", err)
			}
		})
	}
}
