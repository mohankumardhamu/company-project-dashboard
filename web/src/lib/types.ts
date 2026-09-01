export type Role = 'ADMIN' | 'VP' | 'DIRECTOR' | 'PM' | 'ENGINEER';
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type WorkLogStatus = 'ON_TRACK' | 'AT_RISK' | 'BLOCKED' | 'COMPLETED';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface DirectoryUser extends AuthUser {
  active: boolean;
  createdAt: string;
}

export interface PersonRef {
  id: string;
  name: string;
  email?: string;
  role?: Role;
}

export interface ProjectRef {
  id: string;
  name: string;
  code: string;
  status?: ProjectStatus;
}

export interface ProjectSummary {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  directorId: string;
  director: PersonRef;
  teamCount: number;
  memberCount: number;
  taskCount: number;
  canManage: boolean;
}

export interface TeamMemberRow {
  id: string;
  userId: string;
  joinedAt: string;
  user: PersonRef;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  teamId: string;
  assigneeId: string;
  assignee: PersonRef;
  createdAt: string;
}

export interface TaskWithContext extends TaskRow {
  team: { id: string; name: string; pmId: string; project: ProjectRef | null };
  logCount: number;
  loggedHours: number;
  canManage: boolean;
}

export interface TeamSummary {
  id: string;
  name: string;
  description: string | null;
  pmId: string;
  projectId: string | null;
  pm: PersonRef;
  project: ProjectRef | null;
  memberCount: number;
  taskCount: number;
  openTaskCount: number;
  canManage: boolean;
}

export interface TeamDetail {
  id: string;
  name: string;
  description: string | null;
  pmId: string;
  projectId: string | null;
  pm: PersonRef;
  project: ProjectRef | null;
  members: TeamMemberRow[];
  tasks: TaskRow[];
  canManage: boolean;
}

export interface ProjectDetail {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  directorId: string;
  director: PersonRef;
  canManage: boolean;
  teams: Array<{
    id: string;
    name: string;
    description: string | null;
    pmId: string;
    pm: PersonRef;
    members: TeamMemberRow[];
    tasks: TaskRow[];
  }>;
}

export interface AttachableTeam {
  id: string;
  name: string;
  description: string | null;
  projectId: string | null;
  pm: PersonRef;
  memberCount: number;
  attached: boolean;
}

export interface WorkLogRow {
  id: string;
  date: string;
  hours: number;
  summary: string;
  blockers: string | null;
  status: WorkLogStatus;
  taskId: string;
  userId: string;
  user?: PersonRef;
  task?: {
    id: string;
    title: string;
    status: TaskStatus;
    team: { id: string; name: string; project: ProjectRef | null };
  };
}

export interface Overview {
  scope: Role;
  week: { from: string; to: string };
  totals: {
    projects: number;
    teams: number;
    members: number;
    tasks: { total: number; todo: number; inProgress: number; blocked: number; done: number };
    thisWeek: { hours: number; entries: number; contributors: number; blocked: number };
  };
  projects: Array<{
    id: string;
    name: string;
    code: string;
    status: ProjectStatus;
    director: PersonRef;
    teams: Array<{
      id: string;
      name: string;
      pm: PersonRef;
      memberCount: number;
      taskCount: number;
      openTaskCount: number;
    }>;
  }>;
}

export interface ReportMemberRow {
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

export interface WeeklyReport {
  slug: string;
  title: string;
  scopeLabel: string;
  generatedBy: string;
  generatedAt: string;
  from: string;
  to: string;
  days: string[];
  totals: {
    hours: number;
    entries: number;
    members: number;
    membersWithNoEntries: number;
    tasksDone: number;
    blockedEntries: number;
  };
  members: ReportMemberRow[];
  logs: Array<{
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
  }>;
  tasks: Array<{
    projectName: string;
    teamName: string;
    title: string;
    assignee: string;
    status: string;
    priority: string;
    dueDate: string;
    hoursThisWeek: number;
    totalLoggedHours: number;
  }>;
}

export interface ReportScopes {
  teams: Array<{ id: string; name: string; projectName: string | null }>;
  projects: Array<{ id: string; name: string; code: string }>;
}
