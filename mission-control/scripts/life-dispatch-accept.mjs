#!/usr/bin/env node
'use strict';
// ACCEPTANCE — Life OS agent dispatch (operator GO 2026-08-10), the ruled list end to end:
//   A  one real task dispatched (boxquery shape → a real librarian job with the life pointer)
//   B  a NEEDS-YOU-REALLY task correctly NOT dispatched (refusal audited + re-route recommendation)
//   C  an agent state-transition attempt refused by name
//   D  the job worked (simulated worker) with spend METERED ON THE JOB RECORD
//   E  delivered: agent update + pointer + propose_completion on the task
//   F  Today renders the deliverable as material; OWNER Accept → DONE with evidence attached
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import http from 'node:http';

const MC = join(process.env.HOME, 'coyote-mc-life', 'mission-control');
const ENGINE = join(process.env.HOME, 'coyote-claw-life');
const PORT = 8891;
const WORK = '/tmp/life-dispatch-accept';

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
mkdirSync(WORK, { recursive: true });

const SOCK = join(WORK, 'writer.sock');
const LIFE_DB = join(WORK, 'life.db');
const LIB_DB = join(WORK, 'librarian.db');
const writer = spawn('node', ['--import', 'tsx', '--import', './src/warnings.ts', '-e',
  `import('./src/life/writerService.ts').then(async (m) => { const w = await m.startLifeWriter({ sockPath: process.env.SOCK, dbPath: process.env.DB }); console.log('WRITER-UP'); });`],
{ cwd: ENGINE, env: { ...process.env, SOCK, DB: LIFE_DB }, stdio: ['ignore', 'pipe', 'pipe'] });
children.push(writer);
let wlog = '';
writer.stdout.on('data', (d) => { wlog += d; });
writer.stderr.on('data', (d) => { wlog += d; });
await new Promise((r) => setTimeout(r, 2500));
if (!/WRITER-UP/.test(wlog)) { console.error('writer failed:', wlog.trim()); process.exit(3); }

function cmd(body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCK, path: '/command', method: 'POST' }, (res) => {
      let raw = ''; res.on('data', (c) => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(raw) }));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}
const engineEval = (code) => execFileSync('node', ['--import', 'tsx', '--import', './src/warnings.ts', '-e', code],
  { cwd: ENGINE, env: { ...process.env, COYOTE_LIFE_SOCK: SOCK, COYOTE_LIFE_DB: LIFE_DB, COYOTE_CLAW_DB: LIB_DB }, encoding: 'utf8' });
const q = (sql, db = LIFE_DB) => JSON.parse(execFileSync('node', ['-e', `
const {DatabaseSync}=require('node:sqlite');
const d=new DatabaseSync(${JSON.stringify(db)},{readOnly:true});
console.log(JSON.stringify(d.prepare(${JSON.stringify(sql)}).all()));`], { encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('[')).pop() || '[]');

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };

// ── World: one ACTIVE project, a data-shaped AI task + a portal-shaped AI task ──
const pid = (await cmd({ command: 'create_project', idempotencyKey: 'da-pj-0000001', payload: { title: 'Como Loyalty Launch', definitionOfDone: 'd' } })).json.result.id;
const mk = async (n, title, description) => {
  const tid = (await cmd({ command: 'capture', idempotencyKey: `da-cap-${n}`.padEnd(12, '0'), payload: { title, description } })).json.result.id;
  await cmd({ command: 'transition', idempotencyKey: `da-tr-${n}`.padEnd(12, '0'), payload: { taskId: tid, to: 'READY' } });
  await cmd({ command: 'set_route', idempotencyKey: `da-rt-${n}`.padEnd(12, '0'), payload: { taskId: tid, mode: 'AI' } });
  execFileSync('node', ['-e', `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(LIFE_DB)});d.exec("PRAGMA busy_timeout=5000");d.prepare('UPDATE life_tasks SET project_id = ? WHERE id = ?').run(${JSON.stringify(pid)}, ${JSON.stringify(tid)});d.close();`]);
  return tid;
};
const kpi = await mk('1', 'Establish loyalty KPI baseline', 'Record member penetration, AOV, visit frequency, redemption and direct-order share.');
const portal = await mk('2', 'Update tier thresholds in the Como portal', 'vendor portal work');

// ── A+B: sweep #1 dispatches the data shape, refuses the portal shape ──
const sweep1 = engineEval(`
Promise.all([import('./src/db.ts'), import('./src/librarian.ts'), import('./src/dispatcher/dispatch.ts')]).then(async ([d, l, disp]) => {
  const db = d.openDb(process.env.COYOTE_CLAW_DB);
  const lib = new l.Librarian(db);
  const r = await disp.sweepDispatch(lib, disp.udsClient(process.env.COYOTE_LIFE_SOCK), process.env.COYOTE_LIFE_DB, Date.now());
  console.log('SWEEP', JSON.stringify(r)); db.close();
});`);
const r1 = JSON.parse(sweep1.split('\n').find((l) => l.startsWith('SWEEP ')).slice(6));
check(r1.dispatched.length === 1 && r1.dispatched[0].kind === 'boxquery', `A: the KPI task dispatched as a boxquery job (${r1.dispatched[0]?.jobId?.slice(0, 8)})`);
check(r1.refused.length === 1 && r1.refused[0].taskId === portal, 'B: the Como-portal task correctly NOT dispatched (refused by shape)');
check(q(`SELECT reason FROM life_update_proposals WHERE task_id='${portal}' AND capability_key='agent_dispatch'`).some((r) => /re-routing HYBRID/.test(r.reason)),
  'B1: the refusal carries a re-route-HYBRID recommendation for your tap');
const jobId = r1.dispatched[0].jobId;

// ── C: an agent tries to ACT — refused by name ──
const agentComplete = await cmd({ command: 'complete', actor: { type: 'AGENT', id: 'boxquery' }, idempotencyKey: 'da-nc-0000001', payload: { taskId: kpi } });
check(agentComplete.status === 403 && /never acts/.test(String(agentComplete.json.error)), 'C: agent state-transition attempt refused by name');

// ── D: the worker does the job; spend lands ON THE JOB RECORD ──
engineEval(`
Promise.all([import('./src/db.ts'), import('./src/librarian.ts')]).then(([d, l]) => {
  const db = d.openDb(process.env.COYOTE_CLAW_DB);
  const lib = new l.Librarian(db);
  const c = lib.claimNext('boxquery');
  lib.transition(c.id, 'dispatched'); lib.transition(c.id, 'running');
  lib.recordSpend({ jobId: c.id, costPence: 14, note: 'boxquery run (dispatch acceptance)' });
  lib.transition(c.id, 'awaiting_signoff');
  lib.transition(c.id, 'done', { result: { replyText: 'KPI baseline: AOV £31.80 · direct-order share 22% · redemption 9.1%. Member penetration BLOCKED on the Como member export — that field stays honest-empty until the vendor data lands.' } });
  db.close(); console.log('WORKED');
});`);
check(q(`SELECT SUM(cost_pence) s FROM spend_log WHERE job_id='${jobId}'`, LIB_DB)[0].s === 14, 'D: spend metered on the job record (14p)');

// ── E: sweep #2 brings it home — update + pointer + proposal ──
const sweep2 = engineEval(`
Promise.all([import('./src/db.ts'), import('./src/librarian.ts'), import('./src/dispatcher/dispatch.ts')]).then(async ([d, l, disp]) => {
  const db = d.openDb(process.env.COYOTE_CLAW_DB);
  const lib = new l.Librarian(db);
  const r = await disp.sweepDispatch(lib, disp.udsClient(process.env.COYOTE_LIFE_SOCK), process.env.COYOTE_LIFE_DB, Date.now());
  console.log('SWEEP', JSON.stringify(r)); db.close();
});`);
const r2 = JSON.parse(sweep2.split('\n').find((l) => l.startsWith('SWEEP ')).slice(6));
check(r2.delivered.length === 1, 'E: the finished job came home');
check(q(`SELECT raw_text FROM life_task_updates WHERE task_id='${kpi}' AND actor_type='AGENT'`).some((u) => /BLOCKED on the Como member export/.test(u.raw_text)),
  'E1: the deliverable (including its HONEST blocked-on-Como line) is on the task');
const prop = q(`SELECT id, state FROM life_update_proposals WHERE task_id='${kpi}' AND capability_key='agent_delivery'`)[0];
check(prop && prop.state === 'PROPOSED', 'E2: propose_completion awaits the owner');

// ── F: Today renders it material; Accept = DONE with evidence ──
const env = {
  ...process.env,
  MISSION_CONTROL_PORT: String(PORT), MC_AUTH_SECRET: 'accept-secret-0123456789abcdef',
  MC_SESSION_KEY: 'accept-session-0123456789abcdef', MC_LOGIN_DELAY_MS: '0',
  COYOTE_CLAW_DB: LIB_DB, COYOTE_LIFE_DB: LIFE_DB, COYOTE_LIFE_SOCK: SOCK,
};
const server = spawn('node', ['server.js'], { cwd: MC, env, stdio: ['ignore', 'pipe', 'pipe'] });
children.push(server);
await new Promise((r) => setTimeout(r, 1800));
const require2 = createRequire(join(process.env.HOME, 'pw-shot', 'package.json'));
const { chromium } = require2('playwright-core');
const token = execFileSync('node', ['-e', "const A=require('./ui/auth.js');console.log(A.issueToken(Date.now()));"], { cwd: MC, env, encoding: 'utf8' }).trim();
const browser = await chromium.launch({
  executablePath: join(process.env.HOME, '.cache/ms-playwright/chromium-1140/chrome-linux/chrome'),
  args: ['--no-sandbox'], env: { ...process.env, LD_LIBRARY_PATH: join(process.env.HOME, '.coyote-claw/lib') },
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'mc_session', value: token, url: `http://127.0.0.1:${PORT}` }]);
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/life/today`, { waitUntil: 'load' });
const text = await page.evaluate(() => document.body.innerText);
check(/Agent deliverable awaiting your accept/.test(text), 'F0: Today names the deliverable, material — never quiet-folded');
const acceptBtn = page.locator('button', { hasText: /^Accept$/ }).first();
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), acceptBtn.click()]);
await page.waitForTimeout(500);
const done = q(`SELECT status, closure_evidence_note, closure_evidence_uri FROM life_tasks WHERE id='${kpi}'`)[0];
check(done.status === 'DONE' && /AOV/.test(done.closure_evidence_note) && done.closure_evidence_uri === `job:${jobId}`,
  'F1: YOUR Accept completed it — deliverable attached as evidence, job pointer on the record');
check(q(`SELECT o.resolution FROM life_confidence_outcomes o JOIN life_confidence_predictions p ON p.id=o.prediction_id WHERE p.capability_key='agent_delivery'`)[0]?.resolution === 'CORRECT',
  'F2: the accept feeds Trust-page calibration (promotion plumbing live, auto-applied still 0)');

await browser.close();
server.kill(); writer.kill();
console.log(failures === 0 ? '\nACCEPTANCE: ALL PASS' : `\nACCEPTANCE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
