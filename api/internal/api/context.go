package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pl3lee/uwplan/api/internal/config"
	"github.com/pl3lee/uwplan/api/internal/domain/session"
)

type requestKey struct{}
type requestData struct {
	Credentials       session.Credentials
	Origin, FetchSite string
}

func requestContext(cfg config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			data := requestData{Origin: r.Header.Get("Origin"), FetchSite: r.Header.Get("Sec-Fetch-Site")}
			if cookie, err := r.Cookie(cfg.CookieName()); err == nil {
				data.Credentials.Token = cookie.Value
			}
			ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
			defer cancel()
			ctx = context.WithValue(ctx, requestKey{}, data)
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func getRequest(ctx context.Context) requestData {
	data, _ := ctx.Value(requestKey{}).(requestData)
	return data
}

func internalError(ctx context.Context, err error) error {
	slog.ErrorContext(ctx, "api.request.failed", "event", "api.request.failed", "error_type", fmt.Sprintf("%T", err))
	return huma.Error500InternalServerError("Internal Server Error")
}
