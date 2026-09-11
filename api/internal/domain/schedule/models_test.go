package schedule_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	"github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
)

func TestScheduleExportPreservesCSVSectionsAndEscapesNames(t *testing.T) {
	t.Parallel()
	export := schedule.Export{Selected: []course.Course{{Code: "CS135", Name: "Designing Functional Programs"}, {Code: "CS136", Name: "Topics, \"Algorithms\""}}, Assigned: []schedule.Assignment{{Course: course.Course{Code: "CS135"}, Term: term.Term{Season: term.Winter, Year: 2027}}, {Course: course.Course{Code: "CS136"}, Term: term.Term{Season: term.Fall, Year: 2027}}}}
	data, err := export.CSV()
	if err != nil {
		t.Fatal(err)
	}
	want := "Selected Courses:\nCS135 - Designing Functional Programs\n\"CS136 - Topics, \"\"Algorithms\"\"\"\n\nScheduled Courses:\nWinter 2027,Fall 2027\nCS135,CS136\n"
	if diff := cmp.Diff(want, string(data)); diff != "" {
		t.Fatal(diff)
	}
}

func TestScheduleMutationValidation(t *testing.T) {
	t.Parallel()
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	ref := schedule.Reference{UserID: "legacy-user", ID: id}
	for _, tc := range []struct {
		name     string
		validate func() error
		valid    bool
	}{
		{"valid name", (schedule.Create{UserID: "legacy-user", Name: "My Schedule"}).Validate, true},
		{"empty name", (schedule.Create{UserID: "legacy-user", Name: " "}).Validate, false},
		{"long name", (schedule.Create{UserID: "legacy-user", Name: strings.Repeat("x", 256)}).Validate, false},
		{"missing owner", (schedule.Create{Name: "Schedule"}).Validate, false},
		{"rename", (schedule.Rename{Reference: ref, Name: "New name"}).Validate, true},
		{"missing schedule", (schedule.Rename{Name: "New name"}).Validate, false},
		{"valid assignment", (schedule.Assign{Reference: ref, CourseID: id, Term: term.Term{Season: term.Fall, Year: 2027}}).Validate, true},
		{"invalid term", (schedule.Assign{Reference: ref, CourseID: id, Term: term.Term{Season: "Summer", Year: 2027}}).Validate, false},
		{"missing course", (schedule.Assign{Reference: ref, Term: term.Term{Season: term.Fall, Year: 2027}}).Validate, false},
		{"valid removal", (schedule.RemoveCourse{Reference: ref, CourseID: id}).Validate, true},
		{"removal without course", (schedule.RemoveCourse{Reference: ref}).Validate, false},
		{"removal without owner", (schedule.RemoveCourse{CourseID: id}).Validate, false},
		{"valid range", (schedule.TermRangeChange{UserID: "user", Range: term.Range{Start: term.Term{Season: term.Fall, Year: 2026}, End: term.Term{Season: term.Fall, Year: 2031}}}).Validate, true},
		{"range without owner", (schedule.TermRangeChange{Range: term.Range{Start: term.Term{Season: term.Fall, Year: 2026}, End: term.Term{Season: term.Fall, Year: 2031}}}).Validate, false},
		{"reversed range", (schedule.TermRangeChange{UserID: "user", Range: term.Range{Start: term.Term{Season: term.Fall, Year: 2031}, End: term.Term{Season: term.Fall, Year: 2026}}}).Validate, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.validate()
			if tc.valid && err != nil {
				t.Fatal(err)
			}
			if !tc.valid && !errors.Is(err, schedule.ErrInvalid) {
				t.Fatalf("expected invalid input, got %v", err)
			}
		})
	}
}

func TestScheduleCollectionRetainsAtLeastOneSchedule(t *testing.T) {
	t.Parallel()
	id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	other := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	for _, tc := range []struct {
		name      string
		schedules []schedule.Schedule
		id        uuid.UUID
		want      error
	}{
		{"last schedule", []schedule.Schedule{{ID: id}}, id, schedule.ErrLastSchedule},
		{"unknown schedule", []schedule.Schedule{{ID: id}}, other, schedule.ErrNotFound},
		{"remove one of two", []schedule.Schedule{{ID: id}, {ID: other}}, id, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := (schedule.Collection{Schedules: tc.schedules}).ValidateRemoval(tc.id)
			if !errors.Is(got, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, got)
			}
		})
	}
}
