package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/selection"
)

type PlanChoiceBody struct {
	ItemID   uuid.UUID  `json:"item_id"`
	CourseID *uuid.UUID `json:"course_id"`
	Selected bool       `json:"selected"`
}

type PlanStateBody struct {
	TemplateIDs       []uuid.UUID      `json:"template_ids"`
	Choices           []PlanChoiceBody `json:"choices"`
	SelectedCourseIDs []uuid.UUID      `json:"selected_course_ids"`
}

type PlanStateResponse struct{ Body PlanStateBody }

type SelectionFlagBody struct {
	Selected bool `json:"selected"`
}
type TemplateMembershipInput struct {
	TemplatePathInput
	Body SelectionFlagBody
}

type SelectionItemPath struct {
	ItemID uuid.UUID `path:"item_id"`
}
type CourseSelectionInput struct {
	SelectionItemPath
	Body SelectionFlagBody
}

type FreeCourseBody struct {
	CourseID *uuid.UUID `json:"course_id" nullable:"true"`
}
type FreeCourseInput struct {
	SelectionItemPath
	Body FreeCourseBody
}
type SelectedCourseInput struct {
	CourseID uuid.UUID `path:"course_id"`
}

func selectionError(ctx context.Context, err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, selection.ErrNotFound):
		return huma.Error404NotFound("Planning resource not found")
	case errors.Is(err, selection.ErrInvalid):
		return huma.Error400BadRequest("Invalid course selection")
	default:
		return internalError(ctx, err)
	}
}

func selectionOperation(id, method, path, summary string) huma.Operation {
	return huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary, Security: []map[string][]string{{"session": {}}}, Errors: []int{400, 401, 403, 404, 500}}
}

func registerSelections(app huma.API, cfg config.Config, auth AuthService, service SelectionService) {
	huma.Register(app, selectionOperation("getPlanState", http.MethodGet, "/api/v1/plan", "Read the current user's template membership and course choices"), func(ctx context.Context, _ *struct{}) (*PlanStateResponse, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, false)
		if err != nil {
			return nil, err
		}
		state, err := service.State(ctx, actor)
		if err != nil {
			return nil, selectionError(ctx, err)
		}
		body := PlanStateBody{TemplateIDs: append([]uuid.UUID{}, state.TemplateIDs...), Choices: make([]PlanChoiceBody, 0, len(state.Choices)), SelectedCourseIDs: state.SelectedCourseIDs()}
		for _, choice := range state.Choices {
			body.Choices = append(body.Choices, PlanChoiceBody{ItemID: choice.ItemID, CourseID: choice.CourseID, Selected: choice.Selected})
		}
		return &PlanStateResponse{Body: body}, nil
	})
	huma.Register(app, selectionOperation("setTemplateMembership", http.MethodPut, "/api/v1/plan/templates/{template_id}", "Add or remove a template from the current user's plan"), func(ctx context.Context, input *TemplateMembershipInput) (*struct{}, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		return &struct{}{}, selectionError(ctx, service.SetTemplate(ctx, selection.Membership{UserID: actor.ID, TemplateID: input.ID, Selected: input.Body.Selected}))
	})
	huma.Register(app, selectionOperation("setCourseSelection", http.MethodPut, "/api/v1/plan/items/{item_id}/selection", "Select or deselect a course item in the current user's plan"), func(ctx context.Context, input *CourseSelectionInput) (*struct{}, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		return &struct{}{}, selectionError(ctx, service.SetChoice(ctx, selection.Toggle{UserID: actor.ID, ItemID: input.ItemID, Selected: input.Body.Selected}))
	})
	huma.Register(app, selectionOperation("changeFreeCourse", http.MethodPut, "/api/v1/plan/items/{item_id}/course", "Fill or clear a free-course slot in the current user's plan"), func(ctx context.Context, input *FreeCourseInput) (*struct{}, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		return &struct{}{}, selectionError(ctx, service.ChangeFreeCourse(ctx, selection.FreeCourseChange{UserID: actor.ID, ItemID: input.ItemID, CourseID: input.Body.CourseID}))
	})
	huma.Register(app, selectionOperation("removeSelectedCourse", http.MethodDelete, "/api/v1/plan/courses/{course_id}", "Remove every matching selection and assignment from the current user's plan"), func(ctx context.Context, input *SelectedCourseInput) (*struct{}, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		return &struct{}{}, selectionError(ctx, service.RemoveCourse(ctx, selection.Removal{UserID: actor.ID, CourseID: input.CourseID}))
	})
}
