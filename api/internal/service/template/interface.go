package template

import (
	"context"
	domaintemplate "github.com/pl3lee/uwplan/api/internal/domain/template"
)

type TemplateRepository interface {
	List(context.Context, domaintemplate.List) ([]domaintemplate.Template, error)
	Get(context.Context, domaintemplate.Reference) (domaintemplate.Definition, error)
	Create(context.Context, domaintemplate.Draft) (domaintemplate.Template, error)
	Rename(context.Context, domaintemplate.Rename) error
	Delete(context.Context, domaintemplate.Reference) error
}
