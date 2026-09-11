package schedule

import (
	"context"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	domainschedule "github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/pl3lee/uwplan/api/internal/repository/db/sqlc"
)

type ScheduleRepositoryImpl struct{ pool *pgxpool.Pool }

func NewScheduleRepository(pool *pgxpool.Pool) *ScheduleRepositoryImpl {
	return &ScheduleRepositoryImpl{pool: pool}
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
