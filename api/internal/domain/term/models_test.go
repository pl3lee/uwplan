package term_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
)

func TestParse(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, input string
		want        term.Term
		invalid     bool
	}{
		{name: "stored fall", input: "Fall 2026", want: term.Term{Season: term.Fall, Year: 2026}},
		{name: "stored winter", input: "Winter 2027", want: term.Term{Season: term.Winter, Year: 2027}},
		{name: "stored spring", input: "Spring 2027", want: term.Term{Season: term.Spring, Year: 2027}},
		{name: "unknown season", input: "Summer 2027", invalid: true},
		{name: "missing year", input: "Fall", invalid: true},
		{name: "non numeric year", input: "Fall abc", invalid: true},
		{name: "zero year", input: "Fall 0", invalid: true},
		{name: "extra tokens", input: "Fall 2026 extra", invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := term.Parse(tc.input)
			if diff := cmp.Diff(tc.invalid, errors.Is(err, term.ErrInvalid)); diff != "" {
				t.Fatalf("error mismatch (-want +got): %s", diff)
			}
			if diff := cmp.Diff(tc.want, got); diff != "" {
				t.Fatalf("term mismatch (-want +got): %s", diff)
			}
			if !tc.invalid {
				if diff := cmp.Diff(tc.input, got.String()); diff != "" {
					t.Fatalf("storage format mismatch: %s", diff)
				}
			}
		})
	}
}

func TestRangeTerms(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name       string
		start, end term.Term
		want       []term.Term
		invalid    bool
	}{
		{name: "academic year crosses calendar year", start: term.Term{Season: term.Fall, Year: 2026}, end: term.Term{Season: term.Spring, Year: 2027}, want: []term.Term{{Season: term.Fall, Year: 2026}, {Season: term.Winter, Year: 2027}, {Season: term.Spring, Year: 2027}}},
		{name: "single term", start: term.Term{Season: term.Winter, Year: 2027}, end: term.Term{Season: term.Winter, Year: 2027}, want: []term.Term{{Season: term.Winter, Year: 2027}}},
		{name: "reversed range", start: term.Term{Season: term.Fall, Year: 2027}, end: term.Term{Season: term.Winter, Year: 2027}, invalid: true},
		{name: "invalid start", start: term.Term{Season: "bad", Year: 2026}, end: term.Term{Season: term.Spring, Year: 2027}, invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := (term.Range{Start: tc.start, End: tc.end}).Terms()
			if diff := cmp.Diff(tc.invalid, errors.Is(err, term.ErrInvalid)); diff != "" {
				t.Fatalf("error mismatch: %s", diff)
			}
			if diff := cmp.Diff(tc.want, got); diff != "" {
				t.Fatalf("terms mismatch: %s", diff)
			}
		})
	}
}
