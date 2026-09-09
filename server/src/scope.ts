import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import type { AuthUser } from './auth';
import { db } from './db';
import { accounts, outcomes, projects, teamMembers, teams } from './db/schema';
import type { OutcomeCategory } from './db/schema';

/**
 * Visibility rules (read access), in one place so every route agrees:
 *
 *   ADMIN     -> everything, org-wide. Same reach as a VP, plus write access
 *                (see canManageTeam / canManageProject / canManageAccount below).
 *   VP        -> everything, org-wide.
 *   DIRECTOR  -> every account, every project, plus every team (including
 *                teams not yet attached to a project, so they can attach them).
 *   PM        -> teams they lead or belong to, the projects those teams are
 *                attached to, and the accounts those projects belong to.
 *   ENGINEER  -> teams they belong to, the projects those teams are attached
 *                to, and the accounts those projects belong to.
 *
 * Outcomes have no scope function of their own: they hang off a single
 * teamId, so `teamScope` / `canReadTeam` / `canManageTeam` already answer
 * every read and file-on-behalf-of-a-team question. Only verification
 * authority (canVerifyOutcome, below) is new.
 */

const memberTeamIds = (userId: string) =>
  db.select({ id: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, userId));

/** A WHERE fragment for the `teams` table, or undefined for "no restriction". */
export function teamScope(user: AuthUser): SQL | undefined {
  switch (user.role) {
    case 'ADMIN':
    case 'VP':
    case 'DIRECTOR':
      return undefined;
    case 'PM':
      return or(eq(teams.pmId, user.id), inArray(teams.id, memberTeamIds(user.id)));
    case 'ENGINEER':
    default:
      return inArray(teams.id, memberTeamIds(user.id));
  }
}

/** A WHERE fragment for the `projects` table, or undefined for "no restriction". */
export function projectScope(user: AuthUser): SQL | undefined {
  if (user.role === 'ADMIN' || user.role === 'VP' || user.role === 'DIRECTOR') return undefined;
  const visibleProjectIds = db
    .select({ id: teams.projectId })
    .from(teams)
    .where(teamScope(user));
  return inArray(projects.id, visibleProjectIds as never);
}

/** Team ids the user is allowed to read. Used wherever a scoped `IN (…)` is simpler. */
export async function visibleTeamIds(user: AuthUser): Promise<string[]> {
  const rows = await db.select({ id: teams.id }).from(teams).where(teamScope(user));
  return rows.map((r) => r.id);
}

export async function canReadTeam(user: AuthUser, teamId: string): Promise<boolean> {
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), teamScope(user)))
    .limit(1);
  return rows.length > 0;
}

export async function canReadProject(user: AuthUser, projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), projectScope(user)))
    .limit(1);
  return rows.length > 0;
}

/** Write access to a team: the PM who leads it, or an Admin (unrestricted). */
export async function canManageTeam(user: AuthUser, teamId: string): Promise<boolean> {
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'PM') return false;
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.pmId, user.id)))
    .limit(1);
  return rows.length > 0;
}

/** Write access to a project: the Director who owns it, or an Admin (unrestricted). */
export async function canManageProject(user: AuthUser, projectId: string): Promise<boolean> {
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'DIRECTOR') return false;
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.directorId, user.id)))
    .limit(1);
  return rows.length > 0;
}

/** A WHERE fragment for the `accounts` table, or undefined for "no restriction". */
export function accountScope(user: AuthUser): SQL | undefined {
  if (user.role === 'ADMIN' || user.role === 'VP' || user.role === 'DIRECTOR') return undefined;
  const visibleAccountIdsQuery = db
    .select({ id: projects.accountId })
    .from(projects)
    .where(projectScope(user));
  return inArray(accounts.id, visibleAccountIdsQuery as never);
}

/** Account ids the user is allowed to read. Used wherever a scoped `IN (…)` is simpler. */
export async function visibleAccountIds(user: AuthUser): Promise<string[]> {
  const rows = await db.select({ id: accounts.id }).from(accounts).where(accountScope(user));
  return rows.map((r) => r.id);
}

export async function canReadAccount(user: AuthUser, accountId: string): Promise<boolean> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), accountScope(user)))
    .limit(1);
  return rows.length > 0;
}

/** Write access to an account: the Director who owns it, or an Admin (unrestricted). */
export async function canManageAccount(user: AuthUser, accountId: string): Promise<boolean> {
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'DIRECTOR') return false;
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.ownerDirectorId, user.id)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Whether `user` may mark an outcome verified: the Director who owns the
 * project the outcome's team is attached to, or an Admin (unrestricted). An
 * outcome on a team not yet attached to a project has no owning Director, so
 * only an Admin can verify it.
 */
export async function canVerifyOutcome(user: AuthUser, outcomeId: string): Promise<boolean> {
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'DIRECTOR') return false;
  const rows = await db
    .select({ projectId: teams.projectId })
    .from(outcomes)
    .innerJoin(teams, eq(teams.id, outcomes.teamId))
    .where(eq(outcomes.id, outcomeId))
    .limit(1);
  const projectId = rows[0]?.projectId;
  if (!projectId) return false;
  return canManageProject(user, projectId);
}

/* ------------------------------- register --------------------------------
 * The register (server/src/routes/register.ts) is the one place in this app
 * where a search result can legitimately belong to a team the viewer cannot
 * read — that's the whole point of it: work done for one account becomes
 * discoverable by another. The redaction rule below is what makes that safe,
 * and it lives here, not in the route and not in the React page, so there is
 * exactly one place that decides what a viewer who can't read the team is
 * still allowed to see.
 */

/** The full-fidelity shape a register row is fetched in, before redaction. */
export interface RegisterResultRow {
  kind: 'outcome' | 'task';
  id: string;
  title: string;
  category: OutcomeCategory | null;
  date: string;
  narrative: string | null;
  personName: string | null;
  verified: boolean | null;
  teamId: string;
  teamName: string;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  accountId: string | null;
  accountName: string | null;
  accountCode: string | null;
  rank: number;
}

/** What a caller actually receives — narrower than RegisterResultRow whenever redacted. */
export interface RegisterResult {
  kind: 'outcome' | 'task';
  id: string;
  title: string;
  category: OutcomeCategory | null;
  date: string;
  accountId: string | null;
  accountName: string | null;
  accountCode: string | null;
  teamId: string | null;
  teamName: string;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  redacted: boolean;
  rank: number;
  narrative?: string | null;
  personName?: string | null;
  verified?: boolean | null;
}

/**
 * The redaction rule: a viewer who cannot read the underlying team still
 * learns that the work exists — title, category, account, team name, date —
 * enough to know who to ask, but never the narrative/description, who did
 * it, or a working link into the team or project. `teamId`/`projectId` are
 * omitted outright (not just left for the UI to ignore) so a result can
 * never be turned into a link the viewer isn't allowed to follow — the page
 * only ever renders a Link when an id is actually present. Account
 * visibility is checked independently of team visibility, since a viewer can
 * sometimes read an account without being able to read every team under it.
 */
export function shapeRegisterResult(
  row: RegisterResultRow,
  access: { canReadTeam: boolean; canReadAccount: boolean }
): RegisterResult {
  const base = {
    kind: row.kind,
    id: row.id,
    title: row.title,
    category: row.category,
    date: row.date,
    accountName: row.accountName,
    accountCode: row.accountCode,
    accountId: access.canReadAccount ? row.accountId : null,
    teamName: row.teamName,
    rank: row.rank,
  };

  if (!access.canReadTeam) {
    return { ...base, teamId: null, projectId: null, projectName: null, projectCode: null, redacted: true };
  }

  return {
    ...base,
    teamId: row.teamId,
    projectId: row.projectId,
    projectName: row.projectName,
    projectCode: row.projectCode,
    redacted: false,
    narrative: row.narrative,
    personName: row.personName,
    verified: row.verified,
  };
}
