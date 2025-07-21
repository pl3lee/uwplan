package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

type GoogleUserInfo struct {
	Sub           string `json:"sub"`
	Name          string `json:"name"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Picture       string `json:"picture"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
}

func (cfg *AuthConfig) getGoogleConfig() oauth2.Config {
	oauth2Config := oauth2.Config{
		ClientID:     cfg.GoogleClientID,
		ClientSecret: cfg.GoogleClientSecret,
		RedirectURL:  fmt.Sprintf("%s/auth/google/callback", cfg.BaseURL),
		Scopes: []string{
			"https://www.googleapis.com/auth/userinfo.profile",
			"https://www.googleapis.com/auth/userinfo.email",
		},
		Endpoint: google.Endpoint,
	}
	return oauth2Config
}

func (g GoogleUserInfo) String() string {
	return fmt.Sprintf("User{ID: %s, Name: %s, Email: %s}", g.Sub, g.Name, g.Email)
}

func generateState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generateState: failed to generate state: %w", err)
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

func (cfg *AuthConfig) getAuthCodeURL() (url string, state string, err error) {
	oauth2Config := cfg.getGoogleConfig()
	state, err = generateState()
	if err != nil {
		return "", "", fmt.Errorf("getAuthCodeURL: cannot generate state: %w", err)
	}
	url = oauth2Config.AuthCodeURL(state)
	return url, state, nil
}

func (cfg *AuthConfig) exchangeCodeForTokenGoogle(code string) (*oauth2.Token, error) {
	oauth2Config := cfg.getGoogleConfig()
	return oauth2Config.Exchange(context.Background(), code)
}

func getUserInfoGoogle(accessToken string) (*GoogleUserInfo, error) {
	googleApiUrl := "https://www.googleapis.com/oauth2/v3/userinfo"
	req, err := http.NewRequest("GET", googleApiUrl, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google api returned status: %d", resp.StatusCode)

	}

	var userInfo GoogleUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &userInfo, nil
}
