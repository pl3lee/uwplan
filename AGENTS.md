# UWPlan

## Architecture

- Follow `api/AGENTS.md` for domain objects, services, repositories, gateways,
  dependency ownership, errors, generated contracts, and Go tests.
- The monorepo has a Go/Huma API in `api/` and a React Router SSR frontend
  in `web/`. Keep business rules and authorization in the API. Generate the
  TypeScript client and query hooks from the Huma OpenAPI contract.
- Use UWPlan names in code, documentation, packages, images, and telemetry.

## Changes and validation

- Read `docs/architecture.md` and `docs/behavior-coverage.md` before changing runtime,
  authentication, persistence, deployment, or behavior coverage.
- Preserve account identities, ownership, saved data, URLs, and responsive flows.
- Keep releases deployable. Migrations must preserve compatibility with the
  retained rollback release; verify both legacy upgrade and empty setup.
- Preserve browser behavior assertions. Isolate test data and provider fixtures
  from production. Run generation before checks that consume generated files;
  do not build concurrently with browser tests in the same checkout.
- Before changing deployment or observability, read `ops/production/README.md`
  and `ops/production/paired-releases.md`.
- Keep generated artifacts checked in and reproducible. Complete the relevant
  test, build, generation, and deployment checks before merging.
