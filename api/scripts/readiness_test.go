package scripts_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// The image first starts a socket-only bootstrap server, stops it, and then
// starts its normal TCP server. Reproduce both phases without timing races.
func TestIntegrationRunnerWaitsForFinalServerAndCleansUp(t *testing.T) {
	t.Parallel()
	for _, scenario := range []string{"bootstrap then ready", "never ready"} {
		t.Run(scenario, func(t *testing.T) {
			t.Parallel()
			dir := t.TempDir()
			docker := `#!/usr/bin/env bash
set -eu
case "$1" in
run) echo fixture-container ;;
port) echo 127.0.0.1:15432 ;;
rm) echo cleanup >> "$SIMULATION_LOG" ;;
exec)
 count=0
 if [[ -f "$SIMULATION_LOG.count" ]]; then count=$(cat "$SIMULATION_LOG.count"); fi
 count=$((count+1)); echo "$count" > "$SIMULATION_LOG.count"
 if [[ "$SIMULATION_SCENARIO" == "never ready" ]]; then exit 2; fi
 if [[ " $* " != *" -h 127.0.0.1 "* ]]; then
   if [[ "$count" == 1 ]]; then exit 0; else exit 2; fi
 fi
 if [[ "$count" -lt 3 ]]; then exit 2; fi
 ;;
*) exit 99 ;;
esac
`
			for name, body := range map[string]string{"docker": docker, "sleep": "#!/bin/sh\nexit 0\n", "go-fixture": "#!/bin/sh\necho tests >> \"$SIMULATION_LOG\"\n"} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0700); err != nil {
					t.Fatal(err)
				}
			}
			log := filepath.Join(dir, "events")
			cmd := exec.CommandContext(t.Context(), "bash", "test-integration.sh")
			cmd.Env = append(os.Environ(), "PATH="+dir+string(os.PathListSeparator)+os.Getenv("PATH"), "GO="+filepath.Join(dir, "go-fixture"), "SIMULATION_LOG="+log, "SIMULATION_SCENARIO="+scenario)
			output, err := cmd.CombinedOutput()
			if (err == nil) != (scenario == "bootstrap then ready") {
				t.Fatalf("err=%v output=%s", err, output)
			}
			data, err := os.ReadFile(log)
			if err != nil {
				t.Fatal(err)
			}
			want := []string{"tests", "cleanup"}
			if scenario == "never ready" {
				want = []string{"cleanup"}
			}
			if diff := cmp.Diff(want, strings.Fields(string(data))); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
