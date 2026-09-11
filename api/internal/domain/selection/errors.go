package selection

import "errors"

var (
	ErrNotFound = errors.New("planning resource not found")
	ErrInvalid  = errors.New("invalid course selection")
)
