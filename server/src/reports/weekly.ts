import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { addDays, endOfWeek, startOfWeek, today, type DateString } from '../dates';
import { db } from '../db';
import { accounts, outcomes, projects, tasks, teamMembers, teams, workLogs } from '../db/schema';
import { badRequest, forbidden, notFound } from '../http';
import { canReadAccount, canReadProject, canReadTeam, teamScope } from '../scope';

export interface WeeklyReportParams {
  accountId?: string;
  projectId?: string;
  teamId?: string;
  week?: DateString;
}

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  teamName: string;
  projectName: string;
  hours: number;
  entries: number;
  daysLogged: number;
  tasksTouched: number;
  tasksOpen: number;
  tasksDone: number;
  blockedEntries: number;
}

export interface LogRow {
  date: string;
  projectName: string;
  teamName: string;
  memberName: string;
  taskTitle: string;
  taskStatus: string;
  hours: number;
  status: string;
  summary: string;
  blockers: string;
}

export interface TaskRow {
  projectName: string;
  teamName: string;
  title: string;
  assignee: string;
  status: string;
  priority: string;
  dueDate: string;
  hoursThisWeek: number;
  totalLoggedHours: number;
}

export interface OutcomeRow {
  id: string;
  landedOn: string;
  title: string;
  narrative: string;
  category: string;
  teamName: string;
  projectName: string;
  pmName: string;
  verified: boolean;
}

export interface WeeklyReport {
  slug: string;
  title: string;
  scopeLabel: string;
  generatedBy: string;
  generatedAt: string;
  from: DateString;
  to: DateString;
  days: DateString[];
  totals: {
    hours: number;
    entries: number;
    members: number;
    membersWithNoEntries: number;
    tasksDone: number;
    blockedEntries: number;
    outcomes: number;
    outcomesUnverified: number;
  };
  members: MemberRow[];
  logs: LogRow[];
  tasks: TaskRow[];
  outcomes: OutcomeRow[];
}

/** Resolves which teams the report covers, and checks the caller may read them. */
async function resolveScope(user: AuthUser, params: WeeklyReportParams) {
  const scopesGiven = [params.accountId, params.projectId, params.teamId].filter(Boolean).length;
  if (scopesGiven > 1) {
    throw badRequest('Pass at most one of accountId, projectId or teamId');
  }

  if (params.accountId) {
    if (!(await canReadAccount(user, params.accountId))) throw notFound('Account not found');
    const account = await db.query.accounts.findFirst({ where: eq(accounts.id, params.accountId) });
    if (!account) throw notFound('Account not found');
    // A PM/Engineer reporting on a whole account gets only the teams they can see on it.
    const readable = await db
      .select({ id: teams.id })
      .from(teams)
      .innerJoin(projects, eq(projects.id, teams.projectId))
      .where(and(eq(projects.accountId, account.id), teamScope(user)));
    if (readable.length === 0) throw forbidden('You have no teams on this account to report on');
    return {
      teamIds: readable.map((t) => t.id),
      label: `Account: ${account.code} — ${account.name}`,
      slug: account.code,
    };
  }

  if (params.teamId) {
    if (!(await canReadTeam(user, params.teamId))) throw notFound('Team not found');
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, params.teamId),
      with: { project: { columns: { name: true, code: true } } },
    });
    if (!team) throw notFound('Team not found');
    return {
      teamIds: [team.id],
      label: team.project
        ? `Team: ${team.name} · ${team.project.code} — ${team.project.name}`
        : `Team: ${team.name} (not attached to a project)`,
      slug: team.name,
    };
  }

  if (params.projectId) {
    if (!(await canReadProject(user, params.projectId))) throw notFound('Project not found');
    const project = await db.query.projects.findFirst({ where: eq(projects.id, params.projectId) });
    if (!project) throw notFound('Project not found');
    // A PM exporting a whole project gets only the teams they can see on it.
    const readable = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.projectId, project.id), teamScope(user)));
    if (readable.length === 0) throw forbidden('You have no teams on this project to report on');
    return {
      teamIds: readable.map((t) => t.id),
      label: `Project: ${project.code} — ${project.name}`,
      slug: project.code,
    };
  }

  // No scope: everything the caller can see. Handy for a VP or Director export.
  const all = await db.select({ id: teams.id }).from(teams).where(teamScope(user));
  return { teamIds: all.map((t) => t.id), label: 'All visible teams', slug: 'all' };
}

const emptyMember = (base: Omit<MemberRow, keyof MemberStats>): MemberRow => ({
  ...base,
  hours: 0,
  entries: 0,
  daysLogged: 0,
  tasksTouched: 0,
  tasksOpen: 0,
  tasksDone: 0,
  blockedEntries: 0,
});
type MemberStats = Pick<
  MemberRow,
  'hours' | 'entries' | 'daysLogged' | 'tasksTouched' | 'tasksOpen' | 'tasksDone' | 'blockedEntries'
>;

export async function buildWeeklyReport(
  user: AuthUser,
  params: WeeklyReportParams
): Promise<WeeklyReport> {
  const { teamIds, label, slug } = await resolveScope(user, params);
  const anchor = params.week ?? today();
  const from = startOfWeek(anchor);
  const to = endOfWeek(anchor);

  const projectNameOf = (p?: { name: string; code: string } | null) =>
    p ? `${p.code} — ${p.name}` : 'Unassigned';

  if (teamIds.length === 0) {
    return {
      slug,
      title: 'Weekly Status Report',
      scopeLabel: label,
      generatedBy: `${user.name} (${user.role})`,
      generatedAt: new Date().toISOString(),
      from,
      to,
      days: Array.from({ length: 7 }, (_, i) => addDays(from, i)),
      totals: {
        hours: 0,
        entries: 0,
        members: 0,
        membersWithNoEntries: 0,
        tasksDone: 0,
        blockedEntries: 0,
        outcomes: 0,
        outcomesUnverified: 0,
      },
      members: [],
      logs: [],
      tasks: [],
      outcomes: [],
    };
  }

  const [taskRows, memberships, outcomeRows] = await Promise.all([
    db.query.tasks.findMany({
      where: inArray(tasks.teamId, teamIds),
      orderBy: [asc(tasks.status)],
      with: {
        assignee: { columns: { id: true, name: true, email: true } },
        team: {
          columns: { id: true, name: true },
          with: { project: { columns: { name: true, code: true } } },
        },
        workLogs: { columns: { hours: true, date: true } },
      },
    }),
    db.query.teamMembers.findMany({
      where: inArray(teamMembers.teamId, teamIds),
      with: {
        user: { columns: { id: true, name: true, email: true } },
        team: {
          columns: { id: true, name: true },
          with: { project: { columns: { name: true, code: true } } },
        },
      },
    }),
    db.query.outcomes.findMany({
      where: and(inArray(outcomes.teamId, teamIds), gte(outcomes.landedOn, from), lte(outcomes.landedOn, to)),
      orderBy: [asc(outcomes.landedOn)],
      with: {
        team: {
          columns: { id: true, name: true },
          with: { project: { columns: { name: true, code: true } } },
        },
        pm: { columns: { id: true, name: true } },
      },
    }),
  ]);

  const outcomeTable: OutcomeRow[] = outcomeRows.map((o) => ({
    id: o.id,
    landedOn: o.landedOn,
    title: o.title,
    narrative: o.narrative,
    category: o.category,
    teamName: o.team.name,
    projectName: projectNameOf(o.team.project),
    pmName: o.pm.name,
    verified: o.verifiedAt !== null,
  }));

  const taskIds = taskRows.map((t) => t.id);
  const logRowsRaw = taskIds.length
    ? await db.query.workLogs.findMany({
        where: and(inArray(workLogs.taskId, taskIds), gte(workLogs.date, from), lte(workLogs.date, to)),
        orderBy: [asc(workLogs.date)],
        with: {
          user: { columns: { id: true, name: true, email: true } },
          task: {
            columns: { id: true, title: true, status: true, teamId: true },
            with: {
              team: {
                columns: { id: true, name: true },
                with: { project: { columns: { name: true, code: true } } },
              },
            },
          },
        },
      })
    : [];

  // Every member of an in-scope team gets a row, even at zero hours — a blank
  // week is exactly what the PM and Director need to see.
  const members = new Map<string, MemberRow>();
  for (const m of memberships) {
    members.set(
      `${m.teamId}:${m.userId}`,
      emptyMember({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        teamName: m.team.name,
        projectName: projectNameOf(m.team.project),
      })
    );
  }

  const daysSeen = new Map<string, Set<string>>();
  const tasksSeen = new Map<string, Set<string>>();

  const logs: LogRow[] = logRowsRaw
    .map((l) => {
      const key = `${l.task.teamId}:${l.userId}`;
      if (!members.has(key)) {
        // Logged work, then left the team: keep the work visible in the report.
        members.set(
          key,
          emptyMember({
            userId: l.userId,
            name: l.user.name,
            email: l.user.email,
            teamName: l.task.team.name,
            projectName: projectNameOf(l.task.team.project),
          })
        );
      }
      const row = members.get(key)!;
      row.hours = Number((row.hours + l.hours).toFixed(2));
      row.entries += 1;
      if (l.status === 'BLOCKED') row.blockedEntries += 1;
      if (!daysSeen.has(key)) daysSeen.set(key, new Set());
      daysSeen.get(key)!.add(l.date);
      if (!tasksSeen.has(key)) tasksSeen.set(key, new Set());
      tasksSeen.get(key)!.add(l.taskId);

      return {
        date: l.date,
        projectName: projectNameOf(l.task.team.project),
        teamName: l.task.team.name,
        memberName: l.user.name,
        taskTitle: l.task.title,
        taskStatus: l.task.status,
        hours: l.hours,
        status: l.status,
        summary: l.summary,
        blockers: l.blockers ?? '',
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.teamName.localeCompare(b.teamName) ||
        a.memberName.localeCompare(b.memberName)
    );

  for (const [key, row] of members) {
    row.daysLogged = daysSeen.get(key)?.size ?? 0;
    row.tasksTouched = tasksSeen.get(key)?.size ?? 0;
  }

  const taskTable: TaskRow[] = taskRows.map((t) => {
    const row = members.get(`${t.teamId}:${t.assigneeId}`);
    if (row) {
      if (t.status === 'DONE') row.tasksDone += 1;
      else row.tasksOpen += 1;
    }
    return {
      projectName: projectNameOf(t.team.project),
      teamName: t.team.name,
      title: t.title,
      assignee: t.assignee.name,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate ?? '',
      hoursThisWeek: Number(
        t.workLogs
          .filter((w) => w.date >= from && w.date <= to)
          .reduce((s, w) => s + w.hours, 0)
          .toFixed(2)
      ),
      totalLoggedHours: Number(t.workLogs.reduce((s, w) => s + w.hours, 0).toFixed(2)),
    };
  });

  const memberRows = [...members.values()].sort(
    (a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      a.teamName.localeCompare(b.teamName) ||
      a.name.localeCompare(b.name)
  );

  return {
    slug,
    title: 'Weekly Status Report',
    scopeLabel: label,
    generatedBy: `${user.name} (${user.role})`,
    generatedAt: new Date().toISOString(),
    from,
    to,
    days: Array.from({ length: 7 }, (_, i) => addDays(from, i)),
    totals: {
      hours: Number(logs.reduce((s, l) => s + l.hours, 0).toFixed(2)),
      entries: logs.length,
      members: memberRows.length,
      membersWithNoEntries: memberRows.filter((m) => m.entries === 0).length,
      tasksDone: taskTable.filter((t) => t.status === 'DONE').length,
      blockedEntries: logs.filter((l) => l.status === 'BLOCKED').length,
      outcomes: outcomeTable.length,
      outcomesUnverified: outcomeTable.filter((o) => !o.verified).length,
    },
    members: memberRows,
    logs,
    tasks: taskTable,
    outcomes: outcomeTable,
  };
}

export function weeklyReportFilename(report: Pick<WeeklyReport, 'slug' | 'from' | 'to'>): string {
  const safeSlug = report.slug.replace(/[^A-Za-z0-9-_]+/g, '-').replace(/^-|-$/g, '') || 'report';
  return `weekly-status_${safeSlug}_${report.from}_to_${report.to}.xlsx`;
}

/** Teams, projects and accounts the caller may export, for the report picker. */
export async function reportScopeOptions(user: AuthUser) {
  const [teamRows, projectRows, accountRows] = await Promise.all([
    db.query.teams.findMany({
      where: teamScope(user),
      orderBy: [asc(teams.name)],
      with: { project: { columns: { id: true, name: true, code: true, accountId: true } } },
    }),
    db.query.projects.findMany({
      orderBy: [asc(projects.name)],
      columns: { id: true, name: true, code: true },
    }),
    db.query.accounts.findMany({
      orderBy: [asc(accounts.name)],
      columns: { id: true, name: true, code: true },
    }),
  ]);

  const leadershipRole = user.role === 'ADMIN' || user.role === 'VP' || user.role === 'DIRECTOR';
  const visibleProjectIds = new Set(teamRows.map((t) => t.projectId).filter(Boolean) as string[]);
  const visibleAccountIds = new Set(
    teamRows.map((t) => t.project?.accountId).filter(Boolean) as string[]
  );
  return {
    teams: teamRows.map((t) => ({
      id: t.id,
      name: t.name,
      projectName: t.project ? `${t.project.code} — ${t.project.name}` : null,
    })),
    projects: leadershipRole ? projectRows : projectRows.filter((p) => visibleProjectIds.has(p.id)),
    accounts: leadershipRole ? accountRows : accountRows.filter((a) => visibleAccountIds.has(a.id)),
  };
}
