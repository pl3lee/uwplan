//go:build integration

package health_test

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/go-cmp/cmp"
	domainhealth "github.com/pl3lee/uwplan/api/internal/domain/health"
	gatewayhealth "github.com/pl3lee/uwplan/api/internal/gateway/health"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
	"github.com/redis/go-redis/v9"
)

func TestReadinessReflectsDependencyAvailability(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	t.Cleanup(func() { client.Close() })
	gateway := gatewayhealth.NewHealthGateway(pool, client)
	want := domainhealth.Report{Database: domainhealth.Available, Redis: domainhealth.Available}
	if diff := cmp.Diff(want, gateway.Check(t.Context())); diff != "" {
		t.Fatal(diff)
	}
	server.SetError("fixture outage")
	want.Redis = domainhealth.Unavailable
	if diff := cmp.Diff(want, gateway.Check(t.Context())); diff != "" {
		t.Fatal(diff)
	}
	server.SetError("")
	pool.Close()
	want = domainhealth.Report{Database: domainhealth.Unavailable, Redis: domainhealth.Available}
	if diff := cmp.Diff(want, gateway.Check(t.Context())); diff != "" {
		t.Fatal(diff)
	}
}
