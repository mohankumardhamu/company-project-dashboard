import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Shell';
import { Badge, Card, Empty, ErrorNote, Loading } from '../components/ui';
import { formatRange, hours } from '../lib/format';
import type { Portfolio, PortfolioRiskItem } from '../lib/types';
import { useApi } from '../lib/useApi';

const RISK_TONE: Record<PortfolioRiskItem['type'], 'warn' | 'danger'> = {
  blocked: 'warn',
  overdue: 'warn',
  silentTeam: 'danger',
  staleOutcomes: 'danger',
};

function riskHref(accountId: string, item: PortfolioRiskItem): string {
  return item.teamId ? `/teams/${item.teamId}` : `/accounts/${accountId}`;
}

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="muted small">flat</span>;
  const up = value > 0;
  return (
    <span className="small" style={{ color: up ? 'var(--ok)' : 'var(--danger)' }}>
      {up ? '↑' : '↓'} {Math.abs(value)}
    </span>
  );
}

export default function PortfolioPage() {
  const { data, error, loading } = useApi<Portfolio>('/portfolio');

  return (
    <>
      <PageHeader
        title="Portfolio"
        subtitle={
          data
            ? `Which accounts need attention — ranked by risk and outcome trend, not alphabetically · ${formatRange(data.week.from, data.week.to)} vs the week before`
            : 'Which accounts need attention this week.'
        }
      />
      <div className="content">
        <ErrorNote message={error} />
        {loading && <Loading />}

        {data && (
          <Card flush>
            {data.accounts.length === 0 ? (
              <Empty title="No accounts yet" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th className="num">Projects</th>
                      <th className="num">Teams</th>
                      <th className="num">People</th>
                      <th>Outcomes</th>
                      <th>Tasks done</th>
                      <th>Risk</th>
                      <th>Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.accounts.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <div className="stack">
                            <Link to={`/accounts/${a.id}`} className="strong">
                              {a.name}
                            </Link>
                            <span className="muted small">
                              {a.code}
                              {a.ownerDirector ? ` · ${a.ownerDirector.name}` : ''}
                            </span>
                          </div>
                        </td>
                        <td className="num">{a.projectCount}</td>
                        <td className="num">{a.teamCount}</td>
                        <td className="num">{a.memberCount}</td>
                        <td>
                          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <span className="strong">{a.trend.outcomes.thisWeek}</span>
                            <Delta value={a.trend.outcomes.delta} />
                          </div>
                        </td>
                        <td>
                          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <span className="strong">{a.trend.tasksDone.thisWeek}</span>
                            <Delta value={a.trend.tasksDone.delta} />
                          </div>
                        </td>
                        <td>
                          {a.risk.items.length === 0 ? (
                            <Badge tone="ok">Clear</Badge>
                          ) : (
                            <div className="stack">
                              {a.risk.items.map((item, i) => (
                                <Link key={i} to={riskHref(a.id, item)}>
                                  <Badge tone={RISK_TONE[item.type]}>{item.label}</Badge>
                                </Link>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="muted small nowrap">
                          {hours(a.trend.hours.thisWeek)}{' '}
                          <span className="muted">
                            ({a.trend.hours.delta >= 0 ? '+' : ''}
                            {a.trend.hours.delta.toFixed(2)})
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
