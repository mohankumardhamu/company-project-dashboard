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

/** Monday of the ISO week containing `d`. */
export function startOfWeek(d: DateString): DateString {
  const day = asUtc(d);
  const dow = (day.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(d, -dow);
}

/** Sunday of the ISO week containing `d`. */
export function endOfWeek(d: DateString): DateString {
  return addDays(startOfWeek(d), 6);
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
