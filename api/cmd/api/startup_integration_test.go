//go:build integration

package main

import (
	"bytes"
	"context"
	"net"
	"net/http"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
	"github.com/pl3lee/uwplan/api/migrations"
)

func TestStartupMigratesBeforeServingAndRejectsInvalidSchema(t *testing.T) {
	t.Parallel()
	for _, invalid := range []bool{false, true} {
		name := "empty database and restart"
		if invalid {
			name = "incompatible schema"
		}
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			pool := postgres.NewUnmigratedPool(t)
			if invalid {
				if _, err := pool.Exec(t.Context(), "CREATE TABLE unexpected(id integer)"); err != nil {
					t.Fatal(err)
				}
			}
			for attempt := 0; attempt < 2; attempt++ {
				listener, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				address := listener.Addr().String()
				listener.Close()
				ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
				defer cancel()
				command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIProcess$")
				command.Env = append(os.Environ(), "UWPLAN_TEST_API_PROCESS=1", "HTTP_ADDR="+address,
					"PUBLIC_ORIGIN=http://localhost", "DATABASE_URL="+pool.Config().ConnString(),
					"REDIS_URL=redis://127.0.0.1:1", "OTEL_ENABLED=false",
					"AUTH_GOOGLE_ID=", "AUTH_GOOGLE_SECRET=", "AUTH_GITHUB_ID=", "AUTH_GITHUB_SECRET=")
				var output bytes.Buffer
				command.Stdout = &output
				command.Stderr = &output
				if err := command.Start(); err != nil {
					t.Fatal(err)
				}
				done := make(chan error, 1)
				go func() { done <- command.Wait() }()
				if invalid {
					err := <-done
					if err == nil {
						t.Fatal("startup succeeded with invalid schema")
					}
					if bytes.Contains(output.Bytes(), []byte("api.started")) {
						t.Fatal("served before migration succeeded")
					}
					return
				}
				client := http.Client{Timeout: time.Second}
				ready := false
				for !ready {
					select {
					case err := <-done:
						t.Fatalf("API stopped before serving: %v; %s", err, output.String())
					case <-ctx.Done():
						t.Fatal("API did not start after migrating")
					default:
					}
					response, err := client.Get("http://" + address + "/api/live")
					if err == nil {
						ready = response.StatusCode == http.StatusOK
						response.Body.Close()
					}
					if !ready {
						time.Sleep(20 * time.Millisecond)
					}
				}
				var version int
				if err := pool.QueryRow(t.Context(), "SELECT max(version_id) FROM goose_db_version WHERE is_applied").Scan(&version); err != nil {
					t.Fatal(err)
				}
				if diff := cmp.Diff(migrations.CurrentVersion, version); diff != "" {
					t.Fatal(diff)
				}
				command.Process.Signal(os.Interrupt)
				if err := <-done; err != nil {
					t.Fatalf("API shutdown: %v; %s", err, output.String())
				}
			}
		})
	}
}
