package course_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
)

func TestCatalogImportNormalizesWithoutChangingCallerData(t *testing.T) {
	t.Parallel()
	rating := "0.875"
	count := int32(123)
	input := course.Import{Courses: []course.Course{{Code: "math 135", Name: "Algebra", UsefulRating: &rating, NumRatings: &count}, {Code: "cs135", Name: "Functional Programs"}}}
	got, err := input.Normalize()
	if err != nil {
		t.Fatal(err)
	}
	want := course.Import{Courses: []course.Course{{Code: "CS135", Name: "Functional Programs"}, {Code: "MATH135", Name: "Algebra", UsefulRating: &rating, NumRatings: &count}}}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff([]string{"math 135", "cs135"}, []string{input.Courses[0].Code, input.Courses[1].Code}); diff != "" {
		t.Fatal(diff)
	}
}

func TestCatalogImportRejectsIncompleteOrConflictingData(t *testing.T) {
	t.Parallel()
	badRating, tooHigh := "NaN", "1.1"
	negative := int32(-1)
	for _, tc := range []struct {
		name    string
		courses []course.Course
	}{
		{"empty", nil},
		{"empty code", []course.Course{{Name: "Course"}}},
		{"empty name", []course.Course{{Code: "CS135"}}},
		{"duplicate codes", []course.Course{{Code: "cs 135", Name: "A"}, {Code: "CS135", Name: "B"}}},
		{"invalid rating", []course.Course{{Code: "CS135", Name: "A", EasyRating: &badRating}}},
		{"rating range", []course.Course{{Code: "CS135", Name: "A", LikedRating: &tooHigh}}},
		{"negative count", []course.Course{{Code: "CS135", Name: "A", NumRatings: &negative}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := (course.Import{Courses: tc.courses}).Normalize()
			if !errors.Is(err, course.ErrInvalidImport) {
				t.Fatalf("got %v", err)
			}
		})
	}
}
