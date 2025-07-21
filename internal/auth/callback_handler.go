package auth

import (
	"net/http"

	"github.com/pl3lee/uwplan/internal/utils"
)

// handleCallback handles OAuth callbacks (e.g., from Google)
func (ar *Router) handleCallback(w http.ResponseWriter, r *http.Request) {
	// TODO: Implement OAuth callback logic
	// 1. Extract authorization code from query params
	// 2. Exchange code for access token
	// 3. Get user info from OAuth provider
	// 4. Create or update user in database
	// 5. Set session/JWT token

	utils.RespondWithJSON(w, http.StatusOK, map[string]string{
		"message": "Callback endpoint - implement OAuth callback handling here",
	})
}
