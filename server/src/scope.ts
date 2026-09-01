import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import type { AuthUser } from './auth';
import { db } from './db';
import { projects, teamMembers, teams } from './db/schema';

/**
 * Visibility rules (read access), in one place so every route agrees:
 *
 *   ADMIN     -> everything, org-wide. Same reach as a VP, plus write access
 *                (see canManageTeam / canManageProject below).
 *   VP        -> everything, org-wide.
 *   DIRECTOR  -> every project, plus every team (including teams not yet
 *                attached to a project, so they can attach them).
 *   PM        -> teams they lead or belong to, and the projects those teams
 *                are attached to.
 *   ENGINEER  -> teams they belong to, and the projects those teams are
 *                attached to.
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
