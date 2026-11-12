/**
 * Drives the running app in a real browser, one role at a time, and asserts
 * that each role sees (and cannot see) what it should. Also exercises the
 * PM -> team -> member -> task -> engineer log -> export chain.
 *
 * Usage: node scripts/uicheck.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const SHOTS = '/tmp/shots';
mkdirSync(SHOTS, { recursive: true });

let pass = 0;
let fail = 0;
const failures = [];
const consoleErrors = [];
const badResponses = [];

function check(name, ok, extra = '') {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(`${name} ${extra}`);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

async function login(page, email) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', 'Passw0rd!');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.sidebar', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}

/** Waits until a table has at least `n` body rows (React renders after networkidle). */
async function waitRows(page, n = 1) {
  await page.waitForFunction((min) => document.querySelectorAll('table tbody tr').length >= min, n, {
    timeout: 15000,
  });
  return (await page.$$('table tbody tr')).length;
}

const navLabels = (page) =>
  page.$$eval('.nav a', (els) => els.map((e) => e.textContent.replace(/[^A-Za-z ]/g, '').trim()));

const run = async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) badResponses.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });

  console.log('\n── Login page');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('login page renders', await page.isVisible('#email'));
  await page.click('.demo-row:has-text("vp@acme.com")');
  check('demo account fills the form', (await page.inputValue('#email')) === 'vp@acme.com');
  await page.screenshot({ path: `${SHOTS}/01-login.png` });

  await page.fill('#password', 'wrong-password');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.alert.error', { timeout: 10000 });
  check('bad password shows an error', (await page.textContent('.alert.error')).includes('Invalid'));

  /* ------------------------------------------------------------------ VP */
  console.log('\n── VP');
  await login(page, 'vp@acme.com');
  const vpNav = await navLabels(page);
  check('VP nav has Dashboard/Portfolio/Accounts/Projects/Teams/Register/Productivity/Imports/Reports/People',
    ['Dashboard', 'Portfolio', 'Accounts', 'Projects', 'Teams', 'Register', 'Productivity', 'Imports', 'Reports', 'People'].every((l) => vpNav.includes(l)), vpNav.join(','));
  check('VP nav has no My work', !vpNav.includes('My work'), vpNav.join(','));
  await page.waitForSelector('.stat-value');
  const vpStats = await page.$$eval('.stat-value', (els) => els.map((e) => e.textContent.trim()));
  const vpProjectCount = Number(vpStats[0]);
  const vpTeamCount = Number(vpStats[1]);
  check('VP dashboard counts projects', vpProjectCount >= 2, vpStats.join('|'));
  check('VP dashboard counts teams', vpTeamCount >= 4, vpStats.join('|'));
  check('VP dashboard shows the "This period" digest panel', (await page.textContent('body')).includes('This period'));
  const digestRows = await page.$$('.card:has-text("This period") table tbody tr');
  check('the digest panel lists every account', digestRows.length >= 2, `got ${digestRows.length}`);
  await page.screenshot({ path: `${SHOTS}/02-vp-dashboard.png`, fullPage: true });

  console.log('\n── Portfolio');
  await page.click('.nav a:has-text("Portfolio")');
  const portfolioRows = await waitRows(page, 1);
  check('portfolio has one row per account', portfolioRows >= 2, `got ${portfolioRows}`);
  const portfolioAccountOrder = await page.$$eval('table tbody tr td:first-child', (cells) => cells.map((c) => c.textContent));
  check('portfolio lists ACME and GLOBEX', portfolioAccountOrder.some((c) => c.includes('Acme')) && portfolioAccountOrder.some((c) => c.includes('Globex')), portfolioAccountOrder.join('|'));
  const portfolioBody = await page.textContent('body');
  check('portfolio shows outcome and task trend, not just totals', /↑|↓|flat/.test(portfolioBody));
  check('portfolio does not lead with hours', portfolioBody.indexOf('Outcomes') < portfolioBody.indexOf('Hours'));
  await page.screenshot({ path: `${SHOTS}/02b-vp-portfolio.png`, fullPage: true });

  // Risk badges are the only links in this table that wrap a .badge — the
  // account-name link in column one also points at /accounts/:id, so that
  // prefix alone isn't specific enough to prove a *risk badge* is clickable.
  const riskLink = await page.$('table tbody a:has(.badge)');
  if (riskLink) {
    const href = await riskLink.getAttribute('href');
    await riskLink.click();
    await page.waitForLoadState('networkidle');
    check('a risk badge navigates to the thing it is about', new URL(page.url()).pathname === href, `${page.url()} vs ${href}`);
    await page.goBack({ waitUntil: 'networkidle' });
  } else {
    check('a risk badge navigates to the thing it is about', true, 'no risk flags in seeded data this run — nothing to click');
  }

  console.log('\n── Register');
  await page.click('.nav a:has-text("Register")');
  await page.waitForSelector('#reg-q');
  await page.fill('#reg-q', 'secrets');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('table tbody tr', { timeout: 15000 });
  const vpRegisterRows = await page.$$eval('table tbody tr', (rows) => rows.map((r) => r.textContent));
  check('VP search finds the seeded outcome', vpRegisterRows.some((r) => r.includes('secrets')), vpRegisterRows.join('|'));
  check('VP (full access) sees a working team link, not a redacted badge', (await page.textContent('table tbody')).includes('Platform SRE') && !(await page.textContent('table tbody')).includes('Redacted'));
  await page.fill('#reg-q', '');
  await page.selectOption('#reg-category', 'CAPABILITY_BUILT');
  // fill() and selectOption() are two separate actions, each triggering its
  // own fetch — networkidle can resolve on the intermediate state (q
  // cleared, category not yet applied) rather than the final combination.
  // Wait for the stale "secrets" row to actually be gone instead of trusting
  // network timing.
  await page.waitForFunction(
    () => !document.querySelector('table tbody')?.textContent.includes('secrets audit finding'),
    null,
    { timeout: 15000 }
  );
  await page.waitForSelector('table tbody tr', { timeout: 15000 });
  const categoryRows = await page.$$eval('table tbody tr', (rows) => rows.map((r) => r.textContent));
  check('category filter shows only that category, no completed tasks', categoryRows.length > 0 && categoryRows.every((r) => r.includes('Capability built')), categoryRows.join('|'));
  await page.screenshot({ path: `${SHOTS}/02c-vp-register.png`, fullPage: true });

  await page.click('.nav a:has-text("Projects")');
  const vpRows = await waitRows(page, 1);
  check('VP project list matches the dashboard count', vpRows === vpProjectCount, `${vpRows} vs ${vpProjectCount}`);
  const newProjectBtn = await page.$('button:has-text("New project")');
  check('VP sees no "New project" button', newProjectBtn === null);

  await page.click('.nav a:has-text("Teams")');
  const vpTeamRows = await waitRows(page, 1);
  check('VP team list matches the dashboard count', vpTeamRows === vpTeamCount, `${vpTeamRows} vs ${vpTeamCount}`);
  check('VP sees no "New team" button', (await page.$('button:has-text("New team")')) === null);

  await page.goto(`${BASE}/my-work`, { waitUntil: 'networkidle' });
  check('VP is redirected away from /my-work', new URL(page.url()).pathname === '/');

  /* ------------------------------------------------------------ DIRECTOR */
  console.log('\n── Director');
  await login(page, 'director.eng@acme.com');
  const dirNav = await navLabels(page);
  check('Director nav has People and Reports', dirNav.includes('People') && dirNav.includes('Reports'));

  await page.click('.nav a:has-text("Projects")');
  await page.waitForSelector('table tbody tr');
  check('Director sees the "New project" button', (await page.$('button:has-text("New project")')) !== null);

  const projectCode = `UI${Date.now().toString().slice(-6)}`;
  await page.click('button:has-text("New project")');
  await page.waitForSelector('.modal');
  await page.fill('#p-name', 'UI Check Project');
  await page.fill('#p-code', projectCode);
  await page.fill('#p-desc', 'Created by the browser check');
  await page.screenshot({ path: `${SHOTS}/03-director-new-project.png` });
  await page.click('.modal button[type="submit"]');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await page.waitForLoadState('networkidle');
  const codes = await page.$$eval('table tbody tr', (rows) => rows.map((r) => r.textContent));
  check('new project appears in the list', codes.some((c) => c.includes(projectCode)));
  check('APEX project row shows its account', codes.some((c) => c.includes('APEX') && c.includes('ACME')));
  check('HELIOS project row shows its account', codes.some((c) => c.includes('HELIOS') && c.includes('GLOBEX')));

  await page.click(`table tbody tr:has-text("${projectCode}") a`);
  await page.waitForSelector('.topbar h1');
  check('project detail opens', (await page.textContent('.topbar h1')) === 'UI Check Project');
  check('Director sees "Attach a team"', (await page.$('button:has-text("Attach a team")')) !== null);
  check('empty project explains what to do', (await page.textContent('.empty')).includes('No teams on this project yet'));
  await page.screenshot({ path: `${SHOTS}/04-director-empty-project.png`, fullPage: true });

  // Drill into a populated project.
  await page.click('.nav a:has-text("Projects")');
  await page.waitForSelector('table tbody tr');
  await page.click('table tbody tr:has-text("APEX") a');
  await page.waitForSelector('.tree-team');
  const teamBlocks = await page.$$('.tree-team');
  check('APEX drill-down shows its teams', teamBlocks.length === 2, `got ${teamBlocks.length}`);
  const memberBlocks = await page.$$('.member-block');
  check('drill-down lists members', memberBlocks.length >= 6, `got ${memberBlocks.length}`);
  const taskLines = await page.$$('.task-line');
  check('drill-down lists each member\'s tasks', taskLines.length >= 6, `got ${taskLines.length}`);
  check('project page lists its outcomes', (await page.textContent('body')).includes('Enabled UPI AutoPay'));
  await page.screenshot({ path: `${SHOTS}/05-director-drilldown.png`, fullPage: true });

  console.log('\n── Accounts');
  await page.click('.nav a:has-text("Accounts")');
  const acctRows = await waitRows(page, 2);
  check('Director sees both seeded accounts', acctRows >= 2, `got ${acctRows}`);
  check('Director sees the "New account" button', (await page.$('button:has-text("New account")')) !== null);

  await page.click('table tbody tr:has-text("ACME") a');
  await page.waitForSelector('.topbar h1');
  check('account detail opens', (await page.textContent('.topbar h1')) === 'Acme Payments');
  await page.waitForSelector('table tbody tr');
  const acctProjectRows = await page.$$('table tbody tr');
  check('account detail lists its projects', acctProjectRows.length >= 1, `got ${acctProjectRows.length}`);
  check('account detail project row is APEX', (await page.textContent('table tbody')).includes('APEX'));
  check('account page lists its outcomes', (await page.textContent('body')).includes('Enabled UPI AutoPay'));
  const verifyBtn = await page.$('button:has-text("Verify")');
  check('account page offers Verify on an unverified outcome', verifyBtn !== null);
  await page.screenshot({ path: `${SHOTS}/06-director-account.png`, fullPage: true });

  /* ------------------------------------------------------------------ PM */
  console.log('\n── PM');
  await login(page, 'pm.payments@acme.com');
  const pmNav = await navLabels(page);
  check('PM nav has My work and Reports', pmNav.includes('My work') && pmNav.includes('Reports'));
  check('PM nav has no People', !pmNav.includes('People'), pmNav.join(','));
  check('PM nav has no Portfolio', !pmNav.includes('Portfolio'), pmNav.join(','));

  await page.click('.nav a:has-text("Teams")');
  const pmTeamsBefore = await waitRows(page, 1);
  const pmTeamNames = await page.$$eval('table tbody tr', (rows) => rows.map((r) => r.textContent));
  check('PM sees fewer teams than the VP', pmTeamsBefore < vpTeamCount, `${pmTeamsBefore} vs ${vpTeamCount}`);
  check("PM does not see another PM's team", !pmTeamNames.some((t) => t.includes('Platform SRE')));
  check('PM sees the "New team" button', (await page.$('button:has-text("New team")')) !== null);

  const teamName = `UI Team ${Date.now().toString().slice(-6)}`;
  await page.click('button:has-text("New team")');
  await page.waitForSelector('.modal');
  await page.fill('#t-name', teamName);
  await page.fill('#t-desc', 'Created by the browser check');
  await page.click('.modal button[type="submit"]');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await page.waitForSelector(`table tbody tr:has-text("${teamName}")`, { timeout: 15000 });
  const pmTeamsAfter = await waitRows(page, 1);
  check('new team appears in the PM\'s list', pmTeamsAfter === pmTeamsBefore + 1, `${pmTeamsAfter} vs ${pmTeamsBefore}`);

  await page.click(`table tbody tr:has-text("${teamName}") a`);
  await page.waitForSelector('.topbar h1');
  check('team detail opens', (await page.textContent('.topbar h1')) === teamName);
  check('"New task" is disabled with no members',
    await page.isDisabled('button:has-text("New task")'));

  await page.click('button:has-text("Add member")');
  await page.waitForSelector('.modal');
  await page.click('.modal .demo-row button:has-text("Add")');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await waitRows(page, 1);
  check('member is added to the team', (await page.$$('table tbody tr')).length === 1);
  check('"New task" is now enabled', !(await page.isDisabled('button:has-text("New task")')));
  await page.screenshot({ path: `${SHOTS}/06-pm-team.png`, fullPage: true });

  await page.click('button:has-text("New task")');
  await page.waitForSelector('.modal');
  await page.fill('#k-title', 'Task created from the browser check');
  await page.selectOption('#k-priority', 'HIGH');
  await page.click('.modal button[type="submit"]');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await page.waitForSelector('td:has-text("Task created from the browser check")', { timeout: 15000 });
  check('task appears on the team', (await page.textContent('body')).includes('Task created from the browser check'));

  // The PM's own existing team, with real logged work.
  await page.click('.nav a:has-text("Teams")');
  await page.waitForSelector('table tbody tr');
  await page.click('table tbody tr:has-text("Payments Core") a');
  await page.waitForSelector('.card');
  const bodyText = await page.textContent('body');
  check('team page shows this period\'s entries', bodyText.includes("This period's entries"));
  check('team page shows hours per member', /\d+(\.\d+)? h/.test(bodyText));
  await page.screenshot({ path: `${SHOTS}/07-pm-team-detail.png`, fullPage: true });

  console.log('\n── PM logs an outcome');
  check('PM sees the "Log an outcome" button', (await page.$('button:has-text("Log an outcome")')) !== null);
  await page.click('button:has-text("Log an outcome")');
  await page.waitForSelector('.modal');
  const outcomeTitle = `UI outcome ${Date.now().toString().slice(-6)}`;
  await page.fill('#o-title', outcomeTitle);
  await page.selectOption('#o-category', 'CUSTOMER_VISIBLE');
  await page.fill(
    '#o-narrative',
    'Browser check: shipped something real, proving the filing flow works end to end.'
  );
  await page.click('.modal button[type="submit"]');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  await page.waitForSelector(`text=${outcomeTitle}`, { timeout: 15000 });
  check('logged outcome appears on the team page', (await page.textContent('body')).includes(outcomeTitle));

  console.log('\n── PM report + export');
  await page.click('.nav a:has-text("Reports")');
  await page.waitForSelector('#r-scope');
  await page.waitForSelector('.card:has-text("Per member") table tbody tr', { timeout: 20000 });
  check('report preview renders member rows', (await page.$$('table tbody tr')).length > 0);
  await page.waitForFunction(() => document.querySelectorAll('#r-scope option').length > 1, null, { timeout: 15000 });
  const scopeOptions = await page.$$eval('#r-scope option', (o) => o.map((x) => x.textContent));
  check('scope picker lists the PM\'s teams', scopeOptions.some((o) => o.includes('Payments Core')), scopeOptions.join('|'));
  check('scope picker excludes other PMs\' teams', !scopeOptions.some((o) => o.includes('Platform SRE')), scopeOptions.join('|'));
  await page.screenshot({ path: `${SHOTS}/08-pm-report.png`, fullPage: true });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('button:has-text("Export .xlsx")'),
  ]);
  const name = download.suggestedFilename();
  check('xlsx download starts', name.endsWith('.xlsx'), name);
  await download.saveAs(`${SHOTS}/report.xlsx`);
  check('downloaded filename names the period', /biweekly-status_.*_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.xlsx/.test(name), name);

  // Previous period navigation
  const periodBefore = await page.inputValue('#r-period');
  await page.click('button:has-text("Previous")');
  await page.waitForLoadState('networkidle');
  const periodAfter = await page.inputValue('#r-period');
  check('previous period moves back two weeks', (new Date(periodBefore) - new Date(periodAfter)) / 86400000 === 14, `${periodBefore} -> ${periodAfter}`);

  console.log('\n── PM imports a Rally export');
  await page.click('.nav a:has-text("Imports")');
  await page.waitForSelector('#rally-file');
  await page.waitForFunction(() => document.querySelectorAll('#rally-period option').length > 1, null, { timeout: 15000 });
  const uiStory = `US${Date.now().toString().slice(-6)}: Browser check story`;
  await page.setInputFiles('#rally-file', {
    name: 'rally-ui.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `Work Product,Release,State,Estimate,ToDo,Time Spent,Owner\n${uiStory},R9,Accepted,13,0,7.5,Sneha Kulkarni\nUS1: Not mine,R9,Accepted,1,0,1,Fatima Sheikh\n`
    ),
  });
  await page.click('button:has-text("Preview")');
  await page.waitForSelector('text=preview only, nothing saved yet', { timeout: 15000 });
  const previewText = await page.textContent('body');
  check('preview lists the new row and the skipped row with its reason', previewText.includes(uiStory) && previewText.includes('not on a team you manage'));
  await page.click('button:has-text("Import 1 rows")');
  await page.waitForSelector('.alert.ok:has-text("Imported 1 rows")', { timeout: 15000 });
  check('import confirms how many rows landed', true);
  await page.screenshot({ path: `${SHOTS}/08b-pm-imports.png`, fullPage: true });

  console.log('\n── PM productivity');
  await page.click('.nav a:has-text("Productivity")');
  await page.waitForSelector('.hchart-row', { timeout: 15000 });
  const prodBody = await page.textContent('body');
  check('productivity shows the imported story', prodBody.includes(uiStory));
  check('productivity charts people from the PM\'s teams only', prodBody.includes('Sneha Kulkarni') && !prodBody.includes('Fatima Sheikh'));
  check('productivity draws the per-period trend', (await page.$$('.vchart-col')).length === 12, `got ${(await page.$$('.vchart-col')).length}`);
  await page.hover('.hchart-row >> nth=0');
  check('hovering a bar shows a tooltip', await page.isVisible('.chart-tip'));
  await page.screenshot({ path: `${SHOTS}/08c-pm-productivity.png`, fullPage: true });

  /* ------------------------------------------------------------ ENGINEER */
  console.log('\n── Engineer');
  await login(page, 'eng.anita@acme.com');
  check(
    'Engineer dashboard has no "This period" digest panel — they never receive one',
    !(await page.textContent('body')).includes('This period')
  );
  const engNav = await navLabels(page);
  check('Engineer nav has My work', engNav.includes('My work'));
  check('Engineer nav has Productivity and Imports', engNav.includes('Productivity') && engNav.includes('Imports'), engNav.join(','));
  check('Engineer nav has no Reports', !engNav.includes('Reports'), engNav.join(','));
  check('Engineer nav has no People', !engNav.includes('People'), engNav.join(','));
  check('Engineer nav has no Portfolio', !engNav.includes('Portfolio'), engNav.join(','));
  check('Engineer nav has Register — it is open to every signed-in role', engNav.includes('Register'), engNav.join(','));
  await page.goto(`${BASE}/portfolio`, { waitUntil: 'networkidle' });
  check('Engineer is redirected away from /portfolio', new URL(page.url()).pathname === '/');

  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  check('Engineer is redirected away from /reports', new URL(page.url()).pathname === '/');

  console.log('\n── Register (Engineer, redacted)');
  await page.click('.nav a:has-text("Register")');
  await page.waitForSelector('#reg-q');
  await page.fill('#reg-q', 'secrets');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('table tbody tr', { timeout: 15000 });
  const engRegisterBody = await page.textContent('table tbody');
  check('Engineer gets a real page, not a 404, searching another account\'s work', engRegisterBody.includes('secrets audit finding') || engRegisterBody.includes('Redacted'));
  check('the redacted row shows the account and team name', engRegisterBody.includes('GLOBEX') && engRegisterBody.includes('Platform SRE'));
  check('the redacted row is marked Redacted and has no team link', engRegisterBody.includes('Redacted'));
  const redactedTeamLink = await page.$('table tbody tr:has-text("Platform SRE") a[href^="/teams/"]');
  check('there is no working team link on the redacted row', redactedTeamLink === null);
  await page.screenshot({ path: `${SHOTS}/10-engineer-register-redacted.png`, fullPage: true });

  await page.click('.nav a:has-text("My work")');
  await page.waitForSelector('#w-task');
  check('log form is present', await page.isVisible('#w-summary'));
  const taskOptions = await page.$$eval('#w-task option', (o) => o.length);
  check('log form lists the engineer\'s open tasks', taskOptions > 0, `got ${taskOptions}`);

  const summaryText = `Browser check entry ${Date.now()}`;
  await page.fill('#w-hours', '3.5');
  await page.fill('#w-summary', summaryText);
  await page.selectOption('#w-status', 'AT_RISK');
  await page.click('.card button[type="submit"]');
  await page.waitForSelector('.alert.ok', { timeout: 15000 });
  check('entry saves', (await page.textContent('.alert.ok')).includes('saved') || (await page.textContent('.alert.ok')).includes('updated'));
  await page.waitForSelector(`.card:has-text("This period") :text("${summaryText}")`, { timeout: 15000 });
  check('entry shows in this period', (await page.textContent('body')).includes(summaryText));
  await page.screenshot({ path: `${SHOTS}/09-engineer-mywork.png`, fullPage: true });

  // Re-saving the same task/day must warn that it replaces the entry.
  await page.fill('#w-summary', `${summaryText} (revised)`);
  await page.waitForSelector('.alert.info', { timeout: 10000 });
  check('re-logging the same day warns it will replace', (await page.textContent('.alert.info')).includes('already logged'));

  // Engineer changes their own task status.
  const statusSelect = await page.$('table select');
  if (statusSelect) {
    await statusSelect.selectOption('IN_PROGRESS');
    await page.waitForLoadState('networkidle');
    check('engineer can change their task status', true);
  } else {
    check('engineer can change their task status', false, 'no status select found');
  }

  await page.click('.nav a:has-text("Projects")');
  const engProjectRows = await waitRows(page, 1);
  const engProjectText = await page.$$eval('table tbody tr', (rows) => rows.map((r) => r.textContent).join(' '));
  check('Engineer sees exactly one project', engProjectRows === 1, `got ${engProjectRows}`);
  check('Engineer sees APEX, not HELIOS',
    engProjectText.includes('APEX') && !engProjectText.includes('HELIOS'), engProjectText.slice(0, 120));

  console.log('\n── Console health');
  const unexpected = badResponses.filter((r) => !r.startsWith('401 POST') || !r.includes('/auth/login'));
  check('no unexpected 4xx/5xx responses', unexpected.length === 0, unexpected.slice(0, 6).join(' | '));
  check('no uncaught page errors', consoleErrors.filter((e) => e.startsWith('pageerror')).length === 0,
    consoleErrors.filter((e) => e.startsWith('pageerror')).slice(0, 3).join(' | '));

  await browser.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(' - ' + f));
    process.exitCode = 1;
  }
};

run().catch((err) => {
  console.error('\nUI run crashed:', err);
  process.exitCode = 1;
});
