package auth

import "github.com/pl3lee/uwplan/internal/repository/user"

type AuthConfig struct {
	UserRepo           user.Querier
	BaseURL            string
	GoogleClientID     string
	GoogleClientSecret string
}
