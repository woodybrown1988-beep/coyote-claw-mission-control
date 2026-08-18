'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { homedir } = require('node:os');
const { execFileSync, execFile } = require('node:child_process');
const { join } = require('node:path');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const CODEX_SUBSCRIPTION_USD = 200;
const DEFAULT_CEILING_PENCE = 7500;
const RATE_STALE_DAYS = 90;
const MONTH_MODE = 'UTC';
const ACTIVE_STATUSES = [
  'active',
  'executing',
  'in-flight',
  'in_flight',
  'in progress',
  'in_progress',
  'processing',
  'running',
  'started'
];

const ROOT = path.resolve(__dirname, '..');
const STATIC_ROOT = path.resolve(__dirname, 'static');
const DB_PATH = process.env.COYOTE_CLAW_DB || path.join(ROOT, 'data', 'librarian.db');
const RATES_PATH = path.join(ROOT, 'config', 'api-rates.json');
// OpenTable reservations upload (2026-07-23): the browser drop lands a .csv in the SAME inbox the
// cc ingest already watches, then triggers the ingest immediately. cc engine dir + inbox are fixed
// paths (never derived from request input); the upload only ever writes inside OPENTABLE_INBOX.
const crypto = require('node:crypto');
const UP = require('./ui/upload.js');
const AUTH = require('./ui/auth.js');
const EXPORTS = require('./ui/exports-lib.js');
const CC_DIR = process.env.COYOTE_CLAW_DIR || path.join(homedir(), 'coyote-claw');
const OPENTABLE_INBOX = process.env.OPENTABLE_INBOX || path.join(CC_DIR, 'data', 'opentable-inbox');
// TASK FILES (operator ask 2026-08-13) — the same inbox pattern, personal edition: MC
// writes BYTES to the life writer's upload inbox and posts the small attach command over
// the UDS; the sole writer moves the file home beside life.db and owns every DB write.
const LIFE_TASK_INBOX = process.env.COYOTE_LIFE_TASK_INBOX || path.join(CC_DIR, 'data', 'task-files-inbox');
const LIFE_TASK_FILES = process.env.COYOTE_LIFE_TASK_FILES || path.join(CC_DIR, 'data', 'task-files');
const MAX_TASK_FILE_BYTES = 15 * 1024 * 1024; // matches the writer's own cap — one number, two gates
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;   // 25 MB — generous for the one-off 26-month backfill

// Wave 1 auth (2026-07-31 security remediation): every response gets these headers, and a SINGLE
// process-global login limiter guards POST /login. See ui/auth.js for the model + the revoke recipe.
const MC_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
let LOGIN_LIMITER = AUTH.createLoginLimiter();

// The commit this process is serving — the gated deploy link's generic content check
// (`/version` == target sha) reads this to confirm a merge actually shipped, not just
// that `git pull` ran. Computed once (the running code is fixed for the process; a deploy
// always restarts), lazily so module load stays side-effect-free for tests.
let _commit = null;
function getCommit() {
  if (_commit === null) {
    try {
      _commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch (_e) {
      _commit = process.env.COYOTE_MC_COMMIT || 'unknown';
    }
  }
  return _commit;
}

function main() {
  const port = readPort(process.env.MISSION_CONTROL_PORT);
  const server = http.createServer(handleRequest);

  server.on('error', (error) => {
    const code = error && error.code ? error.code : 'UNKNOWN';
    console.error(`Mission Control failed to start (${code}).`);
    process.exitCode = 1;
  });

  server.listen(port, HOST, () => {
    console.log(`Mission Control listening on http://${HOST}:${port}`);
  });
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${HOST}`);

  // --- Wave 1: security headers on EVERY response (set before any writeHead; route handlers may
  // add their own content-type/nosniff, which merge). Kills clickjacking + the CSRF/XSS drive-by. ---
  res.setHeader('Content-Security-Policy', MC_CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const acceptsHtml = (req.headers.accept || '').indexOf('text/html') !== -1;

  // --- Login endpoint (the ONLY unauthenticated write) ---
  if (url.pathname === '/login') {
    if (req.method === 'POST') { handleLogin(req, res); return; }
    if (req.method === 'GET') { serveLoginPage(res); return; }
    sendText(res, 405, 'Method not allowed');
    return;
  }

  // --- Auth gate: 401 by DEFAULT. Everything except the login page and the machine health/version
  // probes requires a valid session cookie. The dumb-pipe forwarder means we cannot trust peer IP —
  // the cookie IS the trust boundary. ---
  if (!AUTH.isPublicPath(url.pathname, acceptsHtml)) {
    if (!AUTH.isAuthed(req, Date.now())) {
      if (acceptsHtml && req.method === 'GET') { res.writeHead(302, { Location: '/login' }); res.end(); }
      else { sendJson(res, 401, { ok: false, error: 'authentication required' }); }
      return;
    }
    // CSRF: state-changing requests must be same-origin (SameSite=Strict already withholds the
    // cookie cross-site; this refuses any lingering cross-origin POST as defence-in-depth).
    if (req.method !== 'GET' && !AUTH.originOk(req)) {
      sendJson(res, 403, { ok: false, error: 'cross-origin request refused' });
      return;
    }
  }

  // The ONE narrow write-path (Step 2). TIER 2 of the two-tier boundary: a fixed allowlist of
  // safe/reversible ops (mark TA/OT responded, snooze, log an action) via a SEPARATE write handle.
  // Everything else — all DATA rendering — uses the read-only handle. There is no op that posts to
  // Google (replyToReview stays the box-side Telegram-gated tap; the board has no token/nonce/path).
  if (req.method === 'POST' && url.pathname === '/api/review-action') {
    handleReviewAction(req, res);
    return;
  }

  // BOM safe-write (Tier 2, same discipline): the operator's recipe/cost edits + the CSV bulk import.
  // MC CHAT (ruling: mc-chat-approved) — the THIRD narrow write-path: typing in /claw/chat writes
  // ONE chat_messages 'in' row; the box-side web adapter routes it through the SAME frontdoor core
  // Telegram uses. The board never routes, never enqueues — pure transport. Tailnet-only surface.
  // LIFE OS capture — the first command on the sole-writer path (engine ops/life-os.md).
  // MC validates + relays over the writer's Unix socket; the ENGINE owns every life.db
  // write. Sits AFTER the auth wall like every write route (unauth = 401 before this line).
  if (req.method === 'POST' && url.pathname === '/api/life/capture') {
    handleLifeCapture(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/life/cancel') {
    handleLifeCancel(req, res);
    return;
  }
  // The planner command multiplexer (allowlisted names; writer re-validates). Below the wall.
  if (req.method === 'POST' && url.pathname === '/api/life/command') {
    handleLifeCommand(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/chat-message') {
    handleChatMessage(req, res);
    return;
  }

  // FORECAST OVERRIDE (RCC P4) — the FOURTH narrow write-path, same discipline: one INSERT into
  // the forecast_overrides journal, hard caps, pure apply fn. The ruling: every NON-ZERO override
  // carries its reason; zero (a reset) may omit it. Absent table = cc #86 not deployed → honest 503.
  if (req.method === 'POST' && url.pathname === '/api/forecast-override') {
    handleForecastOverride(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/recipe-action') {
    handleRecipeAction(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/reservations-upload') {
    handleReservationsUpload(req, res, url);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/life/task-upload') {
    handleTaskFileUpload(req, res, url);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/life/task-file') {
    handleTaskFileDownload(req, res, url);
    return;
  }
  // Capture options (rich capture, 2026-08-18): ACTIVE projects for the overlay's picker —
  // read-only mirror, id + title + domain only, nothing else leaves the db. Below the wall.
  if (req.method === 'GET' && url.pathname === '/api/life/capture-options') {
    handleCaptureOptions(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/recipe-import') {
    handleRecipeImport(req, res, url);
    return;
  }
  // Download a recipes-CSV template PRE-FILLED with the live products (real SKUs from sales) so the
  // operator fills sub_item_id + quantity against their actual menu. SELECT-only (reads products).
  if (req.method === 'GET' && url.pathname === '/api/recipe-template') {
    handleRecipeTemplate(res);
    return;
  }
  // Download the opted-in lapsed-regular win-back list (Customer Growth). CONSENT is enforced in the
  // data layer (marketing_opt_in = 1 in the SQL) — never the query string; a downloaded file, never
  // rendered on a page. Tailnet-only like the rest of MC.
  if (req.method === 'GET' && url.pathname === '/api/lapsed-export') {
    handleLapsedExport(res, url);
    return;
  }

  if (req.method !== 'GET') {
    sendText(res, 405, 'Method not allowed');
    return;
  }

  // Chat short-poll cursor: new messages after ?after=<id> + statuses for the in-flight job chips.
  // SELECT-only on the read handle; absent table degrades to ok:false (pre-engine-deploy honesty).
  if (url.pathname === '/api/chat-updates') {
    handleChatUpdates(res, url);
    return;
  }

  // /health is BOTH the machine healthcheck (deploy waitHealthy polls it for 200) and the Health PAGE.
  // Non-browser clients (curl/deploy/monitoring send no `text/html` Accept) get the JSON {ok:true};
  // browsers fall through to the page router below. /healthz is a always-JSON alias for machines.
  if (url.pathname === '/healthz' || (url.pathname === '/health' && (req.headers.accept || '').indexOf('text/html') === -1)) {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/version') {
    sendJson(res, 200, { commit: getCommit() });
    return;
  }

  if (url.pathname.startsWith('/static/')) {
    serveStatic(url.pathname, res);
    return;
  }

  // Report Standard raw artifact: the standalone branded HTML, served as-is (the
  // library page iframes it; print from here = the PDF). SELECT-only.
  if (url.pathname === '/coyote/report-library/raw') {
    const opened = openDatabase();
    if (!opened.ok) { sendText(res, 500, opened.message); return; }
    try {
      const r = reportRawResponse(opened.db, url.searchParams.get('id'));
      res.writeHead(r.status, { 'content-type': r.contentType, 'x-content-type-options': 'nosniff' });
      res.end(r.body);
    } finally { opened.db.close(); }
    return;
  }

  // File download from ~/exports/ (the /coyote/files page). READ-ONLY, that dir ONLY, no traversal
  // (the guard lives in ui/exports-lib.js). Auth-gated above (not a public path). Streams the file
  // as an attachment; a bad/traversal name → 400, an absent/escaping name → 404 — never a byte from
  // outside ~/exports.
  if (url.pathname === '/coyote/files/download') {
    const r = EXPORTS.fileDownloadResponse(url.searchParams.get('name'));
    if (r.status !== 200) {
      res.writeHead(r.status, { 'content-type': r.contentType, 'x-content-type-options': 'nosniff' });
      res.end(r.body);
      return;
    }
    res.writeHead(200, {
      'content-type': r.contentType,
      'content-disposition': r.disposition,
      'content-length': r.size,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    fs.createReadStream(r.filePath).on('error', () => { try { res.destroy(); } catch (_) { /* noop */ } }).pipe(res);
    return;
  }

  const redirect = LEGACY_REDIRECTS[url.pathname];
  if (redirect) {
    // query-safe: if the redirect TARGET already carries a query (e.g. a deep-link to a tab),
    // merge the incoming query with '&' instead of a second '?'.
    const loc = url.search ? (redirect.includes('?') ? `${redirect}&${url.search.slice(1)}` : redirect + url.search) : redirect;
    res.writeHead(308, { Location: loc });
    res.end();
    return;
  }

  const page = PAGE_BY_ROUTE[url.pathname];
  if (!page) {
    sendText(res, 404, 'Not found');
    return;
  }
  servePage(page, res, url);
}

// ---- multi-page router (ops-centre) ----
const SHARED = require('./ui/shared.js');
const LIFECMD = require('./ui/life-command-lib.js');
const DATA = require('./ui/data.js');
// MC CHAT stale-tab self-heal (incident 2026-07-21: a tab open across a deploy kept rendering
// with pre-deploy page JS forever — the short-poll delivered new data into old code). The rev
// changes on every server start; the chat page embeds it and the poll returns it — a mismatch
// reloads the page (only when the input is empty, never clobbering a half-typed message).
const SERVER_REV = String(Date.now());

const PAGES = [
  require('./ui/pages/coyote/overview.js'),
  require('./ui/pages/claw/engine.js'),
  require('./ui/pages/claw/chat.js'),
  require('./ui/pages/claw/memory.js'),
  require('./ui/pages/coyote/reviews.js'),
  require('./ui/pages/coyote/issues.js'),
  require('./ui/pages/coyote/reports.js'),
  require('./ui/pages/coyote/reservations.js'),
  require('./ui/pages/coyote/costs.js'),
  require('./ui/pages/coyote/inventory.js'),
  require('./ui/pages/coyote/kitchen-safety.js'),
  require('./ui/pages/coyote/operations.js'),
  require('./ui/pages/coyote/customer-growth.js'),
  require('./ui/pages/coyote/report-library.js'),
  require('./ui/pages/coyote/files.js'),
  // rota-review is NOT a standalone route any more (2026-07-22): retired into the Labour Centre's
  // Rota Review tab; /coyote/rota-review 308-redirects there. The module is still required by
  // labour.js, which hosts its renderer as that tab.
  require('./ui/pages/coyote/labour.js'),
  require('./ui/pages/coyote/recipes.js'),
  // LIFE OS workspace (Phase-0 tap 2026-08-05) — read-only scaffold over the SEPARATE life.db
  // (ui/pages/life/life-lib.js is the one file that touches it, read-only handle). Writes stay
  // absent until the sole-writer command path PR (operator ruling 2026-08-05).
  require('./ui/pages/life/today.js'),
  require('./ui/pages/life/outcomes.js'),
  require('./ui/pages/life/projects.js'),
  require('./ui/pages/life/tasks.js'),
  require('./ui/pages/life/waiting.js'),
  require('./ui/pages/life/review.js'),
  require('./ui/pages/life/trust.js'),
  require('./ui/pages/life/task.js'),   // the drawer — reached by links, no sidebar slot
  require('./ui/pages/life/project.js'), // project drawer — same pattern (operator ask 2026-08-10)
  require('./ui/pages/life/schedule.js'),
  require('./ui/pages/life/recurring.js'),
  require('./ui/pages/life/quarterly.js'),
  require('./ui/pages/life/agents.js'),
  require('./ui/pages/life/settings.js'),
];
const PAGE_BY_ROUTE = {};
for (const p of PAGES) PAGE_BY_ROUTE[p.route] = p;

// Legacy → namespaced workspace routes (308: permanent, preserves method + query string). NOTE: '/health'
// non-HTML already returned the machine JSON healthcheck above (deploy waitHealthy) — only a BROWSER
// reaching '/health' falls through to the redirect below. '/' lands on the daily-driver front door
// (/coyote/overview), not the console. Factory-ready: a new workspace adds its own prefix, no engine change.
const LEGACY_REDIRECTS = {
  // Nav restructure (page-map amendment 2026-07-21): the RCC renamed Revenue under the Reports section.
  '/coyote/reports': '/coyote/revenue',
  '/': '/coyote/overview',
  // page-map audit 2026-07-21: YoY merged into Reports. (Operations was cut then, but is REVIVED
  // 2026-07-22 as the build-ahead Operations & Service scaffold — so /coyote/operations now serves
  // the page and the redirect is removed; /operations → /coyote/operations still stands below.)
  '/coyote/yoy': '/coyote/revenue',  // no double-hop — straight to the new home
  // Rota Review retired into the Labour Centre (2026-07-22): deep-link to its tab. ?dept=... is
  // preserved via the query-safe merge above.
  '/coyote/rota-review': '/coyote/labour?tab=rota-review',
  '/claw/agents': '/claw/engine',
  '/claw/health': '/claw/engine',
  '/overview': '/coyote/overview',
  '/reports': '/coyote/revenue',
  '/labour': '/coyote/labour',
  '/recipes': '/coyote/recipes',
  '/reviews': '/coyote/reviews',
  '/issues': '/coyote/issues',
  '/yoy': '/coyote/yoy',
  '/operations': '/coyote/operations',
  '/agents': '/claw/agents',
  '/health': '/claw/health',
};

// Render one page: open the READ-ONLY handle (all DATA is SELECT-only), compute nav badges + footer
// from real data, let the page build its model + body, wrap in the shared shell. Any page error
// degrades to a banner — never a crash, never a fabricated value.
// Pure responder for /coyote/report-library/raw — testable without sockets.
function reportRawResponse(db, idParam) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, contentType: 'text/plain; charset=utf-8', body: 'bad id' };
  const r = DATA.safeSelect(db, 'SELECT html FROM report_artifacts WHERE id = ?', [id]);
  const row = r && r.ok && r.rows && r.rows[0];
  if (!row || typeof row.html !== 'string') return { status: 404, contentType: 'text/plain; charset=utf-8', body: 'no such report' };
  return { status: 200, contentType: 'text/html; charset=utf-8', body: row.html };
}

function servePage(page, res, url) {
  const opened = openDatabase();
  const now = Date.now();
  if (!opened.ok) {
    sendHtml(res, 200, SHARED.renderShell({ active: page.key, title: page.title, sub: page.sub, stamp: '', body: `<div class="banner red">${escapeHtml(opened.message)}</div>`, badges: {}, foot: [] }));
    return;
  }
  const db = opened.db;
  let badges = {};
  let foot = [];
  let rendered = { stamp: '', body: '' };
  try {
    badges = DATA.navBadges(db);
    foot = DATA.footModel(db, now);
    const ctx = {
      q: (sql, params) => DATA.safeSelect(db, sql, params),
      now,
      halt: buildHaltModel(readHaltFileExists(), readPausedValue(db)),
      // URL query → period navigation state (validated page-side; bookmarkable views).
      query: url ? Object.fromEntries(url.searchParams) : {},
      serverRev: SERVER_REV,
    };
    const section = page.getSection(db, ctx);
    rendered = page.render(section, ctx) || { stamp: '', body: '' };
  } catch (_) {
    rendered = { stamp: '', body: '<div class="banner red">This page failed to render. The data layer is read-only; no write occurred.</div>' };
  } finally {
    try {
      db.close();
    } catch (_) {
      // close failure is not user-actionable
    }
  }
  sendHtml(res, 200, SHARED.renderShell({ active: page.key, title: page.title, sub: page.sub, stamp: rendered.stamp, body: rendered.body, badges, foot }));
}

function buildDashboardModel() {
  const monthStartMs = getMonthStartMs(new Date());
  const rates = readRates();
  const haltFileExists = readHaltFileExists();
  const opened = openDatabase();

  if (!opened.ok) {
    return {
      ok: false,
      halt: buildHaltModel(haltFileExists, null),
      monthStartMs,
      monthMode: MONTH_MODE,
      rates,
      error: opened.message,
      refreshedAt: Date.now(),
      sections: emptySections()
    };
  }

  const db = opened.db;

  try {
    const halt = buildHaltModel(haltFileExists, readPausedValue(db));
    const sections = {
      kpis: getKpiSection(db, monthStartMs),
      queue: getQueueSection(db),
      worker: getWorkerSection(db),
      spend: getSpendSection(db, monthStartMs),
      tokens: getTokenSection(db, monthStartMs, rates),
      outcomes: getOutcomesSection(db),
      deploy: getDeploySection(db),
      reviews: getReviewsSection(db)
    };

    return {
      ok: true,
      halt,
      monthStartMs,
      monthMode: MONTH_MODE,
      rates,
      refreshedAt: Date.now(),
      sections
    };
  } finally {
    try {
      db.close();
    } catch (_) {
      // Closing failure is not user-actionable and must not leak internals.
    }
  }
}

function buildHaltModel(haltFileExists, pausedValue) {
  const fromFlagFile = haltFileExists === true;
  const fromPaused = pausedValue === '1';

  if (fromFlagFile && fromPaused) {
    return { halted: true, source: 'flag-file+paused' };
  }

  if (fromFlagFile) {
    return { halted: true, source: 'flag-file' };
  }

  if (fromPaused) {
    return { halted: true, source: 'paused' };
  }

  return { halted: false };
}

function readHaltFileExists() {
  const haltFile = process.env.COYOTE_HALT_FILE ?? join(homedir(), '.coyote-claw', 'HALT');
  try {
    return fs.existsSync(haltFile);
  } catch (_) {
    return true;
  }
}

function readPausedValue(db) {
  const result = safeSelect(db, `
    SELECT value
    FROM system_state
    WHERE key = 'paused'
    LIMIT 1
  `);

  if (!result.ok || result.rows.length === 0) {
    return null;
  }

  return result.rows[0].value;
}

function emptySections() {
  return {
    kpis: unavailable('Database unavailable'),
    queue: unavailable('Database unavailable'),
    worker: unavailable('Database unavailable'),
    spend: unavailable('Database unavailable'),
    tokens: unavailable('Database unavailable'),
    outcomes: unavailable('Database unavailable'),
    deploy: unavailable('Database unavailable'),
    reviews: unavailable('Database unavailable')
  };
}

function openDatabase() {
  let sqlite;
  try {
    sqlite = require('node:sqlite');
  } catch (_) {
    return { ok: false, message: 'node:sqlite is unavailable in this Node.js runtime.' };
  }

  try {
    const db = new sqlite.DatabaseSync(DB_PATH, { readOnly: true });
    // busy_timeout so a render read waits out a transient writer/checkpoint lock instead of failing
    // with SQLITE_BUSY (matches the spine's openReadonly + the writable handle below). readOnly, so
    // the dashboard can never contend as a writer.
    db.exec('PRAGMA busy_timeout = 5000;');
    return { ok: true, db };
  } catch (_) {
    return { ok: false, message: 'Librarian database could not be opened read-only.' };
  }
}

// TIER 2 handle — read-WRITE, opened ONLY by the narrow review-action write-path, used for exactly one
// parameterised statement, then closed. Never held; never used for rendering.
function openWritableDatabase() {
  let sqlite;
  try {
    sqlite = require('node:sqlite');
  } catch (_) {
    return { ok: false };
  }
  try {
    const db = new sqlite.DatabaseSync(DB_PATH);
    db.exec('PRAGMA busy_timeout = 5000;');
    return { ok: true, db };
  } catch (_) {
    return { ok: false };
  }
}

// The CLOSED allowlist of safe/reversible board writes. Adding a posting op here would be the ONLY way
// to make the board post — and none exists. mark_responded is TA/OT-only (the SQL WHERE excludes
// Google), so even "responded" can't touch a Google review (its lifecycle is the Telegram tap).
const REVIEW_ACTION_OPS = new Set(['mark_responded', 'skip', 'snooze', 'log_action']);

/**
 * Apply ONE narrow review action against a writable db. Pure over (db, body, now) for testability.
 * Returns { ok, status, ... }. Rejects anything off the allowlist. All SQL is parameterised; no op
 * can fire a Google reply (no replyToReview / nonce / token exists on the board).
 */
function applyReviewAction(db, body, now) {
  const op = body && body.op;
  if (!REVIEW_ACTION_OPS.has(op)) {
    return { ok: false, status: 400, error: 'unknown op' };
  }
  try {
    if (op === 'mark_responded') {
      const id = String((body && body.review_id) || '');
      if (!id) return { ok: false, status: 400, error: 'review_id required' };
      // TA/OT ONLY — Google posts via the Telegram tap, never the board.
      const r = db
        .prepare(`UPDATE review_drafts SET draft_status = 'responded', updated_at = ? WHERE review_id = ? AND platform IN ('tripadvisor','opentable')`)
        .run(now, id);
      if (r.changes === 0) {
        return { ok: false, status: 409, error: 'no TripAdvisor/OpenTable draft for that review_id (Google is posted via Telegram, not the board)' };
      }
      return { ok: true, status: 200, op, review_id: id, changes: r.changes };
    }
    if (op === 'skip') {
      const id = String((body && body.review_id) || '');
      if (!id) return { ok: false, status: 400, error: 'review_id required' };
      const r = db.prepare(`UPDATE review_drafts SET draft_status = 'skipped', updated_at = ? WHERE review_id = ?`).run(now, id);
      return { ok: r.changes > 0, status: r.changes > 0 ? 200 : 409, op, changes: r.changes };
    }
    if (op === 'snooze') {
      const id = String((body && body.review_id) || '');
      if (!id) return { ok: false, status: 400, error: 'review_id required' };
      const hours = Math.max(1, Math.min(Number(body.hours) || 24, 24 * 30));
      const until = now + hours * 3600 * 1000;
      const r = db.prepare(`UPDATE review_drafts SET snoozed_until = ?, updated_at = ? WHERE review_id = ?`).run(until, now, id);
      return { ok: r.changes > 0, status: r.changes > 0 ? 200 : 409, op, snoozed_until: until, changes: r.changes };
    }
    // log_action — record an operator action against an issue (the loop-closer reads it later).
    const code = String((body && body.issue_code) || '');
    const action = String((body && body.action_taken) || '');
    if (!code || !action) return { ok: false, status: 400, error: 'issue_code and action_taken required' };
    const actionDate = Number(body.action_date) || now;
    const r = db
      .prepare(`INSERT INTO review_actions (issue_code, identified_at, action_taken, action_date, status, auto) VALUES (?, ?, ?, ?, 'actioned', 0)`)
      .run(code, now, action, actionDate);
    return { ok: true, status: 200, op, id: Number(r.lastInsertRowid) };
  } catch (_) {
    return { ok: false, status: 500, error: 'write failed' };
  }
}

function handleReviewAction(req, res) {
  let raw = '';
  let tooBig = false;
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 8192) {
      tooBig = true;
      req.destroy();
    }
  });
  req.on('end', () => {
    if (tooBig) {
      sendJson(res, 413, { ok: false, error: 'payload too large' });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch (_) {
      sendJson(res, 400, { ok: false, error: 'invalid json' });
      return;
    }
    const opened = openWritableDatabase();
    if (!opened.ok) {
      sendJson(res, 503, { ok: false, error: 'database unavailable for write' });
      return;
    }
    try {
      const result = applyReviewAction(opened.db, parsed, Date.now());
      sendJson(res, result.status || (result.ok ? 200 : 400), result);
    } finally {
      try {
        opened.db.close();
      } catch (_) {
        // close failure is not user-actionable
      }
    }
  });
}

// ===================================================================================================
// MC CHAT (ruling: mc-chat-approved) — the transport write + the short-poll read.
// applyChatMessage is PURE (db, body, now) like applyReviewAction: one INSERT, hard caps, no routing
// (the box-side adapter owns routing — the ARCHITECTURE RULE). Exported for tests.
function applyChatMessage(db, body, now) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return { ok: false, status: 400, error: 'empty message' };
  if (text.length > 4000) return { ok: false, status: 400, error: 'message too long (4000 char cap)' };
  // PER-AGENT CHANNELS (operator ask 2026-08-18: "within MC chat we should also have an option
  // to chat with individual departments or agents like the mail agent"). The channel rides the
  // row's `source` column as 'channel:<name>' — TEXT, no schema change — and the frontdoor's
  // webAdapter maps that prefix onto CoreInbound.channel, where routing treats it as absolute:
  // inside the mail-agent channel there are no magic words, everything is for the mail agent.
  // ALLOWLISTED here so a crafted POST cannot invent a channel the router has never heard of.
  const CHANNELS = ['mail-agent'];
  let source = null;
  if (body.channel != null) {
    if (!CHANNELS.includes(String(body.channel))) return { ok: false, status: 400, error: 'unknown channel' };
    source = 'channel:' + String(body.channel);
  }
  let replyTo = null;
  if (body.reply_to_id != null) {
    const n = Number(body.reply_to_id);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, status: 400, error: 'bad reply_to_id' };
    replyTo = n;
  }
  try {
    const r = db.prepare(
      `INSERT INTO chat_messages (transport, direction, source, text, reply_to_id, created_at) VALUES ('web', 'in', ?, ?, ?, ?)`
    ).run(source, text, replyTo, now);
    return { ok: true, status: 200, id: Number(r.lastInsertRowid) };
  } catch (e) {
    // table absent = the engine side has not deployed yet — honest 503, never a silent drop
    return { ok: false, status: 503, error: 'chat store unavailable (engine side not deployed?)' };
  }
}

function handleChatMessage(req, res) {
  let raw = '';
  let tooBig = false;
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 8192) { tooBig = true; req.destroy(); }
  });
  req.on('end', () => {
    if (tooBig) { sendJson(res, 413, { ok: false, error: 'payload too large' }); return; }
    let parsed;
    try { parsed = JSON.parse(raw || '{}'); } catch (_) { sendJson(res, 400, { ok: false, error: 'invalid json' }); return; }
    const opened = openWritableDatabase();
    if (!opened.ok) { sendJson(res, 503, { ok: false, error: 'database unavailable for write' }); return; }
    try {
      const result = applyChatMessage(opened.db, parsed, Date.now());
      sendJson(res, result.status || 400, result);
    } finally {
      try { opened.db.close(); } catch (_) { /* close failure is not user-actionable */ }
    }
  });
}

// ===================================================================================================
// FORECAST OVERRIDE (RCC P4) — applyForecastOverride is PURE (db, body, now) like applyChatMessage:
// one journal INSERT, validation only, no forecast maths here (the page re-forecasts at every read;
// the override is the ONLY stored input). Exported for tests.
function applyForecastOverride(db, body, now) {
  const pct = Number(body && body.pct);
  // ±50 mirrors the schema backstop; the UI slider is ±15 — the server is the wider hard wall
  if (!Number.isFinite(pct) || pct < -50 || pct > 50) {
    return { ok: false, status: 400, error: 'pct must be a number between -50 and 50' };
  }
  let reason = typeof (body && body.reason) === 'string' ? body.reason.trim() : '';
  if (reason.length > 500) return { ok: false, status: 400, error: 'reason too long (500 char cap)' };
  // THE RULING: a non-zero override is an auditable operator assumption — it needs its reason.
  if (pct !== 0 && !reason) return { ok: false, status: 400, error: 'a non-zero override needs its reason' };
  if (pct === 0 && !reason) reason = 'reset';
  try {
    const r = db.prepare(`INSERT INTO forecast_overrides (pct, reason, created_at) VALUES (?, ?, ?)`).run(pct, reason, now);
    return { ok: true, status: 200, id: Number(r.lastInsertRowid), pct, reason };
  } catch (e) {
    // table absent = the cc-side schema PR has not deployed — honest 503, never a silent drop
    return { ok: false, status: 503, error: 'override store not deployed (cc #86)' };
  }
}

function handleForecastOverride(req, res) {
  let raw = '';
  let tooBig = false;
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 8192) { tooBig = true; req.destroy(); }
  });
  req.on('end', () => {
    if (tooBig) { sendJson(res, 413, { ok: false, error: 'payload too large' }); return; }
    let parsed;
    try { parsed = JSON.parse(raw || '{}'); } catch (_) { sendJson(res, 400, { ok: false, error: 'invalid json' }); return; }
    const opened = openWritableDatabase();
    if (!opened.ok) { sendJson(res, 503, { ok: false, error: 'database unavailable for write' }); return; }
    try {
      const result = applyForecastOverride(opened.db, parsed, Date.now());
      sendJson(res, result.status || 400, result);
    } finally {
      try { opened.db.close(); } catch (_) { /* close failure is not user-actionable */ }
    }
  });
}

// Short-poll: messages after the cursor + job statuses for the chips. Pure-read; exported for tests.
// Agent names from the shared roster (the fourth place that had invented its own — the live chat
// feed labelled the same agent differently from the board and the task pages). Non-agent sources
// (the router, Rex's two scheduled formats) are named here because no roster entry owns them.
const CHAT_SOURCE_LABEL = {
  router: 'Router', rex: 'Rex',
  boxquery: SHARED.FLEET.boxquery.name, lead: SHARED.FLEET.lead.name, research: SHARED.FLEET.research.name,
  brief: 'Rex · morning brief', soto: 'Rex · state of the org',
};
function chatUpdates(db, afterId, jobIds) {
  try {
    const messages = db.prepare(
      `SELECT m.id, m.direction, m.source, m.text, m.job_id, m.created_at, j.status AS job_status
         FROM chat_messages m LEFT JOIN jobs j ON j.id = m.job_id
        WHERE m.id > ? ORDER BY m.id LIMIT 50`
    ).all(afterId).map((r) => ({ ...r, label: CHAT_SOURCE_LABEL[r.source] || r.source }));
    const jobs = {};
    for (const id of jobIds.slice(0, 20)) {
      if (!/^[0-9a-f-]{8,36}$/i.test(id)) continue; // ids are uuids — anything else is ignored, never queried
      const row = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(id);
      if (row) jobs[id] = String(row.status);
    }
    return { ok: true, rev: SERVER_REV, messages, jobs };
  } catch (e) {
    return { ok: false, error: 'chat store unavailable' };
  }
}

function handleChatUpdates(res, url) {
  const afterId = Math.max(0, parseInt(url.searchParams.get('after') || '0', 10) || 0);
  const jobIds = (url.searchParams.get('jobs') || '').split(',').filter(Boolean);
  const opened = openDatabase();
  if (!opened.ok) { sendJson(res, 503, { ok: false, error: 'database unavailable' }); return; }
  sendJson(res, 200, chatUpdates(opened.db, afterId, jobIds));
}

// ===================================================================================================
// BOM (recipe/cost) SAFE-WRITE — the SECOND narrow write-path, identical two-tier discipline as
// review-action: a CLOSED op allowlist, a pure applyRecipeAction(db, body, now), all SQL parameterised,
// the tier-2 write handle opened for the statement(s) then closed. This is the ONE place the operator
// edits recipes/costs — the agent NEVER writes here. Rendering (margin) stays SELECT-only.
// ===================================================================================================
const LEGAL_UNITS = new Set(['each', 'g', 'ml', 'portion']);
const LEGAL_COST_SOURCES = new Set(['manual', 'portal', 'pdf']);
// The operator edits INGREDIENTS and RECIPE LINES only. PRODUCTS are NOT operator-created — they are
// seeded exclusively from the live Lightspeed SKUs by the sales ingest (ground truth = what's actually
// selling), so a recipe can only attach to a REAL, current product. A recipe line for an unknown SKU is
// rejected, never silently created (no-fabrication: no recipes against phantom products). All three ops
// are safe, reversible, operator-driven.
const RECIPE_ACTION_OPS = new Set(['upsert_sub_item', 'set_recipe_line', 'delete_recipe_line']);

/** Non-negative integer pence, or null. Rejects floats/negatives/NaN (money is integer pence). */
function asPence(v) {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}
/** A positive finite number (pack_qty, recipe quantity) — REAL is allowed (0.5 portion, 30 g). */
function asPositive(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}
function nonEmpty(v) {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s;
}

/**
 * Apply ONE narrow recipe/cost action against a writable db. Pure over (db, body, now) for testability.
 * Rejects anything off the allowlist or failing validation; all SQL parameterised. Never stores a rounded
 * unit cost (pack_cost_pence + pack_qty are the exact inputs; the per-unit cost is computed at read time).
 */
function applyRecipeAction(db, body, now) {
  const op = body && body.op;
  if (!RECIPE_ACTION_OPS.has(op)) return { ok: false, status: 400, error: 'unknown op' };
  try {
    if (op === 'upsert_sub_item') {
      const id = nonEmpty(body.id);
      const name = nonEmpty(body.name);
      const uom = nonEmpty(body.unit_of_measure);
      if (!id || !name) return { ok: false, status: 400, error: 'id and name required' };
      if (!LEGAL_UNITS.has(uom)) return { ok: false, status: 400, error: 'unit_of_measure must be each|g|ml|portion' };
      const packCost = asPence(body.pack_cost_pence);
      if (!packCost.ok) return { ok: false, status: 400, error: 'pack_cost_pence must be a non-negative integer (pence)' };
      let packQty = null;
      if (body.pack_qty !== null && body.pack_qty !== undefined && body.pack_qty !== '') {
        const pq = asPositive(body.pack_qty);
        if (!pq.ok) return { ok: false, status: 400, error: 'pack_qty must be a positive number' };
        packQty = pq.value;
      }
      const costSource = body.cost_source === undefined || body.cost_source === null || body.cost_source === ''
        ? 'manual' : nonEmpty(body.cost_source);
      if (!LEGAL_COST_SOURCES.has(costSource)) return { ok: false, status: 400, error: 'cost_source must be manual|portal|pdf' };
      db.prepare(`
        INSERT INTO sub_items (id, name, supplier, pack_description, pack_cost_pence, pack_qty, unit_of_measure, cost_source, updated_at)
        VALUES (@id, @name, @supplier, @pack_description, @pack_cost_pence, @pack_qty, @uom, @cost_source, @now)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, supplier = excluded.supplier, pack_description = excluded.pack_description,
          pack_cost_pence = excluded.pack_cost_pence, pack_qty = excluded.pack_qty,
          unit_of_measure = excluded.unit_of_measure, cost_source = excluded.cost_source, updated_at = excluded.updated_at
      `).run({ id, name, supplier: nonEmpty(body.supplier) || null, pack_description: nonEmpty(body.pack_description) || null,
        pack_cost_pence: packCost.value, pack_qty: packQty, uom, cost_source: costSource, now });
      return { ok: true, status: 200, op, id };
    }
    if (op === 'set_recipe_line') {
      const productId = nonEmpty(body.product_id);
      const subItemId = nonEmpty(body.sub_item_id);
      if (!productId || !subItemId) return { ok: false, status: 400, error: 'product_id and sub_item_id required' };
      const qty = asPositive(body.quantity);
      if (!qty.ok) return { ok: false, status: 400, error: 'quantity must be a positive number (in the sub-item unit)' };
      // A recipe can ONLY attach to a real, sales-seeded product + a defined ingredient — no phantom rows.
      // (The DB FK also enforces this; a 409 is friendlier than a raw constraint throw.)
      if (!db.prepare(`SELECT 1 FROM products WHERE id = ?`).get(productId)) return { ok: false, status: 409, error: 'no such product (SKU not in the live menu — seed products from sales first)' };
      if (!db.prepare(`SELECT 1 FROM sub_items WHERE id = ?`).get(subItemId)) return { ok: false, status: 409, error: 'no such sub_item_id (define the ingredient first)' };
      db.prepare(`
        INSERT INTO recipe_lines (product_id, sub_item_id, quantity, updated_at)
        VALUES (@product_id, @sub_item_id, @quantity, @now)
        ON CONFLICT(product_id, sub_item_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at
      `).run({ product_id: productId, sub_item_id: subItemId, quantity: qty.value, now });
      return { ok: true, status: 200, op, product_id: productId, sub_item_id: subItemId };
    }
    // delete_recipe_line
    const productId = nonEmpty(body.product_id);
    const subItemId = nonEmpty(body.sub_item_id);
    if (!productId || !subItemId) return { ok: false, status: 400, error: 'product_id and sub_item_id required' };
    const r = db.prepare(`DELETE FROM recipe_lines WHERE product_id = ? AND sub_item_id = ?`).run(productId, subItemId);
    return { ok: r.changes > 0, status: r.changes > 0 ? 200 : 409, op, changes: r.changes };
  } catch (e) {
    return { ok: false, status: 500, error: 'write failed' };
  }
}

function handleRecipeAction(req, res) {
  readJsonBody(req, res, 8192, (parsed) => {
    const opened = openWritableDatabase();
    if (!opened.ok) { sendJson(res, 503, { ok: false, error: 'database unavailable for write' }); return; }
    try {
      const result = applyRecipeAction(opened.db, parsed, Date.now());
      sendJson(res, result.status || (result.ok ? 200 : 400), result);
    } finally {
      try { opened.db.close(); } catch (_) { /* close failure not user-actionable */ }
    }
  });
}

/**
 * CSV bulk import (the PRIMARY first-load path). ONE endpoint, TWO kinds: 'sub_items' | 'recipes'.
 * Every row is applied through applyRecipeAction (same validation) inside a single transaction, so the
 * import is atomic and can NEVER write an unvalidated row. Returns a per-row accept/reject summary — a
 * bad row is reported, never silently dropped. £ money columns are converted to integer pence here (the
 * boundary), so applyRecipeAction only ever sees pence.
 *
 * PRODUCTS are NOT created here — the 'recipes' import attaches to REAL products (seeded from live sales
 * SKUs); a row whose product_sku is not in the live menu is REJECTED with a clear reason (never a phantom
 * product). The operator fills recipes against their real product list (downloadable pre-filled template).
 */
function applyRecipeImport(db, kind, csvText, now) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { ok: false, status: 400, error: 'empty CSV (need a header row + data)' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const body = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
  const col = (row, name) => { const i = header.indexOf(name); return i >= 0 ? row[i] : undefined; };
  const results = [];
  let imported = 0;
  // £ (e.g. "5.00") → integer pence, epsilon-safe.
  const poundsToPence = (v) => {
    const s = String(v == null ? '' : v).replace(/[£,\s]/g, '');
    if (s === '') return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.round(n * 100);
  };
  try {
    txWrite(db, () => {
      body.forEach((row, i) => {
        let action;
        if (kind === 'sub_items') {
          const pence = poundsToPence(col(row, 'pack_cost'));
          action = { op: 'upsert_sub_item', id: col(row, 'id'), name: col(row, 'name'), supplier: col(row, 'supplier'),
            pack_description: col(row, 'pack_description'), pack_cost_pence: Number.isNaN(pence) ? 'bad' : pence,
            pack_qty: col(row, 'pack_qty'), unit_of_measure: col(row, 'unit_of_measure'), cost_source: 'manual' };
        } else { // recipes: attach to an EXISTING product, resolved by its LIVE SKU (lightspeed_sku), not id
          // The CSV + the downloaded template are SKU-keyed, and products.id MAY differ from lightspeed_sku,
          // so resolve sku -> the real product id here. Unknown SKU -> reject (never mis-attach to a
          // different product that merely happens to hold that string as its id).
          const sku = nonEmpty(col(row, 'product_sku'));
          const prod = sku ? db.prepare(`SELECT id FROM products WHERE lightspeed_sku = ?`).get(sku) : null;
          if (!prod) { results.push({ row: i + 2, ok: false, error: 'no such product (SKU not in the live menu)' }); return; }
          action = { op: 'set_recipe_line', product_id: prod.id,
            sub_item_id: col(row, 'sub_item_id'), quantity: col(row, 'quantity') };
        }
        const r = applyRecipeAction(db, action, now);
        if (r.ok) imported += 1;
        results.push({ row: i + 2, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
      });
    });
  } catch (e) {
    return { ok: false, status: 500, error: 'import transaction failed (rolled back)' };
  }
  const rejected = results.filter((r) => !r.ok);
  return { ok: true, status: 200, kind, imported, rejected };
}

// The reservations drop: a browser drag-drop/browse lands a .csv in the SAME inbox the cc ingest
// watches, then triggers the ingest immediately and returns the outcome inline. Security: .csv-only,
// 25 MB cap (enforced during the streamed read), the file can ONLY land inside OPENTABLE_INBOX (no
// traversal), and the ingest command is FIXED (the filename is read from the directory, never passed
// as an arg). Content-sha dedup makes a re-drop a visible no-op with no second write. The ingest runs
// ASYNC (execFile) so a big backfill never blocks the server; if it errors/times out the file is
// safely in the inbox for the 30-min timer. MC stays read-only on the DB — the cc process does the write.
function handleReservationsUpload(req, res, url) {
  const rawName = url.searchParams.get('name') || '';
  if (!UP.isCsvName(rawName)) { sendJson(res, 400, { ok: false, error: 'only .csv files are accepted' }); return; }
  const safeName = UP.sanitizeUploadName(rawName);
  const dest = path.join(OPENTABLE_INBOX, safeName);
  if (!UP.isCsvName(safeName) || !UP.isWithinDir(OPENTABLE_INBOX, dest)) { sendJson(res, 400, { ok: false, error: 'invalid file name' }); return; }
  // clean size refusal up front (browsers + curl set Content-Length); the streamed cap in readTextBody
  // is the backstop for a chunked body with no length.
  const clen = Number(req.headers['content-length'] || 0);
  if (clen > MAX_UPLOAD_BYTES) { sendJson(res, 413, { ok: false, error: 'file too large — 25 MB max' }); return; }
  readTextBody(req, res, MAX_UPLOAD_BYTES, (csvText) => {
    if (!csvText || !csvText.trim()) { sendJson(res, 400, { ok: false, error: 'empty file' }); return; }
    const fileSha = crypto.createHash('sha256').update(csvText).digest('hex');
    const prior = readReservationsRun(fileSha);
    if (prior) { sendJson(res, 200, { ok: true, duplicate: true, ...prior }); return; }  // visible no-op, no re-write
    try { fs.mkdirSync(OPENTABLE_INBOX, { recursive: true }); fs.writeFileSync(dest, csvText); }
    catch (_) { sendJson(res, 500, { ok: false, error: 'could not save to the inbox' }); return; }
    execFile('node', ['--import', 'tsx', '--import', './src/warnings.ts', 'src/reservations/cli.ts', 'ingest', '--inbox-only'],
      { cwd: CC_DIR, env: { ...process.env, COYOTE_CLAW_DB: DB_PATH, HOME: homedir() }, timeout: 240000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err) { sendJson(res, 200, { ok: true, queued: true, file: safeName, message: 'saved to the inbox — the ingest timer will process it within 30 minutes' }); return; }
        // The ingest child is the source of truth for the just-processed file — parse ITS output
        // (immune to any cross-process WAL read-back timing). Covers come from the DB, best-effort.
        const parsed = UP.parseIngestOutcome(String(stdout || ''), safeName);
        const dbRow = readReservationsRun(fileSha) || {};
        const status = parsed.status || dbRow.status || 'processing';
        sendJson(res, 200, {
          ok: true, file: safeName, status: status === 'skipped' ? 'ok' : status,
          duplicate: status === 'skipped' || undefined,
          rows_written: parsed.rows != null ? parsed.rows : (dbRow.rows_written ?? null),
          date_from: parsed.from || dbRow.date_from || null, date_to: parsed.to || dbRow.date_to || null,
          covers: dbRow.covers ?? null,
          detail: parsed.detail || dbRow.detail || null,
        });
      });
  });
}

// TASK-FILE UPLOAD (operator ask 2026-08-13) — the reservations-inbox pattern, personal
// edition. MC's whole job is BYTES-to-inbox + the small attach command; the SOLE WRITER
// sanitises again, moves the file home beside life.db (0700/0600) and writes the row +
// FILE_ATTACHED event. A writer refusal cleans the inbox copy — nothing half-attached.
function handleTaskFileUpload(req, res, url) {
  const taskId = String(url.searchParams.get('taskId') || '');
  if (!/^[0-9a-f-]{36}$/.test(taskId)) { sendJson(res, 400, { ok: false, error: 'a task id is needed' }); return; }
  const safeName = UP.sanitizeUploadName(String(url.searchParams.get('name') || ''));
  if (!safeName || !UP.isAllowedTaskFileName(safeName)) {
    sendJson(res, 400, { ok: false, error: 'accepted types: .csv .tsv .txt .md .json .xlsx .docx .pdf .png .jpg' }); return;
  }
  const note = String(url.searchParams.get('note') || '').slice(0, 500);
  const clen = Number(req.headers['content-length'] || 0);
  if (clen > MAX_TASK_FILE_BYTES) { sendJson(res, 413, { ok: false, error: 'file too large — 15 MB max' }); return; }
  readBinaryBody(req, res, MAX_TASK_FILE_BYTES, (buf) => {
    if (!buf || !buf.length) { sendJson(res, 400, { ok: false, error: 'empty file — nothing to hand over' }); return; }
    const inboxName = `up${Date.now().toString(36)}-${safeName}`;
    const dest = path.join(LIFE_TASK_INBOX, inboxName);
    if (!UP.isWithinDir(LIFE_TASK_INBOX, dest)) { sendJson(res, 400, { ok: false, error: 'invalid file name' }); return; }
    try {
      fs.mkdirSync(LIFE_TASK_INBOX, { recursive: true, mode: 0o700 });
      fs.writeFileSync(dest, buf, { mode: 0o600 });
    } catch (_) { sendJson(res, 500, { ok: false, error: 'could not save to the inbox' }); return; }
    LIFECMD.sendCommand({
      command: 'attach_task_file',
      idempotencyKey: crypto.randomUUID().replace(/-/g, '').slice(0, 24),
      payload: { taskId, inboxName, originalName: safeName, note },
    }, (status, reply) => {
      if (!reply || !reply.ok) { try { fs.unlinkSync(dest); } catch (_) { /* best-effort clean */ } }
      sendJson(res, status, reply || { ok: false, error: 'the writer did not answer' });
    });
  });
}

/** TASK-FILE DOWNLOAD — read-only, by ROW: the path derives from the writer's own registry
 *  (task_id + filename out of life.db), never from the URL, and the within-dir gate runs
 *  anyway. Sits behind the auth wall like every page. */
function handleTaskFileDownload(req, res, url) {
  const id = String(url.searchParams.get('id') || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) { sendJson(res, 404, { ok: false, error: 'no such file' }); return; }
  const LIFELIB = require('./ui/pages/life/life-lib.js');
  const o = LIFELIB.openLifeReadonly();
  if (!o.ok) { sendJson(res, 503, { ok: false, error: o.reason }); return; }
  let row;
  try {
    const r = LIFELIB.lifeSelect(o.db, `SELECT task_id, filename, kind, bytes FROM life_task_files WHERE id = ? AND state = 'ATTACHED'`, [id]);
    row = r.ok && r.rows.length ? r.rows[0] : null;
  } finally { o.db.close(); }
  if (!row) { sendJson(res, 404, { ok: false, error: 'no such file' }); return; }
  const p = path.join(LIFE_TASK_FILES, String(row.task_id), String(row.filename));
  if (!UP.isWithinDir(LIFE_TASK_FILES, p) || !fs.existsSync(p)) { sendJson(res, 404, { ok: false, error: 'the bytes are not where the record says — re-upload it' }); return; }
  const CT = {
    csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain', md: 'text/plain', json: 'application/json',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  };
  const ext = (String(row.filename).match(/\.([A-Za-z0-9]+)$/) || [])[1];
  const body = fs.readFileSync(p);
  res.writeHead(200, {
    'content-type': CT[String(ext || '').toLowerCase()] || 'application/octet-stream',
    'content-length': body.length,
    // attachment, never inline: these bytes are the owner's data, not a page to render.
    'content-disposition': `attachment; filename="${String(row.filename).replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/** Read one ingest outcome (+ its covers) from the ledger, read-only. Returns null if not present. */
function readReservationsRun(fileSha) {
  let db;
  try {
    db = new sqlite.DatabaseSync(DB_PATH, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 5000;'); // wait out a transient writer lock, never fail the read
    const r = db.prepare(`SELECT file_name, source, status, rows_written, date_from, date_to, detail, ingested_at FROM reservations_ingest_runs WHERE file_sha = ?`).get(fileSha);
    if (!r) return null;
    let covers = null;
    if (r.date_from && r.date_to) {
      const c = db.prepare(`SELECT COALESCE(SUM(total_covers), 0) c FROM covers_day WHERE business_date BETWEEN ? AND ?`).get(r.date_from, r.date_to);
      covers = c ? c.c : null;
    }
    return { file: r.file_name, status: r.status, rows_written: r.rows_written, date_from: r.date_from, date_to: r.date_to, covers, detail: r.detail, ingested_at: r.ingested_at };
  } catch (_) { return null; }
  finally { if (db) { try { db.close(); } catch (_) { /* noop */ } } }
}

function handleRecipeImport(req, res, url) {
  const kind = (url.searchParams.get('kind') || '').trim();
  if (kind !== 'sub_items' && kind !== 'recipes') { sendJson(res, 400, { ok: false, error: 'kind must be sub_items|recipes' }); return; }
  readTextBody(req, res, 512 * 1024, (csvText) => {
    const opened = openWritableDatabase();
    if (!opened.ok) { sendJson(res, 503, { ok: false, error: 'database unavailable for write' }); return; }
    try {
      const result = applyRecipeImport(opened.db, kind, csvText, Date.now());
      sendJson(res, result.status || (result.ok ? 200 : 400), result);
    } finally {
      try { opened.db.close(); } catch (_) { /* not user-actionable */ }
    }
  });
}

// A CSV cell that quotes/escapes only when needed (comma, quote, or newline present).
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** The recipes-CSV template, PRE-FILLED with the live products (real SKUs) so the operator only fills
 *  sub_item_id + quantity. SELECT-only. If products aren't seeded yet (sales not flowing), it returns
 *  just the header + a note row — honest, never a fabricated product. */
function buildRecipeTemplate(db) {
  const header = 'product_sku,product_name,sub_item_id,quantity';
  let rows = [];
  try {
    const res = safeSelect(db, `SELECT lightspeed_sku, name FROM products ORDER BY name, lightspeed_sku`);
    if (res.ok) rows = res.rows;
  } catch (_) { rows = []; }
  if (!rows.length) {
    return `${header}\n# no products yet — they seed from live Lightspeed sales; download again once sales are flowing\n`;
  }
  // one blank line per product (operator adds a row per ingredient, copying the sku down)
  const lines = rows.map((r) => `${csvCell(r.lightspeed_sku)},${csvCell(r.name)},,`);
  return `${header}\n${lines.join('\n')}\n`;
}
function handleLapsedExport(res, url) {
  const GROWTH = require('./ui/growth-export.js');
  const opened = openDatabase();
  let out = { minVisits: 3, rows: [] };
  try {
    if (opened.ok) out = GROWTH.lapsedExportRows(opened.db, url.searchParams.get('minVisits'));
  } catch (_) { out = { minVisits: 3, rows: [] }; } finally {
    if (opened.ok) { try { opened.db.close(); } catch (_) { /* not user-actionable */ } }
  }
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="lapsed-regulars-optedin-min${out.minVisits}.csv"`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(GROWTH.toCsv(out.rows));
}

function handleRecipeTemplate(res) {
  const opened = openDatabase();
  let csv;
  try {
    csv = opened.ok ? buildRecipeTemplate(opened.db) : 'product_sku,product_name,sub_item_id,quantity\n';
  } finally {
    if (opened.ok) { try { opened.db.close(); } catch (_) { /* not user-actionable */ } }
  }
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="recipes-template.csv"',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(csv);
}

function getKpiSection(db, monthStartMs) {
  const dayStartMs = getUtcDayStartMs(new Date());
  const jobsToday = safeSelect(db, `
    SELECT COUNT(*) AS count
    FROM jobs
    WHERE COALESCE(created_at, updated_at, 0) >= ?
  `, [dayStartMs]);

  const activeJobs = safeSelect(db, `
    SELECT id, status, type, updated_at, created_at
    FROM jobs
    WHERE lower(status) IN (
      'active',
      'executing',
      'in-flight',
      'in_flight',
      'in progress',
      'in_progress',
      'processing',
      'running',
      'started',
      'spec',
      'build'
    )
    ORDER BY COALESCE(updated_at, created_at, 0) DESC
    LIMIT 1
  `);

  const shippedToday = safeSelect(db, `
    SELECT COUNT(*) AS count
    FROM jobs
    WHERE COALESCE(updated_at, created_at, 0) >= ?
      AND lower(status) IN ('merged', 'complete', 'completed', 'done', 'shipped')
  `, [dayStartMs]);

  const gateEvents = safeSelect(db, `
    SELECT decision, kind
    FROM job_events
  `);

  const gateCounts = gateEvents.ok ? countGateClassifications(gateEvents.rows) : {
    passed: 0,
    refused: 0
  };

  const openGates = safeSelect(db, `
    SELECT COUNT(*) AS count
    FROM jobs
    WHERE status = 'awaiting_signoff'
  `);

  const testIntegrityRows = safeSelect(db, `SELECT detail FROM job_events WHERE kind = 'test_run'`);
  const testIntegrity = testIntegrityRows.ok ? countTestIntegrity(testIntegrityRows.rows) : {
    teeth: 0,
    theatre: 0
  };

  if (!jobsToday.ok && !activeJobs.ok && !gateEvents.ok && !openGates.ok) {
    return unavailable('KPI data is unavailable.');
  }

  const activeRow = activeJobs.ok && activeJobs.rows.length > 0 ? activeJobs.rows[0] : null;
  const activeStage = activeRow ? deriveStage(activeRow) : 'idle';
  const activeJob = activeRow ? shortId(activeRow.id) : '';

  return {
    ok: true,
    jobsToday: jobsToday.ok ? toInteger(jobsToday.rows[0] && jobsToday.rows[0].count) : 0,
    shippedToday: shippedToday.ok ? toInteger(shippedToday.rows[0] && shippedToday.rows[0].count) : 0,
    activeJobs: activeRow ? 1 : 0,
    gatesPassed: gateCounts.passed,
    gatesRefused: gateCounts.refused,
    openGates: openGates.ok ? toInteger(openGates.rows[0] && openGates.rows[0].count) : 0,
    testIntegrityTeeth: testIntegrity.teeth,
    testIntegrityTheatre: testIntegrity.theatre,
    testIntegrityUnavailable: !testIntegrityRows.ok,
    activeStage,
    activeJob,
    monthStartMs,
    warnings: collectWarnings([
      jobsToday.ok ? null : 'Jobs-today count unavailable.',
      gateEvents.ok ? null : 'Gate pass count unavailable.',
      openGates.ok ? null : 'Open gate count unavailable.',
      testIntegrityRows.ok ? null : 'Test integrity unavailable.'
    ])
  };
}

function countTestIntegrity(rows) {
  const counts = {
    teeth: 0,
    theatre: 0
  };

  if (!Array.isArray(rows)) {
    return counts;
  }

  for (const row of rows) {
    const detail = parseDetailObject(row && row.detail);
    if (!detail) {
      continue;
    }

    if (detail.verdict === 'theatre') {
      counts.theatre += 1;
    } else if (detail.verdict === 'accept' && countCaughtByMutant(detail.perFunction) > 0) {
      counts.teeth += 1;
    }
  }

  return counts;
}

function countGateClassifications(rows) {
  const counts = {
    passed: 0,
    refused: 0
  };

  for (const row of rows) {
    const classification = classifyGateEvent(row);
    if (classification === 'passed') {
      counts.passed += 1;
    } else if (classification === 'refused') {
      counts.refused += 1;
    }
  }

  return counts;
}

function getQueueSection(db) {
  const counts = safeSelect(db, `
    SELECT status, COUNT(*) AS count
    FROM jobs
    GROUP BY status
    ORDER BY count DESC, status ASC
  `);

  const recentJobs = safeSelect(db, `
    SELECT *
    FROM jobs
    ORDER BY COALESCE(updated_at, created_at, 0) DESC
    LIMIT 20
  `);

  if (!counts.ok && !recentJobs.ok) {
    return unavailable('Job queue tables are unavailable.');
  }

  return {
    ok: true,
    counts: counts.ok ? counts.rows.map((row) => ({
      status: safeLabel(row.status, 'unknown'),
      count: toInteger(row.count)
    })) : [],
    recentJobs: recentJobs.ok ? recentJobs.rows.map((row) => ({
      id: shortId(row.id),
      type: safeLabel(row.type, 'unknown'),
      status: safeLabel(row.status, 'unknown'),
      engine: deriveEngine(row),
      stage: deriveStage(row),
      effort: deriveEffort(row),
      ref: deriveRef(row),
      attempts: toInteger(row.attempts),
      createdAt: toMs(row.created_at),
      updatedAt: toMs(row.updated_at)
    })) : [],
    warnings: collectWarnings([
      counts.ok ? null : 'Job status counts unavailable.',
      recentJobs.ok ? null : 'Recent jobs unavailable.'
    ])
  };
}

function getWorkerSection(db) {
  const result = safeSelect(db, `
    SELECT owner_id, last_beat_at, phase, job_id, worker_name
    FROM worker_heartbeat
  `);

  if (!result.ok) {
    return unavailable('Worker heartbeat table is unavailable.');
  }

  const model = buildWorkerModel(result.rows, Date.now());
  const active = model.anyFresh
    ? model.workers.some((worker) => worker.active === true)
    : null;

  return {
    ok: true,
    ...model,
    active,
    headerChip: active === true ? 'LIVE' : (active === false ? 'IDLE' : 'UNKNOWN'),
    warnings: []
  };
}

// owner_id is host:pid:epochMs — the epoch-ms tail churns every restart, so drop it for a stable-enough
// fallback label (host:pid) when a worker has no WORKER_NAME yet. Mirrors the coder worker's shortOwner.
function shortOwnerId(ownerId) {
  return String(ownerId || '').replace(/:\d{10,}$/, '');
}

function buildWorkerModel(rows, nowMs) {
  const currentMs = toMs(nowMs);
  const isFresh = (ms) => ms > 0 && currentMs - ms <= 120000;

  // The Lead collapses to ONE 'lead' (its owner_id churns per restart; there is one Lead).
  // NAMED coders (WORKER_NAME set) render PER WORKER (coder-1, coder-2), the freshest row per name —
  // a configured worker stays visible even when its beat goes stale (flagged STALE downstream), so the
  // operator sees "coder-1 stopped". UNNAMED rows are either a worker on old code (show only while FRESH,
  // labelled host:pid) or DEAD historical processes (owner_id churns per restart) — those are dropped, so
  // the panel never floods with weeks of ghost rows. Never blank, never fabricated.
  const lead = new Map();    // 'lead' → freshest lead row
  const named = new Map();   // worker_name → freshest row
  const unnamed = new Map(); // owner_id → freshest row (kept only if fresh)

  for (const row of Array.isArray(rows) ? rows : []) {
    const ownerId = row && row.owner_id !== null && row.owner_id !== undefined
      ? String(row.owner_id)
      : '';
    const lastBeatMs = toMs(row && row.last_beat_at);
    const entry = {
      ownerId,
      phase: row && row.phase !== null && row.phase !== undefined ? String(row.phase).trim() : '',
      jobId: shortId(row && row.job_id),
      lastBeatMs
    };

    if (ownerId.startsWith('lead:')) {
      const cur = lead.get('lead');
      if (!cur || lastBeatMs > cur.lastBeatMs) lead.set('lead', { name: 'lead', ...entry });
    } else {
      const workerName = row && row.worker_name !== null && row.worker_name !== undefined
        ? String(row.worker_name).trim()
        : '';
      if (workerName) {
        const cur = named.get(workerName);
        if (!cur || lastBeatMs > cur.lastBeatMs) named.set(workerName, { name: workerName, ...entry });
      } else {
        const cur = unnamed.get(ownerId);
        if (!cur || lastBeatMs > cur.lastBeatMs) unnamed.set(ownerId, { name: shortOwnerId(ownerId), ...entry });
      }
    }
  }

  // Lead first, then coders sorted by name: named always, unnamed only while FRESH (drop ghost history).
  const ordered = [];
  if (lead.has('lead')) ordered.push(lead.get('lead'));
  const coders = [
    ...named.values(),
    ...Array.from(unnamed.values()).filter((e) => isFresh(e.lastBeatMs))
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  ordered.push(...coders);

  const workers = ordered.map((worker) => {
    const phase = worker.phase;
    const fresh = isFresh(worker.lastBeatMs);
    const activePhase = phase && phase.toLowerCase().replace(/[_\s]+/g, '-') !== 'idle';
    return {
      ...worker,
      fresh,
      active: fresh && (activePhase || Boolean(worker.jobId))
    };
  });

  return {
    workers,
    anyFresh: workers.some((worker) => worker.fresh)
  };
}

function getSpendSection(db, monthStartMs) {
  const ceiling = getMonthlyCeilingPence(db);
  const spendRows = safeSelect(db, `
    SELECT sl.cost_pence, COALESCE(sl.note, '') AS note, COALESCE(j.type, '') AS type
    FROM spend_log sl
    LEFT JOIN jobs j ON j.id = sl.job_id
    WHERE sl.created_at >= ?
  `, [monthStartMs]);

  if (!spendRows.ok) {
    return unavailable('Claude-metered spend cannot be read. Spend rows must identify Claude API usage by note or job type.');
  }

  const lines = summarizeSpendLines(spendRows.rows);
  const totalPence = lines.routerPence + lines.workerPence;
  const percent = ceiling > 0 ? (totalPence / ceiling) * 100 : 0;

  return {
    ok: true,
    label: 'Metered spend (Claude API)',
    totalPence,
    routerPence: lines.routerPence,
    workerPence: lines.workerPence,
    codexExcludedPence: lines.codexPence,
    ceilingPence: ceiling,
    percent,
    level: spendLevel(percent),
    warnings: [
      'Codex is excluded from this GBP metered total; Codex subscription economics are shown separately.'
    ]
  };
}

function getMonthlyCeilingPence(db) {
  const result = safeSelect(db, `
    SELECT value
    FROM system_state
    WHERE key = 'monthly_ceiling_pence'
    LIMIT 1
  `);

  if (!result.ok || result.rows.length === 0) {
    return DEFAULT_CEILING_PENCE;
  }

  const parsed = toInteger(result.rows[0].value);
  return parsed > 0 ? parsed : DEFAULT_CEILING_PENCE;
}

function getTokenSection(db, monthStartMs, rates) {
  const rows = safeSelect(db, `
    SELECT jtu.job_id, COALESCE(j.type, '') AS type, jtu.input_tokens, jtu.output_tokens,
           jtu.total_tokens, jtu.created_at
    FROM job_token_usage jtu
    LEFT JOIN jobs j ON j.id = jtu.job_id
    WHERE lower(jtu.engine) = 'codex'
    ORDER BY jtu.created_at DESC
    LIMIT 50
  `);

  const totals = safeSelect(db, `
    SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM job_token_usage
    WHERE lower(engine) = 'codex'
      AND created_at >= ?
  `, [monthStartMs]);

  if (!rows.ok && !totals.ok) {
    return unavailable('Codex token usage table is unavailable. Create job_token_usage and record worker token usage first.');
  }

  const tokenTotals = totals.ok ? {
    input: toInteger(totals.rows[0] && totals.rows[0].input_tokens),
    output: toInteger(totals.rows[0] && totals.rows[0].output_tokens),
    total: toInteger(totals.rows[0] && totals.rows[0].total_tokens)
  } : { input: 0, output: 0, total: 0 };

  const estimated = rates.ok ? estimateApiCost(tokenTotals, rates.gpt55) : null;

  return {
    ok: true,
    rows: rows.ok ? rows.rows.map((row) => ({
      id: shortId(row.job_id),
      type: safeLabel(row.type, 'unknown'),
      input: toInteger(row.input_tokens),
      output: toInteger(row.output_tokens),
      total: toInteger(row.total_tokens),
      createdAt: toMs(row.created_at)
    })) : [],
    totals: tokenTotals,
    rates,
    estimatedApiCostUsd: estimated,
    subscriptionUsd: CODEX_SUBSCRIPTION_USD,
    differenceUsd: estimated === null ? null : CODEX_SUBSCRIPTION_USD - estimated,
    warnings: collectWarnings([
      rows.ok ? null : 'Per-job Codex token rows unavailable.',
      totals.ok ? null : 'MTD Codex token totals unavailable.',
      rates.ok ? null : rates.message
    ])
  };
}

function getOutcomesSection(db) {
  const result = safeSelect(db, `
    SELECT job_id, kind, actor, gate, decision, detail, created_at
    FROM job_events
    ORDER BY created_at DESC
    LIMIT 50
  `);

  if (!result.ok) {
    return unavailable('Job event trail is unavailable.');
  }

  return {
    ok: true,
    events: result.rows.map((row) => ({
      createdAt: toMs(row.created_at),
      jobId: shortId(row.job_id),
      kind: safeLabel(row.kind, ''),
      actor: safeLabel(row.actor, ''),
      gate: safeLabel(row.gate, ''),
      decision: safeLabel(row.decision, ''),
      summary: summarizeDetail(row),
      correction: summarizeCorrection(row),
      tone: eventTone(row)
    })),
    warnings: []
  };
}

function getDeploySection(db) {
  const result = safeSelect(db, `
    SELECT id, target_sha, pre_sha, status, created_at, updated_at FROM deploys ORDER BY id DESC LIMIT 16
  `);

  if (!result.ok) {
    return unavailable('Deploy status is unavailable.');
  }

  return {
    ok: true,
    ...buildDeployModel(result.rows, getCommit()),
    warnings: []
  };
}

function getReviewsSection(db) {
  // Gate state — real today: drafts parked for the operator's rev: tap + recent decisions.
  const posts = safeSelect(db, `
    SELECT id, status, decision, reviewed, created_at, updated_at FROM review_posts ORDER BY created_at DESC LIMIT 20
  `);
  // Aggregate snapshot — real once the read-only ingest has run. Latest row only.
  const snap = safeSelect(db, `
    SELECT total, awaiting_response, awaiting_recent_text, awaiting_text_total, awaiting_negative, awaiting_star_only, awaiting_over_1y, overall_rating, google_rating, tripadvisor_rating, opentable_rating, ratings_window, fetched_at FROM review_snapshot ORDER BY fetched_at DESC LIMIT 1
  `);
  // Per-platform per-review awareness (review_corpus, all platforms). AVG() ignores NULLs, so the
  // category averages cover ONLY genuine sub-ratings — Google's are always NULL (no native
  // sub-ratings) and 'overall-fallback' rows store NULL, so nothing fabricated surfaces here.
  const corpus = safeSelect(db, `
    SELECT platform, COUNT(*) AS n,
      SUM(CASE WHEN food IS NOT NULL THEN 1 ELSE 0 END) AS with_cats,
      AVG(food) AS avg_food, AVG(service) AS avg_service, AVG(atmosphere) AS avg_atmosphere, AVG(value) AS avg_value
    FROM review_corpus GROUP BY platform
  `);
  // Location-level aggregate (the dense TripAdvisor "averages"). Empty until the app ships
  // /api/v1/aggregates; the panel renders "pending" then, never a fabricated number.
  const aggregate = safeSelect(db, `
    SELECT platform, overall, num_reviews, food, service, atmosphere, value, fetched_at FROM review_aggregate ORDER BY fetched_at DESC
  `);

  // ACTION QUEUE (Step 2) — STORED drafts only (the board NEVER generates one). Recent reviews with a
  // draft, not yet responded/skipped/snoozed, newest first. Plus the issue tags, the rising trend, and
  // the escalations the issues layer produced. ALL SELECT (safeSelect rejects non-SELECT) — render is
  // strictly read-only; the one write-path is the narrow POST /api/review-action (separate handle).
  const nowMs = Date.now();
  const drafts = safeSelect(db, `
    SELECT rc.review_id, rc.platform, rc.overall, rc.reviewer, rc.reviewed_date, rc.text,
           rd.draft_text, rd.draft_status, rd.review_url, rd.guard_flagged
    FROM review_drafts rd JOIN review_corpus rc ON rd.review_id = rc.review_id
    WHERE rd.draft_status NOT IN ('responded','skipped')
      AND (rd.snoozed_until IS NULL OR rd.snoozed_until < ?)
    ORDER BY rc.reviewed_date DESC LIMIT 8
  `, [nowMs]);
  const issueTagRows = safeSelect(db, `SELECT review_id, issue_code FROM review_issues`);
  const trendRows = safeSelect(db, `
    SELECT issue_code, count_current, count_prior, rising FROM issue_trends
    WHERE computed_at = (SELECT MAX(computed_at) FROM issue_trends)
    ORDER BY rising DESC, count_current DESC
  `);
  const escalationRows = safeSelect(db, `
    SELECT issue_code, status, evidence_summary FROM review_actions WHERE escalate = 1 ORDER BY auto DESC, id DESC
  `);

  if (!posts.ok && !snap.ok) {
    return unavailable('Reviews tables are unavailable.');
  }

  const ratingOrNull = (value) => {
    if (value === null || value === undefined) {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const postRows = posts.ok
    ? posts.rows.map((row) => ({
        id: toInteger(row.id),
        status: safeLabel(row.status, 'unknown'),
        decision: row.decision ? safeLabel(row.decision, '') : '',
        updatedAt: toMs(row.updated_at) || toMs(row.created_at)
      }))
    : [];
  const pendingCount = postRows.filter((row) => row.status === 'pending').length;

  const snapRow = snap.ok && snap.rows.length > 0 ? snap.rows[0] : null;
  const intOrNull = (value) => (value === null || value === undefined ? null : toInteger(value));
  const snapshot = snapRow
    ? {
        total: toInteger(snapRow.total),
        awaiting: toInteger(snapRow.awaiting_response),
        // Actionable breakdown of the lifetime awaiting count (nullable on pre-breakdown rows).
        awaitingRecentText: intOrNull(snapRow.awaiting_recent_text),
        awaitingTextTotal: intOrNull(snapRow.awaiting_text_total),
        awaitingNegative: intOrNull(snapRow.awaiting_negative),
        awaitingStarOnly: intOrNull(snapRow.awaiting_star_only),
        awaitingOver1y: intOrNull(snapRow.awaiting_over_1y),
        overall: ratingOrNull(snapRow.overall_rating),
        google: ratingOrNull(snapRow.google_rating),
        tripadvisor: ratingOrNull(snapRow.tripadvisor_rating),
        opentable: ratingOrNull(snapRow.opentable_rating),
        window: snapRow.ratings_window ? safeLabel(snapRow.ratings_window, '') : '',
        fetchedAt: toMs(snapRow.fetched_at)
      }
    : null;

  const platforms = {};
  if (corpus.ok) {
    for (const row of corpus.rows) {
      platforms[safeLabel(row.platform, 'unknown')] = {
        n: toInteger(row.n),
        withCats: toInteger(row.with_cats),
        food: ratingOrNull(row.avg_food),
        service: ratingOrNull(row.avg_service),
        atmosphere: ratingOrNull(row.avg_atmosphere),
        value: ratingOrNull(row.avg_value)
      };
    }
  }
  // Latest aggregate row per platform (rows arrive DESC by fetched_at, so first-seen wins).
  const aggregates = {};
  if (aggregate.ok) {
    for (const row of aggregate.rows) {
      const platform = safeLabel(row.platform, 'unknown');
      if (!aggregates[platform]) {
        aggregates[platform] = {
          overall: ratingOrNull(row.overall),
          numReviews: toInteger(row.num_reviews),
          food: ratingOrNull(row.food),
          service: ratingOrNull(row.service),
          atmosphere: ratingOrNull(row.atmosphere),
          value: ratingOrNull(row.value),
          fetchedAt: toMs(row.fetched_at)
        };
      }
    }
  }

  // Issue tags grouped per review (for the cards).
  const tagsByReview = {};
  if (issueTagRows.ok) {
    for (const row of issueTagRows.rows) {
      const id = String(row.review_id);
      (tagsByReview[id] = tagsByReview[id] || []).push(safeLabel(row.issue_code, ''));
    }
  }
  const textOrEmpty = (value) => (typeof value === 'string' ? value : '');
  const cards = drafts.ok
    ? drafts.rows.map((row) => {
        const id = String(row.review_id);
        return {
          reviewId: id,
          platform: safeLabel(row.platform, 'unknown'),
          overall: ratingOrNull(row.overall),
          reviewer: textOrEmpty(row.reviewer),
          date: row.reviewed_date ? String(row.reviewed_date).slice(0, 10) : '',
          text: textOrEmpty(row.text),
          draft: textOrEmpty(row.draft_text),
          status: safeLabel(row.draft_status, 'draft'),
          url: row.review_url ? String(row.review_url) : '',
          flagged: row.guard_flagged ? String(row.guard_flagged) : '',
          tags: tagsByReview[id] || []
        };
      })
    : [];
  const trends = trendRows.ok
    ? trendRows.rows.map((row) => ({
        code: safeLabel(row.issue_code, ''),
        current: toInteger(row.count_current),
        prior: toInteger(row.count_prior),
        rising: toInteger(row.rising) === 1
      }))
    : [];
  const escalations = escalationRows.ok
    ? escalationRows.rows.map((row) => ({
        code: safeLabel(row.issue_code, ''),
        status: safeLabel(row.status, ''),
        summary: textOrEmpty(row.evidence_summary)
      }))
    : [];

  return {
    ok: true,
    pendingCount,
    postRows: postRows.slice(0, 8),
    snapshot,
    platforms,
    aggregates,
    cards,
    trends,
    escalations,
    warnings: []
  };
}

function safeSelect(db, sql, params = []) {
  const normalized = sql.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized.startsWith('select ')) {
    return { ok: false, rows: [] };
  }

  try {
    const statement = db.prepare(sql);
    return { ok: true, rows: statement.all(...params) };
  } catch (_) {
    return { ok: false, rows: [] };
  }
}

function readRates() {
  let raw;
  try {
    raw = fs.readFileSync(RATES_PATH, 'utf8');
  } catch (_) {
    return { ok: false, message: 'GPT-5.5 rates unavailable.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return { ok: false, message: 'GPT-5.5 rates invalid.' };
  }

  const gpt55 = parsed && parsed['gpt-5.5'];
  if (!gpt55 || typeof gpt55 !== 'object') {
    return { ok: false, message: 'GPT-5.5 rates unavailable.' };
  }

  const asOf = parseIsoDate(gpt55.as_of);
  const input = Number(gpt55.input_usd_per_1m_tokens);
  const output = Number(gpt55.output_usd_per_1m_tokens);

  if (!asOf || !Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
    return { ok: false, message: 'GPT-5.5 rates invalid.' };
  }

  const ageMs = Date.now() - asOf.getTime();
  const staleMs = RATE_STALE_DAYS * 24 * 60 * 60 * 1000;
  if (ageMs < 0 || ageMs > staleMs) {
    return { ok: false, message: 'GPT-5.5 rates stale.' };
  }

  return {
    ok: true,
    gpt55: {
      asOf: gpt55.as_of,
      inputUsdPer1mTokens: input,
      outputUsdPer1mTokens: output
    }
  };
}

function renderDashboard(model) {
  const kpis = model.sections.kpis;
  const queue = model.sections.queue;
  const worker = model.sections.worker;
  const spend = model.sections.spend;
  const tokens = model.sections.tokens;
  const outcomes = model.sections.outcomes;
  const deploy = model.sections.deploy || unavailable('Deploy status is unavailable.');
  const reviews = model.sections.reviews || unavailable('Reviews unavailable.');
  const renderedAt = Date.now();

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coyote Claw · Mission Control</title>
  <link rel="icon" type="image/svg+xml" href="/static/brand/claw.svg">
  <link rel="apple-touch-icon" href="/static/brand/claw-mark.png">
  <style>${css()}</style>
</head>
<body>
  ${renderHeader(model, worker)}
  ${renderHaltBanner(model.halt)}
  ${model.ok ? '' : `<section class="banner fade">${escapeHtml(model.error)}</section>`}
  ${renderKpis(kpis, spend)}
  <div class="grid">
    <div class="stack">
      ${renderQueue(queue, renderedAt)}
      ${renderOutcomes(outcomes)}
      ${renderReviews(reviews)}
    </div>
    <div class="stack">
      ${renderWorker(worker)}
      ${renderDeploy(deploy)}
      ${renderSpend(spend)}
      ${renderTokens(tokens)}
    </div>
  </div>
  <footer class="fade">COYOTE CLAW · MISSION CONTROL v1.1 · READ-ONLY · LOOPBACK · ${escapeHtml(HOST)}:${DEFAULT_PORT}</footer>
  <script>
    for (const el of document.querySelectorAll('time[data-ms]')) {
      const ms = Number(el.dataset.ms);
      if (Number.isFinite(ms) && ms > 0) {
        el.textContent = new Date(ms).toLocaleString();
      }
    }
    // Action-queue interactions. Copy + filter are CLIENT-ONLY (no network). The safe write-path
    // (mark responded / snooze) POSTs to /api/review-action — TA/OT reversible state only; there is
    // NO client path that fires a Google reply (that stays the Telegram tap).
    let aqBusy = false;
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.hasAttribute('data-copy')) {
        const card = t.closest('.aq-card');
        const body = card && card.querySelector('[data-draft]');
        if (body && navigator.clipboard) {
          navigator.clipboard.writeText(body.textContent).then(() => {
            const prev = t.textContent; t.textContent = 'Copied ✓';
            window.setTimeout(() => { t.textContent = prev; }, 1500);
          }).catch(() => {});
        }
        return;
      }
      if (t.hasAttribute('data-filter')) {
        const f = t.getAttribute('data-filter') || '';
        for (const card of document.querySelectorAll('.aq-card')) {
          const issues = (card.getAttribute('data-issues') || '').split(' ');
          card.style.display = (!f || issues.indexOf(f) !== -1) ? '' : 'none';
        }
        return;
      }
      if (t.hasAttribute('data-op')) {
        const wrap = t.closest('[data-review]');
        const id = wrap && wrap.getAttribute('data-review');
        if (!id || aqBusy) return;
        aqBusy = true; t.disabled = true;
        const payload = { op: t.getAttribute('data-op'), review_id: id };
        if (payload.op === 'snooze') payload.hours = 24;
        fetch('/api/review-action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
          .then((r) => r.json()).then(() => window.location.reload())
          .catch(() => { aqBusy = false; t.disabled = false; });
      }
    });
    window.setTimeout(() => window.location.reload(), 30000);
  </script>
</body>
</html>`;
}

function renderHeader(model, worker) {
  const workerLive = worker.ok && worker.active === true;
  const workerLabel = worker.ok && worker.headerChip ? worker.headerChip : 'UNKNOWN';
  return `
    <header class="fade">
      <span class="mark">${renderClawSvg(46, 46, 'Coyote Claw')}</span>
      <span class="wordmark">
        <span class="t">Coyote Claw</span>
        <span class="s">Mission Control</span>
      </span>
      <div class="sys">
        <div class="sysitem"><span class="k">Daemon</span><span class="v"><span class="seal">SEALED ×4</span></span></div>
        <div class="sysitem"><span class="k">Worker</span><span class="v">${workerLive ? '<span class="pulse"></span>' : ''}${escapeHtml(workerLabel)}</span></div>
        <div class="sysitem"><span class="k">Refreshed</span><span class="v mono">${escapeHtml(formatClock(model.refreshedAt))}</span></div>
      </div>
    </header>
  `;
}

function renderHaltBanner(halt) {
  if (!halt || halt.halted !== true) {
    return '';
  }

  return `<section class="banner fade">HALTED · ${escapeHtml(halt.source || 'unknown')}</section>`;
}

function renderKpis(section, spend) {
  const jobsToday = section.ok ? section.jobsToday : 0;
  const shippedToday = section.ok ? section.shippedToday : 0;
  const activeJobs = section.ok ? section.activeJobs : 0;
  const gatesPassed = section.ok ? section.gatesPassed : 0;
  const gatesRefused = section.ok ? section.gatesRefused : 0;
  const openGates = section.ok ? section.openGates : 0;
  const activeStage = section.ok ? section.activeStage : 'idle';
  const activeJob = section.ok ? section.activeJob : '';
  const testIntegrityTeeth = section.ok ? section.testIntegrityTeeth : 0;
  const testIntegrityTheatre = section.ok ? section.testIntegrityTheatre : 0;
  const testIntegrityUnavailable = section.ok ? section.testIntegrityUnavailable === true : true;
  const gateTotal = gatesPassed + gatesRefused;
  const spendText = spend.ok ? formatGbp(spend.totalPence) : 'unavailable';
  const spendSub = spend.ok ? `of ${formatGbp(spend.ceilingPence)} cap · Codex excl.` : 'spend table unavailable';
  const active = activeStage !== 'idle' && activeStage !== 'unknown';
  const integritySub = testIntegrityUnavailable ? 'unavailable · mutant-caught accepts and theatre verdicts' : 'mutant-caught accepts and theatre verdicts';

  return `
    <section class="kpis">
      <div class="kpi good fade"><span class="lab">Jobs Today</span><span class="val">${formatInteger(jobsToday)}</span><span class="sub g">${formatInteger(shippedToday)} shipped · ${formatInteger(activeJobs)} in flight</span></div>
      <div class="kpi good fade"><span class="lab">Gates Passed</span><span class="val">${formatInteger(gatesPassed)}/${formatInteger(gateTotal || gatesPassed)}</span><span class="sub">+ ${formatInteger(gatesRefused)} refused</span></div>
      <div class="kpi fade"><span class="lab">Metered Spend</span><span class="val">${escapeHtml(spendText)}</span><span class="sub">${escapeHtml(spendSub)}</span></div>
      <div class="kpi fade"><span class="lab">Open Gates</span><span class="val">${formatInteger(openGates)}</span><span class="sub">${formatCount(openGates, 'tap')} pending</span></div>
      <div class="kpi ${active ? 'live' : ''} fade"><span class="lab">Active Stage</span><span class="val stage-val">${active ? '<span class="pulse"></span>' : ''}${escapeHtml(activeStage.toUpperCase())}</span><span class="sub">${activeJob ? `job #${escapeHtml(activeJob)} · timeout ceiling only` : 'no active job'}</span></div>
      <div class="kpi fade"><span class="lab">TEST INTEGRITY</span><span class="val">${formatInteger(testIntegrityTeeth)} teeth · ${formatInteger(testIntegrityTheatre)} theatre</span><span class="sub">${escapeHtml(integritySub)}</span></div>
    </section>
  `;
}

function renderQueue(section, renderedAt) {
  if (!section.ok) {
    return renderUnavailablePanel('Job Queue', section.message);
  }

  const jobRows = section.recentJobs.map((job) => `
    <tr>
      <td class="id">#${escapeHtml(job.id || 'unknown')}</td>
      <td class="age mono">${escapeHtml(formatJobAge(job.createdAt, renderedAt))}</td>
      <td class="title">${escapeHtml(job.type)}</td>
      <td>${renderStatusPill(job.status)}</td>
      <td class="eng">${escapeHtml(job.engine)}</td>
      <td class="mono stage ${escapeHtml(statusPillClass(job.status, job.stage))}">${escapeHtml(formatStage(job.stage, job.effort))}</td>
      <td class="ref">${escapeHtml(job.ref || '—')}</td>
    </tr>
  `).join('');

  return `
    <section class="panel fade">
      <div class="phead"><h2>Job Queue</h2><span class="count">${formatInteger(section.recentJobs.length)} shown</span></div>
      ${renderWarnings(section.warnings)}
      <div class="pbody table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Age</th><th>Job</th><th>State</th><th>Engine</th><th>Stage</th><th>Ref</th></tr></thead>
          <tbody>${jobRows || '<tr><td colspan="7" class="empty-row">No recent jobs.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderWorker(section) {
  if (!section.ok) {
    return renderUnavailablePanel('Workers', section.message);
  }

  const workers = Array.isArray(section.workers) ? section.workers : [];
  const activeCount = workers.filter((worker) => worker.active === true).length;
  const count = activeCount > 0
    ? `${formatInteger(activeCount)} active`
    : (section.anyFresh ? 'IDLE' : 'UNKNOWN');
  const cards = workers.map((worker) => {
    const active = worker.active === true;
    const stale = worker.fresh !== true;
    const phase = worker.phase || 'IDLE';
    return `
        <div class="hero ${active ? 'active' : ''} ${stale ? 'stale' : ''}">
          <div class="row1">${active ? '<span class="pulse"></span>' : ''}<span class="name">${escapeHtml(worker.name)}</span>${renderStatusPill(phase)}${stale ? '<span class="pill p-refused">STALE</span>' : ''}</div>
          <div class="meta">
            <div class="m"><span class="mk">Job</span><span class="mv">${worker.jobId ? `#${escapeHtml(worker.jobId)}` : 'none'}</span></div>
            <div class="m"><span class="mk">Last Beat</span><span class="mv">${escapeHtml(formatClock(worker.lastBeatMs))}</span></div>
          </div>
        </div>
    `;
  }).join('');

  return `
    <section class="panel fade">
      <div class="phead"><h2>Workers</h2><span class="count">${escapeHtml(count)}</span></div>
      <div class="heroes">
        ${cards || '<p class="note">No worker heartbeat rows.</p>'}
      </div>
      ${renderWarnings(section.warnings)}
    </section>
  `;
}

function renderDeploy(section) {
  if (!section.ok) {
    return renderUnavailablePanel('Deploy Status', section.message);
  }

  if (section.empty === true) {
    return `
    <section class="panel fade deploy-panel">
      <div class="phead"><h2>Deploy Status</h2><span class="count">deploys</span></div>
      <p class="empty-row">No deploys recorded yet.</p>
      ${renderWarnings(section.warnings)}
    </section>
  `;
  }

  const latestLabel = deployStatusLabel(section.latestStatus);
  const summary = section.upToDate
    ? '<div class="deploy-indicator deploy-indicator--ok">UP TO DATE</div>'
    : `
        <div class="deploy-summary-grid">
          <div><span class="mk">Serving</span><span class="mv mono">${escapeHtml(section.servingSha8 || 'unknown')}</span></div>
          <div><span class="mk">Latest</span><span class="mv mono">${escapeHtml(section.latestDeploySha8 || 'unknown')}</span></div>
          <div><span class="mk">Status</span>${renderDeployStatusPill(section.latestStatus, latestLabel)}</div>
        </div>
      `;

  const pending = section.pendingRows.length > 0
    ? `
      <div class="deploy-pending">
        <div class="deploy-subhead">Pending</div>
        ${section.pendingRows.map((row) => `
          <div class="deploy-row deploy-row--pending">
            <span class="mono">${escapeHtml(row.targetSha8 || 'unknown')}</span>
            ${renderDeployStatusPill(row.status)}
          </div>
        `).join('')}
      </div>
    `
    : '';

  const recentRows = section.recentRows.map((row) => `
    <tr>
      <td class="mono">${escapeHtml(row.targetSha8 || 'unknown')}</td>
      <td>${renderDeployStatusPill(row.status)}</td>
      <td class="age mono">${renderTime(row.updatedAt || row.createdAt)}</td>
    </tr>
  `).join('');

  return `
    <section class="panel fade deploy-panel">
      <div class="phead"><h2>Deploy Status</h2><span class="count">${escapeHtml(latestLabel)}</span></div>
      <div class="deploy-summary">${summary}</div>
      ${pending}
      <div class="pbody table-wrap deploy-history">
        <table>
          <thead><tr><th>Target</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>${recentRows || '<tr><td colspan="3" class="empty-row">No deploys recorded yet.</td></tr>'}</tbody>
        </table>
      </div>
      ${renderWarnings(section.warnings)}
    </section>
  `;
}

function renderReviews(section) {
  if (!section.ok) {
    return renderUnavailablePanel('Reviews', section.message);
  }

  // Freshness rule (no board-lies): show the STORED snapshot + its age. NEVER a live
  // Google/Vercel call from the board; NEVER a fabricated number. Fresh within ~1.5x the
  // daily cadence; older reads "stale" but still shows the real (last-known) number.
  const REVIEW_STALE_MS = 36 * 60 * 60 * 1000;
  const snap = section.snapshot;
  const fmtRating = (rating) => (rating === null ? '—' : rating.toFixed(2));

  // The board LEADS with the genuinely-actionable queue (recent reviews with text), NOT the lifetime
  // "959" — which is ~99% a years-old backlog and was misleadingly labelled "actionable". 959 stays
  // as honest context, explicitly historical.
  let actionableCell;
  let lifetimeCell;
  let ratingsCell;
  let windowSuffix = '';
  let freshnessLabel;
  if (!snap) {
    actionableCell = '<span class="muted">— · no ingest yet</span>';
    lifetimeCell = '<span class="muted">— · no ingest yet</span>';
    ratingsCell = '<span class="muted">— · no ingest yet</span>';
    freshnessLabel = 'no ingest yet';
  } else {
    const ageMs = Date.now() - snap.fetchedAt;
    const fresh = snap.fetchedAt > 0 && ageMs >= 0 && ageMs <= REVIEW_STALE_MS;
    freshnessLabel = fresh
      ? `as of ${renderTime(snap.fetchedAt)}`
      : `<span class="muted">stale · last ingest ${escapeHtml(formatAgo(snap.fetchedAt))}</span>`;
    const recent = snap.awaitingRecentText;
    actionableCell = `${recent === null ? '—' : formatInteger(recent)} text · ${freshnessLabel}`;
    const over1y = snap.awaitingOver1y === null ? null : formatInteger(snap.awaitingOver1y);
    const starOnly = snap.awaitingStarOnly === null ? null : formatInteger(snap.awaitingStarOnly);
    const ctx = over1y === null && starOnly === null
      ? ''
      : ` <span class="muted">(${over1y ?? '?'} &gt;1yr · ${starOnly ?? '?'} star-only · historical, not a queue)</span>`;
    lifetimeCell = `${formatInteger(snap.awaiting)}${ctx}`;
    ratingsCell = `Google ${fmtRating(snap.google)} · TripAdvisor ${fmtRating(snap.tripadvisor)} · OpenTable ${fmtRating(snap.opentable)}`;
    windowSuffix = snap.window ? ` (${escapeHtml(snap.window)})` : '';
  }

  // Gate-decision log (Google rev: tap history) — kept as a compact transparency footer.
  const draftRows = section.postRows
    .map((post) => `
      <tr>
        <td class="mono">#${formatInteger(post.id)}</td>
        <td>${renderStatusPill(post.status)}</td>
        <td>${post.decision ? escapeHtml(post.decision) : '—'}</td>
        <td class="age mono">${renderTime(post.updatedAt)}</td>
      </tr>
    `)
    .join('');

  // Per-platform detail at honest grain (no-lies): Google overall-only (Google Business reviews
  // have no native sub-ratings); OpenTable dense per-review categories; TripAdvisor sparse
  // per-review + a location-averages row that reads "pending" until /api/v1/aggregates ships.
  const platformTable = renderPlatformGrain(section.platforms || {}, section.aggregates || {}, snap, fmtRating, freshnessLabel);

  // The action surface: ALLERGEN alert (top), the honest-grain ratings line + 959 demoted, the rising
  // strip, then the cards (the queue). All rendered from STORED data — no draft is generated here.
  const allergenAlert = renderAllergenAlert(section.escalations || []);
  const risingStrip = renderRisingStrip(section.trends || []);
  const cards = (section.cards || []).map(renderActionCard).join('');
  const cardsBlock = cards
    ? `<div class="aq-cards" id="aq-cards">${cards}</div>`
    : '<div class="pbody"><span class="muted">No drafts in the queue — drafts generate on the daily ingest.</span></div>';
  const queueCount = section.cards ? section.cards.length : 0;

  return `
    <section class="panel fade reviews-panel">
      <div class="phead"><h2>Reviews · Action Queue</h2><span class="count">${formatInteger(queueCount)} in queue · ${formatInteger(section.pendingCount)} awaiting tap</span></div>
      ${allergenAlert}
      <div class="pbody aq-grain mono">Ratings${windowSuffix}: ${ratingsCell} · <span class="muted">awaiting 30d: ${actionableCell}</span> · <span class="muted">lifetime ${lifetimeCell} · historical</span></div>
      ${risingStrip}
      ${cardsBlock}
      ${platformTable}
      <div class="pbody"><span class="muted">Google gate log (rev: tap)</span></div>
      <div class="pbody table-wrap">
        <table>
          <thead><tr><th>Draft</th><th>Status</th><th>Decision</th><th>Time</th></tr></thead>
          <tbody>${draftRows || '<tr><td colspan="4" class="empty-row">No drafts parked.</td></tr>'}</tbody>
        </table>
      </div>
      ${renderWarnings(section.warnings)}
    </section>
  `;
}

// Colour-coded platform badge (Google blue / TripAdvisor green / OpenTable red) — the existing aesthetic.
function platformBadge(platform) {
  if (platform === 'google') return { label: 'Google', cls: 'b-google' };
  if (platform === 'tripadvisor') return { label: 'TripAdvisor', cls: 'b-ta' };
  if (platform === 'opentable') return { label: 'OpenTable', cls: 'b-ot' };
  return { label: platform || 'unknown', cls: 'b-unknown' };
}

function renderStars(overall) {
  if (overall === null || overall === undefined) return '<span class="muted">—</span>';
  const n = Math.max(0, Math.min(5, Math.round(overall)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

// ALLERGEN escalation = a top safety alert (already flagged escalate=1 in review_actions on sight).
function renderAllergenAlert(escalations) {
  const allergen = escalations.find((e) => e.code === 'ALLERGEN_HANDLING');
  if (!allergen) return '';
  const firstLine = (allergen.summary || '').split('\n')[0];
  return `<div class="aq-alert">⚠ ALLERGEN — escalated on sight (safety, any count). ${escapeHtml(firstLine)} <span class="aq-alert-tail">· surface to web research</span></div>`;
}

// Rising-issue chips (issue_trends, latest). Click filters the queue (client-side, no network).
function renderRisingStrip(trends) {
  const rising = (trends || []).filter((t) => t.rising);
  if (rising.length === 0) return '';
  const chips = rising
    .map((t) => `<button class="aq-chip" type="button" data-filter="${escapeHtml(t.code)}">${escapeHtml(t.code)} ↑${formatInteger(t.current)} <span class="muted">(was ${formatInteger(t.prior)})</span></button>`)
    .join('');
  return `<div class="pbody aq-rising"><span class="aq-rising-lab">Rising 30d</span>${chips}<button class="aq-chip aq-chip-all" type="button" data-filter="">all</button></div>`;
}

// One actionable review card: badge, stars, reviewer, date, text, issue tags, the STORED draft, and
// the per-platform action. Google → "Approve in Telegram" (the gated tap, status only). TA/OT → copy +
// open-review deep-link + mark-responded/snooze (the narrow safe write-path). No card can post to Google.
function renderActionCard(card) {
  const badge = platformBadge(card.platform);
  const tags = (card.tags || [])
    .map((t) => `<button class="aq-tag" type="button" data-filter="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
    .join('');
  const flagged = card.flagged
    ? `<div class="aq-flag">⚠ guard flag: ${escapeHtml(card.flagged)} — review before posting</div>`
    : '';
  let action;
  if (card.platform === 'google') {
    const state = card.status === 'posted' ? 'posted ✓' : '⏳ Approve in Telegram';
    action = `<div class="aq-actions"><span class="aq-state">${escapeHtml(state)}</span></div>`;
  } else {
    const open = card.url ? `<a class="aq-btn aq-open" href="${escapeHtml(card.url)}" target="_blank" rel="noopener noreferrer">Open review ↗</a>` : '';
    action = `<div class="aq-actions" data-review="${escapeHtml(card.reviewId)}">
        <button class="aq-btn aq-copy" type="button" data-copy>Copy reply</button>
        ${open}
        <button class="aq-btn aq-respond" type="button" data-op="mark_responded">Mark responded</button>
        <button class="aq-btn aq-snooze" type="button" data-op="snooze">Snooze</button>
        <span class="aq-state">draft · post manually</span>
      </div>`;
  }
  return `
    <article class="aq-card ${badge.cls}" data-issues="${escapeHtml((card.tags || []).join(' '))}">
      <div class="aq-top">
        <span class="aq-badge ${badge.cls}">${escapeHtml(badge.label)}</span>
        <span class="aq-stars">${renderStars(card.overall)}</span>
        <span class="aq-who">${escapeHtml(card.reviewer || '—')}</span>
        <span class="aq-date mono">${escapeHtml(card.date)}</span>
      </div>
      <div class="aq-text">${escapeHtml(card.text)}</div>
      ${tags ? `<div class="aq-tags">${tags}</div>` : ''}
      <div class="aq-draft"><div class="aq-draft-label">Draft reply</div><div class="aq-draft-body" data-draft>${escapeHtml(card.draft)}</div></div>
      ${flagged}
      ${action}
    </article>`;
}

// Per-platform grain block. Pure (HTML string from the section model + helpers). Renders nothing
// when there's no corpus (graceful on a pre-ingest / old DB). NEVER fabricates: Google is forced to
// "overall only", OT/TA show genuine per-review averages with coverage (n_with_cats/n), and the
// TripAdvisor location-averages row stays "pending" until review_aggregate is populated.
function renderPlatformGrain(platforms, aggregates, snap, fmtRating, freshnessLabel) {
  if (!platforms || Object.keys(platforms).length === 0) {
    return '';
  }
  const count = (platform) => (platforms[platform] ? formatInteger(platforms[platform].n) : '0');
  const cats = (platform, ambienceLabel) => {
    if (platform === 'google') {
      return '<span class="muted">overall only — Google has no sub-ratings</span>';
    }
    const c = platforms[platform];
    if (!c || c.withCats === 0) {
      return '<span class="muted">no per-review sub-ratings</span>';
    }
    return `Food ${fmtRating(c.food)} · Service ${fmtRating(c.service)} · ${ambienceLabel} ${fmtRating(c.atmosphere)} · Value ${fmtRating(c.value)} <span class="muted">(${formatInteger(c.withCats)}/${formatInteger(c.n)})</span>`;
  };
  // The rev: tap queue is the RECENT actionable reviews, not the lifetime 959 (kept here as muted context).
  const googleReply = snap
    ? `${snap.awaitingRecentText === null ? '—' : formatInteger(snap.awaitingRecentText)} recent · <span class="muted">actionable (rev: tap)</span> · <span class="muted">${formatInteger(snap.awaiting)} lifetime</span>`
    : '<span class="muted">—</span>';
  const awareness = '<span class="muted">— awareness · no reply capability</span>';
  const googleCount = snap ? formatInteger(snap.total) : count('google');

  const taAgg = aggregates.tripadvisor;
  const taAggCell = taAgg
    ? `Food ${fmtRating(taAgg.food)} · Service ${fmtRating(taAgg.service)} · Atmosphere ${fmtRating(taAgg.atmosphere)} · Value ${fmtRating(taAgg.value)} <span class="muted">(${formatInteger(taAgg.numReviews)} reviews)</span>`
    : '<span class="muted">averages pending · /api/v1/aggregates not yet live</span>';

  return `
      <div class="pbody"><span class="muted">Per-platform sub-ratings · ${freshnessLabel} · reply capability is Google-only</span></div>
      <div class="pbody table-wrap">
        <table>
          <thead><tr><th>Platform</th><th>Reviews</th><th>Reply queue</th><th>Per-review sub-ratings</th></tr></thead>
          <tbody>
            <tr><td>Google</td><td class="mono">${googleCount}</td><td class="mono">${googleReply}</td><td class="mono">${cats('google', 'Atmosphere')}</td></tr>
            <tr><td>OpenTable</td><td class="mono">${count('opentable')} <span class="muted">recent</span></td><td class="mono">${awareness}</td><td class="mono">${cats('opentable', 'Ambience')}</td></tr>
            <tr><td>TripAdvisor</td><td class="mono">${count('tripadvisor')} <span class="muted">recent</span></td><td class="mono">${awareness}</td><td class="mono">${cats('tripadvisor', 'Atmosphere')}</td></tr>
            <tr><td>TripAdvisor averages</td><td class="mono">—</td><td class="mono"><span class="muted">location-level</span></td><td class="mono">${taAggCell}</td></tr>
          </tbody>
        </table>
      </div>`;
}

function formatAgo(ms) {
  if (!ms) {
    return 'unknown';
  }
  const diff = Date.now() - ms;
  if (diff < 0) {
    return 'in the future';
  }
  const mins = Math.floor(diff / 60000);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function renderSpend(section) {
  if (!section.ok) {
    return renderUnavailablePanel('Metered Spend', section.message);
  }

  const pct = Math.min(Math.max(section.percent, 0), 100);
  const remaining = Math.max(section.ceilingPence - section.totalPence, 0);

  return `
    <section class="panel fade">
      <div class="phead"><h2>Metered Spend</h2><span class="count">£ only</span></div>
      <div class="spend">
        <div class="line"><span class="l">Router · Claude metered</span><span class="r">${formatGbp(section.routerPence)}</span></div>
        <div class="line"><span class="l">Worker · Claude builds</span><span class="r">${formatGbp(section.workerPence)}</span></div>
        <div class="line excl"><span class="l">Codex builds · OAuth</span><span class="r">excluded</span></div>
        <div class="tot"><span class="l">Total metered</span><span class="r">${formatGbp(section.totalPence)}</span></div>
        <div>
          <div class="cap" aria-label="Metered spend cap usage"><i class="${escapeHtml(section.level)}" style="width:${pct.toFixed(2)}%"></i></div>
          <p class="note" style="margin-top:.4rem">${formatGbp(remaining)} remaining of ${formatGbp(section.ceilingPence)} router cap. Codex draws shared ChatGPT quota — no £-ledger entry, deliberately excluded so spend isn't overstated.</p>
        </div>
      </div>
      ${renderWarnings(section.warnings)}
    </section>
  `;
}

function renderTokens(section) {
  if (!section.ok) {
    return renderUnavailablePanel('Token Usage', section.message);
  }

  if (section.rows.length === 0) {
    return `
      <section class="panel fade">
        <div class="phead"><h2>Token Usage</h2><span class="count">job_token_usage</span></div>
        <div class="empty">
          <span class="glyph">${renderTokenGlyph()}</span>
          <span class="h">Awaiting first instrumented job</span>
          <span class="p">Panel built to the job_token_usage contract. Capture lands with worker token-instrumentation — cached-input 90%-off accounted, output-weighted so API cost isn't overstated.</span>
        </div>
        ${renderWarnings(section.warnings)}
      </section>
    `;
  }

  const rows = section.rows.map((row) => `
    <tr>
      <td class="id">#${escapeHtml(row.id)}</td>
      <td class="title">${escapeHtml(row.type)}</td>
      <td class="mono">${formatInteger(row.input)}</td>
      <td class="mono">${formatInteger(row.output)}</td>
      <td class="mono">${formatInteger(row.total)}</td>
    </tr>
  `).join('');

  const estimate = section.estimatedApiCostUsd === null
    ? 'rates unavailable'
    : `~${formatUsd(section.estimatedApiCostUsd)}`;
  const difference = section.differenceUsd === null
    ? 'rates unavailable'
    : renderDifference(section.differenceUsd);

  return `
    <section class="panel fade">
      <div class="phead"><h2>Token Usage</h2><span class="count">job_token_usage</span></div>
      <div class="token-live">
        <div><span class="mk">Input</span><span class="mv">${formatInteger(section.totals.input)}</span></div>
        <div><span class="mk">Output</span><span class="mv">${formatInteger(section.totals.output)}</span></div>
        <div><span class="mk">Total</span><span class="mv">${formatInteger(section.totals.total)}</span></div>
      </div>
      <p class="note token-note">Codex subscription: USD 200 flat-rate. Estimated GPT-5.5 API cost at this volume: ${escapeHtml(estimate)}. ${difference}</p>
      ${renderWarnings(section.warnings)}
      <div class="pbody table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Type</th>
              <th>Input tokens</th>
              <th>Output tokens</th>
              <th>Total tokens</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderOutcomes(section) {
  if (!section.ok) {
    return renderUnavailablePanel('Outcomes · Gate Trail', section.message);
  }

  const events = section.events.map((event) => `
    <div class="ev ${escapeHtml(event.tone)}">
      <span class="ts">${escapeHtml(formatEventTime(event.createdAt))}</span>
      <span class="dot"></span>
      <div class="body">
        <div class="m">job <b>#${escapeHtml(event.jobId || 'unknown')}</b> ${escapeHtml(event.kind || event.decision || 'event')} — ${escapeHtml(event.summary || 'no detail')}</div>
        ${event.correction ? `<div class="corr">correction: ${escapeHtml(event.correction)}</div>` : ''}
      </div>
    </div>
  `).join('');

  return `
    <section class="panel fade">
      <div class="phead"><h2>Outcomes · Gate Trail</h2><span class="count">learning signal</span></div>
      ${renderWarnings(section.warnings)}
      <div class="events">${events || '<div class="empty-row">No recent events.</div>'}</div>
    </section>
  `;
}

function renderUnavailablePanel(title, message) {
  return `
    <section class="panel fade unavailable">
      <div class="phead"><h2>${escapeHtml(title)}</h2><span class="count">unavailable</span></div>
      <p class="note unavailable-note">${escapeHtml(message)}</p>
    </section>
  `;
}

function renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) {
    return '';
  }

  return `
    <ul class="warnings">
      ${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}
    </ul>
  `;
}

function renderStatusPill(status) {
  const name = safeLabel(status, 'unknown');
  return `<span class="pill ${escapeHtml(statusPillClass(name, name))}">${escapeHtml(name)}</span>`;
}

function renderDeployStatusPill(status, label = deployStatusLabel(status)) {
  return `<span class="${escapeHtml(deployStatusPillClass(status))}">${escapeHtml(label)}</span>`;
}

function renderTime(ms) {
  if (!ms) {
    return '<span class="muted">unknown</span>';
  }

  return `<time data-ms="${ms}">${escapeHtml(formatUtc(ms))}</time>`;
}

function renderClawSvg(width, height, label) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 100 100" aria-label="${escapeHtml(label)}">
      <g fill="#8A9AB5">
        <polygon points="20,40 26,49 20,58 14,49"/>
        <polygon points="38,28 45,38 38,48 31,38"/>
        <polygon points="62,28 69,38 62,48 55,38"/>
        <polygon points="80,40 86,49 80,58 74,49"/>
        <polygon points="30,62 50,55 70,62 63,86 50,80 37,86"/>
      </g>
    </svg>`;
}

function renderTokenGlyph() {
  return `<svg width="56" height="56" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" fill="none" stroke="#3D4A63" stroke-width="2" stroke-dasharray="5 6"/>
      <g fill="#3D4A63">
        <polygon points="20,40 26,49 20,58 14,49"/><polygon points="38,28 45,38 38,48 31,38"/>
        <polygon points="62,28 69,38 62,48 55,38"/><polygon points="80,40 86,49 80,58 74,49"/>
        <polygon points="30,62 50,55 70,62 63,86 50,80 37,86"/>
      </g>
    </svg>`;
}

function renderDifference(diff) {
  if (diff > 0) {
    return `subscription is ${escapeHtml(formatUsd(diff))} above estimated metered API`;
  }

  if (diff < 0) {
    return `subscription is ${escapeHtml(formatUsd(Math.abs(diff)))} below estimated metered API`;
  }

  return 'subscription equals estimated metered API cost';
}

function summarizeSpendLines(rows) {
  const lines = {
    routerPence: 0,
    workerPence: 0,
    codexPence: 0
  };

  for (const row of rows) {
    const cost = toInteger(row.cost_pence);
    const text = `${row.note || ''} ${row.type || ''}`.toLowerCase();
    if (text.includes('codex')) {
      lines.codexPence += cost;
      continue;
    }
    if (!text.includes('claude')) {
      continue;
    }
    if (text.includes('router')) {
      lines.routerPence += cost;
    } else {
      lines.workerPence += cost;
    }
  }

  return lines;
}

function summarizeDetail(row) {
  const kind = normalizeSignal(row.kind);
  const gate = normalizeSignal(row.gate);
  const decision = normalizeSignal(row.decision);
  const corrected = kind === 'corrected' || gate === 'corrected' || decision === 'corrected';
  const detail = parseDetailObject(row.detail);

  if (corrected) {
    if (detail && typeof detail.note === 'string' && detail.note.trim()) {
      return limitText(detail.note.trim(), 180);
    }
    return 'Correction note missing';
  }

  const kindSummary = summarizeKnownDetail(row, detail);
  if (kindSummary) {
    return kindSummary;
  }

  if (!detail) {
    return row.detail ? 'Unstructured detail omitted' : '';
  }

  for (const key of ['summary', 'note', 'reason', 'message']) {
    if (typeof detail[key] === 'string' && detail[key].trim()) {
      return limitText(detail[key].trim(), 180);
    }
  }

  const keys = Object.keys(detail).filter((key) => !looksSensitive(key));
  if (keys.length === 0) {
    return 'Detail omitted';
  }

  return `${keys.length} detail field${keys.length === 1 ? '' : 's'} omitted`;
}

function summarizeCorrection(row) {
  if (!isRefusedEvent(row)) {
    return '';
  }

  const detail = parseDetailObject(row.detail);
  if (detail) {
    for (const key of ['correction', 'correction_text', 'corrective_action', 'next_step', 'hint']) {
      if (typeof detail[key] === 'string' && detail[key].trim()) {
        return limitText(detail[key].trim(), 180);
      }
    }
  }

  return 'tap the newest coder-bot message; nonce is single-use';
}

function classifyGateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return null;
  }

  const kind = normalizeSignal(event.kind);
  const decision = normalizeSignal(event.decision);
  if (decision) {
    if (kind && !isGateEventKind(kind)) {
      return null;
    }
    return classifyGateDecision(decision);
  }

  if (kind === 'spec_approved' || kind === 'merge_fired') {
    return 'passed';
  }
  if (kind === 'merge_refused') {
    return 'refused';
  }

  return classifyGateDecision(kind);
}

function classifyGateDecision(value) {
  switch (normalizeSignal(value)) {
    case 'approve':
    case 'approved':
    case 'passed':
    case 'pass':
    case 'accepted':
    case 'accept':
      return 'passed';
    case 'reject':
    case 'rejected':
    case 'refused':
    case 'refuse':
      return 'refused';
    default:
      return null;
  }
}

function isGateEventKind(kind) {
  const normalized = normalizeSignal(kind);
  return normalized === 'gate'
    || normalized === 'gate_decision'
    || normalized === 'gate-decision'
    || normalized === 'approval'
    || normalized === 'signoff'
    || normalized === 'sign_off'
    || normalized === 'awaiting_signoff'
    || normalized === 'pr'
    || normalized === 'merge'
    || normalized === 'spec'
    || normalized === 'spec_approved'
    || normalized === 'merge_fired'
    || normalized === 'merge_refused'
    || normalized.includes('gate');
}

function eventTone(row) {
  if (normalizeSignal(row.kind) === 'security') {
    return 'bad';
  }
  const acceptedTone = acceptedEventTone(row);
  if (acceptedTone) {
    return acceptedTone;
  }
  const directTone = classifiedTone(row);
  if (directTone) {
    return directTone;
  }
  const text = `${row.kind || ''} ${row.gate || ''} ${row.decision || ''}`.toLowerCase();
  if (/refused|rejected|failed|blocked|denied/.test(text)) {
    return 'bad';
  }
  if (/approved|accepted|passed|merged|complete|fired/.test(text)) {
    return 'ok';
  }
  return 'info';
}

function isRefusedEvent(row) {
  const acceptedTone = acceptedEventTone(row);
  if (acceptedTone) {
    return false;
  }
  const directTone = classifiedTone(row);
  if (directTone) {
    return directTone === 'bad';
  }
  const text = `${row.kind || ''} ${row.gate || ''} ${row.decision || ''}`.toLowerCase();
  return /refused|rejected|failed|blocked|denied/.test(text);
}

function acceptedEventTone(row) {
  const kind = normalizeSignal(row && row.kind);
  const detail = parseDetailObject(row && row.detail);
  if (!detail) {
    return '';
  }

  if (kind === 'test_run' && normalizeSignal(detail.verdict) === 'accept') {
    return 'ok';
  }

  if (kind === 'note' && detail.merged === true) {
    return 'ok';
  }

  return '';
}

function classifiedTone(row) {
  for (const value of decisionValues(row)) {
    const tone = signalTone(value);
    if (tone) {
      return tone;
    }
  }

  const kind = normalizeSignal(row && row.kind);
  const kindTone = signalTone(kind);
  if (kindTone) {
    return kindTone;
  }

  for (const word of signalWords(row && row.kind)) {
    const tone = signalTone(word);
    if (tone) {
      return tone;
    }
  }

  return '';
}

function decisionValues(row) {
  const values = [];
  const detail = parseDetailObject(row && row.detail);
  for (const source of [row, detail]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      continue;
    }
    for (const key of ['decision', 'verdict', 'status', 'outcome']) {
      if (source[key] !== null && source[key] !== undefined) {
        values.push(source[key]);
      }
    }
  }
  return values;
}

function signalTone(value) {
  switch (normalizeSignal(value)) {
    case 'approve':
    case 'merged':
    case 'passed':
    case 'accepted':
    case 'done':
      return 'ok';
    case 'reject':
    case 'refused':
    case 'failed':
    case 'escalated':
      return 'bad';
    case 'correct':
    case 'neutral':
      return 'info';
    default:
      return '';
  }
}

function normalizeSignal(value) {
  return String(value || '').trim().toLowerCase();
}

function signalWords(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function summarizeKnownDetail(row, detail) {
  const kind = normalizeSignal(row.kind);
  if (kind === 'gate_decision') {
    return summarizeGateDecision(row, detail);
  }
  if (kind === 'test_run') {
    return summarizeTestRun(row, detail);
  }
  if (kind === 'lead_decision') {
    return summarizeLeadDecision(row, detail);
  }
  if (kind === 'pr_opened') {
    return summarizePrOpened(row, detail);
  }
  if (kind === 'build_submitted') {
    return summarizeBuildSubmitted(row, detail);
  }
  return '';
}

function summarizeGateDecision(row, detail) {
  const parts = [];
  const gate = detailValue(row, detail, ['gate']);
  const decision = detailValue(row, detail, ['decision', 'verdict', 'status', 'outcome']);
  const reason = detailValue(row, detail, ['reason', 'message', 'summary', 'note']);

  if (gate) {
    parts.push(`gate ${gate}`);
  }
  if (decision) {
    parts.push(`decision ${decision}`);
  }
  if (reason) {
    parts.push(reason);
  }

  return parts.length > 0 ? limitText(parts.join(' · '), 180) : '';
}

function summarizeTestRun(row, detail) {
  const parts = [];
  const verdict = detailValue(row, detail, ['verdict', 'decision', 'status', 'outcome']);
  const countKeys = ['passCount', 'passes', 'passed', 'failCount', 'failures', 'failed', 'total', 'count'];

  if (verdict) {
    parts.push(`verdict ${verdict}`);
  }

  for (const key of countKeys) {
    const value = detailValue(row, detail, [key]);
    if (value) {
      parts.push(`${humanizeKey(key)} ${value}`);
    }
  }

  if (verdict === 'theatre') {
    parts.push('integrity theatre/proves-nothing');
  } else if (verdict === 'accept') {
    const caughtCount = countCaughtByMutant(detail && detail.perFunction);
    if (caughtCount > 0) {
      parts.push(`mutant-killed (${caughtCount} fns)`);
    }
  }

  return parts.length > 0 ? limitText(parts.join(' · '), 180) : '';
}

function summarizeLeadDecision(row, detail) {
  const parts = [];
  const verdict = detailValue(row, detail, ['verdict', 'decision']);
  const review = detailValue(row, detail, ['assessment', 'correction']);

  if (verdict) {
    parts.push(`verdict ${verdict}`);
  }
  if (review) {
    parts.push(limitText(review, 180));
  }

  return parts.length > 0 ? limitText(parts.join(' · '), 180) : '';
}

function countCaughtByMutant(perFunction) {
  if (!Array.isArray(perFunction)) {
    return 0;
  }
  return perFunction.filter((entry) => entry && entry.caughtByMutant === true).length;
}

function summarizePrOpened(row, detail) {
  return summarizeFields(row, detail, [
    ['number', 'pr', 'pr_number', 'pull_request'],
    ['title'],
    ['url', 'html_url', 'pull_request_url'],
    ['branch'],
    ['head'],
    ['ref']
  ]);
}

function summarizeBuildSubmitted(row, detail) {
  return summarizeFields(row, detail, [
    ['buildId', 'build_id', 'id'],
    ['jobId', 'job_id'],
    ['target'],
    ['branch'],
    ['ref'],
    ['sha', 'head_sha'],
    ['commit', 'commit_sha']
  ]);
}

function summarizeFields(row, detail, groups) {
  const parts = [];
  for (const keys of groups) {
    const value = detailValue(row, detail, keys);
    if (value) {
      parts.push(`${humanizeKey(keys[0])} ${value}`);
    }
  }
  return parts.length > 0 ? limitText(parts.join(' · '), 180) : '';
}

function detailValue(row, detail, keys) {
  for (const source of [detail, row]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      continue;
    }
    for (const key of keys) {
      if (source[key] !== null && source[key] !== undefined && String(source[key]).trim()) {
        return singleLineText(source[key]);
      }
    }
  }
  return '';
}

function singleLineText(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function humanizeKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function deriveEngine(row) {
  const value = firstPresent(row, ['engine', 'worker_engine', 'model_provider', 'provider', 'model']);
  if (value) {
    return safeLabel(value, 'unknown');
  }

  const result = typeof (row && row.result) === 'string'
    ? parseJsonObject(row.result)
    : parseDetailObject(row && row.result);
  const resultValue = firstPresent(result, ['engine', 'model']);
  if (resultValue) {
    return safeLabel(resultValue, 'unknown');
  }
  return 'unknown';
}

function deriveStage(row) {
  const value = firstPresent(row, ['stage', 'phase', 'gate', 'status']);
  const normalized = safeLabel(value, 'unknown').toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized.includes('spec')) {
    return 'spec';
  }
  if (normalized.includes('build') || normalized.includes('active') || normalized.includes('running') || normalized.includes('progress') || normalized.includes('executing')) {
    return 'build';
  }
  if (normalized.includes('merged') || normalized.includes('complete') || normalized.includes('done') || normalized.includes('shipped')) {
    return 'done';
  }
  if (normalized.includes('refused') || normalized.includes('failed') || normalized.includes('rejected')) {
    return 'gate';
  }
  if (normalized.includes('queued') || normalized.includes('pending')) {
    return 'queued';
  }
  return normalized || 'unknown';
}

function deriveEffort(row) {
  return safeLabel(firstPresent(row, ['effort', 'reasoning_effort', 'model_reasoning_effort', 'priority']), 'unknown').toLowerCase();
}

function deriveRef(row) {
  const value = firstPresent(row, [
    'branch',
    'ref',
    'pr',
    'pr_number',
    'pull_request',
    'pull_request_url',
    'sha',
    'commit_sha',
    'head_sha'
  ]);
  if (value) {
    return safeLabel(value, '—');
  }

  const result = parseDetailObject(row && row.result);
  for (const key of ['prNumber', 'pr_number', 'number']) {
    const prNumber = result && result[key];
    if ((typeof prNumber === 'number' && Number.isFinite(prNumber)) || (typeof prNumber === 'string' && prNumber.trim())) {
      return `#${String(prNumber).trim()}`;
    }
  }

  for (const key of ['branch', 'ref']) {
    const ref = result && result[key];
    if (typeof ref === 'string' && ref.trim()) {
      return safeLabel(ref, '—');
    }
  }

  for (const key of ['headSha', 'sha', 'commit_sha']) {
    const sha = result && result[key];
    if (typeof sha === 'string' && sha.trim()) {
      return shortId(sha) || '—';
    }
  }

  return '—';
}

function firstPresent(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== null && row[key] !== undefined && String(row[key]).trim()) {
      return row[key];
    }
  }
  return '';
}

function buildDeployModel(deployRows, servingCommit) {
  const servingHash = fullHash(servingCommit);
  const normalizedRows = (Array.isArray(deployRows) ? deployRows : [])
    .map((row) => normalizeDeployRow(row))
    .sort(compareDeployRows);
  const latest = normalizedRows.length > 0 ? normalizedRows[0] : null;
  const latestTargetHash = latest ? latest.targetSha : '';

  return {
    empty: normalizedRows.length === 0,
    latest,
    latestStatus: latest ? latest.status : 'none',
    servingSha8: shortId(servingHash),
    latestDeploySha8: shortId(latestTargetHash),
    upToDate: Boolean(
      latest
      && latest.status === 'deployed'
      && servingHash
      && latestTargetHash
      && servingHash === latestTargetHash
    ),
    pendingRows: normalizedRows.filter((row) => row.status === 'pending' || row.status === 'deploying'),
    recentRows: normalizedRows.slice(0, 8)
  };
}

function normalizeDeployRow(row) {
  const source = row && typeof row === 'object' ? row : {};
  const targetSha = fullHash(source.target_sha);

  return {
    id: source.id,
    targetSha,
    targetSha8: shortId(targetSha),
    status: normalizeDeployStatus(source.status),
    createdAt: toMs(source.created_at),
    updatedAt: toMs(source.updated_at)
  };
}

function normalizeDeployStatus(status) {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

  if (normalized === 'broken') {
    return 'broken';
  }
  if (normalized === 'rolled_back' || normalized === 'rollback' || normalized === 'roll_back') {
    return 'rolled_back';
  }
  if (['deployed', 'success', 'succeeded', 'successful', 'complete', 'completed', 'shipped'].includes(normalized)) {
    return 'deployed';
  }
  if (normalized === 'pending') {
    return 'pending';
  }
  if (normalized === 'deploying') {
    return 'deploying';
  }
  return normalized || 'unknown';
}

function compareDeployRows(left, right) {
  const leftId = numericDeployId(left.id);
  const rightId = numericDeployId(right.id);

  if (leftId !== null && rightId !== null && leftId !== rightId) {
    return rightId - leftId;
  }

  const rightTime = right.updatedAt || right.createdAt;
  const leftTime = left.updatedAt || left.createdAt;
  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return String(right.id || '').localeCompare(String(left.id || ''));
}

function numericDeployId(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fullHash(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function deployStatusPillClass(status) {
  switch (normalizeDeployStatus(status)) {
    case 'deployed':
      return 'deploy-status-pill deploy-status-pill--success';
    case 'pending':
      return 'deploy-status-pill deploy-status-pill--pending';
    case 'deploying':
      return 'deploy-status-pill deploy-status-pill--active';
    case 'broken':
    case 'rolled_back':
      return 'deploy-status-pill deploy-status-pill--danger';
    default:
      return 'deploy-status-pill deploy-status-pill--muted';
  }
}

function deployStatusLabel(status) {
  switch (normalizeDeployStatus(status)) {
    case 'deployed':
      return 'DEPLOYED';
    case 'pending':
      return 'PENDING';
    case 'deploying':
      return 'DEPLOYING';
    case 'broken':
      return 'BROKEN';
    case 'rolled_back':
      return 'ROLLED BACK';
    default:
      return 'UNKNOWN';
  }
}

function statusPillClass(status, stage) {
  const text = `${status || ''} ${stage || ''}`.toLowerCase();
  if (/merged|complete|completed|done|shipped|approved|passed/.test(text)) {
    return 'p-merged';
  }
  if (/refused|failed|rejected|blocked|denied|gate|(?:^|\s)escalated(?:\s|$)/.test(text)) {
    return 'p-refused';
  }
  if (/spec|build|active|running|progress|executing|started/.test(text)) {
    return 'p-build';
  }
  return 'p-queued';
}

function formatStage(stage, effort) {
  const cleanStage = safeLabel(stage, 'unknown');
  const cleanEffort = safeLabel(effort, '');
  if (!cleanEffort || cleanEffort === 'unknown') {
    return cleanStage;
  }
  return `${cleanStage} · ${cleanEffort}`;
}

function stageProgressPercent(stage) {
  const normalized = String(stage || '').toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized === 'spec') {
    return 32;
  }
  if (normalized === 'build' || normalized === 'active') {
    return 64;
  }
  if (normalized === 'awaiting-signoff' || normalized === 'lead-review' || normalized === 'pr' || normalized === 'review') {
    return 90;
  }
  if (normalized === 'done') {
    return 100;
  }
  return 0;
}

function formatTimeout(seconds) {
  const total = toInteger(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatClock(ms) {
  if (!ms) {
    return 'unknown';
  }
  const date = new Date(ms);
  return [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join(':');
}

function formatEventTime(ms) {
  if (!ms) {
    return '--:--';
  }
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatJobAge(createdAt, renderedAt) {
  const createdMs = toMs(createdAt);
  const nowMs = toMs(renderedAt);
  if (!createdMs || !nowMs || createdMs > nowMs) {
    return '-';
  }

  const ageMs = nowMs - createdMs;
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const olderCutoffMs = 30 * dayMs;

  if (ageMs >= 0 && ageMs < minuteMs) {
    return 'just now';
  }
  if (ageMs < hourMs) {
    return `${Math.floor(ageMs / minuteMs)}m`;
  }
  if (ageMs < dayMs) {
    return `${Math.floor(ageMs / hourMs)}h`;
  }
  if (ageMs < olderCutoffMs) {
    return `${Math.floor(ageMs / dayMs)}d`;
  }
  return formatUtc(createdMs);
}

function formatCount(count, label) {
  return `${String(count)} ${label}${count === 1 ? '' : 's'}`;
}

function mapSystemState(rows) {
  const map = new Map();
  for (const row of rows) {
    if (typeof row.key === 'string') {
      map.set(row.key, row.value);
    }
  }
  return map;
}

function firstStateValue(state, keys) {
  for (const key of keys) {
    if (state.has(key)) {
      return state.get(key);
    }
  }
  return null;
}

function parseBooleanLike(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'active', 'online', 'running'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'inactive', 'offline', 'stopped'].includes(normalized)) {
    return false;
  }

  return null;
}

function estimateApiCost(totals, rates) {
  return (totals.input / 1000000) * rates.inputUsdPer1mTokens
    + (totals.output / 1000000) * rates.outputUsdPer1mTokens;
}

function spendLevel(percent) {
  if (percent >= 100) {
    return 'hardstop';
  }
  if (percent >= 80) {
    return 'warn80';
  }
  if (percent >= 50) {
    return 'warn50';
  }
  return 'ok';
}

function getMonthStartMs(date) {
  if (MONTH_MODE === 'UTC') {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function getUtcDayStartMs(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseJsonObject(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function parseDetailObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return parseJsonObject(value);
}

function looksSensitive(key) {
  return /secret|token|key|password|credential|env|payload|result|error/i.test(key);
}

function safeLabel(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const text = String(value).trim();
  return text ? limitText(text, 80) : fallback;
}

function shortId(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value).trim();
  if (!text) {
    return '';
  }

  return text.slice(0, 8);
}

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function limitText(value, maxLength) {
  const singleLine = String(value).replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength - 1)}...`;
}

function collectWarnings(items) {
  return items.filter(Boolean);
}

function unavailable(message) {
  return { ok: false, message, warnings: [] };
}

function readPort(raw) {
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
    return parsed;
  }
  return DEFAULT_PORT;
}

function serveStatic(urlPath, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (_) {
    sendText(res, 400, 'Bad request');
    return;
  }

  const relative = decoded.replace(/^\/static\/?/, '');
  if (!relative || relative.includes('\0')) {
    sendText(res, 404, 'Not found');
    return;
  }

  const filePath = path.resolve(STATIC_ROOT, relative);
  if (filePath !== STATIC_ROOT && !filePath.startsWith(`${STATIC_ROOT}${path.sep}`)) {
    sendText(res, 404, 'Not found');
    return;
  }

  const contentType = staticContentType(path.extname(filePath).toLowerCase());
  if (!contentType) {
    sendText(res, 404, 'Not found');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }

    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        sendText(res, 404, 'Not found');
        return;
      }

      res.writeHead(200, {
        'content-type': contentType,
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff'
      });
      res.end(data);
    });
  });
}

function staticContentType(extension) {
  switch (extension) {
    case '.woff2':
      return 'font/woff2';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    default:
      return '';
  }
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

// Read a bounded request body, then hand the raw text (or parsed JSON) to cb. Mirrors the inline
// body-read the review-action handler uses; extracted so the recipe write-paths share it.
function readTextBody(req, res, maxLen, cb) {
  let raw = '';
  let tooBig = false;
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > maxLen) { tooBig = true; req.destroy(); }
  });
  req.on('end', () => {
    if (tooBig) { sendJson(res, 413, { ok: false, error: 'payload too large' }); return; }
    cb(raw);
  });
}

/** readTextBody's binary twin — Buffers, never utf8 (a spreadsheet through a string
 *  concatenation is corruption, not a file). Same streamed cap posture. */
function readBinaryBody(req, res, maxLen, cb) {
  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > maxLen) { tooBig = true; req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooBig) { sendJson(res, 413, { ok: false, error: 'file too large — 15 MB max' }); return; }
    cb(Buffer.concat(chunks));
  });
}
// Life OS capture relay: validate (fail-closed), forward to the sole writer, pass the
// writer's verdict through untouched. A writer that never saw the command yields a NAMED
// 503 — never a silent queue, never a fake success (writer-down honesty, ops/life-os.md).
// The capture overlay's project picker (rich capture, 2026-08-18): ACTIVE projects from the
// READ-ONLY life mirror — the one sanctioned handle; absent db/table = an honest empty list.
function handleCaptureOptions(req, res) {
  try {
    const LIFELIB = require('./ui/pages/life/life-lib.js');
    const o = LIFELIB.openLifeReadonly();
    if (!o.ok) { sendJson(res, 200, { ok: true, projects: [] }); return; }
    try {
      const q = LIFELIB.lifeSelect(o.db,
        `SELECT id, title, domain_key FROM life_projects WHERE status = 'ACTIVE' ORDER BY title COLLATE NOCASE`);
      const projects = (q.ok ? q.rows : []).map((p) => ({ id: String(p.id), title: String(p.title), domain: String(p.domain_key || '') }));
      sendJson(res, 200, { ok: true, projects });
    } finally { o.db.close(); }
  } catch (e) {
    sendJson(res, 200, { ok: true, projects: [] });
  }
}

function handleLifeCapture(req, res) {
  readJsonBody(req, res, 8192, (body) => {
    const v = LIFECMD.validateCapture(body);
    if (!v.ok) { sendJson(res, v.status, { ok: false, error: v.error }); return; }
    LIFECMD.sendCommand(v.cmd, (status, reply) => sendJson(res, status, reply));
  });
}

// Cancel relay — same shape as capture: validate fail-closed, forward, verdict passthrough.
function handleLifeCancel(req, res) {
  readJsonBody(req, res, 2048, (body) => {
    const v = LIFECMD.validateCancel(body);
    if (!v.ok) { sendJson(res, v.status, { ok: false, error: v.error }); return; }
    LIFECMD.sendCommand(v.cmd, (status, reply) => sendJson(res, status, reply));
  });
}

function handleLifeCommand(req, res) {
  readJsonBody(req, res, 8192, (body) => {
    const v = LIFECMD.validateCommand(body);
    if (!v.ok) { sendJson(res, v.status, { ok: false, error: v.error }); return; }
    LIFECMD.sendCommand(v.cmd, (status, reply) => sendJson(res, status, reply));
  });
}

function readJsonBody(req, res, maxLen, cb) {
  readTextBody(req, res, maxLen, (raw) => {
    let parsed;
    try { parsed = JSON.parse(raw || '{}'); } catch (_) { sendJson(res, 400, { ok: false, error: 'invalid json' }); return; }
    cb(parsed);
  });
}

// A minimal BEGIN/COMMIT/ROLLBACK envelope for the tier-2 write handle (node:sqlite has no helper).
function txWrite(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ } throw e; }
}

// Minimal RFC-4180-ish CSV parser (comma-delimited, "quoted" fields with "" escapes, CRLF/LF rows).
// Returns an array of string-arrays (rows of cells). Tolerant: a trailing newline yields no empty row.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else { field += c; }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

// --- Wave 1 auth handlers (2026-07-31 security remediation) ------------------------------------
function logAuth(kind, extra) {
  // stderr → the coyote-mc-dashboard systemd journal. Login failures + lockouts are operator/Rex-
  // visible here and (durably) in the mc_auth_events table below.
  try { console.error(`[mc-auth] ${kind} ${JSON.stringify(extra || {})}`); } catch (_) { /* never throw from logging */ }
}

// Pure + testable: append one auth security event. Rex reads librarian.db, so a lockout surfaces
// there (the Rex brief line is a paired spine follow-up). Table is created on first write.
function applyAuthEvent(db, kind, fails, nowMs) {
  db.exec('CREATE TABLE IF NOT EXISTS mc_auth_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, fails INTEGER, note TEXT)');
  db.prepare('INSERT INTO mc_auth_events (at, kind, fails, note) VALUES (?, ?, ?, ?)')
    .run(nowMs, String(kind), fails == null ? null : Number(fails), null);
}
function recordAuthEvent(kind, fails) {
  try {
    const opened = openWritableDatabase();
    if (!opened.ok) return;
    try { applyAuthEvent(opened.db, kind, fails, Date.now()); }
    finally { opened.db.close(); }
  } catch (_) { /* a logging failure must never break the auth response */ }
}

function handleLogin(req, res) {
  // A cross-site drive-by must not be able to burn the operator's login attempts and trip the global
  // lockout (an availability attack). The real login page is same-origin (its Origin host matches
  // Host); a CLI client sends no Origin and is allowed. Reject cross-site WITHOUT advancing the counter.
  if (!AUTH.originOk(req)) { sendJson(res, 403, { ok: false, error: 'cross-origin login refused' }); return; }
  const now = Date.now();
  const pre = LOGIN_LIMITER.state(now);
  if (pre.locked) {
    logAuth('lockout-refused', { fails: pre.fails, retryAfterMs: pre.retryAfterMs });
    recordAuthEvent('lockout-refused', pre.fails);
    res.setHeader('Retry-After', String(Math.ceil(pre.retryAfterMs / 1000)));
    sendJson(res, 429, { ok: false, error: 'too many attempts — locked out', retryAfterSeconds: Math.ceil(pre.retryAfterMs / 1000) });
    return;
  }
  readTextBody(req, res, 4096, (raw) => {
    let secret = '';
    try { secret = String((JSON.parse(raw || '{}') || {}).secret || ''); } catch (_) { secret = ''; }
    if (AUTH.checkSecret(secret)) {
      LOGIN_LIMITER.succeed();
      logAuth('login-ok', {});
      res.setHeader('Set-Cookie', AUTH.issueCookie(Date.now()));
      sendJson(res, 200, { ok: true });
      return;
    }
    const r = LOGIN_LIMITER.fail(Date.now());
    logAuth('login-fail', { fails: r.fails, locked: r.locked });
    recordAuthEvent('login-fail', r.fails);
    const finish = () => {
      if (r.locked) {
        res.setHeader('Retry-After', String(Math.ceil(r.retryAfterMs / 1000)));
        sendJson(res, 429, { ok: false, error: 'too many attempts — locked out', retryAfterSeconds: Math.ceil(r.retryAfterMs / 1000) });
      } else {
        sendJson(res, 401, { ok: false, error: 'invalid secret' });
      }
    };
    // Per-failure response slowdown is a minor speed bump only — the GLOBAL lockout (state()/fail()
    // above, threshold in auth.js) is the real brute-force control; it engages regardless of this
    // delay and is enforced on the HTTP path. Skipped when MC_LOGIN_DELAY_MS=0 (tests).
    const delay = Number(process.env.MC_LOGIN_DELAY_MS != null ? process.env.MC_LOGIN_DELAY_MS : 750);
    if (delay > 0) setTimeout(finish, delay); else finish();
  });
}

function serveLoginPage(res) {
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Mission Control — Sign in</title><style>',
    'body{font-family:system-ui,-apple-system,sans-serif;background:#0b0f14;color:#e6edf3;display:grid;place-items:center;min-height:100vh;margin:0}',
    'form{background:#111823;padding:28px;border-radius:14px;border:1px solid #22303f;min-width:280px}',
    'h1{font-size:15px;margin:0 0 14px;letter-spacing:.02em}',
    'input{width:100%;padding:10px;border-radius:8px;border:1px solid #2a3a4d;background:#0b0f14;color:#e6edf3;box-sizing:border-box}',
    'button{margin-top:12px;width:100%;padding:10px;border:0;border-radius:8px;background:#2f7cff;color:#fff;font-weight:600;cursor:pointer}',
    '.err{color:#ff6b6b;font-size:12px;margin-top:10px;min-height:14px}</style></head><body>',
    '<form id="f"><h1>Mission Control</h1>',
    '<input id="s" type="password" placeholder="operator secret" autocomplete="current-password" autofocus>',
    '<button>Sign in</button><div class="err" id="e"></div></form><script>',
    "var f=document.getElementById('f'),s=document.getElementById('s'),e=document.getElementById('e');",
    "f.onsubmit=async function(ev){ev.preventDefault();e.textContent='';",
    "var r=await fetch('/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:s.value})});",
    "if(r.ok){location.href='/';}else if(r.status===429){e.textContent='Too many attempts — locked out. Wait, then retry.';}else{e.textContent='Invalid secret.';}};",
    '</script></body></html>',
  ].join('');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatUtc(ms) {
  if (!ms) {
    return 'unknown';
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function formatInteger(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(toInteger(value));
}

function formatGbp(pence) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
  }).format(toInteger(pence) / 100);
}

function formatUsd(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value));
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function css() {
  return `
    @font-face{font-family:'Oswald';font-style:normal;font-weight:400;font-display:swap;src:url('/static/fonts/oswald-latin-400-normal.woff2') format('woff2')}
    @font-face{font-family:'Oswald';font-style:normal;font-weight:500;font-display:swap;src:url('/static/fonts/oswald-latin-500-normal.woff2') format('woff2')}
    @font-face{font-family:'Oswald';font-style:normal;font-weight:700;font-display:swap;src:url('/static/fonts/oswald-latin-700-normal.woff2') format('woff2')}
    @font-face{font-family:'Barlow';font-style:normal;font-weight:300;font-display:swap;src:url('/static/fonts/barlow-latin-300-normal.woff2') format('woff2')}
    @font-face{font-family:'Barlow';font-style:normal;font-weight:400;font-display:swap;src:url('/static/fonts/barlow-latin-400-normal.woff2') format('woff2')}
    @font-face{font-family:'Barlow';font-style:normal;font-weight:500;font-display:swap;src:url('/static/fonts/barlow-latin-500-normal.woff2') format('woff2')}
    @font-face{font-family:'Barlow';font-style:normal;font-weight:700;font-display:swap;src:url('/static/fonts/barlow-latin-700-normal.woff2') format('woff2')}
    @font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400;font-display:swap;src:url('/static/fonts/jetbrains-mono-latin-400-normal.woff2') format('woff2')}
    @font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:500;font-display:swap;src:url('/static/fonts/jetbrains-mono-latin-500-normal.woff2') format('woff2')}
    @font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:700;font-display:swap;src:url('/static/fonts/jetbrains-mono-latin-700-normal.woff2') format('woff2')}
    :root{
      --void:#070B14; --navy:#0C1322; --panel:#121C30; --elevated:#1A2740;
      --line:rgba(120,150,200,.10); --line-strong:rgba(120,150,200,.18);
      --steel:#5B6B86; --ash:#8A9AB5; --mist:#C9D3E3; --bright:#EAF0FA;
      --amber:#F5A623; --amber-glow:rgba(245,166,35,.14);
      --green:#34D399; --green-dim:rgba(52,211,153,.12);
      --red:#F2555A; --red-dim:rgba(242,85,90,.12);
      --idle:#3D4A63;
      --display:'Oswald','Barlow Condensed',sans-serif;
      --body:'Barlow','DM Sans',sans-serif;
      --mono:'JetBrains Mono','IBM Plex Mono',monospace;
      --xs:.75rem; --sm:.875rem; --base:1rem; --lg:1.25rem; --xl:1.5rem; --2xl:2rem;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{
      background:var(--void); color:var(--mist); font-family:var(--body);
      font-size:var(--base); line-height:1.45; padding:1.25rem 1.5rem 3rem;
      -webkit-font-smoothing:antialiased;
    }
    body::before{content:'';position:fixed;inset:0;opacity:.035;pointer-events:none;z-index:9999;
      background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
    .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
    .fade{opacity:0;transform:translateY(10px);animation:rev .4s ease-out forwards}
    @keyframes rev{to{opacity:1;transform:none}}
    .fade:nth-child(1){animation-delay:.04s}.fade:nth-child(2){animation-delay:.09s}
    .fade:nth-child(3){animation-delay:.14s}.fade:nth-child(4){animation-delay:.19s}
    .fade:nth-child(5){animation-delay:.24s}
    header{display:flex;align-items:center;gap:1rem;padding-bottom:1.1rem;border-bottom:1px solid var(--line-strong);margin-bottom:1.4rem}
    .mark{flex:0 0 auto}
    .wordmark{display:flex;flex-direction:column;line-height:1}
    .wordmark .t{font-family:var(--display);font-weight:700;font-size:var(--lg);letter-spacing:.18em;color:var(--bright);text-transform:uppercase}
    .wordmark .s{font-family:var(--mono);font-size:var(--xs);color:var(--steel);letter-spacing:.22em;margin-top:.35rem;text-transform:uppercase}
    .sys{margin-left:auto;display:flex;gap:1.4rem;align-items:center}
    .sysitem{display:flex;flex-direction:column;align-items:flex-end;gap:.2rem}
    .sysitem .k{font-family:var(--mono);font-size:.62rem;letter-spacing:.16em;color:var(--steel);text-transform:uppercase}
    .sysitem .v{font-family:var(--mono);font-size:var(--sm);color:var(--mist)}
    .pulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 0 var(--amber-glow);animation:pl 1.8s ease-out infinite;margin-right:.4rem;vertical-align:middle}
    @keyframes pl{0%{box-shadow:0 0 0 0 rgba(245,166,35,.5)}70%{box-shadow:0 0 0 9px rgba(245,166,35,0)}100%{box-shadow:0 0 0 0 rgba(245,166,35,0)}}
    .seal{font-family:var(--mono);font-size:var(--xs);color:var(--green);border:1px solid var(--green-dim);background:var(--green-dim);padding:.2rem .5rem;border-radius:4px;letter-spacing:.08em}
    .banner{margin-bottom:1rem;border:1px solid var(--red-dim);background:var(--red-dim);color:var(--red);border-radius:8px;padding:.75rem 1rem;font-family:var(--mono);font-size:var(--xs)}
    .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;margin-bottom:1.4rem}
    .kpi{background:rgba(255,255,255,.025);border:1px solid var(--line);border-left:3px solid var(--steel);border-radius:8px;padding:.85rem 1rem;display:flex;flex-direction:column;gap:.3rem}
    .kpi.live{border-left-color:var(--amber)}
    .kpi.good{border-left-color:var(--green)}
    .kpi .lab{font-family:var(--display);font-size:var(--xs);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--steel)}
    .kpi .val{font-family:var(--mono);font-size:var(--2xl);font-weight:700;color:var(--bright);line-height:1}
    .kpi .stage-val{font-size:1.3rem}
    .kpi .sub{font-family:var(--mono);font-size:var(--xs);color:var(--ash)}
    .kpi .sub.g{color:var(--green)}
    .grid{display:grid;grid-template-columns:1.8fr 1fr;gap:1rem;align-items:start}
    @media(max-width:980px){.grid{grid-template-columns:1fr}}
    .panel{background:var(--navy);border:1px solid var(--line);border-radius:10px;overflow:hidden}
    .phead{display:flex;align-items:center;gap:.6rem;padding:.8rem 1.1rem;border-bottom:1px solid var(--line)}
    .phead h2{font-family:var(--display);font-weight:700;font-size:var(--sm);letter-spacing:.12em;text-transform:uppercase;color:var(--mist)}
    .phead .count{margin-left:auto;font-family:var(--mono);font-size:var(--xs);color:var(--steel)}
    .pbody{padding:.4rem 0}
    /* §reviews action queue (Step 2) */
    .aq-alert{margin:.6rem 1.1rem;border:1px solid var(--red);background:var(--red-dim);color:var(--red);border-radius:8px;padding:.6rem .8rem;font-family:var(--mono);font-size:var(--xs);font-weight:700;line-height:1.4}
    .aq-alert-tail{color:var(--ash);font-weight:400}
    .aq-grain{padding:.3rem 1.1rem;font-size:var(--xs);color:var(--mist)}
    .aq-rising{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;padding:.2rem 1.1rem .5rem}
    .aq-rising-lab{font-family:var(--display);font-size:.6rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--steel);margin-right:.3rem}
    .aq-chip{font-family:var(--mono);font-size:var(--xs);color:var(--amber);border:1px solid var(--amber-glow);background:var(--amber-glow);border-radius:999px;padding:.18rem .55rem;cursor:pointer}
    .aq-chip:hover{border-color:var(--amber)}
    .aq-chip-all{color:var(--steel);border-color:var(--line);background:transparent}
    .aq-cards{display:flex;flex-direction:column;gap:.7rem;padding:.4rem 1.1rem 1rem}
    .aq-card{border:1px solid var(--line);border-left:3px solid var(--steel);border-radius:8px;background:rgba(255,255,255,.02);padding:.7rem .85rem;display:flex;flex-direction:column;gap:.5rem}
    .aq-card.b-google{border-left-color:#4285F4}
    .aq-card.b-ta{border-left-color:#34E0A1}
    .aq-card.b-ot{border-left-color:#DA3743}
    .aq-top{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap}
    .aq-badge{font-family:var(--display);font-weight:700;font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;padding:.16rem .5rem;border-radius:4px}
    .aq-badge.b-google{background:#4285F4;color:#fff}
    .aq-badge.b-ta{background:#34E0A1;color:#06281d}
    .aq-badge.b-ot{background:#DA3743;color:#fff}
    .aq-badge.b-unknown{background:var(--steel);color:var(--void)}
    .aq-stars{color:var(--amber);font-size:var(--sm);letter-spacing:.04em}
    .aq-who{font-family:var(--body);font-weight:600;color:var(--bright);font-size:var(--sm)}
    .aq-date{margin-left:auto;color:var(--steel);font-size:var(--xs)}
    .aq-text{color:var(--mist);font-size:var(--sm);line-height:1.45}
    .aq-tags{display:flex;flex-wrap:wrap;gap:.3rem}
    .aq-tag{font-family:var(--mono);font-size:.66rem;color:var(--ash);border:1px solid var(--line);background:transparent;border-radius:4px;padding:.1rem .4rem;cursor:pointer}
    .aq-tag:hover{border-color:var(--steel);color:var(--mist)}
    .aq-draft{border:1px solid var(--line);border-radius:6px;background:rgba(52,211,153,.05)}
    .aq-draft-label{font-family:var(--display);font-size:.58rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--green);padding:.4rem .6rem .15rem}
    .aq-draft-body{font-family:var(--body);font-size:var(--sm);color:var(--mist);padding:0 .6rem .55rem;white-space:pre-wrap;line-height:1.5}
    .aq-flag{color:var(--amber);font-size:var(--xs);font-family:var(--mono)}
    .aq-actions{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center}
    .aq-btn{font-family:var(--mono);font-size:var(--xs);color:var(--mist);background:var(--elevated);border:1px solid var(--line-strong);border-radius:6px;padding:.32rem .7rem;cursor:pointer;text-decoration:none;display:inline-block}
    .aq-btn:hover{border-color:var(--steel)}
    .aq-respond{color:var(--green);border-color:var(--green-dim)}
    .aq-state{margin-left:auto;color:var(--steel);font-size:var(--xs);font-family:var(--mono)}
    .stack{display:flex;flex-direction:column;gap:1rem}
    .heroes{display:grid;grid-template-columns:1fr;gap:.7rem;padding:.9rem 1.1rem}
    .hero{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:.9rem 1rem;display:flex;flex-direction:column;gap:.55rem}
    .hero.active{border-color:var(--amber-glow);box-shadow:inset 3px 0 0 var(--amber)}
    .hero.stale{border-color:var(--red-dim);box-shadow:inset 3px 0 0 var(--red)}
    .hero .row1{display:flex;align-items:center;gap:.6rem}
    .hero .row1 .pill{margin-left:auto}
    .hero .name{font-family:var(--display);font-weight:700;letter-spacing:.06em;color:var(--bright);text-transform:uppercase;font-size:var(--sm)}
    .hero .meta,.token-live{display:flex;gap:1.2rem;flex-wrap:wrap}
    .hero .meta .m,.token-live>div{display:flex;flex-direction:column;gap:.15rem}
    .hero .meta .mk,.token-live .mk{font-family:var(--mono);font-size:.6rem;letter-spacing:.14em;color:var(--steel);text-transform:uppercase}
    .hero .meta .mv,.token-live .mv{font-family:var(--mono);font-size:var(--sm);color:var(--mist)}
    .bar{height:5px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden}
    .bar>i{display:block;height:100%;background:var(--amber)}
    .pill{font-family:var(--mono);font-size:.66rem;font-weight:500;letter-spacing:.06em;padding:.18rem .5rem;border-radius:4px;text-transform:uppercase;white-space:nowrap}
    .p-build{color:var(--amber);background:var(--amber-glow)}
    .p-merged{color:var(--green);background:var(--green-dim)}
    .p-refused{color:var(--red);background:var(--red-dim)}
    .p-queued{color:var(--ash);background:rgba(120,150,200,.08)}
    .deploy-summary{padding:.9rem 1.1rem;border-bottom:1px solid var(--line)}
    .deploy-indicator{font-family:var(--display);font-weight:700;letter-spacing:.14em;text-transform:uppercase}
    .deploy-indicator--ok{color:var(--green)}
    .deploy-summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem}
    .deploy-summary-grid>div{display:flex;flex-direction:column;gap:.2rem}
    .deploy-summary-grid .mk,.deploy-subhead{font-family:var(--mono);font-size:.6rem;letter-spacing:.14em;color:var(--steel);text-transform:uppercase}
    .deploy-summary-grid .mv{font-size:var(--sm);color:var(--mist)}
    .deploy-pending{padding:.8rem 1.1rem;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:.5rem}
    .deploy-row{display:flex;align-items:center;justify-content:space-between;gap:.8rem;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:.55rem .65rem}
    .deploy-row--pending{border-color:var(--amber-glow)}
    .deploy-history td:first-child{color:var(--ash)}
    .deploy-status-pill{font-family:var(--mono);font-size:.66rem;font-weight:500;letter-spacing:.06em;padding:.18rem .5rem;border-radius:4px;text-transform:uppercase;white-space:nowrap}
    .deploy-status-pill--success{color:var(--green);background:var(--green-dim)}
    .deploy-status-pill--pending{color:var(--ash);background:rgba(120,150,200,.08)}
    .deploy-status-pill--active{color:var(--amber);background:var(--amber-glow)}
    .deploy-status-pill--danger{color:var(--red);background:var(--red-dim)}
    .deploy-status-pill--muted{color:var(--steel);background:rgba(120,150,200,.06)}
    table{width:100%;border-collapse:collapse}
    th{font-family:var(--display);font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--steel);text-align:left;padding:.6rem 1.1rem;border-bottom:1px solid var(--line)}
    td{padding:.62rem 1.1rem;border-bottom:1px solid rgba(120,150,200,.05);font-size:var(--sm);color:var(--mist);vertical-align:middle}
    tr:last-child td{border-bottom:none}
    tbody tr:hover{background:rgba(255,255,255,.018)}
    td.id,td.age,td.eng,td.ref{font-family:var(--mono);font-size:var(--xs)}
    td.id{color:var(--ash)}
    td.age{color:var(--steel);white-space:nowrap}
    td.eng{color:var(--steel)}
    td.ref{color:var(--ash)}
    .title{color:var(--bright)}
    .stage.p-build{background:transparent}.stage.p-merged{background:transparent}.stage.p-refused{background:transparent}.stage.p-queued{background:transparent}
    .spend{padding:.9rem 1.1rem;display:flex;flex-direction:column;gap:.7rem}
    .spend .line{display:flex;align-items:center;justify-content:space-between;gap:1rem;font-size:var(--sm)}
    .spend .line .l{color:var(--ash)}
    .spend .line .r{font-family:var(--mono);color:var(--mist)}
    .spend .line.excl .l,.spend .line.excl .r{color:var(--steel)}
    .spend .tot{border-top:1px solid var(--line);padding-top:.7rem;display:flex;justify-content:space-between;gap:1rem}
    .spend .tot .l{font-family:var(--display);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mist);font-size:var(--sm)}
    .spend .tot .r{font-family:var(--mono);font-weight:700;color:var(--bright);font-size:var(--lg)}
    .cap{height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:.2rem}
    .cap>i{display:block;height:100%;background:var(--green)}
    .cap>i.warn50{background:var(--amber)}.cap>i.warn80,.cap>i.hardstop{background:var(--red)}
    .note{font-family:var(--mono);font-size:var(--xs);color:var(--steel);line-height:1.5}
    .token-live{padding:.9rem 1.1rem;border-bottom:1px solid var(--line)}
    .token-note{padding:.8rem 1.1rem;border-bottom:1px solid var(--line)}
    .empty{padding:2.2rem 1.1rem;display:flex;flex-direction:column;align-items:center;gap:.9rem;text-align:center}
    .empty .glyph{opacity:.35}
    .empty .h{font-family:var(--display);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ash);font-size:var(--sm)}
    .empty .p{font-family:var(--mono);font-size:var(--xs);color:var(--steel);max-width:32ch;line-height:1.6}
    .events{padding:.5rem 0}
    .ev{display:grid;grid-template-columns:54px 18px 1fr;gap:.6rem;padding:.55rem 1.1rem;border-bottom:1px solid rgba(120,150,200,.05);align-items:start}
    .ev:last-child{border-bottom:none}
    .ev .ts{font-family:var(--mono);font-size:var(--xs);color:var(--steel)}
    .ev .dot{width:8px;height:8px;border-radius:50%;margin-top:.35rem}
    .ev.ok .dot{background:var(--green)} .ev.bad .dot{background:var(--red)} .ev.info .dot{background:var(--amber)}
    .ev .body .m{font-size:var(--sm);color:var(--mist)}
    .ev .body .m b{font-family:var(--mono);font-size:var(--xs);color:var(--ash);font-weight:400}
    .ev .body .corr{font-family:var(--mono);font-size:var(--xs);color:var(--amber);margin-top:.25rem;padding-left:.6rem;border-left:2px solid var(--amber-glow)}
    .warnings{margin:.75rem 1.1rem;padding:.65rem .8rem .65rem 1.4rem;border:1px solid var(--amber-glow);border-radius:8px;color:var(--amber);background:rgba(245,166,35,.06);font-family:var(--mono);font-size:var(--xs)}
    .unavailable{border-color:var(--amber-glow)}
    .unavailable-note{padding:.9rem 1.1rem}
    .empty-row{padding:.9rem 1.1rem;color:var(--steel);font-family:var(--mono);font-size:var(--xs)}
    footer{margin-top:2rem;font-family:var(--mono);font-size:var(--xs);color:var(--steel);text-align:center;letter-spacing:.08em}
    @media(max-width:720px){
      body{padding:1rem}
      header{align-items:flex-start;flex-wrap:wrap}
      .sys{width:100%;margin-left:0;justify-content:space-between;gap:.75rem}
      .sysitem{align-items:flex-start}
      table{min-width:680px}
      .table-wrap{overflow-x:auto}
    }
  `;
}

if (require.main === module) {
  main();
}

module.exports = {
  reportRawResponse,
  fileDownloadResponse: EXPORTS.fileDownloadResponse,
  listExports: EXPORTS.listExports,
  buildDashboardModel,
  buildHaltModel,
  renderDashboard,
  getKpiSection,
  countTestIntegrity,
  summarizeDetail,
  summarizeTestRun,
  summarizeLeadDecision,
  classifyGateEvent,
  eventTone,
  isRefusedEvent,
  getMonthStartMs,
  formatUtc,
  formatJobAge,
  formatCount,
  buildDeployModel,
  deployStatusPillClass,
  statusPillClass,
  stageProgressPercent,
  deriveEngine,
  deriveRef,
  deriveStage,
  buildWorkerModel,
  getWorkerSection,
  renderWorker,
  getReviewsSection,
  renderReviews,
  applyReviewAction,
  REVIEW_ACTION_OPS,
  applyRecipeAction,
  applyRecipeImport,
  RECIPE_ACTION_OPS,
  buildRecipeTemplate,
  parseCsv,
  spendLevel,
  applyChatMessage,
  applyForecastOverride,
  chatUpdates,
  handleRequest,
  applyAuthEvent,
  __resetAuthLimiter: () => { LOGIN_LIMITER = AUTH.createLoginLimiter(); },
};
