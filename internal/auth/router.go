package auth

import (
	"github.com/go-chi/chi/v5"
)

// Router handles all authentication routes
type Router struct {
	config AuthConfig
}

// NewRouter creates a new auth router with the given config
func NewRouter(config AuthConfig) *Router {
	return &Router{config: config}
}

// Routes returns a chi.Router with all auth routes configured
func (ar *Router) Routes() chi.Router {
	r := chi.NewRouter()

	// Auth routes
	r.Post("/login", ar.handleLogin)
	r.Post("/callback", ar.handleCallback)
	r.Get("/logout", ar.handleLogout)
	r.Get("/me", ar.handleMe) // Get current user info

	return r
}
