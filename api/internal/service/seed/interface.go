package seed

import (
	"context"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
)

type TemplateGateway interface {
	Fetch(context.Context) (template.Seed, error)
}

type TemplateRepository interface {
	Seed(context.Context, template.Seed) (template.SeedResult, error)
}
