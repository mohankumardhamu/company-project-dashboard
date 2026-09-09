import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Shell';
import { AccountStatusBadge, Card, Empty, ErrorNote, Loading, Modal } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { AccountSummary } from '../lib/types';
import { useApi } from '../lib/useApi';

export default function Accounts() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<AccountSummary[]>('/accounts');
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="An account is a client. Directors create accounts and Directors attach projects to them."
        actions={
          can('ADMIN', 'DIRECTOR') && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              New account
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
              <Empty title="No accounts yet">
                {can('ADMIN', 'DIRECTOR')
                  ? 'Create one, then attach the projects delivering for that client.'
                  : 'You will see an account here once one of your projects is attached to it.'}
              </Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Status</th>
                      <th>Owning director</th>
                      <th className="num">Projects</th>
                      <th className="num">Teams</th>
                      <th className="num">People</th>
                      <th className="num">Tasks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <div className="stack">
                            <Link to={`/accounts/${a.id}`} className="strong">
                              {a.name}
                            </Link>
                            <span className="muted small">{a.code}</span>
                          </div>
                        </td>
                        <td>
                          <AccountStatusBadge status={a.status} />
                        </td>
                        <td className="nowrap">{a.ownerDirector?.name ?? <span className="muted">—</span>}</td>
                        <td className="num">{a.projectCount}</td>
                        <td className="num">{a.teamCount}</td>
                        <td className="num">{a.memberCount}</td>
                        <td className="num">{a.taskCount}</td>
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
        <NewAccountModal
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

function NewAccountModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', code: '', status: 'ACTIVE' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/accounts', {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        status: form.status,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New account" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorNote message={error} />
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="a-name">Client name</label>
            <input id="a-name" required minLength={2} value={form.name} onChange={set('name')} />
          </div>
          <div className="field">
            <label htmlFor="a-code">Code</label>
            <input
              id="a-code"
              required
              minLength={2}
              maxLength={24}
              pattern="[A-Za-z0-9\-]+"
              placeholder="ACME"
              value={form.code}
              onChange={set('code')}
            />
            <span className="hint">Letters, numbers and hyphens. Must be unique.</span>
          </div>
          <div className="field">
            <label htmlFor="a-status">Status</label>
            <select id="a-status" value={form.status} onChange={set('status')}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>
        <p className="hint">A Director who creates an account becomes its owning director.</p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" />}
            Create account
          </button>
        </div>
      </form>
    </Modal>
  );
}
