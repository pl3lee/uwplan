package api

import (
	"context"

	"github.com/pl3lee/uwplan/api/internal/domain/course"

	"github.com/pl3lee/uwplan/api/internal/domain/health"
	"github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

type AuthService interface {
	Authenticate(context.Context, session.Credentials) (user.User, error)
	Logout(context.Context, session.Credentials) error
}

type CourseService interface {
	List(context.Context) ([]course.Course, error)
}

type TemplateService interface {
	List(context.Context, template.List) ([]template.Template, error)
	Get(context.Context, template.Reference) (template.Definition, error)
	Create(context.Context, template.Draft) (template.Template, error)
	Rename(context.Context, template.Rename) error
	Delete(context.Context, template.Reference) error
}

type ScheduleService interface {
	List(context.Context, user.User) (schedule.Collection, error)
	View(context.Context, schedule.Reference) (schedule.View, error)
	Create(context.Context, schedule.Create) (schedule.Schedule, error)
	Rename(context.Context, schedule.Rename) error
	Delete(context.Context, schedule.Reference) error
	Assign(context.Context, schedule.Assign) error
	RemoveCourse(context.Context, schedule.RemoveCourse) error
	GetTermRange(context.Context, user.User) (term.Range, error)
	ChangeTermRange(context.Context, schedule.TermRangeChange) error
}

type HealthGateway interface {
	Check(context.Context) health.Report
}

type OAuthService interface {
	Begin(context.Context, oauth.Start) (oauth.Redirect, error)
	Complete(context.Context, oauth.Callback) (oauth.Login, error)
}
