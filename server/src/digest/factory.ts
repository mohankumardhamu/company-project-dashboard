import { env } from '../env';
import type { DigestAdapter } from './adapter';
import { createFileAdapter } from './fileAdapter';
import { createSmtpAdapter } from './smtpAdapter';

/** DIGEST_ADAPTER selects the implementation; "file" is the default so the
 * feature works with no credentials configured. */
export function getDigestAdapter(): DigestAdapter {
  if (env.digestAdapter === 'smtp') {
    if (!env.smtpHost) {
      throw new Error('SMTP_HOST must be set when DIGEST_ADAPTER=smtp');
    }
    return createSmtpAdapter();
  }
  return createFileAdapter(env.outboxDir);
}
