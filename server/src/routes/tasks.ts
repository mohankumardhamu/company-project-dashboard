import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireRole } from '../auth';
import { db } from '../db';
import { taskPriorityEnum, taskStatusEnum, tasks, teamMembers, teams, workLogs } from '../db/schema';
import { ah, badRequest, forbidden, notFound } from '../http';
import { canManageTeam, canReadTeam, visibleTeamIds } from '../scope';

export const tasksRouter = Router();
tasksRouter.use(authenticate);

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const createTaskSchema = z.object({
  teamId: z.string().min(1),
  assigneeId: z.string().min(1),
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  status: z.enum(taskStatusEnum.enumValues).optional(),
  priority: z.enum(taskPriorityEnum.enumValues).optional(),
  dueDate: dateString.optional(),
});

async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** The PM who leads the team creates tasks and assigns them to team members. */
tasksRouter.post(
  '/',
  requireRole('ADMIN', 'PM'),
  ah(async (req, res) => {
    const me = currentUser(req);
    const body = createTaskSchema.parse(req.body);
    if (!(await canManageTeam(me, body.teamId))) {
      throw forbidden('Only the PM who leads this team can create tasks on it');
    }
    if (!(await isTeamMember(body.teamId, body.assigneeId))) {
      throw badRequest('The assignee must be a member of this team');
    }
    const [task] = await db
      .insert(tasks)
      .values({ ...body, createdById: me.id })
      .returning();
    res.status(201).json(task);
  })
);

tasksRouter.get(
  '/',
  ah(async (req, res) => {
    const me = currentUser(req);
    const query = z
      .object({
        teamId: z.string().optional(),
        projectId: z.string().optional(),
        assigneeId: z.string().optional(),
        status: z.enum(taskStatusEnum.enumValues).optional(),
        mine: z.string().optional(),
      })
      .parse(req.query);

    const teamIds = await visibleTeamIds(me);
    if (query.teamId && !teamIds.includes(query.teamId)) throw notFound('Team not found');
    if (teamIds.length === 0) return res.json([]);

    let scopedTeamIds = query.teamId ? [query.teamId] : teamIds;
    if (query.projectId) {
      const inProject = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(inArray(teams.id, scopedTeamIds), eq(teams.projectId, query.projectId)));
      scopedTeamIds = inProject.map((t) => t.id);
      if (scopedTeamIds.length === 0) return res.json([]);
    }

    const rows = await db.query.tasks.findMany({
      where: and(
        inArray(tasks.teamId, scopedTeamIds),
        query.assigneeId ? eq(tasks.assigneeId, query.assigneeId) : undefined,
        query.mine === '1' ? eq(tasks.assigneeId, me.id) : undefined,
        query.status ? eq(tasks.status, query.status) : undefined
      ),
      orderBy: [asc(tasks.status), asc(tasks.dueDate), desc(tasks.createdAt)],
      with: {
        assignee: { columns: { id: true, name: true, email: true } },
        team: {
          columns: { id: true, name: true, pmId: true },
          with: { project: { columns: { id: true, name: true, code: true } } },
        },
        workLogs: { columns: { id: true, hours: true } },
      },
    });

    res.json(
      rows.map(({ workLogs: logs, ...t }) => ({
        ...t,
        logCount: logs.length,
        loggedHours: Number(logs.reduce((s, l) => s + l.hours, 0).toFixed(2)),
        canManage: me.role === 'ADMIN' || (me.role === 'PM' && t.team.pmId === me.id),
      }))
    );
  })
);

tasksRouter.get(
  '/:id',
  ah(async (req, res) => {
    const me = currentUser(req);
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, req.params.id),
      with: {
        assignee: { columns: { id: true, name: true, email: true } },
        team: {
          columns: { id: true, name: true, pmId: true },
          with: { project: { columns: { id: true, name: true, code: true } } },
        },
        workLogs: {
          orderBy: [desc(workLogs.date)],
          with: { user: { columns: { id: true, name: true } } },
        },
      },
    });
    if (!task || !(await canReadTeam(me, task.teamId))) throw notFound('Task not found');
    res.json({ ...task, canManage: await canManageTeam(me, task.teamId) });
  })
);

const updateTaskSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(4000).optional(),
  status: z.enum(taskStatusEnum.enumValues).optional(),
  priority: z.enum(taskPriorityEnum.enumValues).optional(),
  dueDate: dateString.nullable().optional(),
  assigneeId: z.string().min(1).optional(),
});

/**
 * The team's PM can change anything. The assigned engineer can move their own
 * task's status but cannot reassign or retitle it.
 */
tasksRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const me = currentUser(req);
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, req.params.id) });
    if (!task || !(await canReadTeam(me, task.teamId))) throw notFound('Task not found');

    const body = updateTaskSchema.parse(req.body);
    const isPm = await canManageTeam(me, task.teamId);

    if (!isPm) {
      if (task.assigneeId !== me.id) {
        throw forbidden('Only the team PM or the assignee can update this task');
      }
      const attempted = Object.keys(body).filter((k) => k !== 'status');
      if (attempted.length) {
        throw forbidden(
          `As the assignee you may only change: status (attempted: ${attempted.join(', ')})`
        );
      }
    }

    if (body.assigneeId && !(await isTeamMember(task.teamId, body.assigneeId))) {
      throw badRequest('The assignee must be a member of this team');
    }

    const [updated] = await db
      .update(tasks)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(tasks.id, task.id))
      .returning();
    res.json(updated);
  })
);

tasksRouter.delete(
  '/:id',
  requireRole('ADMIN', 'PM'),
  ah(async (req, res) => {
    const me = currentUser(req);
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, req.params.id) });
    if (!task) throw notFound('Task not found');
    if (!(await canManageTeam(me, task.teamId))) {
      throw forbidden('Only the PM who leads this team can delete its tasks');
    }
    await db.delete(tasks).where(eq(tasks.id, task.id));
    res.status(204).send();
  })
);
