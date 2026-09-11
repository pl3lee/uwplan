package api

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pl3lee/uwplan/api/internal/domain/health"
)

type LiveBody struct {
	Status string `json:"status" enum:"live"`
}
type LiveResponse struct{ Body LiveBody }
type ReadinessBody struct {
	Status  string `json:"status" enum:"ready,unready"`
	Release struct {
		Digest   string `json:"digest"`
		Revision string `json:"revision"`
	} `json:"release"`
	Dependencies struct {
		Database health.State `json:"database" enum:"available,unavailable"`
		Redis    health.State `json:"redis" enum:"available,unavailable"`
	} `json:"dependencies"`
}
type ReadinessResponse struct {
	Status int
	Body   ReadinessBody
}

func registerHealth(app huma.API, gateway HealthGateway, release health.Release) {
	huma.Register(app, huma.Operation{OperationID: "getLiveness", Method: http.MethodGet, Path: "/api/live", Summary: "Check API liveness"}, func(ctx context.Context, input *struct{}) (*LiveResponse, error) {
		return &LiveResponse{Body: LiveBody{Status: "live"}}, nil
	})
	huma.Register(app, huma.Operation{OperationID: "getReadiness", Method: http.MethodGet, Path: "/api/ready", Summary: "Check database and session readiness"}, func(ctx context.Context, input *struct{}) (*ReadinessResponse, error) {
		ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		report := gateway.Check(ctx)
		response := &ReadinessResponse{Status: http.StatusServiceUnavailable}
		response.Body.Status = "unready"
		safeRelease, releaseValid := release.Public()
		if report.Ready() && releaseValid {
			response.Status = http.StatusOK
			response.Body.Status = "ready"
		}
		response.Body.Release.Digest = safeRelease.Digest
		response.Body.Release.Revision = safeRelease.Revision
		response.Body.Dependencies.Database = report.Database
		response.Body.Dependencies.Redis = report.Redis
		return response, nil
	})
	// Readiness uses the same complete body on both success and dependency failure.
	op := app.OpenAPI().Paths["/api/ready"].Get
	op.Responses["503"] = &huma.Response{Description: "Dependencies unavailable", Content: op.Responses["200"].Content}
}
