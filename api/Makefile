GO ?= go

.PHONY: test test-unit test-integration fmt migrate

test-unit:
	$(GO) test ./...

fmt:
	$(GO) fmt ./...

test: test-unit test-integration

test-integration:
	GO=$(GO) bash scripts/test-integration.sh

migrate:
	$(GO) run ./cmd/migrate

.PHONY: courses-update
courses-update:
	$(GO) run ./cmd/courses-update

.PHONY: seed
seed:
	$(GO) run ./cmd/seed

.PHONY: generate sqlc mocks
generate: sqlc mocks openapi
sqlc:
	$(GO) tool sqlc generate
mocks:
	$(GO) tool mockery --config .mockery.yaml

.PHONY: openapi run build
openapi:
	$(GO) run ./cmd/openapi
run:
	$(GO) run ./cmd/api
build:
	$(GO) build ./...
