# API conventions and endpoint audit

Audited from `origin/main` at `9adf995a0f9b23e6e02070ba9a151181521c5acd`.
The source of truth is the Huma registrations in `api/internal/api/`, published
in `api/openapi/openapi.json` and consumed by the generated web client.

## Decisions

Resource URLs use nouns. Collections are plural; `/me`, `/session`, `/plan`,
and the plan's `/term-range` are singletons scoped to the authenticated user.
`/admin/users` is a collection within an administration namespace; authorization
still runs in the API. Operation IDs are descriptive client function names and
may contain verbs (`renameTemplate`, `setCourseSelection`).

GET reads a representation, POST creates a resource, PUT sets a complete
state value, PATCH changes the documented subset of fields, and DELETE removes
a resource or relationship. This follows [HTTP method semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3)
and the distinction between [replacement and partial modification](https://www.rfc-editor.org/rfc/rfc5789.html#section-2).
Noun spelling and collection pluralization are UWPlan conventions, not HTTP
protocol requirements. This is a resource-oriented JSON API; it does not claim
full hypermedia-driven REST conformance.

Successful reads return 200. Creating a template or schedule returns 201 with
its JSON representation and a `Location` header naming the created resource.
Mutations with no returned representation use 204 and an empty body. Validation
uses 422 for malformed contract input and 400 for domain-invalid input; absent
sessions use 401, forbidden origins/roles 403, inaccessible owned resources 404,
and conflicts such as deleting the final schedule 409. Unexpected errors remain
generic 500 responses. Authentication, ownership, and origin checks apply before
any business mutation.

## Complete application API inventory

Paths below are prefixed with `/api/v1`. The 24 operations include the behavior
previously implemented as server actions.

| Resource | Methods | Contract / former action |
| --- | --- | --- |
| `/me` | GET | Current authenticated profile |
| `/session` | DELETE | Revoke the current session and clear its cookie; repeatable after expiry |
| `/admin/users` | GET | Admin-only user listing |
| `/courses` | GET | Course catalog |
| `/plan` | GET | Template memberships, fixed/free choices, distinct selected courses |
| `/plan/templates/{template_id}` | PUT | Replace membership state with `{selected}`; false detaches and cleans up unsupported assignments |
| `/plan/items/{item_id}/selection` | PUT | Replace the item's `{selected}` state; repeated requests do not toggle it |
| `/plan/items/{item_id}/course` | PUT | Replace the free slot's `{course_id}` value; explicit null clears it |
| `/plan/courses/{course_id}` | DELETE | Remove all matching selection sources and assignments |
| `/plan/term-range` | GET, PUT | Read or replace all four season/year bounds |
| `/schedules` | GET, POST | List or create owned schedules |
| `/schedules/{schedule_id}` | GET, PATCH, DELETE | Read the schedule view, rename it, or delete it while retaining one schedule |
| `/schedules/{schedule_id}/courses/{course_id}` | PUT, DELETE | Set a selected course's term or remove its placement; both operate on the schedule relationship, not the catalog course |
| `/schedules/{schedule_id}/csv` | GET | CSV representation with download headers and schedule ownership checks |
| `/templates` | GET, POST | List (`scope=all|mine`) or create an owned template; copying reads a definition and posts a new draft |
| `/templates/{template_id}` | GET, PATCH, DELETE | Read, rename, or delete with owner/admin enforcement |

Membership, selection, and free-slot PUT bodies are complete state values;
false/null are meaningful values rather than commands to toggle existing state.
Course assignment PUT supplies the whole placement value (`term`) and is
idempotent. Plan/schedule reads expose the resulting relationship states.
Template PATCH requires `name` and optionally changes `description`: omission
preserves the stored description, null clears it, and a string replaces it.
The update is one SQL statement, so preserving an omitted value does not require
a read followed by a potentially stale write. IDs, item order, ownership, and
all other template fields remain unchanged.

## Protocol and web routes

The four additional registered API operations are GET `/api/live`, GET
`/api/ready`, GET `/api/auth/signin/{provider}`, and GET
`/api/auth/callback/{provider}`. Health probes and OAuth browser redirects are
protocol endpoints with established external URLs, not planning resource CRUD.
OAuth retains its state-cookie validation, provisioning, and 302 redirects.
`/api/docs`, `/api/openapi.json`, `/api/openapi.yaml`, and the corresponding
`/api/openapi-3.0.json` and `.yaml` variants are Huma's read-only
contract/documentation surfaces.

React Router serves `/`, `/privacy`, `/signin`, `/select`, `/schedule`,
`/create/template`, `/manage/template`, and `/admin`. These are HTML navigation
URLs. The only remaining exported route `action` is `routes/api.proxy.ts`, which
forwards the incoming API method, path, body, and origin; it contains no business
actions. SSR loaders call the generated Go API client. No Next.js server-action
transport remains in the current application.

## Changes and compatibility

Removed the old logout action URL, export action URL, and top-level term-range
URLs as requested; there are no aliases. The web client, tests, and paired-release
rehearsal use the new routes. An already-open browser running an old JavaScript
bundle must reload to use renamed operations. Release API and web together;
rollback uses the retained matching pair. OAuth callback URLs, HTML page URLs,
account identities, and stored planning data are unchanged.

The audit also found that template PATCH treated omitted descriptions as null,
which erased saved text on name-only requests. The integration regression first
failed on that loss, then passed with omission/null/value handling. Creation
responses previously omitted `Location`; both now identify the created resource.
No schema migration, backfill, or cleanup is part of this change.

Verification covers API authorization and ownership, generated contracts,
whole-response integration assertions for preserved template data, creation
headers, and the shared production-build browser flows for logout, selections,
scheduling, term ranges, downloads, and template management.
