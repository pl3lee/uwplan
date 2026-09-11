package schedule

import "errors"

var ErrNotFound = errors.New("schedule not found")
var ErrLastSchedule = errors.New("cannot delete the only schedule")
var ErrInvalid = errors.New("invalid schedule input")
