import { useState, type FormEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Role } from '../lib/types';
import { Avatar, ErrorNote, Modal, RoleBadge } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '◧', roles: ['ADMIN', 'VP', 'DIRECTOR', 'PM', 'ENGINEER'] },
  { to: '/portfolio', label: 'Portfolio', icon: '◆', roles: ['ADMIN', 'VP', 'DIRECTOR'] },
  { to: '/accounts', label: 'Accounts', icon: '⬡', roles: ['ADMIN', 'VP', 'DIRECTOR', 'PM', 'ENGINEER'] },
  { to: '/projects', label: 'Projects', icon: '▤', roles: ['ADMIN', 'VP', 'DIRECTOR', 'PM', 'ENGINEER'] },
  { to: '/teams', label: 'Teams', icon: '◇', roles: ['ADMIN', 'VP', 'DIRECTOR', 'PM', 'ENGINEER'] },
  { to: '/register', label: 'Register', icon: '⌕', roles: ['ADMIN', 'VP', 'DIRECTOR', 'PM', 'ENGINEER'] },
  { to: '/my-work', label: 'My work', icon: '✓', roles: ['ENGINEER', 'PM'] },
  { to: '/reports', label: 'Reports', icon: '⇩', roles: ['ADMIN', 'PM', 'DIRECTOR', 'VP'] },
  { to: '/people', label: 'People', icon: '◍', roles: ['ADMIN', 'VP', 'DIRECTOR'] },
];

export default function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);
  if (!user) return null;
  const items = NAV.filter((i) => i.roles.includes(user.role));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">PD</span>
          <span>Project Dashboard</span>
        </div>

        <nav className="nav">
          <div className="nav-label">Workspace</div>
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="who">
          <div className="row" style={{ gap: 9, flexWrap: 'nowrap' }}>
            <Avatar name={user.name} />
            <div style={{ minWidth: 0 }}>
              <div className="who-name">{user.name}</div>
              <div className="who-mail">{user.email}</div>
            </div>
          </div>
          <RoleBadge role={user.role} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => setChangingPassword(true)}>
              Change password
            </button>
            <button className="btn sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="main">{children}</main>

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-password', form);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change your password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Change password" onClose={onClose}>
      {done ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p className="muted small">Your password has been changed.</p>
          <div className="form-actions">
            <button type="button" className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ErrorNote message={error} />
          <div className="form-grid">
            <div className="field">
              <label htmlFor="current-password">Current password</label>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={form.currentPassword}
                onChange={set('currentPassword')}
              />
            </div>
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={form.newPassword}
                onChange={set('newPassword')}
                placeholder="At least 8 characters"
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy && <span className="spinner" />}
              Change password
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}
