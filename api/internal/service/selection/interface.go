package selection

import (
	"context"
	domainselection "github.com/pl3lee/uwplan/api/internal/domain/selection"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

type SelectionRepository interface {
	State(context.Context, user.User) (domainselection.State, error)
	SetTemplate(context.Context, domainselection.Membership) error
	SetChoice(context.Context, domainselection.Toggle) error
	ChangeFreeCourse(context.Context, domainselection.FreeCourseChange) error
	RemoveCourse(context.Context, domainselection.Removal) error
}
