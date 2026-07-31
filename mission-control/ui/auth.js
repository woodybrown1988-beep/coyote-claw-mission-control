'use strict';

// Mission Control — shared-secret session auth (Wave 1 security remediation, 2026-07-31).
//
// WHY A SHARED SECRET, NOT AN IP ALLOWLIST: the tailnet forwarder (tailnet-forwarder.mjs) is a
// dumb TCP pipe to 127.0.0.1, so the app sees EVERY request as loopback and cannot tell a tailnet
// device from real loopback. Access control therefore lives in the app: a single operator secret
// is exchanged once at POST /login for an HMAC-signed, HttpOnly, SameSite=Strict session cookie.
//
// FAIL-CLOSED: if MC_AUTH_SECRET / MC_SESSION_KEY are unset (or too short), nobody can authenticate
// and every protected route 401s. /healthz, the machine /health, and /version stay open so the
// deploy waitHealthy probe and the `/version == sha` check keep working.
//
// SESSION REVOCATION — the "lost device" recipe (30 seconds, known in advance):
//   1) rotate MC_SESSION_KEY in ~/.coyote-claw/mc-auth.env  (e.g. `openssl rand -hex 32`)
//   2) systemctl --user restart coyote-mc-dashboard
//   Every existing cookie fails its HMAC check instantly, on every device. No laptop hunt.
//
// The env is read LAZILY (per call) so the systemd EnvironmentFile is picked up at runtime and so
// tests can set/clear the secret per case.

const crypto = require('node:crypto');

const COOKIE = 'mc_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — long-lived (you sign in rarely); revoke via key rotation.
const MIN_SECRET_LEN = 16;

// Login rate-limit defaults. Because the forwarder collapses every client to 127.0.0.1, a per-IP
// limiter is meaningless — this is a GLOBAL attempt counter with exponential lockout + a per-failure
// soft delay, so a shared secret is not worth brute-forcing from the tailnet.
const FAIL_THRESHOLD = 5;                 // failures allowed before lockout engages
const LOCK_BASE_MS = 30 * 1000;           // first lockout window
const LOCK_MAX_MS = 15 * 60 * 1000;       // cap
const WINDOW_MS = 15 * 60 * 1000;         // failures older than this (and not locked) decay to 0

function authSecret() { return process.env.MC_AUTH_SECRET || ''; }
function sessionKey() { return process.env.MC_SESSION_KEY || ''; }
function configured() { return authSecret().length >= MIN_SECRET_LEN && sessionKey().length >= MIN_SECRET_LEN; }

function sha(x) { return crypto.createHash('sha256').update(String(x)).digest(); }
// Constant-time compare with NO length oracle (both sides hashed to a fixed 32 bytes first).
function eq(a, b) { return crypto.timingSafeEqual(sha(a), sha(b)); }

function signPayload(payloadB64) {
  return crypto.createHmac('sha256', sessionKey()).update(payloadB64).digest('base64url');
}
function issueToken(nowMs) {
  const payload = Buffer.from(JSON.stringify({ exp: nowMs + SESSION_TTL_MS })).toString('base64url');
  return payload + '.' + signPayload(payload);
}
function issueCookie(nowMs) {
  return `${COOKIE}=${issueToken(nowMs)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}
function verifyToken(token, nowMs) {
  if (!configured() || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!eq(sig, signPayload(payload))) return false;      // tampered/forged signature → reject
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof p.exp === 'number' && p.exp > nowMs;    // expired → reject
  } catch { return false; }
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function isAuthed(req, nowMs) {
  const cookies = parseCookies(req && req.headers && req.headers.cookie);
  return verifyToken(cookies[COOKIE] || '', nowMs);
}
function checkSecret(candidate) {
  if (!configured() || typeof candidate !== 'string' || candidate.length === 0) return false;
  return eq(candidate, authSecret());
}
// Unauthenticated routes: the login page, and the machine-only health/version probes the deploy
// path polls. The HTML /health PAGE (Accept: text/html) is NOT public — only the JSON probe is.
function isPublicPath(pathname, acceptsHtml) {
  return pathname === '/login'
    || pathname === '/healthz'
    || pathname === '/version'
    || (pathname === '/health' && !acceptsHtml);
}
// CSRF defence-in-depth: SameSite=Strict already withholds the cookie on cross-site requests; this
// additionally refuses any state-changing request whose Origin is present and not same-host. A
// non-browser client (curl/deploy) sends no Origin and is still gated by the cookie.
function originOk(req) {
  const origin = req && req.headers && req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === ((req.headers && req.headers.host) || ''); }
  catch { return false; }
}

// Global login limiter. state() is called BEFORE checking the secret; fail()/succeed() after.
function createLoginLimiter(opts) {
  const o = opts || {};
  const threshold = o.threshold != null ? o.threshold : FAIL_THRESHOLD;
  const base = o.baseMs != null ? o.baseMs : LOCK_BASE_MS;
  const max = o.maxMs != null ? o.maxMs : LOCK_MAX_MS;
  const windowMs = o.windowMs != null ? o.windowMs : WINDOW_MS;
  let fails = 0;
  let lockedUntil = 0;
  let lastFailAt = 0;
  return {
    state(nowMs) {
      if (lastFailAt && nowMs - lastFailAt > windowMs && nowMs >= lockedUntil) fails = 0;
      if (nowMs < lockedUntil) return { locked: true, retryAfterMs: lockedUntil - nowMs, fails };
      return { locked: false, retryAfterMs: 0, fails };
    },
    fail(nowMs) {
      fails += 1;
      lastFailAt = nowMs;
      if (fails >= threshold) lockedUntil = nowMs + Math.min(max, base * Math.pow(2, fails - threshold));
      return { fails, lockedUntil, locked: nowMs < lockedUntil, retryAfterMs: Math.max(0, lockedUntil - nowMs) };
    },
    succeed() { fails = 0; lockedUntil = 0; lastFailAt = 0; },
  };
}

module.exports = {
  COOKIE, SESSION_TTL_MS, MIN_SECRET_LEN, FAIL_THRESHOLD,
  configured, issueToken, issueCookie, verifyToken, parseCookies,
  isAuthed, checkSecret, isPublicPath, originOk, createLoginLimiter,
};
