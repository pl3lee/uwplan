package schedule

import (
	"context"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	domainschedule "github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/term"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	courserepository "github.com/pl3lee/uwplan/api/internal/repository/course"
	"github.com/pl3lee/uwplan/api/internal/repository/db/sqlc"
)

type ScheduleRepositoryImpl struct{ pool *pgxpool.Pool }

func NewScheduleRepository(pool *pgxpool.Pool) *ScheduleRepositoryImpl {
	return &ScheduleRepositoryImpl{pool: pool}
}

func (r *ScheduleRepositoryImpl) View(ctx context.Context, input domainschedule.Reference) (domainschedule.View, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return domainschedule.View{}, fmt.Errorf("begin schedule view: %w", err)
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	row, err := q.GetOwnedSchedule(ctx, sqlc.GetOwnedScheduleParams{UserID: input.UserID, ID: input.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainschedule.View{}, domainschedule.ErrNotFound
	}
	if err != nil {
		return domainschedule.View{}, fmt.Errorf("get schedule: %w", err)
	}
	result := domainschedule.View{Schedule: domainschedule.Schedule{ID: row.ID, Name: row.Name}, Selected: []course.Course{}, Assigned: []domainschedule.Assignment{}}
	selected, err := q.ListSelectedCatalogCourses(ctx, input.UserID)
	if err != nil {
		return domainschedule.View{}, fmt.Errorf("get selected courses: %w", err)
	}
	for _, item := range selected {
		converted, err := courserepository.FromRow(item.Course)
		if err != nil {
			return domainschedule.View{}, err
		}
		result.Selected = append(result.Selected, converted)
	}
	assigned, err := q.ListScheduleAssignments(ctx, input.ID)
	if err != nil {
		return domainschedule.View{}, fmt.Errorf("get assigned courses: %w", err)
	}
	for _, item := range assigned {
		converted, err := courserepository.FromRow(item.Course)
		if err != nil {
			return domainschedule.View{}, err
		}
		assignedTerm, err := term.Parse(item.Term)
		if err != nil {
			return domainschedule.View{}, fmt.Errorf("decode stored assignment term: %w", err)
		}
		result.Assigned = append(result.Assigned, domainschedule.Assignment{Course: converted, Term: assignedTerm})
	}
	rangeRow, err := q.GetUserTermRange(ctx, input.UserID)
	if err != nil {
		return domainschedule.View{}, fmt.Errorf("get stored term range: %w", err)
	}
	result.TermRange = termRangeFromRow(rangeRow)
	if err = tx.Commit(ctx); err != nil {
		return domainschedule.View{}, fmt.Errorf("commit schedule view: %w", err)
	}
	return result, nil
}
func (r *ScheduleRepositoryImpl) Assign(ctx context.Context, input domainschedule.Assign) error {
	rows, err := sqlc.New(r.pool).AssignOwnedScheduleCourse(ctx, sqlc.AssignOwnedScheduleCourseParams{UserID: input.Reference.UserID, ScheduleID: input.Reference.ID, CourseID: input.CourseID, Term: input.Term.String()})
	if err != nil {
		return fmt.Errorf("assign schedule course: %w", err)
	}
	if rows == 0 {
		return domainschedule.ErrNotFound
	}
	return nil
}
func (r *ScheduleRepositoryImpl) RemoveCourse(ctx context.Context, input domainschedule.RemoveCourse) error {
	q := sqlc.New(r.pool)
	if _, err := q.GetOwnedSchedule(ctx, sqlc.GetOwnedScheduleParams{UserID: input.Reference.UserID, ID: input.Reference.ID}); errors.Is(err, pgx.ErrNoRows) {
		return domainschedule.ErrNotFound
	} else if err != nil {
		return fmt.Errorf("find schedule for course removal: %w", err)
	}
	if _, err := q.RemoveOwnedScheduleCourse(ctx, sqlc.RemoveOwnedScheduleCourseParams{UserID: input.Reference.UserID, ID: input.Reference.ID, CourseID: input.CourseID}); err != nil {
		return fmt.Errorf("remove schedule course: %w", err)
	}
	return nil
}
func (r *ScheduleRepositoryImpl) GetTermRange(ctx context.Context, input user.User) (term.Range, error) {
	row, err := sqlc.New(r.pool).GetUserTermRange(ctx, input.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return term.Range{}, domainschedule.ErrNotFound
	}
	if err != nil {
		return term.Range{}, fmt.Errorf("get term range: %w", err)
	}
	return termRangeFromRow(row), nil
}
func (r *ScheduleRepositoryImpl) ChangeTermRange(ctx context.Context, input domainschedule.TermRangeChange) error {
	rows, err := sqlc.New(r.pool).UpdateUserTermRange(ctx, sqlc.UpdateUserTermRangeParams{UserID: input.UserID, StartTerm: sqlc.Season(input.Range.Start.Season), StartYear: int32(input.Range.Start.Year), EndTerm: sqlc.Season(input.Range.End.Season), EndYear: int32(input.Range.End.Year)})
	if err != nil {
		return fmt.Errorf("change term range: %w", err)
	}
	if rows == 0 {
		return domainschedule.ErrNotFound
	}
	return nil
}
func (r *ScheduleRepositoryImpl) List(ctx context.Context, actor user.User) (domainschedule.Collection, error) {
	rows, err := sqlc.New(r.pool).ListOwnedSchedules(ctx, actor.ID)
	if err != nil {
		return domainschedule.Collection{}, fmt.Errorf("list schedules: %w", err)
	}
	return collection(rows), nil
}
func (r *ScheduleRepositoryImpl) Create(ctx context.Context, input domainschedule.Create) (domainschedule.Schedule, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return domainschedule.Schedule{}, fmt.Errorf("generate schedule ID: %w", err)
	}
	row, err := sqlc.New(r.pool).CreateOwnedSchedule(ctx, sqlc.CreateOwnedScheduleParams{ID: id, Name: input.Name, UserID: input.UserID})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainschedule.Schedule{}, domainschedule.ErrNotFound
	}
	if err != nil {
		return domainschedule.Schedule{}, fmt.Errorf("create schedule: %w", err)
	}
	return domainschedule.Schedule{ID: row.ID, Name: row.Name}, nil
}
func (r *ScheduleRepositoryImpl) Rename(ctx context.Context, input domainschedule.Rename) error {
	rows, err := sqlc.New(r.pool).RenameOwnedSchedule(ctx, sqlc.RenameOwnedScheduleParams{UserID: input.Reference.UserID, ID: input.Reference.ID, Name: input.Name})
	if err != nil {
		return fmt.Errorf("rename schedule: %w", err)
	}
	if rows == 0 {
		return domainschedule.ErrNotFound
	}
	return nil
}
func (r *ScheduleRepositoryImpl) Delete(ctx context.Context, input domainschedule.Reference) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin schedule deletion: %w", err)
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	if _, err = q.LockOwnedPlan(ctx, input.UserID); errors.Is(err, pgx.ErrNoRows) {
		return domainschedule.ErrNotFound
	} else if err != nil {
		return fmt.Errorf("lock schedule plan: %w", err)
	}
	rows, err := q.ListOwnedSchedules(ctx, input.UserID)
	if err != nil {
		return fmt.Errorf("list schedules for deletion: %w", err)
	}
	if err = collection(rows).ValidateRemoval(input.ID); err != nil {
		return err
	}
	if _, err = q.DeleteOwnedSchedule(ctx, sqlc.DeleteOwnedScheduleParams{UserID: input.UserID, ID: input.ID}); err != nil {
		return fmt.Errorf("delete schedule: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit schedule deletion: %w", err)
	}
	return nil
}

func collection(rows []sqlc.ListOwnedSchedulesRow) domainschedule.Collection {
	result := domainschedule.Collection{Schedules: make([]domainschedule.Schedule, 0, len(rows))}
	for _, row := range rows {
		result.Schedules = append(result.Schedules, domainschedule.Schedule{ID: row.ID, Name: row.Name})
	}
	return result
}

func termRangeFromRow(row sqlc.GetUserTermRangeRow) term.Range {
	return term.Range{Start: term.Term{Season: term.Season(row.StartTerm), Year: int(row.StartYear)}, End: term.Term{Season: term.Season(row.EndTerm), Year: int(row.EndYear)}}
}
