package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

type UserListResponse struct {
	Body struct {
		Users []UserBody `json:"users"`
	}
}

func registerAdmin(app huma.API, cfg config.Config, auth AuthService, service AdminService) {
	huma.Register(app, huma.Operation{OperationID: "listUsers", Method: http.MethodGet, Path: "/api/v1/admin/users", Summary: "List user profiles for administration", Security: []map[string][]string{{"session": {}}}, Errors: []int{401, 403, 500}}, func(ctx context.Context, _ *struct{}) (*UserListResponse, error) {
		actor, err := authenticatedActor(ctx, cfg, auth, false)
		if err != nil {
			return nil, err
		}
		users, err := service.ListUsers(ctx, actor)
		if errors.Is(err, user.ErrForbidden) {
			return nil, huma.Error403Forbidden("Forbidden")
		}
		if err != nil {
			return nil, internalError(ctx, err)
		}
		response := &UserListResponse{}
		response.Body.Users = make([]UserBody, 0, len(users))
		for _, person := range users {
			response.Body.Users = append(response.Body.Users, UserBody{ID: person.ID, Email: person.Email, Name: person.Name, Image: person.Image, Role: string(person.Role)})
		}
		return response, nil
	})
}
