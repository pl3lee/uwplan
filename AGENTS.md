# UWPlan

## Architecture

- Follow `api/AGENTS.md` for domain objects, services, repositories, gateways,
  dependency ownership, errors, generated contracts, and Go tests.
- The target monorepo has a Go/Huma API in `api/` and a React Router SSR frontend
  in `web/`. Keep business rules and authorization in the API. Generate the
  TypeScript client and query hooks from the Huma OpenAPI contract.
- Use UWPlan names in code, documentation, packages, images, and telemetry.

## Migration work

- Read `docs/rewrite-plan.md` and `docs/behavior-parity.md` before changing runtime,
  authentication, persistence, deployment, or behavior coverage.
- Preserve account identities, ownership, saved data, URLs, and responsive flows.
  Existing users may sign in once after the session cutover.
- Keep intermediate releases deployable. Migrations must preserve compatibility
  with the retained rollback release; verify both legacy upgrade and empty setup.
- Keep browser behavior assertions across implementations. Isolate test data and
  provider fixtures from production. Run generation before checks that consume generated files; do not
  build concurrently with browser tests in the same checkout.
- Before changing deployment or observability, read `ops/production/README.md`
  and `ops/production/paired-releases.md`.
- Keep generated artifacts checked in and reproducible. Complete the relevant
  test, build, generation, and deployment checks before merging.
