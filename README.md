# Project Dashboard

Role-based project, team and daily-status tracking. React frontend, Node/Express API, PostgreSQL via Drizzle ORM.

Engineers log what they did each day against their tasks. PMs build teams, assign that work, and file outcomes — delivered results, not activity. Directors create accounts (clients) and projects and attach teams to them. VPs and Directors read a cross-account **Portfolio** ranked by risk. Anyone signed in can search the **Register** for work done anywhere in the org. A weekly digest sends itself every Monday; PMs, Directors and VPs can also export a workbook on demand. Admins onboard every account and hold unrestricted access to every resource.

---

## Running it

**Prerequisites:** Node 20+, and either Docker (for the database) or a PostgreSQL 14+ you already have.

```bash
# 1. Database
docker compose up -d db

# 2. API
cd server
cp .env.example .env          # edit JWT_SECRET before any real use; digest ships off by default
npm install
npm run db:migrate            # creates the schema
npm run seed                  # demo org: 2 accounts, 2 projects, 4 teams, 16 people, 8 outcomes, 3 weeks of logs
npm run dev                   # http://localhost:4000

# 3. Frontend (second terminal)
cd web
npm install
npm run dev                   # http://localhost:5173
```

Open http://localhost:5173. Every seeded account uses the password `Passw0rd!`.

| Role     | Email                        | What they see                                |
| -------- | ----------------------------- | --------------------------------------------- |
| Admin    | `admin@acme.com`             | Everything — full access, onboards anyone    |
| VP       | `vp@acme.com`                | The whole organisation, plus the Portfolio    |
| Director | `director.eng@acme.com`      | Owns the ACME account and the APEX project    |
| Director | `director.platform@acme.com` | Owns the GLOBEX account and the HELIOS project |
| PM       | `pm.payments@acme.com`       | Leads Payments Core, Data Enablement          |
| PM       | `pm.mobile@acme.com`         | Leads Mobile Checkout                          |
| PM       | `pm.infra@acme.com`          | Leads Platform SRE                             |
| Engineer | `eng.anita@acme.com`         | Own tasks and daily log, plus the Register    |

The login screen lists five of these as one-click buttons.

### Without Docker

Point `DATABASE_URL` in `server/.env` at any Postgres instance and run the same `db:migrate` / `seed` commands.

---

## What each role can do

Enforced server-side in `server/src/scope.ts` and the `requireRole` guards on each route — the UI only hides what the API already refuses.

| Action                                 | Admin | VP  | Director        | PM              | Engineer      |
| ---------------------------------------- | ----- | --- | ---------------- | ---------------- | -------------- |
| Create an account                       | ✓ any | —   | ✓ (becomes owner) | —              | —             |
| Create a project                        | ✓ any | —   | ✓               | —               | —             |
| Edit a project / account                | ✓ any | —   | ✓ own only      | —               | —             |
| Attach / detach a team                  | ✓ any | —   | ✓ own project   | —               | —             |
| Create a team                           | ✓ any | —   | —               | ✓               | —             |
| Add / remove team members               | ✓ any | —   | —               | ✓ own team      | —             |
| Create / edit / delete tasks            | ✓ any | —   | —               | ✓ own team      | —             |
| Change a task's status                  | ✓ any | —   | —               | ✓ own team      | ✓ own task    |
| Log daily work                          | —     | —   | —               | —               | ✓ own tasks   |
| File an outcome                         | ✓ any | —   | —               | ✓ own team      | —             |
| Verify an outcome                       | ✓ any | —   | ✓ own project's account | —      | —             |
| Export the weekly report                | ✓     | ✓   | ✓               | ✓ own teams     | —             |
| View the Portfolio (cross-account risk) | ✓     | ✓   | ✓               | —               | —             |
| Search the Register                     | ✓     | ✓   | ✓               | ✓               | ✓ (redacted outside own teams) |
| Onboard users                           | ✓ any role, incl. Admin | ✓ any role except Admin | ✓ PM, Engineer | — | — |
| Change a role / deactivate an account   | ✓   | ✓   | —               | —               | —             |
| **Read scope**                          | everything | everything | every account, project and team | own teams + their projects/accounts | own teams only (Register: redacted elsewhere) |

Four deliberate choices worth knowing:

- **Admins are the bootstrap superuser.** They exist to onboard the first VPs/Directors and to unblock anything ownership rules would otherwise lock behind a specific person — an Admin can manage any account, project or team regardless of who owns it. Only an Admin can create or promote another Admin.
- **VPs are read-only.** The brief gives the VP oversight, not delivery duties, so they cannot create accounts, projects or teams. They can onboard users (any role except Admin) and read the Portfolio, since oversight is the job.
- **Directors read every account and project but write only their own.** Multiple directors coexist without stepping on each other, while a VP-level view stays available to them.
- **Verification is a trust signal, not a gate.** A PM's outcome is real and counted the moment it's filed. A Director confirming it just stamps it — an unverified outcome is never hidden, just unconfirmed.

### The intended flow

```
Director creates an account (client)  →  PM creates a team  →  PM adds engineers
                                                                     ↓
                          Director attaches the team's project to the account
                                                                     ↓
        PM creates tasks and assigns them  →  Engineer logs daily status against a task
                                                                     ↓
                              PM files an outcome  →  Director verifies it
                                                                     ↓
   Every Monday the digest sends itself (or: PM/Director exports the .xlsx on demand)
                                                                     ↓
        VP/Director scan the Portfolio for what needs attention this week
                                                                     ↓
              Anyone searches the Register for work done anywhere in the org
```

---

## The weekly report

`Reports` in the sidebar. Pick a scope (everything you can see, an account, a project, or a team) and any day in the week you want; the week always runs Monday to Sunday. The screen previews exactly what the workbook contains, then **Export .xlsx** downloads it.

The workbook has four sheets:

1. **Summary** — headline totals (including outcomes delivered and outcomes still awaiting verification), then one row per person per team: hours, entries, days logged, tasks touched, open and done. Anyone who logged nothing that week is highlighted, because that absence is usually the point of the report.
2. **Daily Log** — every entry in the week: date, project, team, member, task, hours, status, what they did, and any blocker. Blocked rows are highlighted.
3. **Tasks** — the task board snapshot with hours this week and hours all time.
4. **Outcomes** — every outcome that landed in the week: date, project, team, title, category, PM, and whether it's verified. Unverified rows are highlighted — that's what a Director scanning the sheet should check first.

All four sheets have frozen headers and autofilters.

The same export sits on each account, project and team page as **Export weekly report**, pre-scoped to what you are looking at.

---

## The weekly digest

The report above also sends itself. Every Monday morning (configurable, off by default), `server/src/digest/job.ts` builds a weekly report for **every account and every team** and delivers it through a small adapter interface:

- **File adapter** (default) — writes the workbook into `server/outbox/`, plus a `.meta.json` sidecar recording who it would have gone to. Works with zero credentials configured.
- **SMTP adapter** — sends the workbook as an email attachment via `nodemailer`, configured entirely from env (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).

Recipients are derived from the data, never from a config list: a team's report goes to its PM and to the Director who owns its account (falling back to the project's own director if the account has no owner); an account's report goes to its owner and to every active VP. A scope with no recipients — or nothing to report on yet, like a brand-new account with no project attached — is skipped and logged, not sent empty or allowed to crash the run.

Scheduling is `node-cron` inside the API process — right-sized for one process with one schedule and nothing to coordinate. If the API ever runs more than one instance, every replica would fire independently and the digest would send multiple times; the fix at that point is a single external trigger (a platform cron hitting an internal endpoint, or a worker with leader election), not a queue — the job is still one fire-and-forget weekly batch, not a stream of work.

`DIGEST_ENABLED` defaults to `false` so nothing sends during development. The **This week** card on the Dashboard shows every signed-in role (except Engineers, who never receive a digest) exactly what their own digest would say, computed live — no need to wait for Monday or check email.

---

## Outcomes

A separate record from a task: a **delivered result**, not activity. A PM files one with a title, the date it landed, a short narrative, and a category — `Revenue enabled`, `Cost saved`, `Risk reduced`, `Capability built`, or `Customer-visible`. It can optionally cite the tasks it traces back to, but never has to. There is no status field and no due date — an outcome cannot be filed for a future date, because it already happened.

Outcomes show up on the team, project and account pages, in the weekly report, in the Portfolio's trend and risk columns, and in the Register.

---

## Portfolio

`/portfolio` — VP, Director and Admin only. One row per account, ranked by an attention score (highest first, explained in a comment in `server/src/routes/portfolio.ts`), not alphabetically and not by hours logged. Each row shows:

- **Trend** — outcomes filed, tasks completed, and hours logged, this week against last.
- **Risk**, as its own column: tasks blocked more than five days, teams with no log entries this week, overdue tasks, and accounts with no outcome in 30 days. Each risk item links through to the team or account it's about.

Concrete risk is weighted well above soft week-over-week dips — a stuck task is something a Director can act on today, a one-week dip in outcomes might just be noise. Hours never factor into the ranking at all.

---

## Register

`/register` — open to every signed-in role. A read-only, searchable record of outcomes and completed tasks across every account, so work done for one client becomes discoverable by another. Search is Postgres full-text search (`tsvector` + GIN index on both `outcomes` and `tasks`, kept in sync automatically as `GENERATED ALWAYS AS ... STORED` columns — never `ILIKE`), with filters for category, account and date range, sorted by relevance then recency.

The redaction rule is what makes cross-account discovery safe, and it lives in `server/src/scope.ts` (`shapeRegisterResult`), not in the route and not in the React page: if you can't read the underlying team, you still see the outcome's title, category, account and date — enough to know the work exists and who to ask — but never the narrative, who did it, or a working link into the team. `teamId`/`projectId` are omitted outright when redacted, not just hidden client-side, so a redacted result can never be turned into a link you aren't allowed to follow.

---

## Layout

```
server/
  src/
    index.ts            Express app, health check, graceful shutdown, starts the digest schedule
    env.ts               validated environment (JWT, digest schedule, SMTP)
    auth.ts               JWT signing, bcrypt, authenticate + requireRole
    scope.ts              every read/write visibility rule, in one place — including the
                          register's redaction rule
    http.ts                error types and the Postgres-error → HTTP translation
    dates.ts               date-only helpers, ISO weeks
    db/
      schema.ts            Drizzle tables, enums, relations, and the two generated
                           tsvector search columns
      seed.ts               demo organisation
      migrate.ts             applies ./drizzle
    routes/               auth, users, accounts, projects, teams, tasks, worklogs,
                          outcomes, reports, overview, portfolio, digest, register —
                          one router per resource
    reports/
      weekly.ts             builds the report data (scope-checked), now including outcomes
      workbook.ts            renders it to .xlsx with ExcelJS (four sheets)
    digest/
      job.ts                 the weekly run: builds every account's and team's report,
                             resolves recipients, delivers, logs every send and skip
      recipients.ts           who should hear about a team or account (data-derived,
                             not scope.ts — a different question from who may read it)
      adapter.ts / fileAdapter.ts / smtpAdapter.ts / factory.ts
                              the delivery interface and its two implementations
      schedule.ts             node-cron wiring, gated by DIGEST_ENABLED
  drizzle/               generated SQL migrations
  outbox/                file-adapter output (gitignored)
  scripts/
    smoke.mjs             108 API + permission checks against a running server
    digestSmoke.ts         19 checks invoking the digest job directly (tsx, not HTTP)
web/
  src/
    lib/                 api client, auth context, useApi hook, formatting, types
    components/          Shell (nav), ui.tsx (badges, cards, modal, stats)
    pages/                Login, Dashboard, Accounts, AccountDetail, Projects,
                          ProjectDetail, Teams, TeamDetail, MyWork, Reports, People,
                          Portfolio, Register
  scripts/uicheck.mjs    85 browser checks driving all five roles
```

### Data model

```
User ──creates──> Account ──has many──> Project ──has many──> Team ──has many──> TeamMember ──> User
      (Director)  (client)  (Director)                       (PM leads)
                                                                 │
                                                                 ├──> Task ──assigned to──> User (team member)
                                                                 │      │
                                                                 │      └──> WorkLog (one per user per task per day)
                                                                 │
                                                                 └──> Outcome ──filed by──> User (PM)
                                                                        │
                                                                        └──> OutcomeTask (optional citation)
```

A team is created standalone by a PM and only later attached to a project by a Director, which is why `Team.projectId` is nullable — an unattached team is a normal state, not an error. A project can likewise exist before a Director attaches it to a client account, so `Project.accountId` is nullable too.

`WorkLog` has a unique key on `(taskId, userId, date)`. Re-submitting the same day updates that entry rather than creating a duplicate, so an engineer can correct a log without it double-counting in the report.

`Outcome` has no status and no due date — it's dated once, on `landedOn`, and cannot be filed for a future date.

---

## Tests

All three suites run against a live server and a seeded database.

```bash
cd server
npm run seed                 # reset to a known state
node scripts/smoke.mjs       # 108 API and permission checks
npm run smoke:digest         # 19 checks invoking the digest job directly (reseed after — it mutates data)
cd ../web
node scripts/uicheck.mjs     # 85 browser checks (needs both servers up)
```

`smoke.mjs` covers authentication, every role boundary (including cross-tenant attempts such as one Director editing another's project, or a PM staffing someone else's team), the validation guards, outcome filing and verification, the account/project/team report scoping, the digest preview, the Portfolio's ranking and risk, the Register's full-text search and its redaction rule, and the xlsx bytes. `uicheck.mjs` drives Chromium through all five roles: navigation visibility, the create-account / create-project / create-team / add-member / create-task / log-work / file-outcome chain, the report preview, the Portfolio and Register pages (including that a redacted Register result has no working team link), and a real file download. `digestSmoke.ts` invokes `runWeeklyDigest` directly with the file adapter and asserts the expected workbooks and recipients land in `outbox/`, including that an account with recipients but no teams is skipped rather than crashing the run.

---

## Notes for production

Before this handles real data:

- **Set `JWT_SECRET`** to a long random value. The server refuses to boot in production with the development default.
- **Tokens live in `localStorage`** (8-hour expiry) and are sent as bearer tokens. That is fine for an internal tool; if you need defence against XSS token theft, move to an httpOnly refresh cookie.
- **There is no password reset or email flow.** An Admin, VP or Director sets a temporary password when onboarding someone, and an Admin or VP can change it. Wire in your identity provider if you have one — given a Spring/UAA background, putting this behind OIDC and mapping the five roles from token claims would replace `auth.ts` cleanly.
- **No rate limiting on `/api/auth/login`.** Add `express-rate-limit` before exposing it.
- **The weekly digest ships disabled.** Set `DIGEST_ENABLED=true` and `DIGEST_ADAPTER=smtp` (with the `SMTP_*` vars) to actually send email; leaving it on the file adapter is a safe way to see what it would send before turning email on.
- `npm run build` in both directories produces the deployable output (`server/dist`, `web/dist`). Serve `web/dist` from any static host and point it at the API.
