import { db } from '../db';
import { users } from '../db/schema';

/** Case/whitespace-insensitive form of a display name, for matching across systems. */
export const normalizeName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export interface PersonRef {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

export type Resolution =
  | { ok: true; person: PersonRef }
  | { ok: false; reason: string };

/**
 * Resolves a free-text person reference (Rally "Owner", Keka "Display Name")
 * to a login: by display name when exactly one user has it, otherwise by
 * email when the text is one. Two users sharing a display name is reported
 * as ambiguous rather than guessed at.
 */
export async function loadPersonResolver() {
  const all = await db
    .select({ id: users.id, name: users.name, email: users.email, active: users.active })
    .from(users);
  const byName = new Map<string, PersonRef[]>();
  const byEmail = new Map<string, PersonRef>();
  for (const u of all) {
    const key = normalizeName(u.name);
    byName.set(key, [...(byName.get(key) ?? []), u]);
    byEmail.set(u.email.toLowerCase(), u);
  }

  return (raw: string): Resolution => {
    const text = raw.trim();
    if (!text) return { ok: false, reason: 'Owner is blank' };
    const named = byName.get(normalizeName(text)) ?? [];
    if (named.length === 1) return { ok: true, person: named[0] };
    if (text.includes('@')) {
      const person = byEmail.get(text.toLowerCase());
      if (person) return { ok: true, person };
      return { ok: false, reason: `No login with email "${text}"` };
    }
    if (named.length > 1) {
      return { ok: false, reason: `${named.length} people are named "${text}" — use their email in the Owner column` };
    }
    return { ok: false, reason: `No login named "${text}"` };
  };
}
