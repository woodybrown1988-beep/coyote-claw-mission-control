#!/usr/bin/env node
'use strict';
// ACCEPTANCE — recapture-on-complete (operator GO 2026-08-10), FULL PATH: real writer +
// real MC relay + chromium driving the real dialogs.
//   A  imported once-with-wake statutory rows arrive FLAGGED; the drawer shows it
//   B  Mark done → the recapture prompt is PREFILLED with the cadence-advanced date;
//      one tap accepts → successor lives with the flag + date; RECAPTURED audited
//   C  dismissing prompts one named confirm → audited RECAPTURE_DECLINED, no successor
//   D  cancelling the confirm aborts the whole completion — the task stays open
//   E  a bare complete (focus overlay) REFUSES inline in owner language
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import http from 'node:http';

const MC = join(process.env.HOME, 'coyote-mc-life', 'mission-control');
const ENGINE = join(process.env.HOME, 'coyote-claw-life');
const PORT = 8894;
const WORK = '/tmp/life-recapture-accept';
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
writeFileSync(join(INBOX, 'statutory.csv'), [
  'Task,Owner,Type,Cadence-Phase,Priority,Notes',
  'VAT analysis and payment,Woody,Task,Quarterly,High,',
  'Run monthly payroll,Woody,Task,Monthly,High,',
  'Confirmation statement,Woody,Task,Annually,Medium,',
].join('\n'));

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
// Import the three statutory rows once-with-wake (arrives FLAGGED — part of the proof).
const prev = await cmd({ command: 'import_preview', idempotencyKey: 'ra-prev-00001', payload: { fileName: 'statutory.csv' } });
const dispositions = prev.result.tasks.map((t) => ({ source: t.source, choice: 'once', wakeDate: { V: '2026-09-07', R: '2026-08-29', C: '2027-03-20' }[t.title[0]] }));
await cmd({ command: 'import_batch', idempotencyKey: 'ra-batch-0001', payload: { fileName: 'statutory.csv', dispositions } });

const q = (sql) => JSON.parse(execFileSync('node', ['-e', `
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(${JSON.stringify(join(WORK, 'life.db'))},{readOnly:true});
console.log(JSON.stringify(db.prepare(${JSON.stringify(sql)}).all()));`], { encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('[')).pop() || '[]');

const ids = Object.fromEntries(q("SELECT id, title FROM life_tasks").map((r) => [r.title, r.id]));

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
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
await ctx.addCookies([{ name: 'mc_session', value: token, url: `http://127.0.0.1:${PORT}` }]);
const page = await ctx.newPage();

// --- A + B: accept the prefilled recapture on VAT (due 2026-09-07, Quarterly → 2026-12-07)
await page.goto(`http://127.0.0.1:${PORT}/life/task?id=${ids['VAT analysis and payment']}`, { waitUntil: 'networkidle' });
const body = await page.evaluate(() => document.body.innerText);
check(/repeats · quarterly/i.test(body), 'A: the drawer names the obligation (imported pre-flagged)');
let sawDefault = null;
const dialogQueue = [
  (d) => d.accept('receipts filed'),                                  // evidence
  (d) => { sawDefault = d.defaultValue(); d.accept(d.defaultValue()); }, // recapture — ONE TAP on the prefill
];
page.on('dialog', (d) => (dialogQueue.shift() || ((x) => x.dismiss()))(d));
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('[data-lc-complete]')]);
await page.waitForTimeout(600);
check(sawDefault === '2026-12-07', `B0: the prompt came PREFILLED with the cadence-advanced date (${sawDefault})`);
const succ = q(`SELECT title, status, recurs, due_at FROM life_tasks WHERE source_ref = 'recapture:${ids['VAT analysis and payment']}'`);
check(succ.length === 1 && succ[0].recurs === 'Quarterly' && succ[0].due_at === '2026-12-07T09:00:00.000Z',
  'B1: one tap → the successor lives, flag + advanced date carried');
check(q(`SELECT 1 x FROM life_task_events WHERE task_id='${ids['VAT analysis and payment']}' AND event_type='RECAPTURED'`).length === 1, 'B2: RECAPTURED is on the record');

// --- C: decline on payroll — dismiss the prompt, accept the named confirm ----------------
await page.goto(`http://127.0.0.1:${PORT}/life/task?id=${ids['Run monthly payroll']}`, { waitUntil: 'networkidle' });
let confirmText = '';
dialogQueue.push(
  (d) => d.accept(''),        // evidence
  (d) => d.dismiss(),         // recapture prompt → dismiss
  (d) => { confirmText = d.message(); d.accept(); },  // the named confirm → decline for real
);
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('[data-lc-complete]')]);
await page.waitForTimeout(600);
check(/on the record/.test(confirmText), 'C0: dismissal goes through one NAMED confirm');
check(q(`SELECT 1 x FROM life_task_events WHERE task_id='${ids['Run monthly payroll']}' AND event_type='RECAPTURE_DECLINED'`).length === 1,
  'C1: the drop is an audited choice (RECAPTURE_DECLINED)');
check(q(`SELECT 1 x FROM life_tasks WHERE source_ref='recapture:${ids['Run monthly payroll']}'`).length === 0, 'C2: declining creates nothing');

// --- D: cancelling the confirm aborts the completion entirely ----------------------------
await page.goto(`http://127.0.0.1:${PORT}/life/task?id=${ids['Confirmation statement']}`, { waitUntil: 'networkidle' });
dialogQueue.push((d) => d.accept(''), (d) => d.dismiss(), (d) => d.dismiss()); // evidence, prompt-dismiss, confirm-CANCEL
await page.click('[data-lc-complete]');
await page.waitForTimeout(800);
check(q(`SELECT status s FROM life_tasks WHERE id='${ids['Confirmation statement']}'`)[0].s === 'INBOX',
  'D: aborting the confirm leaves the task open — nothing sent');
check(q(`SELECT 1 x FROM life_task_events WHERE task_id='${ids['Confirmation statement']}' AND event_type IN ('RECAPTURED','RECAPTURE_DECLINED')`).length === 0,
  'D1: and nothing on the record');

// --- E: a bare complete path refuses inline in owner language ----------------------------
const bare = await page.evaluate(async (taskId) => {
  const r = await fetch('/api/life/command', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'complete', idempotencyKey: 'ra-bare-00001', payload: { taskId } }) });
  return r.json();
}, ids['Confirmation statement']);
check(bare.ok === false && /recurring obligation/.test(String(bare.error)), 'E: the writer refuses a bare complete on an obligation, by name');

await browser.close();
server.kill(); writer.kill();
console.log(failures === 0 ? '\nACCEPTANCE: ALL PASS' : `\nACCEPTANCE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
