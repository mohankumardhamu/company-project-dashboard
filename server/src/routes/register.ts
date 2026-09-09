import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../auth';
import { db } from '../db';
import { accounts, outcomeCategoryEnum, outcomes, projects, tasks, teams, users, type OutcomeCategory } from '../db/schema';
import { ah } from '../http';
import { shapeRegisterResult, visibleAccountIds, visibleTeamIds, type RegisterResultRow } from '../scope';

export const registerRouter = Router();
registerRouter.use(authenticate);
// Open to every signed-in role — the redaction rule in scope.ts is what
// keeps this safe, not a role gate here.

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.enum(outcomeCategoryEnum.enumValues).optional(),
  accountId: z.string().optional(),
  from: dateString.optional(),
  to: dateString.optional(),
});

const RESULT_LIMIT = 100;

registerRouter.get(
  '/',
  ah(async (req, res) => {
    const me = currentUser(req);
    const query = querySchema.parse(req.query);
    const q = query.q?.trim() || undefined;

    // The two halves of the union must produce structurally identical column
    // types, so anything that's a strict literal or NOT NULL on the outcomes
    // side but not on the tasks side (kind, category, narrative, verified)
    // is explicitly widened here to match.
    const outcomeQuery = db
      .select({
        kind: sql<'outcome' | 'task'>`'outcome'`.as('kind'),
        id: outcomes.id,
        title: outcomes.title,
        category: sql<OutcomeCategory | null>`${outcomes.category}::text`.as('category'),
        date: sql<string>`${outcomes.landedOn}`.as('date'),
        narrative: sql<string | null>`${outcomes.narrative}`.as('narrative'),
        personName: sql<string>`${users.name}`.as('person_name'),
        verified: sql<boolean | null>`(${outcomes.verifiedAt} is not null)`.as('verified'),
        teamId: sql<string>`${teams.id}`.as('team_id'),
        teamName: sql<string>`${teams.name}`.as('team_name'),
        projectId: sql<string | null>`${projects.id}`.as('project_id'),
        projectName: sql<string | null>`${projects.name}`.as('project_name'),
        projectCode: sql<string | null>`${projects.code}`.as('project_code'),
        accountId: sql<string | null>`${accounts.id}`.as('account_id'),
        accountName: sql<string | null>`${accounts.name}`.as('account_name'),
        accountCode: sql<string | null>`${accounts.code}`.as('account_code'),
        rank: q
          ? sql<number>`ts_rank(${outcomes.searchVector}, websearch_to_tsquery('english', ${q}))`.as('rank')
          : sql<number>`0`.as('rank'),
      })
      .from(outcomes)
      .innerJoin(teams, eq(teams.id, outcomes.teamId))
      .innerJoin(users, eq(users.id, outcomes.pmId))
      .leftJoin(projects, eq(projects.id, teams.projectId))
      .leftJoin(accounts, eq(accounts.id, projects.accountId))
      .where(
        and(
          q ? sql`${outcomes.searchVector} @@ websearch_to_tsquery('english', ${q})` : undefined,
          query.category ? eq(outcomes.category, query.category) : undefined,
          query.accountId ? eq(projects.accountId, query.accountId) : undefined,
          query.from ? gte(outcomes.landedOn, query.from) : undefined,
          query.to ? lte(outcomes.landedOn, query.to) : undefined
        )
      );

    let rows: RegisterResultRow[];

    if (query.category) {
      // Tasks have no category — filtering by one means "outcomes only".
      rows = (await outcomeQuery.orderBy(sql`rank desc`, sql`"date" desc`).limit(RESULT_LIMIT)) as unknown as RegisterResultRow[];
    } else {
      const taskQuery = db
        .select({
          kind: sql<'outcome' | 'task'>`'task'`.as('kind'),
          id: tasks.id,
          title: tasks.title,
          category: sql<OutcomeCategory | null>`null::text`.as('category'),
          // updatedAt is the closest signal we have to "completed on this
          // date" — tasks have no dedicated completedAt column (same
          // approximation already used in the portfolio and digest work).
          date: sql<string>`${tasks.updatedAt}::date`.as('date'),
          narrative: sql<string | null>`${tasks.description}`.as('narrative'),
          personName: sql<string>`${users.name}`.as('person_name'),
          verified: sql<boolean | null>`null::boolean`.as('verified'),
          teamId: sql<string>`${teams.id}`.as('team_id'),
          teamName: sql<string>`${teams.name}`.as('team_name'),
          projectId: sql<string | null>`${projects.id}`.as('project_id'),
          projectName: sql<string | null>`${projects.name}`.as('project_name'),
          projectCode: sql<string | null>`${projects.code}`.as('project_code'),
          accountId: sql<string | null>`${accounts.id}`.as('account_id'),
          accountName: sql<string | null>`${accounts.name}`.as('account_name'),
          accountCode: sql<string | null>`${accounts.code}`.as('account_code'),
          rank: q
            ? sql<number>`ts_rank(${tasks.searchVector}, websearch_to_tsquery('english', ${q}))`.as('rank')
            : sql<number>`0`.as('rank'),
        })
        .from(tasks)
        .innerJoin(teams, eq(teams.id, tasks.teamId))
        .innerJoin(users, eq(users.id, tasks.assigneeId))
        .leftJoin(projects, eq(projects.id, teams.projectId))
        .leftJoin(accounts, eq(accounts.id, projects.accountId))
        .where(
          and(
            eq(tasks.status, 'DONE'),
            q ? sql`${tasks.searchVector} @@ websearch_to_tsquery('english', ${q})` : undefined,
            query.accountId ? eq(projects.accountId, query.accountId) : undefined,
            query.from ? gte(tasks.updatedAt, new Date(`${query.from}T00:00:00.000Z`)) : undefined,
            query.to ? lte(tasks.updatedAt, new Date(`${query.to}T23:59:59.999Z`)) : undefined
          )
        );

      rows = (await unionAll(outcomeQuery, taskQuery)
        .orderBy(sql`rank desc`, sql`"date" desc`)
        .limit(RESULT_LIMIT)) as unknown as RegisterResultRow[];
    }

    // Redaction (server/src/scope.ts) needs to know, per row, whether this
    // viewer can read that row's team/account. Fetch both visibility sets
    // once — not one query per row — and check membership in memory.
    const [teamIds, accountIds] = await Promise.all([visibleTeamIds(me), visibleAccountIds(me)]);
    const visibleTeams = new Set(teamIds);
    const visibleAccounts = new Set(accountIds);

    const results = rows.map((row) =>
      shapeRegisterResult(row, {
        canReadTeam: visibleTeams.has(row.teamId),
        canReadAccount: row.accountId ? visibleAccounts.has(row.accountId) : false,
      })
    );

    res.json({ results });
  })
);
