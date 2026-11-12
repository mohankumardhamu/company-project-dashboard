/**
 * Invokes the bi-weekly digest job directly — no HTTP, no cron — with the file
 * adapter, and asserts the expected workbooks and recipients land in
 * outbox/. Requires a seeded database (npm run seed).
 * Usage: npm run smoke:digest
 */
import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { endOfPeriod, startOfPeriod, today } from '../src/dates';
import { db, pool } from '../src/db';
import { accounts } from '../src/db/schema';
import { createFileAdapter } from '../src/digest/fileAdapter';
import { runDigest } from '../src/digest/job';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, extra = ''): void {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(`${name} ${extra}`);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

const OUTBOX = path.join(__dirname, '..', 'outbox');

interface DigestMeta {
  scope: 'team' | 'account';
  to: string[];
  period: { from: string; to: string };
}

function metaFor(slugPart: string, files: string[]): DigestMeta | null {
  const metaFile = files.find((f) => f.includes(slugPart) && f.endsWith('.meta.json'));
  if (!metaFile) return null;
  return JSON.parse(readFileSync(path.join(OUTBOX, metaFile), 'utf8'));
}

async function run() {
  console.log('\n── Bi-weekly digest — file adapter');

  // Clean slate so this run's files are unambiguous.
  if (existsSync(OUTBOX)) rmSync(OUTBOX, { recursive: true, force: true });
  mkdirSync(OUTBOX, { recursive: true });

  // A brand-new account with no project attached yet is a normal, encouraged
  // state in this app — it still has every VP as a recipient (owner or not),
  // but has zero teams to report on. This must be skipped, not crash the run.
  const EMPTY_CODE = 'DIGESTSMOKEEMPTY';
  await db.delete(accounts).where(eq(accounts.code, EMPTY_CODE));
  const [emptyAccount] = await db.insert(accounts).values({ name: 'Digest Smoke Empty Account', code: EMPTY_CODE }).returning();

  const adapter = createFileAdapter(OUTBOX);
  const summary = await runDigest({ adapter });
  check('the run reports at least one sent item', summary.sent.length > 0, `sent=${summary.sent.length}`);
  check(
    'an account with recipients but no teams is skipped, not crashed on',
    summary.skipped.some((s) => s.scope === 'account' && s.id === emptyAccount.id),
    JSON.stringify(summary.skipped)
  );

  await db.delete(accounts).where(eq(accounts.code, EMPTY_CODE));

  const files = readdirSync(OUTBOX);
  const anchor = today();
  const from = startOfPeriod(anchor);
  const to = endOfPeriod(anchor);

  const expectFile = (slugPart: string) => {
    const xlsx = files.find((f) => f.includes(slugPart) && f.endsWith('.xlsx'));
    const meta = files.find((f) => f.includes(slugPart) && f.endsWith('.meta.json'));
    check(`workbook lands in outbox/ for "${slugPart}"`, Boolean(xlsx), files.join(', '));
    check(`meta sidecar lands in outbox/ for "${slugPart}"`, Boolean(meta), files.join(', '));
  };
  for (const slugPart of ['Payments-Core', 'Mobile-Checkout', 'Platform-SRE', 'Data-Enablement', 'ACME', 'GLOBEX']) {
    expectFile(slugPart);
  }

  const coreMeta = metaFor('Payments-Core', files);
  check(
    "a team's recipients are its PM and its account's owning Director",
    Boolean(coreMeta) && coreMeta!.to.includes('pm.payments@acme.com') && coreMeta!.to.includes('director.eng@acme.com'),
    JSON.stringify(coreMeta?.to)
  );
  check(
    'the meta sidecar records the period the job actually ran for',
    Boolean(coreMeta) && coreMeta!.period.from === from && coreMeta!.period.to === to,
    JSON.stringify(coreMeta?.period)
  );

  const dataMeta = metaFor('Data-Enablement', files);
  check(
    "an unattached team's recipients are just its PM (no project means no Director to fall back to)",
    Boolean(dataMeta) && dataMeta!.to.length === 1 && dataMeta!.to[0] === 'pm.payments@acme.com',
    JSON.stringify(dataMeta?.to)
  );

  const acmeMeta = metaFor('ACME', files);
  check(
    "an account's recipients are its owning Director and every active VP",
    Boolean(acmeMeta) && acmeMeta!.to.includes('director.eng@acme.com') && acmeMeta!.to.includes('vp@acme.com'),
    JSON.stringify(acmeMeta?.to)
  );

  const globexMeta = metaFor('GLOBEX', files);
  check(
    "a different account's recipients follow its own Director, not another account's",
    Boolean(globexMeta) &&
      globexMeta!.to.includes('director.platform@acme.com') &&
      !globexMeta!.to.includes('director.eng@acme.com'),
    JSON.stringify(globexMeta?.to)
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(' - ' + f));
    process.exitCode = 1;
  }
}

run()
  .catch((err) => {
    console.error('\nDigest smoke run crashed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
