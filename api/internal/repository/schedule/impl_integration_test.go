//go:build integration

package schedule_test

import (
	"errors"
	"sync"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	"github.com/pl3lee/uwplan/api/internal/domain/schedule"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	repository "github.com/pl3lee/uwplan/api/internal/repository/schedule"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
)

func TestSchedulesRemainOwnedAcrossCreateRenameDelete(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	_, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'),('other','other@example.test'); INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','owner'),('22222222-2222-4222-8222-222222222222','other'); INSERT INTO schedule(id,name,plan_id) VALUES ('33333333-3333-4333-8333-333333333333','Default','11111111-1111-4111-8111-111111111111');`)
	if err != nil {
		t.Fatal(err)
	}
	repo := repository.NewScheduleRepository(pool)
	id := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	owned := schedule.Reference{UserID: "owner", ID: id}
	foreign := schedule.Reference{UserID: "other", ID: id}
	if err := repo.Rename(t.Context(), schedule.Rename{Reference: foreign, Name: "Unauthorized"}); !errors.Is(err, schedule.ErrNotFound) {
		t.Fatalf("foreign rename: %v", err)
	}
	if err := repo.Delete(t.Context(), foreign); !errors.Is(err, schedule.ErrNotFound) {
		t.Fatalf("foreign delete: %v", err)
	}
	if err := repo.Delete(t.Context(), owned); !errors.Is(err, schedule.ErrLastSchedule) {
		t.Fatalf("last schedule: %v", err)
	}
	created, err := repo.Create(t.Context(), schedule.Create{UserID: "owner", Name: "Alternative"})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID.Version() != 7 {
		t.Fatal("new schedule ID must be UUIDv7")
	}
	if err := repo.Rename(t.Context(), schedule.Rename{Reference: owned, Name: "Renamed"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(t.Context(), schedule.Reference{UserID: "owner", ID: created.ID}); err != nil {
		t.Fatal(err)
	}
	got, err := repo.List(t.Context(), user.User{ID: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(schedule.Collection{Schedules: []schedule.Schedule{{ID: id, Name: "Renamed"}}}, got); diff != "" {
		t.Fatal(diff)
	}
	other, err := repo.List(t.Context(), user.User{ID: "other"})
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(schedule.Collection{Schedules: []schedule.Schedule{}}, other); diff != "" {
		t.Fatal(diff)
	}
}

func TestConcurrentDeletesKeepOneSchedule(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	if _, err := pool.Exec(t.Context(), `INSERT INTO "user"(id,email) VALUES ('owner','owner@example.test'); INSERT INTO plan(id,user_id) VALUES ('11111111-1111-4111-8111-111111111111','owner');`); err != nil {
		t.Fatal(err)
	}
	repo := repository.NewScheduleRepository(pool)
	refs := make([]schedule.Reference, 8)
	for index := range refs {
		created, err := repo.Create(t.Context(), schedule.Create{UserID: "owner", Name: "Schedule"})
		if err != nil {
			t.Fatal(err)
		}
		refs[index] = schedule.Reference{UserID: "owner", ID: created.ID}
	}
	var group sync.WaitGroup
	errorsChannel := make(chan error, len(refs))
	for _, ref := range refs {
		group.Go(func() { errorsChannel <- repo.Delete(t.Context(), ref) })
	}
	group.Wait()
	close(errorsChannel)
	deleted, retained := 0, 0
	for err := range errorsChannel {
		if err == nil {
			deleted++
		} else if errors.Is(err, schedule.ErrLastSchedule) {
			retained++
		} else {
			t.Fatal(err)
		}
	}
	if diff := cmp.Diff([]int{7, 1}, []int{deleted, retained}); diff != "" {
		t.Fatal(diff)
	}
	remaining, err := repo.List(t.Context(), user.User{ID: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(1, len(remaining.Schedules)); diff != "" {
		t.Fatal(diff)
	}
}
