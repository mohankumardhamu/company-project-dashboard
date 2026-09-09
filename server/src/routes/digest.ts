import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { authenticate, currentUser, requireRole } from '../auth';
import { endOfWeek, startOfWeek, today } from '../dates';
import { db } from '../db';
import { accounts, teams } from '../db/schema';
import { ah } from '../http';
import { buildWeeklyReport } from '../reports/weekly';

export const digestRouter = Router();
digestRouter.use(authenticate);

/**
 * What the weekly digest email would tell this person, computed live rather
 * than read back from a sent log — so it's visible without waiting for
 * Monday or opening a mail client. Scoped the same way recipients are
 * derived: a PM sees the teams they lead, a Director sees the accounts they
 * own, a VP (or Admin) sees every account. Engineers never receive a
 * digest, so there is nothing here for them to preview.
 */
digestRouter.get(
  '/preview',
  requireRole('ADMIN', 'VP', 'DIRECTOR', 'PM'),
  ah(async (req, res) => {
    const me = currentUser(req);

    let scopes: Array<{ scope: 'team' | 'account'; id: string }>;
    if (me.role === 'PM') {
      const rows = await db.query.teams.findMany({ where: eq(teams.pmId, me.id), columns: { id: true } });
      scopes = rows.map((t) => ({ scope: 'team' as const, id: t.id }));
    } else if (me.role === 'DIRECTOR') {
      const rows = await db.query.accounts.findMany({
        where: eq(accounts.ownerDirectorId, me.id),
        columns: { id: true },
      });
      scopes = rows.map((a) => ({ scope: 'account' as const, id: a.id }));
    } else {
      const rows = await db.query.accounts.findMany({ columns: { id: true } });
      scopes = rows.map((a) => ({ scope: 'account' as const, id: a.id }));
    }

    // A scope can have zero readable teams (e.g. a brand-new account with no
    // project attached yet) — buildWeeklyReport throws for that, correctly,
    // for an interactive export. Here it just means nothing to preview for
    // that one scope, not a failure of the whole page.
    const settled = await Promise.all(
      scopes.map(async ({ scope, id }) => {
        try {
          const report = await buildWeeklyReport(me, scope === 'team' ? { teamId: id } : { accountId: id });
          return { scope, id, label: report.scopeLabel, totals: report.totals };
        } catch {
          return null;
        }
      })
    );
    const items = settled.filter((item): item is NonNullable<typeof item> => item !== null);

    const anchor = today();
    res.json({ week: { from: startOfWeek(anchor), to: endOfWeek(anchor) }, items });
  })
);
