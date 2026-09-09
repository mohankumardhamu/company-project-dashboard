import { and, desc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requireRole } from '../auth';
import { today } from '../dates';
import { db } from '../db';
import { outcomeCategoryEnum, outcomeTasks, outcomes, projects, tasks, teams } from '../db/schema';
import { ah, badRequest, forbidden, notFound } from '../http';
import { canManageTeam, canReadTeam, canVerifyOutcome, visibleTeamIds } from '../scope';

export const outcomesRouter = Router();
outcomesRouter.use(authenticate);

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const createOutcomeSchema = z.object({
  teamId: z.string().min(1),
  title: z.string().min(2).max(200),
  landedOn: dateString,
  narrative: z.string().min(10, 'Say a bit more about what this actually produced').max(4000),
  category: z.enum(outcomeCategoryEnum.enumValues),
  taskIds: z.array(z.string().min(1)).max(20).optional(),
});

const updateOutcomeSchema = createOutcomeSchema.omit({ teamId: true }).partial();

const outcomeWith = {
  team: {
    columns: { id: true, name: true },
    with: {
      project: {
        columns: { id: true, name: true, code: true, directorId: true },
        with: { account: { columns: { id: true, name: true, code: true } } },
      },
    },
  },
  pm: { columns: { id: true, name: true, email: true } },
  verifiedBy: { columns: { id: true, name: true, email: true } },
  tasks: { with: { task: { columns: { id: true, title: true } } } },
} as const;

const fetchOutcome = (id: string) => db.query.outcomes.findFirst({ where: eq(outcomes.id, id), with: outcomeWith });
type OutcomeRow = NonNullable<Awaited<ReturnType<typeof fetchOutcome>>>;

/** Shapes a fetched outcome for the API response, computing canManage/canVerify inline
 * from fields already joined in — no extra scope.ts round trip for list rendering. */
function shapeOutcome(me: { id: string; role: string }, row: OutcomeRow) {
  const { team, tasks: links, ...o } = row;
  const project = team.project ?? null;
  const directorId = project?.directorId ?? null;
  return {
    ...o,
    team: { id: team.id, name: team.name },
    project: project ? { id: project.id, name: project.name, code: project.code } : null,
    account: project?.account ?? null,
    linkedTasks: links.map((l) => l.task),
    canManage: me.role === 'ADMIN' || o.pmId === me.id,
    canVerify: me.role === 'ADMIN' || (me.role === 'DIRECTOR' && directorId === me.id),
  };
}

/** Validates that every taskId belongs to the given team; throws otherwise. */
async function assertTasksOnTeam(teamId: string, taskIds: string[]) {
  if (taskIds.length === 0) return;
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.id, taskIds), eq(tasks.teamId, teamId)));
  if (rows.length !== new Set(taskIds).size) {
    throw badRequest('Linked tasks must belong to the same team as the outcome');
  }
}

/** A PM files an outcome for their own team; an Admin can file on behalf of any team's PM. */
outcomesRouter.post(
  '/',
  requireRole('ADMIN', 'PM'),
  ah(async (req, res) => {
    const me = currentUser(req);
    const body = createOutcomeSchema.parse(req.body);
    if (!(await canManageTeam(me, body.teamId))) {
      throw forbidden('Only the PM who leads this team can file an outcome for it');
    }
    if (body.landedOn > today()) throw badRequest('An outcome cannot land in the future');

    const team = await db.query.teams.findFirst({ where: eq(teams.id, body.teamId) });
    if (!team) throw notFound('Team not found');
    const pmId = me.role === 'PM' ? me.id : team.pmId;

    if (body.taskIds?.length) await assertTasksOnTeam(body.teamId, body.taskIds);

    const [outcome] = await db
      .insert(outcomes)
      .values({
        teamId: body.teamId,
        pmId,
        title: body.title,
        landedOn: body.landedOn,
        narrative: body.narrative,
        category: body.category,
      })
      .returning();

    if (body.taskIds?.length) {
      await db.insert(outcomeTasks).values(body.taskIds.map((taskId) => ({ outcomeId: outcome.id, taskId })));
    }

    const row = await fetchOutcome(outcome.id);
    res.status(201).json(shapeOutcome(me, row!));
  })
);

outcomesRouter.get(
  '/',
  ah(async (req, res) => {
    const me = currentUser(req);
    const query = z
      .object({
        teamId: z.string().optional(),
        projectId: z.string().optional(),
        accountId: z.string().optional(),
        mine: z.string().optional(),
      })
      .parse(req.query);

    const teamIds = await visibleTeamIds(me);
    if (query.teamId && !teamIds.includes(query.teamId)) throw notFound('Team not found');
    if (teamIds.length === 0) return res.json([]);

    let scopedTeamIds = query.teamId ? [query.teamId] : teamIds;
    if (query.accountId) {
      const inAccount = await db
        .select({ id: teams.id })
        .from(teams)
        .innerJoin(projects, eq(projects.id, teams.projectId))
        .where(and(inArray(teams.id, scopedTeamIds), eq(projects.accountId, query.accountId)));
      scopedTeamIds = inAccount.map((t) => t.id);
      if (scopedTeamIds.length === 0) return res.json([]);
    } else if (query.projectId) {
      const inProject = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(inArray(teams.id, scopedTeamIds), eq(teams.projectId, query.projectId)));
      scopedTeamIds = inProject.map((t) => t.id);
      if (scopedTeamIds.length === 0) return res.json([]);
    }

    const rows = await db.query.outcomes.findMany({
      where: and(
        inArray(outcomes.teamId, scopedTeamIds),
        query.mine === '1' ? eq(outcomes.pmId, me.id) : undefined
      ),
      orderBy: [desc(outcomes.landedOn), desc(outcomes.createdAt)],
      with: outcomeWith,
    });

    res.json(rows.map((row) => shapeOutcome(me, row)));
  })
);

outcomesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const me = currentUser(req);
    const row = await fetchOutcome(req.params.id);
    if (!row || !(await canReadTeam(me, row.teamId))) throw notFound('Outcome not found');
    res.json(shapeOutcome(me, row));
  })
);

/** The filing PM can correct their own outcome; an Admin can correct any. */
outcomesRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const me = currentUser(req);
    const existing = await db.query.outcomes.findFirst({ where: eq(outcomes.id, req.params.id) });
    if (!existing || !(await canReadTeam(me, existing.teamId))) throw notFound('Outcome not found');
    if (me.role !== 'ADMIN' && existing.pmId !== me.id) {
      throw forbidden('Only the PM who filed this outcome can edit it');
    }

    const body = updateOutcomeSchema.parse(req.body);
    if (body.landedOn && body.landedOn > today()) throw badRequest('An outcome cannot land in the future');
    if (body.taskIds) await assertTasksOnTeam(existing.teamId, body.taskIds);

    const { taskIds, ...fields } = body;
    if (Object.keys(fields).length > 0) {
      await db
        .update(outcomes)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(outcomes.id, existing.id));
    }
    if (taskIds) {
      await db.delete(outcomeTasks).where(eq(outcomeTasks.outcomeId, existing.id));
      if (taskIds.length) {
        await db.insert(outcomeTasks).values(taskIds.map((taskId) => ({ outcomeId: existing.id, taskId })));
      }
    }

    const row = await fetchOutcome(existing.id);
    res.json(shapeOutcome(me, row!));
  })
);

/** A Director confirms an outcome that landed on a project they own; an Admin, unrestricted. */
outcomesRouter.post(
  '/:id/verify',
  requireRole('ADMIN', 'DIRECTOR'),
  ah(async (req, res) => {
    const me = currentUser(req);
    if (!(await canVerifyOutcome(me, req.params.id))) {
      throw forbidden("Only the director who owns this outcome's project can verify it");
    }
    const [updated] = await db
      .update(outcomes)
      .set({ verifiedById: me.id, verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(outcomes.id, req.params.id))
      .returning();
    if (!updated) throw notFound('Outcome not found');

    const row = await fetchOutcome(updated.id);
    res.json(shapeOutcome(me, row!));
  })
);
