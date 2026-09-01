import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import type { Role } from '../lib/types';
import { Avatar, RoleBadge } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '◧', roles: ['VP', 'DIRECTOR', 'PM', 'ENGINEER'] },
  { to: '/projects', label: 'Projects', icon: '▤', roles: ['VP', 'DIRECTOR', 'PM', 'ENGINEER'] },
  { to: '/teams', label: 'Teams', icon: '◇', roles: ['VP', 'DIRECTOR', 'PM', 'ENGINEER'] },
  { to: '/my-work', label: 'My work', icon: '✓', roles: ['ENGINEER', 'PM'] },
  { to: '/reports', label: 'Reports', icon: '⇩', roles: ['PM', 'DIRECTOR', 'VP'] },
  { to: '/people', label: 'People', icon: '◍', roles: ['VP', 'DIRECTOR'] },
];

export default function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
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
          <button className="btn sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
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
