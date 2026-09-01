import { useState, type FormEvent } from 'react';
import { PageHeader } from '../components/Shell';
import { Avatar, Badge, Card, Empty, ErrorNote, Loading, Modal, RoleBadge } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import type { DirectoryUser, Role } from '../lib/types';
import { useApi } from '../lib/useApi';

const CREATABLE: Record<string, Role[]> = {
  ADMIN: ['ADMIN', 'VP', 'DIRECTOR', 'PM', 'ENGINEER'],
  VP: ['VP', 'DIRECTOR', 'PM', 'ENGINEER'],
  DIRECTOR: ['PM', 'ENGINEER'],
};

const ROLE_HELP: Record<Role, string> = {
  ADMIN: 'Full access: onboards anyone, including other Admins, and manages every resource.',
  VP: 'Reads everything across the organisation.',
  DIRECTOR: 'Creates projects and attaches teams to them.',
  PM: 'Creates teams, adds members, assigns tasks, exports reports.',
  ENGINEER: 'Logs daily work against the tasks assigned to them.',
};

export default function People() {
  const { user, can } = useAuth();
  const { data, error, loading, reload } = useApi<DirectoryUser[]>('/users');
  const [inviting, setInviting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggleActive(u: DirectoryUser) {
    setActionError(null);
    try {
      await api.patch(`/users/${u.id}`, { active: !u.active });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update the account');
    }
  }

  return (
    <>
      <PageHeader
        title="People"
        subtitle={
          can('ADMIN', 'VP')
            ? 'You can onboard anyone and deactivate accounts.'
            : 'You can onboard PMs and Engineers.'
        }
        actions={
          <button className="btn primary" onClick={() => setInviting(true)}>
            Add person
          </button>
        }
      />
      <div className="content">
        <ErrorNote message={error ?? actionError} />
        {loading && <Loading />}

        {data && (
          <Card flush>
            {data.length === 0 ? (
              <Empty title="No accounts yet" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>What they can do</th>
                      <th>Added</th>
                      <th>Status</th>
                      {can('ADMIN', 'VP') && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                            <Avatar name={u.name} />
                            <div className="stack">
                              <span className="strong">
                                {u.name}
                                {u.id === user?.id && <span className="muted small"> · you</span>}
                              </span>
                              <span className="muted small">{u.email}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <RoleBadge role={u.role} />
                        </td>
                        <td className="small muted">{ROLE_HELP[u.role]}</td>
                        <td className="small muted nowrap">{formatDate(u.createdAt)}</td>
                        <td>
                          {u.active ? (
                            <Badge tone="ok">Active</Badge>
                          ) : (
                            <Badge tone="danger">Deactivated</Badge>
                          )}
                        </td>
                        {can('ADMIN', 'VP') && (
                          <td style={{ textAlign: 'right' }}>
                            {u.id !== user?.id && (
                              <button className="btn sm ghost" onClick={() => toggleActive(u)}>
                                {u.active ? 'Deactivate' : 'Reactivate'}
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
        )}
      </div>

      {inviting && user && (
        <NewUserModal
          allowedRoles={CREATABLE[user.role] ?? []}
          onClose={() => setInviting(false)}
          onCreated={() => {
            setInviting(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function NewUserModal({
  allowedRoles,
  onClose,
  onCreated,
}: {
  allowedRoles: Role[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: allowedRoles[allowedRoles.length - 1] ?? 'ENGINEER',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/users', {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role: form.role,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a person" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorNote message={error} />
        <div className="form-grid">
          <div className="field">
            <label htmlFor="u-name">Full name</label>
            <input id="u-name" required minLength={2} value={form.name} onChange={set('name')} />
          </div>
          <div className="field">
            <label htmlFor="u-email">Email</label>
            <input id="u-email" type="email" required value={form.email} onChange={set('email')} />
          </div>
          <div className="field">
            <label htmlFor="u-role">Role</label>
            <select id="u-role" value={form.role} onChange={set('role')}>
              {allowedRoles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <span className="hint">{ROLE_HELP[form.role as Role]}</span>
          </div>
          <div className="field">
            <label htmlFor="u-password">Temporary password</label>
            <input
              id="u-password"
              type="text"
              required
              minLength={8}
              value={form.password}
              onChange={set('password')}
              placeholder="At least 8 characters"
            />
            <span className="hint">Share it with them directly; they sign in with it.</span>
          </div>
        </div>
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
