import { useState } from 'react';
import { PageHeader } from '../components/Shell';
import { Badge, Card, Empty, ErrorNote, Loading, Stat } from '../components/ui';
import { downloadFile } from '../lib/api';
import { addDaysString, formatDate, formatRange, hours, startOfWeekString, todayString } from '../lib/format';
import type { ReportScopes, WeeklyReport } from '../lib/types';
import { useApi } from '../lib/useApi';

type ScopeChoice = { kind: 'all' } | { kind: 'project'; id: string } | { kind: 'team'; id: string };

function scopeToQuery(scope: ScopeChoice, week: string): string {
  const params = new URLSearchParams({ week });
  if (scope.kind === 'project') params.set('projectId', scope.id);
  if (scope.kind === 'team') params.set('teamId', scope.id);
  return params.toString();
}

export default function Reports() {
  const [week, setWeek] = useState(startOfWeekString(todayString()));
  const [scopeValue, setScopeValue] = useState('all');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const scopes = useApi<ReportScopes>('/reports/scopes');

  const scope: ScopeChoice =
    scopeValue === 'all'
      ? { kind: 'all' }
      : scopeValue.startsWith('project:')
        ? { kind: 'project', id: scopeValue.slice(8) }
        : { kind: 'team', id: scopeValue.slice(5) };

  const query = scopeToQuery(scope, week);
  const report = useApi<WeeklyReport>(`/reports/weekly?${query}`, [query]);

  async function download() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadFile(`/reports/weekly.xlsx?${query}`, 'weekly-report.xlsx');
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Weekly report"
        subtitle="Preview a week, then export it as an Excel workbook to send on."
        actions={
          <button className="btn primary" onClick={download} disabled={downloading || !report.data}>
            {downloading && <span className="spinner" />}
            Export .xlsx
          </button>
        }
      />

      <div className="content">
        <ErrorNote message={scopes.error ?? report.error ?? downloadError} />

        <Card title="What to report on">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="r-scope">Scope</label>
              <select id="r-scope" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}>
                <option value="all">Everything I can see</option>
                {(scopes.data?.projects.length ?? 0) > 0 && (
                  <optgroup label="Projects">
                    {scopes.data?.projects.map((p) => (
                      <option key={p.id} value={`project:${p.id}`}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(scopes.data?.teams.length ?? 0) > 0 && (
                  <optgroup label="Teams">
                    {scopes.data?.teams.map((t) => (
                      <option key={t.id} value={`team:${t.id}`}>
                        {t.name}
                        {t.projectName ? ` — ${t.projectName}` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="field">
              <label htmlFor="r-week">Week (any day in it)</label>
              <input
                id="r-week"
                type="date"
                value={week}
                onChange={(e) => setWeek(startOfWeekString(e.target.value || todayString()))}
              />
            </div>
            <div className="field">
              <label>Jump</label>
              <div className="row">
                <button className="btn sm" onClick={() => setWeek(addDaysString(week, -7))}>
                  ← Previous
                </button>
                <button className="btn sm" onClick={() => setWeek(startOfWeekString(todayString()))}>
                  This week
                </button>
                <button
                  className="btn sm"
                  onClick={() => setWeek(addDaysString(week, 7))}
                  disabled={addDaysString(week, 7) > todayString()}
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        </Card>

        {report.loading && <Loading label="Building the report…" />}

        {report.data && (
          <>
            <div className="alert info">
              <strong>{report.data.scopeLabel}</strong> · {formatRange(report.data.from, report.data.to)}
            </div>

            <div className="grid stats">
              <Stat label="Hours logged" value={hours(report.data.totals.hours)} />
              <Stat label="Entries" value={report.data.totals.entries} />
              <Stat
                label="People"
                value={report.data.totals.members}
                foot={`${report.data.totals.membersWithNoEntries} logged nothing`}
              />
              <Stat label="Blocked entries" value={report.data.totals.blockedEntries} />
            </div>

            <Card title="Per member" hint="Sheet 1 of the workbook" flush>
              {report.data.members.length === 0 ? (
                <Empty title="Nobody in scope for this week" />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Team</th>
                        <th>Project</th>
                        <th className="num">Hours</th>
                        <th className="num">Entries</th>
                        <th className="num">Days</th>
                        <th className="num">Open</th>
                        <th className="num">Done</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.data.members.map((m) => (
                        <tr key={`${m.teamName}:${m.userId}`}>
                          <td>
                            <div className="stack">
                              <span className="strong">{m.name}</span>
                              <span className="muted small">{m.email}</span>
                            </div>
                          </td>
                          <td className="nowrap">{m.teamName}</td>
                          <td className="nowrap small muted">{m.projectName}</td>
                          <td className="num">{m.hours || <span className="muted">0</span>}</td>
                          <td className="num">
                            {m.entries === 0 ? <Badge tone="warn">none</Badge> : m.entries}
                          </td>
                          <td className="num">{m.daysLogged}</td>
                          <td className="num">{m.tasksOpen}</td>
                          <td className="num">{m.tasksDone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card
              title="Daily entries"
              hint={`Sheet 2 of the workbook · ${report.data.logs.length} rows`}
              flush
            >
              {report.data.logs.length === 0 ? (
                <Empty title="No entries logged in this week" />
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
                      {report.data.logs.map((l, i) => (
                        <tr key={i}>
                          <td className="nowrap small">{formatDate(l.date)}</td>
                          <td className="nowrap">{l.memberName}</td>
                          <td>
                            <div className="stack">
                              <span>{l.taskTitle}</span>
                              <span className="muted small">{l.teamName}</span>
                            </div>
                          </td>
                          <td className="num">{l.hours}</td>
                          <td>
                            <Badge tone={l.status === 'BLOCKED' ? 'danger' : 'neutral'}>
                              {l.status.replace('_', ' ').toLowerCase()}
                            </Badge>
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
          </>
        )}
      </div>
    </>
  );
}
