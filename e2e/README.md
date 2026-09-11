# Browser behavior tests

With Docker, Go 1.26, Node 24, pnpm, and OpenSSL available:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
# Focused run:
pnpm test:e2e --project=chromium --grep 'course selections'
```

The runner creates its own PostgreSQL 16 and Redis containers, bootstraps the
schema through the Go migrator, builds the production API and React Router web,
and removes its resources afterward. It ignores the operator's database URL.
Each fixture creates an isolated user, plan, and template. Tests assert visible
behavior, persisted changes after reload, and exact CSV downloads. All 33 cases
remain required: Chromium runs the full suite, Firefox/WebKit run focused smoke
cases, and mobile WebKit verifies responsive navigation and scheduling.

Use `E2E_CHROMIUM_CHANNEL=chrome` for installed Chrome locally. CI uses the pinned
Playwright browsers and uploads failure traces, screenshots, and the report from
`output/playwright-go/`. `session-adapter.ts` seeds hashed opaque Redis sessions
only in the disposable runner. The application has no session fixture endpoint.

OAuth tests use real login forms, callbacks, provisioning, and account lookup.
The controlled provider validates credentials, one-use codes, PKCE, and signed
ID tokens. A temporary CA and HTTPS CONNECT proxy accept only the fixed provider
routes; they never forward to real providers. Trust is scoped to the disposable
API container and certificate verification stays enabled. Browser interception
retains the actual sign-in response/state cookie and redirects only the external
authorization destination. Fixtures are excluded from production images.

These checks exercise controlled providers. Real Google/GitHub sign-in is a
separate production check. Legacy schema adoption, retained candidate writes,
paired rollback, and usable backup restoration are also exercised independently
by `tests/paired-production-stack.py`; Go integration tests apply the retained
Drizzle migration history before adopting the baseline.

The landing-page video uses a deterministic iframe fixture so advertising cannot
hold the load event open. Application requests and the original behavior
assertions remain intact. The recorded legacy production refresh failure is
historical evidence in `docs/behavior-parity.md`; tests now always run the
replacement production build.
