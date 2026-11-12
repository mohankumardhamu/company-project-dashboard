import { and, asc, count, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../auth';
import { endOfPeriod, startOfPeriod, today } from '../dates';
import { db } from '../db';
import { projects, tasks, teamMembers, teams, workLogs } from '../db/schema';
import { ah } from '../http';
import { projectScope, teamScope, visibleTeamIds } from '../scope';

export const overviewRouter = Router();
overviewRouter.use(authenticate);

/**
 * One endpoint powers the landing dashboard for every role. Numbers are always
 * scoped to the caller, so a PM sees their slice and a VP sees the whole
 * organisation from the same shape of response.
 */
overviewRouter.get(
  '/',
  ah(async (req, res) => {
    const me = currentUser(req);
    const { period } = z
      .object({ period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .parse(req.query);
    const anchor = period ?? today();
    const from = startOfPeriod(anchor);
    const to = endOfPeriod(anchor);

    const teamIds = await visibleTeamIds(me);

    const [[projectCount], [teamCount], memberRows, taskRows, periodLogs] = await Promise.all([
      db.select({ n: count() }).from(projects).where(projectScope(me)),
      db.select({ n: count() }).from(teams).where(teamScope(me)),
      teamIds.length
        ? db
            .selectDistinct({ userId: teamMembers.userId })
            .from(teamMembers)
            .where(inArray(teamMembers.teamId, teamIds))
        : Promise.resolve([]),
      teamIds.length
        ? db
            .select({ status: tasks.status, n: count() })
            .from(tasks)
            .where(inArray(tasks.teamId, teamIds))
            .groupBy(tasks.status)
        : Promise.resolve([]),
      teamIds.length
        ? db
            .select({ hours: workLogs.hours, status: workLogs.status, userId: workLogs.userId })
            .from(workLogs)
            .innerJoin(tasks, eq(tasks.id, workLogs.taskId))
            .where(and(inArray(tasks.teamId, teamIds), gte(workLogs.date, from), lte(workLogs.date, to)))
        : Promise.resolve([]),
    ]);

    const byStatus = Object.fromEntries(taskRows.map((t) => [t.status, Number(t.n)]));

    const projectRows = await db.query.projects.findMany({
      where: projectScope(me),
      orderBy: [asc(projects.name)],
      with: {
        director: { columns: { id: true, name: true } },
        teams: {
          where: teamScope(me),
          columns: { id: true, name: true },
          with: {
            pm: { columns: { id: true, name: true } },
            members: { columns: { id: true } },
            tasks: { columns: { id: true, status: true } },
          },
        },
      },
    });

    res.json({
      scope: me.role,
      period: { from, to },
      totals: {
        projects: Number(projectCount?.n ?? 0),
        teams: Number(teamCount?.n ?? 0),
        members: memberRows.length,
        tasks: {
          total: taskRows.reduce((s, t) => s + Number(t.n), 0),
          todo: byStatus.TODO ?? 0,
          inProgress: byStatus.IN_PROGRESS ?? 0,
          blocked: byStatus.BLOCKED ?? 0,
          done: byStatus.DONE ?? 0,
        },
        thisPeriod: {
          hours: Number(periodLogs.reduce((s, l) => s + l.hours, 0).toFixed(2)),
          entries: periodLogs.length,
          contributors: new Set(periodLogs.map((l) => l.userId)).size,
          blocked: periodLogs.filter((l) => l.status === 'BLOCKED').length,
        },
      },
      projects: projectRows.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        director: p.director,
        teams: p.teams.map((t) => ({
          id: t.id,
          name: t.name,
          pm: t.pm,
          memberCount: t.members.length,
          taskCount: t.tasks.length,
          openTaskCount: t.tasks.filter((x) => x.status !== 'DONE').length,
        })),
      })),
    });
  })
);

/** Unattached teams, so a VP/Director can see work that is not on a project yet. */
overviewRouter.get(
  '/unassigned-teams',
  ah(async (req, res) => {
    const me = currentUser(req);
    const rows = await db.query.teams.findMany({
      where: and(teamScope(me), sql`${teams.projectId} IS NULL`),
      orderBy: [asc(teams.name)],
      with: {
        pm: { columns: { id: true, name: true } },
        members: { columns: { id: true } },
        tasks: { columns: { id: true } },
      },
    });
    res.json(
      rows.map((t) => ({
        id: t.id,
        name: t.name,
        pm: t.pm,
        memberCount: t.members.length,
        taskCount: t.tasks.length,
      }))
    );
  })
);
