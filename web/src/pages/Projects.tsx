import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Shell';
import { Badge, Card, Empty, ErrorNote, Loading, Modal, ProjectStatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import type { AccountSummary, ProjectSummary } from '../lib/types';
import { useApi } from '../lib/useApi';

export default function Projects() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<ProjectSummary[]>('/projects');
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="A project holds the teams delivering it. Directors create projects and attach teams."
        actions={
          can('ADMIN', 'DIRECTOR') && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              New project
            </button>
          )
        }
      />
      <div className="content">
        <ErrorNote message={error} />
        {loading && <Loading />}

        {data && (
          <Card flush>
            {data.length === 0 ? (
              <Empty title="No projects yet">
                {can('ADMIN', 'DIRECTOR')
                  ? 'Create one to start attaching teams.'
                  : 'You will see a project here once one of your teams is attached to it.'}
              </Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Status</th>
                      <th>Account</th>
                      <th>Director</th>
                      <th>Dates</th>
                      <th className="num">Teams</th>
                      <th className="num">People</th>
                      <th className="num">Tasks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="stack">
                            <Link to={`/projects/${p.id}`} className="strong">
                              {p.name}
                            </Link>
                            <span className="muted small">
                              {p.code}
                              {p.description ? ` · ${p.description}` : ''}
                            </span>
                          </div>
                        </td>
                        <td>
                          <ProjectStatusBadge status={p.status} />
                        </td>
                        <td>
                          {p.account ? (
                            <Link to={`/accounts/${p.account.id}`}>
                              {p.account.code} — {p.account.name}
                            </Link>
                          ) : (
                            <Badge tone="warn">No account</Badge>
                          )}
                        </td>
                        <td className="nowrap">{p.director.name}</td>
                        <td className="nowrap small muted">
                          {p.startDate || p.endDate
                            ? `${formatDate(p.startDate)} → ${formatDate(p.endDate)}`
                            : '—'}
                        </td>
                        <td className="num">{p.teamCount}</td>
                        <td className="num">{p.memberCount}</td>
                        <td className="num">{p.taskCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>

      {creating && (
        <NewProjectModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '',
    code: '',
    description: '',
    status: 'ACTIVE',
    startDate: '',
    endDate: '',
    accountId: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: accounts } = useApi<AccountSummary[]>('/accounts');

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/projects', {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        status: form.status,
        ...(form.startDate ? { startDate: form.startDate } : {}),
        ...(form.endDate ? { endDate: form.endDate } : {}),
        ...(form.accountId ? { accountId: form.accountId } : {}),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the project');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorNote message={error} />
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="p-name">Name</label>
            <input id="p-name" required minLength={2} value={form.name} onChange={set('name')} />
          </div>
          <div className="field">
            <label htmlFor="p-code">Code</label>
            <input
              id="p-code"
              required
              minLength={2}
              maxLength={24}
              pattern="[A-Za-z0-9\-]+"
              placeholder="APEX"
              value={form.code}
              onChange={set('code')}
            />
            <span className="hint">Letters, numbers and hyphens. Must be unique.</span>
          </div>
          <div className="field">
            <label htmlFor="p-status">Status</label>
            <select id="p-status" value={form.status} onChange={set('status')}>
              <option value="PLANNING">Planning</option>
              <option value="ACTIVE">Active</option>
              <option value="ON_HOLD">On hold</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-account">Account</label>
            <select id="p-account" value={form.accountId} onChange={set('accountId')}>
              <option value="">No account yet</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-start">Start date</label>
            <input id="p-start" type="date" value={form.startDate} onChange={set('startDate')} />
          </div>
          <div className="field">
            <label htmlFor="p-end">End date</label>
            <input id="p-end" type="date" value={form.endDate} onChange={set('endDate')} />
          </div>
          <div className="field span-2">
            <label htmlFor="p-desc">Description</label>
            <textarea id="p-desc" value={form.description} onChange={set('description')} />
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" />}
            Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}
