import { useState } from 'react';
import { PageHeader } from '../components/Shell';
import { Badge, Card, Empty, ErrorNote, Loading, OutcomeCategoryBadge, Stat } from '../components/ui';
import { downloadFile } from '../lib/api';
import { formatDate, formatRange, hours } from '../lib/format';
import { periodLabel, usePeriods } from '../lib/periods';
import type { ReportScopes, PeriodReport } from '../lib/types';
import { useApi } from '../lib/useApi';

type ScopeChoice =
  | { kind: 'all' }
  | { kind: 'account'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'team'; id: string };

function scopeToQuery(scope: ScopeChoice, period: string): string {
  const params = new URLSearchParams({ period });
  if (scope.kind === 'account') params.set('accountId', scope.id);
  if (scope.kind === 'project') params.set('projectId', scope.id);
  if (scope.kind === 'team') params.set('teamId', scope.id);
  return params.toString();
}

export default function Reports() {
  const periods = usePeriods(26);
  const [chosen, setChosen] = useState<string | null>(null);
  const period = chosen ?? periods.data?.current.from ?? null;
  const [scopeValue, setScopeValue] = useState('all');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const scopes = useApi<ReportScopes>('/reports/scopes');

  const scope: ScopeChoice =
    scopeValue === 'all'
      ? { kind: 'all' }
      : scopeValue.startsWith('account:')
        ? { kind: 'account', id: scopeValue.slice(8) }
        : scopeValue.startsWith('project:')
          ? { kind: 'project', id: scopeValue.slice(8) }
          : { kind: 'team', id: scopeValue.slice(5) };

  const query = period ? scopeToQuery(scope, period) : null;
  const report = useApi<PeriodReport>(query ? `/reports/biweekly?${query}` : null, [query]);

  async function download() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadFile(`/reports/biweekly.xlsx?${query}`, 'biweekly-report.xlsx');
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Bi-weekly report"
        subtitle="Preview a two-week period, then export it as an Excel workbook to send on."
        actions={
          <button className="btn primary" onClick={download} disabled={downloading || !report.data}>
            {downloading && <span className="spinner" />}
            Export .xlsx
          </button>
        }
      />

      <div className="content">
        <ErrorNote message={periods.error ?? scopes.error ?? report.error ?? downloadError} />

        <Card title="What to report on">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="r-scope">Scope</label>
              <select id="r-scope" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}>
                <option value="all">Everything I can see</option>
                {(scopes.data?.accounts.length ?? 0) > 0 && (
                  <optgroup label="Accounts">
                    {scopes.data?.accounts.map((a) => (
                      <option key={a.id} value={`account:${a.id}`}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </optgroup>
                )}
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
              <label htmlFor="r-period">Bi-weekly period</label>
              <select id="r-period" value={period ?? ''} onChange={(e) => setChosen(e.target.value)}>
                {periods.data?.periods.map((p) => (
                  <option key={p.from} value={p.from}>
                    {periodLabel(p)}
                    {p.from === periods.data?.current.from ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Jump</label>
              <div className="row">
                <button
                  className="btn sm"
                  onClick={() => {
                    const list = periods.data?.periods ?? [];
                    const i = list.findIndex((p) => p.from === period);
                    if (i >= 0 && i < list.length - 1) setChosen(list[i + 1].from);
                  }}
                  disabled={!periods.data || periods.data.periods[periods.data.periods.length - 1]?.from === period}
                >
                  ← Previous
                </button>
                <button className="btn sm" onClick={() => setChosen(null)}>
                  This period
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    const list = periods.data?.periods ?? [];
                    const i = list.findIndex((p) => p.from === period);
                    if (i > 0) setChosen(list[i - 1].from);
                  }}
                  disabled={!periods.data || periods.data.current.from === period}
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
              <Stat
                label="Outcomes"
                value={report.data.totals.outcomes}
                foot={`${report.data.totals.outcomesUnverified} unverified`}
              />
            </div>

            <Card title="Per member" hint="Sheet 1 of the workbook" flush>
              {report.data.members.length === 0 ? (
                <Empty title="Nobody in scope for this period" />
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
                <Empty title="No entries logged in this period" />
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

            <Card
              title="Outcomes"
              hint={`Sheet 4 of the workbook · ${report.data.outcomes.length} rows`}
              flush
            >
              {report.data.outcomes.length === 0 ? (
                <Empty title="Nothing landed in this window" />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Title</th>
                        <th>Team / project</th>
                        <th>Category</th>
                        <th>PM</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.data.outcomes.map((o) => (
                        <tr key={o.id}>
                          <td className="nowrap small">{formatDate(o.landedOn)}</td>
                          <td>
                            <div className="stack">
                              <span className="strong">{o.title}</span>
                              <span className="muted small">{o.narrative}</span>
                            </div>
                          </td>
                          <td className="small">
                            <div className="stack">
                              <span>{o.teamName}</span>
                              <span className="muted">{o.projectName}</span>
                            </div>
                          </td>
                          <td>
                            <OutcomeCategoryBadge category={o.category} />
                          </td>
                          <td className="nowrap">{o.pmName}</td>
                          <td>
                            {o.verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="neutral">Unverified</Badge>}
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
