import { useApi } from './useApi';

export interface Period {
  from: string;
  to: string;
}

export interface PeriodCalendar {
  anchor: string;
  current: Period;
  periods: Period[]; // newest first
}

/**
 * The bi-weekly calendar comes from the server (BIWEEK_ANCHOR), so every page
 * agrees on the same fortnight boundaries as the reports and imports do.
 */
export function usePeriods(count = 12) {
  return useApi<PeriodCalendar>(`/periods?count=${count}`, [count]);
}

/** Label like "09 Nov — 22 Nov 2026". */
export function periodLabel(p: Period): string {
  const fmt = (d: string, year: boolean) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      ...(year ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });
  return `${fmt(p.from, false)} — ${fmt(p.to, true)}`;
}
