import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Shell';
import { Card, Empty, ErrorNote, Loading, Stat, TaskMixBar, TaskMixLegend } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatRange, hours } from '../lib/format';
import type { DigestPreview, Overview } from '../lib/types';
import { useApi } from '../lib/useApi';

const BLURB: Record<string, string> = {
  ADMIN: 'Everything across the organisation, with full access to manage it.',
  VP: 'Everything across the organisation.',
  DIRECTOR: 'Your projects, their teams, and the work underneath.',
  PM: 'The teams you lead and the work they logged.',
  ENGINEER: 'The teams you are on and your own tasks.',
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error, loading } = useApi<Overview>('/overview');
  // Engineers never receive the bi-weekly digest, so there's nothing to preview.
  const digest = useApi<DigestPreview>(user?.role !== 'ENGINEER' ? '/digest/preview' : null);

  return (
    <>
      <PageHeader
        title={`Good to see you, ${user?.name.split(' ')[0]}`}
        subtitle={BLURB[user?.role ?? 'ENGINEER']}
      />
      <div className="content">
        <ErrorNote message={error} />
        {loading && <Loading />}

        {data && (
          <>
            <div className="grid stats">
              <Stat label="Projects" value={data.totals.projects} foot="in your view" />
              <Stat label="Teams" value={data.totals.teams} foot="in your view" />
              <Stat label="People" value={data.totals.members} foot="across those teams" />
              <Stat
                label="Hours this period"
                value={hours(data.totals.thisPeriod.hours)}
                foot={`${data.totals.thisPeriod.entries} entries · ${data.totals.thisPeriod.contributors} people`}
              />
              <Stat
                label="Blocked"
                value={data.totals.tasks.blocked}
                foot={`${data.totals.thisPeriod.blocked} blocked entries this period`}
              />
            </div>

            {digest.data && digest.data.items.length > 0 && (
              <Card
                title="This period"
                hint={`What the bi-weekly digest sends you · ${formatRange(digest.data.period.from, digest.data.period.to)}`}
                flush
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Scope</th>
                        <th className="num">Outcomes</th>
                        <th className="num">Tasks done</th>
                        <th className="num">Blocked</th>
                        <th className="num">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {digest.data.items.map((item) => (
                        <tr key={`${item.scope}:${item.id}`}>
                          <td>
                            <Link
                              to={item.scope === 'team' ? `/teams/${item.id}` : `/accounts/${item.id}`}
                              className="strong"
                            >
                              {item.label}
                            </Link>
                          </td>
                          <td className="num">{item.totals.outcomes}</td>
                          <td className="num">{item.totals.tasksDone}</td>
                          <td className="num">{item.totals.blockedEntries}</td>
                          <td className="num muted">{hours(item.totals.hours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <Card
              title="Task mix"
              hint={`Period ${formatRange(data.period.from, data.period.to)} · ${data.totals.tasks.total} tasks in scope`}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <TaskMixBar counts={data.totals.tasks} />
                <TaskMixLegend />
                <div className="row" style={{ gap: 20 }}>
                  <span className="small">
                    <strong>{data.totals.tasks.done}</strong> <span className="muted">done</span>
                  </span>
                  <span className="small">
                    <strong>{data.totals.tasks.inProgress}</strong>{' '}
                    <span className="muted">in progress</span>
                  </span>
                  <span className="small">
                    <strong>{data.totals.tasks.blocked}</strong> <span className="muted">blocked</span>
                  </span>
                  <span className="small">
                    <strong>{data.totals.tasks.todo}</strong> <span className="muted">to do</span>
                  </span>
                </div>
              </div>
            </Card>

            <Card
              title="Projects and their teams"
              hint="Click through for members, tasks and daily entries"
              flush
            >
              {data.projects.length === 0 ? (
                <Empty title="Nothing to show yet">
                  {user?.role === 'DIRECTOR'
                    ? 'Create a project, then attach the teams your PMs have built.'
                    : 'Once your team is attached to a project it will appear here.'}
                </Empty>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Director</th>
                        <th>Teams</th>
                        <th className="num">People</th>
                        <th className="num">Tasks</th>
                        <th className="num">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.projects.map((p) => {
                        const people = p.teams.reduce((s, t) => s + t.memberCount, 0);
                        const tasks = p.teams.reduce((s, t) => s + t.taskCount, 0);
                        const open = p.teams.reduce((s, t) => s + t.openTaskCount, 0);
                        return (
                          <tr key={p.id}>
                            <td>
                              <div className="stack">
                                <Link to={`/projects/${p.id}`} className="strong">
                                  {p.name}
                                </Link>
                                <span className="muted small">{p.code}</span>
                              </div>
                            </td>
                            <td>{p.director.name}</td>
                            <td>
                              {p.teams.length === 0 ? (
                                <span className="muted small">No teams attached</span>
                              ) : (
                                <div className="stack">
                                  {p.teams.map((t) => (
                                    <Link key={t.id} to={`/teams/${t.id}`} className="small">
                                      {t.name} <span className="muted">· {t.pm.name}</span>
                                    </Link>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="num">{people}</td>
                            <td className="num">{tasks}</td>
                            <td className="num">{open}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
