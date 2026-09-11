package course

import (
	"context"
	"fmt"
	domaincourse "github.com/pl3lee/uwplan/api/internal/domain/course"
)

type CourseServiceImpl struct{ repository CourseRepository }

func NewCourseService(repository CourseRepository) *CourseServiceImpl {
	return &CourseServiceImpl{repository: repository}
}

func (s *CourseServiceImpl) List(ctx context.Context) ([]domaincourse.Course, error) {
	courses, err := s.repository.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("read course catalog: %w", err)
	}
	return courses, nil
}
