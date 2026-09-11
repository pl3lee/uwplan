package postgres

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/peterldowns/pgtestdb"
	"github.com/pl3lee/uwplan/api/migrations"
)

type migrator struct{ empty bool }

func (m migrator) Hash() (string, error) {
	if m.empty {
		return "uwplan-empty-v1", nil
	}
	return migrations.Hash(), nil
}
func (m migrator) Migrate(ctx context.Context, db *sql.DB, _ pgtestdb.Config) error {
	if m.empty {
		return nil
	}
	return migrations.Up(ctx, db)
}

func NewPool(t *testing.T) *pgxpool.Pool           { return newPool(t, false) }
func NewUnmigratedPool(t *testing.T) *pgxpool.Pool { return newPool(t, true) }
func newPool(t *testing.T, empty bool) *pgxpool.Pool {
	t.Helper()
	port := os.Getenv("TEST_POSTGRES_PORT")
	if port == "" {
		t.Fatal("use make test-integration to create the isolated test server")
	}
	config := pgtestdb.Custom(t, pgtestdb.Config{DriverName: "pgx", Host: os.Getenv("TEST_POSTGRES_HOST"), Port: port, User: os.Getenv("TEST_POSTGRES_USER"), Password: os.Getenv("TEST_POSTGRES_PASSWORD"), Database: "uwplan_api_test", Options: "sslmode=disable"}, migrator{empty: empty})
	pool, err := pgxpool.New(t.Context(), config.URL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}
