package term

import (
	"fmt"
	"strconv"
	"strings"
)

type Season string

const (
	Winter Season = "Winter"
	Spring Season = "Spring"
	Fall   Season = "Fall"
)

// Term retains the season/year identity used by existing saved schedules.
type Term struct {
	Season Season
	Year   int
}

type Range struct {
	Start Term
	End   Term
}

func Parse(value string) (Term, error) {
	parts := strings.Fields(value)
	if len(parts) != 2 {
		return Term{}, ErrInvalid
	}
	year, err := strconv.Atoi(parts[1])
	if err != nil {
		return Term{}, ErrInvalid
	}
	result := Term{Season: Season(parts[0]), Year: year}
	if !result.Valid() {
		return Term{}, ErrInvalid
	}
	return result, nil
}

func (t Term) Valid() bool {
	return t.Year >= 1 && t.Year <= 9999 && (t.Season == Winter || t.Season == Spring || t.Season == Fall)
}

func (t Term) String() string { return fmt.Sprintf("%s %d", t.Season, t.Year) }

func (t Term) ordinal() int {
	season := 0
	switch t.Season {
	case Spring:
		season = 1
	case Fall:
		season = 2
	}
	return t.Year*3 + season
}

func (r Range) Terms() ([]Term, error) {
	if !r.Start.Valid() || !r.End.Valid() || r.Start.ordinal() > r.End.ordinal() {
		return nil, ErrInvalid
	}
	seasons := [...]Season{Winter, Spring, Fall}
	terms := make([]Term, 0, r.End.ordinal()-r.Start.ordinal()+1)
	for n := r.Start.ordinal(); n <= r.End.ordinal(); n++ {
		terms = append(terms, Term{Season: seasons[n%3], Year: n / 3})
	}
	return terms, nil
}
