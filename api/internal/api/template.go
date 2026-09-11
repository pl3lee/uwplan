package api

import (
	"context"
	"errors"
	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"net/http"
)

type TemplateBody struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	CreatedBy   *string   `json:"created_by"`
}
type TemplateListResponse struct {
	Body struct {
		Templates []TemplateBody `json:"templates"`
	}
}
type TemplateResponse struct{ Body TemplateBody }
type TemplateListInput struct {
	Scope string `query:"scope" enum:"all,mine" default:"all"`
}
type TemplatePathInput struct {
	ID uuid.UUID `path:"template_id"`
}
type TemplateNameBody struct {
	Name        string  `json:"name" minLength:"1" maxLength:"255"`
	Description *string `json:"description,omitempty"`
}
type TemplateDraftItemBody struct {
	Type        string   `json:"type" enum:"instruction,requirement,separator"`
	Description *string  `json:"description,omitempty"`
	CourseType  string   `json:"course_type,omitempty" enum:"fixed,free"`
	CourseCodes []string `json:"course_codes,omitempty"`
	CourseCount int      `json:"course_count,omitempty" minimum:"0"`
}
type TemplateDraftBody struct {
	TemplateNameBody
	Items []TemplateDraftItemBody `json:"items"`
}
type CreateTemplateInput struct{ Body TemplateDraftBody }
type RenameTemplateInput struct {
	TemplatePathInput
	Body TemplateNameBody
}
type TemplateCourseItemBody struct {
	ID         uuid.UUID  `json:"id"`
	Type       string     `json:"type" enum:"fixed,free"`
	CourseID   *uuid.UUID `json:"course_id" nullable:"true"`
	CourseCode *string    `json:"course_code"`
}
type TemplateItemBody struct {
	ID          uuid.UUID                `json:"id"`
	Type        string                   `json:"type" enum:"instruction,requirement,separator"`
	Description *string                  `json:"description"`
	OrderIndex  int32                    `json:"order_index"`
	Courses     []TemplateCourseItemBody `json:"courses"`
}
type TemplateDefinitionResponse struct {
	Body struct {
		Template TemplateBody       `json:"template"`
		Items    []TemplateItemBody `json:"items"`
	}
}

func templateBody(value template.Template) TemplateBody {
	return TemplateBody{ID: value.ID, Name: value.Name, Description: value.Description, CreatedBy: value.CreatedBy}
}
func (b TemplateDraftBody) domain(actor user.User) template.Draft {
	result := template.Draft{Actor: actor, Name: b.Name, Description: b.Description, Items: make([]template.DraftItem, 0, len(b.Items))}
	for _, item := range b.Items {
		result.Items = append(result.Items, template.DraftItem{Type: template.ItemType(item.Type), Description: item.Description, CourseType: template.CourseType(item.CourseType), CourseCodes: item.CourseCodes, CourseCount: item.CourseCount})
	}
	return result
}
func templateError(ctx context.Context, err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, template.ErrNotFound):
		return huma.Error404NotFound("Template not found")
	case errors.Is(err, template.ErrNameExists):
		return huma.Error409Conflict("Academic plan name already exists")
	case errors.Is(err, template.ErrInvalid):
		return huma.Error400BadRequest("Invalid template")
	case errors.Is(err, template.ErrCourseNotFound):
		return huma.Error400BadRequest("One or more courses were not found")
	default:
		return internalError(ctx, err)
	}
}
func templateOperation(id, method, path, summary string) huma.Operation {
	return huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary, Security: []map[string][]string{{"session": {}}}, Errors: []int{400, 401, 403, 404, 409, 500}}
}

func registerTemplates(app huma.API, cfg config.Config, auth AuthService, service TemplateService) {
	huma.Register(app, templateOperation("listTemplates", http.MethodGet, "/api/v1/templates", "List academic plan templates"), func(ctx context.Context, input *TemplateListInput) (*TemplateListResponse, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, false)
		if err != nil {
			return nil, err
		}
		rows, err := service.List(ctx, template.List{Actor: actor, OwnedOnly: input.Scope == "mine"})
		if err != nil {
			return nil, templateError(ctx, err)
		}
		response := &TemplateListResponse{}
		response.Body.Templates = make([]TemplateBody, 0, len(rows))
		for _, row := range rows {
			response.Body.Templates = append(response.Body.Templates, templateBody(row))
		}
		return response, nil
	})
	huma.Register(app, templateOperation("getTemplate", http.MethodGet, "/api/v1/templates/{template_id}", "Read a template and its ordered items"), func(ctx context.Context, input *TemplatePathInput) (*TemplateDefinitionResponse, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, false)
		if err != nil {
			return nil, err
		}
		value, err := service.Get(ctx, template.Reference{Actor: actor, ID: input.ID})
		if err != nil {
			return nil, templateError(ctx, err)
		}
		response := &TemplateDefinitionResponse{}
		response.Body.Template = templateBody(value.Template)
		response.Body.Items = make([]TemplateItemBody, 0, len(value.Items))
		for _, item := range value.Items {
			body := TemplateItemBody{ID: item.ID, Type: string(item.Type), Description: item.Description, OrderIndex: item.OrderIndex, Courses: make([]TemplateCourseItemBody, 0, len(item.Courses))}
			for _, slot := range item.Courses {
				body.Courses = append(body.Courses, TemplateCourseItemBody{ID: slot.ID, Type: string(slot.Type), CourseID: slot.CourseID, CourseCode: slot.CourseCode})
			}
			response.Body.Items = append(response.Body.Items, body)
		}
		return response, nil
	})
	create := templateOperation("createTemplate", http.MethodPost, "/api/v1/templates", "Create an owned academic plan template")
	create.DefaultStatus = http.StatusCreated
	huma.Register(app, create, func(ctx context.Context, input *CreateTemplateInput) (*TemplateResponse, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		value, err := service.Create(ctx, input.Body.domain(actor))
		if err != nil {
			return nil, templateError(ctx, err)
		}
		return &TemplateResponse{Body: templateBody(value)}, nil
	})
	huma.Register(app, templateOperation("renameTemplate", http.MethodPatch, "/api/v1/templates/{template_id}", "Rename an owned template or administer a template"), func(ctx context.Context, input *RenameTemplateInput) (*struct{}, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		err = service.Rename(ctx, template.Rename{Reference: template.Reference{Actor: actor, ID: input.ID}, Name: input.Body.Name, Description: input.Body.Description})
		return &struct{}{}, templateError(ctx, err)
	})
	huma.Register(app, templateOperation("deleteTemplate", http.MethodDelete, "/api/v1/templates/{template_id}", "Delete an owned template or administer a template"), func(ctx context.Context, input *TemplatePathInput) (*struct{}, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		return &struct{}{}, templateError(ctx, service.Delete(ctx, template.Reference{Actor: actor, ID: input.ID}))
	})
}
