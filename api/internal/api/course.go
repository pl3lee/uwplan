package api

import (
	"context"
	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	"net/http"
)

type CourseListResponse struct {
	Body struct {
		Courses []CourseBody `json:"courses"`
	}
}

func registerCourses(app huma.API, cfg config.Config, auth AuthService, courses CourseService) {
	huma.Register(app, huma.Operation{
		OperationID: "listCourses", Method: http.MethodGet, Path: "/api/v1/courses",
		Summary: "List the course catalog", Security: []map[string][]string{{"session": {}}}, Errors: []int{401, 500},
	}, func(ctx context.Context, _ *struct{}) (*CourseListResponse, error) {
		if _, err := authenticatedActor(ctx, cfg, auth, false); err != nil {
			return nil, err
		}
		rows, err := courses.List(ctx)
		if err != nil {
			return nil, internalError(ctx, err)
		}
		response := &CourseListResponse{}
		response.Body.Courses = make([]CourseBody, 0, len(rows))
		for _, row := range rows {
			response.Body.Courses = append(response.Body.Courses, courseBody(row))
		}
		return response, nil
	})
}

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

func courseBody(item course.Course) CourseBody {
	return CourseBody{ID: item.ID, Code: item.Code, Name: item.Name, Description: item.Description, Prereqs: item.Prereqs, Antireqs: item.Antireqs, Coreqs: item.Coreqs, UsefulRating: item.UsefulRating, LikedRating: item.LikedRating, EasyRating: item.EasyRating, NumRatings: item.NumRatings}
}
