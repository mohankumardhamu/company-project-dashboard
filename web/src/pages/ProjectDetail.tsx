import { useState } from 'react';
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
  ProjectStatusBadge,
  Stat,
  TaskStatusBadge,
  VerifiedBadge,
} from '../components/ui';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, isOverdue } from '../lib/format';
import type { AttachableTeam, OutcomeSummary, ProjectDetail } from '../lib/types';
import { useApi } from '../lib/useApi';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<ProjectDetail>(id ? `/projects/${id}` : null);
  const outcomesApi = useApi<OutcomeSummary[]>(id ? `/outcomes?projectId=${id}` : null);
  const [attaching, setAttaching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function verifyOutcome(outcomeId: string) {
    setActionError(null);
    try {
      await api.post(`/outcomes/${outcomeId}/verify`);
      outcomesApi.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not verify the outcome');
    }
  }

  async function detach(teamId: string) {
    setActionError(null);
    try {
      await api.del(`/projects/${id}/teams/${teamId}`);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not detach the team');
    }
  }

  async function exportReport() {
    setActionError(null);
    try {
      await downloadFile(`/reports/biweekly.xlsx?projectId=${id}`, 'biweekly-report.xlsx');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Export failed');
    }
  }

  if (loading) return <Loading />;
  if (error) {
    return (
      <div className="content">
        <ErrorNote message={error} />
        <Link to="/projects">← Back to projects</Link>
      </div>
    );
  }
  if (!data) return null;

  const allMembers = new Set(data.teams.flatMap((t) => t.members.map((m) => m.userId)));
  const allTasks = data.teams.flatMap((t) => t.tasks);
  const openTasks = allTasks.filter((t) => t.status !== 'DONE').length;

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={
          <span className="row" style={{ gap: 8 }}>
            <span className="strong">{data.code}</span>
            <ProjectStatusBadge status={data.status} />
            {data.account ? (
              <Link to={`/accounts/${data.account.id}`}>
                {data.account.code} — {data.account.name}
              </Link>
            ) : (
              <Badge tone="warn">No account</Badge>
            )}
            <span className="muted">
              Director: {data.director.name} · {formatDate(data.startDate)} → {formatDate(data.endDate)}
            </span>
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
              <button className="btn primary" onClick={() => setAttaching(true)}>
                Attach a team
              </button>
            )}
          </>
        }
      />

      <div className="content">
        <ErrorNote message={actionError} />
        {data.description && <div className="alert info">{data.description}</div>}

        <div className="grid stats">
          <Stat label="Teams" value={data.teams.length} />
          <Stat label="People" value={allMembers.size} foot="distinct members" />
          <Stat label="Tasks" value={allTasks.length} foot={`${openTasks} still open`} />
          <Stat
            label="Blocked"
            value={allTasks.filter((t) => t.status === 'BLOCKED').length}
            foot="tasks flagged blocked"
          />
        </div>

        <Card
          title="Teams, members and their tasks"
          hint="The full drill-down: every team on this project, everyone on it, and what they are working on."
        >
          {data.teams.length === 0 ? (
            <Empty title="No teams on this project yet">
              {data.canManage
                ? 'Attach a team a PM has already created.'
                : 'A director attaches teams to a project.'}
            </Empty>
          ) : (
            data.teams.map((team) => {
              const byMember = new Map(team.members.map((m) => [m.userId, m.user]));
              const unassignedTasks = team.tasks.filter((t) => !byMember.has(t.assigneeId));
              return (
                <div className="tree-team" key={team.id}>
                  <div className="tree-head">
                    <div className="stack">
                      <Link to={`/teams/${team.id}`} className="strong">
                        {team.name}
                      </Link>
                      <span className="muted small">
                        PM: {team.pm.name} · {team.members.length} member
                        {team.members.length === 1 ? '' : 's'} · {team.tasks.length} task
                        {team.tasks.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    {data.canManage && (
                      <button className="btn sm danger" onClick={() => detach(team.id)}>
                        Detach
                      </button>
                    )}
                  </div>

                  {team.members.length === 0 && unassignedTasks.length === 0 ? (
                    <div className="empty">No members yet — the PM adds them.</div>
                  ) : (
                    <>
                      {team.members.map((m) => {
                        const tasks = team.tasks.filter((t) => t.assigneeId === m.userId);
                        return (
                          <div className="member-block" key={m.id}>
                            <div className="row" style={{ gap: 10 }}>
                              <Avatar name={m.user.name} />
                              <div className="stack">
                                <span className="strong">{m.user.name}</span>
                                <span className="muted small">{m.user.email}</span>
                              </div>
                              <div className="spacer" />
                              <Badge tone={tasks.length ? 'neutral' : 'warn'}>
                                {tasks.length} task{tasks.length === 1 ? '' : 's'}
                              </Badge>
                            </div>
                            {tasks.length === 0 ? (
                              <div className="task-line muted">No tasks assigned.</div>
                            ) : (
                              tasks.map((t) => (
                                <div className="task-line" key={t.id}>
                                  <span style={{ flex: 1, minWidth: 200 }}>{t.title}</span>
                                  <TaskStatusBadge status={t.status} />
                                  <PriorityBadge priority={t.priority} />
                                  <span
                                    className={
                                      isOverdue(t.dueDate, t.status) ? 'small strong' : 'small muted'
                                    }
                                    style={
                                      isOverdue(t.dueDate, t.status)
                                        ? { color: 'var(--danger)' }
                                        : undefined
                                    }
                                  >
                                    {t.dueDate ? `Due ${formatDate(t.dueDate)}` : 'No due date'}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        );
                      })}
                      {unassignedTasks.length > 0 && (
                        <div className="member-block">
                          <div className="row">
                            <Badge tone="warn">
                              {unassignedTasks.length} task
                              {unassignedTasks.length === 1 ? '' : 's'} assigned to a former member
                            </Badge>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </Card>

        <Card title="Outcomes" hint="Delivered results across every team on this project" flush>
          {!outcomesApi.data || outcomesApi.data.length === 0 ? (
            <Empty title="No outcomes filed on this project yet" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Title</th>
                    <th>Team</th>
                    <th>Category</th>
                    <th>PM</th>
                    <th>Status</th>
                    {can('ADMIN', 'DIRECTOR') && <th />}
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
                      <td className="nowrap">{o.team.name}</td>
                      <td>
                        <OutcomeCategoryBadge category={o.category} />
                      </td>
                      <td className="nowrap">{o.pm.name}</td>
                      <td>
                        <VerifiedBadge verifiedAt={o.verifiedAt} />
                      </td>
                      {can('ADMIN', 'DIRECTOR') && (
                        <td style={{ textAlign: 'right' }}>
                          {!o.verifiedAt && o.canVerify && (
                            <button className="btn sm" onClick={() => verifyOutcome(o.id)}>
                              Verify
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {attaching && id && (
        <AttachTeamModal
          projectId={id}
          onClose={() => setAttaching(false)}
          onAttached={() => {
            setAttaching(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function AttachTeamModal({
  projectId,
  onClose,
  onAttached,
}: {
  projectId: string;
  onClose: () => void;
  onAttached: () => void;
}) {
  const { data, error, loading } = useApi<AttachableTeam[]>(`/projects/${projectId}/attachable-teams`);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function attach(teamId: string) {
    setBusyId(teamId);
    setActionError(null);
    try {
      await api.post(`/projects/${projectId}/teams`, { teamId });
      onAttached();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not attach the team');
    } finally {
      setBusyId(null);
    }
  }

  const available = (data ?? []).filter((t) => !t.attached);

  return (
    <Modal title="Attach a team" onClose={onClose}>
      <ErrorNote message={error ?? actionError} />
      <p className="muted small">
        Teams are created by PMs. Only teams that are not already on another project can be attached.
      </p>
      {loading && <Loading />}
      {data && available.length === 0 && (
        <Empty title="No teams available">
          Every team is already attached to a project. Ask a PM to create one.
        </Empty>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {available.map((t) => (
          <div className="demo-row" key={t.id} style={{ cursor: 'default' }}>
            <span className="stack">
              <span className="strong">{t.name}</span>
              <span className="muted">
                PM: {t.pm.name} · {t.memberCount} member{t.memberCount === 1 ? '' : 's'}
              </span>
            </span>
            <button
              className="btn primary sm"
              disabled={busyId === t.id}
              onClick={() => attach(t.id)}
            >
              Attach
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
