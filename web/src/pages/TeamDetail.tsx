import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/Shell';
import {
  Avatar,
  Badge,
  Card,
  Empty,
  ErrorNote,
  Loading,
  Modal,
  OutcomeCategoryBadge,
  PriorityBadge,
  RoleBadge,
  TaskStatusBadge,
  VerifiedBadge,
  WorkLogStatusBadge,
} from '../components/ui';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, hours, isOverdue, todayString } from '../lib/format';
import { usePeriods } from '../lib/periods';
import type { DirectoryUser, OutcomeCategory, OutcomeSummary, TeamDetail, WorkLogRow } from '../lib/types';
import { useApi } from '../lib/useApi';

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<TeamDetail>(id ? `/teams/${id}` : null);
  const periods = usePeriods(1);
  const periodFrom = periods.data?.current.from ?? null;
  const { data: logs } = useApi<WorkLogRow[]>(
    id && periodFrom ? `/worklogs?teamId=${id}&from=${periodFrom}` : null
  );
  const outcomesApi = useApi<OutcomeSummary[]>(id ? `/outcomes?teamId=${id}` : null);

  const [addingMember, setAddingMember] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [filingOutcome, setFilingOutcome] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function removeMember(userId: string) {
    setActionError(null);
    try {
      await api.del(`/teams/${id}/members/${userId}`);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not remove the member');
    }
  }

  async function exportReport() {
    setActionError(null);
    try {
      await downloadFile(`/reports/biweekly.xlsx?teamId=${id}`, 'biweekly-report.xlsx');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Export failed');
    }
  }

  if (loading) return <Loading />;
  if (error) {
    return (
      <div className="content">
        <ErrorNote message={error} />
        <Link to="/teams">← Back to teams</Link>
      </div>
    );
  }
  if (!data) return null;

  const hoursByUser = new Map<string, number>();
  for (const l of logs ?? []) {
    hoursByUser.set(l.userId, (hoursByUser.get(l.userId) ?? 0) + l.hours);
  }

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={
          <span className="row" style={{ gap: 8 }}>
            <span className="muted">PM: {data.pm.name}</span>
            {data.project ? (
              <Link to={`/projects/${data.project.id}`}>
                {data.project.code} — {data.project.name}
              </Link>
            ) : (
              <Badge tone="warn">Not attached to a project</Badge>
            )}
          </span>
        }
        actions={
          <>
            {can('ADMIN', 'PM', 'DIRECTOR', 'VP') && (
              <button className="btn" onClick={exportReport}>
                Export bi-weekly report
              </button>
            )}
            {data.canManage && (
              <>
                <button className="btn" onClick={() => setAddingMember(true)}>
                  Add member
                </button>
                <button className="btn" onClick={() => setFilingOutcome(true)}>
                  Log an outcome
                </button>
                <button
                  className="btn primary"
                  onClick={() => setAddingTask(true)}
                  disabled={data.members.length === 0}
                  title={data.members.length === 0 ? 'Add a member first' : undefined}
                >
                  New task
                </button>
              </>
            )}
          </>
        }
      />

      <div className="content">
        <ErrorNote message={actionError} />
        {data.description && <div className="alert info">{data.description}</div>}

        <Card
          title="Members"
          hint={`Hours logged this period (from ${formatDate(periodFrom)})`}
          flush
        >
          {data.members.length === 0 ? (
            <Empty title="No members yet">
              {data.canManage ? 'Add engineers to start assigning tasks.' : 'The PM adds members.'}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th className="num">Open tasks</th>
                    <th className="num">Hours this period</th>
                    {data.canManage && <th />}
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => {
                    const open = data.tasks.filter(
                      (t) => t.assigneeId === m.userId && t.status !== 'DONE'
                    ).length;
                    const h = hoursByUser.get(m.userId) ?? 0;
                    return (
                      <tr key={m.id}>
                        <td>
                          <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                            <Avatar name={m.user.name} />
                            <div className="stack">
                              <span className="strong">{m.user.name}</span>
                              <span className="muted small">{m.user.email}</span>
                            </div>
                          </div>
                        </td>
                        <td>{m.user.role && <RoleBadge role={m.user.role} />}</td>
                        <td className="num">{open}</td>
                        <td className="num">
                          {h > 0 ? hours(h) : <span className="muted">no entries</span>}
                        </td>
                        {data.canManage && (
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn sm ghost" onClick={() => removeMember(m.userId)}>
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Tasks" hint={`${data.tasks.filter((t) => t.status !== 'DONE').length} open`} flush>
          {data.tasks.length === 0 ? (
            <Empty title="No tasks yet">
              {data.canManage ? 'Create a task and assign it to a member.' : 'The PM creates tasks.'}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Assignee</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tasks.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="stack">
                          <span className="strong">{t.title}</span>
                          {t.description && <span className="muted small">{t.description}</span>}
                        </div>
                      </td>
                      <td className="nowrap">{t.assignee.name}</td>
                      <td>
                        <TaskStatusBadge status={t.status} />
                      </td>
                      <td>
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className="nowrap small">
                        {isOverdue(t.dueDate, t.status) ? (
                          <span className="strong" style={{ color: 'var(--danger)' }}>
                            {formatDate(t.dueDate)} · overdue
                          </span>
                        ) : (
                          <span className="muted">{formatDate(t.dueDate)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="This period's entries"
          hint="What each member logged since the period started — this is what the bi-weekly export contains"
          flush
        >
          {!logs || logs.length === 0 ? (
            <Empty title="Nothing logged this period yet">
              Engineers add entries from their “My work” page.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Member</th>
                    <th>Task</th>
                    <th className="num">Hours</th>
                    <th>Status</th>
                    <th>What was done</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="nowrap small">{formatDate(l.date)}</td>
                      <td className="nowrap">{l.user?.name}</td>
                      <td>{l.task?.title}</td>
                      <td className="num">{l.hours}</td>
                      <td>
                        <WorkLogStatusBadge status={l.status} />
                      </td>
                      <td>
                        <div className="stack">
                          <span>{l.summary}</span>
                          {l.blockers && (
                            <span className="small" style={{ color: 'var(--danger)' }}>
                              Blocked: {l.blockers}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Outcomes" hint="What this team has actually delivered — not what it did" flush>
          {!outcomesApi.data || outcomesApi.data.length === 0 ? (
            <Empty title="No outcomes filed yet">
              {data.canManage ? 'Log one once something real has landed.' : 'The PM logs outcomes here.'}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomesApi.data.map((o) => (
                    <tr key={o.id}>
                      <td className="nowrap small">{formatDate(o.landedOn)}</td>
                      <td>
                        <div className="stack">
                          <span className="strong">{o.title}</span>
                          <span className="muted small">{o.narrative}</span>
                        </div>
                      </td>
                      <td>
                        <OutcomeCategoryBadge category={o.category} />
                      </td>
                      <td>
                        <VerifiedBadge verifiedAt={o.verifiedAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {addingMember && id && (
        <AddMemberModal
          teamId={id}
          existing={data.members.map((m) => m.userId)}
          onClose={() => setAddingMember(false)}
          onAdded={() => {
            setAddingMember(false);
            reload();
          }}
        />
      )}
      {addingTask && id && (
        <NewTaskModal
          teamId={id}
          members={data.members.map((m) => ({ id: m.userId, name: m.user.name }))}
          onClose={() => setAddingTask(false)}
          onCreated={() => {
            setAddingTask(false);
            reload();
          }}
        />
      )}
      {filingOutcome && id && (
        <NewOutcomeModal
          teamId={id}
          tasks={data.tasks.map((t) => ({ id: t.id, title: t.title }))}
          onClose={() => setFilingOutcome(false)}
          onCreated={() => {
            setFilingOutcome(false);
            outcomesApi.reload();
          }}
        />
      )}
    </>
  );
}

/** Only Engineers and PMs are staffable onto a team; VPs/Directors/Admins never appear here. */
const STAFFABLE_ROLES = ['ENGINEER', 'PM'] as const;

function AddMemberModal({
  teamId,
  existing,
  onClose,
  onAdded,
}: {
  teamId: string;
  existing: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [filters, setFilters] = useState({ role: '', name: '', email: '' });
  // Debounced so typing a name/email doesn't fire a request per keystroke —
  // matters once the directory has hundreds or thousands of people.
  const [debounced, setDebounced] = useState(filters);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);

  const setFilter = (key: keyof typeof filters) => (e: { target: { value: string } }) =>
    setFilters((f) => ({ ...f, [key]: e.target.value }));

  const params = new URLSearchParams();
  params.set('role', debounced.role || STAFFABLE_ROLES.join(','));
  if (debounced.name.trim()) params.set('name', debounced.name.trim());
  if (debounced.email.trim()) params.set('email', debounced.email.trim());
  params.set('limit', '50');

  const { data, error, loading } = useApi<DirectoryUser[]>(`/users?${params.toString()}`);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const candidates = (data ?? []).filter((u) => u.active && !existing.includes(u.id));
  const hasFilter = Boolean(debounced.role || debounced.name.trim() || debounced.email.trim());

  async function add(userId: string) {
    setBusyId(userId);
    setActionError(null);
    try {
      await api.post(`/teams/${teamId}/members`, { userId });
      onAdded();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not add the member');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="Add a member" onClose={onClose}>
      <ErrorNote message={error ?? actionError} />
      <div className="form-grid" style={{ marginBottom: 16 }}>
        <div className="field">
          <label htmlFor="am-role">Role</label>
          <select id="am-role" value={filters.role} onChange={setFilter('role')}>
            <option value="">All (Engineer + PM)</option>
            <option value="ENGINEER">Engineer</option>
            <option value="PM">PM</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="am-name">Name</label>
          <input
            id="am-name"
            value={filters.name}
            onChange={setFilter('name')}
            placeholder="Search by name"
          />
        </div>
        <div className="field">
          <label htmlFor="am-email">Email</label>
          <input
            id="am-email"
            value={filters.email}
            onChange={setFilter('email')}
            placeholder="Search by email"
          />
        </div>
      </div>

      {loading && <Loading />}
      {data && candidates.length === 0 && (
        <Empty title="No matches">
          {hasFilter
            ? 'Nobody matches those filters — try a different name, email or role.'
            : 'Everyone available is already on this team.'}
        </Empty>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
        {candidates.map((u) => (
          <div className="demo-row" key={u.id} style={{ cursor: 'default' }}>
            <span className="row" style={{ gap: 9, flexWrap: 'nowrap' }}>
              <Avatar name={u.name} />
              <span className="stack">
                <span className="strong">{u.name}</span>
                <span className="muted">{u.email}</span>
              </span>
            </span>
            <span className="row">
              <RoleBadge role={u.role} />
              <button className="btn primary sm" disabled={busyId === u.id} onClick={() => add(u.id)}>
                Add
              </button>
            </span>
          </div>
        ))}
      </div>
      {data && data.length === 50 && (
        <p className="muted small" style={{ marginTop: 8 }}>
          Showing the first 50 matches — narrow the filters to find someone specific.
        </p>
      )}
    </Modal>
  );
}

function NewTaskModal({
  teamId,
  members,
  onClose,
  onCreated,
}: {
  teamId: string;
  members: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    assigneeId: members[0]?.id ?? '',
    priority: 'MEDIUM',
    status: 'TODO',
    dueDate: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/tasks', {
        teamId,
        assigneeId: form.assigneeId,
        title: form.title.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        priority: form.priority,
        status: form.status,
        ...(form.dueDate ? { dueDate: form.dueDate } : {}),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the task');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New task" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorNote message={error} />
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="k-title">Title</label>
            <input id="k-title" required minLength={2} value={form.title} onChange={set('title')} />
          </div>
          <div className="field">
            <label htmlFor="k-assignee">Assignee</label>
            <select id="k-assignee" required value={form.assigneeId} onChange={set('assigneeId')}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="k-priority">Priority</label>
            <select id="k-priority" value={form.priority} onChange={set('priority')}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="k-status">Status</label>
            <select id="k-status" value={form.status} onChange={set('status')}>
              <option value="TODO">To do</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="BLOCKED">Blocked</option>
              <option value="DONE">Done</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="k-due">Due date</label>
            <input id="k-due" type="date" value={form.dueDate} onChange={set('dueDate')} />
          </div>
          <div className="field span-2">
            <label htmlFor="k-desc">Description</label>
            <textarea id="k-desc" value={form.description} onChange={set('description')} />
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !form.assigneeId}>
            {busy && <span className="spinner" />}
            Create task
          </button>
        </div>
      </form>
    </Modal>
  );
}

const OUTCOME_CATEGORIES: Array<{ value: OutcomeCategory; label: string }> = [
  { value: 'REVENUE_ENABLED', label: 'Revenue enabled' },
  { value: 'COST_SAVED', label: 'Cost saved' },
  { value: 'RISK_REDUCED', label: 'Risk reduced' },
  { value: 'CAPABILITY_BUILT', label: 'Capability built' },
  { value: 'CUSTOMER_VISIBLE', label: 'Customer-visible' },
];

function NewOutcomeModal({
  teamId,
  tasks,
  onClose,
  onCreated,
}: {
  teamId: string;
  tasks: Array<{ id: string; title: string }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    title: '',
    category: 'REVENUE_ENABLED' as OutcomeCategory,
    landedOn: todayString(),
    narrative: '',
  });
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const toggleTask = (taskId: string) =>
    setTaskIds((ids) => (ids.includes(taskId) ? ids.filter((id) => id !== taskId) : [...ids, taskId]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/outcomes', {
        teamId,
        title: form.title.trim(),
        category: form.category,
        landedOn: form.landedOn,
        narrative: form.narrative.trim(),
        ...(taskIds.length ? { taskIds } : {}),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log the outcome');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Log an outcome" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorNote message={error} />
        <p className="hint">
          A delivered result, not a status update — what did this actually produce?
        </p>
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="o-title">Title</label>
            <input id="o-title" required minLength={2} value={form.title} onChange={set('title')} />
          </div>
          <div className="field">
            <label htmlFor="o-category">Category</label>
            <select id="o-category" value={form.category} onChange={set('category')}>
              {OUTCOME_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="o-date">Landed on</label>
            <input
              id="o-date"
              type="date"
              max={todayString()}
              value={form.landedOn}
              onChange={set('landedOn')}
              required
            />
          </div>
          <div className="field span-2">
            <label htmlFor="o-narrative">What happened</label>
            <textarea
              id="o-narrative"
              required
              minLength={10}
              value={form.narrative}
              onChange={set('narrative')}
              placeholder="Shipped mandate-based UPI AutoPay so merchants can bill recurring subscriptions without a manual retry every cycle."
            />
          </div>
        </div>

        {tasks.length > 0 && (
          <div className="field">
            <label>Linked tasks (optional)</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
              {tasks.map((t) => (
                <label key={t.id} className="row" style={{ gap: 8, fontWeight: 400 }}>
                  <input
                    type="checkbox"
                    checked={taskIds.includes(t.id)}
                    onChange={() => toggleTask(t.id)}
                  />
                  <span className="small">{t.title}</span>
                </label>
              ))}
            </div>
            <span className="hint">Cite the work this traces back to, if it's a clean fit — never required.</span>
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" />}
            Log outcome
          </button>
        </div>
      </form>
    </Modal>
  );
}
