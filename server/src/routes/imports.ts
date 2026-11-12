import { asc, eq } from 'drizzle-orm';
import express, { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireRole } from '../auth';
import { db } from '../db';
import { kekaEmployees, users } from '../db/schema';
import { ah, badRequest, forbidden } from '../http';
import { commitKekaImport, planKekaImport } from '../imports/keka';
import { commitRallyImport, planRallyImport } from '../imports/rally';
import { buildImportStatus, listBatches } from '../reports/productivity';
import { canImportOrgDirectory } from '../scope';

export const importsRouter = Router();
importsRouter.use(authenticate);

/**
 * Uploads arrive as the raw file bytes (Content-Type: application/octet-stream)
 * with the original file name in the query string — no multipart parsing
 * needed. The same endpoint previews (commit omitted/false: parse, match and
 * validate, write nothing) and imports (commit=true: re-parse and write).
 */
const rawUpload = express.raw({ type: () => true, limit: '10mb' });

const uploadQuery = z.object({
  fileName: z.string().min(1).max(255),
  commit: z.enum(['true', 'false']).optional(),
});

function fileBody(body: unknown): Buffer {
  if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Attach the exported file as the request body');
  return body;
}

importsRouter.post(
  '/rally',
  // VP is read-only; everyone else may import (Engineers only their own rows — see importableUserIds).
  requireRole('ADMIN', 'DIRECTOR', 'PM', 'ENGINEER'),
  rawUpload,
  ah(async (req, res) => {
    const me = currentUser(req);
    const q = uploadQuery
      .extend({ period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the bi-weekly period (YYYY-MM-DD)') })
      .parse(req.query);
    const plan = await planRallyImport(me, fileBody(req.body), q.fileName, q.period);
    if (q.commit !== 'true') return res.json({ ...plan, committed: false });
    if (plan.toCreate + plan.toUpdate === 0) throw badRequest('Nothing in this file can be imported', plan.rows);
    const batchId = await commitRallyImport(me, plan);
    res.status(201).json({ ...plan, committed: true, batchId });
  })
);

importsRouter.post(
  '/keka',
  rawUpload,
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!canImportOrgDirectory(me)) throw forbidden('Only an Admin or VP can import the Keka org directory');
    const q = uploadQuery.parse(req.query);
    const plan = await planKekaImport(fileBody(req.body), q.fileName);
    if (q.commit !== 'true') return res.json({ ...plan, committed: false });
    if (plan.toCreate + plan.toUpdate === 0) throw badRequest('Nothing in this file can be imported', plan.rows);
    const batchId = await commitKekaImport(me, plan);
    res.status(201).json({ ...plan, committed: true, batchId });
  })
);

/** Data availability: last imports, Rally coverage per person per period, Keka link health. */
importsRouter.get(
  '/status',
  ah(async (req, res) => {
    res.json(await buildImportStatus(currentUser(req)));
  })
);

importsRouter.get(
  '/batches',
  ah(async (req, res) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    res.json(await listBatches(currentUser(req), limit));
  })
);

/** The imported Keka directory, with which login (if any) each employee is linked to. */
importsRouter.get(
  '/directory',
  requireRole('ADMIN', 'VP', 'DIRECTOR'),
  ah(async (_req, res) => {
    const rows = await db
      .select({
        id: kekaEmployees.id,
        employeeNumber: kekaEmployees.employeeNumber,
        displayName: kekaEmployees.displayName,
        jobTitle: kekaEmployees.jobTitle,
        department: kekaEmployees.department,
        location: kekaEmployees.location,
        reporteesCount: kekaEmployees.reporteesCount,
        userId: kekaEmployees.userId,
        userEmail: users.email,
        updatedAt: kekaEmployees.updatedAt,
      })
      .from(kekaEmployees)
      .leftJoin(users, eq(users.id, kekaEmployees.userId))
      .orderBy(asc(kekaEmployees.displayName));
    res.json(rows);
  })
);
