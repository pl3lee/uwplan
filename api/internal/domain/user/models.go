package user

import (
	"net/mail"
	"strings"
	"unicode/utf8"
)

type Role string

const (
	RoleUser      Role = "user"
	RoleModerator Role = "moderator"
	RoleAdmin     Role = "admin"
)

type User struct {
	ID    string
	Email string
	Name  *string
	Image *string
	Role  Role
}

func (u User) IsAdmin() bool { return u.Role == RoleAdmin }

type Provider string

const (
	Google Provider = "google"
	GitHub Provider = "github"
)

// Identity is the profile verified by an OAuth provider. Subject is the stable
// provider account ID; email alone must never link an existing account.
type Identity struct {
	Provider Provider
	Subject  string
	Email    string
	Name     *string
	Image    *string
}

func (i Identity) Validate() error {
	if i.Provider != Google && i.Provider != GitHub {
		return ErrInvalidIdentity
	}
	if strings.TrimSpace(i.Subject) == "" || utf8.RuneCountInString(i.Subject) > 255 {
		return ErrInvalidIdentity
	}
	if len(i.Email) > 255 {
		return ErrInvalidIdentity
	}
	address, err := mail.ParseAddress(i.Email)
	if err != nil || address.Address != i.Email {
		return ErrInvalidIdentity
	}
	for _, value := range []*string{i.Name, i.Image} {
		if value != nil && utf8.RuneCountInString(*value) > 255 {
			return ErrInvalidIdentity
		}
	}
	return nil
}
