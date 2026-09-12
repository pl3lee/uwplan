# UWPlan

Plan a University of Waterloo degree, select courses, manage academic-plan
templates, and compare term schedules. The monorepo contains a Go/Huma API and a
React Router SSR web application. PostgreSQL retains accounts and saved plans;
Redis stores opaque sessions. Google and GitHub provide sign-in.

## Local setup

Use Node 24, pnpm 10.34.5, Go 1.26, Docker with Compose, and OpenSSL.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait
set -a
. ./.env
set +a
pnpm db:migrate
pnpm dev:api
# In another terminal, load .env as above:
pnpm dev:web
```

Open `http://localhost:5173`. Configure provider credentials in `.env` and register
`http://localhost:5173/api/auth/callback/google` and
`http://localhost:5173/api/auth/callback/github` with the corresponding providers.
Keep `PUBLIC_ORIGIN` equal to the browser origin. The local Compose project owns
separate development volumes and publishes PostgreSQL/Redis only on loopback.
`docker compose stop` preserves that data. Do not use production credentials locally.

The Go commands read exported environment variables, rather than loading `.env`
automatically. `pnpm courses:update` atomically refreshes the course catalog;
`pnpm db:seed` adds the five built-in templates after their courses exist.
The live course source currently denies requests with HTTP 403; the importer
fails without changing stored data. See [API tooling](api/README.md).

## Architecture and generated contracts

Domain models own business rules; services orchestrate repository and gateway
ports. Repositories translate PostgreSQL records, and HTTP handlers map errors
and DTOs. Read [architecture guidance](api/AGENTS.md).

Huma generates checked-in OpenAPI JSON/YAML. Orval generates the web fetch client
and TanStack Query hooks. The web uses React 19, React Router 7, Vite, Tailwind 4,
Base UI, TanStack Form/Table, Biome, and Vitest.

```sh
pnpm generate
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
pnpm test:deploy
```

Generation is sequential; commit generated files with their source changes.
Go integration tests and Playwright own disposable PostgreSQL databases; browser
checks also own Redis and controlled OAuth providers. They never use the
operator's database. The complete behavior suite runs against the production application
build. See [browser testing](e2e/README.md), [API setup](api/README.md), and
[web setup](web/README.md).

## Data, deployment, and recovery

Goose bootstraps an empty database or adopts the verified legacy schema without
changing existing account IDs, saved data, or provider links. `drizzle/` is retained
migration history used by upgrade tests; it is not a runtime dependency.

CI checks contracts, Go and web tests, browser flows, immutable image smoke tests,
and real migration/paired rollback/backup restoration. It publishes separate API
and web digests in one release manifest and deploys them together through the
restricted DigitalOcean/Tailscale admission command. The prior immutable release
and legacy Compose configuration remain available for recovery.

Production exports structured server logs, traces, and health metrics through a
private VPS collector to PostHog. See the
[production runbook](ops/production/README.md) for release admission, readiness,
backup, and rollback, [architecture](docs/architecture.md) for system boundaries,
and [behavior coverage](docs/behavior-coverage.md) for required regression checks.
