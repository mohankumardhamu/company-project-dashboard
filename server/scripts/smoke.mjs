/**
 * End-to-end permission and workflow check against a running API.
 * Usage: node scripts/smoke.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? 'http://localhost:4000';
const PASSWORD = process.env.SEED_VP_PASSWORD ?? 'Passw0rd!';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(`${name} ${extra}`);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

async function api(token, method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const type = res.headers.get('content-type') ?? '';
  let data = null;
  if (type.includes('json')) data = await res.json();
  else if (type.includes('spreadsheet')) data = Buffer.from(await res.arrayBuffer());
  else data = await res.text();
  return { status: res.status, data, headers: res.headers };
}

async function login(email) {
  const res = await api(null, 'POST', '/auth/login', { email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.data)}`);
  return res.data.token;
}

function section(title) {
  console.log(`\n── ${title}`);
}

const run = async () => {
  section('Authentication');
  const bad = await api(null, 'POST', '/auth/login', { email: 'vp@acme.com', password: 'wrong' });
  check('wrong password is rejected', bad.status === 401, `got ${bad.status}`);
  const unknown = await api(null, 'POST', '/auth/login', { email: 'nobody@acme.com', password: PASSWORD });
  check('unknown email gives the same 401', unknown.status === 401 && unknown.data.error === bad.data.error);
  const noToken = await api(null, 'GET', '/projects');
  check('no token is rejected', noToken.status === 401, `got ${noToken.status}`);
  const badToken = await api('not-a-jwt', 'GET', '/projects');
  check('garbage token is rejected', badToken.status === 401, `got ${badToken.status}`);

  const vp = await login('vp@acme.com');
  const dirEng = await login('director.eng@acme.com');
  const dirPlat = await login('director.platform@acme.com');
  const pmPay = await login('pm.payments@acme.com');
  const pmMob = await login('pm.mobile@acme.com');
  const engAnita = await login('eng.anita@acme.com');
  const engJoseph = await login('eng.joseph@acme.com');
  check('all six demo roles can log in', true);

  section('VP — org-wide read');
  const vpOverview = await api(vp, 'GET', '/overview');
  check('VP overview returns', vpOverview.status === 200, JSON.stringify(vpOverview.data).slice(0, 120));
  check('VP sees both projects', vpOverview.data.totals.projects === 2, `got ${vpOverview.data?.totals?.projects}`);
  check('VP sees all four teams', vpOverview.data.totals.teams === 4, `got ${vpOverview.data?.totals?.teams}`);
  check('VP sees every task', vpOverview.data.totals.tasks.total === 12, `got ${vpOverview.data?.totals?.tasks?.total}`);
  const vpProjects = await api(vp, 'GET', '/projects');
  check('VP project list has both', vpProjects.data.length === 2, `got ${vpProjects.data.length}`);

  section('VP — write restrictions');
  const vpCreateProject = await api(vp, 'POST', '/projects', { name: 'Nope', code: 'NOPE' });
  check('VP cannot create a project', vpCreateProject.status === 403, `got ${vpCreateProject.status}`);
  const vpCreateTeam = await api(vp, 'POST', '/teams', { name: 'Nope Team' });
  check('VP cannot create a team', vpCreateTeam.status === 403, `got ${vpCreateTeam.status}`);
  const vpMakesDirector = await api(vp, 'POST', '/users', {
    email: `smoke.director.${Date.now()}@acme.com`,
    name: 'Smoke Director',
    password: 'Passw0rd!',
    role: 'DIRECTOR',
  });
  check('VP can onboard a Director', vpMakesDirector.status === 201, JSON.stringify(vpMakesDirector.data).slice(0, 120));

  section('Director — project lifecycle');
  const dirMakesVp = await api(dirEng, 'POST', '/users', {
    email: `smoke.vp.${Date.now()}@acme.com`,
    name: 'Smoke VP',
    password: 'Passw0rd!',
    role: 'VP',
  });
  check('Director cannot create a VP', dirMakesVp.status === 403, `got ${dirMakesVp.status}`);
  const dirMakesEng = await api(dirEng, 'POST', '/users', {
    email: `smoke.eng.${Date.now()}@acme.com`,
    name: 'Smoke Engineer',
    password: 'Passw0rd!',
    role: 'ENGINEER',
  });
  check('Director can onboard an Engineer', dirMakesEng.status === 201);
  const newEngId = dirMakesEng.data?.id;

  const code = `SMK${Date.now().toString().slice(-6)}`;
  const newProject = await api(dirEng, 'POST', '/projects', {
    name: 'Smoke Test Project',
    code,
    description: 'Created by the smoke test',
  });
  check('Director creates a project', newProject.status === 201, JSON.stringify(newProject.data).slice(0, 160));
  const projectId = newProject.data?.id;

  const dupCode = await api(dirEng, 'POST', '/projects', { name: 'Dup', code });
  check('duplicate project code is a 409', dupCode.status === 409, `got ${dupCode.status}`);
  const badDates = await api(dirEng, 'POST', '/projects', {
    name: 'Backwards',
    code: `BAD${Date.now().toString().slice(-5)}`,
    startDate: '2026-12-01',
    endDate: '2026-01-01',
  });
  check('end date before start date is rejected', badDates.status === 400, `got ${badDates.status}`);

  const otherDirEdit = await api(dirPlat, 'PATCH', `/projects/${projectId}`, { name: 'Hijacked' });
  check("a Director cannot edit another Director's project", otherDirEdit.status === 403, `got ${otherDirEdit.status}`);

  section('Account — visibility and lifecycle');
  const acctCode = `SMKACC${Date.now().toString().slice(-6)}`;
  const newAccount = await api(dirEng, 'POST', '/accounts', { name: 'Smoke Test Account', code: acctCode });
  check('Director creates an account', newAccount.status === 201, JSON.stringify(newAccount.data).slice(0, 160));

  const pmMakesAccount = await api(pmPay, 'POST', '/accounts', { name: 'Nope', code: 'PMNOPEACC' });
  check('PM cannot create an account', pmMakesAccount.status === 403, `got ${pmMakesAccount.status}`);

  const seedAccounts = await api(vp, 'GET', '/accounts');
  const acmeAccount = seedAccounts.data.find((a) => a.code === 'ACME');
  const globexAccount = seedAccounts.data.find((a) => a.code === 'GLOBEX');
  check('VP sees the seeded accounts', Boolean(acmeAccount) && Boolean(globexAccount), JSON.stringify(seedAccounts.data?.map((a) => a.code)));

  const engOnGlobex = await api(engAnita, 'GET', `/accounts/${globexAccount.id}`);
  check(
    "Engineer gets a 404 (not 403) for an account they have no team on",
    engOnGlobex.status === 404,
    `got ${engOnGlobex.status}`
  );

  const acctReport = await api(vp, 'GET', `/reports/weekly?accountId=${acmeAccount.id}`);
  check('weekly report scoped to an account returns only that account\'s teams',
    acctReport.status === 200 &&
      acctReport.data.members.length > 0 &&
      acctReport.data.members.every((m) => m.teamName === 'Payments Core' || m.teamName === 'Mobile Checkout'),
    JSON.stringify(acctReport.data?.members?.map((m) => m.teamName)));
  check('account-scoped report outcomes also belong to that account\'s teams',
    acctReport.data.outcomes.length > 0 &&
      acctReport.data.outcomes.every((o) => o.teamName === 'Payments Core' || o.teamName === 'Mobile Checkout'),
    JSON.stringify(acctReport.data?.outcomes?.map((o) => o.teamName)));

  const acctAndProjectReport = await api(vp, 'GET', `/reports/weekly?accountId=${acmeAccount.id}&projectId=${projectId}`);
  check('passing account and project scopes together is rejected', acctAndProjectReport.status === 400, `got ${acctAndProjectReport.status}`);

  section('PM — teams and members');
  const pmMakesProject = await api(pmPay, 'POST', '/projects', { name: 'Nope', code: 'PMNOPE' });
  check('PM cannot create a project', pmMakesProject.status === 403, `got ${pmMakesProject.status}`);

  const teamName = `Smoke Team ${Date.now()}`;
  const newTeam = await api(pmPay, 'POST', '/teams', { name: teamName, description: 'smoke' });
  check('PM creates a team', newTeam.status === 201, JSON.stringify(newTeam.data).slice(0, 160));
  const teamId = newTeam.data?.id;

  const addMember = await api(pmPay, 'POST', `/teams/${teamId}/members`, { userId: newEngId });
  check('PM adds an engineer to their team', addMember.status === 201, JSON.stringify(addMember.data).slice(0, 160));
  const addTwice = await api(pmPay, 'POST', `/teams/${teamId}/members`, { userId: newEngId });
  check('adding the same member twice is rejected', addTwice.status === 409 || addTwice.status === 400, `got ${addTwice.status}`);

  const vpUsers = await api(vp, 'GET', '/users?role=DIRECTOR');
  const someDirectorId = vpUsers.data[0]?.id;
  const addDirector = await api(pmPay, 'POST', `/teams/${teamId}/members`, { userId: someDirectorId });
  check('a Director cannot be added as a team member', addDirector.status === 400, `got ${addDirector.status}`);

  const otherPmAdds = await api(pmMob, 'POST', `/teams/${teamId}/members`, { userId: newEngId });
  check("a PM cannot staff another PM's team", otherPmAdds.status === 403, `got ${otherPmAdds.status}`);

  section('Director attaches the team to the project');
  const attachable = await api(dirEng, 'GET', `/projects/${projectId}/attachable-teams`);
  check('attachable-teams includes the new team', attachable.data?.some((t) => t.id === teamId));
  const attach = await api(dirEng, 'POST', `/projects/${projectId}/teams`, { teamId });
  check('Director attaches a team', attach.status === 201, JSON.stringify(attach.data).slice(0, 160));
  const attachByOther = await api(dirPlat, 'POST', `/projects/${projectId}/teams`, { teamId });
  check('another Director cannot attach to it', attachByOther.status === 403, `got ${attachByOther.status}`);

  const drill = await api(dirEng, 'GET', `/projects/${projectId}`);
  check('project drill-down shows the team', drill.data?.teams?.some((t) => t.id === teamId));
  check('drill-down carries members', drill.data?.teams?.find((t) => t.id === teamId)?.members?.length === 1);

  section('PM — tasks');
  const newTask = await api(pmPay, 'POST', '/tasks', {
    teamId,
    assigneeId: newEngId,
    title: 'Smoke test task',
    priority: 'HIGH',
  });
  check('PM creates a task', newTask.status === 201, JSON.stringify(newTask.data).slice(0, 160));
  const taskId = newTask.data?.id;

  const outsiderAssign = await api(pmPay, 'POST', '/tasks', {
    teamId,
    assigneeId: (await api(vp, 'GET', '/users?role=ENGINEER')).data.find((u) => u.id !== newEngId).id,
    title: 'Should fail',
  });
  check('cannot assign a task to a non-member', outsiderAssign.status === 400, `got ${outsiderAssign.status}`);

  const engMakesTask = await api(engAnita, 'POST', '/tasks', {
    teamId,
    assigneeId: newEngId,
    title: 'Engineer should not create this',
  });
  check('Engineer cannot create a task', engMakesTask.status === 403, `got ${engMakesTask.status}`);

  section('Engineer — daily work log');
  const engTasks = await api(engAnita, 'GET', '/tasks?mine=1');
  check('Engineer sees their own tasks', engTasks.status === 200 && engTasks.data.length > 0, `got ${engTasks.data?.length}`);
  const anitaTaskId = engTasks.data[0]?.id;

  const todayStr = new Date().toISOString().slice(0, 10);
  const log = await api(engAnita, 'POST', '/worklogs', {
    taskId: anitaTaskId,
    date: todayStr,
    hours: 4.5,
    summary: 'Smoke test: wrote the thing and tested it.',
    status: 'ON_TRACK',
  });
  check('Engineer logs work on their task', log.status === 201, JSON.stringify(log.data).slice(0, 160));

  const relog = await api(engAnita, 'POST', '/worklogs', {
    taskId: anitaTaskId,
    date: todayStr,
    hours: 6,
    summary: 'Smoke test: updated the same day.',
    status: 'AT_RISK',
  });
  check('re-logging the same day updates in place', relog.status === 201 && relog.data.hours === 6, `hours=${relog.data?.hours}`);
  check('same-day re-log keeps one row', relog.data?.id === log.data?.id);

  const foreignLog = await api(engJoseph, 'POST', '/worklogs', {
    taskId: anitaTaskId,
    date: todayStr,
    hours: 2,
    summary: "Logging on someone else's task",
  });
  check("cannot log against another engineer's task", foreignLog.status === 403, `got ${foreignLog.status}`);

  const futureLog = await api(engAnita, 'POST', '/worklogs', {
    taskId: anitaTaskId,
    date: '2099-01-01',
    hours: 2,
    summary: 'From the future',
  });
  check('cannot log a future date', futureLog.status === 400, `got ${futureLog.status}`);

  const zeroHours = await api(engAnita, 'POST', '/worklogs', {
    taskId: anitaTaskId,
    date: todayStr,
    hours: 0,
    summary: 'Nothing at all',
  });
  check('zero hours is rejected by validation', zeroHours.status === 400, `got ${zeroHours.status}`);

  section('Engineer — task status, but nothing else');
  const engStatus = await api(engAnita, 'PATCH', `/tasks/${anitaTaskId}`, { status: 'IN_PROGRESS' });
  check('Engineer moves their own task status', engStatus.status === 200, JSON.stringify(engStatus.data).slice(0, 120));
  const engRetitle = await api(engAnita, 'PATCH', `/tasks/${anitaTaskId}`, { title: 'Renamed by engineer' });
  check('Engineer cannot retitle a task', engRetitle.status === 403, `got ${engRetitle.status}`);
  const engReassign = await api(engAnita, 'PATCH', `/tasks/${anitaTaskId}`, { assigneeId: newEngId });
  check('Engineer cannot reassign a task', engReassign.status === 403, `got ${engReassign.status}`);

  section('Engineer — visibility is limited to their teams');
  const engProjects = await api(engAnita, 'GET', '/projects');
  check('Engineer sees only their own projects', engProjects.data.length === 1, `got ${engProjects.data.length}`);
  const engOtherProject = await api(engAnita, 'GET', `/projects/${projectId}`);
  check("Engineer 404s on a project they're not on", engOtherProject.status === 404, `got ${engOtherProject.status}`);
  const engUsers = await api(engAnita, 'GET', '/users');
  check('Engineer directory is limited to teammates', engUsers.data.length <= 6, `got ${engUsers.data.length}`);
  const engReport = await api(engAnita, 'GET', '/reports/weekly');
  check('Engineer cannot run reports', engReport.status === 403, `got ${engReport.status}`);

  section('PM — visibility is limited to their teams');
  const pmMobProjects = await api(pmMob, 'GET', '/projects');
  check('PM sees only projects their teams are on', pmMobProjects.data.length === 1, `got ${pmMobProjects.data.length}`);
  const pmMobOnOther = await api(pmMob, 'GET', `/projects/${projectId}`);
  check('PM 404s on an unrelated project', pmMobOnOther.status === 404, `got ${pmMobOnOther.status}`);

  section('Member removal guards');
  const removeWithOpenTask = await api(pmPay, 'DELETE', `/teams/${teamId}/members/${newEngId}`);
  check('cannot remove a member with open tasks', removeWithOpenTask.status === 400, `got ${removeWithOpenTask.status}`);
  await api(pmPay, 'PATCH', `/tasks/${taskId}`, { status: 'DONE' });
  const removeAfterDone = await api(pmPay, 'DELETE', `/teams/${teamId}/members/${newEngId}`);
  check('can remove once tasks are closed', removeAfterDone.status === 204, `got ${removeAfterDone.status}`);

  section('Weekly report — JSON preview');
  const pmReport = await api(pmPay, 'GET', '/reports/weekly?teamId=' + (await api(pmPay, 'GET', '/teams')).data.find((t) => t.name === 'Payments Core').id);
  check('PM previews a team report', pmReport.status === 200, JSON.stringify(pmReport.data).slice(0, 160));
  check('report has member rows', pmReport.data.members.length === 3, `got ${pmReport.data?.members?.length}`);
  check('report has log rows', pmReport.data.logs.length > 0, `got ${pmReport.data?.logs?.length}`);
  check('report totals hours', pmReport.data.totals.hours > 0, `got ${pmReport.data?.totals?.hours}`);
  check('week runs Monday to Sunday', new Date(pmReport.data.from + 'T00:00:00Z').getUTCDay() === 1 && new Date(pmReport.data.to + 'T00:00:00Z').getUTCDay() === 0);

  const crossTeamReport = await api(pmMob, 'GET', `/reports/weekly?teamId=${teamId}`);
  check("PM cannot report on another PM's team", crossTeamReport.status === 404, `got ${crossTeamReport.status}`);

  const dirProjectReport = await api(dirEng, 'GET', '/reports/weekly?projectId=' + (await api(dirEng, 'GET', '/projects')).data.find((p) => p.code === 'APEX').id);
  check('Director previews a project report', dirProjectReport.status === 200);
  check('project report spans both teams', new Set(dirProjectReport.data.members.map((m) => m.teamName)).size === 2, `got ${new Set(dirProjectReport.data?.members?.map((m) => m.teamName)).size}`);

  const vpAllReport = await api(vp, 'GET', '/reports/weekly');
  check('VP reports across everything', vpAllReport.status === 200 && vpAllReport.data.members.length >= 9, `got ${vpAllReport.data?.members?.length}`);

  const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const lastWeekReport = await api(dirEng, 'GET', `/reports/weekly?week=${lastWeek}`);
  check('a past week can be reported', lastWeekReport.status === 200 && lastWeekReport.data.from < pmReport.data.from);

  const bothScopes = await api(vp, 'GET', `/reports/weekly?teamId=${teamId}&projectId=${projectId}`);
  check('passing both scopes is rejected', bothScopes.status === 400, `got ${bothScopes.status}`);

  section('Weekly report — xlsx download');
  const xlsx = await api(pmPay, 'GET', '/reports/weekly.xlsx');
  check('xlsx downloads', xlsx.status === 200, `got ${xlsx.status}`);
  check('xlsx is a real zip/xlsx file', Buffer.isBuffer(xlsx.data) && xlsx.data.slice(0, 2).toString() === 'PK');
  check('xlsx is a sensible size', xlsx.data.length > 8000, `got ${xlsx.data.length} bytes`);
  const disposition = xlsx.headers.get('content-disposition') ?? '';
  check('filename is set for download', /attachment; filename="weekly-status_.*\.xlsx"/.test(disposition), disposition);
  const engXlsx = await api(engAnita, 'GET', '/reports/weekly.xlsx');
  check('Engineer cannot download the xlsx', engXlsx.status === 403, `got ${engXlsx.status}`);

  if (Buffer.isBuffer(xlsx.data)) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync('/tmp/smoke-report.xlsx', xlsx.data);
  }

  section('Outcomes — filing, visibility and verification');
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const newOutcome = await api(pmPay, 'POST', '/outcomes', {
    teamId,
    title: 'Cut settlement latency for the smoke test merchant cohort',
    category: 'CUSTOMER_VISIBLE',
    landedOn: todayStr,
    narrative: 'Smoke test outcome: shipped a fix that measurably improved settlement latency.',
  });
  check('PM files an outcome on their own team', newOutcome.status === 201, JSON.stringify(newOutcome.data).slice(0, 160));
  const outcomeId = newOutcome.data?.id;

  const engFiles = await api(engAnita, 'POST', '/outcomes', {
    teamId,
    title: 'Should not work',
    category: 'REVENUE_ENABLED',
    landedOn: todayStr,
    narrative: 'An engineer should never be able to file one of these.',
  });
  check('Engineer cannot file an outcome', engFiles.status === 403, `got ${engFiles.status}`);

  const otherPmFiles = await api(pmMob, 'POST', '/outcomes', {
    teamId,
    title: 'Should not work either',
    category: 'REVENUE_ENABLED',
    landedOn: todayStr,
    narrative: 'A PM cannot file on a team they do not lead.',
  });
  check("a PM cannot file an outcome on another PM's team", otherPmFiles.status === 403, `got ${otherPmFiles.status}`);

  const futureOutcome = await api(pmPay, 'POST', '/outcomes', {
    teamId,
    title: 'From the future',
    category: 'REVENUE_ENABLED',
    landedOn: tomorrowStr,
    narrative: 'An outcome cannot land tomorrow — it has not happened yet.',
  });
  check('an outcome cannot land in the future', futureOutcome.status === 400, `got ${futureOutcome.status}`);

  const shortNarrative = await api(pmPay, 'POST', '/outcomes', {
    teamId,
    title: 'Too terse',
    category: 'REVENUE_ENABLED',
    landedOn: todayStr,
    narrative: 'meh',
  });
  check('a narrative that is too short is rejected', shortNarrative.status === 400, `got ${shortNarrative.status}`);

  const engReadsOutcome = await api(engAnita, 'GET', `/outcomes/${outcomeId}`);
  check(
    'an Engineer with no team on it 404s reading a specific outcome',
    engReadsOutcome.status === 404,
    `got ${engReadsOutcome.status}`
  );

  const pmEditsOwn = await api(pmPay, 'PATCH', `/outcomes/${outcomeId}`, { title: 'Cut settlement latency, revised' });
  check('the filing PM can edit their own outcome', pmEditsOwn.status === 200 && pmEditsOwn.data.title.includes('revised'));

  // pmMob has no visibility into pmPay's team at all, so this 404s rather than
  // 403s — same information-leak-avoiding gate GET /outcomes/:id already uses.
  const otherPmEdits = await api(pmMob, 'PATCH', `/outcomes/${outcomeId}`, { title: 'Hijacked' });
  check(
    "a PM with no visibility into the team 404s trying to edit its outcome",
    otherPmEdits.status === 404,
    `got ${otherPmEdits.status}`
  );

  const pmVerifies = await api(pmPay, 'POST', `/outcomes/${outcomeId}/verify`);
  check('a PM cannot verify an outcome', pmVerifies.status === 403, `got ${pmVerifies.status}`);

  const wrongDirVerifies = await api(dirPlat, 'POST', `/outcomes/${outcomeId}/verify`);
  check(
    "a Director who does not own the outcome's project cannot verify it",
    wrongDirVerifies.status === 403,
    `got ${wrongDirVerifies.status}`
  );

  const rightDirVerifies = await api(dirEng, 'POST', `/outcomes/${outcomeId}/verify`);
  check(
    "the Director who owns the outcome's project can verify it",
    rightDirVerifies.status === 200 && Boolean(rightDirVerifies.data.verifiedAt),
    JSON.stringify(rightDirVerifies.data).slice(0, 160)
  );

  section('Portfolio — cross-account leadership view');
  const pmPortfolio = await api(pmPay, 'GET', '/portfolio');
  check('PM gets a 403 on /portfolio', pmPortfolio.status === 403, `got ${pmPortfolio.status}`);
  const engPortfolio = await api(engAnita, 'GET', '/portfolio');
  check('Engineer gets a 403 on /portfolio', engPortfolio.status === 403, `got ${engPortfolio.status}`);

  const dirPortfolio = await api(dirEng, 'GET', '/portfolio');
  check('Director can see the portfolio', dirPortfolio.status === 200, `got ${dirPortfolio.status}`);

  const vpPortfolio = await api(vp, 'GET', '/portfolio');
  check('VP can see the portfolio', vpPortfolio.status === 200, `got ${vpPortfolio.status}`);
  check(
    'portfolio covers at least the seeded accounts',
    vpPortfolio.data.accounts.length >= 2 && vpPortfolio.data.accounts.some((a) => a.code === 'ACME') && vpPortfolio.data.accounts.some((a) => a.code === 'GLOBEX'),
    JSON.stringify(vpPortfolio.data?.accounts?.map((a) => a.code))
  );
  check(
    'each row carries outcome, task and hours trend',
    vpPortfolio.data.accounts.every(
      (a) => 'delta' in a.trend.outcomes && 'delta' in a.trend.tasksDone && 'delta' in a.trend.hours
    )
  );

  check(
    'rows are ranked by risk score, not alphabetically',
    vpPortfolio.data.accounts.every((a, i, arr) => i === 0 || arr[i - 1].risk.score >= a.risk.score)
  );

  const flaggedAccount = vpPortfolio.data.accounts.find((a) => a.risk.items.length > 0);
  check('at least one account is carrying a risk flag', Boolean(flaggedAccount), JSON.stringify(vpPortfolio.data?.accounts?.map((a) => a.risk)));
  const teamRisk = flaggedAccount?.risk.items.find((i) => i.teamId);
  if (teamRisk) {
    const linkedTeam = await api(vp, 'GET', `/teams/${teamRisk.teamId}`);
    check('a risk item with a teamId links through to a real team', linkedTeam.status === 200 && linkedTeam.data.name === teamRisk.teamName, JSON.stringify(teamRisk));
  } else {
    check('a risk item with a teamId links through to a real team', false, 'no team-scoped risk item found to verify');
  }

  section('Weekly digest preview — the in-app "this week" panel');
  const engDigest = await api(engAnita, 'GET', '/digest/preview');
  check('Engineer gets a 403 on the digest preview', engDigest.status === 403, `got ${engDigest.status}`);

  const pmDigest = await api(pmPay, 'GET', '/digest/preview');
  check(
    "a PM's digest preview covers the teams they lead",
    pmDigest.status === 200 && pmDigest.data.items.every((i) => i.scope === 'team') && pmDigest.data.items.some((i) => i.label.includes('Payments Core')),
    JSON.stringify(pmDigest.data?.items?.map((i) => i.label))
  );

  const dirDigest = await api(dirEng, 'GET', '/digest/preview');
  check(
    "a Director's digest preview covers the account they own, not the other one",
    dirDigest.status === 200 &&
      dirDigest.data.items.every((i) => i.scope === 'account') &&
      dirDigest.data.items.some((i) => i.label.includes('ACME')) &&
      !dirDigest.data.items.some((i) => i.label.includes('GLOBEX')),
    JSON.stringify(dirDigest.data?.items?.map((i) => i.label))
  );

  const vpDigest = await api(vp, 'GET', '/digest/preview');
  check(
    "a VP's digest preview covers every account",
    vpDigest.status === 200 && vpDigest.data.items.some((i) => i.label.includes('ACME')) && vpDigest.data.items.some((i) => i.label.includes('GLOBEX')),
    JSON.stringify(vpDigest.data?.items?.map((i) => i.label))
  );

  section('Register — full-text search and redaction');
  const browseAll = await api(vp, 'GET', '/register');
  check('browsing with no query returns results across both kinds', browseAll.status === 200 && browseAll.data.results.length > 0, `got ${browseAll.data?.results?.length}`);
  check(
    'browsing with no query mixes outcomes and completed tasks',
    new Set(browseAll.data.results.map((r) => r.kind)).size === 2,
    JSON.stringify([...new Set(browseAll.data?.results?.map((r) => r.kind))])
  );

  const categoryFiltered = await api(vp, 'GET', '/register?category=CAPABILITY_BUILT');
  check(
    'a category filter excludes completed tasks entirely',
    categoryFiltered.status === 200 &&
      categoryFiltered.data.results.length > 0 &&
      categoryFiltered.data.results.every((r) => r.kind === 'outcome' && r.category === 'CAPABILITY_BUILT'),
    JSON.stringify(categoryFiltered.data?.results?.map((r) => [r.kind, r.category]))
  );

  const vpSearch = await api(vp, 'GET', '/register?q=secrets');
  check('full-text search finds the seeded "secrets" outcome', vpSearch.status === 200 && vpSearch.data.results.some((r) => r.title.includes('secrets')), JSON.stringify(vpSearch.data?.results?.map((r) => r.title)));
  const vpHit = vpSearch.data.results.find((r) => r.title.includes('secrets'));
  check("a viewer who can read the team gets the full result, unredacted", vpHit && vpHit.redacted === false && Boolean(vpHit.teamId) && Boolean(vpHit.narrative), JSON.stringify(vpHit));

  // engAnita is on Payments Core (ACME) and has no team on Platform SRE
  // (GLOBEX) — this is exactly the outcome that lives there.
  const engSearch = await api(engAnita, 'GET', '/register?q=secrets');
  check('an Engineer searching for another account\'s outcome gets a 200, not a 404', engSearch.status === 200, `got ${engSearch.status}`);
  const engHit = engSearch.data?.results?.find((r) => r.title.includes('secrets'));
  check('the redacted result still names the account, team and date', Boolean(engHit) && engHit.redacted === true && Boolean(engHit.accountName) && Boolean(engHit.teamName) && Boolean(engHit.date), JSON.stringify(engHit));
  check(
    'the redacted result hides the team link, the narrative, and who did it',
    Boolean(engHit) && engHit.teamId === null && engHit.projectId === null && !engHit.narrative && !engHit.personName,
    JSON.stringify(engHit)
  );

  const engOwnSearch = await api(engAnita, 'GET', '/register?q=UPI');
  const engOwnHit = engOwnSearch.data?.results?.find((r) => r.title.includes('UPI'));
  check("an Engineer searching for their own team's outcome gets the full result", Boolean(engOwnHit) && engOwnHit.redacted === false && Boolean(engOwnHit.teamId), JSON.stringify(engOwnHit));

  section('Cleanup');
  await api(dirEng, 'DELETE', `/projects/${projectId}/teams/${teamId}`);
  const afterDetach = await api(dirEng, 'GET', `/projects/${projectId}`);
  check('team detaches from the project', afterDetach.data.teams.length === 0, `got ${afterDetach.data?.teams?.length}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(' - ' + f));
    process.exitCode = 1;
  }
};

run().catch((err) => {
  console.error('\nSmoke run crashed:', err);
  process.exitCode = 1;
});
