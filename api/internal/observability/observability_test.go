package observability_test

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/api"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/health"
	"github.com/pl3lee/uwplan/api/internal/observability"
	collectorlog "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collectormetric "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

func TestLogsReachCollectorWithReleaseIdentity(t *testing.T) {
	var mutex sync.Mutex
	var received []*collectorlog.ExportLogsServiceRequest
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if diff := cmp.Diff("fixture-collector-token", r.Header.Get("Authorization")); diff != "" {
			t.Errorf("collector authorization: %s", diff)
		}
		// Other signal payloads are exercised by the HTTP correlation test below.
		if r.URL.Path == "/v1/metrics" || r.URL.Path == "/v1/traces" {
			w.Header().Set("Content-Type", "application/x-protobuf")
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		request := new(collectorlog.ExportLogsServiceRequest)
		if r.URL.Path != "/v1/logs" || proto.Unmarshal(body, request) != nil {
			t.Error("unexpected collector request")
			w.WriteHeader(400)
			return
		}
		mutex.Lock()
		received = append(received, request)
		mutex.Unlock()
		w.Header().Set("Content-Type", "application/x-protobuf")
		w.WriteHeader(200)
	}))
	defer collector.Close()
	configureCollector(t, collector.URL)
	release := health.Release{Digest: "sha256:" + strings.Repeat("a", 64), Revision: strings.Repeat("b", 40)}
	telemetry, err := observability.Setup(context.Background(), observability.Options{Enabled: true, Release: release, Output: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	telemetry.Logger.Info("telemetry.validation", "event", "telemetry.validation", "validation_id", "validation-11111111-1111-1111-1111-111111111111")
	if err := telemetry.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	mutex.Lock()
	defer mutex.Unlock()
	type event struct {
		Resource, Attributes map[string]string
		Body                 string
		Severity             int32
	}
	var got []event
	for _, request := range received {
		for _, resource := range request.ResourceLogs {
			attributes := map[string]string{}
			for _, attribute := range resource.Resource.Attributes {
				attributes[attribute.Key] = attribute.Value.GetStringValue()
			}
			for _, scope := range resource.ScopeLogs {
				for _, record := range scope.LogRecords {
					item := event{Resource: attributes, Attributes: map[string]string{}, Body: record.Body.GetStringValue(), Severity: int32(record.SeverityNumber)}
					for _, attribute := range record.Attributes {
						item.Attributes[attribute.Key] = attribute.Value.GetStringValue()
					}
					got = append(got, item)
				}
			}
		}
	}
	want := []event{{
		Resource:   map[string]string{"service.name": "uwplan-api", "service.version": release.Digest, "vcs.ref.head.revision": release.Revision},
		Attributes: map[string]string{"service": "uwplan-api", "release_digest": release.Digest, "release_revision": release.Revision, "event": "telemetry.validation", "validation_id": "validation-11111111-1111-1111-1111-111111111111"},
		Body:       "telemetry.validation", Severity: 9,
	}}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatalf("exported events (-want +got):\n%s", diff)
	}
}

func TestCollectorOutageDoesNotBlockHealthRequests(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() { close(started) })
		select {
		case <-release:
		case <-r.Context().Done():
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer collector.Close()
	defer close(release)
	configureCollector(t, collector.URL)
	telemetry, err := observability.Setup(context.Background(), observability.Options{Enabled: true, Output: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		_ = telemetry.Shutdown(ctx)
	}()
	telemetry.Logger.Info("telemetry.validation", "event", "telemetry.validation")
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("collector never received the pending export")
	}
	router, _ := api.NewRouter(config.Config{PublicOrigin: "http://localhost"}, api.Dependencies{Telemetry: telemetry})
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { router.ServeHTTP(response, httptest.NewRequest("GET", "/api/live", nil)); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("collector outage blocked liveness")
	}
	var body api.LiveBody
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(api.LiveBody{Status: "live"}, body); diff != "" {
		t.Fatal(diff)
	}
}

func TestHealthRequestExportsCorrelatedSafeLogsTracesAndMetrics(t *testing.T) {
	var mutex sync.Mutex
	var logRequests []*collectorlog.ExportLogsServiceRequest
	var traceRequests []*collectortrace.ExportTraceServiceRequest
	var metricRequests []*collectormetric.ExportMetricsServiceRequest
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		mutex.Lock()
		defer mutex.Unlock()
		var message proto.Message
		switch r.URL.Path {
		case "/v1/logs":
			request := new(collectorlog.ExportLogsServiceRequest)
			logRequests = append(logRequests, request)
			message = request
		case "/v1/traces":
			request := new(collectortrace.ExportTraceServiceRequest)
			traceRequests = append(traceRequests, request)
			message = request
		case "/v1/metrics":
			request := new(collectormetric.ExportMetricsServiceRequest)
			metricRequests = append(metricRequests, request)
			message = request
		default:
			t.Error("unexpected collector path")
			w.WriteHeader(404)
			return
		}
		if err := proto.Unmarshal(body, message); err != nil {
			t.Error(err)
		}
		if bytes.Contains(body, []byte("private-canary")) {
			t.Error("private request data reached collector")
		}
		w.Header().Set("Content-Type", "application/x-protobuf")
	}))
	defer collector.Close()
	configureCollector(t, collector.URL)
	var output bytes.Buffer
	telemetry, err := observability.Setup(context.Background(), observability.Options{Enabled: true, Output: &output})
	if err != nil {
		t.Fatal(err)
	}
	router, _ := api.NewRouter(config.Config{PublicOrigin: "http://localhost"}, api.Dependencies{Telemetry: telemetry})
	request := httptest.NewRequest("GET", "/api/live?code=private-canary&state=private-canary", nil)
	request.Header.Set("Cookie", "uwplan_session=private-canary")
	request.Header.Set("Authorization", "Bearer private-canary")
	request.Header.Set("Traceparent", "00-11111111111111111111111111111111-2222222222222222-01")
	request.Header.Set("Baggage", "secret=private-canary")
	request.Header.Set("X-UWPlan-Validation-ID", "validation-33333333-3333-3333-3333-333333333333")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	var body api.LiveBody
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(api.LiveBody{Status: "live"}, body); diff != "" {
		t.Fatal(diff)
	}
	if err := telemetry.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output.String(), "private-canary") {
		t.Fatal("private request data reached stdout")
	}
	mutex.Lock()
	defer mutex.Unlock()
	type correlation struct{ Trace, Parent, Name string }
	var traces []correlation
	var logTraces []string
	metrics := map[string]uint64{}
	for _, request := range traceRequests {
		for _, resource := range request.ResourceSpans {
			for _, scope := range resource.ScopeSpans {
				for _, span := range scope.Spans {
					traces = append(traces, correlation{hex.EncodeToString(span.TraceId), hex.EncodeToString(span.ParentSpanId), span.Name})
				}
			}
		}
	}
	for _, request := range logRequests {
		for _, resource := range request.ResourceLogs {
			for _, scope := range resource.ScopeLogs {
				for _, record := range scope.LogRecords {
					logTraces = append(logTraces, hex.EncodeToString(record.TraceId))
				}
			}
		}
	}
	for _, request := range metricRequests {
		for _, resource := range request.ResourceMetrics {
			for _, scope := range resource.ScopeMetrics {
				for _, metric := range scope.Metrics {
					if sum := metric.GetSum(); sum != nil {
						for _, point := range sum.DataPoints {
							metrics[metric.Name] += uint64(point.GetAsInt())
						}
					}
					if histogram := metric.GetHistogram(); histogram != nil {
						for _, point := range histogram.DataPoints {
							metrics[metric.Name] += point.Count
						}
					}
				}
			}
		}
	}
	if diff := cmp.Diff([]correlation{{"11111111111111111111111111111111", "2222222222222222", "GET /api/live"}}, traces); diff != "" {
		t.Fatalf("traces: %s", diff)
	}
	if diff := cmp.Diff([]string{"11111111111111111111111111111111"}, logTraces); diff != "" {
		t.Fatalf("log trace IDs: %s", diff)
	}
	if diff := cmp.Diff(map[string]uint64{"uwplan.health.requests": 1, "uwplan.health.duration": 1}, metrics); diff != "" {
		t.Fatalf("metrics: %s", diff)
	}
}

func configureCollector(t *testing.T, origin string) {
	t.Helper()
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", origin)
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "")
	for _, signal := range []string{"LOGS", "TRACES", "METRICS"} {
		t.Setenv("OTEL_EXPORTER_OTLP_"+signal+"_ENDPOINT", origin+"/v1/"+strings.ToLower(signal))
		t.Setenv("OTEL_EXPORTER_OTLP_"+signal+"_HEADERS", "authorization=fixture-collector-token")
	}
}
