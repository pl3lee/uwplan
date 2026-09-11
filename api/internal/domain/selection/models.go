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

type Toggle struct {
	UserID   string
	ItemID   uuid.UUID
	Selected bool
}

type FreeCourseChange struct {
	UserID   string
	ItemID   uuid.UUID
	CourseID *uuid.UUID
}

type Removal struct {
	UserID   string
	CourseID uuid.UUID
}

func validateTarget(userID string, id uuid.UUID) error {
	if userID == "" || id == uuid.Nil {
		return ErrInvalid
	}
	return nil
}

func (m Membership) Validate() error { return validateTarget(m.UserID, m.TemplateID) }
func (t Toggle) Validate() error     { return validateTarget(t.UserID, t.ItemID) }
func (r Removal) Validate() error    { return validateTarget(r.UserID, r.CourseID) }
func (c FreeCourseChange) Validate() error {
	if err := validateTarget(c.UserID, c.ItemID); err != nil {
		return err
	}
	if c.CourseID != nil && *c.CourseID == uuid.Nil {
		return ErrInvalid
	}
	return nil
}

// SelectedCourseIDs is the unique course list shown in the selection table.
// A selected but unfilled free slot does not represent a catalog course.
func (s State) SelectedCourseIDs() []uuid.UUID {
	result := []uuid.UUID{}
	seen := make(map[uuid.UUID]bool)
	for _, choice := range s.Choices {
		if !choice.Selected || choice.CourseID == nil || seen[*choice.CourseID] {
			continue
		}
		seen[*choice.CourseID] = true
		result = append(result, *choice.CourseID)
	}
	return result
}
