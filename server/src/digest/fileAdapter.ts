import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DigestAdapter, DigestMessage } from './adapter';

/**
 * Writes the workbook into an outbox directory instead of sending it — the
 * default adapter, so the digest works with zero credentials configured.
 * Each xlsx gets a `.meta.json` sidecar (recipients, subject, scope, sentAt)
 * so a human or a test can see who it would have gone to without parsing
 * the spreadsheet binary.
 */
export function createFileAdapter(outboxDir: string): DigestAdapter {
  return {
    name: 'file',
    async send(message: DigestMessage) {
      await mkdir(outboxDir, { recursive: true });
      const xlsxPath = path.join(outboxDir, message.filename);
      const metaPath = `${xlsxPath}.meta.json`;
      await writeFile(xlsxPath, message.workbook);
      await writeFile(
        metaPath,
        JSON.stringify(
          {
            scope: message.scope,
            scopeId: message.scopeId,
            scopeLabel: message.scopeLabel,
            to: message.to,
            subject: message.subject,
            period: message.period,
            sentAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
    },
  };
}
