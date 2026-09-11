package selection

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	domainselection "github.com/pl3lee/uwplan/api/internal/domain/selection"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/pl3lee/uwplan/api/internal/repository/db/sqlc"
)

type SelectionRepositoryImpl struct{ pool *pgxpool.Pool }

func NewSelectionRepository(pool *pgxpool.Pool) *SelectionRepositoryImpl {
	return &SelectionRepositoryImpl{pool: pool}
}

func (r *SelectionRepositoryImpl) State(ctx context.Context, actor user.User) (domainselection.State, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return domainselection.State{}, fmt.Errorf("begin selection read: %w", err)
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	planID, err := q.GetOwnedPlan(ctx, actor.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainselection.State{}, domainselection.ErrNotFound
	}
	if err != nil {
		return domainselection.State{}, fmt.Errorf("get selection plan: %w", err)
	}
	ids, err := q.ListPlanTemplateIDs(ctx, planID)
	if err != nil {
		return domainselection.State{}, fmt.Errorf("get plan templates: %w", err)
	}
	result := domainselection.State{TemplateIDs: append([]uuid.UUID{}, ids...), Choices: []domainselection.Choice{}}
	rows, err := q.ListPlanChoices(ctx, planID)
	if err != nil {
		return domainselection.State{}, fmt.Errorf("get plan choices: %w", err)
	}
	for _, row := range rows {
		choice := domainselection.Choice{ItemID: row.ID, Selected: row.Selected}
		courseID := row.CourseID
		if row.Type == sqlc.CourseItemTypeFree {
			courseID = row.FilledCourseID
		}
		if courseID.Valid {
			id := uuid.UUID(courseID.Bytes)
			choice.CourseID = &id
		}
		result.Choices = append(result.Choices, choice)
	}
	if err := tx.Commit(ctx); err != nil {
		return domainselection.State{}, fmt.Errorf("complete selection read: %w", err)
	}
	return result, nil
}

func (r *SelectionRepositoryImpl) SetTemplate(ctx context.Context, input domainselection.Membership) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin template membership change: %w", err)
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	planID, err := q.LockOwnedPlan(ctx, input.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainselection.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("lock selection plan: %w", err)
	}
	if _, err := q.LockAvailableTemplate(ctx, input.TemplateID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domainselection.ErrNotFound
		}
		return fmt.Errorf("find selected template: %w", err)
	}
	if input.Selected {
		err = q.AttachPlanTemplate(ctx, sqlc.AttachPlanTemplateParams{PlanID: planID, TemplateID: input.TemplateID})
	} else {
		if err = q.DetachPlanTemplate(ctx, sqlc.DetachPlanTemplateParams{PlanID: planID, TemplateID: input.TemplateID}); err == nil {
			err = q.DeselectTemplateChoices(ctx, sqlc.DeselectTemplateChoicesParams{PlanID: planID, TemplateID: input.TemplateID})
		}
	}
	if err != nil {
		return fmt.Errorf("change template membership: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit template membership: %w", err)
	}
	return nil
}
