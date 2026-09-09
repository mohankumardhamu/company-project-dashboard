import type { DateString } from '../dates';

export interface DigestMessage {
  scope: 'team' | 'account';
  scopeId: string;
  /** Human label, e.g. "Team: Payments Core" or "Account: ACME — Acme Payments". */
  scopeLabel: string;
  to: string[];
  subject: string;
  filename: string;
  workbook: Buffer;
  week: { from: DateString; to: DateString };
}

export interface DigestAdapter {
  readonly name: string;
  send(message: DigestMessage): Promise<void>;
}
