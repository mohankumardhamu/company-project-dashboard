import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { accounts, teams, users } from '../db/schema';

/**
 * Who should hear about this — not who is *allowed* to see it. This is a
 * different question from server/src/scope.ts's read/write authority checks
 * (those take a user and ask what they can access; this takes a resource and
 * asks who in the org cares about it), so it deliberately doesn't live there.
 */

const activeEmail = (u: { email: string; active: boolean } | null | undefined): string | null =>
  u && u.active ? u.email : null;

function dedupe(emails: Array<string | null>): string[] {
  return [...new Set(emails.filter((e): e is string => Boolean(e)))];
}

/**
 * A team's report goes to its PM and to the Director who owns the team's
 * project's account. If the account has no owning Director (or the team
 * isn't attached to a project's account at all), we fall back to the
 * project's own director — every project has one — rather than silently
 * dropping Director visibility. An unattached team has neither, so it just
 * goes to the PM.
 */
export async function recipientsForTeam(teamId: string): Promise<string[]> {
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    with: {
      pm: { columns: { email: true, active: true } },
      project: {
        with: {
          director: { columns: { email: true, active: true } },
          account: { with: { ownerDirector: { columns: { email: true, active: true } } } },
        },
      },
    },
  });
  if (!team) return [];

  const directorEmail = activeEmail(team.project?.account?.ownerDirector) ?? activeEmail(team.project?.director);
  return dedupe([activeEmail(team.pm), directorEmail]);
}

/** An account's report goes to its owning Director and to every active VP. */
export async function recipientsForAccount(accountId: string): Promise<string[]> {
  const [account, vps] = await Promise.all([
    db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
      with: { ownerDirector: { columns: { email: true, active: true } } },
    }),
    db.query.users.findMany({
      where: and(eq(users.role, 'VP'), eq(users.active, true)),
      columns: { email: true },
    }),
  ]);
  if (!account) return [];

  return dedupe([activeEmail(account.ownerDirector), ...vps.map((v) => v.email)]);
}
