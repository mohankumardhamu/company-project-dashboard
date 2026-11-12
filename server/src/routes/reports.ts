import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireRole } from '../auth';
import { ah } from '../http';
import { buildPeriodReport, reportScopeOptions, periodReportFilename } from '../reports/biweekly';
import { buildPeriodWorkbook } from '../reports/workbook';

export const reportsRouter = Router();
reportsRouter.use(authenticate);
// Engineers log the work; PMs, Directors and VPs report on it.
reportsRouter.use(requireRole('ADMIN', 'PM', 'DIRECTOR', 'VP'));

const querySchema = z.object({
  accountId: z.string().optional(),
  projectId: z.string().optional(),
  teamId: z.string().optional(),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
});

/** What the caller is allowed to run a report over. */
reportsRouter.get(
  '/scopes',
  ah(async (req, res) => {
    res.json(await reportScopeOptions(currentUser(req)));
  })
);

/** On-screen preview of exactly what the spreadsheet will contain. */
reportsRouter.get(
  '/biweekly',
  ah(async (req, res) => {
    res.json(await buildPeriodReport(currentUser(req), querySchema.parse(req.query)));
  })
);

reportsRouter.get(
  '/biweekly.xlsx',
  ah(async (req, res) => {
    const report = await buildPeriodReport(currentUser(req), querySchema.parse(req.query));
    const buffer = await buildPeriodWorkbook(report);
    const filename = periodReportFilename(report);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  })
);
