import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Shell';
import { Badge, Card, Empty, ErrorNote, Loading, OutcomeCategoryBadge } from '../components/ui';
import { formatDate } from '../lib/format';
import type { AccountSummary, OutcomeCategory, RegisterResult } from '../lib/types';
import { useApi } from '../lib/useApi';

const CATEGORY_OPTIONS: Array<{ value: OutcomeCategory; label: string }> = [
  { value: 'REVENUE_ENABLED', label: 'Revenue enabled' },
  { value: 'COST_SAVED', label: 'Cost saved' },
  { value: 'RISK_REDUCED', label: 'Risk reduced' },
  { value: 'CAPABILITY_BUILT', label: 'Capability built' },
  { value: 'CUSTOMER_VISIBLE', label: 'Customer-visible' },
];

export default function Register() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const accountsApi = useApi<AccountSummary[]>('/accounts');

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (category) params.set('category', category);
  if (accountId) params.set('accountId', accountId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();

  const { data, error, loading } = useApi<{ results: RegisterResult[] }>(`/register${query ? `?${query}` : ''}`, [
    query,
  ]);

  return (
    <>
      <PageHeader
        title="Register"
        subtitle="Search outcomes and completed work across every account. Work you can't see the team behind still shows up — redacted to the headline — so you know who to ask."
      />
      <div className="content">
        <Card title="Search">
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="reg-q">Search</label>
              <input
                id="reg-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="settlement, autoscaling, checkout…"
              />
            </div>
            <div className="field">
              <label htmlFor="reg-category">Category</label>
              <select id="reg-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Any category</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span className="hint">Only outcomes carry a category — completed tasks drop out of the results.</span>
            </div>
            <div className="field">
              <label htmlFor="reg-account">Account</label>
              <select id="reg-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Any account</option>
                {(accountsApi.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reg-from">From</label>
              <input id="reg-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="reg-to">To</label>
              <input id="reg-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </Card>

        <ErrorNote message={error} />
        {loading && <Loading />}

        {data && (
          <Card
            title="Results"
            hint={`${data.results.length} result${data.results.length === 1 ? '' : 's'} · sorted by relevance, then recency`}
            flush
          >
            {data.results.length === 0 ? (
              <Empty title="No matches">Try a different search, or widen the filters.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Category</th>
                      <th>Account</th>
                      <th>Team</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map((r) => (
                      <tr key={`${r.kind}:${r.id}`}>
                        <td>
                          <div className="stack">
                            <span className="strong">{r.title}</span>
                            {r.narrative && <span className="muted small">{r.narrative}</span>}
                            {r.personName && (
                              <span className="muted small">
                                {r.kind === 'task' ? 'Assignee' : 'PM'}: {r.personName}
                              </span>
                            )}
                            {r.redacted && (
                              <span className="small">
                                <Badge tone="neutral">Redacted — you can't read this team</Badge>
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          {r.category ? (
                            <OutcomeCategoryBadge category={r.category} />
                          ) : (
                            <Badge tone="brand">Completed task</Badge>
                          )}
                        </td>
                        <td className="nowrap small">
                          {r.accountId ? (
                            <Link to={`/accounts/${r.accountId}`}>
                              {r.accountCode} — {r.accountName}
                            </Link>
                          ) : r.accountName ? (
                            <span>
                              {r.accountCode} — {r.accountName}
                            </span>
                          ) : (
                            <span className="muted">Unassigned</span>
                          )}
                        </td>
                        <td className="nowrap small">
                          {r.teamId ? <Link to={`/teams/${r.teamId}`}>{r.teamName}</Link> : <span>{r.teamName}</span>}
                        </td>
                        <td className="nowrap small">{formatDate(r.date)}</td>
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
