import { and, asc, count, desc, eq, isNull, ne } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireRole } from '../auth';
import { db } from '../db';
import { taskStatusEnum, tasks, teamMembers, teams, users } from '../db/schema';
import { ah, badRequest, forbidden, notFound } from '../http';
import { canManageTeam, canReadTeam, teamScope } from '../scope';

export const teamsRouter = Router();
teamsRouter.use(authenticate);

const teamSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
});

/** Only a PM creates a team; they become its lead. */
teamsRouter.post(
  '/',
  requireRole('ADMIN', 'PM'),
  ah(async (req, res) => {
    const me = currentUser(req);
    const body = teamSchema.parse(req.body);
    const [team] = await db.insert(teams).values({ ...body, pmId: me.id }).returning();
    res.status(201).json(team);
  })
);

teamsRouter.get(
  '/',
  ah(async (req, res) => {
    const me = currentUser(req);
    const unassigned = req.query.unassigned === '1' || req.query.unassigned === 'true';
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;

    const rows = await db.query.teams.findMany({
      where: and(
        teamScope(me),
        unassigned ? isNull(teams.projectId) : undefined,
        projectId ? eq(teams.projectId, projectId) : undefined
      ),
      orderBy: [desc(teams.createdAt)],
      with: {
        pm: { columns: { id: true, name: true, email: true } },
        project: { columns: { id: true, name: true, code: true, status: true } },
        members: { columns: { id: true } },
        tasks: { columns: { id: true, status: true } },
      },
    });

    res.json(
      rows.map(({ members, tasks: t, ...team }) => ({
        ...team,
        memberCount: members.length,
        taskCount: t.length,
        openTaskCount: t.filter((x) => x.status !== 'DONE').length,
        canManage: me.role === 'ADMIN' || (me.role === 'PM' && team.pmId === me.id),
      }))
    );
  })
);

teamsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!(await canReadTeam(me, req.params.id))) throw notFound('Team not found');

    const team = await db.query.teams.findFirst({
      where: eq(teams.id, req.params.id),
      with: {
        pm: { columns: { id: true, name: true, email: true, role: true } },
        project: { columns: { id: true, name: true, code: true, status: true } },
        members: {
          with: { user: { columns: { id: true, name: true, email: true, role: true } } },
        },
        tasks: {
          orderBy: [asc(tasks.status), desc(tasks.createdAt)],
          with: { assignee: { columns: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!team) throw notFound('Team not found');

    res.json({
      ...team,
      members: [...team.members].sort((a, b) => a.user.name.localeCompare(b.user.name)),
      canManage: await canManageTeam(me, team.id),
    });
  })
);

teamsRouter.patch(
  '/:id',
  requireRole('ADMIN', 'PM'),
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!(await canManageTeam(me, req.params.id))) {
      throw forbidden('Only the PM who leads this team can change it');
    }
    const body = teamSchema.partial().parse(req.body);
    const [team] = await db
      .update(teams)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(teams.id, req.params.id))
      .returning();
    res.json(team);
  })
);

/** PM adds a member. Directors and VPs are org leadership, not team members. */
teamsRouter.post(
  '/:id/members',
  requireRole('ADMIN', 'PM'),
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!(await canManageTeam(me, req.params.id))) {
      throw forbidden('Only the PM who leads this team can add members');
    }
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw notFound('User not found');
    if (!user.active) throw badRequest('That account is deactivated');
    if (user.role === 'ADMIN' || user.role === 'VP' || user.role === 'DIRECTOR') {
      throw badRequest('Admins, VPs and Directors are not added as team members');
    }

    const [member] = await db
      .insert(teamMembers)
      .values({ teamId: req.params.id, userId })
      .returning();
    res.status(201).json({
      ...member,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  })
);

teamsRouter.delete(
  '/:id/members/:userId',
  requireRole('ADMIN', 'PM'),
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!(await canManageTeam(me, req.params.id))) {
      throw forbidden('Only the PM who leads this team can remove members');
    }
    const [{ n }] = await db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.teamId, req.params.id),
          eq(tasks.assigneeId, req.params.userId),
          ne(tasks.status, taskStatusEnum.enumValues[3]) // not DONE
        )
      );
    if (Number(n) > 0) {
      throw badRequest(
        `That member still has ${n} open task(s) on this team. Reassign or close them first.`
      );
    }
    const removed = await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, req.params.id), eq(teamMembers.userId, req.params.userId)))
      .returning({ id: teamMembers.id });
    if (removed.length === 0) throw notFound('That person is not on this team');
    res.status(204).send();
  })
);
