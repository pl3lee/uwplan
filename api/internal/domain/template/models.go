package template

import (
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"strings"
	"unicode/utf8"
)

type ItemType string

const (
	Instruction ItemType = "instruction"
	Requirement ItemType = "requirement"
	Separator   ItemType = "separator"
)

type CourseType string

const (
	Fixed CourseType = "fixed"
	Free  CourseType = "free"
)

type Template struct {
	ID                     uuid.UUID
	Name                   string
	Description, CreatedBy *string
}
type Definition struct {
	Template Template
	Items    []Item
}
type Item struct {
	ID          uuid.UUID
	Type        ItemType
	Description *string
	OrderIndex  int32
	Courses     []CourseItem
}
type CourseItem struct {
	ID         uuid.UUID
	Type       CourseType
	CourseID   *uuid.UUID
	CourseCode *string
}

type Draft struct {
	Actor       user.User
	Name        string
	Description *string
	Items       []DraftItem
}
type DraftItem struct {
	Type        ItemType
	Description *string
	CourseType  CourseType
	CourseCodes []string
	CourseCount int
}

// Normalize validates the creation form and returns independent item/code slices.
// Item order is the form's order; persistence assigns fresh IDs to every item.
func (d Draft) Normalize() (Draft, error) {
	if d.Actor.ID == "" || strings.TrimSpace(d.Name) == "" || utf8.RuneCountInString(d.Name) > 255 {
		return Draft{}, ErrInvalid
	}
	result := d
	result.Name = strings.TrimSpace(d.Name)
	result.Items = make([]DraftItem, len(d.Items))
	for i, item := range d.Items {
		if err := item.Validate(); err != nil {
			return Draft{}, err
		}
		item.CourseCodes = append([]string(nil), item.CourseCodes...)
		for j, code := range item.CourseCodes {
			code = strings.ToUpper(strings.Join(strings.Fields(code), ""))
			if code == "" || utf8.RuneCountInString(code) > 10 {
				return Draft{}, ErrInvalid
			}
			item.CourseCodes[j] = code
		}
		result.Items[i] = item
	}
	return result, nil
}

func (i DraftItem) Validate() error {
	described := i.Description != nil && strings.TrimSpace(*i.Description) != ""
	switch i.Type {
	case Instruction:
		if !described || i.CourseType != "" || len(i.CourseCodes) != 0 || i.CourseCount != 0 {
			return ErrInvalid
		}
	case Separator:
		if described || i.CourseType != "" || len(i.CourseCodes) != 0 || i.CourseCount != 0 {
			return ErrInvalid
		}
	case Requirement:
		if !described {
			return ErrInvalid
		}
		switch i.CourseType {
		case Fixed:
			if len(i.CourseCodes) == 0 || i.CourseCount != 0 {
				return ErrInvalid
			}
		case Free:
			if i.CourseCount < 1 || len(i.CourseCodes) != 0 {
				return ErrInvalid
			}
		default:
			return ErrInvalid
		}
	default:
		return ErrInvalid
	}
	return nil
}

type List struct {
	Actor     user.User
	OwnedOnly bool
}

func (l List) Validate() error {
	if l.Actor.ID == "" {
		return ErrInvalid
	}
	return nil
}

type Reference struct {
	Actor user.User
	ID    uuid.UUID
}

func (r Reference) Validate() error {
	if r.Actor.ID == "" || r.ID == uuid.Nil {
		return ErrInvalid
	}
	return nil
}

type Rename struct {
	Reference   Reference
	Name        string
	Description *string
}

func (r Rename) Normalize() (Rename, error) {
	if err := r.Reference.Validate(); err != nil {
		return Rename{}, err
	}
	r.Name = strings.TrimSpace(r.Name)
	if r.Name == "" || utf8.RuneCountInString(r.Name) > 255 {
		return Rename{}, ErrInvalid
	}
	return r, nil
}
