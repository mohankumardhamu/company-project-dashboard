# Project Dashboard

Role-based project, team and daily-status tracking. React frontend, Node/Express API, PostgreSQL via Drizzle ORM.

Engineers log what they did each day against their tasks. PMs build teams and assign that work. Directors own projects and attach teams to them. VPs read everything. PMs, Directors and VPs export the week as an Excel workbook.

---

## Running it

**Prerequisites:** Node 20+, and either Docker (for the database) or a PostgreSQL 14+ you already have.

```bash
# 1. Database
docker compose up -d db

# 2. API
cd server
cp .env.example .env          # edit JWT_SECRET before any real use
npm install
npm run db:migrate            # creates the schema
npm run seed                  # demo org: 2 projects, 4 teams, 15 people, 3 weeks of logs
npm run dev                   # http://localhost:4000

# 3. Frontend (second terminal)
cd web
npm install
npm run dev                   # http://localhost:5173
```

Open http://localhost:5173. Every seeded account uses the password `Passw0rd!`.

| Role     | Email                        | What they see                       |
| -------- | ---------------------------- | ----------------------------------- |
| VP       | `vp@acme.com`                | The whole organisation              |
| Director | `director.eng@acme.com`      | Owns the APEX project               |
| Director | `director.platform@acme.com` | Owns the HELIOS project             |
| PM       | `pm.payments@acme.com`       | Leads Payments Core, Data Enablement |
| PM       | `pm.mobile@acme.com`         | Leads Mobile Checkout               |
| PM       | `pm.infra@acme.com`          | Leads Platform SRE                  |
| Engineer | `eng.anita@acme.com`         | Own tasks and daily log             |

The login screen lists four of these as one-click buttons.

### Without Docker

Point `DATABASE_URL` in `server/.env` at any Postgres instance and run the same `db:migrate` / `seed` commands.

---

## What each role can do

Enforced server-side in `server/src/scope.ts` and the `requireRole` guards on each route — the UI only hides what the API already refuses.

| Action                          | VP  | Director        | PM              | Engineer      |
| ------------------------------- | --- | --------------- | --------------- | ------------- |
| Create a project                | —   | ✓               | —               | —             |
| Edit a project                  | —   | ✓ own only      | —               | —             |
| Attach / detach a team          | —   | ✓ own project   | —               | —             |
| Create a team                   | —   | —               | ✓               | —             |
| Add / remove team members       | —   | —               | ✓ own team      | —             |
| Create / edit / delete tasks    | —   | —               | ✓ own team      | —             |
| Change a task's status          | —   | —               | ✓ own team      | ✓ own task    |
| Log daily work                  | —   | —               | —               | ✓ own tasks   |
| Export the weekly report        | ✓   | ✓               | ✓ own teams     | —             |
| Onboard users                   | ✓ any role | ✓ PM, Engineer | —          | —             |
| Deactivate an account           | ✓   | —               | —               | —             |
| **Read scope**                  | everything | every project and team | own teams + their projects | own teams only |

Two deliberate choices worth knowing:

- **VPs are read-only.** The brief gives the VP oversight, not delivery duties, so they cannot create projects or teams. They can onboard users, since somebody has to.
- **Directors read every project but write only their own.** Multiple directors coexist without stepping on each other, while a VP-level view stays available to them.

### The intended flow

```
PM creates a team  →  PM adds engineers  →  Director attaches the team to a project
                                              ↓
PM creates tasks and assigns them  →  Engineer logs daily status against a task
                                              ↓
                      PM exports the week as .xlsx  →  sends it to the Director
                      (the Director can also export it themself)
```

---

## The weekly report

`Reports` in the sidebar. Pick a scope (everything you can see, a project, or a team) and any day in the week you want; the week always runs Monday to Sunday. The screen previews exactly what the workbook contains, then **Export .xlsx** downloads it.

The workbook has three sheets:

1. **Summary** — headline totals, then one row per person per team: hours, entries, days logged, tasks touched, open and done. Anyone who logged nothing that week is highlighted, because that absence is usually the point of the report.
2. **Daily Log** — every entry in the week: date, project, team, member, task, hours, status, what they did, and any blocker. Blocked rows are highlighted.
3. **Tasks** — the task board snapshot with hours this week and hours all time.

All three sheets have frozen headers and autofilters.

The same export sits on each project and team page as **Export weekly report**, pre-scoped to what you are looking at.

---

## Layout

```
server/
  src/
    index.ts            Express app, health check, graceful shutdown
    env.ts              validated environment
    auth.ts             JWT signing, bcrypt, authenticate + requireRole
    scope.ts            every read/write visibility rule, in one place
    http.ts             error types and the Postgres-error → HTTP translation
    dates.ts            date-only helpers, ISO weeks
    db/
      schema.ts         Drizzle tables, enums and relations
      seed.ts           demo organisation
      migrate.ts        applies ./drizzle
    routes/             auth, users, projects, teams, tasks, worklogs, reports, overview
    reports/
      weekly.ts         builds the report data (scope-checked)
      workbook.ts       renders it to .xlsx with ExcelJS
  drizzle/              generated SQL migrations
  scripts/smoke.mjs     68 API + permission checks against a running server
web/
  src/
    lib/                api client, auth context, useApi hook, formatting, types
    components/         Shell (nav), ui.tsx (badges, cards, modal, stats)
    pages/              Login, Dashboard, Projects, ProjectDetail, Teams,
                        TeamDetail, MyWork, Reports, People
  scripts/uicheck.mjs   54 browser checks driving all four roles
```

### Data model

```
User ──creates──> Project ──has many──> Team ──has many──> TeamMember ──> User
                  (Director)            (PM leads)
                                          │
                                          └──> Task ──assigned to──> User (team member)
                                                 │
                                                 └──> WorkLog (one per user per task per day)
```

A team is created standalone by a PM and only later attached to a project by a Director, which is why `Team.projectId` is nullable — an unattached team is a normal state, not an error.

`WorkLog` has a unique key on `(taskId, userId, date)`. Re-submitting the same day updates that entry rather than creating a duplicate, so an engineer can correct a log without it double-counting in the report.

---

## Tests

Both suites run against a live server and a seeded database.

```bash
cd server && npm run seed        # reset to a known state
node scripts/smoke.mjs           # 68 API and permission checks
cd ../web && node scripts/uicheck.mjs   # 54 browser checks (needs both servers up)
```

`smoke.mjs` covers authentication, every role boundary (including cross-tenant attempts such as one Director editing another's project, or a PM staffing someone else's team), the validation guards, the report scoping, and the xlsx bytes. `uicheck.mjs` drives Chromium through all four roles: navigation visibility, the create-project / create-team / add-member / create-task / log-work chain, the report preview, and a real file download.

---

## Notes for production

Before this handles real data:

- **Set `JWT_SECRET`** to a long random value. The server refuses to boot in production with the development default.
- **Tokens live in `localStorage`** (8-hour expiry) and are sent as bearer tokens. That is fine for an internal tool; if you need defence against XSS token theft, move to an httpOnly refresh cookie.
- **There is no password reset or email flow.** A VP or Director sets a temporary password when onboarding someone, and a VP can change it. Wire in your identity provider if you have one — given a Spring/UAA background, putting this behind OIDC and mapping the four roles from token claims would replace `auth.ts` cleanly.
- **No rate limiting on `/api/auth/login`.** Add `express-rate-limit` before exposing it.
- `npm run build` in both directories produces the deployable output (`server/dist`, `web/dist`). Serve `web/dist` from any static host and point it at the API.
