package template

import (
	"context"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	domaintemplate "github.com/pl3lee/uwplan/api/internal/domain/template"
	"github.com/pl3lee/uwplan/api/internal/repository/db/sqlc"
)

type TemplateRepositoryImpl struct{ pool *pgxpool.Pool }

func NewTemplateRepository(pool *pgxpool.Pool) *TemplateRepositoryImpl {
	return &TemplateRepositoryImpl{pool: pool}
}

func fromRow(row sqlc.Template) domaintemplate.Template {
	return domaintemplate.Template{ID: row.ID, Name: row.Name, Description: row.Description, CreatedBy: row.CreatedBy}
}

func (r *TemplateRepositoryImpl) List(ctx context.Context, input domaintemplate.List) ([]domaintemplate.Template, error) {
	rows, err := sqlc.New(r.pool).ListTemplates(ctx, sqlc.ListTemplatesParams{ActorID: input.Actor.ID, OwnedOnly: input.OwnedOnly})
	if err != nil {
		return nil, fmt.Errorf("list templates: %w", err)
	}
	result := make([]domaintemplate.Template, 0, len(rows))
	for _, row := range rows {
		result = append(result, fromRow(row))
	}
	return result, nil
}

func (r *TemplateRepositoryImpl) Get(ctx context.Context, input domaintemplate.Reference) (domaintemplate.Definition, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return domaintemplate.Definition{}, fmt.Errorf("begin template read: %w", err)
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	row, err := q.GetTemplate(ctx, input.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domaintemplate.Definition{}, domaintemplate.ErrNotFound
	}
	if err != nil {
		return domaintemplate.Definition{}, fmt.Errorf("get template: %w", err)
	}
	rows, err := q.ListTemplateItems(ctx, input.ID)
	if err != nil {
		return domaintemplate.Definition{}, fmt.Errorf("get template items: %w", err)
	}
	result := domaintemplate.Definition{Template: fromRow(row), Items: make([]domaintemplate.Item, 0, len(rows))}
	indices := make(map[uuid.UUID]int, len(rows))
	for i, item := range rows {
		indices[item.ID] = i
		result.Items = append(result.Items, domaintemplate.Item{ID: item.ID, Type: domaintemplate.ItemType(item.Type), Description: item.Description, OrderIndex: item.OrderIndex, Courses: []domaintemplate.CourseItem{}})
	}
	courses, err := q.ListTemplateCourseItems(ctx, input.ID)
	if err != nil {
		return domaintemplate.Definition{}, fmt.Errorf("get template courses: %w", err)
	}
	for _, item := range courses {
		value := domaintemplate.CourseItem{ID: item.ID, Type: domaintemplate.CourseType(item.Type), CourseCode: item.CourseCode}
		if item.CourseID.Valid {
			id := uuid.UUID(item.CourseID.Bytes)
			value.CourseID = &id
		}
		index := indices[item.RequirementID]
		result.Items[index].Courses = append(result.Items[index].Courses, value)
	}
	if err := tx.Commit(ctx); err != nil {
		return domaintemplate.Definition{}, fmt.Errorf("complete template read: %w", err)
	}
	return result, nil
}

func mutationError(err error) error {
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23505" && pgError.ConstraintName == "template_name_unique" {
		return domaintemplate.ErrNameExists
	}
	return err
}

func (r *TemplateRepositoryImpl) Create(ctx context.Context, input domaintemplate.Draft) (domaintemplate.Template, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domaintemplate.Template{}, fmt.Errorf("begin template creation: %w", err)
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	id, err := uuid.NewV7()
	if err != nil {
		return domaintemplate.Template{}, fmt.Errorf("generate template ID: %w", err)
	}
	row, err := q.CreateTemplate(ctx, sqlc.CreateTemplateParams{ID: id, Name: input.Name, Description: input.Description, CreatedBy: &input.Actor.ID})
	if err != nil {
		return domaintemplate.Template{}, fmt.Errorf("create template: %w", mutationError(err))
	}
	if err := createItems(ctx, q, id, input.Items); err != nil {
		return domaintemplate.Template{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domaintemplate.Template{}, fmt.Errorf("commit template creation: %w", mutationError(err))
	}
	return fromRow(row), nil
}

func createItems(ctx context.Context, q *sqlc.Queries, id uuid.UUID, items []domaintemplate.DraftItem) error {
	for index, item := range items {
		itemID, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("generate template item ID: %w", err)
		}
		err = q.CreateTemplateItem(ctx, sqlc.CreateTemplateItemParams{ID: itemID, TemplateID: id, Type: sqlc.ItemType(item.Type), Description: item.Description, OrderIndex: int32(index)})
		if err != nil {
			return fmt.Errorf("create template item: %w", err)
		}
		if item.Type != domaintemplate.Requirement {
			continue
		}
		for _, code := range item.CourseCodes {
			courseItemID, err := uuid.NewV7()
			if err != nil {
				return fmt.Errorf("generate fixed course item ID: %w", err)
			}
			_, err = q.CreateFixedTemplateCourse(ctx, sqlc.CreateFixedTemplateCourseParams{ID: courseItemID, RequirementID: itemID, Code: code})
			if errors.Is(err, pgx.ErrNoRows) {
				return domaintemplate.ErrCourseNotFound
			}
			if err != nil {
				return fmt.Errorf("create fixed course item: %w", err)
			}
		}
		for range item.CourseCount {
			courseItemID, err := uuid.NewV7()
			if err != nil {
				return fmt.Errorf("generate free course item ID: %w", err)
			}
			if err := q.CreateFreeTemplateCourse(ctx, sqlc.CreateFreeTemplateCourseParams{ID: courseItemID, RequirementID: itemID}); err != nil {
				return fmt.Errorf("create free course item: %w", err)
			}
		}
	}
	return nil
}

func (r *TemplateRepositoryImpl) Seed(ctx context.Context, input domaintemplate.Seed) (domaintemplate.SeedResult, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domaintemplate.SeedResult{}, fmt.Errorf("begin template seed: %w", err)
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	result := domaintemplate.SeedResult{}
	for _, definition := range input.Templates {
		id, err := uuid.NewV7()
		if err != nil {
			return domaintemplate.SeedResult{}, fmt.Errorf("generate seed template ID: %w", err)
		}
		_, err = q.CreateBuiltinTemplate(ctx, sqlc.CreateBuiltinTemplateParams{ID: id, Name: definition.Name, Description: definition.Description})
		if errors.Is(err, pgx.ErrNoRows) {
			existing, err := q.GetTemplateByName(ctx, definition.Name)
			if err != nil {
				return domaintemplate.SeedResult{}, fmt.Errorf("read existing seed template: %w", err)
			}
			if existing.CreatedBy != nil {
				return domaintemplate.SeedResult{}, domaintemplate.ErrNameExists
			}
			result.Existing++
			continue
		}
		if err != nil {
			return domaintemplate.SeedResult{}, fmt.Errorf("insert seed template: %w", err)
		}
		if err := createItems(ctx, q, id, definition.Items); err != nil {
			return domaintemplate.SeedResult{}, err
		}
		result.Created++
	}
	if err := tx.Commit(ctx); err != nil {
		return domaintemplate.SeedResult{}, fmt.Errorf("commit template seed: %w", err)
	}
	return result, nil
}

func (r *TemplateRepositoryImpl) Rename(ctx context.Context, input domaintemplate.Rename) error {
	rows, err := sqlc.New(r.pool).RenameManagedTemplate(ctx, sqlc.RenameManagedTemplateParams{
		ID: input.Reference.ID, ActorID: input.Reference.Actor.ID, IsAdmin: input.Reference.Actor.IsAdmin(), Name: input.Name, Description: input.Description,
	})
	if err != nil {
		return fmt.Errorf("rename template: %w", mutationError(err))
	}
	if rows == 0 {
		return domaintemplate.ErrNotFound
	}
	return nil
}

func (r *TemplateRepositoryImpl) Delete(ctx context.Context, input domaintemplate.Reference) error {
	rows, err := sqlc.New(r.pool).DeleteManagedTemplate(ctx, sqlc.DeleteManagedTemplateParams{ID: input.ID, ActorID: input.Actor.ID, IsAdmin: input.Actor.IsAdmin()})
	if err != nil {
		return fmt.Errorf("delete template: %w", err)
	}
	if rows == 0 {
		return domaintemplate.ErrNotFound
	}
	return nil
}
