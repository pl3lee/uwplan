# Pre-write cutover fence

`pre-write.mjs` is the fail-closed coordinator for the last reversible part of
the RackNerd-to-DigitalOcean migration. It deliberately exposes operational
boundaries instead of embedding host credentials or a general-purpose shell.
The production runner must bind those boundaries to the already restricted
deployment, Cloudflare, and database commands.

The coordinator freezes both production deployment paths before enabling
maintenance. It verifies maintenance from exactly two distinct networks, stops
only `racknerd-production-app` while disabling Coolify recreation, and samples
`pg_stat_activity` three times over at least 60 seconds. The source WAL position,
write counter, app restart counter, and UTC fence time are HMAC-SHA256 signed.
The protected signing key must contain at least 32 bytes and must never be
written into evidence.

The final archive must be created after the fence. A fresh candidate is admitted
only after the existing exact integrity gates and explicit read-only/write-denial
gate pass. Source state is checked before and after restore and after candidate
validation. Any source app restart, application session, write-counter change,
or WAL advance invalidates the fence and archive.

Any failed operation, immediate operator stop, or elapsed 45-minute deadline
routes through unchanged-source recovery: restore DNS if it moved, restart the
same RackNerd app/database pairing, validate it privately, remove maintenance,
and thaw both deployment paths. Recovery checks the authoritative epoch first
and refuses to run after the DigitalOcean write epoch. It never performs a
reverse migration and never restarts the RackNerd database.

`tests/pre-write-cutover.test.ts` binds only fakes and a virtual clock. It proves
the successful path, two-network maintenance, the 60-second activity window,
scope isolation, signed evidence, post-fence restore, source invalidation,
deadline/operator aborts, DNS recovery, and the post-write recovery prohibition
without touching production hosts or DNS.

# Post-write reverse migration

`post-write.mjs` coordinates the distinct, irreversible-after-write recovery
path. It accepts the DigitalOcean epoch only when `pl3lee` signed it after the
complete integrity, read-only, and origin-readiness gate set. A recovery then
freezes both deployment paths, enables maintenance, stops only DigitalOcean app
writers, and requires three zero-session observations spanning one minute.

The coordinator captures current DigitalOcean data and admits only a fresh
RackNerd database whose archive hash, integrity, write denial, and application
binding all match. The preserved RackNerd app must report that it is attached to
that candidate alone. The pre-cutover `racknerd-production` database is passed
only as a forbidden identity and is never exposed through a start or promotion
operation.

Cloudflare remains in maintenance during the origin switch and six readiness
samples spanning five minutes. The new RackNerd epoch requires another explicit
signed `pl3lee` action issued after all reverse read-only receipts. Private auth
and write validation cannot run before that epoch. After public reopening,
thirteen samples span one clean hour before either deployment path can thaw; the
old DigitalOcean path thaws last.

If DigitalOcean is unreadable, no recovery operation begins. The result reports
the latest verified backup timestamp, hash, and calculated RPO and requires
explicit human acceptance. Tests use fake boundaries, disposable identities,
and a virtual clock: they never contact hosts, databases, Cloudflare, DNS, or
production data.
