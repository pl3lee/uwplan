package schedule

import (
	"context"
	domainschedule "github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

type ScheduleServiceImpl struct{ repository ScheduleRepository }

func NewScheduleService(repository ScheduleRepository) *ScheduleServiceImpl {
	return &ScheduleServiceImpl{repository: repository}
}
func (s *ScheduleServiceImpl) List(ctx context.Context, actor user.User) (domainschedule.Collection, error) {
	if actor.ID == "" {
		return domainschedule.Collection{}, domainschedule.ErrInvalid
	}
	return s.repository.List(ctx, actor)
}
func (s *ScheduleServiceImpl) View(ctx context.Context, input domainschedule.Reference) (domainschedule.View, error) {
	if err := input.Validate(); err != nil {
		return domainschedule.View{}, err
	}
	return s.repository.View(ctx, input)
}
func (s *ScheduleServiceImpl) Create(ctx context.Context, input domainschedule.Create) (domainschedule.Schedule, error) {
	if err := input.Validate(); err != nil {
		return domainschedule.Schedule{}, err
	}
	return s.repository.Create(ctx, input)
}
func (s *ScheduleServiceImpl) Rename(ctx context.Context, input domainschedule.Rename) error {
	if err := input.Validate(); err != nil {
		return err
	}
	return s.repository.Rename(ctx, input)
}
func (s *ScheduleServiceImpl) Delete(ctx context.Context, input domainschedule.Reference) error {
	if err := input.Validate(); err != nil {
		return err
	}
	return s.repository.Delete(ctx, input)
}
func (s *ScheduleServiceImpl) Assign(ctx context.Context, input domainschedule.Assign) error {
	if err := input.Validate(); err != nil {
		return err
	}
	return s.repository.Assign(ctx, input)
}
func (s *ScheduleServiceImpl) RemoveCourse(ctx context.Context, input domainschedule.RemoveCourse) error {
	if err := input.Validate(); err != nil {
		return err
	}
	return s.repository.RemoveCourse(ctx, input)
}
func (s *ScheduleServiceImpl) GetTermRange(ctx context.Context, actor user.User) (term.Range, error) {
	if actor.ID == "" {
		return term.Range{}, domainschedule.ErrInvalid
	}
	return s.repository.GetTermRange(ctx, actor)
}
func (s *ScheduleServiceImpl) ChangeTermRange(ctx context.Context, input domainschedule.TermRangeChange) error {
	if err := input.Validate(); err != nil {
		return err
	}
	return s.repository.ChangeTermRange(ctx, input)
}
