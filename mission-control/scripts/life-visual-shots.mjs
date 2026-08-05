#!/usr/bin/env node
'use strict';
// LIFE OS VISUAL GATE (golden-masters pack v1.1.0): capture candidate pages at the CANONICAL
// viewports — desktop 1600x1000 (fold) + full page + mobile 390x844 — against the harness
// fixture (amendment 1: fixture here ONLY, never the live path). Spins its OWN server on a
// scratch port and REFUSES to run if the port is taken (the stale-server incident: an
// EADDRINUSE launch dies silently and shots capture old code as if new).
//
// Usage: node scripts/life-visual-shots.mjs [pageKey ...]   (default: today)
// Output: ~/exports/life-visual-<page>-{fold,full,mobile}.png
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const MC = join(HERE, '..');
const PORT = 8899;
const WORK = '/tmp/life-visual';
const ROUTES = { today: '/life/today', outcomes: '/life/outcomes', projects: '/life/projects', tasks: '/life/tasks', waiting: '/life/waiting', review: '/life/review', trust: '/life/trust', task: '/life/task' };
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['today'];

function portFree(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 1500 }, () => resolve(false));
    req.on('error', () => resolve(true));
    req.on('timeout', () => { req.destroy(); resolve(true); });
  });
}

const free = await portFree(PORT);
if (!free) {
  console.error(`REFUSING: something already listens on :${PORT} — kill it first (stale scratch servers shoot stale code).`);
  process.exit(2);
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
execFileSync('node', [join(HERE, 'life-visual-fixture.mjs'), join(WORK, 'life.db')], { stdio: 'inherit' });

const env = {
  ...process.env,
  MISSION_CONTROL_PORT: String(PORT),
  MC_AUTH_SECRET: 'visual-gate-secret-0123456789abcdef',
  MC_SESSION_KEY: 'visual-gate-session-0123456789abcdef',
  MC_LOGIN_DELAY_MS: '0',
  COYOTE_CLAW_DB: process.env.GOLDEN_DB || '/tmp/life-golden-snap2.db',
  COYOTE_LIFE_DB: join(WORK, 'life.db'),
};
const server = spawn('node', ['server.js'], { cwd: MC, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
await new Promise((r) => setTimeout(r, 1800));
if (/failed to start/.test(serverLog)) { console.error('scratch server failed:', serverLog.trim()); process.exit(3); }

const require2 = createRequire(join(process.env.HOME, 'pw-shot', 'package.json'));
const { chromium } = require2('playwright-core');
// Mint the session via a child so auth.js reads the HARNESS env, never this process's.
const token = execFileSync('node', ['-e', "const A=require('./ui/auth.js');console.log(A.issueToken(Date.now()));"], {
  cwd: MC, env, encoding: 'utf8',
}).trim();

const browser = await chromium.launch({
  executablePath: join(process.env.HOME, '.cache/ms-playwright/chromium-1140/chrome-linux/chrome'),
  args: ['--no-sandbox'],
  env: { ...process.env, LD_LIBRARY_PATH: join(process.env.HOME, '.coyote-claw/lib') },
});
async function shot(route, width, height, out, fullGrow) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addCookies([{ name: 'mc_session', value: token, url: `http://127.0.0.1:${PORT}` }]);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: 'networkidle' });
  if (fullGrow) {
    const h = await page.evaluate(() => Math.max(document.querySelector('main.main')?.scrollHeight || 0, document.body.scrollHeight, 700) + 40);
    await page.setViewportSize({ width, height: Math.min(h, 6000) });
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: out });
  await ctx.close();
  console.log('shot', out);
}
for (const key of pages) {
  const route = ROUTES[key] || `/life/${key}`;
  const base = join(process.env.HOME, 'exports', `life-visual-${key}`);
  await shot(route, 1600, 1000, `${base}-fold.png`, false);   // canonical desktop fold
  await shot(route, 1600, 1000, `${base}-full.png`, true);    // full page
  await shot(route, 390, 844, `${base}-mobile.png`, true);    // canonical mobile
}
await browser.close();
server.kill();
await new Promise((r) => setTimeout(r, 500));
console.log('done — scratch server stopped');
