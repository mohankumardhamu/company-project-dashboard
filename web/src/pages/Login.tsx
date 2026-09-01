import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ErrorNote } from '../components/ui';

const DEMO_ACCOUNTS = [
  { role: 'Admin', email: 'admin@acme.com', note: 'onboards anyone and manages everything' },
  { role: 'VP', email: 'vp@acme.com', note: 'sees the whole organisation' },
  { role: 'Director', email: 'director.eng@acme.com', note: 'owns the APEX project' },
  { role: 'PM', email: 'pm.payments@acme.com', note: 'leads Payments Core' },
  { role: 'Engineer', email: 'eng.anita@acme.com', note: 'logs daily work' },
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <aside className="login-aside">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">PD</span>
          <span>Project Dashboard</span>
        </div>
        <h2>One view of every project, team, member and task.</h2>
        <ul>
          <li>
            <strong>Admins</strong> onboard every account and hold full access to every resource.
          </li>
          <li>
            <strong>Engineers</strong> log what they did each day against their tasks.
          </li>
          <li>
            <strong>PMs</strong> build teams, assign tasks, and export the weekly report.
          </li>
          <li>
            <strong>Directors</strong> create projects, attach teams, and drill all the way down.
          </li>
          <li>
            <strong>VPs</strong> see everything across the organisation.
          </li>
        </ul>
      </aside>

      <div className="login-main">
        <div className="login-card">
          <div>
            <h1>Sign in</h1>
            <p className="muted small" style={{ marginTop: 4 }}>
              Use your work email and password.
            </p>
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ErrorNote message={error} />
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy && <span className="spinner" />}
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div>
            <div className="hint" style={{ marginBottom: 8 }}>
              Demo accounts — click to fill, password <code>Passw0rd!</code>
            </div>
            <div className="demo-list">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  type="button"
                  key={a.email}
                  className="demo-row"
                  onClick={() => {
                    setEmail(a.email);
                    setPassword('Passw0rd!');
                  }}
                >
                  <span>
                    <strong>{a.role}</strong> · {a.email}
                  </span>
                  <span className="muted">{a.note}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
