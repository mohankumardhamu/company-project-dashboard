import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { recentPeriods, today, type DateString } from '../dates';
import { db } from '../db';
import { importBatches, kekaEmployees, rallyItems, teamMembers, users } from '../db/schema';
import { notFound } from '../http';
import { isDoneState } from '../imports/rally';
import { canReadTeam, visibleTeamIds, visibleUserIds } from '../scope';

/**
 * Individual productivity, built only from imported Rally data:
 *   story points      = sum of Estimate on Completed/Accepted work products
 *   stories completed = count of Completed/Accepted work products
 *   effort            = sum of Time Spent (hours)
 * per person, per bi-weekly period.
 */

export interface Person {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * The people a caller sees in productivity views: members of the teams they
 * can read (or of one team, when teamId is given), plus anyone with imported
 * Rally data — always narrowed by visibleUserIds, so a PM sees only their own
 * teams' members and an Engineer sees only themselves.
 */
export async function peopleInScope(me: AuthUser, teamId?: string): Promise<Person[]> {
  let ids: string[];
  if (teamId) {
    if (!(await canReadTeam(me, teamId))) throw notFound('Team not found');
    const rows = await db.select({ id: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
    ids = rows.map((r) => r.id);
  } else {
    const teamIds = await visibleTeamIds(me);
    const [members, withData] = await Promise.all([
      teamIds.length
        ? db.selectDistinct({ id: teamMembers.userId }).from(teamMembers).where(inArray(teamMembers.teamId, teamIds))
        : Promise.resolve([]),
      db.selectDistinct({ id: rallyItems.userId }).from(rallyItems),
    ]);
    ids = [...new Set([me.id, ...members.map((r) => r.id), ...withData.map((r) => r.id)])];
  }

  const visible = await visibleUserIds(me);
  if (visible) ids = ids.filter((id) => visible.includes(id));
  if (ids.length === 0) return [];
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(inArray(users.id, ids))
    .orderBy(asc(users.name));
}

interface Metrics {
  storyPoints: number;
  storiesCompleted: number;
  storiesTotal: number;
  pointsPlanned: number;
  timeSpent: number;
  todo: number;
}

const zero = (): Metrics => ({
  storyPoints: 0,
  storiesCompleted: 0,
  storiesTotal: 0,
  pointsPlanned: 0,
  timeSpent: 0,
  todo: 0,
});

const round = (n: number) => Number(n.toFixed(2));
const rounded = (m: Metrics): Metrics => ({
  ...m,
  storyPoints: round(m.storyPoints),
  pointsPlanned: round(m.pointsPlanned),
  timeSpent: round(m.timeSpent),
  todo: round(m.todo),
});

function add(m: Metrics, item: { state: string; estimate: number; timeSpent: number; todo: number }) {
  m.storiesTotal += 1;
  m.pointsPlanned += item.estimate;
  m.timeSpent += item.timeSpent;
  m.todo += item.todo;
  if (isDoneState(item.state)) {
    m.storiesCompleted += 1;
    m.storyPoints += item.estimate;
  }
}

export async function buildProductivity(
  me: AuthUser,
  params: { period?: DateString; teamId?: string; periods?: number }
) {
  const windows = recentPeriods(params.periods ?? 6, params.period ?? today()).reverse(); // oldest first
  const selected = windows[windows.length - 1];
  const people = await peopleInScope(me, params.teamId);
  const ids = people.map((p) => p.id);

  const [items, keka] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(rallyItems)
          .where(and(inArray(rallyItems.userId, ids), inArray(rallyItems.periodStart, windows.map((w) => w.from))))
          .orderBy(asc(rallyItems.workProduct)),
        db
          .select({
            userId: kekaEmployees.userId,
            employeeNumber: kekaEmployees.employeeNumber,
            jobTitle: kekaEmployees.jobTitle,
            department: kekaEmployees.department,
          })
          .from(kekaEmployees)
          .where(inArray(kekaEmployees.userId, ids)),
      ])
    : [[], []];

  const kekaBy = new Map(keka.map((k) => [k.userId!, k]));
  const perPersonPeriod = new Map<string, Metrics>(); // `${userId}|${periodStart}`
  const perPeriod = new Map<string, Metrics>(windows.map((w) => [w.from, zero()]));
  for (const it of items) {
    const key = `${it.userId}|${it.periodStart}`;
    if (!perPersonPeriod.has(key)) perPersonPeriod.set(key, zero());
    add(perPersonPeriod.get(key)!, it);
    add(perPeriod.get(it.periodStart)!, it);
  }

  return {
    period: selected,
    periods: windows,
    doneStates: ['Completed', 'Accepted'],
    totals: rounded(perPeriod.get(selected.from)!),
    trend: windows.map((w) => ({ ...w, ...rounded(perPeriod.get(w.from)!) })),
    people: people.map((p) => {
      const k = kekaBy.get(p.id);
      return {
        ...p,
        employeeNumber: k?.employeeNumber ?? null,
        jobTitle: k?.jobTitle ?? null,
        department: k?.department ?? null,
        hasData: perPersonPeriod.has(`${p.id}|${selected.from}`),
        current: rounded(perPersonPeriod.get(`${p.id}|${selected.from}`) ?? zero()),
        trend: windows.map((w) => ({ from: w.from, ...rounded(perPersonPeriod.get(`${p.id}|${w.from}`) ?? zero()) })),
      };
    }),
    items: items
      .filter((it) => it.periodStart === selected.from)
      .map((it) => ({
        id: it.id,
        userId: it.userId,
        workProduct: it.workProduct,
        release: it.release,
        state: it.state,
        done: isDoneState(it.state),
        estimate: it.estimate,
        timeSpent: it.timeSpent,
        todo: it.todo,
      })),
  };
}

const batchColumns = {
  id: importBatches.id,
  source: importBatches.source,
  fileName: importBatches.fileName,
  periodStart: importBatches.periodStart,
  totalRows: importBatches.totalRows,
  importedRows: importBatches.importedRows,
  skippedRows: importBatches.skippedRows,
  createdAt: importBatches.createdAt,
  uploadedBy: users.name,
};

/** Import history the caller may see: everything for leadership, otherwise uploads that touched their people. */
export async function listBatches(me: AuthUser, limit = 20) {
  const visible = await visibleUserIds(me);
  const base = db.select(batchColumns).from(importBatches).innerJoin(users, eq(users.id, importBatches.uploadedById));
  if (!visible) return base.orderBy(desc(importBatches.createdAt)).limit(limit);
  const touching = db
    .selectDistinct({ id: rallyItems.batchId })
    .from(rallyItems)
    .where(inArray(rallyItems.userId, visible));
  return base
    .where(
      and(
        eq(importBatches.source, 'RALLY'),
        or(eq(importBatches.uploadedById, me.id), inArray(importBatches.id, touching as never))
      )
    )
    .orderBy(desc(importBatches.createdAt))
    .limit(limit);
}

/**
 * Data availability: when each source was last imported, which people are
 * missing Rally data for which recent periods, and how much of the Keka
 * directory is linked to a login.
 */
export async function buildImportStatus(me: AuthUser) {
  const windows = recentPeriods(6).reverse();
  const people = await peopleInScope(me);
  const ids = people.map((p) => p.id);
  const leadership = me.role === 'ADMIN' || me.role === 'VP' || me.role === 'DIRECTOR';

  const [coverageRows, batches, kekaRows, userCount] = await Promise.all([
    ids.length
      ? db
          .selectDistinct({ userId: rallyItems.userId, periodStart: rallyItems.periodStart })
          .from(rallyItems)
          .where(and(inArray(rallyItems.userId, ids), inArray(rallyItems.periodStart, windows.map((w) => w.from))))
      : Promise.resolve([]),
    listBatches(me, 10),
    leadership
      ? db.select({ userId: kekaEmployees.userId }).from(kekaEmployees)
      : Promise.resolve(null),
    leadership ? db.select({ id: users.id }).from(users).where(eq(users.active, true)) : Promise.resolve(null),
  ]);

  const has = new Set(coverageRows.map((r) => `${r.userId}|${r.periodStart}`));
  const current = windows[windows.length - 1];
  const previous = windows[windows.length - 2];
  const lastOf = (source: 'RALLY' | 'KEKA') => batches.find((b) => b.source === source) ?? null;

  return {
    currentPeriod: current,
    rally: {
      lastImport: lastOf('RALLY'),
      people: people.length,
      withDataCurrent: people.filter((p) => has.has(`${p.id}|${current.from}`)).length,
      withDataPrevious: people.filter((p) => has.has(`${p.id}|${previous.from}`)).length,
    },
    keka: kekaRows
      ? {
          lastImport: lastOf('KEKA'),
          employees: kekaRows.length,
          linked: kekaRows.filter((k) => k.userId).length,
          loginsWithoutRecord: userCount!.filter((u) => !kekaRows.some((k) => k.userId === u.id)).length,
        }
      : null,
    coverage: {
      periods: windows,
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        has: windows.map((w) => has.has(`${p.id}|${w.from}`)),
      })),
    },
    recent: batches,
  };
}
