import { useState, type FormEvent } from 'react';
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
  PriorityBadge,
  RoleBadge,
  TaskStatusBadge,
  WorkLogStatusBadge,
} from '../components/ui';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, hours, isOverdue, startOfWeekString, todayString } from '../lib/format';
import type { DirectoryUser, TeamDetail, WorkLogRow } from '../lib/types';
import { useApi } from '../lib/useApi';

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<TeamDetail>(id ? `/teams/${id}` : null);
  const weekFrom = startOfWeekString(todayString());
  const { data: logs } = useApi<WorkLogRow[]>(id ? `/worklogs?teamId=${id}&from=${weekFrom}` : null);

  const [addingMember, setAddingMember] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
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
      await downloadFile(`/reports/weekly.xlsx?teamId=${id}`, 'weekly-report.xlsx');
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
                Export weekly report
              </button>
            )}
            {data.canManage && (
              <>
                <button className="btn" onClick={() => setAddingMember(true)}>
                  Add member
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
          hint={`Hours logged this week (from ${formatDate(weekFrom)})`}
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
                    <th className="num">Hours this week</th>
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
          title="This week's entries"
          hint="What each member logged since Monday — this is what the weekly export contains"
          flush
        >
          {!logs || logs.length === 0 ? (
            <Empty title="Nothing logged this week yet">
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
    </>
  );
}

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
  const { data, error, loading } = useApi<DirectoryUser[]>('/users');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const candidates = (data ?? []).filter(
    (u) => u.active && !existing.includes(u.id) && (u.role === 'ENGINEER' || u.role === 'PM')
  );

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
      {loading && <Loading />}
      {data && candidates.length === 0 && (
        <Empty title="Nobody left to add">Everyone available is already on this team.</Empty>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
