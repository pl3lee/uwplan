package template_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
)

func TestSeedNormalizesWithoutAnActorAndDoesNotChangeCaller(t *testing.T) {
	t.Parallel()
	description := "Core"
	input := template.Seed{Templates: []template.Blueprint{{Name: " Z ", Items: []template.DraftItem{{Type: template.Requirement, Description: &description, CourseType: template.Fixed, CourseCodes: []string{"cs 135"}}}}, {Name: "A"}}}
	got, err := input.Normalize()
	if err != nil {
		t.Fatal(err)
	}
	want := template.Seed{Templates: []template.Blueprint{{Name: "A", Items: []template.DraftItem{}}, {Name: "Z", Items: []template.DraftItem{{Type: template.Requirement, Description: &description, CourseType: template.Fixed, CourseCodes: []string{"CS135"}}}}}}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	if input.Templates[0].Name != " Z " || input.Templates[0].Items[0].CourseCodes[0] != "cs 135" {
		t.Fatal("caller changed")
	}
}

func TestSeedRejectsEmptyDuplicateAndInvalidDefinitions(t *testing.T) {
	t.Parallel()
	for _, input := range []template.Seed{
		{},
		{Templates: []template.Blueprint{{Name: "A"}, {Name: " A "}}},
		{Templates: []template.Blueprint{{Name: " "}}},
		{Templates: []template.Blueprint{{Name: "A", Items: []template.DraftItem{{Type: template.Requirement}}}}},
	} {
		if _, err := input.Normalize(); !errors.Is(err, template.ErrInvalid) {
			t.Fatalf("got %v", err)
		}
	}
}
