import { env } from './env';

/**
 * Date-only helpers. `date` columns round-trip as 'YYYY-MM-DD' strings, so all
 * of these speak that format and never carry a timezone.
 */

export type DateString = string; // YYYY-MM-DD

export function toDateOnly(input: string | Date): DateString {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${String(input)}`);
  return d.toISOString().slice(0, 10);
}

const asUtc = (d: DateString) => new Date(`${d}T00:00:00.000Z`);

export function addDays(d: DateString, days: number): DateString {
  const next = asUtc(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: DateString, b: DateString): number {
  return Math.round((asUtc(b).getTime() - asUtc(a).getTime()) / 86_400_000);
}

/** Length of a reporting period. The app reports in fortnights, not weeks. */
export const PERIOD_DAYS = 14;

/**
 * First Monday of the bi-weekly period containing `d`. Periods are counted
 * from env.biweekAnchor in both directions, so every caller agrees on the
 * same boundaries regardless of year.
 */
export function startOfPeriod(d: DateString): DateString {
  const offset = ((daysBetween(env.biweekAnchor, d) % PERIOD_DAYS) + PERIOD_DAYS) % PERIOD_DAYS;
  return addDays(d, -offset);
}

/** Last Sunday of the bi-weekly period containing `d`. */
export function endOfPeriod(d: DateString): DateString {
  return addDays(startOfPeriod(d), PERIOD_DAYS - 1);
}

/** The `count` most recent periods ending with the one containing `d`, newest first. */
export function recentPeriods(count: number, d: DateString = today()): { from: DateString; to: DateString }[] {
  const current = startOfPeriod(d);
  return Array.from({ length: count }, (_, i) => {
    const from = addDays(current, -PERIOD_DAYS * i);
    return { from, to: addDays(from, PERIOD_DAYS - 1) };
  });
}

export function today(): DateString {
  return new Date().toISOString().slice(0, 10);
}

/** e.g. "Mon 01 Sep" — used in report headings. */
export function humanDate(d: DateString): string {
  return asUtc(d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}
