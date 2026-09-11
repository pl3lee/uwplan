package observability

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"time"

	"github.com/pl3lee/uwplan/api/internal/domain/health"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/metric"
	metricnoop "go.opentelemetry.io/otel/metric/noop"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	tracenoop "go.opentelemetry.io/otel/trace/noop"
)

const ServiceName = "uwplan-api"

type Options struct {
	Enabled bool
	Release health.Release
	Output  io.Writer
}

type Telemetry struct {
	Logger         *slog.Logger
	Shutdown       func(context.Context) error
	tracer         trace.Tracer
	healthRequests metric.Int64Counter
	healthDuration metric.Float64Histogram
	release        health.Release
}

// Setup keeps stdout available and uses a bounded, asynchronous OTLP queue.
// Standard OTLP environment variables configure endpoint and authorization.
func Setup(ctx context.Context, options Options) (*Telemetry, error) {
	output := options.Output
	if output == nil {
		output = os.Stdout
	}
	release, _ := options.Release.Public()
	stdout := slog.NewJSONHandler(output, nil)
	fields := []any{"service", ServiceName, "release_digest", release.Digest, "release_revision", release.Revision}
	telemetry := &Telemetry{Logger: slog.New(stdout).With(fields...), Shutdown: func(context.Context) error { return nil }}
	telemetry.tracer = tracenoop.NewTracerProvider().Tracer(ServiceName)
	telemetry.release = release
	telemetry.instruments(metricnoop.NewMeterProvider().Meter(ServiceName))
	if !options.Enabled {
		return telemetry, nil
	}
	// SDK failures can contain collector URLs or headers. Emit only their type,
	// directly to stdout so a collector outage cannot recursively export itself.
	localLogger := telemetry.Logger
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		localLogger.Error("telemetry.export.failed", "event", "telemetry.export.failed", "error_type", fmt.Sprintf("%T", err))
	}))
	exporter, err := otlploghttp.New(ctx, otlploghttp.WithTimeout(2*time.Second))
	if err != nil {
		return nil, err
	}
	res := resource.NewSchemaless(
		attribute.String("service.name", ServiceName),
		attribute.String("service.version", release.Digest),
		attribute.String("vcs.ref.head.revision", release.Revision),
	)
	provider := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(exporter,
			sdklog.WithMaxQueueSize(512), sdklog.WithExportMaxBatchSize(128),
			sdklog.WithExportInterval(time.Second), sdklog.WithExportTimeout(2*time.Second),
		)),
	)
	telemetry.Logger = slog.New(slog.NewMultiHandler(stdout, otelslog.NewHandler(ServiceName, otelslog.WithLoggerProvider(provider)))).With(fields...)
	telemetry.Shutdown = provider.Shutdown
	traceExporter, err := otlptracehttp.New(ctx, otlptracehttp.WithTimeout(2*time.Second))
	if err != nil {
		_ = telemetry.Shutdown(ctx)
		return nil, err
	}
	traceProvider := sdktrace.NewTracerProvider(sdktrace.WithResource(res),
		sdktrace.WithBatcher(traceExporter, sdktrace.WithMaxQueueSize(512), sdktrace.WithMaxExportBatchSize(128), sdktrace.WithBatchTimeout(time.Second), sdktrace.WithExportTimeout(2*time.Second)))
	telemetry.tracer = traceProvider.Tracer(ServiceName)
	telemetry.Shutdown = func(ctx context.Context) error {
		return errors.Join(provider.Shutdown(ctx), traceProvider.Shutdown(ctx))
	}
	metricExporter, err := otlpmetrichttp.New(ctx, otlpmetrichttp.WithTimeout(2*time.Second))
	if err != nil {
		_ = telemetry.Shutdown(ctx)
		return nil, err
	}
	meterProvider := sdkmetric.NewMeterProvider(sdkmetric.WithResource(res), sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter, sdkmetric.WithInterval(time.Minute), sdkmetric.WithTimeout(2*time.Second))))
	telemetry.instruments(meterProvider.Meter(ServiceName))
	telemetry.Shutdown = func(ctx context.Context) error {
		return errors.Join(provider.Shutdown(ctx), traceProvider.Shutdown(ctx), meterProvider.Shutdown(ctx))
	}
	return telemetry, nil
}

func (t *Telemetry) instruments(meter metric.Meter) {
	t.healthRequests, _ = meter.Int64Counter("uwplan.health.requests", metric.WithDescription("UWPlan health endpoint requests"))
	t.healthDuration, _ = meter.Float64Histogram("uwplan.health.duration", metric.WithUnit("ms"), metric.WithDescription("UWPlan health endpoint response latency"))
}
