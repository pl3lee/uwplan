package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
)

func TestConfigurationFailureDoesNotExposeCredentials(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, url, message, event string
		args                      []string
	}{
		{name: "missing database", message: "DATABASE_URL is required", event: "seed.config.invalid"},
		{name: "invalid database", url: "postgres://secret-user:secret-password@host/%invalid", message: "template seed failed", event: "seed.failed"},
		{name: "unexpected arguments", args: []string{"secret-argument"}, message: "usage: seed (requires DATABASE_URL)", event: "seed.config.invalid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var output bytes.Buffer
			if code := execute(t.Context(), tc.args, tc.url, &output); code != 1 {
				t.Fatalf("exit code %d", code)
			}
			var got map[string]any
			if err := json.Unmarshal(output.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			delete(got, "time")
			want := map[string]any{"level": "ERROR", "msg": tc.message, "service": "uwplan-seed", "event": tc.event}
			if diff := cmp.Diff(want, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestHelpNeedsNoDatabase(t *testing.T) {
	t.Parallel()
	for _, arg := range []string{"-h", "--help"} {
		var output bytes.Buffer
		if code := execute(t.Context(), []string{arg}, "", &output); code != 0 {
			t.Fatalf("exit code %d", code)
		}
		if diff := cmp.Diff("usage: seed (requires DATABASE_URL)", strings.TrimSpace(output.String())); diff != "" {
			t.Fatal(diff)
		}
	}
}
