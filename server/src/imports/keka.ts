import { inArray, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { db } from '../db';
import { importBatches, kekaEmployees } from '../db/schema';
import { loadPersonResolver } from './people';
import { readTable, type ColumnSpec } from './tabular';

const COLUMNS: ColumnSpec[] = [
  { key: 'employeeNumber', label: 'Employee Number', aliases: ['Employee No', 'Emp No', 'Employee Id'], required: true },
  { key: 'displayName', label: 'Display Name', aliases: ['Name', 'Employee Name'], required: true },
  { key: 'jobTitle', label: 'Job Title', aliases: ['Designation'], required: false },
  { key: 'department', label: 'Department', required: false },
  { key: 'location', label: 'Location', required: false },
  { key: 'reporteesCount', label: 'Reportees Count', aliases: ['Reportees'], required: false },
];

export interface KekaPlanRow {
  rowNumber: number;
  employeeNumber: string;
  displayName: string;
  jobTitle: string;
  department: string;
  location: string;
  reporteesCount: number;
  /** The login this employee is linked to, matched by display name. Null = no login yet (still imported). */
  userId: string | null;
  userName: string | null;
  action: 'create' | 'update' | 'skip';
  reason?: string;
}

export interface KekaPlan {
  source: 'KEKA';
  fileName: string;
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  skipped: number;
  linked: number;
  rows: KekaPlanRow[];
}

export async function planKekaImport(buf: Buffer, fileName: string): Promise<KekaPlan> {
  const { rows } = await readTable(buf, fileName, COLUMNS);
  const resolve = await loadPersonResolver();
  const seen = new Map<string, number>();

  const plan: KekaPlanRow[] = rows.map(({ rowNumber, values }) => {
    const count = values.reporteesCount === '' ? 0 : Number(values.reporteesCount);
    const base = {
      rowNumber,
      employeeNumber: values.employeeNumber,
      displayName: values.displayName,
      jobTitle: values.jobTitle,
      department: values.department,
      location: values.location,
      reporteesCount: Number.isInteger(count) && count >= 0 ? count : 0,
      userId: null,
      userName: null,
    };
    const skip = (reason: string): KekaPlanRow => ({ ...base, action: 'skip', reason });
    if (!values.employeeNumber) return skip('Employee Number is blank');
    if (values.employeeNumber.length > 40) return skip('Employee Number is longer than 40 characters');
    if (!values.displayName) return skip('Display Name is blank');
    if (!Number.isInteger(count) || count < 0) return skip(`Reportees Count "${values.reporteesCount}" is not a whole number`);
    const first = seen.get(values.employeeNumber);
    if (first !== undefined) return skip(`Duplicate Employee Number (also on row ${first})`);
    seen.set(values.employeeNumber, rowNumber);

    const who = resolve(values.displayName);
    return {
      ...base,
      userId: who.ok ? who.person.id : null,
      userName: who.ok ? who.person.name : null,
      action: 'create',
    };
  });

  const numbers = plan.filter((r) => r.action === 'create').map((r) => r.employeeNumber);
  if (numbers.length) {
    const existing = await db
      .select({ n: kekaEmployees.employeeNumber })
      .from(kekaEmployees)
      .where(inArray(kekaEmployees.employeeNumber, numbers));
    const have = new Set(existing.map((e) => e.n));
    for (const r of plan) if (r.action === 'create' && have.has(r.employeeNumber)) r.action = 'update';
  }

  return {
    source: 'KEKA',
    fileName,
    totalRows: plan.length,
    toCreate: plan.filter((r) => r.action === 'create').length,
    toUpdate: plan.filter((r) => r.action === 'update').length,
    skipped: plan.filter((r) => r.action === 'skip').length,
    linked: plan.filter((r) => r.action !== 'skip' && r.userId).length,
    rows: plan,
  };
}

export async function commitKekaImport(user: AuthUser, plan: KekaPlan): Promise<string> {
  const good = plan.rows.filter((r) => r.action !== 'skip');
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({
        source: 'KEKA',
        fileName: plan.fileName,
        uploadedById: user.id,
        totalRows: plan.totalRows,
        importedRows: good.length,
        skippedRows: plan.skipped,
      })
      .returning({ id: importBatches.id });

    for (let i = 0; i < good.length; i += 500) {
      await tx
        .insert(kekaEmployees)
        .values(
          good.slice(i, i + 500).map((r) => ({
            employeeNumber: r.employeeNumber,
            displayName: r.displayName,
            jobTitle: r.jobTitle || null,
            department: r.department || null,
            location: r.location || null,
            reporteesCount: r.reporteesCount,
            userId: r.userId,
            batchId: batch.id,
          }))
        )
        .onConflictDoUpdate({
          target: kekaEmployees.employeeNumber,
          set: {
            displayName: sql`excluded.display_name`,
            jobTitle: sql`excluded.job_title`,
            department: sql`excluded.department`,
            location: sql`excluded.location`,
            reporteesCount: sql`excluded.reportees_count`,
            // Keep an existing link if this upload's name no longer matches a login.
            userId: sql`coalesce(excluded.user_id, ${kekaEmployees.userId})`,
            batchId: sql`excluded.batch_id`,
            updatedAt: sql`now()`,
          },
        });
    }
    return batch.id;
  });
}
