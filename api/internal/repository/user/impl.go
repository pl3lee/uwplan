package user

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	domainuser "github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/pl3lee/uwplan/api/internal/repository/db/sqlc"
)

type UserRepositoryImpl struct{ pool *pgxpool.Pool }

func NewUserRepository(pool *pgxpool.Pool) *UserRepositoryImpl {
	return &UserRepositoryImpl{pool: pool}
}

func (r *UserRepositoryImpl) ResolveAccount(ctx context.Context, input domainuser.Provisioning) (domainuser.User, error) {
	if err := input.Validate(); err != nil {
		return domainuser.User{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domainuser.User{}, fmt.Errorf("begin account resolution: %w", err)
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	// Serialize first sign-ins for this provider identity before looking it up.
	if err = q.LockIdentity(ctx, "uwplan:identity:"+string(input.Identity.Provider)+":"+input.Identity.Subject); err != nil {
		return domainuser.User{}, fmt.Errorf("lock identity: %w", err)
	}
	existing, err := q.GetProviderUser(ctx, sqlc.GetProviderUserParams{Provider: string(input.Identity.Provider), ProviderAccountID: input.Identity.Subject})
	if err == nil {
		if err = tx.Commit(ctx); err != nil {
			return domainuser.User{}, fmt.Errorf("commit account lookup: %w", err)
		}
		return toDomain(sqlc.GetUserRow(existing)), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return domainuser.User{}, fmt.Errorf("find provider account: %w", err)
	}
	email := strings.ToLower(input.Identity.Email)
	if err = q.LockIdentity(ctx, "uwplan:email:"+email); err != nil {
		return domainuser.User{}, fmt.Errorf("lock email: %w", err)
	}
	exists, err := q.EmailExists(ctx, email)
	if err != nil {
		return domainuser.User{}, fmt.Errorf("find existing email: %w", err)
	}
	if exists {
		return domainuser.User{}, domainuser.ErrAccountNotLinked
	}
	userID, err := uuid.NewV7()
	if err != nil {
		return domainuser.User{}, fmt.Errorf("generate user ID: %w", err)
	}
	planID, err := uuid.NewV7()
	if err != nil {
		return domainuser.User{}, fmt.Errorf("generate plan ID: %w", err)
	}
	scheduleID, err := uuid.NewV7()
	if err != nil {
		return domainuser.User{}, fmt.Errorf("generate schedule ID: %w", err)
	}
	created, err := q.CreateUser(ctx, sqlc.CreateUserParams{ID: userID.String(), Email: email, Name: input.Identity.Name, Image: input.Identity.Image})
	if err != nil {
		return domainuser.User{}, fmt.Errorf("create user: %w", err)
	}
	if err = q.CreateProviderAccount(ctx, sqlc.CreateProviderAccountParams{UserID: created.ID, Provider: string(input.Identity.Provider), ProviderAccountID: input.Identity.Subject}); err != nil {
		return domainuser.User{}, fmt.Errorf("link provider account: %w", err)
	}
	if err = q.CreatePlan(ctx, sqlc.CreatePlanParams{ID: planID, UserID: created.ID}); err != nil {
		return domainuser.User{}, fmt.Errorf("create initial plan: %w", err)
	}
	if err = q.CreateDefaultSchedule(ctx, sqlc.CreateDefaultScheduleParams{ID: scheduleID, PlanID: planID, Name: input.ScheduleName}); err != nil {
		return domainuser.User{}, fmt.Errorf("create initial schedule: %w", err)
	}
	if err = q.CreateDefaultTermRange(ctx, sqlc.CreateDefaultTermRangeParams{UserID: created.ID, StartTerm: sqlc.Season(input.TermRange.Start.Season), StartYear: int32(input.TermRange.Start.Year), EndTerm: sqlc.Season(input.TermRange.End.Season), EndYear: int32(input.TermRange.End.Year)}); err != nil {
		return domainuser.User{}, fmt.Errorf("create initial term range: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return domainuser.User{}, fmt.Errorf("commit account provisioning: %w", err)
	}
	return toDomain(sqlc.GetUserRow(created)), nil
}

func (r *UserRepositoryImpl) GetUser(ctx context.Context, input domainuser.User) (domainuser.User, error) {
	row, err := sqlc.New(r.pool).GetUser(ctx, input.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainuser.User{}, domainuser.ErrNotFound
	}
	if err != nil {
		return domainuser.User{}, fmt.Errorf("get user: %w", err)
	}
	return toDomain(row), nil
}

func toDomain(row sqlc.GetUserRow) domainuser.User {
	return domainuser.User{ID: row.ID, Email: row.Email, Name: row.Name, Image: row.Image, Role: domainuser.Role(row.Role)}
}
