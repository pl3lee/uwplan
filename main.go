package main

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
	"github.com/pl3lee/uwplan/internal/repository/user"
)

//go:embed ui/dist
var embeddedFiles embed.FS

func uiRouter() http.Handler {
	r := chi.NewRouter()

	distFS, err := fs.Sub(embeddedFiles, "ui/dist")
	if err != nil {
		panic(err)
	}

	// Serve static files and handle SPA routing
	r.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		if _, err := fs.Stat(distFS, path); err != nil {
			// File doesn't exist, serve index.html for SPA routing
			path = "index.html"
		}

		ext := filepath.Ext(path)
		switch ext {
		case ".js":
			w.Header().Set("Content-Type", "application/javascript")
		case ".css":
			w.Header().Set("Content-Type", "text/css")
		case ".html":
			w.Header().Set("Content-Type", "text/html")
		case ".svg":
			w.Header().Set("Content-Type", "image/svg+xml")
		}

		http.ServeFileFS(w, r, distFS, path)
	}))
	return r
}

func apiRouter(appConfig AppConfig) http.Handler {
	r := chi.NewRouter()
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	return r
}

type AppConfig struct {
	UserRepo *user.Queries
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Printf("Cannot read .env file, this is normal when running in a docker container: %v\n", err)
	}
	dbUrl := os.Getenv("DATABASE_URL")
	if dbUrl == "" {
		log.Fatal("DATABASE_URL not set")
	}
	db, err := sql.Open("postgres", dbUrl)
	if err != nil {
		log.Fatalf("cannot open database: %v", err)
	}
	userRepo := user.New(db)
	appCfg := AppConfig{
		UserRepo: userRepo,
	}
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Mount("/api", apiRouter(appCfg))
	r.Mount("/", uiRouter())

	fmt.Println("Server starting on :8080")
	http.ListenAndServe(":8080", r)
}
