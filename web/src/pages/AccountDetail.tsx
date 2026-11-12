import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/Shell';
import {
  AccountStatusBadge,
  Card,
  Empty,
  ErrorNote,
  Loading,
  OutcomeCategoryBadge,
  ProjectStatusBadge,
  Stat,
  VerifiedBadge,
} from '../components/ui';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { AccountDetail, OutcomeSummary } from '../lib/types';
import { formatDate } from '../lib/format';
import { useApi } from '../lib/useApi';

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data, error, loading } = useApi<AccountDetail>(id ? `/accounts/${id}` : null);
  const outcomesApi = useApi<OutcomeSummary[]>(id ? `/outcomes?accountId=${id}` : null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function exportReport() {
    await downloadFile(`/reports/biweekly.xlsx?accountId=${id}`, 'biweekly-report.xlsx');
  }

  async function verifyOutcome(outcomeId: string) {
    setActionError(null);
    try {
      await api.post(`/outcomes/${outcomeId}/verify`);
      outcomesApi.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not verify the outcome');
    }
  }

  if (loading) return <Loading />;
  if (error) {
    return (
      <div className="content">
        <ErrorNote message={error} />
        <Link to="/accounts">← Back to accounts</Link>
      </div>
    );
  }
  if (!data) return null;

  const totalTeams = data.projects.reduce((s, p) => s + p.teamCount, 0);
  const totalMembers = data.projects.reduce((s, p) => s + p.memberCount, 0);
  const totalTasks = data.projects.reduce((s, p) => s + p.taskCount, 0);
  const openTasks = data.projects.reduce((s, p) => s + p.openTaskCount, 0);

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={
          <span className="row" style={{ gap: 8 }}>
            <span className="strong">{data.code}</span>
            <AccountStatusBadge status={data.status} />
            <span className="muted">
              {data.ownerDirector ? `Owning director: ${data.ownerDirector.name}` : 'No owning director yet'}
            </span>
          </span>
        }
        actions={
          can('ADMIN', 'PM', 'DIRECTOR', 'VP') && (
            <button className="btn" onClick={exportReport}>
              Export bi-weekly report
            </button>
          )
        }
      />

      <div className="content">
        <ErrorNote message={actionError} />
        <div className="grid stats">
          <Stat label="Projects" value={data.projects.length} />
          <Stat label="Teams" value={totalTeams} />
          <Stat label="People" value={totalMembers} />
          <Stat label="Tasks" value={totalTasks} foot={`${openTasks} still open`} />
        </div>

        <Card
          title="Projects"
          hint="Every project this client is delivering, and its progress"
          flush
        >
          {data.projects.length === 0 ? (
            <Empty title="No projects on this account yet">
              A Director attaches a project to this account.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Status</th>
                    <th>Director</th>
                    <th className="num">Teams</th>
                    <th className="num">People</th>
                    <th className="num">Tasks</th>
                    <th className="num">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {data.projects.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="stack">
                          <Link to={`/projects/${p.id}`} className="strong">
                            {p.name}
                          </Link>
                          <span className="muted small">{p.code}</span>
                        </div>
                      </td>
                      <td>
                        <ProjectStatusBadge status={p.status} />
                      </td>
                      <td className="nowrap">{p.director.name}</td>
                      <td className="num">{p.teamCount}</td>
                      <td className="num">{p.memberCount}</td>
                      <td className="num">{p.taskCount}</td>
                      <td className="num">{p.openTaskCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Outcomes" hint="Delivered results across every project for this client" flush>
          {!outcomesApi.data || outcomesApi.data.length === 0 ? (
            <Empty title="No outcomes filed on this account yet" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Title</th>
                    <th>Project</th>
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
                      <td className="nowrap small muted">
                        {o.project ? `${o.project.code} — ${o.project.name}` : 'Unassigned'}
                      </td>
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
    </>
  );
}
