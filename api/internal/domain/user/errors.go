package user

import "errors"

var (
	ErrInvalidProvisioning = errors.New("invalid initial planning state")
	ErrNotFound            = errors.New("user not found")
	ErrInvalidIdentity     = errors.New("invalid provider identity")
	ErrAccountNotLinked    = errors.New("sign in with the provider already linked to this email")
)
