# Web application

- Keep business rules, data ownership, and authorization in the Go API. Load
  route data through the generated client; keep private server configuration and
  cookie forwarding in `.server.ts` modules.
- Generate API types and TanStack Query hooks with `pnpm generate:web` from the
  repository root. Change the Huma contract and regenerate instead of editing
  `app/generated/`. Commit generated changes with their contract changes.
- Browser API calls use same-origin `/api/` URLs. Preserve the browser's Origin
  and Fetch Metadata when proxying mutations; the API validates them. Keep
  session and OAuth cookies HttpOnly and out of loader data and browser storage.
- Use React Router framework routes, TanStack Query for server state, TanStack
  Form/Table where needed, and Base UI primitives styled with Tailwind. Keep
  query clients scoped to each server render and browser application.
- Preserve the visual design and user-visible assertions in the shared `e2e/`
  suite. Run that suite on the production build before release; compilation
  alone does not establish behavior coverage.
- Run `pnpm check:web`, `pnpm test:web`, and `pnpm build:web` for web changes.
  Run generation and verify a clean diff when changing API contracts or Orval.
