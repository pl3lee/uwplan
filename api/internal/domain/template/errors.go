package template

import "errors"

var (
	ErrInvalid        = errors.New("invalid template")
	ErrNotFound       = errors.New("template not found")
	ErrNameExists     = errors.New("template name already exists")
	ErrCourseNotFound = errors.New("template course not found")
)
