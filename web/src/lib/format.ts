/** Formatting helpers shared across pages. Dates are 'YYYY-MM-DD' strings. */

export function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDayShort(d: string): string {
  const date = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function formatRange(from: string, to: string): string {
  return `${formatDate(from)} — ${formatDate(to)}`;
}

export const hours = (n: number) => `${n.toFixed(2).replace(/\.00$/, '')} h`;

export function todayString(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDaysString(d: string, days: number): string {
  const date = new Date(`${d}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday of the week containing `d`. */
export function startOfWeekString(d: string): string {
  const date = new Date(`${d}T00:00:00Z`);
  return addDaysString(d, -((date.getUTCDay() + 6) % 7));
}

export function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'DONE') return false;
  return dueDate < todayString();
}
