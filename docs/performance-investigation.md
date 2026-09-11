# Select navigation performance investigation

Investigated 2026-09-11 on `origin/main` at
`1d0b283ca5434b76142ea4a09dd1141ce6e72714`. Both production application images
report this revision. Production inspection was read-only.

## Finding

Select navigation unconditionally reloads and serializes the complete course
catalog, even when the browser already has it. The production web container is
under memory pressure, and the separate TanStack Query cache can trigger a second
catalog download after navigation. These are confirmed sources of unnecessary
work; memory reclamation and paging amplify the latency.

## Evidence

- Live Chrome round trip: Select to Schedule approximately 468 ms; Schedule to
  Select approximately 3,154 ms. These include browser automation overhead.
- The original Chrome request took 23.26 seconds: 23.07 seconds waiting for the
  response, 187.54 ms downloading. Network throttling was disabled.
- The corresponding web request logged 20,627 ms in Docker logs and Grafana,
  trace `fe270ff69f8724f426d5068e9fe1384d`. Its course API request took 7,692 ms;
  other API calls completed in approximately 2–51 ms, with substantial gaps
  between requests. Some concurrent abandoned web requests took 17–20 seconds.
- A subsequent Select request took 2,427 ms in the web service while its course
  API call took 225 ms; another took 3,715 ms with a 242 ms course API call.
  Traces: `c1e313cb127cfe8cdb24e01162daf157` and
  `179c599f815e6311db2e3a9b1e550488`.
- The catalog contains 10,742 courses. Description/prerequisite/corequisite/
  antirequisite strings alone total 3,595,334 bytes. Chrome reports approximately
  5.5 MB decoded for Select route data and 6.2 MB for the subsequent course API
  response (approximately 1.4 MB transferred each).
- Production web has a 128 MiB memory limit. During a fresh navigation sampling
  window (17:06:33–17:06:54 UTC), cgroup memory reached 127.9 MiB, memory-limit
  events increased from 17,132 to 17,310, major page faults increased from
  391,097 to 391,893, and swap usage was approximately 16–17 MiB. These counters
  cover all container activity in that window, including routine health checks.
  The host had approximately 728 MiB of swap in use across its workloads.
- No web or API container restarts were recorded. Memory pressure can stall
  requests without an OOM kill or failed health check.

## Code paths at the investigated revision

1. `web/app/routes/select.tsx:21`: every loader call reads all courses, waits for
   the catalog and plan, then fetches template definitions, and returns all
   courses in route data. There is no client loader that reuses cached courses.
   `api/internal/repository/db/queries/course.sql` selects every course column.
2. `web/app/routes/select.tsx:42`: query hooks receive loader results only as
   `initialData`. This initializes a missing query; it does not refresh an
   existing query or its freshness timestamp. The root query client uses a
   30-second stale time. Re-entering with an existing stale query therefore
   refetches courses and definitions despite just loading them on the server.
3. `ops/production/compose.rewrite.yaml:6`: both application services receive
   a 128 MiB limit. Actual navigation sampling demonstrates memory reclamation
   and paging in the web container under that limit.
4. `e2e/fixtures.ts:62`: shared browser fixtures seed six short course records;
   those behavior tests do not represent the production catalog size.

The installed TanStack Query version was exercised with a QueryClient containing
a catalog updated 31 seconds ago, a 30-second stale time, and a new QueryObserver
supplied fresh loader `initialData`. Assertions confirmed that the old cached
value remained and subscribing issued one additional API request. No React
application or production mutation was needed for this reproduction.

## Corrective direction and limits

- Give catalog loading one cache owner across navigation. Avoid repeatedly
  serializing the entire catalog through route data; preserve authenticated
  access and correct mutation invalidation.
- Return only the course fields/records needed initially; load additional
  course details when needed and preserve free-course lookup behavior.
- Reassess web memory sizing against measured peak usage and the host's total
  capacity. Verify navigation and concurrency using a production-sized catalog.

The duplicate-fetch mechanism is reproduced independently, and production memory
pressure is directly observed. No profiler or controlled memory-limit comparison
was run, so the exact split between serialization, garbage collection, paging,
and API/database work within the 23-second outlier is not established. A higher
memory limit alone is not a verified complete fix. No runtime or production
configuration changes were made during this investigation.

## Fix and regression coverage

Select now loads courses and template definitions only through the browser's
TanStack Query cache. Its authenticated parent layout still loads the user and
plan, and the Go API still authenticates every catalog/definition request. The
catalog is no longer parsed and serialized by the SSR route loader. An initial
visit shows a loading message; a failed catalog request offers a retry. Full
course details and free-course lookup remain available after that first fetch.

Catalog freshness is five minutes, with inactive entries retained for thirty
minutes. A stale catalog refreshes in the background while cached rows remain
usable. These are per-browser-application entries, not a shared server cache;
sign-out still clears the QueryClient. Template definition mutations retain
existing query invalidation. Course ID/code indexes are memoized once per
catalog update and shared across requirement tables.

`pnpm test:e2e e2e/performance.spec.ts --project=chromium` failed before the fix:
HTML was 2,562,105 bytes against a 100,000-byte ceiling with 10,742 synthetic
courses. After the fix, the full-suite run measured 12,260 bytes, with three
Schedule-to-Select round trips at 89, 67, and 64 ms on the local test machine.
These are local measurements, not production latency guarantees. Only one
catalog request occurred across those visits, including after the old 30-second
stale window. A second request occurred only after advancing past five minutes;
holding that response open did not prevent the saved selection from rendering.
A separate test exercises recovery from a failed initial catalog request.

Validation: generated client unchanged; web type/lint checks, 15 unit tests,
production build, 5 server/telemetry tests, 6 public browser tests, and all 35
full-stack browser cases passed. The latter covers Chromium, Firefox, WebKit,
and mobile behavior. Production resource limits and the API contract are
unchanged. A cold visit still downloads the full catalog once; reducing that
initial API payload is a possible subsequent optimization.
