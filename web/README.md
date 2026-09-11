# UWPlan web

React Router SSR application with React, TypeScript, Vite, Tailwind, Base UI,
TanStack Query, and an Orval-generated Huma client.

The rewrite is in progress. Public pages and the sign-in entry point are ported;
planner routes and full browser parity are still pending. Production continues
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
server test sends callback credential sentinels and verifies redacted output.
The custom server emits structured request logs without URLs, cookies, or other
request headers; OTLP export and release correlation are pending the deployment
stage. The web browser
checks exercise public pages and native provider form submission on the production
build in desktop/mobile Chromium. They intercept provider-entry navigation and
do not claim OAuth or planner parity. Shared Playwright assertions
remain in the repository's `e2e/` directory and must pass against the replacement
production build before it is deployed.
