import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { addDays, today } from '../dates';
import { db, pool } from './index';
import {
  accounts,
  outcomeTasks,
  outcomes,
  projects,
  taskPriorityEnum,
  taskStatusEnum,
  tasks,
  teamMembers,
  teams,
  users,
  workLogStatusEnum,
  workLogs,
  type OutcomeCategory,
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
  await db.delete(outcomeTasks);
  await db.delete(outcomes);
  await db.delete(workLogs);
  await db.delete(tasks);
  await db.delete(teamMembers);
  await db.delete(teams);
  await db.delete(projects);
  await db.delete(accounts);
  await db.delete(users);

  const mk = (email: string, name: string, role: Role, createdById?: string) => ({
    email,
    name,
    role,
    passwordHash,
    createdById: createdById ?? null,
  });

  const [admin] = await db
    .insert(users)
    .values(mk(process.env.SEED_ADMIN_EMAIL ?? 'admin@acme.com', 'System Admin', 'ADMIN'))
    .returning();

  const [vp] = await db
    .insert(users)
    .values(mk(process.env.SEED_VP_EMAIL ?? 'vp@acme.com', 'Priya Raghavan', 'VP', admin.id))
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

  const [acme, globex] = await db
    .insert(accounts)
    .values([
      { name: 'Acme Payments', code: 'ACME', status: 'ACTIVE' as const, ownerDirectorId: dirEng.id },
      { name: 'Globex Systems', code: 'GLOBEX', status: 'ACTIVE' as const, ownerDirectorId: dirPlat.id },
    ])
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
        accountId: acme.id,
        startDate: '2026-04-01',
        endDate: '2026-12-31',
      },
      {
        name: 'Helios Infrastructure Modernisation',
        code: 'HELIOS',
        description: 'Docker Swarm to Kubernetes migration and observability rollout.',
        status: 'ACTIVE' as const,
        directorId: dirPlat.id,
        accountId: globex.id,
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
  const findTask = (title: string) => createdTasks.find((t) => t.title === title);

  const outcomeSeeds: Array<{
    teamId: string;
    pmId: string;
    title: string;
    category: OutcomeCategory;
    daysAgo: number;
    narrative: string;
    verifiedBy?: string;
    linkTitles?: string[];
  }> = [
    {
      teamId: teamCore.id,
      pmId: pmPay.id,
      title: 'Enabled UPI AutoPay for recurring merchants',
      category: 'REVENUE_ENABLED',
      daysAgo: 10,
      narrative:
        'Shipped mandate-based UPI AutoPay so merchants can bill recurring subscriptions without a manual retry every cycle — unblocked three merchants who had paused onboarding waiting on this.',
      verifiedBy: dirEng.id,
    },
    {
      teamId: teamCore.id,
      pmId: pmPay.id,
      title: 'Closed a duplicate-payout risk in settlement reconciliation',
      category: 'RISK_REDUCED',
      daysAgo: 0,
      narrative:
        'Found and fixed a reconciliation gap that could double-pay a merchant on a retried UPI callback. Backfilled three weeks of history to confirm no merchant had actually been affected.',
      linkTitles: ['Reconciliation job for failed UPI callbacks'],
    },
    {
      teamId: teamMobile.id,
      pmId: pmMob.id,
      title: 'Shipped biometric confirmation on checkout',
      category: 'CUSTOMER_VISIBLE',
      daysAgo: 7,
      narrative:
        'Face/fingerprint confirmation replaces the OTP step on supported devices — checkout is now two taps instead of five, and drop-off at the confirmation screen is visibly down.',
      verifiedBy: dirEng.id,
    },
    {
      teamId: teamMobile.id,
      pmId: pmMob.id,
      title: 'Retry flow recovered failed transactions',
      category: 'REVENUE_ENABLED',
      daysAgo: 14,
      narrative:
        'Declined transactions now get one automatic retry with a different rail before we tell the user it failed — recovering a meaningful slice of card declines that used to be lost sales.',
    },
    {
      teamId: teamInfra.id,
      pmId: pmInfra.id,
      title: 'Payments workloads running on the new Kubernetes cluster',
      category: 'CAPABILITY_BUILT',
      daysAgo: 9,
      narrative:
        'Helm charts and namespace isolation are live for the payments workloads — this is the foundation the rest of the Helios migration builds on, not itself client-visible yet.',
      verifiedBy: dirPlat.id,
      linkTitles: ['Helm charts for the payments namespace'],
    },
    {
      teamId: teamInfra.id,
      pmId: pmInfra.id,
      title: 'Rightsized cluster autoscaling',
      category: 'COST_SAVED',
      daysAgo: 0,
      narrative:
        'Tuned the horizontal pod autoscaler thresholds after two weeks of real traffic data — cut idle compute overnight and on weekends without touching peak-hour capacity.',
    },
    {
      teamId: teamInfra.id,
      pmId: pmInfra.id,
      title: 'Closed the long-lived-secrets audit finding',
      category: 'RISK_REDUCED',
      daysAgo: 16,
      narrative:
        "Rotated every long-lived credential onto the Vault CSI driver with automatic rotation. This was the last open item from last quarter's security audit.",
      verifiedBy: dirPlat.id,
    },
    {
      teamId: teamData.id,
      pmId: pmPay.id,
      title: 'Drafted the weekly reporting schema',
      category: 'CAPABILITY_BUILT',
      daysAgo: 0,
      narrative:
        'First pass at the data model the weekly reporting pipeline will run on — still unattached to a project, but this is the groundwork before that team has a client to report against.',
    },
  ];

  for (const o of outcomeSeeds) {
    const [row] = await db
      .insert(outcomes)
      .values({
        teamId: o.teamId,
        pmId: o.pmId,
        title: o.title,
        category: o.category,
        landedOn: addDays(today(), -o.daysAgo),
        narrative: o.narrative,
        verifiedById: o.verifiedBy ?? null,
        verifiedAt: o.verifiedBy ? new Date() : null,
      })
      .returning();

    const linkedTasks = (o.linkTitles ?? []).map(findTask).filter((t): t is NonNullable<typeof t> => Boolean(t));
    if (linkedTasks.length) {
      await db.insert(outcomeTasks).values(linkedTasks.map((t) => ({ outcomeId: row.id, taskId: t.id })));
    }
  }

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
    `Seeded 2 accounts, 2 projects, 4 teams, ${engineers.length + 7} users, ${createdTasks.length} tasks, ${logValues.length} work logs, ${outcomeSeeds.length} outcomes.`
  );
  console.log(`\nEvery account uses the password: ${PASSWORD}\n`);
  console.table([
    { role: 'ADMIN', email: admin.email, sees: 'everything, onboards anyone' },
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
