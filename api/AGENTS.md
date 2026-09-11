# AGENTS.md - UWPlan API

Repo-specific conventions for this project.

## Architecture

- Define domain objects in `internal/domain/`.
- Each domain struct, or related group of structs, lives in its own package in `models.go`.
- If business logic belongs to that domain, put the methods in the same package.
- Define services in `internal/service/`, repositories in `internal/repository/`, and gateways in `internal/gateway/`.

## Package Layout

For each service/gateway package:

- `interface.go` defines consumer-owned dependency interfaces, such as repository ports a service needs
- `impl.go` defines the concrete implementation
- generated mocks should be in-package in a single package-level `mock.go` file via mockery v3

For API handler packages:

- prefer concrete services in production wiring
- if HTTP unit tests need isolation, define the service-facing interface in the API layer, not in the service package
- generated API service mocks should live beside the API-owned interface in the package-level `mock.go` file

For repository packages:

- expose concrete implementations from `impl.go`
- keep storage translation and infrastructure details inside the repository package
- do not define repository interfaces in repository packages unless another repository package is the actual consumer

For each domain package:

- `models.go` defines the domain objects and domain behavior
- `errors.go` defines domain-specific sentinel errors

## Naming

- Interface names should be like `SomethingRepository`, `SomethingGateway`, or an API-owned `SomethingService` port.
- Concrete implementations should be named consistently like `SomethingServiceImpl`, `SomethingRepositoryImpl`, and `SomethingGatewayImpl`.
- Interfaces should live with the package that consumes them, not the package that implements them.
- Services should define only the repository or gateway methods they need in the service package.
- Service packages should not define service interfaces for their own implementations.
- Service and repository constructors should usually return concrete implementation pointers; consumers accept their own interface when they need substitution.

## Domain Boundaries

- Service/gateway/repository methods should take domain objects in and return domain objects out.
- Service/gateway/repository methods should return standard `error` values for failures.
- Do not couple domain structs to database models.
- Even if DB rows match shape, define the domain structs separately in `internal/domain/`.

## Errors

- Domain-specific errors should live in `internal/domain/<domain>/errors.go` as package-level sentinel `var` values.
- Repositories and gateways should translate infrastructure-specific failures into domain sentinel errors only when the failure represents a meaningful domain state, such as not found.
- Services should preserve domain sentinel identity when adding context by wrapping with `%w`.
- Handlers translate domain errors to transport-specific responses, such as HTTP status codes.
- Unexpected infrastructure failures may be wrapped with operation context and should be treated as internal errors by handlers.

## IDs

- Preserve existing IDs and account links when reading or migrating legacy data.
- Use monotonically increasing UUIDs for new IDs in this repo.
- Prefer UUIDv7 for newly generated IDs.

## Persistence

- Prefer sqlc for DB interaction, then translate generated DB types to domain objects inside repository implementations.
- Sessions are stored in Redis via the session repository, not in PostgreSQL tables.

## API Contract

- Keep HTTP JSON request and response fields in **snake_case**, not camelCase.
- Keep 500 responses generic. Do not pass underlying errors to `huma.Error500InternalServerError`; use a client-safe message such as `"Internal Server Error"` so internal error details are not serialized in the response body.
- When API request/response structs change, regenerate the OpenAPI spec with `make openapi`.
- Keep generated API artifacts checked in and up to date with the source.

## Testing

- Use the Makefile targets for test runs. Prefer `make test-unit` for default/unit coverage and `make test` for the full suite with integration setup; do not run integration tests with raw `go test -tags=integration` unless intentionally bypassing the Makefile.
- Prefer table-driven tests whenever they fit the code under test.
- Prefer `go-cmp` (`cmp.Diff`) for comparing expected and actual structs, slices, maps, and response bodies in tests.
- When testing API responses, including error responses, decode the body and use only `go-cmp` (`cmp.Diff`) to assert the entire response body shape; do not assert individual struct fields or substrings.
- Tests that depend on other services, repositories, or gateways should always use the mockery-generated mocks.
- Database-backed integration tests should live beside the package they test.
- Database-backed integration tests should use the `integration` build tag so normal `go test ./...` skips them.
- Use `make test-integration` to run the integration suite with its isolated dependencies.
- `make test-unit` should run only unit/default tests.
- `make test` should run both unit and integration coverage.
- Integration tests should use `internal/testutil/postgres.NewPool` so pgtestdb creates a fresh migrated PostgreSQL database per test or subtest.
- Integration tests should call `t.Parallel()` where the test owns its dependencies.
