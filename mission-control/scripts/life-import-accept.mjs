#!/usr/bin/env node
'use strict';
// ACCEPTANCE — Life OS bulk import, FULL PATH (operator brief 2026-08-08): real engine
// writer (feature branch, scratch inbox + scratch life.db) + real MC relay + chromium.
//   A  the dropped file appears in the Import panel; Preview renders the staged plan
//   B  preview pins the soft refresh (the operator reads at their own pace)
//   C  recurrence rulings chosen per row; commit prompts for the project + its DoD
//   D  report: project ACTIVE, 6 created, vendor row WAITING, agent-cadence reported only
//   E  the committed world: project on /life/projects with its DoD; tasks in All tasks
//   F  re-preview shows every row already imported — a re-commit would create nothing
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import http from 'node:http';

const MC = join(process.env.HOME, 'coyote-mc-life', 'mission-control');
const ENGINE = join(process.env.HOME, 'coyote-claw-life');
const PORT = 8895;
const WORK = '/tmp/life-import-accept';
const INBOX = join(WORK, 'inbox');

const free = await new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/healthz', timeout: 1500 }, () => resolve(false));
  req.on('error', () => resolve(true));
  req.on('timeout', () => { req.destroy(); resolve(true); });
});
if (!free) { console.error(`REFUSING: something already listens on :${PORT}`); process.exit(2); }

// A crashed assertion must NEVER orphan the scratch servers (the stale-server incident
// class): every spawned child dies with this process, whatever the exit path.
const children = [];
process.on('exit', () => { for (const c of children) { try { c.kill(); } catch (_) { /* gone */ } } });
process.on('uncaughtException', (e) => { console.error(e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });

rmSync(WORK, { recursive: true, force: true });
mkdirSync(INBOX, { recursive: true });
execFileSync('node', ['-e', `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(join(WORK, 'claw-absent.db'))});db.exec('PRAGMA user_version=1');db.close();`]);

writeFileSync(join(INBOX, 'loyalty-launch.csv'), [
  'Task,Owner,Type,Cadence-Phase,Priority,Notes',
  'Build the launch catalogue,Woody,Task,Phase 1,High,Star values per item',
  'Wire the webhook relay,Mission Control,Task,Phase 1,High,',
  'Brief the floor team,Calum,Task,Phase 2,Medium,',
  'Confirm stars economics,Woody + Como,Task,Phase 1,Critical,',
  'Enable loyalty in the till,Lightspeed,Task,Phase 1,High,vendor switch-on',
  'Reconcile Como and Lightspeed,Mission Control,Task,Weekly,High,future ingest gate',
  'Rotate the welcome offer,Woody,Task,Monthly,Low,',
].join('\n'));

// The REAL writer, from the feature branch, with the scratch inbox.
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

const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
await ctx.addCookies([{ name: 'mc_session', value: token, url: `http://127.0.0.1:${PORT}` }]);
const page = await ctx.newPage();

// --- A: file listed; Preview renders the staged plan --------------------------------------
await page.goto(`http://127.0.0.1:${PORT}/life/tasks`, { waitUntil: 'networkidle' });
check(await page.locator('[data-lc-import="loyalty-launch.csv"]').count() === 1, 'A0: the dropped file offers Preview');
await page.click('[data-lc-import="loyalty-launch.csv"]');
await page.waitForSelector('[data-import-commit]', { timeout: 10_000 });
const previewText = await page.locator('[data-import-out]').innerText();
check(/nothing is created yet/i.test(previewText), 'A1: the preview says nothing is created yet');
check(/Will be created — 5/.test(previewText), 'A2: five one-off rows plan as created');
check(/Recurring — not supported yet \(2\)/.test(previewText), 'A3: both cadenced rows split out for rulings, never flattened');
check(/waits on Lightspeed \(follow-up in 14 days\)/.test(previewText), 'A4: the vendor wait is named in the preview');
check(/→ HYBRID/.test(previewText) && /→ AI/.test(previewText) && /→ DELEGATE/.test(previewText), 'A5: route mapping reported per row');

// --- B: an open preview pins the soft refresh ----------------------------------------------
await page.evaluate(() => { window.__probe = 1; });
await page.waitForTimeout(35_000);
check(await page.evaluate(() => window.__probe) === 1, 'B: the preview held the page open past a refresh tick');

// --- C+D: rulings, commit (project + DoD via prompts), report ------------------------------
const recs = page.locator('[data-imp-rec]');
check(await recs.count() === 2, 'C0: two recurrence rulings offered');
await recs.nth(0).locator('.imp-disp').selectOption('agent');   // Reconcile Como and Lightspeed
await recs.nth(1).locator('.imp-disp').selectOption('once');    // Rotate the welcome offer
await recs.nth(1).locator('.imp-date').fill('2026-09-01');
const DOD = 'Launch catalogue live; stars economics confirmed; reconciliation clean.';
const prompts = ['Como Loyalty Launch', DOD];
page.on('dialog', (d) => d.accept(prompts.shift() ?? ''));
await page.click('[data-import-commit]');
// the PREVIEW carries its own close button too — wait for the REPORT text, not the button.
// (page.waitForFunction trips the board's CSP — no unsafe-eval — so poll via evaluate.)
let report = '';
for (let tries = 0; tries < 40 && !/Imported — /.test(report); tries++) {
  await page.waitForTimeout(250);
  report = await page.evaluate(() => (document.querySelector('[data-import-out]') || {}).innerText || '');
}
check(/Imported — loyalty-launch\.csv/.test(report), 'D0: the commit report rendered');
check(/Como Loyalty Launch — created ACTIVE/.test(report), 'D1: the project created ACTIVE');
check(/Created: 6/.test(report), 'D2: six tasks created (5 one-offs + the once-with-wake)');
check(/Reconcile Como and Lightspeed \(Weekly\) — commission as a timer/.test(report), 'D3: the agent-cadence row reported, never created');

// --- E: the committed world ------------------------------------------------------------------
await page.click('[data-import-close]');
await page.waitForLoadState('networkidle');
const tasksText = await page.evaluate(() => document.body.innerText);
check(/Build the launch catalogue/.test(tasksText) && /Enable loyalty in the till/.test(tasksText), 'E0: imported tasks live in All tasks');
check(/waiting on Lightspeed/i.test(tasksText), 'E1: the vendor row parked WAITING on Lightspeed');
check(!/Reconcile Como and Lightspeed/.test(tasksText), 'E2: the agent-cadence row is NOT a planner task');
await page.goto(`http://127.0.0.1:${PORT}/life/projects`, { waitUntil: 'networkidle' });
const projText = await page.evaluate(() => document.body.innerText);
check(/Como Loyalty Launch/.test(projText) && projText.includes(DOD), 'E3: the project card carries its definition of done');

// --- F: re-preview → everything already imported ----------------------------------------------
await page.goto(`http://127.0.0.1:${PORT}/life/tasks`, { waitUntil: 'networkidle' });
await page.click('[data-lc-import="loyalty-launch.csv"]');
await page.waitForSelector('[data-import-commit]', { timeout: 10_000 });
const re = await page.locator('[data-import-out]').innerText();
check(/Already imported \(untouched on re-import\): 6/.test(re), 'F: a re-preview knows every landed row — a re-commit creates nothing');

await browser.close();
server.kill();
writer.kill();
console.log(failures === 0 ? '\nACCEPTANCE: ALL PASS' : `\nACCEPTANCE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
