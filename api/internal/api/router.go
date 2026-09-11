package api

import (
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/pl3lee/uwplan/api/internal/config"
)

type Dependencies struct {
	Auth       AuthService
	Admin      AdminService
	Health     HealthGateway
	OAuth      OAuthService
	Schedules  ScheduleService
	Courses    CourseService
	Templates  TemplateService
	Selections SelectionService
}

func NewRouter(cfg config.Config, deps Dependencies) (http.Handler, huma.API) {
	router := chi.NewRouter()
	router.Use(requestContext(cfg))
	hc := huma.DefaultConfig("UWPlan API", "1.0.0")
	// Keep response bodies exactly equal to the documented DTOs, without a
	// dynamically added $schema field. JSON/YAML specs still describe every route.
	hc.CreateHooks = nil
	hc.OpenAPIPath = "/api/openapi"
	hc.DocsPath = "/api/docs"
	hc.SchemasPath = ""
	hc.Components.SecuritySchemes = map[string]*huma.SecurityScheme{"session": {Type: "apiKey", In: "cookie", Name: cfg.CookieName()}}
	app := humachi.New(router, hc)
	registerHealth(app, deps.Health, cfg.Release)
	registerAuth(app, cfg, deps.Auth)
	registerAdmin(app, cfg, deps.Auth, deps.Admin)
	registerOAuth(app, cfg, deps.OAuth)
	registerSchedules(app, cfg, deps.Auth, deps.Schedules)
	registerCourses(app, cfg, deps.Auth, deps.Courses)
	registerTemplates(app, cfg, deps.Auth, deps.Templates)
	registerSelections(app, cfg, deps.Auth, deps.Selections)
	return router, app
}
