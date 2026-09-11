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
