import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../auth';
import { today, toDateOnly } from '../dates';
import { db } from '../db';
import { tasks, teams, workLogStatusEnum, workLogs } from '../db/schema';
import { ah, badRequest, forbidden, notFound } from '../http';
import { canReadTeam, visibleTeamIds } from '../scope';

export const workLogsRouter = Router();
workLogsRouter.use(authenticate);

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const createSchema = z.object({
  taskId: z.string().min(1),
  date: dateString,
  hours: z.number().min(0.25, 'Log at least 15 minutes').max(24, 'A day has 24 hours'),
  summary: z.string().min(3).max(4000),
  blockers: z.string().max(4000).optional().nullable(),
  status: z.enum(workLogStatusEnum.enumValues).optional(),
});

/** Engineers log their own daily status against a task assigned to them. */
workLogsRouter.post(
  '/',
  ah(async (req, res) => {
    const me = currentUser(req);
    const body = createSchema.parse(req.body);
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, body.taskId) });
    if (!task) throw notFound('Task not found');
    if (task.assigneeId !== me.id) {
      throw forbidden('You can only log work against a task assigned to you');
    }
    const date = toDateOnly(body.date);
    if (date > today()) throw badRequest('You cannot log work for a future date');

    // Re-submitting the same day updates that entry rather than duplicating it.
    const [log] = await db
      .insert(workLogs)
      .values({
        taskId: body.taskId,
        userId: me.id,
        date,
        hours: body.hours,
        summary: body.summary,
        blockers: body.blockers ?? null,
        status: body.status ?? 'ON_TRACK',
      })
      .onConflictDoUpdate({
        target: [workLogs.taskId, workLogs.userId, workLogs.date],
        set: {
          hours: body.hours,
          summary: body.summary,
          blockers: body.blockers ?? null,
          status: body.status ?? 'ON_TRACK',
          updatedAt: new Date(),
        },
      })
      .returning();

    res.status(201).json(log);
  })
);

workLogsRouter.get(
  '/',
  ah(async (req, res) => {
    const me = currentUser(req);
    const query = z
      .object({
        teamId: z.string().optional(),
        projectId: z.string().optional(),
        userId: z.string().optional(),
        taskId: z.string().optional(),
        from: dateString.optional(),
        to: dateString.optional(),
        mine: z.string().optional(),
      })
      .parse(req.query);

    if (query.teamId && !(await canReadTeam(me, query.teamId))) throw notFound('Team not found');

    let teamIds = query.teamId ? [query.teamId] : await visibleTeamIds(me);
    if (query.projectId) {
      const inProject = teamIds.length
        ? await db
            .select({ id: teams.id })
            .from(teams)
            .where(and(inArray(teams.id, teamIds), eq(teams.projectId, query.projectId)))
        : [];
      teamIds = inProject.map((t) => t.id);
    }
    if (teamIds.length === 0) return res.json([]);

    const scopedTaskIds = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.teamId, teamIds));
    if (scopedTaskIds.length === 0) return res.json([]);

    const rows = await db.query.workLogs.findMany({
      where: and(
        inArray(
          workLogs.taskId,
          query.taskId ? [query.taskId] : scopedTaskIds.map((t) => t.id)
        ),
        query.userId ? eq(workLogs.userId, query.userId) : undefined,
        query.mine === '1' ? eq(workLogs.userId, me.id) : undefined,
        query.from ? gte(workLogs.date, query.from) : undefined,
        query.to ? lte(workLogs.date, query.to) : undefined
      ),
      orderBy: [desc(workLogs.date), desc(workLogs.createdAt)],
      limit: 500,
      with: {
        user: { columns: { id: true, name: true, email: true } },
        task: {
          columns: { id: true, title: true, status: true },
          with: {
            team: {
              columns: { id: true, name: true },
              with: { project: { columns: { id: true, name: true, code: true } } },
            },
          },
        },
      },
    });
    res.json(rows);
  })
);

const updateSchema = createSchema.omit({ taskId: true, date: true }).partial();

workLogsRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const me = currentUser(req);
    const log = await db.query.workLogs.findFirst({ where: eq(workLogs.id, req.params.id) });
    if (!log) throw notFound('Work log not found');
    if (log.userId !== me.id) throw forbidden('You can only edit your own work logs');
    const body = updateSchema.parse(req.body);
    const [updated] = await db
      .update(workLogs)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(workLogs.id, log.id))
      .returning();
    res.json(updated);
  })
);

workLogsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const me = currentUser(req);
    const log = await db.query.workLogs.findFirst({ where: eq(workLogs.id, req.params.id) });
    if (!log) throw notFound('Work log not found');
    if (log.userId !== me.id) throw forbidden('You can only delete your own work logs');
    await db.delete(workLogs).where(eq(workLogs.id, log.id));
    res.status(204).send();
  })
);
