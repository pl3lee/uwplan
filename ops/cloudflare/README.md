# Reversible Cloudflare boundary

This module keeps `uwplan.com` and `www.uwplan.com` proxied while an operator
selects either origin. It does not contain credentials, deploy a Worker, edit
DNS, or alter TLS by itself.

## Maintenance Worker

`worker.mjs` returns a non-cacheable `503` with `Retry-After: 300` for every
public path, including Auth.js/OAuth paths. `/api/ready` is the sole public
origin exception and its response is reduced to status and immutable release
identity. Origin errors and missing/exhausted Worker or Durable Object bindings
return maintenance rather than bypassing the boundary.

The bootstrap is submitted once with `POST /__uwplan/operator/bootstrap` and a
Bearer token of at least 256 bits. Only its SHA-256 digest is configured. A
Durable Object transaction consumes each `BOOTSTRAP_GENERATION` once and stores
only a session digest. The resulting `__Host-uwplan-operator` cookie has a
30-minute lifetime and is Secure, HttpOnly, SameSite=Lax, Path=/, and has no
Domain attribute. The Worker removes both that cookie and Authorization before
proxying. `POST /__uwplan/operator/revoke` requires the separately hashed
control token; changing the generation and both token digests rotates access
and invalidates every older session.

Start from `wrangler.example.toml`. Deploy to a disposable zone first. Keep the
tokens in no-echo tooling or mode-`0600` files; never put them in Wrangler vars,
arguments, logs, evidence, GitHub, or Plane. The bootstrap/control plaintexts
must not be reused.

## DNS and TLS controls

`control.mjs` captures exactly one proxied A/AAAA/CNAME record for apex and
`www`, including IDs, types, current values, proxy state, TTL, comments, tags,
and settings. A switch preflights every record before any write, sends PATCH
requests containing only `content`, verifies every invariant afterwards, and
then requires live readiness. Reapplying the same target performs no writes.
The captured snapshot is the reverse target; do not reconstruct records by
hand.

The same preflight requires Cloudflare SSL mode `strict` and probes the direct
DigitalOcean origin with SNI for both names. The active certificate must be a
Cloudflare Origin CA certificate covering both names and negotiate TLS 1.2 or
1.3. Keep the separate public `v2.uwplan.com` certificate/configuration outside
this module.

Use an expiring API token scoped to the disposable/production zone and only the
DNS edit plus zone/TLS read permissions needed by the run. The verifier rejects
tokens that are not active now or expire more than two hours later. Cloudflare
does not expose a token's complete policy through the verify call, so the
operator must capture the zone-only policy in the run evidence when minting it.
Revoke the token after the forward/reverse exercise or production window.

## Mandatory non-production exercise

Copy `non-production.config.example.json` outside the repository, replace every
placeholder, and set it and every referenced token file to mode `0600`. The
configured zone must not be `uwplan.com` or any subdomain of it. Record current
Workers usage and the applicable account limit immediately before the run; the
verifier reserves capacity and fails before mutation if the limit is unsafe.

```sh
node ops/cloudflare/verify-non-production.mjs \
  /run/secrets/uwplan-cloudflare-non-production.json
```

The verifier checks the expiring token, exact records, Full (strict), direct
Origin CA TLS, DigitalOcean switch/readiness, restoration to the captured
origin/readiness, public maintenance, OAuth maintenance, readiness pass-through,
one-time bootstrap, cookie attributes, bypass, and revocation. It always
attempts restoration after the forward switch. Success writes only sanitized
mode-`0600` evidence. Production use is blocked until this exercise succeeds
and its evidence is attached to the migration run.
