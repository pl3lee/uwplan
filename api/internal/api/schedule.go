package api

import (
	"context"
	"errors"
	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	"github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"net/http"
)

type ScheduleBody struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}
type ScheduleListResponse struct {
	Body struct {
		Schedules []ScheduleBody `json:"schedules"`
	}
}
type ScheduleResponse struct{ Body ScheduleBody }
type SchedulePathInput struct {
	ID uuid.UUID `path:"schedule_id"`
}
type ScheduleNameBody struct {
	Name string `json:"name" minLength:"1" maxLength:"255"`
}
type CreateScheduleInput struct{ Body ScheduleNameBody }
type RenameScheduleInput struct {
	SchedulePathInput
	Body ScheduleNameBody
}
type ScheduleCourseInput struct {
	SchedulePathInput
	CourseID uuid.UUID `path:"course_id"`
}
type AssignScheduleInput struct {
	ScheduleCourseInput
	Body struct {
		Term string `json:"term" minLength:"1" maxLength:"20"`
	}
}
type TermRangeBody struct {
	StartTerm string `json:"start_term" enum:"Winter,Spring,Fall"`
	StartYear int    `json:"start_year" minimum:"1" maximum:"9999"`
	EndTerm   string `json:"end_term" enum:"Winter,Spring,Fall"`
	EndYear   int    `json:"end_year" minimum:"1" maximum:"9999"`
}
type ChangeTermRangeInput struct{ Body TermRangeBody }

type CourseBody struct {
	ID           uuid.UUID `json:"id"`
	Code         string    `json:"code"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	Prereqs      string    `json:"prereqs"`
	Antireqs     string    `json:"antireqs"`
	Coreqs       string    `json:"coreqs"`
	UsefulRating *string   `json:"useful_rating"`
	LikedRating  *string   `json:"liked_rating"`
	EasyRating   *string   `json:"easy_rating"`
	NumRatings   *int32    `json:"num_ratings"`
}
type AssignmentBody struct {
	Course CourseBody `json:"course"`
	Term   string     `json:"term"`
}
type ScheduleViewResponse struct {
	Body struct {
		Schedule  ScheduleBody     `json:"schedule"`
		Selected  []CourseBody     `json:"selected"`
		Assigned  []AssignmentBody `json:"assigned"`
		TermRange TermRangeBody    `json:"term_range"`
	}
}
type TermRangeResponse struct{ Body TermRangeBody }
type ScheduleCSVResponse struct {
	ContentType        string `header:"Content-Type"`
	ContentDisposition string `header:"Content-Disposition"`
	Body               []byte
}

func courseBody(item course.Course) CourseBody {
	return CourseBody{ID: item.ID, Code: item.Code, Name: item.Name, Description: item.Description, Prereqs: item.Prereqs, Antireqs: item.Antireqs, Coreqs: item.Coreqs, UsefulRating: item.UsefulRating, LikedRating: item.LikedRating, EasyRating: item.EasyRating, NumRatings: item.NumRatings}
}
func termRangeBody(value term.Range) TermRangeBody {
	return TermRangeBody{StartTerm: string(value.Start.Season), StartYear: value.Start.Year, EndTerm: string(value.End.Season), EndYear: value.End.Year}
}

func (b TermRangeBody) domain() term.Range {
	return term.Range{Start: term.Term{Season: term.Season(b.StartTerm), Year: b.StartYear}, End: term.Term{Season: term.Season(b.EndTerm), Year: b.EndYear}}
}

func scheduleOperation(id, method, path, summary string) huma.Operation {
	return huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary, Security: []map[string][]string{{"session": {}}}, Errors: []int{400, 401, 403, 404, 409, 500}}
}

func authenticatedActor(ctx context.Context, cfg config.Config, auth AuthService, mutation bool) (user.User, error) {
	request := getRequest(ctx)
	if mutation && (request.Origin != cfg.PublicOrigin || request.Origin == "" || request.FetchSite == "cross-site") {
		return user.User{}, huma.Error403Forbidden("Forbidden")
	}
	if !request.Credentials.Valid() {
		return user.User{}, huma.Error401Unauthorized("Unauthorized")
	}
	actor, err := auth.Authenticate(ctx, request.Credentials)
	if errors.Is(err, session.ErrInvalid) {
		return user.User{}, huma.Error401Unauthorized("Unauthorized")
	}
	if err != nil {
		return user.User{}, internalError(ctx, err)
	}
	return actor, nil
}

func scheduleError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, schedule.ErrNotFound) {
		return huma.Error404NotFound("Schedule or course not found")
	}
	if errors.Is(err, schedule.ErrLastSchedule) {
		return huma.Error409Conflict("Cannot delete the only schedule")
	}
	if errors.Is(err, schedule.ErrInvalid) {
		return huma.Error400BadRequest("Invalid schedule input")
	}
	return internalError(ctx, err)
}

func registerSchedules(app huma.API, cfg config.Config, auth AuthService, service ScheduleService) {
	huma.Register(app, huma.Operation{OperationID: "listSchedules", Method: http.MethodGet, Path: "/api/v1/schedules", Summary: "List the user's schedules", Security: []map[string][]string{{"session": {}}}, Errors: []int{401, 500}}, func(ctx context.Context, input *struct{}) (*ScheduleListResponse, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, false)
		if err != nil {
			return nil, err
		}
		result, err := service.List(ctx, actor)
		if err != nil {
			return nil, scheduleError(ctx, err)
		}
		response := &ScheduleListResponse{}
		response.Body.Schedules = make([]ScheduleBody, 0, len(result.Schedules))
		for _, item := range result.Schedules {
			response.Body.Schedules = append(response.Body.Schedules, ScheduleBody{ID: item.ID, Name: item.Name})
		}
		return response, nil
	})
	registerScheduleMutations(app, cfg, auth, service)
	registerScheduleReads(app, cfg, auth, service)
}

func registerScheduleReads(app huma.API, cfg config.Config, auth AuthService, service ScheduleService) {
	huma.Register(app, scheduleOperation("getSchedule", http.MethodGet, "/api/v1/schedules/{schedule_id}", "Read an owned schedule with selections and assignments"), func(ctx context.Context, input *SchedulePathInput) (*ScheduleViewResponse, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, false)
		if err != nil {
			return nil, err
		}
		view, err := service.View(ctx, schedule.Reference{UserID: actor.ID, ID: input.ID})
		if err != nil {
			return nil, scheduleError(ctx, err)
		}
		response := &ScheduleViewResponse{}
		response.Body.Schedule = ScheduleBody{ID: view.Schedule.ID, Name: view.Schedule.Name}
		response.Body.TermRange = termRangeBody(view.TermRange)
		response.Body.Selected = make([]CourseBody, 0, len(view.Selected))
		response.Body.Assigned = make([]AssignmentBody, 0, len(view.Assigned))
		for _, item := range view.Selected {
			response.Body.Selected = append(response.Body.Selected, courseBody(item))
		}
		for _, item := range view.Assigned {
			response.Body.Assigned = append(response.Body.Assigned, AssignmentBody{Course: courseBody(item.Course), Term: item.Term.String()})
		}
		return response, nil
	})
	huma.Register(app, scheduleOperation("getTermRange", http.MethodGet, "/api/v1/term-range", "Read the user's planning term range"), func(ctx context.Context, input *struct{}) (*TermRangeResponse, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, false)
		if err != nil {
			return nil, err
		}
		value, err := service.GetTermRange(ctx, actor)
		if err != nil {
			return nil, scheduleError(ctx, err)
		}
		return &TermRangeResponse{Body: termRangeBody(value)}, nil
	})
	export := scheduleOperation("exportSchedule", http.MethodGet, "/api/v1/schedules/{schedule_id}/export", "Download an owned schedule as CSV")
	export.Responses = map[string]*huma.Response{"200": {Description: "Schedule CSV", Content: map[string]*huma.MediaType{"text/csv": {Schema: &huma.Schema{Type: "string", Format: "binary"}}}}}
	huma.Register(app, export, func(ctx context.Context, input *SchedulePathInput) (*ScheduleCSVResponse, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, false)
		if err != nil {
			return nil, err
		}
		view, err := service.View(ctx, schedule.Reference{UserID: actor.ID, ID: input.ID})
		if err != nil {
			return nil, scheduleError(ctx, err)
		}
		content, err := (schedule.Export{Selected: view.Selected, Assigned: view.Assigned}).CSV()
		if err != nil {
			return nil, internalError(ctx, err)
		}
		return &ScheduleCSVResponse{ContentType: "text/csv; charset=utf-8", ContentDisposition: `attachment; filename="schedule.csv"`, Body: content}, nil
	})
}

func registerScheduleMutations(app huma.API, cfg config.Config, auth AuthService, service ScheduleService) {
	create := scheduleOperation("createSchedule", http.MethodPost, "/api/v1/schedules", "Create a schedule")
	create.DefaultStatus = http.StatusCreated
	huma.Register(app, create, func(ctx context.Context, input *CreateScheduleInput) (*ScheduleResponse, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		result, err := service.Create(ctx, schedule.Create{UserID: actor.ID, Name: input.Body.Name})
		if err != nil {
			return nil, scheduleError(ctx, err)
		}
		return &ScheduleResponse{Body: ScheduleBody{ID: result.ID, Name: result.Name}}, nil
	})
	huma.Register(app, scheduleOperation("renameSchedule", http.MethodPatch, "/api/v1/schedules/{schedule_id}", "Rename an owned schedule"), func(ctx context.Context, input *RenameScheduleInput) (*struct{}, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		err = service.Rename(ctx, schedule.Rename{Reference: schedule.Reference{UserID: actor.ID, ID: input.ID}, Name: input.Body.Name})
		return &struct{}{}, scheduleError(ctx, err)
	})
	huma.Register(app, scheduleOperation("deleteSchedule", http.MethodDelete, "/api/v1/schedules/{schedule_id}", "Delete a schedule while retaining at least one"), func(ctx context.Context, input *SchedulePathInput) (*struct{}, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		err = service.Delete(ctx, schedule.Reference{UserID: actor.ID, ID: input.ID})
		return &struct{}{}, scheduleError(ctx, err)
	})
	huma.Register(app, scheduleOperation("assignScheduleCourse", http.MethodPut, "/api/v1/schedules/{schedule_id}/courses/{course_id}", "Assign or move a course to a term"), func(ctx context.Context, input *AssignScheduleInput) (*struct{}, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		assignedTerm, err := term.Parse(input.Body.Term)
		if err != nil {
			return nil, scheduleError(ctx, schedule.ErrInvalid)
		}
		err = service.Assign(ctx, schedule.Assign{Reference: schedule.Reference{UserID: actor.ID, ID: input.ID}, CourseID: input.CourseID, Term: assignedTerm})
		return &struct{}{}, scheduleError(ctx, err)
	})
	huma.Register(app, scheduleOperation("removeScheduleCourse", http.MethodDelete, "/api/v1/schedules/{schedule_id}/courses/{course_id}", "Remove a course assignment"), func(ctx context.Context, input *ScheduleCourseInput) (*struct{}, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		err = service.RemoveCourse(ctx, schedule.RemoveCourse{Reference: schedule.Reference{UserID: actor.ID, ID: input.ID}, CourseID: input.CourseID})
		return &struct{}{}, scheduleError(ctx, err)
	})
	huma.Register(app, scheduleOperation("changeTermRange", http.MethodPatch, "/api/v1/term-range", "Change the user's planning term range"), func(ctx context.Context, input *ChangeTermRangeInput) (*struct{}, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, true)
		if err != nil {
			return nil, err
		}
		err = service.ChangeTermRange(ctx, schedule.TermRangeChange{UserID: actor.ID, Range: input.Body.domain()})
		return &struct{}{}, scheduleError(ctx, err)
	})
}
