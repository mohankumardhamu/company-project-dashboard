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
