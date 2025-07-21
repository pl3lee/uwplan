package auth

import (
	"net/http"

	"github.com/pl3lee/uwplan/internal/utils"
)

// handleMe returns information about the currently authenticated user
func (ar *Router) handleMe(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement user info endpoint
	// 1. Extract user ID from session/JWT
	// 2. Query user from database
	// 3. Return user info (without sensitive data)

	utils.RespondWithJSON(w, http.StatusOK, map[string]string{
		"message": "User info endpoint - implement authentication check here",
	})
}
