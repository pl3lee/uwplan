package template

import (
	"context"
	"fmt"
	domaintemplate "github.com/pl3lee/uwplan/api/internal/domain/template"
)

type TemplateServiceImpl struct{ repository TemplateRepository }

func NewTemplateService(repository TemplateRepository) *TemplateServiceImpl {
	return &TemplateServiceImpl{repository: repository}
}

func (s *TemplateServiceImpl) List(ctx context.Context, input domaintemplate.List) ([]domaintemplate.Template, error) {
	if err := input.Validate(); err != nil {
		return nil, err
	}
	rows, err := s.repository.List(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("list templates: %w", err)
	}
	return rows, nil
}
func (s *TemplateServiceImpl) Get(ctx context.Context, input domaintemplate.Reference) (domaintemplate.Definition, error) {
	if err := input.Validate(); err != nil {
		return domaintemplate.Definition{}, err
	}
	result, err := s.repository.Get(ctx, input)
	if err != nil {
		return domaintemplate.Definition{}, fmt.Errorf("get template: %w", err)
	}
	return result, nil
}
func (s *TemplateServiceImpl) Create(ctx context.Context, input domaintemplate.Draft) (domaintemplate.Template, error) {
	normalized, err := input.Normalize()
	if err != nil {
		return domaintemplate.Template{}, err
	}
	result, err := s.repository.Create(ctx, normalized)
	if err != nil {
		return domaintemplate.Template{}, fmt.Errorf("create template: %w", err)
	}
	return result, nil
}
func (s *TemplateServiceImpl) Rename(ctx context.Context, input domaintemplate.Rename) error {
	normalized, err := input.Normalize()
	if err != nil {
		return err
	}
	if err := s.repository.Rename(ctx, normalized); err != nil {
		return fmt.Errorf("rename template: %w", err)
	}
	return nil
}
func (s *TemplateServiceImpl) Delete(ctx context.Context, input domaintemplate.Reference) error {
	if err := input.Validate(); err != nil {
		return err
	}
	if err := s.repository.Delete(ctx, input); err != nil {
		return fmt.Errorf("delete template: %w", err)
	}
	return nil
}
