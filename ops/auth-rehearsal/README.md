# Isolated OAuth rehearsal

This runbook exercises Google and GitHub authentication against a disposable,
freshly restored candidate database. It never reuses the production app
environment: the database URL, Auth.js secret, both provider applications, and
Basic Auth credential are rehearsal-only.

The repository intentionally cannot create provider applications or claim a
physical-device result. A named tester must complete those provider-console
and browser steps. `verify.mjs` fails closed until that evidence and the exact
database invariants exist.

## 1. Prepare protected configuration

Use a new accepted `uwplan_candidate_<UTC run id>` produced by the database
restore workflow. The candidate name must exactly match the integrity run ID,
and neither `candidate-app` nor `rehearsal-app` may be running. Never run the
scrub against `uwplan` or another serving database.

On the DigitalOcean target host, remove only the restored authentication
artifacts before preparing any browser or provider credentials:

```sh
sudo node /opt/uwplan/current/ops/database/host-command.mjs \
  scrub-candidate-auth \
  20260802T210000000Z \
  uwplan_candidate_20260802T210000000Z
```

The host action requires the matching root-owned mode-`0600`
`integrity-accepted.json`, locks and truncates `public.session`,
`public.verification_token`, and
`public.account` in one transaction, then opens a separate database connection
to prove all three global counts are zero. It also proves the global `user`,
`plan`, and `schedule` counts and content digests did not change. Lock
acquisition is capped at five seconds and the scrub statement at 30 seconds, so
contention fails closed instead of blocking indefinitely. A SQL failure rolls
back and publishes no acceptance marker. Output and evidence contain counts and
hashes, never credentials, tokens, emails, or row data.

Success creates a mode-`0600` `auth-artifact-scrub-accepted.json` bound to the
run ID, exact candidate, source archive SHA-256, integrity-marker SHA-256, and
scrub procedure version. The action is single-use: discard the candidate after
any failed or interrupted attempt rather than repairing or re-scrubbing it.

Install these files outside the repository:

- `/etc/uwplan/rehearsal-app.env`, based on `rehearsal-app.env.example`;
- `/etc/uwplan/rehearsal-caddy.env`, based on `caddy.env.example`; and
- `/etc/uwplan/auth-rehearsal-verify.env`, based on `verify.env.example`.

Every file is root-owned and mode `0600`. `AUTH_URL` must not appear in the app
file; `AUTH_TRUST_HOST=true` is required. The five production SHA-256 values in
the verifier file are fingerprints only. Generate them from the production
secret store without copying plaintext production credentials to the
rehearsal host. The verifier rejects any matching rehearsal credential.

Create dedicated provider applications with only these values and scopes:

| Provider | Homepage/origin         | Callback                                         | Required scopes        |
| -------- | ----------------------- | ------------------------------------------------ | ---------------------- |
| Google   | `https://v2.uwplan.com` | `https://v2.uwplan.com/api/auth/callback/google` | `openid email profile` |
| GitHub   | `https://v2.uwplan.com` | `https://v2.uwplan.com/api/auth/callback/github` | `read:user user:email` |

Do not grant additional scopes. Add only the named rehearsal identities. The
GitHub identity may be an existing account, but it must authorize only the
dedicated rehearsal OAuth app for this exercise. Do not copy production client
IDs, client secrets, Auth.js secrets, cookies, sessions, or provider grants,
and do not connect the rehearsal app to a production database.

Generate the Basic Auth hash without writing the plaintext password to the
application environment:

```sh
caddy hash-password
```

The plaintext is used only in the protected operator file; the hash is used
only by Caddy. The app must never receive either value.

Add the exact integrity, scrub, and guarded-start marker paths to the protected
verifier file. Missing, non-root-owned, world-readable, stale, mismatched, or
nonzero evidence is rejected.

## 2. Start the isolated app and Caddy site

The `rehearsal-app` profile binds only `127.0.0.1:5001` and reads the dedicated
app file. The normal `app` service and its environment are not involved.

Use the guarded start command. It validates the integrity and scrub files,
starts only the database and telemetry dependencies, then connects from an
ephemeral container on the Compose network as `uwplan_app`. It requires the
three authentication tables still to be globally empty and the preserved table
counts and content digests to still match before starting the app:

```sh
sudo env \
  UWPLAN_AUTH_REHEARSAL_ENV_FILE=/etc/uwplan/auth-rehearsal-verify.env \
  node /opt/uwplan/current/ops/auth-rehearsal/start.mjs
```

Do not start `rehearsal-app` directly with `docker compose`; that bypasses the
pre-start freshness check and is not accepted rehearsal procedure.

Success creates root-owned mode-`0600` `auth-rehearsal-started.json`. The marker
binds the accepted scrub, protected app/runtime/release files, Compose file, and
the exact running container, image, start timestamp, and zero restart count.
The final verifier rejects a missing marker, any changed input, or a container
that was started, restarted, or recreated outside the guarded command.

Run the host Caddy service with `ops/caddy/rehearsal.Caddyfile` and the protected
Caddy environment. That file leaves only `/api/ready` unauthenticated. Every
app, signin, OAuth callback, and proof path requires Basic Auth. Caddy validates
the Basic header and removes it before proxying, so Auth.js never sees the
Basic credential.

Before using a browser, confirm:

```sh
curl --fail https://v2.uwplan.com/api/ready
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  https://v2.uwplan.com/signin)" = 401
```

## 3. Complete the named browser matrix

Use exactly two sign-in identities configured in the protected verifier file:
one Google rehearsal identity and one GitHub identity. The GitHub identity may
be the tester's existing GitHub account; a separate GitHub account is not
required. The OAuth application and its credentials remain dedicated to the
rehearsal regardless of which GitHub identity signs in.

Before starting, verify that the selected GitHub email does not already belong
to a user in the disposable candidate when the intended acceptance path is a
successful GitHub sign-in. An email collision exercises Auth.js's fail-closed
`OAuthAccountNotLinked` path instead of the success path. That behavior is
secure and covered automatically, but it does not satisfy the manual GitHub
sign-in/write check; use an identity/candidate combination that can exercise
the intended path. Perform this check through a protected database session and
do not print the email or matching row into evidence.

1. Desktop Chrome: sign in with the Google identity, sign out, and sign in a
   second time. Create exactly one additional schedule whose name is
   `UWPLAN_GOOGLE_WRITE_MARKER`; sign out/in and confirm it persists.
2. Physical-iPhone Safari: repeat with the distinct GitHub identity and
   `UWPLAN_GITHUB_WRITE_MARKER`.
3. Copy `auth-browser-attestation.example.json` into the run's protected
   evidence directory, set the matching run ID/result, and install it mode
   `0600`. This is a named-tester attestation; it is not generated by CI.

The manual matrix stops at those two accounts. CI runs a synthetic same-email
Google/GitHub attempt through Auth.js core with the actual UWPlan provider
policy and proves `OAuthAccountNotLinked` occurs before any user, account,
plan, or schedule mutation.

Do not use a real student Google identity or inspect restored user rows in a
browser. If an existing GitHub account is used, revoke its grant to the
dedicated rehearsal OAuth app after evidence is accepted.

## 4. Verify and retain sanitized evidence

Run from the repository on the rehearsal host:

```sh
UWPLAN_AUTH_REHEARSAL_ENV_FILE=/etc/uwplan/auth-rehearsal-verify.env \
  node ops/auth-rehearsal/verify.mjs \
  > /var/lib/uwplan-migration/20260802T210000000Z/auth-rehearsal-accepted.json
chmod 0600 /var/lib/uwplan-migration/20260802T210000000Z/auth-rehearsal-accepted.json
```

The verifier first revalidates the protected scrub marker against the current
integrity-marker bytes, then validates the guarded-start marker against the
current protected configuration and live container/image IDs. It rejects
missing, stale, mismatched, or nonzero preflight evidence. It then checks
unauthenticated and wrong-password `401`
responses, readiness exemption, protected signin, callback coverage, Basic-header
stripping, dedicated credential fingerprints, the candidate database identity,
both two-signin idempotency invariants, both planning-write markers, and the
two browser attestations. The versioned automated suite separately proves
safe cross-provider rejection. The verifier queries the candidate from inside
the guarded live container as `uwplan_app` and emits hashes/counts/statuses—never
emails, passwords, OAuth credentials, database URLs, cookies, or row values.

A failure is not repairable evidence. Keep the Plane ticket In Progress,
discard the rehearsal candidate and its browser sessions, create a fresh
candidate identity, and repeat. Stopping the rehearsal removes only its app:

```sh
docker compose --profile rehearsal rm --force --stop rehearsal-app
```
