import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createId } from './id';

/** Postgres tsvector has no built-in drizzle column type. */
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const roleEnum = pgEnum('role', ['ADMIN', 'VP', 'DIRECTOR', 'PM', 'ENGINEER']);
export const accountStatusEnum = pgEnum('account_status', ['ACTIVE', 'INACTIVE']);
export const projectStatusEnum = pgEnum('project_status', ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED']);
export const taskStatusEnum = pgEnum('task_status', ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']);
export const taskPriorityEnum = pgEnum('task_priority', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const workLogStatusEnum = pgEnum('work_log_status', ['ON_TRACK', 'AT_RISK', 'BLOCKED', 'COMPLETED']);
export const outcomeCategoryEnum = pgEnum('outcome_category', [
  'REVENUE_ENABLED',
  'COST_SAVED',
  'RISK_REDUCED',
  'CAPABILITY_BUILT',
  'CUSTOMER_VISIBLE',
]);

export const importSourceEnum = pgEnum('import_source', ['RALLY', 'KEKA']);

export type Role = (typeof roleEnum.enumValues)[number];
export type AccountStatus = (typeof accountStatusEnum.enumValues)[number];
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type WorkLogStatus = (typeof workLogStatusEnum.enumValues)[number];
export type OutcomeCategory = (typeof outcomeCategoryEnum.enumValues)[number];
export type ImportSource = (typeof importSourceEnum.enumValues)[number];

const id = () =>
  varchar('id', { length: 30 })
    .primaryKey()
    .$defaultFn(() => createId());

export const users = pgTable(
  'users',
  {
    id: id(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: roleEnum('role').notNull(),
    active: boolean('active').notNull().default(true),
    createdById: varchar('created_by_id', { length: 30 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_key').on(t.email),
    roleIdx: index('users_role_idx').on(t.role),
  })
);

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    code: varchar('code', { length: 24 }).notNull(),
    status: accountStatusEnum('status').notNull().default('ACTIVE'),
    // Relationship owner, not an access gate — an account may exist before a
    // Director claims it, so this stays nullable.
    ownerDirectorId: varchar('owner_director_id', { length: 30 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex('accounts_code_key').on(t.code),
    ownerIdx: index('accounts_owner_idx').on(t.ownerDirectorId),
  })
);

export const projects = pgTable(
  'projects',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    code: varchar('code', { length: 24 }).notNull(),
    description: text('description'),
    status: projectStatusEnum('status').notNull().default('ACTIVE'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    directorId: varchar('director_id', { length: 30 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // Nullable like teams.projectId below: a project can exist before a client
    // account is attached to it.
    accountId: varchar('account_id', { length: 30 }).references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex('projects_code_key').on(t.code),
    directorIdx: index('projects_director_idx').on(t.directorId),
    accountIdx: index('projects_account_idx').on(t.accountId),
  })
);

export const teams = pgTable(
  'teams',
  {
    id: id(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    // Created by a PM, who leads it. A Director later attaches it to a project.
    pmId: varchar('pm_id', { length: 30 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    projectId: varchar('project_id', { length: 30 }).references(() => projects.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pmNameIdx: uniqueIndex('teams_pm_name_key').on(t.pmId, t.name),
    projectIdx: index('teams_project_idx').on(t.projectId),
  })
);

export const teamMembers = pgTable(
  'team_members',
  {
    id: id(),
    teamId: varchar('team_id', { length: 30 })
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 30 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamUserIdx: uniqueIndex('team_members_team_user_key').on(t.teamId, t.userId),
    userIdx: index('team_members_user_idx').on(t.userId),
  })
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('TODO'),
    priority: taskPriorityEnum('priority').notNull().default('MEDIUM'),
    dueDate: date('due_date'),
    teamId: varchar('team_id', { length: 30 })
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    assigneeId: varchar('assignee_id', { length: 30 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdById: varchar('created_by_id', { length: 30 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Postgres maintains this automatically on every insert/update — the
    // register's search never has to remember to keep it in sync.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(description, ''))`
    ),
  },
  (t) => ({
    teamIdx: index('tasks_team_idx').on(t.teamId),
    assigneeIdx: index('tasks_assignee_idx').on(t.assigneeId),
    searchIdx: index('tasks_search_idx').using('gin', t.searchVector),
  })
);

export const workLogs = pgTable(
  'work_logs',
  {
    id: id(),
    date: date('date').notNull(),
    hours: doublePrecision('hours').notNull(),
    summary: text('summary').notNull(),
    blockers: text('blockers'),
    status: workLogStatusEnum('status').notNull().default('ON_TRACK'),
    taskId: varchar('task_id', { length: 30 })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 30 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One entry per person, per task, per day — re-submitting updates it.
    uniqueEntry: uniqueIndex('work_logs_task_user_date_key').on(t.taskId, t.userId, t.date),
    userDateIdx: index('work_logs_user_date_idx').on(t.userId, t.date),
    dateIdx: index('work_logs_date_idx').on(t.date),
  })
);

export const outcomes = pgTable(
  'outcomes',
  {
    id: id(),
    title: varchar('title', { length: 200 }).notNull(),
    landedOn: date('landed_on').notNull(),
    narrative: text('narrative').notNull(),
    category: outcomeCategoryEnum('category').notNull(),
    teamId: varchar('team_id', { length: 30 })
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    // The PM accountable for this record — not necessarily who did the work.
    pmId: varchar('pm_id', { length: 30 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // A trust signal, not a gate: an outcome is real and counted the moment a
    // PM files it. Verification just lets a Director stamp it confirmed.
    verifiedById: varchar('verified_by_id', { length: 30 }).references(() => users.id, { onDelete: 'set null' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Postgres maintains this automatically on every insert/update — the
    // register's search never has to remember to keep it in sync. category
    // is deliberately not part of the vector: casting a user-defined enum to
    // text isn't IMMUTABLE (Postgres won't allow it in a generated column,
    // since the enum's label set could change), and the register already has
    // a dedicated category filter — free text is for title/narrative prose.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(narrative, ''))`
    ),
  },
  (t) => ({
    teamIdx: index('outcomes_team_idx').on(t.teamId),
    landedOnIdx: index('outcomes_landed_on_idx').on(t.landedOn),
    searchIdx: index('outcomes_search_idx').using('gin', t.searchVector),
  })
);

// Optional citation of the tasks an outcome traces back to — never required.
export const outcomeTasks = pgTable(
  'outcome_tasks',
  {
    id: id(),
    outcomeId: varchar('outcome_id', { length: 30 })
      .notNull()
      .references(() => outcomes.id, { onDelete: 'cascade' }),
    taskId: varchar('task_id', { length: 30 })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    outcomeTaskIdx: uniqueIndex('outcome_tasks_outcome_task_key').on(t.outcomeId, t.taskId),
    taskIdx: index('outcome_tasks_task_idx').on(t.taskId),
  })
);

/* -------------------------------- imports -------------------------------- *
 * Rally and Keka data arrives as uploaded spreadsheets rather than being typed
 * in, so nothing gets missed. Each upload is an import_batches row; the rows it
 * produced point back at it.
 */

export const importBatches = pgTable(
  'import_batches',
  {
    id: id(),
    source: importSourceEnum('source').notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    // Rally only: the bi-weekly period (its first Monday) the uploader said the sheet covers.
    periodStart: date('period_start'),
    uploadedById: varchar('uploaded_by_id', { length: 30 })
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    totalRows: integer('total_rows').notNull(),
    importedRows: integer('imported_rows').notNull(),
    skippedRows: integer('skipped_rows').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceCreatedIdx: index('import_batches_source_created_idx').on(t.source, t.createdAt),
  })
);

/**
 * One Rally work product (story/defect) for one person in one bi-weekly
 * period, exactly as the export reported it. Re-uploading the same sheet for
 * the same period updates these rows rather than adding new ones, so
 * productivity numbers never double-count.
 */
export const rallyItems = pgTable(
  'rally_items',
  {
    id: id(),
    periodStart: date('period_start').notNull(),
    workProduct: varchar('work_product', { length: 400 }).notNull(),
    release: varchar('release', { length: 160 }),
    state: varchar('state', { length: 60 }).notNull(),
    estimate: doublePrecision('estimate').notNull().default(0), // story points
    todo: doublePrecision('todo').notNull().default(0), // hours remaining
    timeSpent: doublePrecision('time_spent').notNull().default(0), // hours
    ownerRaw: varchar('owner_raw', { length: 255 }).notNull(),
    userId: varchar('user_id', { length: 30 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    batchId: varchar('batch_id', { length: 30 }).references(() => importBatches.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueItem: uniqueIndex('rally_items_user_period_item_key').on(t.userId, t.periodStart, t.workProduct),
    periodIdx: index('rally_items_period_idx').on(t.periodStart),
  })
);

/**
 * The org directory as Keka exports it. Keyed by Employee Number; linked to a
 * login (users row) by display name where one exists. People without a login
 * still appear here — an Admin onboards them when they need to sign in.
 */
export const kekaEmployees = pgTable(
  'keka_employees',
  {
    id: id(),
    employeeNumber: varchar('employee_number', { length: 40 }).notNull(),
    displayName: varchar('display_name', { length: 160 }).notNull(),
    jobTitle: varchar('job_title', { length: 160 }),
    department: varchar('department', { length: 160 }),
    location: varchar('location', { length: 160 }),
    reporteesCount: integer('reportees_count').notNull().default(0),
    userId: varchar('user_id', { length: 30 }).references(() => users.id, { onDelete: 'set null' }),
    batchId: varchar('batch_id', { length: 30 }).references(() => importBatches.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeNumberIdx: uniqueIndex('keka_employees_employee_number_key').on(t.employeeNumber),
    userIdx: index('keka_employees_user_idx').on(t.userId),
  })
);

/* ------------------------------- relations ------------------------------- */

export const usersRelations = relations(users, ({ many }) => ({
  ownedAccounts: many(accounts),
  ownedProjects: many(projects),
  ledTeams: many(teams),
  memberships: many(teamMembers),
  assignedTasks: many(tasks, { relationName: 'taskAssignee' }),
  createdTasks: many(tasks, { relationName: 'taskCreatedBy' }),
  workLogs: many(workLogs),
  filedOutcomes: many(outcomes, { relationName: 'outcomePm' }),
  verifiedOutcomes: many(outcomes, { relationName: 'outcomeVerifier' }),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  ownerDirector: one(users, { fields: [accounts.ownerDirectorId], references: [users.id] }),
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  director: one(users, { fields: [projects.directorId], references: [users.id] }),
  account: one(accounts, { fields: [projects.accountId], references: [accounts.id] }),
  teams: many(teams),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  pm: one(users, { fields: [teams.pmId], references: [users.id] }),
  project: one(projects, { fields: [teams.projectId], references: [projects.id] }),
  members: many(teamMembers),
  tasks: many(tasks),
  outcomes: many(outcomes),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  team: one(teams, { fields: [tasks.teamId], references: [teams.id] }),
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.id],
    relationName: 'taskAssignee',
  }),
  createdBy: one(users, {
    fields: [tasks.createdById],
    references: [users.id],
    relationName: 'taskCreatedBy',
  }),
  workLogs: many(workLogs),
  outcomeLinks: many(outcomeTasks),
}));

export const workLogsRelations = relations(workLogs, ({ one }) => ({
  task: one(tasks, { fields: [workLogs.taskId], references: [tasks.id] }),
  user: one(users, { fields: [workLogs.userId], references: [users.id] }),
}));

export const outcomesRelations = relations(outcomes, ({ one, many }) => ({
  team: one(teams, { fields: [outcomes.teamId], references: [teams.id] }),
  pm: one(users, { fields: [outcomes.pmId], references: [users.id], relationName: 'outcomePm' }),
  verifiedBy: one(users, {
    fields: [outcomes.verifiedById],
    references: [users.id],
    relationName: 'outcomeVerifier',
  }),
  tasks: many(outcomeTasks),
}));

export const importBatchesRelations = relations(importBatches, ({ one }) => ({
  uploadedBy: one(users, { fields: [importBatches.uploadedById], references: [users.id] }),
}));

export const rallyItemsRelations = relations(rallyItems, ({ one }) => ({
  user: one(users, { fields: [rallyItems.userId], references: [users.id] }),
  batch: one(importBatches, { fields: [rallyItems.batchId], references: [importBatches.id] }),
}));

export const kekaEmployeesRelations = relations(kekaEmployees, ({ one }) => ({
  user: one(users, { fields: [kekaEmployees.userId], references: [users.id] }),
}));

export const outcomeTasksRelations = relations(outcomeTasks, ({ one }) => ({
  outcome: one(outcomes, { fields: [outcomeTasks.outcomeId], references: [outcomes.id] }),
  task: one(tasks, { fields: [outcomeTasks.taskId], references: [tasks.id] }),
}));

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type WorkLog = typeof workLogs.$inferSelect;
export type Outcome = typeof outcomes.$inferSelect;
export type OutcomeTask = typeof outcomeTasks.$inferSelect;
export type ImportBatch = typeof importBatches.$inferSelect;
export type RallyItem = typeof rallyItems.$inferSelect;
export type KekaEmployee = typeof kekaEmployees.$inferSelect;
