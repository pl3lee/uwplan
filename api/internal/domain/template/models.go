package template

import (
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"sort"
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

// Blueprint is a template definition without an owner or database identity.
// Built-in seeds use it without inventing a user account.
type Blueprint struct {
	Name        string
	Description *string
	Items       []DraftItem
}

type Seed struct{ Templates []Blueprint }
type SeedResult struct{ Created, Existing int }

func (s Seed) Normalize() (Seed, error) {
	if len(s.Templates) == 0 {
		return Seed{}, ErrInvalid
	}
	result := Seed{Templates: make([]Blueprint, len(s.Templates))}
	seen := make(map[string]bool, len(s.Templates))
	for i, input := range s.Templates {
		value, err := input.Normalize()
		if err != nil {
			return Seed{}, err
		}
		if seen[value.Name] {
			return Seed{}, ErrInvalid
		}
		seen[value.Name] = true
		result.Templates[i] = value
	}
	// Every concurrent seed acquires unique-name locks in the same order.
	sort.Slice(result.Templates, func(i, j int) bool { return result.Templates[i].Name < result.Templates[j].Name })
	return result, nil
}

// Normalize validates the creation form and returns independent item/code slices.
// Item order is the form's order; persistence assigns fresh IDs to every item.
func (d Draft) Normalize() (Draft, error) {
	if d.Actor.ID == "" {
		return Draft{}, ErrInvalid
	}
	b, err := (Blueprint{Name: d.Name, Description: d.Description, Items: d.Items}).Normalize()
	if err != nil {
		return Draft{}, err
	}
	d.Name, d.Items = b.Name, b.Items
	return d, nil
}

func (d Blueprint) Normalize() (Blueprint, error) {
	if strings.TrimSpace(d.Name) == "" || utf8.RuneCountInString(d.Name) > 255 {
		return Blueprint{}, ErrInvalid
	}
	result := d
	result.Name = strings.TrimSpace(d.Name)
	result.Items = make([]DraftItem, len(d.Items))
	for i, item := range d.Items {
		if err := item.Validate(); err != nil {
			return Blueprint{}, err
		}
		item.CourseCodes = append([]string(nil), item.CourseCodes...)
		for j, code := range item.CourseCodes {
			code = strings.ToUpper(strings.Join(strings.Fields(code), ""))
			if code == "" || utf8.RuneCountInString(code) > 10 {
				return Blueprint{}, ErrInvalid
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
