package main

import (
	"encoding/json"
	"os"

	"github.com/pl3lee/uwplan/api/internal/api"
	"github.com/pl3lee/uwplan/api/internal/config"
)

func main() {
	_, app := api.NewRouter(config.Config{SecureCookies: true}, api.Dependencies{})
	data, err := json.MarshalIndent(app.OpenAPI(), "", "  ")
	if err != nil {
		panic(err)
	}
	yaml, err := app.OpenAPI().YAML()
	if err != nil {
		panic(err)
	}
	if err = os.MkdirAll("openapi", 0755); err != nil {
		panic(err)
	}
	if err = os.WriteFile("openapi/openapi.json", append(data, '\n'), 0644); err != nil {
		panic(err)
	}
	if err = os.WriteFile("openapi/openapi.yaml", yaml, 0644); err != nil {
		panic(err)
	}
}
