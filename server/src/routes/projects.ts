import { and, asc, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireRole } from '../auth';
import { db } from '../db';
import { projectStatusEnum, projects, tasks, teamMembers, teams } from '../db/schema';
import { ah, badRequest, forbidden, notFound } from '../http';
import { canManageProject, canReadProject, projectScope, teamScope } from '../scope';

export const projectsRouter = Router();
projectsRouter.use(authenticate);

const createProjectSchema = z.object({
  name: z.string().min(2).max(160),
  code: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[A-Za-z0-9-]+$/, 'Code may contain letters, numbers and hyphens'),
  description: z.string().max(2000).optional(),
  status: z.enum(projectStatusEnum.enumValues).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

projectsRouter.post(
  '/',
  requireRole('DIRECTOR'),
  ah(async (req, res) => {
    const me = currentUser(req);
    const body = createProjectSchema.parse(req.body);
    if (body.startDate && body.endDate && body.endDate < body.startDate) {
      throw badRequest('End date must be on or after the start date');
    }
    const [project] = await db
      .insert(projects)
      .values({ ...body, code: body.code.toUpperCase(), directorId: me.id })
      .returning();
    res.status(201).json(project);
  })
);

/** Project list with the roll-up counts the cards show. */
projectsRouter.get(
  '/',
  ah(async (req, res) => {
    const me = currentUser(req);
    const rows = await db.query.projects.findMany({
      where: projectScope(me),
      orderBy: [desc(projects.createdAt)],
      with: {
        director: { columns: { id: true, name: true, email: true } },
        teams: { columns: { id: true } },
      },
    });

    const projectIds = rows.map((p) => p.id);
    const memberCounts = projectIds.length
      ? await db
          .select({ projectId: teams.projectId, n: count(sql`DISTINCT ${teamMembers.userId}`) })
          .from(teams)
          .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
          .where(inArray(teams.projectId, projectIds))
          .groupBy(teams.projectId)
      : [];
    const taskCounts = projectIds.length
      ? await db
          .select({ projectId: teams.projectId, n: count(tasks.id) })
          .from(teams)
          .innerJoin(tasks, eq(tasks.teamId, teams.id))
          .where(inArray(teams.projectId, projectIds))
          .groupBy(teams.projectId)
      : [];

    const memberBy = new Map(memberCounts.map((r) => [r.projectId, Number(r.n)]));
    const taskBy = new Map(taskCounts.map((r) => [r.projectId, Number(r.n)]));

    res.json(
      rows.map(({ teams: t, ...p }) => ({
        ...p,
        teamCount: t.length,
        memberCount: memberBy.get(p.id) ?? 0,
        taskCount: taskBy.get(p.id) ?? 0,
        canManage: me.role === 'DIRECTOR' && p.directorId === me.id,
      }))
    );
  })
);

/** Full drill-down: project -> teams -> members -> tasks. The Director/VP view. */
projectsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!(await canReadProject(me, req.params.id))) throw notFound('Project not found');

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, req.params.id),
      with: {
        director: { columns: { id: true, name: true, email: true } },
        teams: {
          // A PM opening a project they contribute to sees only their own teams.
          where: teamScope(me),
          orderBy: [asc(teams.name)],
          with: {
            pm: { columns: { id: true, name: true, email: true, role: true } },
            members: {
              with: { user: { columns: { id: true, name: true, email: true, role: true } } },
            },
            tasks: {
              orderBy: [asc(tasks.status), desc(tasks.createdAt)],
              with: { assignee: { columns: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    });
    if (!project) throw notFound('Project not found');

    res.json({
      ...project,
      canManage: me.role === 'DIRECTOR' && project.directorId === me.id,
      teams: project.teams.map((t) => ({
        ...t,
        members: [...t.members].sort((a, b) => a.user.name.localeCompare(b.user.name)),
      })),
    });
  })
);

projectsRouter.patch(
  '/:id',
  requireRole('DIRECTOR'),
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!(await canManageProject(me, req.params.id))) {
      throw forbidden('Only the director who owns this project can change it');
    }
    const body = createProjectSchema.partial().parse(req.body);
    const [project] = await db
      .update(projects)
      .set({
        ...body,
        ...(body.code ? { code: body.code.toUpperCase() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, req.params.id))
      .returning();
    res.json(project);
  })
);

/** The pool a Director picks from: teams with no project, plus this project's own. */
projectsRouter.get(
  '/:id/attachable-teams',
  requireRole('DIRECTOR'),
  ah(async (req, res) => {
    const rows = await db.query.teams.findMany({
      where: or(isNull(teams.projectId), eq(teams.projectId, req.params.id)),
      orderBy: [asc(teams.name)],
      with: {
        pm: { columns: { id: true, name: true, email: true } },
        members: { columns: { id: true } },
      },
    });
    res.json(
      rows.map(({ members, ...t }) => ({
        ...t,
        memberCount: members.length,
        attached: t.projectId === req.params.id,
      }))
    );
  })
);

/** Director attaches an existing (PM-created) team to their project. */
projectsRouter.post(
  '/:id/teams',
  requireRole('DIRECTOR'),
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!(await canManageProject(me, req.params.id))) {
      throw forbidden('Only the director who owns this project can add teams to it');
    }
    const { teamId } = z.object({ teamId: z.string().min(1) }).parse(req.body);
    const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
    if (!team) throw notFound('Team not found');
    if (team.projectId && team.projectId !== req.params.id) {
      throw badRequest('That team is already attached to another project. Detach it first.');
    }
    const [updated] = await db
      .update(teams)
      .set({ projectId: req.params.id, updatedAt: new Date() })
      .where(eq(teams.id, teamId))
      .returning();
    res.status(201).json(updated);
  })
);

projectsRouter.delete(
  '/:id/teams/:teamId',
  requireRole('DIRECTOR'),
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!(await canManageProject(me, req.params.id))) {
      throw forbidden('Only the director who owns this project can remove teams from it');
    }
    const result = await db
      .update(teams)
      .set({ projectId: null, updatedAt: new Date() })
      .where(and(eq(teams.id, req.params.teamId), eq(teams.projectId, req.params.id)))
      .returning({ id: teams.id });
    if (result.length === 0) throw notFound('That team is not on this project');
    res.status(204).send();
  })
);
