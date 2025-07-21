package auth

import (
	"net/http"

	"github.com/pl3lee/uwplan/internal/utils"
)

// handleLogin handles user login requests
func (ar *Router) handleLogin(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement login logic
	// This could redirect to Google OAuth or handle other login methods
	utils.RespondWithJSON(w, http.StatusOK, map[string]string{
		"message":      "Login endpoint - implement OAuth flow here",
		"redirect_url": ar.config.BaseURL + "/auth/google",
	})
}
