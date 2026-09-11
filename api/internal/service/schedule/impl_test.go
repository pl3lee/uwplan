package schedule

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	domainschedule "github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
)

func TestInvalidScheduleInputsNeverReachPersistence(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"create", "rename", "view", "delete", "assign", "remove", "term range", "list", "get term range"} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			repo := NewScheduleRepositoryMock(t)
			service := NewScheduleService(repo)
			var err error
			switch name {
			case "create":
				_, err = service.Create(t.Context(), domainschedule.Create{UserID: "user", Name: " "})
			case "rename":
				err = service.Rename(t.Context(), domainschedule.Rename{Name: "name"})
			case "view":
				_, err = service.View(t.Context(), domainschedule.Reference{})
			case "delete":
				err = service.Delete(t.Context(), domainschedule.Reference{})
			case "assign":
				err = service.Assign(t.Context(), domainschedule.Assign{})
			case "remove":
				err = service.RemoveCourse(t.Context(), domainschedule.RemoveCourse{Reference: domainschedule.Reference{UserID: "user", ID: uuid.New()}})
			case "term range":
				err = service.ChangeTermRange(t.Context(), domainschedule.TermRangeChange{UserID: "user", Range: term.Range{Start: term.Term{Season: term.Fall, Year: 2028}, End: term.Term{Season: term.Fall, Year: 2027}}})
			case "list":
				_, err = service.List(t.Context(), user.User{})
			case "get term range":
				_, err = service.GetTermRange(t.Context(), user.User{})
			}
			if !errors.Is(err, domainschedule.ErrInvalid) {
				t.Fatalf("expected invalid input, got %v", err)
			}
		})
	}
}
