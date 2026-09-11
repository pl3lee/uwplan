package schedule

import (
	"context"
	domainschedule "github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

type ScheduleRepository interface {
	List(context.Context, user.User) (domainschedule.Collection, error)
	View(context.Context, domainschedule.Reference) (domainschedule.View, error)
	Create(context.Context, domainschedule.Create) (domainschedule.Schedule, error)
	Rename(context.Context, domainschedule.Rename) error
	Delete(context.Context, domainschedule.Reference) error
	Assign(context.Context, domainschedule.Assign) error
	RemoveCourse(context.Context, domainschedule.RemoveCourse) error
	GetTermRange(context.Context, user.User) (term.Range, error)
	ChangeTermRange(context.Context, domainschedule.TermRangeChange) error
}
