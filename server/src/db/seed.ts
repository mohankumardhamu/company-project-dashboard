import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { addDays, today } from '../dates';
import { db, pool } from './index';
import {
  projects,
  taskPriorityEnum,
  taskStatusEnum,
  tasks,
  teamMembers,
  teams,
  users,
  workLogStatusEnum,
  workLogs,
  type Role,
  type TaskPriority,
  type TaskStatus,
  type WorkLogStatus,
} from './schema';

const PASSWORD = process.env.SEED_VP_PASSWORD ?? 'Passw0rd!';

/** Deterministic pseudo-random, so re-seeding gives the same demo data. */
let seedState = 42;
const rand = () => {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
};
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];

async function main() {
  console.log('Seeding…');
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // Order matters for foreign keys.
  await db.delete(workLogs);
  await db.delete(tasks);
  await db.delete(teamMembers);
  await db.delete(teams);
  await db.delete(projects);
  await db.delete(users);

  const mk = (email: string, name: string, role: Role, createdById?: string) => ({
    email,
    name,
    role,
    passwordHash,
    createdById: createdById ?? null,
  });

  const [vp] = await db
    .insert(users)
    .values(mk(process.env.SEED_VP_EMAIL ?? 'vp@acme.com', 'Priya Raghavan', 'VP'))
    .returning();

  const [dirEng, dirPlat] = await db
    .insert(users)
    .values([
      mk('director.eng@acme.com', 'Arun Balakrishnan', 'DIRECTOR', vp.id),
      mk('director.platform@acme.com', 'Meera Iyer', 'DIRECTOR', vp.id),
    ])
    .returning();

  const [pmPay, pmMob, pmInfra] = await db
    .insert(users)
    .values([
      mk('pm.payments@acme.com', 'Karthik Subramanian', 'PM', dirEng.id),
      mk('pm.mobile@acme.com', 'Divya Menon', 'PM', dirEng.id),
      mk('pm.infra@acme.com', 'Rahul Nair', 'PM', dirPlat.id),
    ])
    .returning();

  const engineers = await db
    .insert(users)
    .values(
      (
        [
          ['eng.anita@acme.com', 'Anita Deshpande'],
          ['eng.vikram@acme.com', 'Vikram Rao'],
          ['eng.sneha@acme.com', 'Sneha Kulkarni'],
          ['eng.joseph@acme.com', 'Joseph Mathew'],
          ['eng.fatima@acme.com', 'Fatima Sheikh'],
          ['eng.ganesh@acme.com', 'Ganesh Pillai'],
          ['eng.lakshmi@acme.com', 'Lakshmi Venkat'],
          ['eng.tarun@acme.com', 'Tarun Gupta'],
          ['eng.nisha@acme.com', 'Nisha Bhatt'],
        ] as const
      ).map(([email, name]) => mk(email, name, 'ENGINEER', dirEng.id))
    )
    .returning();

  const [apex, helios] = await db
    .insert(projects)
    .values([
      {
        name: 'Apex Payments Platform',
        code: 'APEX',
        description: 'Card and UPI payment rails consolidation, phase 2.',
        status: 'ACTIVE' as const,
        directorId: dirEng.id,
        startDate: '2026-04-01',
        endDate: '2026-12-31',
      },
      {
        name: 'Helios Infrastructure Modernisation',
        code: 'HELIOS',
        description: 'Docker Swarm to Kubernetes migration and observability rollout.',
        status: 'ACTIVE' as const,
        directorId: dirPlat.id,
        startDate: '2026-06-01',
      },
    ])
    .returning();

  const [teamCore, teamMobile, teamInfra, teamData] = await db
    .insert(teams)
    .values([
      { name: 'Payments Core', description: 'Ledger and settlement services', pmId: pmPay.id, projectId: apex.id },
      { name: 'Mobile Checkout', description: 'Android/iOS checkout SDK', pmId: pmMob.id, projectId: apex.id },
      { name: 'Platform SRE', description: 'Cluster migration and CI/CD', pmId: pmInfra.id, projectId: helios.id },
      // Left unattached on purpose, so a Director has something to attach.
      { name: 'Data Enablement', description: 'Reporting pipelines — awaiting a project', pmId: pmPay.id },
    ])
    .returning();

  const rosters: Array<{ teamId: string; pmId: string; members: typeof engineers }> = [
    { teamId: teamCore.id, pmId: pmPay.id, members: engineers.slice(0, 3) },
    { teamId: teamMobile.id, pmId: pmMob.id, members: engineers.slice(3, 6) },
    { teamId: teamInfra.id, pmId: pmInfra.id, members: engineers.slice(6, 9) },
    { teamId: teamData.id, pmId: pmPay.id, members: engineers.slice(0, 2) },
  ];
  await db.insert(teamMembers).values(
    rosters.flatMap((r) => r.members.map((m) => ({ teamId: r.teamId, userId: m.id })))
  );

  const titlesByTeam: Record<string, string[]> = {
    [teamCore.id]: [
      'Idempotency keys for the settlement API',
      'Reconciliation job for failed UPI callbacks',
      'Move ledger writes behind a feature flag',
      'Load test settlement at 5k TPS',
    ],
    [teamMobile.id]: [
      'Android checkout SDK v3 migration',
      'iOS biometric confirmation flow',
      'Retry UX for declined transactions',
    ],
    [teamInfra.id]: [
      'Helm charts for the payments namespace',
      'Prometheus and Grafana dashboards for cluster health',
      'Jenkins pipeline templates for Kubernetes deploys',
      'Vault secret injection via the CSI driver',
    ],
    [teamData.id]: ['Draft the weekly reporting schema'],
  };

  const statuses: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_PROGRESS', 'BLOCKED', 'DONE'];
  const priorities: TaskPriority[] = [...taskPriorityEnum.enumValues];

  const taskValues = rosters.flatMap((r) =>
    (titlesByTeam[r.teamId] ?? []).map((title, i) => ({
      title,
      description: `${title}. Tracked for the current delivery increment.`,
      teamId: r.teamId,
      assigneeId: r.members[i % r.members.length].id,
      createdById: r.pmId,
      status: pick(statuses),
      priority: pick(priorities),
      dueDate: addDays(today(), Math.floor(rand() * 30) - 5),
    }))
  );
  const createdTasks = await db.insert(tasks).values(taskValues).returning();

  const notes = [
    'Implemented the happy path and covered it with unit tests.',
    'Paired on the review comments and pushed a follow-up commit.',
    'Debugged an intermittent failure in the integration suite.',
    'Wrote the migration script and dry-ran it against staging.',
    'Refactored the service boundary to remove a circular dependency.',
    'Updated the runbook and added the new alert thresholds.',
    'Investigated a timeout under load; profiling points at connection pooling.',
  ];
  const blockerNotes = [
    'Waiting on a staging credential from the platform team.',
    'Blocked on an upstream API change that has not shipped yet.',
    'Needs a decision on the retention policy before I can continue.',
  ];
  const okStatuses: WorkLogStatus[] = ['ON_TRACK', 'ON_TRACK', 'AT_RISK', 'COMPLETED'];

  // Three weeks of weekday entries so "this week" and "last week" both export.
  const logValues: Array<typeof workLogs.$inferInsert> = [];
  for (let back = 20; back >= 0; back -= 1) {
    const day = addDays(today(), -back);
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;

    for (const task of createdTasks) {
      if (rand() > 0.5) continue; // not everyone logs on every task every day
      const blocked = rand() > 0.88;
      logValues.push({
        taskId: task.id,
        userId: task.assigneeId,
        date: day,
        hours: Number((1 + rand() * 5).toFixed(2)),
        summary: pick(notes),
        blockers: blocked ? pick(blockerNotes) : null,
        status: blocked ? ('BLOCKED' as const) : pick(okStatuses),
      });
    }
  }
  if (logValues.length) {
    await db.insert(workLogs).values(logValues).onConflictDoNothing();
  }

  console.log(
    `Seeded 2 projects, 4 teams, ${engineers.length + 6} users, ${createdTasks.length} tasks, ${logValues.length} work logs.`
  );
  console.log(`\nEvery account uses the password: ${PASSWORD}\n`);
  console.table([
    { role: 'VP', email: vp.email, sees: 'everything' },
    { role: 'DIRECTOR', email: dirEng.email, sees: 'owns APEX' },
    { role: 'DIRECTOR', email: dirPlat.email, sees: 'owns HELIOS' },
    { role: 'PM', email: pmPay.email, sees: 'Payments Core, Data Enablement' },
    { role: 'PM', email: pmMob.email, sees: 'Mobile Checkout' },
    { role: 'PM', email: pmInfra.email, sees: 'Platform SRE' },
    { role: 'ENGINEER', email: engineers[0].email, sees: 'own tasks and logs' },
  ]);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
