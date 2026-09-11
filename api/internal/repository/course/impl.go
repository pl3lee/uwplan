package course

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	domaincourse "github.com/pl3lee/uwplan/api/internal/domain/course"
	"github.com/pl3lee/uwplan/api/internal/repository/db/sqlc"
)

type CourseRepositoryImpl struct{ pool *pgxpool.Pool }

func NewCourseRepository(pool *pgxpool.Pool) *CourseRepositoryImpl {
	return &CourseRepositoryImpl{pool: pool}
}

func (r *CourseRepositoryImpl) List(ctx context.Context) ([]domaincourse.Course, error) {
	rows, err := sqlc.New(r.pool).ListCatalogCourses(ctx)
	if err != nil {
		return nil, fmt.Errorf("list catalog courses: %w", err)
	}
	result := make([]domaincourse.Course, 0, len(rows))
	for _, row := range rows {
		item, err := FromRow(row)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

// FromRow translates persisted catalog data for repositories that embed courses.
func FromRow(row sqlc.Course) (domaincourse.Course, error) {
	result := domaincourse.Course{ID: row.ID, Code: row.Code, Name: row.Name, Description: row.Description, Prereqs: row.Prereqs, Antireqs: row.Antireqs, Coreqs: row.Coreqs, NumRatings: row.NumRatings}
	for _, rating := range []struct {
		stored pgtype.Numeric
		target **string
	}{{row.UsefulRating, &result.UsefulRating}, {row.LikedRating, &result.LikedRating}, {row.EasyRating, &result.EasyRating}} {
		value, err := rating.stored.Value()
		if err != nil {
			return domaincourse.Course{}, fmt.Errorf("decode course rating: %w", err)
		}
		if value != nil {
			text := value.(string)
			*rating.target = &text
		}
	}
	return result, nil
}
