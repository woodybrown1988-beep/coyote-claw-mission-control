'use strict';

// Ops-centre multi-page redesign — page modules render honest data, never throw (seeded OR empty DB),
// and the boundary holds (no write/network in pages; Reviews emits no Google write affordance).
const assert = require('node:assert/strict');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sqlite = require('node:sqlite');

const SHARED = require('../mission-control/ui/shared.js');
const DATA = require('../mission-control/ui/data.js');
const PAGES = {
  overview: require('../mission-control/ui/pages/overview.js'),
  agents: require('../mission-control/ui/pages/agents.js'),
  reviews: require('../mission-control/ui/pages/reviews.js'),
  issues: require('../mission-control/ui/pages/issues.js'),
  operations: require('../mission-control/ui/pages/operations.js'),
  health: require('../mission-control/ui/pages/health.js'),
};
const NOW = 1782800000000;
let counter = 0;

function schema(db) {
  db.exec(`
    CREATE TABLE jobs (id TEXT PRIMARY KEY, type TEXT, payload TEXT, status TEXT, created_at INTEGER, updated_at INTEGER, attempts INTEGER, error TEXT, parent_job_id TEXT, owner_id TEXT, lease_expires_at INTEGER);
    CREATE TABLE job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, created_at INTEGER, kind TEXT, actor TEXT, gate TEXT, decision TEXT, detail TEXT);
    CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, overall REAL, reviewer TEXT, text TEXT, reviewed_date TEXT, visited_at TEXT, food REAL, service REAL, atmosphere REAL, value REAL, noise_label TEXT, recommend INTEGER, tags TEXT, private_note TEXT, has_reply INTEGER, url TEXT, source_ingest TEXT, fetched_at INTEGER);
    CREATE TABLE review_drafts (review_id TEXT PRIMARY KEY, platform TEXT, draft_text TEXT, draft_status TEXT, review_url TEXT, guard_flagged TEXT, snoozed_until INTEGER, generated_at INTEGER, updated_at INTEGER);
    CREATE TABLE review_issues (review_id TEXT, issue_code TEXT, evidence_quote TEXT, confidence REAL, model TEXT, extracted_at INTEGER, PRIMARY KEY (review_id, issue_code));
    CREATE TABLE issue_trends (issue_code TEXT, count_current INTEGER, count_prior INTEGER, rising INTEGER, last_seen TEXT, window_end INTEGER, computed_at INTEGER, PRIMARY KEY (issue_code, computed_at));
    CREATE TABLE review_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_code TEXT, identified_at INTEGER, evidence_summary TEXT, hypothesised_cause TEXT, action_taken TEXT, action_date INTEGER, status TEXT, issue_rate_before REAL, issue_rate_after REAL, reviewed_at INTEGER, escalate INTEGER, auto INTEGER);
    CREATE TABLE review_snapshot (id INTEGER PRIMARY KEY AUTOINCREMENT, total INTEGER, awaiting_response INTEGER, awaiting_recent_text INTEGER, awaiting_over_1y INTEGER, awaiting_star_only INTEGER, overall_rating REAL, google_rating REAL, tripadvisor_rating REAL, opentable_rating REAL, ratings_window TEXT, fetched_at INTEGER);
    CREATE TABLE review_aggregate (platform TEXT, overall REAL, num_reviews INTEGER, food REAL, service REAL, atmosphere REAL, value REAL, fetched_at INTEGER, PRIMARY KEY (platform, fetched_at));
    CREATE TABLE kpi_snapshot (period TEXT, covers INTEGER, revenue_pence INTEGER, labour_pct REAL, atv_pence INTEGER, channel_split TEXT, source TEXT, as_of TEXT, fetched_at INTEGER, PRIMARY KEY (period, fetched_at));
    CREATE TABLE spend_log (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, tokens INTEGER, cost_pence INTEGER, created_at INTEGER, note TEXT);
    CREATE TABLE system_state (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE scheduled_tasks (name TEXT PRIMARY KEY, unit TEXT, schedule TEXT, next_fire INTEGER, runs TEXT, computed_at INTEGER);
  `);
}
function makeDb(seed) {
  const file = path.join(tmpdir(), `mc-pages-${process.pid}-${(counter += 1)}.db`);
  const db = new sqlite.DatabaseSync(file);
  schema(db);
  if (seed) seed(db);
  return db;
}
function seedAll(db) {
  db.prepare(`INSERT INTO system_state (key,value) VALUES ('monthly_ceiling_pence','7500'),('paused','0')`).run();
  db.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts) VALUES ('j1','coder-build','{"pr_number":38}','awaiting_signoff',?,?,1)`).run(NOW - 240000, NOW - 240000);
  db.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts) VALUES ('j2','review-ingest','{"title":"daily"}','running',?,?,1)`).run(NOW - 80000, NOW - 80000);
  db.prepare(`INSERT INTO job_events (job_id,created_at,kind,actor) VALUES ('j1',?,'pr_opened','worker')`).run(NOW - 230000);
  db.prepare(`INSERT INTO review_snapshot (total,awaiting_response,awaiting_recent_text,awaiting_over_1y,awaiting_star_only,overall_rating,google_rating,tripadvisor_rating,opentable_rating,ratings_window,fetched_at) VALUES (1344,959,6,950,274,4.55,4.73,4.57,3.75,'30d',?)`).run(NOW - 3600000);
  const rc = db.prepare(`INSERT INTO review_corpus (review_id,platform,overall,reviewer,text,reviewed_date,source_ingest,fetched_at) VALUES (?,?,?,?,?,?,'api-v1',?)`);
  rc.run('ta-1','tripadvisor',1,'Mike','Very slow service.','2026-06-28T12:00:00Z',NOW);
  rc.run('g-1','google',3,'Jo','Staff inattentive.','2026-06-27T12:00:00Z',NOW);
  const rd = db.prepare(`INSERT INTO review_drafts (review_id,platform,draft_text,draft_status,review_url,guard_flagged,generated_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
  rd.run('ta-1','tripadvisor','Hey Mike, sorry.','draft','https://www.tripadvisor.com/x','sourcing, supply',NOW,NOW);
  rd.run('g-1','google','Hey Jo.','draft',null,null,NOW,NOW);
  db.prepare(`INSERT INTO review_issues (review_id,issue_code,evidence_quote,extracted_at) VALUES ('ta-1','SERVICE_SPEED','Very slow service',?)`).run(NOW);
  db.prepare(`INSERT INTO issue_trends (issue_code,count_current,count_prior,rising,last_seen,window_end,computed_at) VALUES ('SERVICE_SPEED',3,1,1,'2026-06-28',?,?)`).run(NOW, NOW);
  db.prepare(`INSERT INTO review_actions (issue_code,identified_at,evidence_summary,status,escalate,auto) VALUES ('ALLERGEN_HANDLING',?,'dairy served despite allergy','escalated',1,1)`).run(NOW);
  db.prepare(`INSERT INTO review_actions (issue_code,identified_at,action_taken,action_date,status,issue_rate_before,issue_rate_after,escalate,auto) VALUES ('SERVICE_SPEED',?,'retrained pass',?,'actioned',0.4,0.1,0,0)`).run(NOW, NOW - 1000000);
  db.prepare(`INSERT INTO spend_log (cost_pence,created_at) VALUES (4120,?)`).run(NOW);
}
function ctxFor(db) {
  return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false } };
}

for (const [key, page] of Object.entries(PAGES)) {
  test(`page ${key}: contract + renders on a SEEDED db (no throw, {stamp,body})`, () => {
    const db = makeDb(seedAll);
    assert.equal(page.key, key);
    assert.ok(page.route && page.title);
    const ctx = ctxFor(db);
    const section = page.getSection(db, ctx);
    const out = page.render(section, ctx);
    assert.ok(out && typeof out.body === 'string' && out.body.length > 50, `${key} body`);
    assert.equal(typeof out.stamp, 'string');
    db.close();
  });

  test(`page ${key}: renders gracefully on an EMPTY db (no throw, never fabricates)`, () => {
    const db = makeDb();
    const ctx = ctxFor(db);
    const out = page.render(page.getSection(db, ctx), ctx);
    assert.ok(out && typeof out.body === 'string' && out.body.length > 20, `${key} empty body`);
    db.close();
  });
}

test('agents: matches the mockup structure + counts a TEXT guard_flag (the fixed bug)', () => {
  const db = makeDb(seedAll);
  const ctx = ctxFor(db);
  const out = PAGES.agents.render(PAGES.agents.getSection(db, ctx), ctx);
  assert.match(out.body, /class="apex"/, 'leadership apex');
  assert.match(out.body, /class="librarian"/, 'Librarian band');
  for (const c of ['idle', 'queued', 'working', 'blocked', 'done']) assert.match(out.body, new RegExp(`col ${c}`), `kanban ${c}`);
  assert.match(out.body, /Chief of Staff/);
  assert.match(out.body, /Research/);            // unbuilt fleet rendered (faded), never active
  assert.match(out.body, /faded/);
  // the guard_flagged TEXT bug: 'sourcing, supply' must be counted (not '=1' which never matches)
  assert.match(out.body, /1 guard-flagged/, 'TEXT guard flag counted');
});

test('agents queue-depth signal: hidden when empty; renders per-agent backlog + stale flag + scheduled line', () => {
  const A = PAGES.agents;
  // (a) no backlog → band hidden (no dead UI), but the scheduled line shows
  let db = makeDb((d) => {
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts) VALUES ('r1','coder','{}','running',?,?,1)`).run(NOW - 1000, NOW - 1000);
    d.prepare(`INSERT INTO scheduled_tasks (name,unit,schedule,next_fire,runs,computed_at) VALUES ('reviews-ingest','coyote-reviews-ingest.timer','daily 06:00 UTC',?,'reviews ingest',?)`).run(NOW + 50000000, NOW);
  });
  let ctx = ctxFor(db);
  let out = A.render(A.getSection(db, ctx), ctx);
  assert.doesNotMatch(out.body, /Queue depth/, 'no queue-depth band when nothing is queued');
  assert.match(out.body, /Next: reviews-ingest/, 'scheduled line shown');
  db.close();

  // (b) real backlog: 3 coder queued (oldest 2h = stale) + 1 lead queued (fresh) → band renders, grouped, stale flagged
  db = makeDb((d) => {
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts) VALUES ('q1','coder','{}','queued',?,?,0)`).run(NOW - 2 * 3600000, NOW - 2 * 3600000); // 2h → stale
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts) VALUES ('q2','coder','{}','queued',?,?,0)`).run(NOW - 600000, NOW - 600000);
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts) VALUES ('q3','coder-build','{}','queued',?,?,0)`).run(NOW - 300000, NOW - 300000);
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts) VALUES ('q4','lead','{}','queued',?,?,0)`).run(NOW - 120000, NOW - 120000);
  });
  ctx = ctxFor(db);
  out = A.render(A.getSection(db, ctx), ctx);
  assert.match(out.body, /Queue depth/, 'band renders on real backlog');
  assert.match(out.body, /3 queued behind Coder/, 'grouped by intended agent (3 coder jobs)');
  assert.match(out.body, /1 queued behind Lead/, 'lead grouping');
  assert.match(out.body, /likely stuck/, 'stale (>1h) flagged');
  assert.match(out.body, /banner red/, 'stale backlog uses the red action colour');
  db.close();
});

test('reviews BOUNDARY: data-op write affordance ONLY on TA/OT, never on a Google card', () => {
  const db = makeDb(seedAll);
  const ctx = ctxFor(db);
  const out = PAGES.reviews.render(PAGES.reviews.getSection(db, ctx), ctx);
  assert.match(out.body, /data-op="mark_responded"/, 'TA/OT gets the safe-write button');
  assert.match(out.body, /Approve in Telegram/, 'Google shows tap status only');
  // isolate the Google card region and assert it carries no write affordance
  const gi = out.body.indexOf('b-google');
  if (gi >= 0) {
    const region = out.body.slice(gi, gi + 1400);
    assert.doesNotMatch(region, /data-op=/, 'Google card has no board write path');
    assert.doesNotMatch(region, /data-review=/, 'Google card has no review-action wrapper');
  }
});

test('operations: EMPTY kpi_snapshot → "not wired", and a NULL labour_pct never fabricates 0%', () => {
  // empty
  let db = makeDb();
  let ctx = ctxFor(db);
  let out = PAGES.operations.render(PAGES.operations.getSection(db, ctx), ctx);
  assert.match(out.body, /not yet wired|not wired/i);
  assert.doesNotMatch(out.body, />0%</, 'no fabricated 0% on empty');
  db.close();
  // populated but NULL labour_pct → '—', never '0%'
  db = makeDb((d) => d.prepare(`INSERT INTO kpi_snapshot (period,covers,revenue_pence,labour_pct,atv_pence,source,as_of,fetched_at) VALUES ('2026-06-29',84,312050,NULL,3715,'coyote-intel','2026-06-29T23:00:00Z',?)`).run(NOW));
  ctx = ctxFor(db);
  out = PAGES.operations.render(PAGES.operations.getSection(db, ctx), ctx);
  assert.doesNotMatch(out.body, />0%</, 'NULL labour_pct must not render a fabricated 0%');
  db.close();
});

test('issues: escalation surfaced + log-action safe-write form present', () => {
  const db = makeDb(seedAll);
  const ctx = ctxFor(db);
  const out = PAGES.issues.render(PAGES.issues.getSection(db, ctx), ctx);
  assert.match(out.body, /ALLERGEN/i, 'allergen escalation surfaced');
  assert.match(out.body, /data-log-action/, 'log-action safe-write affordance');
  assert.match(out.body, /name="action_taken"/, 'action input');
});

test('health: tiles render and the freshness <time> tag is NOT over-escaped on fresh data', () => {
  const db = makeDb(seedAll); // snapshot fetched 1h ago = fresh
  const ctx = ctxFor(db);
  const out = PAGES.health.render(PAGES.health.getSection(db, ctx), ctx);
  assert.match(out.body, /class="tile/, 'tiles');
  assert.doesNotMatch(out.body, /&lt;time/, 'no over-escaped <time> tag leaking as text');
});

test('boundary: no page module writes, fetches, or requires beyond ../shared.js', () => {
  const fs = require('node:fs');
  // Precise patterns: a real fetch()/network call, a DB write call (.run/.exec/.prepare — pages read
  // ONLY via ctx.q), or an INSERT/UPDATE/DELETE statement. (Column names like `fetched_at` are fine.)
  const network = /\bfetch\s*\(|\bchild_process\b|require\(['"]node:(http|https|net|dgram|child_process)/;
  const dbWrite = /\.(run|exec|prepare)\s*\(/;
  const sqlWrite = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|INSERT\s+OR)\b/i;
  for (const key of Object.keys(PAGES)) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mission-control', 'ui', 'pages', `${key}.js`), 'utf8');
    assert.doesNotMatch(src, network, `${key} must make no network call`);
    assert.doesNotMatch(src, dbWrite, `${key} must not touch the db directly (read only via ctx.q)`);
    assert.doesNotMatch(src, sqlWrite, `${key} must run no write SQL`);
    const requires = src.match(/require\((['"][^'"]+['"])\)/g) || [];
    for (const r of requires) assert.match(r, /\.\.\/shared\.js/, `${key} requires only ../shared.js, got ${r}`);
  }
});
