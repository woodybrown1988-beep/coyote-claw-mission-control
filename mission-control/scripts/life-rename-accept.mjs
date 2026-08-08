#!/usr/bin/env node
'use strict';
// ACCEPTANCE — rename/delete for projects + tasks (operator ask 2026-08-08), FULL PATH:
// real engine writer (feature branch, over its Unix socket) + real MC relay + chromium.
//   A  rename a project from its card: prompt prefilled → writer applies → card shows it
//   B  cancel a project (confirm) → leaves the active slots, shows cancelled in the rest
//   C  rename a task from the All-tasks row without opening the drawer
//   D  the RENAMED audit event carries old + new titles in life.db
//   E  renaming finished work refuses INLINE in owner language (no dialogs beyond the prompt)
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import http from 'node:http';

const MC = join(process.env.HOME, 'coyote-mc-life', 'mission-control');
const ENGINE = join(process.env.HOME, 'coyote-claw-life');
const PORT = 8896;
const WORK = '/tmp/life-rename-accept';

const free = await new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/healthz', timeout: 1500 }, () => resolve(false));
  req.on('error', () => resolve(true));
  req.on('timeout', () => { req.destroy(); resolve(true); });
});
if (!free) { console.error(`REFUSING: something already listens on :${PORT}`); process.exit(2); }

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
execFileSync('node', [join(MC, 'scripts', 'life-visual-fixture.mjs'), join(WORK, 'life.db')], { stdio: 'inherit' });
execFileSync('node', ['-e', `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(join(WORK, 'claw-absent.db'))});db.exec('PRAGMA user_version=1');db.close();`]);

// The REAL writer, from the feature branch, on a scratch socket + the fixture db.
const SOCK = join(WORK, 'writer.sock');
const writer = spawn('node', ['--import', 'tsx', '--import', './src/warnings.ts', '-e',
  `import('./src/life/writerService.ts').then(async (m) => { const w = await m.startLifeWriter({ sockPath: process.env.SOCK, dbPath: process.env.DB }); console.log('WRITER-UP'); });`],
{ cwd: ENGINE, env: { ...process.env, SOCK, DB: join(WORK, 'life.db') }, stdio: ['ignore', 'pipe', 'pipe'] });
let wlog = '';
writer.stdout.on('data', (d) => { wlog += d; });
writer.stderr.on('data', (d) => { wlog += d; });
await new Promise((r) => setTimeout(r, 2500));
if (!/WRITER-UP/.test(wlog)) { console.error('writer failed to start:', wlog.trim()); process.exit(3); }

const env = {
  ...process.env,
  MISSION_CONTROL_PORT: String(PORT),
  MC_AUTH_SECRET: 'accept-secret-0123456789abcdef',
  MC_SESSION_KEY: 'accept-session-0123456789abcdef',
  MC_LOGIN_DELAY_MS: '0',
  COYOTE_CLAW_DB: join(WORK, 'claw-absent.db'),
  COYOTE_LIFE_DB: join(WORK, 'life.db'),
  COYOTE_LIFE_SOCK: SOCK,
};
const server = spawn('node', ['server.js'], { cwd: MC, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addCookies([{ name: 'mc_session', value: token, url: `http://127.0.0.1:${PORT}` }]);
const page = await ctx.newPage();

// --- A: rename the Loyalty pilot project from its card -----------------------------------
await page.goto(`http://127.0.0.1:${PORT}/life/projects`, { waitUntil: 'networkidle' });
const before = await page.evaluate(() => document.body.innerText.includes('Loyalty pilot'));
check(before, 'A0: fixture project on the page');
page.once('dialog', (d) => d.accept('Loyalty pilot — phase two'));
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }),
  page.click('[data-lc-rename*="pj-1"]'),
]);
const renamed = await page.evaluate(() => document.body.innerText.includes('Loyalty pilot — phase two'));
check(renamed, 'A: project renamed through the REAL writer, card shows the new name');

// --- B: cancel the half-term project (confirm accepted) ----------------------------------
page.once('dialog', (d) => d.accept());
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }),
  page.click('[data-lc-cancel-project="pj-2"]'),
]);
const pj2Status = execFileSync('node', ['-e', `
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(${JSON.stringify(join(WORK, 'life.db'))},{readOnly:true});
console.log(db.prepare("SELECT status FROM life_projects WHERE id='pj-2'").get().status);`],
{ encoding: 'utf8' }).trim().split('\n').pop();
const pj2Controls = await page.locator('[data-lc-cancel-project="pj-2"], [data-lc-rename*="pj-2"]').count();
const restPanel = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('.r-panel-title')];
  const h = heads.find((x) => /Waiting, parked and finished/.test(x.textContent));
  const panel = h && h.closest('.r-panel');
  return panel ? panel.innerText : '';
});
check(pj2Status === 'CANCELLED' && pj2Controls === 0 && /October half-term/.test(restPanel) && /cancelled/.test(restPanel),
  `B: project CANCELLED in life.db, controls gone, listed under finished as cancelled (status=${pj2Status})`);

// --- C: rename a task straight from the All-tasks row -------------------------------------
await page.goto(`http://127.0.0.1:${PORT}/life/tasks`, { waitUntil: 'networkidle' });
const firstRename = page.locator('[data-task-row] [data-lc-rename]').first();
const info = JSON.parse(await firstRename.getAttribute('data-lc-rename'));
page.once('dialog', (d) => d.accept(info.title + ' (renamed)'));
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }),
  firstRename.click(),
]);
const rowRenamed = await page.evaluate((t) => document.body.innerText.includes(t), info.title + ' (renamed)');
check(rowRenamed, `C: task renamed in place from the row ("${info.title}" → "…(renamed)")`);

// --- D: the RENAMED audit event carries both titles ---------------------------------------
const ev = execFileSync('node', ['-e', `
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(${JSON.stringify(join(WORK, 'life.db'))},{readOnly:true});
const r=db.prepare("SELECT payload_json FROM life_task_events WHERE event_type='RENAMED' AND task_id=?").get(${JSON.stringify(info.id)});
console.log(r?r.payload_json:'MISSING');`], { encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('{'))[0] || 'MISSING';
const payload = ev === 'MISSING' ? null : JSON.parse(ev);
check(payload && payload.from === info.title && payload.to === info.title + ' (renamed)',
  `D: RENAMED event keeps the old name on the record (${ev})`);

// --- E: renaming finished work refuses INLINE in owner language ---------------------------
execFileSync('node', ['-e', `
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(${JSON.stringify(join(WORK, 'life.db'))});
db.exec("UPDATE life_projects SET status='DONE', stage='DONE' WHERE id='pj-1'");db.close();`]);
// pj-1 is DONE now; the page hides its controls — drive the command directly through the
// RELAY (the stale-page case: a control rendered before the status changed).
const refusal = await page.evaluate(async () => {
  const r = await fetch('/api/life/command', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'rename_project', idempotencyKey: 'accept-e-0001', payload: { projectId: 'pj-1', title: 'rewrite history' } }) });
  return r.json();
});
check(refusal && refusal.ok === false && /keeps its name/.test(String(refusal.error)),
  `E1: the real writer refuses by name ("${refusal && refusal.error}")`);
await page.goto(`http://127.0.0.1:${PORT}/life/projects`, { waitUntil: 'networkidle' });
const doneControls = await page.locator('[data-lc-cancel-project="pj-1"], [data-lc-rename*="pj-1"]').count();
check(doneControls === 0, 'E2: a DONE project renders no rename/cancel controls');

await browser.close();
server.kill();
writer.kill();
console.log(failures === 0 ? '\nACCEPTANCE: ALL PASS' : `\nACCEPTANCE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
