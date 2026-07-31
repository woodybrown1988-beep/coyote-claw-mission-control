'use strict';

// Wave 1 security remediation (2026-07-31) — Mission Control shared-secret auth.
// RED-PROVEN acceptance (these all FAIL against the pre-Wave-1 server, which had no auth):
//   • GET /api/lapsed-export refused unauthenticated (the CRITICAL PII exfil)
//   • POST /api/chat-message (operator-id injection) refused unauthenticated
//   • deploy probes (/healthz, /version) stay public
//   • login rate-limit: 10 wrong secrets → locked out (429), logged, Rex-visible event rows
//   • session revocation: rotating MC_SESSION_KEY kills every cookie ("lost device" recipe)
//   • machine-generated-secret model: fail-closed when unset; CSRF + security headers.

// Env MUST be set before requiring server.js (DB_PATH is read at load; auth reads env lazily).
process.env.MC_AUTH_SECRET = 'test-operator-secret-0123456789abcdef'; // >= 16 chars
process.env.MC_SESSION_KEY = 'test-session-signing-key-0123456789abcdef';
process.env.MC_LOGIN_DELAY_MS = '0'; // no real sleep in tests

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const TMP_DB = path.join(os.tmpdir(), `mc-auth-test-${process.pid}.db`);
process.env.COYOTE_CLAW_DB = TMP_DB; // isolate all write-handle events to a throwaway DB

const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable } = require('node:stream');
const sqlite = require('node:sqlite');

const AUTH = require('../mission-control/ui/auth.js');
const server = require('../mission-control/server.js');
const { handleRequest, applyAuthEvent } = server;

test.after(() => { for (const f of [TMP_DB, TMP_DB + '-wal', TMP_DB + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} } });

function makeRes() {
  const res = { statusCode: 0, headers: {}, body: '', ended: false };
  res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[String(k).toLowerCase()];
  res.writeHead = (s, h) => { res.statusCode = s; if (h) for (const k of Object.keys(h)) res.headers[k.toLowerCase()] = h[k]; return res; };
  res.done = new Promise((resolve) => { res._resolve = resolve; });
  res.end = (b) => { if (b != null) res.body += b; res.ended = true; res._resolve(res); };
  return res;
}
function makeReq(method, url, headers, body) {
  const req = Readable.from([body == null ? '' : body]);
  req.method = method;
  req.url = url;
  req.headers = Object.assign({ host: '127.0.0.1:8787' }, headers || {});
  return req;
}
async function run(method, url, headers, body) {
  const res = makeRes();
  handleRequest(makeReq(method, url, headers, body), res);
  await res.done;
  return res;
}
function validCookie(nowMs) { return { cookie: AUTH.COOKIE + '=' + AUTH.issueToken(nowMs || Date.now()) }; }

// ─────────────────────────── ACCEPTANCE (the two required negatives) ───────────────────────────

test('ACCEPTANCE 1 — GET /api/lapsed-export is REFUSED (401) unauthenticated (the PII exfil)', async () => {
  const res = await run('GET', '/api/lapsed-export');
  assert.equal(res.statusCode, 401);
  assert.match(res.body, /authentication required/);
  // and with a valid session it passes the gate (unit-level, DB-free):
  assert.equal(AUTH.isAuthed({ headers: validCookie() }, Date.now()), true);
});

test('ACCEPTANCE 2 — POST /api/chat-message (operator-id round-trip) is REFUSED (401) unauthenticated', async () => {
  const res = await run('POST', '/api/chat-message', { 'content-type': 'application/json' }, JSON.stringify({ text: 'inject work' }));
  assert.equal(res.statusCode, 401);
  // 401 is returned by the gate BEFORE the chat handler, so no 'in' row is written and nothing routes.
});

// ─────────────────────────── deploy probes stay public ───────────────────────────

test('deploy probes stay public: /healthz and /version return 200 without auth', async () => {
  assert.equal((await run('GET', '/healthz')).statusCode, 200);
  assert.equal((await run('GET', '/version')).statusCode, 200);
  // the HTML /health PAGE is NOT public — a browser Accept must authenticate:
  assert.equal((await run('GET', '/health', { accept: 'text/html' })).statusCode, 302);
});

test('unauthenticated browser GET redirects to /login; API paths get 401 JSON', async () => {
  const html = await run('GET', '/coyote/overview', { accept: 'text/html' });
  assert.equal(html.statusCode, 302);
  assert.equal(html.headers['location'], '/login');
  const api = await run('GET', '/api/chat-updates');
  assert.equal(api.statusCode, 401);
});

test('the login page itself is reachable unauthenticated', async () => {
  const res = await run('GET', '/login', { accept: 'text/html' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Mission Control/);
});

// ─────────────────────────── security headers + CSRF ───────────────────────────

test('security headers (CSP frame-ancestors none, X-Frame-Options DENY) on every response', async () => {
  const res = await run('GET', '/api/lapsed-export'); // 401, but headers are set first
  assert.match(res.headers['content-security-policy'] || '', /frame-ancestors 'none'/);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

test('CSRF — an authenticated POST from a cross-site Origin is refused (403)', async () => {
  server.__resetAuthLimiter();
  const res = await run('POST', '/api/chat-message',
    Object.assign({ origin: 'https://evil.example', 'content-type': 'application/json' }, validCookie()),
    JSON.stringify({ text: 'x' }));
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /cross-origin/);
  // a same-origin authed request is NOT blocked by the CSRF check:
  assert.equal(AUTH.originOk({ headers: { origin: 'http://127.0.0.1:8787', host: '127.0.0.1:8787' } }), true);
});

// ─────────────────────────── login: correct / wrong / machine-generated ───────────────────────────

test('login with the correct secret sets an HttpOnly SameSite=Strict cookie that authenticates', async () => {
  server.__resetAuthLimiter();
  const res = await run('POST', '/login', { 'content-type': 'application/json' }, JSON.stringify({ secret: process.env.MC_AUTH_SECRET }));
  assert.equal(res.statusCode, 200);
  const sc = res.headers['set-cookie'];
  assert.match(sc, /mc_session=/);
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  const token = sc.split(';')[0].split('=').slice(1).join('=');
  assert.equal(AUTH.isAuthed({ headers: { cookie: 'mc_session=' + token } }, Date.now()), true);
});

test('login with a wrong secret is refused (401)', async () => {
  server.__resetAuthLimiter();
  const res = await run('POST', '/login', { 'content-type': 'application/json' }, JSON.stringify({ secret: 'not-the-secret' }));
  assert.equal(res.statusCode, 401);
});

test('CSRF hardening — a cross-site POST /login is refused (403) and does NOT advance the lockout (no DoS)', async () => {
  server.__resetAuthLimiter();
  for (let i = 0; i < 8; i += 1) {
    const res = await run('POST', '/login',
      { origin: 'https://evil.example', 'content-type': 'application/json' },
      JSON.stringify({ secret: 'drive-by-' + i }));
    assert.equal(res.statusCode, 403, 'cross-site login is refused before it can count');
  }
  // the operator (same-origin / CLI, no Origin) is NOT locked out — the drive-by never moved the counter
  const legit = await run('POST', '/login', { 'content-type': 'application/json' }, JSON.stringify({ secret: 'still-wrong' }));
  assert.equal(legit.statusCode, 401, 'operator still gets a normal 401, not a 429 lockout');
});

// ─────────────────────────── RATE LIMIT (requirement 1) ───────────────────────────

test('RATE LIMIT — 10 wrong logins → locked out (429 + Retry-After), logged, Rex-visible event rows', async () => {
  server.__resetAuthLimiter();
  const errs = [];
  const origErr = console.error;
  console.error = (m) => errs.push(String(m));
  let last;
  try {
    for (let i = 0; i < 10; i += 1) {
      last = await run('POST', '/login', { 'content-type': 'application/json' }, JSON.stringify({ secret: 'wrong-' + i }));
    }
  } finally { console.error = origErr; }
  assert.equal(last.statusCode, 429, 'locked out after repeated failures');
  assert.ok(Number(last.headers['retry-after']) > 0, 'Retry-After header set on lockout');
  // logged to stderr (→ the dashboard journal)
  assert.ok(errs.some((m) => m.includes('[mc-auth]') && m.includes('login-fail')), 'failures logged');
  assert.ok(errs.some((m) => m.includes('[mc-auth]') && /lockout|locked/.test(m)), 'lockout logged');
  // Rex-visible: durable events written to librarian.db mc_auth_events
  const db = new sqlite.DatabaseSync(TMP_DB, { readOnly: true });
  const n = db.prepare("SELECT COUNT(*) c FROM mc_auth_events WHERE kind IN ('login-fail','lockout-refused')").get().c;
  db.close();
  assert.ok(n >= 5, `expected auth events persisted for Rex (got ${n})`);
});

test('rate-limit unit — exponential lockout after threshold, and a success resets it', () => {
  const lim = AUTH.createLoginLimiter({ threshold: 3, baseMs: 100, maxMs: 10000, windowMs: 60000 });
  let t = 1000;
  assert.equal(lim.state(t).locked, false);
  lim.fail(t); lim.fail(t); // 2 fails, under threshold
  assert.equal(lim.state(t).locked, false);
  const r3 = lim.fail(t); // 3rd fail → locked
  assert.equal(r3.locked, true);
  assert.ok(r3.retryAfterMs > 0);
  const r4 = lim.fail(t); // 4th → longer lockout (exponential)
  assert.ok(r4.retryAfterMs > r3.retryAfterMs, 'backoff grows');
  lim.succeed();
  assert.equal(lim.state(t).locked, false, 'success clears the lockout');
  assert.equal(lim.state(t).fails, 0);
});

// ─────────────────────────── FAIL-CLOSED + SESSION REVOCATION (requirements 2 & 3) ───────────────────────────

test('FAIL-CLOSED — with MC_AUTH_SECRET/MC_SESSION_KEY unset, protected routes are 401 (never open)', async () => {
  const s = process.env.MC_AUTH_SECRET, k = process.env.MC_SESSION_KEY;
  delete process.env.MC_AUTH_SECRET; delete process.env.MC_SESSION_KEY;
  try {
    const res = await run('GET', '/api/lapsed-export', { cookie: 'mc_session=forged.signature' });
    assert.equal(res.statusCode, 401);
    // and login cannot succeed with no configured secret:
    server.__resetAuthLimiter();
    const login = await run('POST', '/login', { 'content-type': 'application/json' }, JSON.stringify({ secret: 'anything' }));
    assert.equal(login.statusCode, 401);
  } finally { process.env.MC_AUTH_SECRET = s; process.env.MC_SESSION_KEY = k; }
});

test('SESSION REVOCATION — rotating MC_SESSION_KEY invalidates every existing cookie (the "lost device" recipe)', () => {
  const token = AUTH.issueToken(Date.now());
  const req = { headers: { cookie: 'mc_session=' + token } };
  assert.equal(AUTH.isAuthed(req, Date.now()), true, 'cookie valid under the current key');
  const saved = process.env.MC_SESSION_KEY;
  process.env.MC_SESSION_KEY = 'ROTATED-signing-key-fedcba9876543210';
  try {
    assert.equal(AUTH.isAuthed(req, Date.now()), false, 'the same cookie is dead after key rotation');
  } finally { process.env.MC_SESSION_KEY = saved; }
});

// ─────────────────────────── token integrity + helpers ───────────────────────────

test('token integrity — tampered signature and expired tokens are rejected', () => {
  const now = 1_000_000_000_000;
  const good = AUTH.issueToken(now);
  assert.equal(AUTH.verifyToken(good, now), true);
  // tamper the signature
  const tampered = good.slice(0, -2) + (good.slice(-2) === 'aa' ? 'bb' : 'aa');
  assert.equal(AUTH.verifyToken(tampered, now), false);
  // expired
  assert.equal(AUTH.verifyToken(good, now + AUTH.SESSION_TTL_MS + 1), false);
  // garbage
  assert.equal(AUTH.verifyToken('not-a-token', now), false);
  assert.equal(AUTH.verifyToken('', now), false);
});

test('isPublicPath — only login + machine health/version are public', () => {
  assert.equal(AUTH.isPublicPath('/login', false), true);
  assert.equal(AUTH.isPublicPath('/healthz', false), true);
  assert.equal(AUTH.isPublicPath('/version', false), true);
  assert.equal(AUTH.isPublicPath('/health', false), true);   // machine (no text/html)
  assert.equal(AUTH.isPublicPath('/health', true), false);   // browser page → protected
  assert.equal(AUTH.isPublicPath('/api/lapsed-export', false), false);
  assert.equal(AUTH.isPublicPath('/coyote/overview', true), false);
});

test('applyAuthEvent — writes a durable row (Rex reads librarian.db)', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  applyAuthEvent(db, 'login-fail', 3, 1234);
  const row = db.prepare('SELECT kind, fails FROM mc_auth_events ORDER BY id DESC LIMIT 1').get();
  assert.deepEqual({ ...row }, { kind: 'login-fail', fails: 3 });
  db.close();
});
