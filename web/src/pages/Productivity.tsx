import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HBarChart, VBarChart, type BarDatum } from '../components/charts';
import { PageHeader } from '../components/Shell';
import { Badge, Card, Empty, ErrorNote, Loading, Stat } from '../components/ui';
import { hours } from '../lib/format';
import { periodLabel, usePeriods } from '../lib/periods';
import type { Productivity, TeamSummary } from '../lib/types';
import { useApi } from '../lib/useApi';

const short = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' });

export default function ProductivityPage() {
  const periods = usePeriods(26);
  const teams = useApi<TeamSummary[]>('/teams');
  const [period, setPeriod] = useState<string | null>(null);
  const [teamId, setTeamId] = useState('');
  const chosen = period ?? periods.data?.current.from ?? null;

  const query = chosen ? new URLSearchParams({ period: chosen, ...(teamId ? { teamId } : {}) }).toString() : null;
  const { data, error, loading } = useApi<Productivity>(query ? `/productivity?${query}` : null, [query]);

  const people = data ? [...data.people].sort((a, b) => b.current.storyPoints - a.current.storyPoints) : [];
  const nameOf = new Map(data?.people.map((p) => [p.id, p.name]));

  const pointsByPerson: BarDatum[] = people.map((p) => ({
    key: p.id,
    label: p.name,
    value: p.current.storyPoints,
    detail: [`${p.current.storiesCompleted} of ${p.current.storiesTotal} stories completed`],
  }));
  const hoursByPerson: BarDatum[] = [...people]
    .sort((a, b) => b.current.timeSpent - a.current.timeSpent)
    .map((p) => ({
      key: p.id,
      label: p.name,
      value: p.current.timeSpent,
      detail: [`${p.current.todo} h still to do`],
    }));
  const pointsTrend: BarDatum[] = (data?.trend ?? []).map((t) => ({
    key: t.from,
    label: short(t.from),
    value: t.storyPoints,
    detail: [periodLabel(t), `${t.storiesCompleted} stories completed`],
    emphasis: t.from === data?.period.from,
  }));
  const hoursTrend: BarDatum[] = (data?.trend ?? []).map((t) => ({
    key: t.from,
    label: short(t.from),
    value: t.timeSpent,
    detail: [periodLabel(t)],
    emphasis: t.from === data?.period.from,
  }));

  return (
    <>
      <PageHeader
        title="Productivity"
        subtitle="Story points, stories completed and time spent per person for each bi-weekly period, from imported Rally data."
      />
      <div className="content">
        <ErrorNote message={periods.error ?? teams.error ?? error} />

        <Card>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="p-period">Bi-weekly period</label>
              <select id="p-period" value={chosen ?? ''} onChange={(e) => setPeriod(e.target.value)}>
                {periods.data?.periods.map((p) => (
                  <option key={p.from} value={p.from}>
                    {periodLabel(p)}
                    {p.from === periods.data?.current.from ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="p-team">Team</label>
              <select id="p-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">Everyone I can see</option>
                {teams.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {loading && !data && <Loading label="Crunching Rally data…" />}

        {data && (
          <>
            <div className="grid stats">
              <Stat
                label="Story points"
                value={data.totals.storyPoints}
                foot={`completed of ${data.totals.pointsPlanned} planned`}
              />
              <Stat
                label="Stories completed"
                value={data.totals.storiesCompleted}
                foot={`of ${data.totals.storiesTotal} work products`}
              />
              <Stat label="Time spent" value={hours(data.totals.timeSpent)} foot={`${hours(data.totals.todo)} still to do`} />
              <Stat
                label="People with data"
                value={`${data.people.filter((p) => p.hasData).length} / ${data.people.length}`}
                foot={<Link to="/imports">See data availability</Link>}
              />
            </div>

            {data.items.length === 0 && (
              <div className="alert info">
                No Rally data has been imported for {periodLabel(data.period)} yet.{' '}
                <Link to="/imports">Import a Rally export</Link> to fill this in.
              </div>
            )}

            <div className="grid charts">
              <Card title="Story points by person" hint={`Completed (${data.doneStates.join(' / ')}) · ${periodLabel(data.period)}`}>
                {people.length === 0 ? (
                  <Empty title="Nobody in scope" />
                ) : (
                  <HBarChart data={pointsByPerson} unit="points" ariaLabel="Story points completed by person" />
                )}
              </Card>
              <Card title="Time spent by person" hint={`Hours from Rally Time Spent · ${periodLabel(data.period)}`}>
                {people.length === 0 ? (
                  <Empty title="Nobody in scope" />
                ) : (
                  <HBarChart data={hoursByPerson} unit="h" ariaLabel="Hours spent by person" />
                )}
              </Card>
              <Card title="Story points per period" hint="Last six bi-weekly periods">
                <VBarChart data={pointsTrend} unit="points" ariaLabel="Story points completed per period" />
              </Card>
              <Card title="Time spent per period" hint="Last six bi-weekly periods, in hours">
                <VBarChart data={hoursTrend} unit="h" ariaLabel="Hours spent per period" />
              </Card>
            </div>

            <Card title="Per person" hint="The numbers behind the charts" flush>
              {people.length === 0 ? (
                <Empty title="Nobody in scope" />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th className="num">Story points</th>
                        <th className="num">Completed</th>
                        <th className="num">Planned points</th>
                        <th className="num">Time spent</th>
                        <th className="num">ToDo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {people.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="stack">
                              <span className="strong">{p.name}</span>
                              <span className="muted small">
                                {[p.jobTitle, p.department, p.employeeNumber].filter(Boolean).join(' · ') || p.email}
                              </span>
                            </div>
                          </td>
                          {p.hasData ? (
                            <>
                              <td className="num">{p.current.storyPoints}</td>
                              <td className="num">
                                {p.current.storiesCompleted} / {p.current.storiesTotal}
                              </td>
                              <td className="num">{p.current.pointsPlanned}</td>
                              <td className="num">{hours(p.current.timeSpent)}</td>
                              <td className="num">{hours(p.current.todo)}</td>
                            </>
                          ) : (
                            <td colSpan={5} className="num">
                              <Badge tone="warn">no Rally data this period</Badge>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Work products" hint={`Everything imported for ${periodLabel(data.period)} · ${data.items.length} rows`} flush>
              {data.items.length === 0 ? (
                <Empty title="Nothing imported for this period" />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Work product</th>
                        <th>Release</th>
                        <th>State</th>
                        <th className="num">Estimate</th>
                        <th className="num">Time spent</th>
                        <th className="num">ToDo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((it) => (
                        <tr key={it.id}>
                          <td className="nowrap">{nameOf.get(it.userId)}</td>
                          <td>{it.workProduct}</td>
                          <td className="small muted">{it.release ?? '—'}</td>
                          <td>
                            <Badge tone={it.done ? 'ok' : 'neutral'}>{it.state}</Badge>
                          </td>
                          <td className="num">{it.estimate}</td>
                          <td className="num">{it.timeSpent}</td>
                          <td className="num">{it.todo}</td>
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
