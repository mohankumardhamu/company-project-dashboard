import { useMemo, useState, type FormEvent } from 'react';
import { PageHeader } from '../components/Shell';
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Loading,
  PriorityBadge,
  Stat,
  WorkLogStatusBadge,
} from '../components/ui';
import { api } from '../lib/api';
import { addDaysString, formatDate, formatDayShort, hours, isOverdue, startOfWeekString, todayString } from '../lib/format';
import type { TaskStatus, TaskWithContext, WorkLogRow, WorkLogStatus } from '../lib/types';
import { useApi } from '../lib/useApi';

export default function MyWork() {
  const today = todayString();
  const weekFrom = startOfWeekString(today);

  const tasks = useApi<TaskWithContext[]>('/tasks?mine=1');
  const logs = useApi<WorkLogRow[]>(`/worklogs?mine=1&from=${addDaysString(weekFrom, -7)}`);

  const openTasks = (tasks.data ?? []).filter((t) => t.status !== 'DONE');
  const thisWeekLogs = (logs.data ?? []).filter((l) => l.date >= weekFrom);
  const weekHours = thisWeekLogs.reduce((s, l) => s + l.hours, 0);
  const loggedToday = thisWeekLogs.some((l) => l.date === today);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysString(weekFrom, i)).filter((d) => d <= today),
    [weekFrom, today]
  );

  function refresh() {
    tasks.reload();
    logs.reload();
  }

  return (
    <>
      <PageHeader
        title="My work"
        subtitle="Log what you did each day. Your PM's weekly report is built from these entries."
      />
      <div className="content">
        <ErrorNote message={tasks.error ?? logs.error} />
        {(tasks.loading || logs.loading) && !tasks.data && <Loading />}

        <div className="grid stats">
          <Stat label="Open tasks" value={openTasks.length} foot={`${tasks.data?.length ?? 0} assigned in total`} />
          <Stat label="Hours this week" value={hours(weekHours)} foot={`${thisWeekLogs.length} entries`} />
          <Stat
            label="Today"
            value={loggedToday ? 'Logged' : 'Not logged'}
            foot={formatDate(today)}
          />
        </div>

        {!loggedToday && openTasks.length > 0 && (
          <div className="alert info">You have not logged anything for today yet.</div>
        )}

        <LogForm tasks={tasks.data ?? []} logs={logs.data ?? []} onSaved={refresh} />

        <Card title="My tasks" hint="Move a task's status as you go" flush>
          {tasks.data && tasks.data.length === 0 ? (
            <Empty title="No tasks assigned to you">Your PM assigns tasks within your team.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Team / project</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th className="num">Logged</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(tasks.data ?? []).map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="stack">
                          <span className="strong">{t.title}</span>
                          {t.description && <span className="muted small">{t.description}</span>}
                        </div>
                      </td>
                      <td className="small">
                        <div className="stack">
                          <span>{t.team.name}</span>
                          <span className="muted">{t.team.project?.code ?? 'No project'}</span>
                        </div>
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
                      <td className="num">{t.loggedHours ? hours(t.loggedHours) : '—'}</td>
                      <td>
                        <StatusPicker task={t} onChanged={refresh} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="This week" hint="Monday to today — click an entry's day to see what you filed" flush>
          {days.length === 0 ? (
            <Empty title="The week has just started" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th className="num">Hours</th>
                    <th>Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => {
                    const dayLogs = thisWeekLogs.filter((l) => l.date === d);
                    const dayHours = dayLogs.reduce((s, l) => s + l.hours, 0);
                    return (
                      <tr key={d}>
                        <td className="nowrap">
                          <div className="stack">
                            <span className="strong">{formatDayShort(d)}</span>
                            {d === today && <Badge tone="brand">Today</Badge>}
                          </div>
                        </td>
                        <td className="num">{dayHours ? hours(dayHours) : <span className="muted">—</span>}</td>
                        <td>
                          {dayLogs.length === 0 ? (
                            <span className="muted small">Nothing logged</span>
                          ) : (
                            <div className="stack">
                              {dayLogs.map((l) => (
                                <div key={l.id} className="row" style={{ gap: 8 }}>
                                  <WorkLogStatusBadge status={l.status} />
                                  <span className="small strong">{l.task?.title}</span>
                                  <span className="small muted">— {l.summary}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function StatusPicker({ task, onChanged }: { task: TaskWithContext; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(status: TaskStatus) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/tasks/${task.id}`, { status });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <select
        value={task.status}
        disabled={busy}
        onChange={(e) => change(e.target.value as TaskStatus)}
        style={{ width: 148 }}
        aria-label={`Status for ${task.title}`}
      >
        <option value="TODO">To do</option>
        <option value="IN_PROGRESS">In progress</option>
        <option value="BLOCKED">Blocked</option>
        <option value="DONE">Done</option>
      </select>
      {error && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}

function LogForm({
  tasks,
  logs,
  onSaved,
}: {
  tasks: TaskWithContext[];
  logs: WorkLogRow[];
  onSaved: () => void;
}) {
  const today = todayString();
  const [taskId, setTaskId] = useState('');
  const [date, setDate] = useState(today);
  const [hoursValue, setHoursValue] = useState('4');
  const [summary, setSummary] = useState('');
  const [blockers, setBlockers] = useState('');
  const [status, setStatus] = useState<WorkLogStatus>('ON_TRACK');
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectableTasks = tasks.filter((t) => t.status !== 'DONE');
  const effectiveTaskId = taskId || selectableTasks[0]?.id || '';

  // Editing an existing entry for the same task and day is an update, not a duplicate.
  const existing = logs.find((l) => l.taskId === effectiveTaskId && l.date === date);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMessage(null);
    try {
      await api.post('/worklogs', {
        taskId: effectiveTaskId,
        date,
        hours: Number(hoursValue),
        summary: summary.trim(),
        ...(blockers.trim() ? { blockers: blockers.trim() } : { blockers: null }),
        status,
      });
      setOkMessage(existing ? 'Entry updated.' : 'Entry saved.');
      setSummary('');
      setBlockers('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the entry');
    } finally {
      setBusy(false);
    }
  }

  if (selectableTasks.length === 0) {
    return (
      <Card title="Log today's work">
        <Empty title="No open tasks to log against">
          Once your PM assigns you a task it will appear here.
        </Empty>
      </Card>
    );
  }

  return (
    <Card
      title="Log your work"
      hint="One entry per task per day. Saving the same day again updates that entry."
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorNote message={error} />
        {okMessage && <div className="alert ok">{okMessage}</div>}
        {existing && (
          <div className="alert info">
            You already logged {existing.hours} h on this task for {formatDate(date)} — saving will
            replace that entry.
          </div>
        )}
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="w-task">Task</label>
            <select
              id="w-task"
              value={effectiveTaskId}
              onChange={(e) => setTaskId(e.target.value)}
              required
            >
              {selectableTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} — {t.team.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="w-date">Date</label>
            <input
              id="w-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="w-hours">Hours</label>
            <input
              id="w-hours"
              type="number"
              step="0.25"
              min="0.25"
              max="24"
              value={hoursValue}
              onChange={(e) => setHoursValue(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="w-status">How is it going?</label>
            <select id="w-status" value={status} onChange={(e) => setStatus(e.target.value as WorkLogStatus)}>
              <option value="ON_TRACK">On track</option>
              <option value="AT_RISK">At risk</option>
              <option value="BLOCKED">Blocked</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
          <div className="field span-2">
            <label htmlFor="w-summary">What did you do?</label>
            <textarea
              id="w-summary"
              required
              minLength={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Wrote the migration script and dry-ran it against staging."
            />
          </div>
          <div className="field span-2">
            <label htmlFor="w-blockers">Anything blocking you? (optional)</label>
            <input
              id="w-blockers"
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              placeholder="Waiting on a staging credential from the platform team."
            />
          </div>
        </div>
        <div className="form-actions">
          <span className="hint spacer">
            These entries roll straight into the weekly report your PM sends to the Director.
          </span>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy && <span className="spinner" />}
            {existing ? 'Update entry' : 'Save entry'}
          </button>
        </div>
      </form>
    </Card>
  );
}
