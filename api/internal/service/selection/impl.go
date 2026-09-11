package selection

import (
	"context"
	"fmt"

	domainselection "github.com/pl3lee/uwplan/api/internal/domain/selection"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

type SelectionServiceImpl struct{ repository SelectionRepository }

func NewSelectionService(repository SelectionRepository) *SelectionServiceImpl {
	return &SelectionServiceImpl{repository: repository}
}

func (s *SelectionServiceImpl) State(ctx context.Context, actor user.User) (domainselection.State, error) {
	if actor.ID == "" {
		return domainselection.State{}, domainselection.ErrInvalid
	}
	result, err := s.repository.State(ctx, actor)
	if err != nil {
		return domainselection.State{}, fmt.Errorf("read course selections: %w", err)
	}
	return result, nil
}

func (s *SelectionServiceImpl) SetTemplate(ctx context.Context, input domainselection.Membership) error {
	if err := input.Validate(); err != nil {
		return err
	}
	if err := s.repository.SetTemplate(ctx, input); err != nil {
		return fmt.Errorf("set template membership: %w", err)
	}
	return nil
}

func (s *SelectionServiceImpl) SetChoice(ctx context.Context, input domainselection.Toggle) error {
	if err := input.Validate(); err != nil {
		return err
	}
	if err := s.repository.SetChoice(ctx, input); err != nil {
		return fmt.Errorf("set course selection: %w", err)
	}
	return nil
}

func (s *SelectionServiceImpl) ChangeFreeCourse(ctx context.Context, input domainselection.FreeCourseChange) error {
	if err := input.Validate(); err != nil {
		return err
	}
	if err := s.repository.ChangeFreeCourse(ctx, input); err != nil {
		return fmt.Errorf("change free course selection: %w", err)
	}
	return nil
}

func (s *SelectionServiceImpl) RemoveCourse(ctx context.Context, input domainselection.Removal) error {
	if err := input.Validate(); err != nil {
		return err
	}
	if err := s.repository.RemoveCourse(ctx, input); err != nil {
		return fmt.Errorf("remove selected course: %w", err)
	}
	return nil
}
