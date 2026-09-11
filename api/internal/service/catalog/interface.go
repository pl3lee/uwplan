package catalog

import (
	"context"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
)

type CourseGateway interface {
	Fetch(context.Context) (course.Import, error)
}

type CourseRepository interface {
	Import(context.Context, course.Import) error
}
