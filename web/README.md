# UWPlan web

React Router SSR application with React, TypeScript, Vite, Tailwind, Base UI,
TanStack Query, and an Orval-generated Huma client.

The rewrite is in progress. Public pages, the sign-in entry point, course
selection, scheduling, template creation/copying/management, and administration
are ported, including shared OAuth browser-provider parity. Deployment and live
telemetry rehearsals are still pending. Production continues
to use the existing application until the cutover checks in
[`docs/rewrite-plan.md`](../docs/rewrite-plan.md) pass.

## Development

From the repository root, install the pinned pnpm version in `package.json`,
then run:

```sh
pnpm install --frozen-lockfile
pnpm dev:api
# In another terminal:
pnpm dev:web
```

The web server defaults to port 5173 in development and connects to
`http://127.0.0.1:8080`. Set the API's `PUBLIC_ORIGIN` to the browser-facing web
origin so redirects, cookies, and CSRF validation agree. Configure OAuth
credentials and PostgreSQL/Redis as described in [`api/README.md`](../api/README.md).

## Server configuration

| Variable | Purpose |
| --- | --- |
| `API_ORIGIN` | Internal API origin, required in production; never included in browser code |
| `PORT` | Web server listening port; the production server defaults to 3000 |
| `HOST` | Web server listening address |
| `OTEL_ENABLED` | Set to `true` to export server logs and request traces over OTLP/HTTP |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector base URL; standard per-signal endpoint and header variables are also supported |
| `OTEL_EXPORTER_OTLP_HEADERS` | Collector authentication headers; keep these in server secrets |
| `RELEASE_DIGEST` / `RELEASE_REVISION` | Immutable web image digest and source revision attached to logs and traces |

Build and run the production server:

```sh
pnpm build:web
API_ORIGIN=http://127.0.0.1:8080 pnpm --filter @uwplan/web start
```

The `/api/*` resource route forwards requests to the internal API. It preserves
browser Origin/Fetch Metadata, filters cookies to UWPlan authentication cookies,
preserves separate Set-Cookie headers and redirects, bounds request bodies, and
returns generic gateway errors. Only the API authorizes operations.

## Generated contracts and checks

```sh
make -C api generate
pnpm generate:web
pnpm check:web
pnpm test:web
pnpm build:web
pnpm --filter @uwplan/web test:server
pnpm --filter @uwplan/web exec playwright install chromium
pnpm --filter @uwplan/web test:browser
```

Commit `app/generated/` with API changes. CI regenerates it and rejects drift.
Vitest covers the transport, session lookup, and proxy boundary. The production
server tests send callback credential sentinels and verify redacted output and
OTLP payloads. The custom server emits structured logs as `uwplan-web` with
release identity, bounded route names, status, duration, and request/trace IDs.
It propagates W3C trace context to the API and accepts bounded validation IDs for
deployment checks. Query strings, raw paths, cookies, authorization headers, and
baggage are excluded. OTLP queues and export timeouts are bounded; collector
outages leave requests available, and shutdown flushes pending events. Live
collector routing and Grafana verification remain part of deployment. The web browser
checks exercise public pages and native provider form submission on the production
build in desktop/mobile Chromium. They intercept provider-entry navigation and
do not claim OAuth parity. The shared course-selection test also runs against
the real Go API, PostgreSQL, and Redis on the replacement production build in
Chromium, Firefox, and WebKit:

```sh
E2E_RUNTIME=go pnpm test:e2e --grep 'template choices and fixed/free course selections persist'
```

It covers academic-plan search/membership, fixed and free choices, selected-course
sorting/removal, and persistence after reload. Query invalidation reloads confirmed
API state after writes. Private loaders forward only authentication cookies,
responses are not cacheable, and expired API sessions return to sign-in.
Scheduling uses the same generated client for owned schedules, term ranges,
assignment/removal, and CSV export. It retains desktop drag/drop and mobile term
selectors. Schedule lists refresh after writes; deleting the active schedule moves
to the next owned schedule before refreshing. The original scheduling assertions
pass on the replacement production build, including exact downloaded CSV content:

```sh
E2E_RUNTIME=go pnpm test:e2e e2e/scheduling.spec.ts
```

The other shared Playwright assertions remain in the repository's `e2e/` directory and must pass against the replacement
production build before it is deployed.

Template forms use TanStack Form and the generated template API. The editor
preserves instruction, fixed/free requirement, separator, reorder, and remove
controls. Copying loads the selected definition through an authenticated loader;
the confirmation resets the form, and duplicate names get explicit feedback.
Owned-template queries back management; the admin loader and API both enforce
the current admin role. Successful template mutations refresh membership,
definitions, owned/all lists, and affected schedules.

CI runs all 33 shared cases on the replacement production build, including
Google/GitHub provisioning and returning-user sessions:

```sh
E2E_RUNTIME=go pnpm test:e2e
```

The provider fixture uses a temporary CA and restricted HTTPS proxy inside the
disposable Go stack. Production authentication logic and the shared browser
assertions remain unchanged. See `e2e/README.md` for isolation and prerequisites.
