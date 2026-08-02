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
