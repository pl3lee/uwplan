# Browser behavior tests

Run `npm ci`, `npx playwright install chromium firefox webkit`, and
`npm run test:e2e`. Docker must be running. The runner creates a fresh PostgreSQL
16 container, applies all migrations, builds and runs the production app, and removes the container
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
the session-seeding adapter when authentication moves to Redis.

`oauth-server.mjs` implements a controlled OAuth/OIDC provider with one-use codes,
client credential checks, PKCE validation, and signed ID tokens. Auth tests use
the real login forms, callback handlers, provisioning, and account lookup. The
`provider-fetch.mjs` Node preload redirects provider network requests only in
Playwright's server process. Browser routing redirects GitHub's fixed login URL.
No login-bypass endpoint or test flag is added to the application. All these
fixtures are excluded from the production image context.

These tests verify integration with a controlled provider; production cutover
still requires a real Google and GitHub sign-in smoke check.
