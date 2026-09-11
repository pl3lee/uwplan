package seed

import (
	"context"
	"fmt"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
)

type SeedServiceImpl struct {
	gateway    TemplateGateway
	repository TemplateRepository
}

func NewSeedService(gateway TemplateGateway, repository TemplateRepository) *SeedServiceImpl {
	return &SeedServiceImpl{gateway: gateway, repository: repository}
}

func (s *SeedServiceImpl) Seed(ctx context.Context) (template.SeedResult, error) {
	definitions, err := s.gateway.Fetch(ctx)
	if err != nil {
		return template.SeedResult{}, fmt.Errorf("load seed templates: %w", err)
	}
	definitions, err = definitions.Normalize()
	if err != nil {
		return template.SeedResult{}, fmt.Errorf("validate seed templates: %w", err)
	}
	result, err := s.repository.Seed(ctx, definitions)
	if err != nil {
		return template.SeedResult{}, fmt.Errorf("store seed templates: %w", err)
	}
	return result, nil
}
