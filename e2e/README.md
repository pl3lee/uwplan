# Browser behavior tests

Run `npm ci`, `npx playwright install chromium firefox webkit`, and
`npm run test:e2e`. Docker must be running. The runner creates a fresh PostgreSQL
16 container, applies all migrations, runs the current application in development mode, and removes the container
on completion. It overrides database/auth settings with disposable values and
does not connect to an existing development or production database.

For one browser or test, pass Playwright arguments after `--`, for example
`npm run test:e2e -- --project=chromium --grep 'course selections'`.
To use an installed Chrome locally, set `E2E_CHROMIUM_CHANNEL=chrome`.
CI uses Playwright's pinned browser builds. Failure screenshots, traces, and the
HTML report are in `output/playwright/` and uploaded by CI.

`fixtures.ts` creates a separate user, plan, and template for each test. Browser
assertions inspect the UI and downloads; direct database access is only fixture
setup. Keep those assertions when replacing the application's runtime. Replace
the session-seeding adapter when authentication changes. `session-adapter.ts`
supports both the legacy cookie/database session and the Go cookie/hashed Redis
session. Only the disposable runner creates Redis fixtures; there is no test
session endpoint in either application.

For the migrated course-selection flow, run:

```sh
E2E_RUNTIME=go pnpm test:e2e --grep 'template choices and fixed/free course selections persist'
```

This builds the production Go binary for the Docker host’s Linux architecture
and the React Router production application, adopts the legacy test schema with
Goose, and runs against real PostgreSQL and Redis. Docker, Go, pnpm, and OpenSSL
are required. Artifacts are in `output/playwright-go/`. The complete legacy suite
remains active during migration.

`oauth-server.mjs` implements a controlled OAuth/OIDC provider with one-use codes,
client credential checks, PKCE validation, and signed ID tokens. Auth tests use
the real login forms, callback handlers, provisioning, and account lookup. The
`provider-fetch.mjs` Node preload redirects provider network requests only in
Playwright's legacy server process. `provider-browser.ts` handles external
authorization navigation for both runtimes, retaining the real sign-in response
and its state cookie for the native Go redirect.
No login-bypass endpoint or test flag is added to the application. All these
fixtures are excluded from the production image context.

These tests verify integration with a controlled provider; production cutover
still requires a real Google and GitHub sign-in smoke check.

The legacy production build has a recorded intermittent server-action refresh
failure (see `docs/behavior-parity.md`). Reproduce it with
`E2E_PRODUCTION=1 npm run test:e2e`. The development baseline captures the intended
flows; it does not certify the legacy production runtime. The replacement must
run the same behavior assertions against its production build before cutover.

The landing-page video iframe uses a local browser response fixture, so third-party
video/ad requests cannot hold the page load event open. Application requests and
behavior assertions remain unchanged.

The scheduling assertions also run unchanged with `E2E_RUNTIME=go pnpm test:e2e e2e/scheduling.spec.ts`. The response helper recognizes a CSV GET
response for export as well as legacy POST actions; the exact downloaded content
assertion is shared. Selection, scheduling, and expired-session/logout flows are
required replacement-runtime CI checks during the remaining migration.

All 33 shared cases are required on the replacement production build, including
provider callbacks, template creation/copy/management, and admin access:

```sh
E2E_RUNTIME=go pnpm test:e2e
```

The Go runner creates an owned Docker network, a production API process, and a
provider fixture with bounded memory and read-only filesystems. Its HTTPS CONNECT
proxy accepts only the fixed Google/GitHub token, key, profile, and email routes;
it never forwards to real providers. A one-day certificate is generated per run
and trusted only by the API container through `SSL_CERT_FILE`/`SSL_CERT_DIR`.
Certificate verification stays enabled. The operator’s trust store and production
configuration are unchanged, and API handlers have no fixture flag or auth bypass.
Only loopback ports are published. Containers, network attachments, binary, and
certificate files are removed on completion, including failed test runs.

A release trace exposed a confirmation race in the legacy CRUD test: background
regions disappear from accessibility queries while a modal is open. The test now
waits for deletion acknowledgment before checking removal and navigating; its
saved-content assertions remain unchanged.
