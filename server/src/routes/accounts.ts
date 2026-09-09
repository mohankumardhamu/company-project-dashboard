import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireRole } from '../auth';
import { db } from '../db';
import { accountStatusEnum, accounts, projects, teamMembers, teams, tasks, users } from '../db/schema';
import { ah, badRequest, forbidden, notFound } from '../http';
import { accountScope, canManageAccount, canReadAccount, projectScope, teamScope } from '../scope';

export const accountsRouter = Router();
accountsRouter.use(authenticate);

const createAccountSchema = z.object({
  name: z.string().min(2).max(160),
  code: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[A-Za-z0-9-]+$/, 'Code may contain letters, numbers and hyphens'),
  status: z.enum(accountStatusEnum.enumValues).optional(),
  ownerDirectorId: z.string().min(1).optional(),
});

/** A Director who creates an account becomes its owner; only an Admin may assign someone else's. */
accountsRouter.post(
  '/',
  requireRole('ADMIN', 'DIRECTOR'),
  ah(async (req, res) => {
    const me = currentUser(req);
    const body = createAccountSchema.parse(req.body);

    let ownerDirectorId: string | null = null;
    if (me.role === 'DIRECTOR') {
      ownerDirectorId = me.id;
    } else if (body.ownerDirectorId) {
      const owner = await db.query.users.findFirst({ where: eq(users.id, body.ownerDirectorId) });
      if (!owner || owner.role !== 'DIRECTOR') throw badRequest('ownerDirectorId must be an existing Director');
      ownerDirectorId = owner.id;
    }

    const [account] = await db
      .insert(accounts)
      .values({ name: body.name, code: body.code.toUpperCase(), status: body.status, ownerDirectorId })
      .returning();
    res.status(201).json(account);
  })
);

/** Account list with the roll-up counts the cards show. */
accountsRouter.get(
  '/',
  ah(async (req, res) => {
    const me = currentUser(req);
    const rows = await db.query.accounts.findMany({
      where: accountScope(me),
      orderBy: [asc(accounts.name)],
      with: {
        ownerDirector: { columns: { id: true, name: true, email: true } },
        projects: { columns: { id: true } },
      },
    });

    const accountIds = rows.map((a) => a.id);
    const teamCounts = accountIds.length
      ? await db
          .select({ accountId: projects.accountId, n: count(teams.id) })
          .from(projects)
          .innerJoin(teams, eq(teams.projectId, projects.id))
          .where(inArray(projects.accountId, accountIds))
          .groupBy(projects.accountId)
      : [];
    const memberCounts = accountIds.length
      ? await db
          .select({ accountId: projects.accountId, n: count(sql`DISTINCT ${teamMembers.userId}`) })
          .from(projects)
          .innerJoin(teams, eq(teams.projectId, projects.id))
          .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
          .where(inArray(projects.accountId, accountIds))
          .groupBy(projects.accountId)
      : [];
    const taskCounts = accountIds.length
      ? await db
          .select({ accountId: projects.accountId, n: count(tasks.id) })
          .from(projects)
          .innerJoin(teams, eq(teams.projectId, projects.id))
          .innerJoin(tasks, eq(tasks.teamId, teams.id))
          .where(inArray(projects.accountId, accountIds))
          .groupBy(projects.accountId)
      : [];

    const teamBy = new Map(teamCounts.map((r) => [r.accountId, Number(r.n)]));
    const memberBy = new Map(memberCounts.map((r) => [r.accountId, Number(r.n)]));
    const taskBy = new Map(taskCounts.map((r) => [r.accountId, Number(r.n)]));

    res.json(
      rows.map(({ projects: p, ...a }) => ({
        ...a,
        projectCount: p.length,
        teamCount: teamBy.get(a.id) ?? 0,
        memberCount: memberBy.get(a.id) ?? 0,
        taskCount: taskBy.get(a.id) ?? 0,
        canManage: me.role === 'ADMIN' || (me.role === 'DIRECTOR' && a.ownerDirectorId === me.id),
      }))
    );
  })
);

/** Drill-down: account -> its projects (each project further scoped to what the caller may see). */
accountsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!(await canReadAccount(me, req.params.id))) throw notFound('Account not found');

    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, req.params.id),
      with: { ownerDirector: { columns: { id: true, name: true, email: true } } },
    });
    if (!account) throw notFound('Account not found');

    const projectRows = await db.query.projects.findMany({
      where: and(eq(projects.accountId, account.id), projectScope(me)),
      orderBy: [asc(projects.name)],
      with: {
        director: { columns: { id: true, name: true, email: true } },
        teams: {
          where: teamScope(me),
          columns: { id: true },
          with: {
            members: { columns: { id: true } },
            tasks: { columns: { id: true, status: true } },
          },
        },
      },
    });

    res.json({
      ...account,
      canManage: me.role === 'ADMIN' || (me.role === 'DIRECTOR' && account.ownerDirectorId === me.id),
      projects: projectRows.map(({ teams: t, ...p }) => ({
        ...p,
        teamCount: t.length,
        memberCount: t.reduce((s, team) => s + team.members.length, 0),
        taskCount: t.reduce((s, team) => s + team.tasks.length, 0),
        openTaskCount: t.reduce((s, team) => s + team.tasks.filter((x) => x.status !== 'DONE').length, 0),
      })),
    });
  })
);

const updateAccountSchema = createAccountSchema.partial();

accountsRouter.patch(
  '/:id',
  requireRole('ADMIN', 'DIRECTOR'),
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!(await canManageAccount(me, req.params.id))) {
      throw forbidden('Only the director who owns this account can change it');
    }
    const body = updateAccountSchema.parse(req.body);
    if (body.ownerDirectorId !== undefined && me.role !== 'ADMIN') {
      throw forbidden('Only an Admin can reassign the owning director');
    }
    if (me.role === 'ADMIN' && body.ownerDirectorId) {
      const owner = await db.query.users.findFirst({ where: eq(users.id, body.ownerDirectorId) });
      if (!owner || owner.role !== 'DIRECTOR') throw badRequest('ownerDirectorId must be an existing Director');
    }

    const [account] = await db
      .update(accounts)
      .set({
        ...body,
        ...(body.code ? { code: body.code.toUpperCase() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, req.params.id))
      .returning();
    res.json(account);
  })
);
