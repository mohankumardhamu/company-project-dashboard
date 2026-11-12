import { useState } from 'react';

/**
 * Single-series bar charts in plain HTML/CSS — no chart library. One series
 * means one colour (--brand) and no legend: the card title names the measure.
 * Values appear in a hover tooltip and the page always has a table view of
 * the same numbers, so nothing is readable by colour or bar length alone.
 */

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Extra lines shown in the tooltip under the value. */
  detail?: string[];
  /** Emphasise this bar's axis label (e.g. the selected period). */
  emphasis?: boolean;
}

/** A "nice" axis maximum and 3 gridline steps above zero. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 3;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Tooltip({ d, unit }: { d: BarDatum; unit: string }) {
  return (
    <div className="chart-tip" role="status">
      <div className="chart-tip-label">{d.label}</div>
      <div className="chart-tip-value">
        {fmt(d.value)} {unit}
      </div>
      {d.detail?.map((line) => (
        <div key={line} className="chart-tip-detail">
          {line}
        </div>
      ))}
    </div>
  );
}

/** Ranked horizontal bars — for comparing people, where names need room. */
export function HBarChart({ data, unit, ariaLabel }: { data: BarDatum[]; unit: string; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const ticks = niceTicks(Math.max(0, ...data.map((d) => d.value)));
  const top = ticks[ticks.length - 1];

  return (
    <div className="hchart" role="img" aria-label={ariaLabel}>
      {data.map((d) => (
        <div
          key={d.key}
          className={hover === d.key ? 'hchart-row hover' : 'hchart-row'}
          onMouseEnter={() => setHover(d.key)}
          onMouseLeave={() => setHover(null)}
        >
          <div className="hchart-label" title={d.label}>
            {d.label}
          </div>
          <div className="hchart-track">
            {ticks.slice(1).map((t) => (
              <span key={t} className="chart-grid-v" style={{ left: `${(t / top) * 100}%` }} />
            ))}
            {d.value > 0 && <span className="hchart-bar" style={{ width: `${(d.value / top) * 100}%` }} />}
            {hover === d.key && <Tooltip d={d} unit={unit} />}
          </div>
        </div>
      ))}
      <div className="hchart-row axis">
        <div />
        <div className="hchart-track">
          {ticks.map((t) => (
            <span key={t} className="chart-tick-x" style={{ left: `${(t / top) * 100}%` }}>
              {fmt(t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Vertical bars over time — one bar per bi-weekly period, oldest on the left. */
export function VBarChart({ data, unit, ariaLabel }: { data: BarDatum[]; unit: string; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const ticks = niceTicks(Math.max(0, ...data.map((d) => d.value)));
  const top = ticks[ticks.length - 1];

  return (
    <div className="vchart" role="img" aria-label={ariaLabel}>
      <div className="vchart-axis">
        {ticks.map((t) => (
          <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>
            {fmt(t)}
          </span>
        ))}
      </div>
      <div className="vchart-plot">
        {ticks.slice(1).map((t) => (
          <span key={t} className="chart-grid-h" style={{ bottom: `${(t / top) * 100}%` }} />
        ))}
        {data.map((d) => (
          <div
            key={d.key}
            className={hover === d.key ? 'vchart-col hover' : 'vchart-col'}
            onMouseEnter={() => setHover(d.key)}
            onMouseLeave={() => setHover(null)}
          >
            {d.value > 0 && <span className="vchart-bar" style={{ height: `${(d.value / top) * 100}%` }} />}
            {hover === d.key && <Tooltip d={d} unit={unit} />}
          </div>
        ))}
      </div>
      <div />
      <div className="vchart-labels">
        {data.map((d) => (
          <span key={d.key} className={d.emphasis ? 'strong' : undefined}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
