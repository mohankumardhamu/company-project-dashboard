import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { endOfPeriod, startOfPeriod, type DateString } from '../dates';
import { db } from '../db';
import { importBatches, rallyItems } from '../db/schema';
import { importableUserIds } from '../scope';
import { loadPersonResolver } from './people';
import { parseNumber, readTable, type ColumnSpec } from './tabular';

/** Rally states that count as "done" for productivity. */
export const RALLY_DONE_STATES = ['completed', 'accepted'];
export const isDoneState = (state: string) => RALLY_DONE_STATES.includes(state.trim().toLowerCase());

const COLUMNS: ColumnSpec[] = [
  { key: 'workProduct', label: 'Work Product', aliases: ['WorkProduct', 'Name', 'Formatted ID'], required: true },
  { key: 'release', label: 'Release', required: false },
  { key: 'state', label: 'State', aliases: ['Schedule State', 'ScheduleState'], required: true },
  { key: 'estimate', label: 'Estimate', aliases: ['Plan Estimate', 'PlanEstimate', 'Story Points'], required: true },
  { key: 'todo', label: 'ToDo', aliases: ['To Do'], required: false },
  { key: 'timeSpent', label: 'Time Spent', aliases: ['Actuals', 'TimeSpent'], required: true },
  { key: 'owner', label: 'Owner', required: true },
];

export interface RallyPlanRow {
  rowNumber: number;
  workProduct: string;
  release: string;
  state: string;
  estimate: number;
  todo: number;
  timeSpent: number;
  owner: string;
  userId: string | null;
  userName: string | null;
  action: 'create' | 'update' | 'skip';
  reason?: string;
}

export interface RallyPlan {
  source: 'RALLY';
  fileName: string;
  period: { from: DateString; to: DateString };
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  skipped: number;
  rows: RallyPlanRow[];
}

/** Parses and validates a Rally export without writing anything — the preview. */
export async function planRallyImport(
  user: AuthUser,
  buf: Buffer,
  fileName: string,
  periodDay: DateString
): Promise<RallyPlan> {
  const from = startOfPeriod(periodDay);
  const to = endOfPeriod(periodDay);
  const { rows } = await readTable(buf, fileName, COLUMNS);
  const resolve = await loadPersonResolver();
  const allowed = await importableUserIds(user);

  const seen = new Map<string, number>();
  const plan: RallyPlanRow[] = rows.map(({ rowNumber, values }) => {
    const base = {
      rowNumber,
      workProduct: values.workProduct,
      release: values.release,
      state: values.state,
      owner: values.owner,
      estimate: 0,
      todo: 0,
      timeSpent: 0,
      userId: null,
      userName: null,
    };
    const skip = (reason: string): RallyPlanRow => ({ ...base, action: 'skip', reason });

    if (!values.workProduct) return skip('Work Product is blank');
    if (values.workProduct.length > 400) return skip('Work Product is longer than 400 characters');
    if (!values.state) return skip('State is blank');
    const estimate = parseNumber(values.estimate);
    const todo = parseNumber(values.todo);
    const timeSpent = parseNumber(values.timeSpent);
    if (estimate === null || estimate < 0) return skip(`Estimate "${values.estimate}" is not a number`);
    if (todo === null || todo < 0) return skip(`ToDo "${values.todo}" is not a number`);
    if (timeSpent === null || timeSpent < 0) return skip(`Time Spent "${values.timeSpent}" is not a number`);

    const who = resolve(values.owner);
    if (!who.ok) return skip(who.reason);
    const withPerson = { ...base, estimate, todo, timeSpent, userId: who.person.id, userName: who.person.name };
    if (!who.person.active) return { ...withPerson, action: 'skip', reason: `${who.person.name}'s account is inactive` };
    if (allowed && !allowed.includes(who.person.id)) {
      return {
        ...withPerson,
        action: 'skip',
        reason:
          user.role === 'ENGINEER'
            ? `Owned by ${who.person.name} — you can only import your own work`
            : `${who.person.name} is not on a team you manage`,
      };
    }

    const key = `${who.person.id}|${values.workProduct}`;
    const firstRow = seen.get(key);
    if (firstRow !== undefined) return { ...withPerson, action: 'skip', reason: `Duplicate of row ${firstRow}` };
    seen.set(key, rowNumber);
    return { ...withPerson, action: 'create' };
  });

  // Rows already imported for the same person + period + work product are updates, not new.
  const userIds = [...new Set(plan.filter((r) => r.action === 'create').map((r) => r.userId!))];
  if (userIds.length) {
    const existing = await db
      .select({ userId: rallyItems.userId, workProduct: rallyItems.workProduct })
      .from(rallyItems)
      .where(and(eq(rallyItems.periodStart, from), inArray(rallyItems.userId, userIds)));
    const have = new Set(existing.map((e) => `${e.userId}|${e.workProduct}`));
    for (const r of plan) {
      if (r.action === 'create' && have.has(`${r.userId}|${r.workProduct}`)) r.action = 'update';
    }
  }

  return {
    source: 'RALLY',
    fileName,
    period: { from, to },
    totalRows: plan.length,
    toCreate: plan.filter((r) => r.action === 'create').length,
    toUpdate: plan.filter((r) => r.action === 'update').length,
    skipped: plan.filter((r) => r.action === 'skip').length,
    rows: plan,
  };
}

/** Writes a previously planned import. Upserts, so re-uploading the same sheet is harmless. */
export async function commitRallyImport(user: AuthUser, plan: RallyPlan): Promise<string> {
  const good = plan.rows.filter((r) => r.action !== 'skip');
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({
        source: 'RALLY',
        fileName: plan.fileName,
        periodStart: plan.period.from,
        uploadedById: user.id,
        totalRows: plan.totalRows,
        importedRows: good.length,
        skippedRows: plan.skipped,
      })
      .returning({ id: importBatches.id });

    for (let i = 0; i < good.length; i += 500) {
      await tx
        .insert(rallyItems)
        .values(
          good.slice(i, i + 500).map((r) => ({
            periodStart: plan.period.from,
            workProduct: r.workProduct,
            release: r.release || null,
            state: r.state,
            estimate: r.estimate,
            todo: r.todo,
            timeSpent: r.timeSpent,
            ownerRaw: r.owner,
            userId: r.userId!,
            batchId: batch.id,
          }))
        )
        .onConflictDoUpdate({
          target: [rallyItems.userId, rallyItems.periodStart, rallyItems.workProduct],
          set: {
            release: sql`excluded.release`,
            state: sql`excluded.state`,
            estimate: sql`excluded.estimate`,
            todo: sql`excluded.todo`,
            timeSpent: sql`excluded.time_spent`,
            ownerRaw: sql`excluded.owner_raw`,
            batchId: sql`excluded.batch_id`,
            updatedAt: sql`now()`,
          },
        });
    }
    return batch.id;
  });
}
