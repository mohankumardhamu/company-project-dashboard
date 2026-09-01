import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Shell';
import { Badge, Card, Empty, ErrorNote, Loading, Modal } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { TeamSummary } from '../lib/types';
import { useApi } from '../lib/useApi';

export default function Teams() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<TeamSummary[]>('/teams');
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle="PMs create teams and staff them. A Director then attaches a team to a project."
        actions={
          can('PM') && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              New team
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
              <Empty title="No teams yet">
                {can('PM') ? 'Create your first team, then add members to it.' : 'You are not on a team yet.'}
              </Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>PM</th>
                      <th>Project</th>
                      <th className="num">Members</th>
                      <th className="num">Tasks</th>
                      <th className="num">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <div className="stack">
                            <Link to={`/teams/${t.id}`} className="strong">
                              {t.name}
                            </Link>
                            {t.description && <span className="muted small">{t.description}</span>}
                          </div>
                        </td>
                        <td className="nowrap">{t.pm.name}</td>
                        <td>
                          {t.project ? (
                            <Link to={`/projects/${t.project.id}`}>
                              {t.project.code} — {t.project.name}
                            </Link>
                          ) : (
                            <Badge tone="warn">Not on a project</Badge>
                          )}
                        </td>
                        <td className="num">{t.memberCount}</td>
                        <td className="num">{t.taskCount}</td>
                        <td className="num">{t.openTaskCount}</td>
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
        <NewTeamModal
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

function NewTeamModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/teams', {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the team');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New team" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorNote message={error} />
        <div className="field">
          <label htmlFor="t-name">Name</label>
          <input id="t-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="t-desc">What the team does</label>
          <textarea id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <p className="hint">
          You become the team's PM. Add members next, then ask a Director to attach the team to a project.
        </p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy && <span className="spinner" />}
            Create team
          </button>
        </div>
      </form>
    </Modal>
  );
}
