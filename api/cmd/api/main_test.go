package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	collectorlog "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	"google.golang.org/protobuf/proto"
)

// Invoke the actual command entry point in a child test executable so os.Exit
// and deferred telemetry shutdown are part of the observed CLI behavior.
func TestAPIProcess(t *testing.T) {
	if os.Getenv("UWPLAN_TEST_API_PROCESS") == "1" {
		main()
	}
}

func TestFatalStartupEventReachesCollectorBeforeExit(t *testing.T) {
	var mutex sync.Mutex
	var events []string
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/logs" {
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Error(err)
				return
			}
			if strings.Contains(string(body), "private-canary") {
				t.Error("fatal export included credentials")
			}
			request := new(collectorlog.ExportLogsServiceRequest)
			if err := proto.Unmarshal(body, request); err != nil {
				t.Error(err)
				return
			}
			mutex.Lock()
			defer mutex.Unlock()
			for _, resource := range request.ResourceLogs {
				for _, scope := range resource.ScopeLogs {
					for _, record := range scope.LogRecords {
						events = append(events, record.Body.GetStringValue())
					}
				}
			}
		}
		w.Header().Set("Content-Type", "application/x-protobuf")
	}))
	defer collector.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIProcess$")
	command.Env = append(os.Environ(),
		"UWPLAN_TEST_API_PROCESS=1", "PUBLIC_ORIGIN=http://localhost",
		"DATABASE_URL=postgres://private-canary:private-canary@host/%invalid", "REDIS_URL=redis://localhost:6379",
		"AUTH_GOOGLE_ID=", "AUTH_GOOGLE_SECRET=", "AUTH_GITHUB_ID=", "AUTH_GITHUB_SECRET=",
		"OTEL_ENABLED=true", "OTEL_EXPORTER_OTLP_ENDPOINT="+collector.URL,
	)
	for _, signal := range []string{"LOGS", "TRACES", "METRICS"} {
		command.Env = append(command.Env,
			"OTEL_EXPORTER_OTLP_"+signal+"_ENDPOINT="+collector.URL+"/v1/"+strings.ToLower(signal),
			"OTEL_EXPORTER_OTLP_"+signal+"_HEADERS=",
		)
	}
	command.Env = append(command.Env, "OTEL_EXPORTER_OTLP_HEADERS=")
	output, err := command.CombinedOutput()
	var exitError *exec.ExitError
	if !errors.As(err, &exitError) || exitError.ExitCode() != 1 {
		t.Fatalf("API did not exit with its expected startup failure: %v", err)
	}
	if strings.Contains(string(output), "private-canary") {
		t.Fatal("fatal stdout included credentials")
	}
	mutex.Lock()
	defer mutex.Unlock()
	if diff := cmp.Diff([]string{"api.stopped"}, events); diff != "" {
		t.Fatalf("fatal exported events (-want +got):\n%s", diff)
	}
}
