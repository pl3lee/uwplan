package auth

import (
	"net/http"

	"github.com/pl3lee/uwplan/internal/utils"
)

// handleLogout handles user logout requests
func (ar *Router) handleLogout(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement logout logic
	// 1. Clear session/JWT token
	// 2. Invalidate any refresh tokens

	utils.RespondWithJSON(w, http.StatusOK, map[string]string{
		"message": "Logged out successfully",
	})
}
