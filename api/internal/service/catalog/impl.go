package catalog

import (
	"context"
	"fmt"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
)

type CatalogServiceImpl struct {
	gateway    CourseGateway
	repository CourseRepository
}

func NewCatalogService(gateway CourseGateway, repository CourseRepository) *CatalogServiceImpl {
	return &CatalogServiceImpl{gateway: gateway, repository: repository}
}

func (s *CatalogServiceImpl) Update(ctx context.Context) (course.ImportResult, error) {
	data, err := s.gateway.Fetch(ctx)
	if err != nil {
		return course.ImportResult{}, fmt.Errorf("fetch course catalog: %w", err)
	}
	data, err = data.Normalize()
	if err != nil {
		return course.ImportResult{}, fmt.Errorf("validate course catalog: %w", err)
	}
	if err := s.repository.Import(ctx, data); err != nil {
		return course.ImportResult{}, fmt.Errorf("store course catalog: %w", err)
	}
	return course.ImportResult{Courses: len(data.Courses)}, nil
}
