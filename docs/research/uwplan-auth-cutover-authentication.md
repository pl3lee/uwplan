# Authentication model for the uwplan rehearsal and cutover

## Decision

Use two deliberately separate authentication identities:

1. **Rehearsal identity at `v2.uwplan.com`.** Caddy protects the entire HTTPS site with a shared Basic Auth credential distributed only to named testers. The rehearsal app uses its own `AUTH_SECRET`, its own Google OAuth client, its own GitHub OAuth app, and only the cloned rehearsal database.
2. **Production identity at `uwplan.com`.** During cutover, stop routing `v2.uwplan.com` to the app, replace every rehearsal credential with the existing production `AUTH_SECRET` and production Google/GitHub credentials, and point the app only at the final migrated production database. Preserve the production `session` rows and the default Auth.js cookie configuration.

Set `AUTH_TRUST_HOST=true` in both environments and do not set `AUTH_URL`. Auth.js v5 normally derives its origin from request headers, while a Docker deployment behind a reverse proxy must trust the proxy-provided host; Caddy supplies `X-Forwarded-Host` and `X-Forwarded-Proto` itself and ignores spoofed incoming values by default. Avoiding a fixed `AUTH_URL` also removes a hostname-specific setting from the rehearsal-to-production switch. This assumes Caddy is the internet-facing proxy; if another proxy or CDN is later placed in front of it, its trusted-proxy configuration must be reviewed first. [Auth.js deployment guidance](https://authjs.dev/getting-started/deployment#auth_trust_host), [Caddy forwarded-header behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults)

This is a configuration decision, not permission to create OAuth clients, secrets, or host configuration during planning.

## Why existing production sessions survive

The deployed application uses Auth.js `5.0.0-beta.30`, configures the Drizzle adapter, and supplies the `session` table to that adapter. As checked on 2026-08-01, the `production` and `main` branches had no differences in the relevant auth configuration. [Pinned dependency](https://github.com/pl3lee/uwplan/blob/72e012271da892c0e03bf8cba43fb25d73cdec47/package.json#L54), [adapter configuration](https://github.com/pl3lee/uwplan/blob/72e012271da892c0e03bf8cba43fb25d73cdec47/src/server/auth/config.ts#L44-L62), [session schema](https://github.com/pl3lee/uwplan/blob/72e012271da892c0e03bf8cba43fb25d73cdec47/src/server/db/schema.ts#L80-L101)

With an adapter present, Auth.js defaults to the database session strategy. Its HTTPS session cookie is `__Secure-authjs.session-token`, contains only the opaque database `sessionToken`, and defaults to `HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/`. No `Domain` is set, so the cookie is host-only. [Auth.js session strategy](https://authjs.dev/reference/core#strategy), [exact cookie defaults in `@auth/core@0.37.3`](https://github.com/nextauthjs/next-auth/blob/%40auth/core%400.37.3/packages/core/src/lib/utils/cookie.ts#L59-L90)

Consequently:

- A browser's `uwplan.com` session cookie is not sent to `v2.uwplan.com`, so importing production session rows into the rehearsal database does not automatically sign a tester into the rehearsal.
- The final DNS change does not change the browser-visible hostname. The existing `uwplan.com` cookie therefore continues to be sent after cutover.
- The restored production database can resolve that cookie because its matching `session` row is preserved. Auth.js retrieves database sessions by the cookie's session token. [Auth.js database-session behavior](https://authjs.dev/concepts/session-strategies#database-session), [exact session lookup in `@auth/core@0.37.3`](https://github.com/nextauthjs/next-auth/blob/%40auth/core%400.37.3/packages/core/src/lib/actions/session.ts#L85-L156)

The production `AUTH_SECRET` must still be preserved exactly, as already required by the migration map. Auth.js uses it to hash tokens, sign cookies, and derive cryptographic keys; preserving it also protects auth artifacts other than the opaque database session token and avoids relying on undocumented behavior in a beta release. An OAuth flow already in progress at the maintenance boundary may still need to be retried because its short-lived state, nonce, or PKCE material spans the restart. [Auth.js secret reference](https://authjs.dev/reference/core#secret), [deployment requirements](https://authjs.dev/getting-started/deployment#auth_secret)

## Rehearsal edge protection

The intended Caddy shape is:

```caddyfile
v2.uwplan.com {
    basic_auth {
        tester <hashed-password>
    }

    reverse_proxy localhost:5000 {
        header_up -Authorization
    }
}
```

Requirements:

- Protect every path, including `/api/auth/*` and both OAuth callback paths. Caddy orders `basic_auth` before `reverse_proxy`, returning `401 Unauthorized` when credentials are absent or invalid. Caddy accepts only a password hash in its configuration. [Caddy `basic_auth`](https://caddyserver.com/docs/caddyfile/directives/basic_auth), [Caddy directive order](https://caddyserver.com/docs/caddyfile/directives#directive-order)
- Serve the site only through HTTPS. HTTP Basic credentials are merely Base64-encoded and are not safe without TLS. [RFC 7617 security considerations](https://www.rfc-editor.org/rfc/rfc7617.html#section-4)
- Authenticate at `/` before starting OAuth. The Basic authentication scope then covers callback paths, and browsers may reuse the Authorization header within that protection space. Because the standard says “MAY,” callback completion must be tested in every supported tester browser rather than assumed. [RFC 7617 credential reuse](https://www.rfc-editor.org/rfc/rfc7617.html#section-2.2)
- Strip `Authorization` before proxying. Caddy otherwise passes incoming headers upstream by default; Auth.js does not need the rehearsal Basic credential. [Caddy upstream-header controls](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)
- Keep the plaintext shared password out of Git, Compose files, container environment, command history, and logs. Store only its Caddy hash on the host, with the plaintext distributed out of band to named testers. Rotate it after the rehearsal or immediately if its recipient list changes.

## OAuth provider-console prerequisites

Create these before the one-day rehearsal soak:

| Environment | Google | GitHub |
| --- | --- | --- |
| Rehearsal | A dedicated Web OAuth client, preferably in the existing uwplan Google Cloud project, with authorized redirect URI `https://v2.uwplan.com/api/auth/callback/google` | A dedicated OAuth App with homepage `https://v2.uwplan.com` and callback `https://v2.uwplan.com/api/auth/callback/github` |
| Production | Keep the current production client and callback `https://uwplan.com/api/auth/callback/google` | Keep the current production OAuth App and callback `https://uwplan.com/api/auth/callback/github` |

Google requires the requested redirect URI to exactly match an authorized redirect URI and permits multiple redirect URIs. GitHub OAuth Apps expose one configured callback URL. Although GitHub has limited redirect-URI matching flexibility, a separate rehearsal app is the clear secret and lifecycle boundary and follows Auth.js guidance to separate OAuth apps when environments use different databases. [Google redirect-URI rule](https://developers.google.com/identity/protocols/oauth2/web-server#httprest), [GitHub OAuth App creation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [GitHub redirect rules](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#redirect-urls), [Auth.js environment guidance](https://authjs.dev/getting-started/deployment#serverless)

The app's callback endpoints and environment variable names already match those values: it mounts Auth.js at `/api/auth/[...nextauth]` and relies on inferred `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_GITHUB_ID`, and `AUTH_GITHUB_SECRET`. [route](https://github.com/pl3lee/uwplan/blob/72e012271da892c0e03bf8cba43fb25d73cdec47/src/app/%28app%29/api/auth/%5B...nextauth%5D/route.ts), [providers](https://github.com/pl3lee/uwplan/blob/72e012271da892c0e03bf8cba43fb25d73cdec47/src/server/auth/config.ts#L44-L56), [environment schema](https://github.com/pl3lee/uwplan/blob/72e012271da892c0e03bf8cba43fb25d73cdec47/src/env.js#L7-L44), [Auth.js callback formats](https://authjs.dev/getting-started/deployment#serverless)

Use a second Google client rather than merely adding `v2` to the production client. Google identifies a user with the stable `sub` claim, so the copied account mapping should remain usable; nevertheless, the test plan must detect account-linking or duplication problems before cutover. [Google OpenID Connect claims](https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo)

## Secret and data boundaries

| Item | Rehearsal | Production after cutover |
| --- | --- | --- |
| Database | Disposable clone; no network path or credentials capable of writing to RackNerd production | Final, write-stopped migration restored on DigitalOcean |
| `AUTH_SECRET` | Newly generated rehearsal-only value | Exact existing production value |
| Google credentials | Dedicated `v2` client | Existing production client |
| GitHub credentials | Dedicated `v2` OAuth App | Existing production OAuth App |
| Basic Auth | Enabled; shared only with named testers | Absent |
| Host route | `v2.uwplan.com` only | `uwplan.com` only; `v2` must not proxy to the production app |

Do not promote the rehearsal environment file. Construct the production secret file from the existing production secret source, verify variable names and non-empty values without printing values, enforce owner-only permissions, and switch it atomically during the maintenance window. Database dumps contain users, OAuth account tokens, and active session tokens and must follow the map's permission-restricted retention policy.

## Required failure and acceptance tests

### Rehearsal gate

1. From a clean browser/profile, confirm `/`, an app route, `/api/auth/session`, and each callback path return `401` without Basic credentials and never reach the app. Confirm invalid credentials behave the same way.
2. Confirm valid Basic credentials reach the app over HTTPS and that the upstream request does not contain the Basic `Authorization` header.
3. In each supported tester browser, start from the authenticated root and complete Google sign-in and GitHub sign-in. Confirm the provider authorization request carries the exact `v2` callback URI and that the provider redirect returns through Basic Auth without losing its query string or OAuth state.
4. Confirm the resulting session cookie is host-only for `v2.uwplan.com`, `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`; confirm it is not sent to `uwplan.com`.
5. For an account already present in the copied database, confirm sign-in attaches to the existing `user`/`account` records and does not create duplicates. Exercise a brand-new tester only if creating rehearsal-only data is intentional.
6. From inside the rehearsal container, verify the configured database identity/host is the DigitalOcean clone without printing credentials. After sign-in, confirm the new rehearsal session token exists in the clone and is absent from RackNerd production using a parameterized/read-only lookup that does not print the token. (Whole-table production counts may legitimately change while production remains live and are not an isolation proof.)
7. Inspect generated redirects and logs for wrong-host URLs, `UntrustedHost`, `redirect_uri_mismatch`, `OAuthAccountNotLinked`, state/PKCE failures, leaked Basic credentials, or printed OAuth/Auth.js secrets; any occurrence fails the gate.

### Cutover gate

1. Before starting the production app, confirm `v2.uwplan.com` no longer proxies to it, Basic Auth is not applied to `uwplan.com`, rehearsal credentials are absent, `AUTH_TRUST_HOST=true`, and `AUTH_URL` is unset.
2. Verify the final restore includes equal counts for `user`, `account`, and unexpired `session` rows and that their identifiers/tokens match the source, using hashes or database-side comparisons that do not print token values.
3. Use a browser that was signed into `uwplan.com` before maintenance. After cutover, open an authenticated workflow directly and confirm it succeeds without a new sign-in. A redirect to sign-in fails the session-preservation gate.
4. In fresh browser profiles, complete one Google and one GitHub sign-in through the production callbacks. Confirm both return to `uwplan.com`, create usable database sessions, and do not create duplicate users/accounts.
5. Sign out one test session and confirm only that database session is deleted and the browser cookie is cleared; confirm another pre-cutover session remains valid.
6. Treat an OAuth transaction begun before maintenance as expendable: if it resumes with a state/PKCE error, retry from `uwplan.com`. Existing completed login sessions, by contrast, must survive.

## Operational consequence

The cutover runbook must model the authentication switch as an indivisible configuration step: disable the `v2` route, install production secrets, attach the final database, start the app, and expose it as `uwplan.com`. Leaving `v2` attached after the switch would expose production data to rehearsal testers and generate `v2` callback URLs with production OAuth credentials; either outcome is a failed cutover.
