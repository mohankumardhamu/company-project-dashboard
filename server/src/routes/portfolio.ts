import { and, asc, count, eq, gte, inArray, lt, lte, max, ne, sql, sum } from 'drizzle-orm';
import { Router } from 'express';
import { authenticate, currentUser, requireRole } from '../auth';
import { addDays, endOfPeriod, PERIOD_DAYS, startOfPeriod, today } from '../dates';
import { db } from '../db';
import { accounts, outcomes, projects, tasks, teamMembers, teams, workLogs } from '../db/schema';
import { ah } from '../http';
import { accountScope } from '../scope';

export const portfolioRouter = Router();
portfolioRouter.use(authenticate);

/**
 * Ranking (attention score, highest first — never alphabetical, never by size
 * or hours):
 *
 * Concrete, individually-verifiable risk is weighted well above soft
 * period-over-period trend dips, because a stuck item is something a Director
 * can act on today, while a one-period dip in outcomes or completions might
 * just be noise. Within risk, a team gone completely silent (4) and an
 * account with nothing landed in 30+ days (5) outweigh a single blocked (3)
 * or overdue (2) task, because silence and staleness are account-level
 * signals that something has gone quiet, not just one item slipping.
 * Hours never factor into the score at all — this view ranks by delivered
 * outcomes and risk, not by who logged the most time.
 */
const WEIGHT = {
  blockedTask: 3,
  overdueTask: 2,
  silentTeam: 4,
  staleOutcomes: 5,
  outcomeDecline: 1, // per outcome fewer than last period
  taskDoneDecline: 0.5, // per task fewer than last period
};

const STALE_OUTCOME_DAYS = 30;
const BLOCKED_DAYS = 5;

interface RiskItem {
  type: 'blocked' | 'overdue' | 'silentTeam' | 'staleOutcomes';
  label: string;
  teamId?: string;
  teamName?: string;
  count?: number;
}

/** VP/Director/Admin only — a Director's or VP's own read reach already
 * covers every account, so accountScope(me) here is the same unrestricted
 * WHERE those roles get everywhere else; the requireRole below is what
 * actually keeps a PM out. */
portfolioRouter.get(
  '/',
  requireRole('ADMIN', 'VP', 'DIRECTOR'),
  ah(async (req, res) => {
    const me = currentUser(req);

    const anchor = today();
    const thisFrom = startOfPeriod(anchor);
    const thisTo = endOfPeriod(anchor);
    const lastFrom = addDays(thisFrom, -PERIOD_DAYS);
    const lastTo = addDays(thisTo, -PERIOD_DAYS);
    const thisFromTs = new Date(`${thisFrom}T00:00:00.000Z`);
    const windowStartTs = new Date(`${lastFrom}T00:00:00.000Z`);
    const windowEndTs = new Date(`${thisTo}T23:59:59.999Z`);
    const blockedCutoffTs = new Date(`${addDays(anchor, -BLOCKED_DAYS)}T00:00:00.000Z`);

    const period = { from: thisFrom, to: thisTo };
    const previousPeriod = { from: lastFrom, to: lastTo };

    // Topology first, in one relational fetch — not one query per account.
    const accountRows = await db.query.accounts.findMany({
      where: accountScope(me),
      orderBy: [asc(accounts.name)],
      with: {
        ownerDirector: { columns: { id: true, name: true, email: true } },
        projects: {
          columns: { id: true },
          with: { teams: { columns: { id: true, name: true } } },
        },
      },
    });
    const accountIds = accountRows.map((a) => a.id);
    if (accountIds.length === 0) {
      return res.json({ period, previousPeriod, accounts: [] });
    }

    const teamsByAccount = new Map(accountRows.map((a) => [a.id, a.projects.flatMap((p) => p.teams)]));
    const teamIds = [...teamsByAccount.values()].flat().map((t) => t.id);

    // "This period vs last period" is two plain range-filtered GROUP BYs per
    // metric, not one CASE-bucketed query — Postgres's GROUP BY validity check
    // is syntactic on the compiled query text, so a SELECT-list CASE expression
    // repeated in GROUP BY (even from the same JS object) gets a fresh set of
    // parameter placeholders and no longer matches. Two queries per metric
    // sidesteps that entirely and is just as bounded.
    const outcomesInRange = (from: string, to: string) =>
      db
        .select({ accountId: projects.accountId, n: count() })
        .from(outcomes)
        .innerJoin(teams, eq(teams.id, outcomes.teamId))
        .innerJoin(projects, eq(projects.id, teams.projectId))
        .where(and(inArray(projects.accountId, accountIds), gte(outcomes.landedOn, from), lte(outcomes.landedOn, to)))
        .groupBy(projects.accountId);

    const doneInRange = (from: Date, to: Date) =>
      db
        .select({ accountId: projects.accountId, n: count() })
        .from(tasks)
        .innerJoin(teams, eq(teams.id, tasks.teamId))
        .innerJoin(projects, eq(projects.id, teams.projectId))
        .where(
          and(inArray(projects.accountId, accountIds), eq(tasks.status, 'DONE'), gte(tasks.updatedAt, from), lte(tasks.updatedAt, to))
        )
        .groupBy(projects.accountId);

    const hoursInRange = (from: string, to: string) =>
      db
        .select({ accountId: projects.accountId, hours: sum(workLogs.hours) })
        .from(workLogs)
        .innerJoin(tasks, eq(tasks.id, workLogs.taskId))
        .innerJoin(teams, eq(teams.id, tasks.teamId))
        .innerJoin(projects, eq(projects.id, teams.projectId))
        .where(and(inArray(projects.accountId, accountIds), gte(workLogs.date, from), lte(workLogs.date, to)))
        .groupBy(projects.accountId);

    const lastPeriodEndTs = new Date(`${lastTo}T23:59:59.999Z`);

    const [
      memberCountRows,
      teamMemberCountRows,
      outcomeThisRows,
      outcomeLastRows,
      outcomeMaxRows,
      doneThisRows,
      doneLastRows,
      hoursThisRows,
      hoursLastRows,
      blockedRows,
      overdueRows,
      activeTeamRows,
    ] = await Promise.all([
      // People: distinct across every team on every project under the account.
      db
        .select({ accountId: projects.accountId, n: count(sql`DISTINCT ${teamMembers.userId}`) })
        .from(projects)
        .innerJoin(teams, eq(teams.projectId, projects.id))
        .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
        .where(inArray(projects.accountId, accountIds))
        .groupBy(projects.accountId),
      teamIds.length
        ? db
            .select({ teamId: teamMembers.teamId, n: count() })
            .from(teamMembers)
            .where(inArray(teamMembers.teamId, teamIds))
            .groupBy(teamMembers.teamId)
        : Promise.resolve([]),
      outcomesInRange(thisFrom, thisTo),
      outcomesInRange(lastFrom, lastTo),
      // Most recent outcome ever, regardless of period, for the staleness check.
      db
        .select({ accountId: projects.accountId, lastLandedOn: max(outcomes.landedOn) })
        .from(outcomes)
        .innerJoin(teams, eq(teams.id, outcomes.teamId))
        .innerJoin(projects, eq(projects.id, teams.projectId))
        .where(inArray(projects.accountId, accountIds))
        .groupBy(projects.accountId),
      // Tasks done, this period vs last. updatedAt is the closest signal we have
      // to "completed on this date" — there is no dedicated completedAt column.
      doneInRange(thisFromTs, windowEndTs),
      doneInRange(windowStartTs, lastPeriodEndTs),
      // Hours logged, this period vs last — a supporting number, never used in the score.
      hoursInRange(thisFrom, thisTo),
      hoursInRange(lastFrom, lastTo),
      // Risk, computed per team: tasks stuck in BLOCKED for 5+ days...
      teamIds.length
        ? db
            .select({ teamId: tasks.teamId, n: count() })
            .from(tasks)
            .where(and(inArray(tasks.teamId, teamIds), eq(tasks.status, 'BLOCKED'), lte(tasks.updatedAt, blockedCutoffTs)))
            .groupBy(tasks.teamId)
        : Promise.resolve([]),
      // ...tasks past their due date and still open...
      teamIds.length
        ? db
            .select({ teamId: tasks.teamId, n: count() })
            .from(tasks)
            .where(and(inArray(tasks.teamId, teamIds), ne(tasks.status, 'DONE'), lt(tasks.dueDate, anchor)))
            .groupBy(tasks.teamId)
        : Promise.resolve([]),
      // ...and which staffed teams logged anything at all this period.
      teamIds.length
        ? db
            .select({ teamId: tasks.teamId })
            .from(workLogs)
            .innerJoin(tasks, eq(tasks.id, workLogs.taskId))
            .where(and(inArray(tasks.teamId, teamIds), gte(workLogs.date, thisFrom), lte(workLogs.date, thisTo)))
            .groupBy(tasks.teamId)
        : Promise.resolve([]),
    ]);

    const memberCountByAccount = new Map(memberCountRows.map((r) => [r.accountId, Number(r.n)]));
    const teamMemberCount = new Map(teamMemberCountRows.map((r) => [r.teamId, Number(r.n)]));
    const blockedByTeam = new Map(blockedRows.map((r) => [r.teamId, Number(r.n)]));
    const overdueByTeam = new Map(overdueRows.map((r) => [r.teamId, Number(r.n)]));
    const activeTeamsThisPeriod = new Set(activeTeamRows.map((r) => r.teamId));
    const lastOutcomeByAccount = new Map(outcomeMaxRows.map((r) => [r.accountId, r.lastLandedOn]));

    const toTrendMap = <T extends { accountId: string | null }>(
      thisRows: T[],
      lastRows: T[],
      pick: (r: T) => number
    ) => {
      const m = new Map<string, { thisPeriod: number; lastPeriod: number }>();
      for (const r of thisRows) if (r.accountId) m.set(r.accountId, { thisPeriod: pick(r), lastPeriod: 0 });
      for (const r of lastRows) {
        if (!r.accountId) continue;
        const cur = m.get(r.accountId) ?? { thisPeriod: 0, lastPeriod: 0 };
        cur.lastPeriod = pick(r);
        m.set(r.accountId, cur);
      }
      return m;
    };
    const outcomeTrend = toTrendMap(outcomeThisRows, outcomeLastRows, (r) => Number(r.n));
    const doneTrend = toTrendMap(doneThisRows, doneLastRows, (r) => Number(r.n));
    const hoursTrend = toTrendMap(hoursThisRows, hoursLastRows, (r) => Number(r.hours ?? 0));

    const zeroTrend = { thisPeriod: 0, lastPeriod: 0 };

    const rows = accountRows.map((a) => {
      const accountTeams = teamsByAccount.get(a.id) ?? [];
      const outcome = outcomeTrend.get(a.id) ?? zeroTrend;
      const done = doneTrend.get(a.id) ?? zeroTrend;
      const hrs = hoursTrend.get(a.id) ?? zeroTrend;

      const riskItems: RiskItem[] = [];
      let score = 0;

      for (const t of accountTeams) {
        const blocked = blockedByTeam.get(t.id) ?? 0;
        if (blocked > 0) {
          riskItems.push({
            type: 'blocked',
            teamId: t.id,
            teamName: t.name,
            count: blocked,
            label: `${blocked} task${blocked === 1 ? '' : 's'} blocked ${BLOCKED_DAYS}+ days`,
          });
          score += blocked * WEIGHT.blockedTask;
        }

        const overdue = overdueByTeam.get(t.id) ?? 0;
        if (overdue > 0) {
          riskItems.push({
            type: 'overdue',
            teamId: t.id,
            teamName: t.name,
            count: overdue,
            label: `${overdue} task${overdue === 1 ? '' : 's'} overdue`,
          });
          score += overdue * WEIGHT.overdueTask;
        }

        const hasMembers = (teamMemberCount.get(t.id) ?? 0) > 0;
        if (hasMembers && !activeTeamsThisPeriod.has(t.id)) {
          riskItems.push({ type: 'silentTeam', teamId: t.id, teamName: t.name, label: 'No entries logged this period' });
          score += WEIGHT.silentTeam;
        }
      }

      // Only flag staleness for accounts actually staffed to deliver — an
      // account with no teams yet has nothing to file an outcome against.
      if (accountTeams.length > 0) {
        const lastOutcome = lastOutcomeByAccount.get(a.id) ?? null;
        const daysSince = lastOutcome
          ? Math.round((Date.parse(`${anchor}T00:00:00Z`) - Date.parse(`${lastOutcome}T00:00:00Z`)) / 86_400_000)
          : null;
        if (daysSince === null || daysSince > STALE_OUTCOME_DAYS) {
          riskItems.push({
            type: 'staleOutcomes',
            label: daysSince === null ? 'No outcome ever filed' : `No outcome in ${daysSince} days`,
          });
          score += WEIGHT.staleOutcomes;
        }
      }

      score += Math.max(0, outcome.lastPeriod - outcome.thisPeriod) * WEIGHT.outcomeDecline;
      score += Math.max(0, done.lastPeriod - done.thisPeriod) * WEIGHT.taskDoneDecline;

      return {
        id: a.id,
        name: a.name,
        code: a.code,
        status: a.status,
        ownerDirector: a.ownerDirector,
        projectCount: a.projects.length,
        teamCount: accountTeams.length,
        memberCount: memberCountByAccount.get(a.id) ?? 0,
        trend: {
          outcomes: { thisPeriod: outcome.thisPeriod, lastPeriod: outcome.lastPeriod, delta: outcome.thisPeriod - outcome.lastPeriod },
          tasksDone: { thisPeriod: done.thisPeriod, lastPeriod: done.lastPeriod, delta: done.thisPeriod - done.lastPeriod },
          hours: {
            thisPeriod: Number(hrs.thisPeriod.toFixed(2)),
            lastPeriod: Number(hrs.lastPeriod.toFixed(2)),
            delta: Number((hrs.thisPeriod - hrs.lastPeriod).toFixed(2)),
          },
        },
        risk: { score: Number(score.toFixed(1)), items: riskItems },
      };
    });

    rows.sort((x, y) => y.risk.score - x.risk.score || x.name.localeCompare(y.name));

    res.json({ period, previousPeriod, accounts: rows });
  })
);
