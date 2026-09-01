import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireRole } from '../auth';
import { ah } from '../http';
import { buildWeeklyReport, reportScopeOptions } from '../reports/weekly';
import { buildWeeklyWorkbook } from '../reports/workbook';

export const reportsRouter = Router();
reportsRouter.use(authenticate);
// Engineers log the work; PMs, Directors and VPs report on it.
reportsRouter.use(requireRole('ADMIN', 'PM', 'DIRECTOR', 'VP'));

const querySchema = z.object({
  projectId: z.string().optional(),
  teamId: z.string().optional(),
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
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
  '/weekly',
  ah(async (req, res) => {
    res.json(await buildWeeklyReport(currentUser(req), querySchema.parse(req.query)));
  })
);

reportsRouter.get(
  '/weekly.xlsx',
  ah(async (req, res) => {
    const report = await buildWeeklyReport(currentUser(req), querySchema.parse(req.query));
    const buffer = await buildWeeklyWorkbook(report);
    const safeSlug = report.slug.replace(/[^A-Za-z0-9-_]+/g, '-').replace(/^-|-$/g, '') || 'report';
    const filename = `weekly-status_${safeSlug}_${report.from}_to_${report.to}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  })
);
