import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Short, URL-safe, collision-resistant id (24 chars, ~124 bits of entropy).
 * Sortable-ish: the first 8 chars are a base-36 timestamp.
 */
export function createId(): string {
  const time = Date.now().toString(36).padStart(8, '0');
  const bytes = randomBytes(16);
  let random = '';
  for (const byte of bytes) random += ALPHABET[byte % ALPHABET.length];
  return `${time}${random}`;
}
