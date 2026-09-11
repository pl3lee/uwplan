package observability

import (
	"net/http"
	"regexp"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

var validationID = regexp.MustCompile(`^validation-[a-f0-9-]{36}$`)

// Middleware records route templates and fixed metadata only. Request URLs,
// queries, bodies, cookies, authorization, and propagated baggage stay private.
func (t *Telemetry) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		parent := propagation.TraceContext{}.Extract(r.Context(), propagation.HeaderCarrier(r.Header))
		ctx, span := t.tracer.Start(parent, "http.request", trace.WithSpanKind(trace.SpanKindServer))
		defer span.End()
		requestID := uuid.NewString()
		w.Header().Set("X-Request-ID", requestID)
		response := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(response, r.WithContext(ctx))
		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = "unmatched"
		}
		method := r.Method
		switch method {
		case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS":
		default:
			method = "OTHER"
		}
		status := response.Status()
		if status == 0 {
			status = http.StatusOK
		}
		duration := float64(time.Since(started)) / float64(time.Millisecond)
		attributes := []attribute.KeyValue{attribute.String("http.route", route), attribute.String("http.request.method", method), attribute.Int("http.response.status_code", status)}
		span.SetName(method + " " + route)
		span.SetAttributes(attributes...)
		if status >= 500 {
			span.SetStatus(codes.Error, "")
		}
		event := "http.request"
		if route == "/api/live" || route == "/api/ready" {
			event = "health.request"
			labels := metric.WithAttributes(attribute.String("http.route", route), attribute.Int("http.response.status_code", status), attribute.String("service.version", t.release.Digest))
			t.healthRequests.Add(ctx, 1, labels)
			t.healthDuration.Record(ctx, duration, labels)
		}
		fields := []any{"event", event, "request_id", requestID, "method", method, "route", route, "status_code", status, "duration_ms", duration}
		if span.SpanContext().IsValid() {
			fields = append(fields, "trace_id", span.SpanContext().TraceID().String())
		}
		if candidate := r.Header.Get("X-UWPlan-Validation-ID"); validationID.MatchString(candidate) {
			fields = append(fields, "validation_id", candidate)
			span.SetAttributes(attribute.String("uwplan.validation.id", candidate))
		}
		t.Logger.InfoContext(ctx, event, fields...)
	})
}
