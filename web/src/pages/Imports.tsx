import { useRef, useState, type ReactNode } from 'react';
import { PageHeader } from '../components/Shell';
import { Badge, Card, Empty, ErrorNote, Loading, Stat } from '../components/ui';
import { uploadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import { periodLabel, usePeriods } from '../lib/periods';
import type { ImportAction, ImportBatch, ImportStatus, KekaPlan, RallyPlan } from '../lib/types';
import { useApi } from '../lib/useApi';

const ACTION_TONE: Record<ImportAction, 'ok' | 'brand' | 'warn'> = { create: 'ok', update: 'brand', skip: 'warn' };
const ACTION_LABEL: Record<ImportAction, string> = { create: 'new', update: 'update', skip: 'skipped' };

const shortRange = (p: { from: string }) =>
  new Date(`${p.from}T00:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' });

const when = (iso: string) => `${formatDate(iso)} ${iso.slice(11, 16)} UTC`;

/**
 * Two-step upload: Preview parses and matches every row without writing
 * anything; Import re-sends the same file with commit=true. Skipped rows are
 * listed with the reason, so nothing is dropped silently.
 */
function UploadPanel<P extends RallyPlan | KekaPlan>({
  endpoint,
  accept,
  extraParams,
  controls,
  renderRows,
  onImported,
  idPrefix,
}: {
  endpoint: string;
  accept: string;
  extraParams: Record<string, string> | null;
  controls?: ReactNode;
  renderRows: (plan: P) => ReactNode;
  onImported: () => void;
  idPrefix: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<P | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(commit: boolean) {
    if (!file || !extraParams) return;
    setBusy(commit ? 'commit' : 'preview');
    setError(null);
    setDone(null);
    try {
      const result = await uploadFile<P>(endpoint, file, { ...extraParams, commit: String(commit) });
      setPlan(result);
      if (commit) {
        setDone(
          `Imported ${result.toCreate + result.toUpdate} rows from ${result.fileName}` +
            (result.skipped ? ` · ${result.skipped} skipped` : '')
        );
        setFile(null);
        if (input.current) input.current.value = '';
        onImported();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(null);
    }
  }

  const importable = plan ? plan.toCreate + plan.toUpdate : 0;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="form-grid">
        {controls}
        <div className="field">
          <label htmlFor={`${idPrefix}-file`}>File</label>
          <input
            id={`${idPrefix}-file`}
            ref={input}
            type="file"
            accept={accept}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPlan(null);
              setDone(null);
              setError(null);
            }}
          />
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={() => run(false)} disabled={!file || !extraParams || busy !== null}>
          {busy === 'preview' && <span className="spinner" />}
          Preview
        </button>
        <button
          className="btn primary"
          onClick={() => run(true)}
          disabled={!file || !plan || plan.committed || importable === 0 || busy !== null}
        >
          {busy === 'commit' && <span className="spinner" />}
          Import {plan && !plan.committed ? `${importable} rows` : ''}
        </button>
      </div>
      <ErrorNote message={error} />
      {done && <div className="alert ok">{done}</div>}
      {plan && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <Badge tone="ok">{plan.toCreate} new</Badge>
            <Badge tone="brand">{plan.toUpdate} update</Badge>
            <Badge tone={plan.skipped ? 'warn' : 'neutral'}>{plan.skipped} skipped</Badge>
            <span className="muted small">
              {plan.totalRows} rows in {plan.fileName}
              {plan.source === 'RALLY' ? ` · period ${periodLabel(plan.period)}` : ''}
              {plan.committed ? ' · imported' : ' · preview only, nothing saved yet'}
            </span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
            {renderRows(plan)}
          </div>
        </>
      )}
    </div>
  );
}

const ActionCell = ({ action, reason }: { action: ImportAction; reason?: string }) => (
  <div className="stack import-result">
    <Badge tone={ACTION_TONE[action]}>{ACTION_LABEL[action]}</Badge>
    {reason && <span className="small" style={{ color: 'var(--warn)' }}>{reason}</span>}
  </div>
);

function BatchTable({ rows }: { rows: ImportBatch[] }) {
  if (rows.length === 0) return <Empty title="Nothing imported yet" />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Source</th>
            <th>File</th>
            <th>Period</th>
            <th>By</th>
            <th className="num">Imported</th>
            <th className="num">Skipped</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td className="nowrap small">{when(b.createdAt)}</td>
              <td>
                <Badge tone="neutral">{b.source === 'RALLY' ? 'Rally' : 'Keka'}</Badge>
              </td>
              <td className="small">{b.fileName}</td>
              <td className="nowrap small">{b.periodStart ? formatDate(b.periodStart) : '—'}</td>
              <td className="nowrap">{b.uploadedBy}</td>
              <td className="num">{b.importedRows}</td>
              <td className="num">{b.skippedRows ? <Badge tone="warn">{b.skippedRows}</Badge> : 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Imports() {
  const { user } = useAuth();
  const status = useApi<ImportStatus>('/imports/status');
  const periods = usePeriods(12);
  const [period, setPeriod] = useState<string | null>(null);
  const chosenPeriod = period ?? periods.data?.current.from ?? null;

  if (!user) return null;
  const canRally = user.role !== 'VP';
  const canKeka = user.role === 'ADMIN' || user.role === 'VP';
  const s = status.data;

  return (
    <>
      <PageHeader
        title="Imports"
        subtitle="Load Rally and Keka exports instead of typing data in. Every upload is previewed first, and skipped rows are listed with the reason."
      />
      <div className="content">
        <ErrorNote message={status.error ?? periods.error} />
        {status.loading && !s && <Loading />}

        {s && (
          <div className="grid stats">
            <Stat
              label="Last Rally import"
              value={s.rally.lastImport ? formatDate(s.rally.lastImport.createdAt) : 'Never'}
              foot={s.rally.lastImport ? `by ${s.rally.lastImport.uploadedBy}` : 'No Rally data yet'}
            />
            <Stat
              label="Rally data this period"
              value={`${s.rally.withDataCurrent} / ${s.rally.people}`}
              foot={`people · ${s.rally.withDataPrevious} had data last period`}
            />
            {s.keka && (
              <Stat
                label="Keka directory"
                value={s.keka.employees}
                foot={
                  s.keka.lastImport
                    ? `${s.keka.linked} linked to a login · updated ${formatDate(s.keka.lastImport.createdAt)}`
                    : 'Never imported'
                }
              />
            )}
            {s.keka && (
              <Stat label="Logins not in Keka" value={s.keka.loginsWithoutRecord} foot="no matching Display Name" />
            )}
          </div>
        )}

        {canRally && (
          <Card
            title="Import a Rally export"
            hint="An .xlsx with Work Product, Release, State, Estimate, ToDo, Time Spent and Owner. Owner is matched to a login by display name, or by email."
          >
            <UploadPanel<RallyPlan>
              idPrefix="rally"
              endpoint="/imports/rally"
              accept=".xlsx,.csv"
              extraParams={chosenPeriod ? { period: chosenPeriod } : null}
              onImported={status.reload}
              controls={
                <div className="field">
                  <label htmlFor="rally-period">Bi-weekly period this sheet covers</label>
                  <select id="rally-period" value={chosenPeriod ?? ''} onChange={(e) => setPeriod(e.target.value)}>
                    {periods.data?.periods.map((p) => (
                      <option key={p.from} value={p.from}>
                        {periodLabel(p)}
                        {p.from === periods.data?.current.from ? ' (current)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              }
              renderRows={(plan) => (
                <table>
                  <thead>
                    <tr>
                      <th className="num">Row</th>
                      <th>Work product</th>
                      <th>State</th>
                      <th className="num">Estimate</th>
                      <th className="num">Time spent</th>
                      <th className="num">ToDo</th>
                      <th>Owner</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="num muted">{r.rowNumber}</td>
                        <td>
                          <div className="stack">
                            <span>{r.workProduct || <span className="muted">—</span>}</span>
                            {r.release && <span className="muted small">{r.release}</span>}
                          </div>
                        </td>
                        <td className="nowrap">{r.state}</td>
                        <td className="num">{r.estimate}</td>
                        <td className="num">{r.timeSpent}</td>
                        <td className="num">{r.todo}</td>
                        <td className="nowrap">
                          <div className="stack">
                            <span>{r.owner}</span>
                            {r.userName && r.userName !== r.owner && <span className="muted small">→ {r.userName}</span>}
                          </div>
                        </td>
                        <td>
                          <ActionCell action={r.action} reason={r.reason} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            />
          </Card>
        )}

        {canKeka && (
          <Card
            title="Import the Keka org directory"
            hint="A .csv (or .xlsx) with Employee Number, Display Name, Job Title, Department, Location and Reportees Count. Re-importing updates people by Employee Number."
          >
            <UploadPanel<KekaPlan>
              idPrefix="keka"
              endpoint="/imports/keka"
              accept=".csv,.xlsx"
              extraParams={{}}
              onImported={status.reload}
              renderRows={(plan) => (
                <table>
                  <thead>
                    <tr>
                      <th className="num">Row</th>
                      <th>Employee #</th>
                      <th>Display name</th>
                      <th>Job title</th>
                      <th>Department</th>
                      <th>Location</th>
                      <th className="num">Reportees</th>
                      <th>Login</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="num muted">{r.rowNumber}</td>
                        <td className="nowrap">{r.employeeNumber || <span className="muted">—</span>}</td>
                        <td className="nowrap">{r.displayName}</td>
                        <td className="small">{r.jobTitle}</td>
                        <td className="small">{r.department}</td>
                        <td className="small">{r.location}</td>
                        <td className="num">{r.reporteesCount}</td>
                        <td>{r.userName ? <Badge tone="ok">linked</Badge> : <Badge tone="neutral">no login</Badge>}</td>
                        <td>
                          <ActionCell action={r.action} reason={r.reason} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            />
          </Card>
        )}

        {s && (
          <Card
            title="Data availability"
            hint="Which people have Rally data for each of the last six bi-weekly periods"
            flush
          >
            {s.coverage.people.length === 0 ? (
              <Empty title="Nobody in your view yet" />
            ) : (
              <div className="table-wrap coverage">
                <table>
                  <thead>
                    <tr>
                      <th>Person</th>
                      {s.coverage.periods.map((p) => (
                        <th key={p.from} className="num" title={periodLabel(p)}>
                          {shortRange(p)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.coverage.people.map((p) => (
                      <tr key={p.id}>
                        <td className="nowrap">{p.name}</td>
                        {p.has.map((h, i) => (
                          <td key={i} className="cell">
                            {h ? (
                              <span className="yes" aria-label="has data">✓</span>
                            ) : (
                              <span className="no" aria-label="missing">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {s && (
          <Card title="Recent imports" flush>
            <BatchTable rows={s.recent} />
          </Card>
        )}
      </div>
    </>
  );
}
