//go:build integration

package migrations_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPlanningUpgradePreservesRelationshipsAndRepairsOrphans(t *testing.T) {
	t.Parallel()
	pool := legacy(t)
	fixture, err := os.ReadFile("../../tests/fixtures/paired-release/seed.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(t.Context(), string(fixture)); err != nil {
		t.Fatal(err)
	}
	relationships, err := os.ReadFile("../../tests/fixtures/paired-release/relationships.sql")
	if err != nil {
		t.Fatal(err)
	}
	var before, after string
	if err := pool.QueryRow(t.Context(), string(relationships)).Scan(&before); err != nil {
		t.Fatal(err)
	}
	// This independent course has no selected source and must be repaired.
	if _, err := pool.Exec(t.Context(), `INSERT INTO course(id,code,name) VALUES ('99999999-9999-4999-8999-999999999999','ORPHAN','Orphan');
        INSERT INTO schedule_course(schedule_id,course_id,term) SELECT id,'99999999-9999-4999-8999-999999999999','Fall 2026' FROM schedule`); err != nil {
		t.Fatal(err)
	}
	if err := apply(t, pool); err != nil {
		t.Fatal(err)
	}
	if err := apply(t, pool); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), string(relationships)).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(before, after); diff != "" {
		t.Fatal(diff)
	}
	var orphanCount int
	if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM schedule_course WHERE course_id='99999999-9999-4999-8999-999999999999'").Scan(&orphanCount); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(0, orphanCount); diff != "" {
		t.Fatal(diff)
	}
	// Legacy inserts omit the new position/discriminator columns.
	if _, err := pool.Exec(t.Context(), `INSERT INTO course_item(id,requirement_id,type) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','free'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444','free')`); err != nil {
		t.Fatal(err)
	}
	var positions []int32
	rows, err := pool.Query(t.Context(), "SELECT order_index FROM course_item WHERE requirement_id='44444444-4444-4444-8444-444444444444' ORDER BY order_index")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var n int32
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		positions = append(positions, n)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]int32{0, 1, 2, 3}, positions); diff != "" {
		t.Fatal(diff)
	}
}

func TestPlanningUpgradeRejectsEmailCollisionsWithoutMergingAccounts(t *testing.T) {
	t.Parallel()
	pool := legacy(t)
	if _, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email) VALUES ('first','same@example.test'),('second','SAME@example.test')`); err != nil {
		t.Fatal(err)
	}
	if err := apply(t, pool); err == nil {
		t.Fatal("email collision was accepted")
	}
	var users, version int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM "user"`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT max(version_id) FROM goose_db_version WHERE is_applied`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]int{2, 1}, []int{users, version}); diff != "" {
		t.Fatal(diff)
	}
}

func TestPlanningUpgradeRejectsUnexpectedLegacyCorruption(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		sql  string
	}{
		{"missing_fixed_course", `UPDATE course_item SET course_id=NULL WHERE type='fixed'`},
		{"out_of_bounds_year", `UPDATE user_term_range SET end_year=10000 WHERE user_id='legacy-student'`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			pool := legacy(t)
			fixture, err := os.ReadFile("../../tests/fixtures/paired-release/seed.sql")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(t.Context(), string(fixture)+tc.sql); err != nil {
				t.Fatal(err)
			}
			const snapshot = `SELECT jsonb_build_object(
				'items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM course_item t),
				'ranges',(SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id) FROM user_term_range t))::text`
			var before, after string
			if err := pool.QueryRow(t.Context(), snapshot).Scan(&before); err != nil {
				t.Fatal(err)
			}
			if err := apply(t, pool); err == nil {
				t.Fatal("unexpected legacy corruption was accepted")
			}
			if err := pool.QueryRow(t.Context(), snapshot).Scan(&after); err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(before, after); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestConcurrentMigrationProcessesApplyEachVersionOnce(t *testing.T) {
	t.Parallel()
	pool := legacy(t)
	results := make(chan error, 2)
	for range 2 {
		go func() { results <- apply(t, pool) }()
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	var versions []int64
	rows, err := pool.Query(t.Context(), `SELECT version_id FROM goose_db_version WHERE is_applied ORDER BY version_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			t.Fatal(err)
		}
		versions = append(versions, v)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]int64{0, 1, 2}, versions); diff != "" {
		t.Fatal(diff)
	}
}

func TestRestrictedRuntimeCanReadNewViewsAndRepeatGooseUp(t *testing.T) {
	t.Parallel()
	pool := legacy(t)
	// Only the isolated runner exposes these credentials. The application role
	// below receives data privileges, never ownership or schema CREATE.
	adminConfig := pool.Config().ConnConfig.Copy()
	adminConfig.User = os.Getenv("TEST_POSTGRES_USER")
	adminConfig.Password = os.Getenv("TEST_POSTGRES_PASSWORD")
	admin, err := pgx.ConnectConfig(t.Context(), adminConfig)
	if err != nil {
		t.Fatal(err)
	}
	role := "uwplan_runtime_" + uuid.NewString()
	quoted := pgx.Identifier{role}.Sanitize()
	password := uuid.NewString()
	if _, err := admin.Exec(t.Context(), fmt.Sprintf("CREATE ROLE %s LOGIN PASSWORD '%s'", quoted, password)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := admin.Exec(ctx, "DROP OWNED BY "+quoted); err != nil {
			t.Error(err)
		}
		if _, err := admin.Exec(ctx, "DROP ROLE "+quoted); err != nil {
			t.Error(err)
		}
		admin.Close(ctx)
	})
	if _, err := pool.Exec(t.Context(), "GRANT USAGE ON SCHEMA public TO "+quoted+"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "+quoted+"; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO "+quoted); err != nil {
		t.Fatal(err)
	}
	if err := apply(t, pool); err != nil {
		t.Fatal(err)
	}
	// Baseline adoption created the version table after the initial grants.
	if _, err := pool.Exec(t.Context(), "GRANT SELECT ON goose_db_version TO "+quoted); err != nil {
		t.Fatal(err)
	}
	runtimeConfig := pool.Config().Copy()
	runtimeConfig.ConnConfig.User = role
	runtimeConfig.ConnConfig.Password = password
	runtime, err := pgxpool.NewWithConfig(t.Context(), runtimeConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	if err := apply(t, runtime); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := runtime.QueryRow(t.Context(), "SELECT count(*) FROM active_course_sources").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(0, count); diff != "" {
		t.Fatal(diff)
	}
	if _, err := runtime.Exec(t.Context(), "CREATE TABLE forbidden_runtime_ddl(id integer)"); err == nil {
		t.Fatal("runtime unexpectedly has DDL privileges")
	}
}
