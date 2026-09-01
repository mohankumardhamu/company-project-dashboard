import { useEffect, type ReactNode } from 'react';
import type { ProjectStatus, Role, TaskPriority, TaskStatus, WorkLogStatus } from '../lib/types';

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

const TASK_TONE: Record<TaskStatus, Tone> = {
  TODO: 'neutral',
  IN_PROGRESS: 'brand',
  BLOCKED: 'danger',
  DONE: 'ok',
};
const TASK_LABEL: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  DONE: 'Done',
};
export const TaskStatusBadge = ({ status }: { status: TaskStatus }) => (
  <Badge tone={TASK_TONE[status]}>{TASK_LABEL[status]}</Badge>
);

const PRIORITY_TONE: Record<TaskPriority, Tone> = {
  LOW: 'neutral',
  MEDIUM: 'neutral',
  HIGH: 'warn',
  CRITICAL: 'danger',
};
const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};
export const PriorityBadge = ({ priority }: { priority: TaskPriority }) => (
  <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>
);

const PROJECT_TONE: Record<ProjectStatus, Tone> = {
  PLANNING: 'neutral',
  ACTIVE: 'ok',
  ON_HOLD: 'warn',
  COMPLETED: 'brand',
};
const PROJECT_LABEL: Record<ProjectStatus, string> = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
};
export const ProjectStatusBadge = ({ status }: { status: ProjectStatus }) => (
  <Badge tone={PROJECT_TONE[status]}>{PROJECT_LABEL[status]}</Badge>
);

const LOG_TONE: Record<WorkLogStatus, Tone> = {
  ON_TRACK: 'ok',
  AT_RISK: 'warn',
  BLOCKED: 'danger',
  COMPLETED: 'brand',
};
const LOG_LABEL: Record<WorkLogStatus, string> = {
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  BLOCKED: 'Blocked',
  COMPLETED: 'Completed',
};
export const WorkLogStatusBadge = ({ status }: { status: WorkLogStatus }) => (
  <Badge tone={LOG_TONE[status]}>{LOG_LABEL[status]}</Badge>
);

const ROLE_TONE: Record<Role, Tone> = {
  ADMIN: 'danger',
  VP: 'brand',
  DIRECTOR: 'brand',
  PM: 'warn',
  ENGINEER: 'neutral',
};
const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  VP: 'VP',
  DIRECTOR: 'Director',
  PM: 'PM',
  ENGINEER: 'Engineer',
};
export const RoleBadge = ({ role }: { role: Role }) => (
  <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>
);

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return <span className={large ? 'avatar lg' : 'avatar'}>{initials || '?'}</span>;
}

export function Card({
  title,
  hint,
  actions,
  children,
  flush = false,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          <div>
            {typeof title === 'string' ? <h2>{title}</h2> : title}
            {hint && <div className="hint">{hint}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'card-body tight' : 'card-body'}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  foot,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="alert error">{message}</div>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="page-loading">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Task mix as one horizontal bar — the fastest read on a team's health. */
export function TaskMixBar({
  counts,
}: {
  counts: { todo: number; inProgress: number; blocked: number; done: number };
}) {
  const total = counts.todo + counts.inProgress + counts.blocked + counts.done;
  if (total === 0) return <div className="bar" />;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="bar" title={`${counts.done} done · ${counts.inProgress} in progress · ${counts.blocked} blocked · ${counts.todo} to do`}>
      <span className="seg-done" style={{ width: pct(counts.done) }} />
      <span className="seg-progress" style={{ width: pct(counts.inProgress) }} />
      <span className="seg-blocked" style={{ width: pct(counts.blocked) }} />
      <span className="seg-todo" style={{ width: pct(counts.todo) }} />
    </div>
  );
}

export function TaskMixLegend() {
  return (
    <div className="legend">
      <span><span className="dot" style={{ background: 'var(--ok)' }} />Done</span>
      <span><span className="dot" style={{ background: 'var(--brand)' }} />In progress</span>
      <span><span className="dot" style={{ background: 'var(--danger)' }} />Blocked</span>
      <span><span className="dot" style={{ background: 'var(--line-2)' }} />To do</span>
    </div>
  );
}
