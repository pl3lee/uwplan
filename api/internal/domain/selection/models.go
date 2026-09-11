package selection

import "github.com/google/uuid"

type Membership struct {
	UserID     string
	TemplateID uuid.UUID
	Selected   bool
}

type Choice struct {
	ItemID   uuid.UUID
	CourseID *uuid.UUID
	Selected bool
}

type State struct {
	TemplateIDs []uuid.UUID
	Choices     []Choice
}
