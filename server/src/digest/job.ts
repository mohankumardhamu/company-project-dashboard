import type { AuthUser } from '../auth';
import type { DateString } from '../dates';
import { db } from '../db';
import { buildPeriodReport, periodReportFilename } from '../reports/biweekly';
import { buildPeriodWorkbook } from '../reports/workbook';
import type { DigestAdapter } from './adapter';
import { getDigestAdapter } from './factory';
import { recipientsForAccount, recipientsForTeam } from './recipients';

/** Runs every scope's report/workbook build and delivery as an unrestricted
 * actor — this is a system job, not a request on behalf of a signed-in user,
 * and every scope it touches is one it's explicitly meant to cover. Safe
 * because canReadTeam/canReadAccount short-circuit on role for ADMIN and
 * never look the id up in the users table. */
const SYSTEM_ACTOR: AuthUser = { id: 'system', name: 'Bi-weekly Digest', email: 'digest@internal', role: 'ADMIN' };

export interface DigestSendResult {
  scope: 'team' | 'account';
  id: string;
  label: string;
  to: string[];
}
export interface DigestSkipResult {
  scope: 'team' | 'account';
  id: string;
  label: string;
  reason: string;
}
export interface DigestRunSummary {
  sent: DigestSendResult[];
  skipped: DigestSkipResult[];
}

export interface RunDigestOptions {
  adapter?: DigestAdapter;
  /** Any day in the period to send; defaults to the period containing today. */
  period?: DateString;
}

export async function runDigest(opts: RunDigestOptions = {}): Promise<DigestRunSummary> {
  const adapter = opts.adapter ?? getDigestAdapter();
  const summary: DigestRunSummary = { sent: [], skipped: [] };

  const [teamRows, accountRows] = await Promise.all([
    db.query.teams.findMany({ columns: { id: true, name: true } }),
    db.query.accounts.findMany({ columns: { id: true, name: true, code: true } }),
  ]);

  // A scope can legitimately have recipients but nothing to report on yet —
  // a brand-new account with no projects attached still has an owning
  // Director and every VP as recipients, but buildPeriodReport throws for a
  // scope with zero readable teams (the right behavior for an interactive
  // export, where "nothing to report" should be a clear error). One empty
  // scope must not take down the whole run, so it's caught and
  // skipped here rather than left to propagate.
  async function deliver(scope: 'team' | 'account', id: string, label: string, to: string[]) {
    try {
      const report = await buildPeriodReport(SYSTEM_ACTOR, {
        ...(scope === 'team' ? { teamId: id } : { accountId: id }),
        period: opts.period,
      });
      const workbook = await buildPeriodWorkbook(report);
      await adapter.send({
        scope,
        scopeId: id,
        scopeLabel: report.scopeLabel,
        to,
        subject: `Bi-weekly status — ${report.scopeLabel}`,
        filename: periodReportFilename(report),
        workbook,
        period: { from: report.from, to: report.to },
      });
      console.log(`[digest] sent ${scope}:${label} to=${to.join(',')} via=${adapter.name}`);
      summary.sent.push({ scope, id, label: report.scopeLabel, to });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`[digest] skipped ${scope}:${label} — ${reason}`);
      summary.skipped.push({ scope, id, label, reason });
    }
  }

  for (const team of teamRows) {
    const to = await recipientsForTeam(team.id);
    if (to.length === 0) {
      console.log(`[digest] skipped team:${team.name} — no recipients`);
      summary.skipped.push({ scope: 'team', id: team.id, label: team.name, reason: 'no recipients' });
      continue;
    }
    await deliver('team', team.id, team.name, to);
  }

  for (const account of accountRows) {
    const to = await recipientsForAccount(account.id);
    if (to.length === 0) {
      console.log(`[digest] skipped account:${account.code} — no recipients`);
      summary.skipped.push({ scope: 'account', id: account.id, label: account.name, reason: 'no recipients' });
      continue;
    }
    await deliver('account', account.id, account.code, to);
  }

  console.log(`[digest] run complete: ${summary.sent.length} sent, ${summary.skipped.length} skipped`);
  return summary;
}
