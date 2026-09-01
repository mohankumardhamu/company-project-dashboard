import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createId } from './id';

export const roleEnum = pgEnum('role', ['ADMIN', 'VP', 'DIRECTOR', 'PM', 'ENGINEER']);
export const projectStatusEnum = pgEnum('project_status', ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED']);
export const taskStatusEnum = pgEnum('task_status', ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']);
export const taskPriorityEnum = pgEnum('task_priority', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const workLogStatusEnum = pgEnum('work_log_status', ['ON_TRACK', 'AT_RISK', 'BLOCKED', 'COMPLETED']);

export type Role = (typeof roleEnum.enumValues)[number];
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type WorkLogStatus = (typeof workLogStatusEnum.enumValues)[number];

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex('projects_code_key').on(t.code),
    directorIdx: index('projects_director_idx').on(t.directorId),
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
  },
  (t) => ({
    teamIdx: index('tasks_team_idx').on(t.teamId),
    assigneeIdx: index('tasks_assignee_idx').on(t.assigneeId),
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

/* ------------------------------- relations ------------------------------- */

export const usersRelations = relations(users, ({ many }) => ({
  ownedProjects: many(projects),
  ledTeams: many(teams),
  memberships: many(teamMembers),
  assignedTasks: many(tasks, { relationName: 'taskAssignee' }),
  createdTasks: many(tasks, { relationName: 'taskCreatedBy' }),
  workLogs: many(workLogs),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  director: one(users, { fields: [projects.directorId], references: [users.id] }),
  teams: many(teams),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  pm: one(users, { fields: [teams.pmId], references: [users.id] }),
  project: one(projects, { fields: [teams.projectId], references: [projects.id] }),
  members: many(teamMembers),
  tasks: many(tasks),
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
}));

export const workLogsRelations = relations(workLogs, ({ one }) => ({
  task: one(tasks, { fields: [workLogs.taskId], references: [tasks.id] }),
  user: one(users, { fields: [workLogs.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type WorkLog = typeof workLogs.$inferSelect;
