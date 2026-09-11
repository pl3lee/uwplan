package session

import (
	"crypto/sha256"
	"encoding/base64"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"time"
)

type Session struct {
	ID        string
	UserID    string
	TokenHash string
	CreatedAt time.Time
	ExpiresAt time.Time
}

func (s Session) IsActive(now time.Time) bool { return s.UserID != "" && now.Before(s.ExpiresAt) }

type Credentials struct{ Token string }

func (c Credentials) Hash() string {
	sum := sha256.Sum256([]byte(c.Token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func (c Credentials) Valid() bool {
	bytes, err := base64.RawURLEncoding.DecodeString(c.Token)
	return err == nil && len(bytes) == 32 && base64.RawURLEncoding.EncodeToString(bytes) == c.Token
}

// Grant contains the credential returned once after login. Only the hash is
// persisted; HTTP handlers must place Credentials in a secure HttpOnly cookie.
type Grant struct {
	User        user.User
	Session     Session
	Credentials Credentials
}
