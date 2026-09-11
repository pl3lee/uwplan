package oauth

import (
	"net/url"
	"strings"
	"time"

	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

// Flow binds a single OAuth exchange to its provider, PKCE verifier, OIDC nonce,
// and local return path. Only a hash of the browser's state value is persisted.
type Flow struct {
	StateHash string
	Provider  user.Provider
	Verifier  string
	Nonce     string
	ReturnTo  string
	ExpiresAt time.Time
}

func ReturnPath(value string) (string, error) {
	if value == "" {
		return "/select", nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.Fragment != "" || strings.ContainsAny(parsed.Path, "\\\r\n") {
		return "", ErrInvalidReturnPath
	}
	switch parsed.Path {
	case "/select", "/schedule", "/create/template", "/manage/template", "/admin":
		return parsed.RequestURI(), nil
	default:
		return "", ErrInvalidReturnPath
	}
}
