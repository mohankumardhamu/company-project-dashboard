export type Role = 'ADMIN' | 'VP' | 'DIRECTOR' | 'PM' | 'ENGINEER';
export type AccountStatus = 'ACTIVE' | 'INACTIVE';
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type WorkLogStatus = 'ON_TRACK' | 'AT_RISK' | 'BLOCKED' | 'COMPLETED';
export type OutcomeCategory = 'REVENUE_ENABLED' | 'COST_SAVED' | 'RISK_REDUCED' | 'CAPABILITY_BUILT' | 'CUSTOMER_VISIBLE';

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

export interface AccountRef {
  id: string;
  name: string;
  code: string;
}

export interface AccountSummary {
  id: string;
  name: string;
  code: string;
  status: AccountStatus;
  ownerDirectorId: string | null;
  ownerDirector: PersonRef | null;
  projectCount: number;
  teamCount: number;
  memberCount: number;
  taskCount: number;
  canManage: boolean;
}

export interface AccountDetail {
  id: string;
  name: string;
  code: string;
  status: AccountStatus;
  ownerDirectorId: string | null;
  ownerDirector: PersonRef | null;
  canManage: boolean;
  projects: Array<{
    id: string;
    name: string;
    code: string;
    status: ProjectStatus;
    director: PersonRef;
    teamCount: number;
    memberCount: number;
    taskCount: number;
    openTaskCount: number;
  }>;
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
  account: AccountRef | null;
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
  account: AccountRef | null;
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

export interface OutcomeSummary {
  id: string;
  title: string;
  landedOn: string;
  narrative: string;
  category: OutcomeCategory;
  teamId: string;
  team: { id: string; name: string };
  project: ProjectRef | null;
  account: AccountRef | null;
  pmId: string;
  pm: PersonRef;
  verifiedById: string | null;
  verifiedBy: PersonRef | null;
  verifiedAt: string | null;
  linkedTasks: Array<{ id: string; title: string }>;
  canManage: boolean;
  canVerify: boolean;
}

export interface DigestPreviewItem {
  scope: 'team' | 'account';
  id: string;
  label: string;
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
}

export interface DigestPreview {
  period: { from: string; to: string };
  items: DigestPreviewItem[];
}

export interface Overview {
  scope: Role;
  period: { from: string; to: string };
  totals: {
    projects: number;
    teams: number;
    members: number;
    tasks: { total: number; todo: number; inProgress: number; blocked: number; done: number };
    thisPeriod: { hours: number; entries: number; contributors: number; blocked: number };
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

export interface PeriodReport {
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
    outcomes: number;
    outcomesUnverified: number;
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
    hoursThisPeriod: number;
    totalLoggedHours: number;
  }>;
  outcomes: Array<{
    id: string;
    landedOn: string;
    title: string;
    narrative: string;
    category: OutcomeCategory;
    teamName: string;
    projectName: string;
    pmName: string;
    verified: boolean;
  }>;
}

export interface RegisterResult {
  kind: 'outcome' | 'task';
  id: string;
  title: string;
  category: OutcomeCategory | null;
  date: string;
  accountId: string | null;
  accountName: string | null;
  accountCode: string | null;
  teamId: string | null;
  teamName: string;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  redacted: boolean;
  rank: number;
  narrative?: string | null;
  personName?: string | null;
  verified?: boolean | null;
}

export interface PortfolioRiskItem {
  type: 'blocked' | 'overdue' | 'silentTeam' | 'staleOutcomes';
  label: string;
  teamId?: string;
  teamName?: string;
  count?: number;
}

export interface PortfolioTrend {
  thisPeriod: number;
  lastPeriod: number;
  delta: number;
}

export interface PortfolioAccountRow {
  id: string;
  name: string;
  code: string;
  status: AccountStatus;
  ownerDirector: PersonRef | null;
  projectCount: number;
  teamCount: number;
  memberCount: number;
  trend: {
    outcomes: PortfolioTrend;
    tasksDone: PortfolioTrend;
    hours: PortfolioTrend;
  };
  risk: {
    score: number;
    items: PortfolioRiskItem[];
  };
}

export interface Portfolio {
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  accounts: PortfolioAccountRow[];
}

export interface ReportScopes {
  teams: Array<{ id: string; name: string; projectName: string | null }>;
  projects: Array<{ id: string; name: string; code: string }>;
  accounts: Array<{ id: string; name: string; code: string }>;
}

/* ------------------------------ imports ------------------------------ */

export type ImportAction = 'create' | 'update' | 'skip';

export interface RallyPlanRow {
  rowNumber: number;
  workProduct: string;
  release: string;
  state: string;
  estimate: number;
  todo: number;
  timeSpent: number;
  owner: string;
  userId: string | null;
  userName: string | null;
  action: ImportAction;
  reason?: string;
}

export interface KekaPlanRow {
  rowNumber: number;
  employeeNumber: string;
  displayName: string;
  jobTitle: string;
  department: string;
  location: string;
  reporteesCount: number;
  userId: string | null;
  userName: string | null;
  action: ImportAction;
  reason?: string;
}

interface PlanBase {
  fileName: string;
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  skipped: number;
  committed: boolean;
  batchId?: string;
}

export interface RallyPlan extends PlanBase {
  source: 'RALLY';
  period: { from: string; to: string };
  rows: RallyPlanRow[];
}

export interface KekaPlan extends PlanBase {
  source: 'KEKA';
  linked: number;
  rows: KekaPlanRow[];
}

export interface ImportBatch {
  id: string;
  source: 'RALLY' | 'KEKA';
  fileName: string;
  periodStart: string | null;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  createdAt: string;
  uploadedBy: string;
}

export interface ImportStatus {
  currentPeriod: { from: string; to: string };
  rally: {
    lastImport: ImportBatch | null;
    people: number;
    withDataCurrent: number;
    withDataPrevious: number;
  };
  keka: {
    lastImport: ImportBatch | null;
    employees: number;
    linked: number;
    loginsWithoutRecord: number;
  } | null;
  coverage: {
    periods: Array<{ from: string; to: string }>;
    people: Array<{ id: string; name: string; role: Role; has: boolean[] }>;
  };
  recent: ImportBatch[];
}

export interface KekaEmployeeRow {
  id: string;
  employeeNumber: string;
  displayName: string;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  reporteesCount: number;
  userId: string | null;
  userEmail: string | null;
  updatedAt: string;
}

/* ---------------------------- productivity ---------------------------- */

export interface ProductivityMetrics {
  storyPoints: number;
  storiesCompleted: number;
  storiesTotal: number;
  pointsPlanned: number;
  timeSpent: number;
  todo: number;
}

export interface Productivity {
  period: { from: string; to: string };
  periods: Array<{ from: string; to: string }>;
  doneStates: string[];
  totals: ProductivityMetrics;
  trend: Array<{ from: string; to: string } & ProductivityMetrics>;
  people: Array<{
    id: string;
    name: string;
    email: string;
    role: Role;
    employeeNumber: string | null;
    jobTitle: string | null;
    department: string | null;
    hasData: boolean;
    current: ProductivityMetrics;
    trend: Array<{ from: string } & ProductivityMetrics>;
  }>;
  items: Array<{
    id: string;
    userId: string;
    workProduct: string;
    release: string | null;
    state: string;
    done: boolean;
    estimate: number;
    timeSpent: number;
    todo: number;
  }>;
}
