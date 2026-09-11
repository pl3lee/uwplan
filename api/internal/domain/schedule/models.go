package schedule

import (
	"bytes"
	"encoding/csv"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	"strings"
	"unicode/utf8"
)

type Schedule struct {
	ID   uuid.UUID
	Name string
}
type Collection struct{ Schedules []Schedule }
type Reference struct {
	UserID string
	ID     uuid.UUID
}
type Rename struct {
	Reference Reference
	Name      string
}
type Create struct{ UserID, Name string }
type Assignment struct {
	Course course.Course
	Term   term.Term
}
type Assign struct {
	Reference Reference
	CourseID  uuid.UUID
	Term      term.Term
}
type RemoveCourse struct {
	Reference Reference
	CourseID  uuid.UUID
}
type Export struct {
	Selected []course.Course
	Assigned []Assignment
}
type View struct {
	Schedule  Schedule
	Selected  []course.Course
	Assigned  []Assignment
	TermRange term.Range
}
type TermRangeChange struct {
	UserID string
	Range  term.Range
}

func (c Create) Validate() error {
	if c.UserID == "" || strings.TrimSpace(c.Name) == "" || utf8.RuneCountInString(c.Name) > 255 {
		return ErrInvalid
	}
	return nil
}
func (r Reference) Validate() error {
	if r.UserID == "" || r.ID == uuid.Nil {
		return ErrInvalid
	}
	return nil
}
func (r Rename) Validate() error {
	if err := r.Reference.Validate(); err != nil {
		return err
	}
	return (Create{UserID: r.Reference.UserID, Name: r.Name}).Validate()
}
func (a Assign) Validate() error {
	if err := a.Reference.Validate(); err != nil {
		return err
	}
	if a.CourseID == uuid.Nil || !a.Term.Valid() {
		return ErrInvalid
	}
	return nil
}

func (r RemoveCourse) Validate() error {
	if err := r.Reference.Validate(); err != nil {
		return err
	}
	if r.CourseID == uuid.Nil {
		return ErrInvalid
	}
	return nil
}

func (c TermRangeChange) Validate() error {
	if c.UserID == "" {
		return ErrInvalid
	}
	if _, err := c.Range.Terms(); err != nil {
		return ErrInvalid
	}
	return nil
}

func (c Collection) ValidateRemoval(id uuid.UUID) error {
	found := false
	for _, item := range c.Schedules {
		if item.ID == id {
			found = true
			break
		}
	}
	if !found {
		return ErrNotFound
	}
	if len(c.Schedules) <= 1 {
		return ErrLastSchedule
	}
	return nil
}

func (e Export) CSV() ([]byte, error) {
	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	rows := [][]string{{"Selected Courses:"}}
	for _, item := range e.Selected {
		rows = append(rows, []string{item.Code + " - " + item.Name})
	}
	rows = append(rows, []string{}, []string{"Scheduled Courses:"})
	columns := []string{}
	byTerm := map[string][]string{}
	maxRows := 0
	for _, item := range e.Assigned {
		name := item.Term.String()
		if _, found := byTerm[name]; !found {
			columns = append(columns, name)
		}
		byTerm[name] = append(byTerm[name], item.Course.Code)
		if len(byTerm[name]) > maxRows {
			maxRows = len(byTerm[name])
		}
	}
	rows = append(rows, columns)
	for index := 0; index < maxRows; index++ {
		row := make([]string, len(columns))
		for col, name := range columns {
			if index < len(byTerm[name]) {
				row[col] = byTerm[name][index]
			}
		}
		rows = append(rows, row)
	}
	if err := writer.WriteAll(rows); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}
