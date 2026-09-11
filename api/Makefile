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

.PHONY: generate sqlc mocks
generate: sqlc mocks
sqlc:
	$(GO) tool sqlc generate
mocks:
	$(GO) tool mockery --config .mockery.yaml
