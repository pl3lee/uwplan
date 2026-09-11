//go:build integration

package migrations_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
	"github.com/pl3lee/uwplan/api/migrations"
)

func apply(t *testing.T, pool *pgxpool.Pool) error {
	t.Helper()
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	return migrations.Up(t.Context(), db)
}
func TestEmptyBootstrap(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	if err := apply(t, pool); err != nil {
		t.Fatal(err)
	}
	var version int
	if err := pool.QueryRow(t.Context(), "SELECT max(version_id) FROM goose_db_version WHERE is_applied").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(1, version); diff != "" {
		t.Fatal(diff)
	}
}

func legacy(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := postgres.NewUnmigratedPool(t)
	raw, err := os.ReadFile("../../drizzle/meta/_journal.json")
	if err != nil {
		t.Fatal(err)
	}
	var journal struct {
		Entries []struct {
			Tag string `json:"tag"`
		} `json:"entries"`
	}
	if err = json.Unmarshal(raw, &journal); err != nil {
		t.Fatal(err)
	}
	for _, entry := range journal.Entries {
		script, err := os.ReadFile(filepath.Join("../../drizzle", entry.Tag+".sql"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(t.Context(), string(script)); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}

func TestLegacyUpgradePreservesData(t *testing.T) {
	t.Parallel()
	pool := legacy(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email,role) VALUES ('legacy-user','legacy@example.test','moderator'); INSERT INTO account(user_id,type,provider,provider_account_id) VALUES ('legacy-user','oauth','google','provider-identity'); INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','legacy-user'); INSERT INTO schedule(id,name,plan_id) VALUES ('22222222-2222-4222-8222-222222222222','Saved schedule','11111111-1111-4111-8111-111111111111')`)
	if err != nil {
		t.Fatal(err)
	}
	if err = apply(t, pool); err != nil {
		t.Fatal(err)
	}
	if err = apply(t, pool); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	var got struct{ UserID, Role, ProviderID, ScheduleID, Name string }
	err = pool.QueryRow(t.Context(), `SELECT u.id,u.role,a.provider_account_id,s.id::text,s.name FROM "user" u JOIN account a ON a.user_id=u.id JOIN plan p ON p.user_id=u.id JOIN schedule s ON s.plan_id=p.id`).Scan(&got.UserID, &got.Role, &got.ProviderID, &got.ScheduleID, &got.Name)
	if err != nil {
		t.Fatal(err)
	}
	want := struct{ UserID, Role, ProviderID, ScheduleID, Name string }{"legacy-user", "moderator", "provider-identity", "22222222-2222-4222-8222-222222222222", "Saved schedule"}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatalf("saved relationships changed (-want +got): %s", diff)
	}
}

func TestRejectsSchemaDrift(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name  string
		alter string
	}{
		{"added column", `ALTER TABLE "user" ADD COLUMN unexpected_column text`},
		{"timestamp precision", `ALTER TABLE session ALTER COLUMN expires TYPE timestamp(0) with time zone`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			pool := legacy(t)
			if _, err := pool.Exec(t.Context(), tc.alter); err != nil {
				t.Fatal(err)
			}
			if err := apply(t, pool); !errors.Is(err, migrations.ErrSchemaMismatch) {
				t.Fatalf("expected schema drift rejection, got %v", err)
			}
			var applied bool
			if err := pool.QueryRow(t.Context(), "SELECT EXISTS(SELECT 1 FROM goose_db_version WHERE version_id=1 AND is_applied)").Scan(&applied); err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(false, applied); diff != "" {
				t.Fatalf("baseline applied despite drift: %s", diff)
			}
		})
	}
}
