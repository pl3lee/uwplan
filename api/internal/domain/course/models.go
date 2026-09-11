package course

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Course retains catalog identity and the information shown in planning views.
type Course struct {
	ID                                                 uuid.UUID
	Code, Name, Description, Prereqs, Antireqs, Coreqs string
	UsefulRating, LikedRating, EasyRating              *string
	NumRatings                                         *int32
}

type Import struct{ Courses []Course }
type ImportResult struct{ Courses int }

// Normalize validates the complete import before any catalog writes. Imported
// records use course codes as keys; database identities never come from upstream.
func (i Import) Normalize() (Import, error) {
	if len(i.Courses) == 0 {
		return Import{}, ErrInvalidImport
	}
	result := Import{Courses: append([]Course(nil), i.Courses...)}
	seen := make(map[string]bool, len(result.Courses))
	for index, item := range result.Courses {
		item.Code = strings.ToUpper(strings.Join(strings.Fields(item.Code), ""))
		if item.ID != uuid.Nil || item.Code == "" || utf8.RuneCountInString(item.Code) > 10 || strings.TrimSpace(item.Name) == "" || utf8.RuneCountInString(item.Name) > 255 || seen[item.Code] {
			return Import{}, ErrInvalidImport
		}
		for _, rating := range []*string{item.UsefulRating, item.LikedRating, item.EasyRating} {
			if rating == nil {
				continue
			}
			value, err := strconv.ParseFloat(*rating, 64)
			if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
				return Import{}, ErrInvalidImport
			}
		}
		if item.NumRatings != nil && *item.NumRatings < 0 {
			return Import{}, ErrInvalidImport
		}
		seen[item.Code] = true
		result.Courses[index] = item
	}
	sort.Slice(result.Courses, func(a, b int) bool { return result.Courses[a].Code < result.Courses[b].Code })
	return result, nil
}
