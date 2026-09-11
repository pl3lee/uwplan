package course

import (
	"context"
	domaincourse "github.com/pl3lee/uwplan/api/internal/domain/course"
)

type CourseRepository interface {
	List(context.Context) ([]domaincourse.Course, error)
}
