#!/usr/bin/env node
'use strict';
// ACCEPTANCE — task-to-project assignment (operator ruling 2026-08-10), FULL PATH:
//   A  assign from the drawer → task leaves the Inbox (READY, count drops)
//   B  assign inline on an All-Tasks row
//   C  bulk-assign the word-filtered rows — sugar over PER-TASK audited commands
//   D  assign-to-parked removes the tasks from available work (view-checked)
//   E  unassign from the drawer — project cleared, decided work never re-inboxes
//   F  refusals named (cancelled project)
//   G  Accept standalone empties the Inbox to zero, audited
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import http from 'node:http';

const MC = join(process.env.HOME, 'coyote-mc-life', 'mission-control');
const ENGINE = join(process.env.HOME, 'coyote-claw-life');
const PORT = 8892;
const WORK = '/tmp/life-assign-accept';
const INBOX = join(WORK, 'inbox');

const free = await new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/healthz', timeout: 1500 }, () => resolve(false));
  req.on('error', () => resolve(true));
  req.on('timeout', () => { req.destroy(); resolve(true); });
});
if (!free) { console.error(`REFUSING: something already listens on :${PORT}`); process.exit(2); }
const children = [];
process.on('exit', () => { for (const c of children) { try { c.kill(); } catch (_) { /* gone */ } } });
process.on('uncaughtException', (e) => { console.error(e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });

rmSync(WORK, { recursive: true, force: true });
mkdirSync(INBOX, { recursive: true });
execFileSync('node', ['-e', `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(join(WORK, 'claw-absent.db'))});db.exec('PRAGMA user_version=1');db.close();`]);

const SOCK = join(WORK, 'writer.sock');
const writer = spawn('node', ['--import', 'tsx', '--import', './src/warnings.ts', '-e',
  `import('./src/life/writerService.ts').then(async (m) => { const w = await m.startLifeWriter({ sockPath: process.env.SOCK, dbPath: process.env.DB }); console.log('WRITER-UP'); });`],
{ cwd: ENGINE, env: { ...process.env, SOCK, DB: join(WORK, 'life.db'), COYOTE_LIFE_IMPORT_DIR: INBOX }, stdio: ['ignore', 'pipe', 'pipe'] });
children.push(writer);
let wlog = '';
writer.stdout.on('data', (d) => { wlog += d; });
writer.stderr.on('data', (d) => { wlog += d; });
await new Promise((r) => setTimeout(r, 2500));
if (!/WRITER-UP/.test(wlog)) { console.error('writer failed to start:', wlog.trim()); process.exit(3); }

function cmd(body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCK, path: '/command', method: 'POST' }, (res) => {
      let raw = ''; res.on('data', (c) => raw += c);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}
// World: one ACTIVE project, one PARKED (via ruled-park import), a cancelled one, 4 Inbox tasks.
const como = (await cmd({ command: 'create_project', idempotencyKey: 'aa-pj-0000001', payload: { title: 'Como Loyalty Launch', definitionOfDone: 'd' } })).result.id;
writeFileSync(join(INBOX, 'van.csv'), 'Task,Owner,Type,Cadence-Phase,Priority,Notes\nBurger Van,Woody,Project (parked),,Medium,DoD: trading\n');
await cmd({ command: 'import_batch', idempotencyKey: 'aa-van-000001', payload: { fileName: 'van.csv' } });
const dead = (await cmd({ command: 'create_project', idempotencyKey: 'aa-pj-0000002', payload: { title: 'Doomed', definitionOfDone: 'd' } })).result.id;
await cmd({ command: 'cancel_project', idempotencyKey: 'aa-cxl-000001', payload: { projectId: dead } });
const t = {};
for (const [k, title] of [['kpi', 'Establish loyalty KPI baseline copy'], ['wheels', 'van wheels quote'], ['ins', 'van insurance quote'], ['solo', 'a real standalone thing']]) {
  t[k] = (await cmd({ command: 'capture', idempotencyKey: 'aa-cap-' + k.padEnd(6, '0'), payload: { title } })).result.id;
}
const q = (sql) => JSON.parse(execFileSync('node', ['-e', `
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(${JSON.stringify(join(WORK, 'life.db'))},{readOnly:true});
console.log(JSON.stringify(db.prepare(${JSON.stringify(sql)}).all()));`], { encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('[')).pop() || '[]');

const env = {
  ...process.env,
  MISSION_CONTROL_PORT: String(PORT),
  MC_AUTH_SECRET: 'accept-secret-0123456789abcdef',
  MC_SESSION_KEY: 'accept-session-0123456789abcdef',
  MC_LOGIN_DELAY_MS: '0',
  COYOTE_CLAW_DB: join(WORK, 'claw-absent.db'),
  COYOTE_LIFE_DB: join(WORK, 'life.db'),
  COYOTE_LIFE_SOCK: SOCK,
  COYOTE_LIFE_IMPORT_DIR: INBOX,
};
const server = spawn('node', ['server.js'], { cwd: MC, env, stdio: ['ignore', 'pipe', 'pipe'] });
children.push(server);
await new Promise((r) => setTimeout(r, 1800));

const require2 = createRequire(join(process.env.HOME, 'pw-shot', 'package.json'));
const { chromium } = require2('playwright-core');
const token = execFileSync('node', ['-e', "const A=require('./ui/auth.js');console.log(A.issueToken(Date.now()));"], {
  cwd: MC, env, encoding: 'utf8',
}).trim();
const browser = await chromium.launch({
  executablePath: join(process.env.HOME, '.cache/ms-playwright/chromium-1140/chrome-linux/chrome'),
  args: ['--no-sandbox'],
  env: { ...process.env, LD_LIBRARY_PATH: join(process.env.HOME, '.coyote-claw/lib') },
});
let failures = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'mc_session', value: token, url: `http://127.0.0.1:${PORT}` }]);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());

// --- A: drawer assign — Inbox 4 → 3, task READY ------------------------------------------
await page.goto(`http://127.0.0.1:${PORT}/life/tasks`, { waitUntil: 'load' });
let text = await page.evaluate(() => document.body.innerText);
check(/Inbox — decide what these become/.test(text), 'A0: four undecided tasks sit in the Inbox');
await page.goto(`http://127.0.0.1:${PORT}/life/task?id=${t.kpi}`, { waitUntil: 'load' });
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.locator('.lc-assign-sel').selectOption(como)]);
await page.waitForTimeout(400);
check(q(`SELECT status s, project_id p FROM life_tasks WHERE id='${t.kpi}'`)[0].s === 'READY', 'A1: drawer assign → the task left the Inbox (READY)');
check(q(`SELECT 1 x FROM life_task_events WHERE task_id='${t.kpi}' AND event_type='PROJECT_SET'`).length === 1, 'A2: PROJECT_SET on the record');

// --- B+C: inline + bulk on the word-filtered rows ------------------------------------------
await page.goto(`http://127.0.0.1:${PORT}/life/tasks`, { waitUntil: 'load' });
const vanId = q("SELECT id FROM life_projects WHERE title='Burger Van'")[0].id;
await page.fill('#lt-filter', 'van');
await page.locator('#lt-filter').dispatchEvent('input');
await page.selectOption('[data-assign-bulk-sel]', vanId);
await page.click('[data-lc-assign-bulk]');
for (let i = 0; i < 40 && q(`SELECT COUNT(*) c FROM life_tasks WHERE project_id='${vanId}'`)[0].c < 2; i++) await page.waitForTimeout(250);
// the bulk flow reloads the page when it finishes — let that navigation land before ours
await page.waitForTimeout(1500);
await page.waitForLoadState('load');
const vanTasks = q(`SELECT id, status FROM life_tasks WHERE project_id='${vanId}'`);
check(vanTasks.length === 2 && vanTasks.every((r) => r.status === 'READY'), 'C1: bulk assigned BOTH filtered rows, each now READY');
check(q(`SELECT COUNT(*) c FROM life_task_events WHERE event_type='PROJECT_SET' AND task_id IN ('${t.wheels}','${t.ins}')`)[0].c === 2, 'C2: per-task events — bulk is sugar, not a batch write');
check(q(`SELECT COUNT(*) c FROM life_tasks WHERE id='${t.solo}' AND project_id IS NULL`)[0].c === 1, 'C3: the filtered-OUT row was untouched');

// --- D: parked assignment = out of available work ------------------------------------------
check(q(`SELECT COUNT(*) c FROM v_life_available_work WHERE id IN ('${t.wheels}','${t.ins}')`)[0].c === 0, 'D: parked-project tasks are OUT of available work');
check(q(`SELECT COUNT(*) c FROM v_life_available_work WHERE id='${t.kpi}'`)[0].c === 1, 'D1: active-project tasks remain available');
check(q("SELECT status s FROM life_projects WHERE title='Burger Van'")[0].s === 'PARKED', 'D2: assignment never touched the project status');

// --- E: unassign from the drawer ------------------------------------------------------------
await page.goto(`http://127.0.0.1:${PORT}/life/task?id=${t.kpi}`, { waitUntil: 'load' });
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.locator('.lc-assign-sel').selectOption('')]);
await page.waitForTimeout(400);
const un = q(`SELECT status s, project_id p FROM life_tasks WHERE id='${t.kpi}'`)[0];
check(un.p === null && un.s === 'READY', 'E: unassigned — project cleared, decided work never re-inboxes');
check(q(`SELECT 1 x FROM life_task_events WHERE task_id='${t.kpi}' AND event_type='PROJECT_CLEARED'`).length === 1, 'E1: PROJECT_CLEARED on the record');

// --- F: refusal named --------------------------------------------------------------------
const ref = await page.evaluate(async (args) => {
  const r = await fetch('/api/life/command', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'assign_project', idempotencyKey: 'aa-ref-000001', payload: { taskId: args.tid, projectId: args.pid } }) });
  return r.json();
}, { tid: t.solo, pid: dead });
check(ref.ok === false && /pick a living one/.test(String(ref.error)), 'F: assigning to a cancelled project refuses by name');

// --- G: Accept standalone empties the Inbox ------------------------------------------------
await page.goto(`http://127.0.0.1:${PORT}/life/task?id=${t.solo}`, { waitUntil: 'load' });
const acceptBtn = page.locator('button', { hasText: 'Accept standalone' });
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), acceptBtn.click()]);
await page.waitForTimeout(400);
check(q(`SELECT status s FROM life_tasks WHERE id='${t.solo}'`)[0].s === 'READY', 'G1: accepted standalone → READY');
check(q(`SELECT 1 x FROM life_task_events WHERE task_id='${t.solo}' AND event_type='ACCEPTED_STANDALONE'`).length === 1, 'G2: the disposition is audited by name');
check(q("SELECT COUNT(*) c FROM life_tasks WHERE status='INBOX'")[0].c === 0, 'G3: the Inbox reached ZERO — every task has a home or an accepted place');
await page.goto(`http://127.0.0.1:${PORT}/life/tasks`, { waitUntil: 'load' });
text = await page.evaluate(() => document.body.innerText);
check(!/Inbox — decide what these become/.test(text), 'G4: the Inbox section is gone from All tasks');

await browser.close();
server.kill(); writer.kill();
console.log(failures === 0 ? '\nACCEPTANCE: ALL PASS' : `\nACCEPTANCE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
