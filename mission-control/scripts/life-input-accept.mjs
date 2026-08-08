#!/usr/bin/env node
'use strict';
// ACCEPTANCE — Life OS input protection + owner-language refusals (defects 1+2, 2026-08-08).
// Real browser against a scratch server + fixture DB (the visual-gate pattern):
//   A  type half a project name, blur, wait 70s → NO reload, text intact
//   B  manual reload mid-type → draft restored from sessionStorage
//   C  writer refusal (mocked at the network edge) → inline owner copy, ZERO dialogs
//   D  successful submit (mocked) → page reloads, draft CLEARED
//   E  control: untouched page still auto-refreshes within ~35s
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

const MC = join(process.env.HOME, 'coyote-mc-life', 'mission-control');
const PORT = 8897;
const WORK = '/tmp/life-accept-work';

const free = await new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/healthz', timeout: 1500 }, () => resolve(false));
  req.on('error', () => resolve(true));
  req.on('timeout', () => { req.destroy(); resolve(true); });
});
if (!free) { console.error(`REFUSING: something already listens on :${PORT}`); process.exit(2); }

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
execFileSync('node', [join(MC, 'scripts', 'life-visual-fixture.mjs'), join(WORK, 'life.db')], { stdio: 'inherit' });
// the shell queries the librarian DB for badges/foot — give it an EMPTY one, not a missing one
execFileSync('node', ['-e', `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(join(WORK, 'claw-absent.db'))});db.exec('PRAGMA user_version=1');db.close();`]);

const env = {
  ...process.env,
  MISSION_CONTROL_PORT: String(PORT),
  MC_AUTH_SECRET: 'accept-secret-0123456789abcdef',
  MC_SESSION_KEY: 'accept-session-0123456789abcdef',
  MC_LOGIN_DELAY_MS: '0',
  COYOTE_CLAW_DB: join(WORK, 'claw-absent.db'),
  COYOTE_LIFE_DB: join(WORK, 'life.db'),
};
const server = spawn('node', ['server.js'], { cwd: MC, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
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
const dialogs = [];
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

const TITLE = 'input[name=title]';
const HALF = 'Fix the greenhouse doo';

// --- A: half-typed name survives 70s of 30s-refresh ticks, even blurred -----------------
await page.goto(`http://127.0.0.1:${PORT}/life/projects`, { waitUntil: 'networkidle' });
await page.fill(TITLE, HALF);
await page.click('h1');                              // blur — the DIRTY guard must hold, not focus
await page.evaluate(() => { window.__probe = 1; });
await page.waitForTimeout(70_000);                   // two-plus refresh ticks
const probeA = await page.evaluate(() => window.__probe);
const valA = await page.inputValue(TITLE);
check(probeA === 1, 'A1: no reload happened in 70s while unsaved text present (probe survived)');
check(valA === HALF, `A2: half-typed text intact after 70s ("${valA}")`);

// --- B: manual reload mid-type → draft restored ------------------------------------------
await page.reload({ waitUntil: 'networkidle' });
const valB = await page.inputValue(TITLE);
check(valB === HALF, `B: draft restored after manual reload ("${valB}")`);

// --- C: writer refusal renders as inline owner copy, never a dialog ----------------------
await ctx.route('**/api/life/command', (route) => route.fulfill({
  status: 400, contentType: 'application/json',
  body: JSON.stringify({ ok: false, error: 'create_project: definitionOfDone required (≤500 chars)' }),
}));
await page.fill(TITLE, 'Fix the greenhouse door');
await page.click('form.lc-create-form button[type=submit]');
await page.waitForTimeout(600);
const inline = await page.evaluate(() => {
  const el = document.querySelector('form.lc-create-form [data-lc-msg]');
  return el ? el.textContent : null;
});
check(inline === 'Every project needs a definition of done — how will you know it is finished?',
  `C1: refusal renders inline in owner language ("${inline}")`);
check(dialogs.length === 0, `C2: zero browser dialogs (saw ${dialogs.length})`);
const valC = await page.inputValue(TITLE);
check(valC === 'Fix the greenhouse door', 'C3: refusal keeps the typed text (owner is still editing)');

// --- D: successful submit clears the draft ------------------------------------------------
await ctx.unroute('**/api/life/command');
await ctx.route('**/api/life/command', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
}));
await page.fill('input[name=dod]', 'Door closes and latches; hinge no longer drops.');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }),   // client reloads on success
  page.click('form.lc-create-form button[type=submit]'),
]);
const valD = await page.inputValue(TITLE);
const dodD = await page.inputValue('input[name=dod]');
check(valD === '' && dodD === '', `D: after submit the draft is cleared — fields empty on reload ("${valD}","${dodD}")`);

// --- E: control — an untouched page still refreshes within ~35s --------------------------
await ctx.unroute('**/api/life/command');
await page.evaluate(() => { window.__probe = 1; });
await page.waitForTimeout(35_000);
const probeE = await page.evaluate(() => window.__probe);
check(probeE === undefined, 'E: untouched page auto-refreshed within 35s (probe gone — refresh resumed)');

await browser.close();
server.kill();
console.log(failures === 0 ? '\nACCEPTANCE: ALL PASS' : `\nACCEPTANCE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
