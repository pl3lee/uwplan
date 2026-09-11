package oauth

import "errors"

var ErrInvalidState = errors.New("invalid or expired OAuth state")

var ErrInvalidReturnPath = errors.New("invalid OAuth return path")

var ErrProviderUnavailable = errors.New("OAuth provider is unavailable")
