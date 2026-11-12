# Project Dashboard

Role-based project, team and daily-status tracking. React frontend (`web/`), Node/Express API
(`server/`), PostgreSQL via Drizzle ORM. See `README.md` for the full role-permission matrix and
setup instructions — this file is oriented at working in the code.

## What the app does

Five roles: **Admin**, **VP**, **Director**, **PM**, **Engineer**. The delivery flow the data
model exists to support:

1. A **PM** creates a **Team** (becoming its lead) and staffs it with Engineers (`teamMembers`).
2. A **Director** attaches that team to a **Project** they own (`teams.projectId`). A team can
   exist unattached — that's a normal state, not an error, since a PM may build a team before a
   Director has claimed it.
3. The PM creates **Tasks** on their team and assigns each to a team member.
4. **Engineers** log daily status (a **WorkLog**) against tasks assigned to them.
5. The PM or Director exports a bi-weekly period as an `.xlsx` workbook (`GET /api/reports/biweekly.xlsx`).
   Admin and VP can also export, scoped to whatever they can read.

Admin is the bootstrap superuser (unrestricted, onboards anyone including other Admins). VP is
read-only across the whole org but can onboard any non-Admin role. Directors read every
project/team but write only ones they own. PMs and Engineers are scoped to their own teams.

Data model: `User —creates→ Project —has many→ Team —has many→ TeamMember → User`, and
`Team —has many→ Task —assigned to→ User`, `Task —has many→ WorkLog`.

## Layout

```
server/src/
  index.ts            Express app wiring: middleware, route mounts, health check, graceful shutdown
  env.ts               validated environment (throws if required vars are missing)
  auth.ts              JWT sign/verify, bcrypt hashing, authenticate + requireRole middleware
  scope.ts             ALL read/write visibility rules — see below
  http.ts              HttpError + status helpers, ah() async wrapper, errorHandler (incl. zod
                        and Postgres unique/FK violation translation)
  dates.ts             date-only ('YYYY-MM-DD') helpers, bi-weekly period math (BIWEEK_ANCHOR)
  db/
    schema.ts           Drizzle tables, enums, relations — the source of truth for the data model
    seed.ts              deterministic demo org (2 projects, 4 teams, ~16 users, 5 weeks of logs, 4 periods of Rally data,
                          a Keka directory)
    migrate.ts           applies ./drizzle SQL migrations
    index.ts             db/pool singletons
    id.ts                createId() — short sortable id generator used as every PK default
  routes/              auth, users, projects, teams, tasks, worklogs, reports, overview,
                        imports, productivity (+ /api/periods) — one
                        router per resource, each does authenticate + zod parse + scope.ts checks
  reports/
    biweekly.ts          builds the scoped report data model (buildPeriodReport)
    workbook.ts           renders a PeriodReport to an .xlsx Buffer with ExcelJS
    productivity.ts      per-person Rally metrics, data-availability status, import history
  imports/
    tabular.ts           .xlsx/.csv → header-keyed rows (loose header matching)
    people.ts            matches a free-text name/email to a login
    rally.ts / keka.ts   plan (preview, no writes) + commit (upsert) per source
drizzle/               generated SQL migrations (via db:generate)
scripts/smoke.mjs      API + permission test suite, runs against a live server
web/src/
  main.tsx / App.tsx    entry point and route table (route-level role guards)
  lib/
    api.ts               fetch wrapper (auth header, error unwrapping, file download helper)
    auth.tsx             AuthProvider/useAuth — session restore via /auth/me, login/logout
    types.ts              TS types mirroring the API response shapes
    useApi.ts             data-fetching hook used by pages
    format.ts             display formatting helpers
    periods.ts            usePeriods() — the server's bi-weekly calendar (/api/periods)
  components/            Shell (nav/layout), ui.tsx (badges, cards, modal, stat tiles),
                          charts.tsx (single-series HTML bar charts with hover tooltips)
  pages/                  Login, Dashboard, Projects, ProjectDetail, Teams, TeamDetail, MyWork,
                          Reports, People, Imports, Productivity, … — one per route
scripts/uicheck.mjs     Playwright browser test suite, drives all four main roles
```

## The scope.ts rule

**All read and write visibility logic lives in `server/src/scope.ts`.** Routes must call it, not
reimplement the checks inline. It exports:

- `teamScope(user)` / `projectScope(user)` — SQL `WHERE` fragments (or `undefined` for no
  restriction) for filtering list queries.
- `visibleTeamIds(user)` — resolved list of team ids the user may read.
- `canReadTeam(user, teamId)` / `canReadProject(user, projectId)` — single-record read checks.
- `canManageTeam(user, teamId)` — true for Admin, or the PM who leads that team.
- `canManageProject(user, projectId)` — true for Admin, or the Director who owns that project.
- `visibleUserIds(user)` / `userScope(user)` — whose per-person data (Rally productivity) the user
  may read: Admin/VP/Director everyone, PM self + members of teams they lead, Engineer self.
- `importableUserIds(user)` — whose Rally rows the user may import: Admin anyone, Director people on
  their projects' teams, PM their teams' members, Engineer self, VP nobody (read-only).
- `canImportOrgDirectory(user)` — Keka directory import: Admin or VP.

Visibility rule of thumb baked into these functions: Admin/VP see everything; Director sees every
project and every team (including unattached ones, so they can attach them); PM sees teams they
lead or belong to plus those teams' projects; Engineer sees only teams they belong to. When adding
a new route or endpoint that touches projects/teams, use these functions rather than writing new
`eq(...)`/ownership checks — that's how every existing route stays consistent.

## Commands

**server/**
- `npm run db:generate` — generate a Drizzle migration from schema.ts changes
- `npm run db:migrate` — apply migrations in `./drizzle`
- `npm run seed` — wipe and reseed the demo org (idempotent, deterministic PRNG)
- `npm run dev` — run the API with `tsx watch` (http://localhost:4000)
- `npm run typecheck` — `tsc --noEmit`

**web/**
- `npm run dev` — Vite dev server (http://localhost:5173, proxies `/api` to the backend)
- `npm run build` — `tsc -b && vite build`
- `npm run typecheck` — `tsc -b --noEmit`

## Tests

Both suites run against **a live server and a freshly seeded database**, and both must stay green.

```bash
cd server && npm run seed              # reset to known state
node scripts/smoke.mjs                 # 144 API + permission checks
cd ../web && node scripts/uicheck.mjs  # 92 browser checks (needs API + web dev servers up)
```

`smoke.mjs` hits the API directly: auth, every role boundary (including cross-tenant attempts —
one Director editing another's project, a PM staffing someone else's team), validation guards,
report scoping, and the actual xlsx bytes. `uicheck.mjs` drives Chromium through all four main
roles: nav visibility per role, the create-project / create-team / add-member / create-task /
log-work chain end to end, the report preview, and a real file download. Reseed before each run —
both suites assert on specific seeded counts (e.g. "VP sees both projects").

## Conventions

- **Schema**: all tables, enums, and relations are defined in `server/src/db/schema.ts` (Drizzle).
  Change the schema there, then `npm run db:generate` to produce a migration, then `db:migrate`.
- **Validation**: zod schemas are defined and `.parse()`d at the route edge (top of each
  `routes/*.ts` handler), not deeper in the call stack. `ZodError` is caught centrally by
  `errorHandler` in `http.ts` and turned into a 400 with per-field messages.
- **Dates**: `date` columns round-trip as plain `'YYYY-MM-DD'` strings with no timezone. Always go
  through `server/src/dates.ts` (`toDateOnly`, `today`, `startOfPeriod`/`endOfPeriod`,
  `recentPeriods`, `addDays`, `humanDate`) rather than constructing `Date` objects or formatting ad
  hoc. **The reporting period is bi-weekly**, not weekly: fortnights (Monday → second Sunday)
  counted from `env.biweekAnchor` (`BIWEEK_ANCHOR`, default `2026-01-05`). Overview, reports,
  portfolio trend, digest, imports and productivity all use it; the web gets it from
  `/api/periods` rather than computing boundaries itself.
- **Imports**: Rally/Keka uploads are raw file bytes (`application/octet-stream`, file name in
  the query) to `POST /api/imports/{rally,keka}`. Without `commit=true` it is a preview that
  writes nothing; every skipped row carries a reason. `rally_items` is unique on
  `(userId, periodStart, workProduct)` and `keka_employees` on `employeeNumber`, both upserted —
  re-uploading the same sheet must update, never double-count. Story points = Estimate on
  `Completed`/`Accepted` rows; effort = Time Spent.
- **WorkLog uniqueness**: `work_logs` has a unique index on `(taskId, userId, date)`
  (`work_logs_task_user_date_key`). The create endpoint (`POST /api/worklogs`) uses
  `onConflictDoUpdate` on that key, so re-submitting the same person/task/day updates the existing
  entry instead of creating a duplicate — this is intentional (an engineer correcting a log should
  not double-count in reports), not a bug to "fix" with a new insert.
- Postgres unique-violation errors (`23505`) are translated to friendly 409s in `http.ts`'s
  `errorHandler` via a constraint-name → message map; add new constraints there if you add new
  unique indexes that can be hit from user input.
