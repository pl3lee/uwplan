//go:build integration

package user_test

import (
	"errors"
	"github.com/jackc/pgx/v5/pgconn"
	"sync"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	domainuser "github.com/pl3lee/uwplan/api/internal/domain/user"
	repositoryuser "github.com/pl3lee/uwplan/api/internal/repository/user"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

func TestNewAccountProvisionsPlanAtomically(t *testing.T) {
	t.Parallel()
	for _, provider := range []domainuser.Provider{domainuser.Google, domainuser.GitHub} {
		t.Run(string(provider), func(t *testing.T) {
			t.Parallel()
			pool := postgres.NewPool(t)
			repo := repositoryuser.NewUserRepository(pool)
			identity := domainuser.Identity{Provider: provider, Subject: "provider-123", Email: "new@example.test"}
			got, err := repo.ResolveAccount(t.Context(), identity)
			if err != nil {
				t.Fatal(err)
			}
			id, err := uuid.Parse(got.ID)
			if err != nil || id.Version() != 7 {
				t.Fatalf("new user must have UUIDv7: %q", got.ID)
			}
			want := domainuser.User{ID: got.ID, Email: identity.Email, Role: domainuser.RoleUser}
			if diff := cmp.Diff(want, got); diff != "" {
				t.Fatal(diff)
			}
			repeated, err := repo.ResolveAccount(t.Context(), identity)
			if err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(want, repeated); diff != "" {
				t.Fatal(diff)
			}
			read, err := repo.GetUser(t.Context(), domainuser.User{ID: got.ID})
			if err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff(want, read); diff != "" {
				t.Fatal(diff)
			}
			var provision struct {
				Plans, Accounts, Schedules int
				Name, Start, End           string
				StartYear, EndYear         int
			}
			err = pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM plan),(SELECT count(*) FROM account),(SELECT count(*) FROM schedule),s.name,r.start_term,r.end_term,r.start_year,r.end_year FROM plan p JOIN schedule s ON s.plan_id=p.id JOIN user_term_range r ON r.user_id=p.user_id WHERE p.user_id=$1`, got.ID).Scan(&provision.Plans, &provision.Accounts, &provision.Schedules, &provision.Name, &provision.Start, &provision.End, &provision.StartYear, &provision.EndYear)
			if err != nil {
				t.Fatal(err)
			}
			expected := struct {
				Plans, Accounts, Schedules int
				Name, Start, End           string
				StartYear, EndYear         int
			}{1, 1, 1, "Default", "Fall", "Fall", time.Now().UTC().Year(), time.Now().UTC().Year() + 5}
			if diff := cmp.Diff(expected, provision); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestExistingProviderKeepsLegacyIdentityAndPlan(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email,name,role) VALUES ('legacy-id','original@example.test','Existing user','moderator'); INSERT INTO account(user_id,type,provider,provider_account_id) VALUES ('legacy-id','oauth','google','old-subject'); INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','legacy-id'); INSERT INTO schedule(id,name,plan_id) VALUES ('22222222-2222-4222-8222-222222222222','My saved schedule','11111111-1111-4111-8111-111111111111')`)
	if err != nil {
		t.Fatal(err)
	}
	repo := repositoryuser.NewUserRepository(pool)
	got, err := repo.ResolveAccount(t.Context(), domainuser.Identity{Provider: domainuser.Google, Subject: "old-subject", Email: "changed@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	name := "Existing user"
	want := domainuser.User{ID: "legacy-id", Email: "original@example.test", Name: &name, Role: domainuser.RoleModerator}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
	var saved struct{ UserID, PlanID, ScheduleID, Name string }
	err = pool.QueryRow(t.Context(), `SELECT p.user_id,p.id::text,s.id::text,s.name FROM plan p JOIN schedule s ON s.plan_id=p.id`).Scan(&saved.UserID, &saved.PlanID, &saved.ScheduleID, &saved.Name)
	if err != nil {
		t.Fatal(err)
	}
	expected := struct{ UserID, PlanID, ScheduleID, Name string }{"legacy-id", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "My saved schedule"}
	if diff := cmp.Diff(expected, saved); diff != "" {
		t.Fatal(diff)
	}
	_, err = repo.ResolveAccount(t.Context(), domainuser.Identity{Provider: domainuser.GitHub, Subject: "different-provider", Email: "ORIGINAL@example.test"})
	if !errors.Is(err, domainuser.ErrAccountNotLinked) {
		t.Fatalf("expected explicit provider link rejection, got %v", err)
	}
	_, err = repo.GetUser(t.Context(), domainuser.User{ID: "missing"})
	if !errors.Is(err, domainuser.ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
}

func TestConcurrentFirstLoginCreatesOneAccount(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	repo := repositoryuser.NewUserRepository(pool)
	identity := domainuser.Identity{Provider: domainuser.Google, Subject: "concurrent", Email: "same@example.test"}
	const count = 8
	var results [count]domainuser.User
	var failures [count]error
	var group sync.WaitGroup
	for index := range count {
		group.Go(func() { results[index], failures[index] = repo.ResolveAccount(t.Context(), identity) })
	}
	group.Wait()
	for index, err := range failures {
		if err != nil {
			t.Fatalf("login %d: %v", index, err)
		}
		if diff := cmp.Diff(results[0], results[index]); diff != "" {
			t.Fatal(diff)
		}
	}
	var accounts, plans int
	if err := pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM account),(SELECT count(*) FROM plan)`).Scan(&accounts, &plans); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]int{1, 1}, []int{accounts, plans}); diff != "" {
		t.Fatal(diff)
	}
}

func TestFailedProvisioningLeavesNoPartialAccount(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	if _, err := pool.Exec(t.Context(), `ALTER TABLE schedule ADD CONSTRAINT reject_default CHECK(name <> 'Default')`); err != nil {
		t.Fatal(err)
	}
	repo := repositoryuser.NewUserRepository(pool)
	_, err := repo.ResolveAccount(t.Context(), domainuser.Identity{Provider: domainuser.Google, Subject: "rollback", Email: "rollback@example.test"})
	var pgerr *pgconn.PgError
	if !errors.As(err, &pgerr) || pgerr.Code != "23514" {
		t.Fatalf("expected preserved constraint failure, got %v", err)
	}
	var counts [4]int
	err = pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM "user"),(SELECT count(*) FROM account),(SELECT count(*) FROM plan),(SELECT count(*) FROM schedule)`).Scan(&counts[0], &counts[1], &counts[2], &counts[3])
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([4]int{}, counts); diff != "" {
		t.Fatalf("partial provisioning: %s", diff)
	}
}
