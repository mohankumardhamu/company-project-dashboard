import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../auth';
import { recentPeriods, today } from '../dates';
import { env } from '../env';
import { ah } from '../http';
import { buildProductivity } from '../reports/productivity';

export const productivityRouter = Router();
productivityRouter.use(authenticate);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Story points, stories completed and effort per person for one bi-weekly period, plus trend. */
productivityRouter.get(
  '/',
  ah(async (req, res) => {
    const q = z
      .object({
        period: day.optional(),
        teamId: z.string().optional(),
        periods: z.coerce.number().int().min(1).max(26).default(6),
      })
      .parse(req.query);
    res.json(await buildProductivity(currentUser(req), q));
  })
);

export const periodsRouter = Router();
periodsRouter.use(authenticate);

/** The bi-weekly calendar, so every page picks from the same server-defined periods. */
periodsRouter.get(
  '/',
  ah(async (req, res) => {
    const q = z
      .object({ count: z.coerce.number().int().min(1).max(52).default(12), around: day.optional() })
      .parse(req.query);
    const periods = recentPeriods(q.count, q.around ?? today());
    res.json({ anchor: env.biweekAnchor, current: recentPeriods(1)[0], periods });
  })
);
