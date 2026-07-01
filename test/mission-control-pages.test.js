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
  recipes: require('../mission-control/ui/pages/recipes.js'),
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
    CREATE TABLE worker_heartbeat (owner_id TEXT PRIMARY KEY, last_beat_at INTEGER, job_id TEXT, phase TEXT, updated_at INTEGER, worker_name TEXT);
    CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, supplier TEXT, pack_description TEXT, pack_cost_pence INTEGER, pack_qty REAL, unit_of_measure TEXT, cost_source TEXT DEFAULT 'manual', updated_at INTEGER);
    CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT UNIQUE, name TEXT, category TEXT, updated_at INTEGER);
    CREATE TABLE recipe_lines (product_id TEXT, sub_item_id TEXT, quantity REAL, updated_at INTEGER, PRIMARY KEY (product_id, sub_item_id));
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

test('agents: renders ONE card per NAMED Coder worker (coder-1 idle + coder-2 working), not a collapsed "Coder"', () => {
  const db = makeDb((d) => {
    // two live workers beating their STABLE names — idle-aware: coder-1 idle (no job), coder-2 building
    const hb = d.prepare(`INSERT INTO worker_heartbeat (owner_id,last_beat_at,job_id,phase,updated_at,worker_name) VALUES (?,?,?,?,?,?)`);
    hb.run('box:10:1782800000000', NOW - 10000, null, 'idle', NOW - 10000, 'coder-1');
    hb.run('box:11:1782800000001', NOW - 10000, 'jb', 'build', NOW - 10000, 'coder-2');
    // coder-2's in-flight job (owned by coder-2's heartbeat owner_id) → its card shows Working
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts,owner_id) VALUES ('jb','coder-build','{"pr_number":51}','running',?,?,1,'box:11:1782800000001')`).run(NOW - 60000, NOW - 60000);
  });
  const ctx = ctxFor(db);
  const out = PAGES.agents.render(PAGES.agents.getSection(db, ctx), ctx);
  // BOTH workers visible BY NAME — the whole point: two Coders, not one collapsed card
  assert.match(out.body, /coder-1/, 'idle worker shown present (the beat fires even when idle)');
  assert.match(out.body, /coder-2/, 'working worker shown by its name');
  assert.match(out.body, /col working/, 'coder-2 sits in the Working column with its job');
  // honest: a name fallback never fabricates — both are real WORKER_NAMEs here
  assert.doesNotMatch(out.body, /\bcoder-worker\b/, 'never the old collapsed label');
  db.close();
});

test('agents: NO heartbeat rows → degrades to in-flight coder jobs by owner (never hides work)', () => {
  const db = makeDb((d) => {
    // a real in-flight coder gate but no heartbeat yet (the honest in-between before workers restart)
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts,owner_id) VALUES ('jx','coder-build','{"pr_number":7}','awaiting_signoff',?,?,1,'box:9:1782800000000')`).run(NOW - 60000, NOW - 60000);
  });
  const ctx = ctxFor(db);
  const out = PAGES.agents.render(PAGES.agents.getSection(db, ctx), ctx);
  assert.match(out.body, /box:9/, 'owner with no fresh beat still shown by host:pid — work never hidden');
  assert.match(out.body, /col blocked/, 'its merge gate still surfaces');
  db.close();
});

test('agents: a fresh worker owning a CANCELLED escalation + stale-done jobs does NOT flood — one idle card', () => {
  const OLD = NOW - 5 * 86400000; // 5 days ago — well past the 36h "recently done" window
  const db = makeDb((d) => {
    d.prepare(`INSERT INTO worker_heartbeat (owner_id,last_beat_at,job_id,phase,updated_at,worker_name) VALUES ('box:10:1782800000000',?,null,'idle',?,'coder-1')`).run(NOW - 10000, NOW - 10000);
    // a CANCELLED escalation (deliberate operator cancel) + an ancient done job owned by coder-1 — neither
    // is current worker state, so the card stays IDLE (the cancel is suppressed; the done is stale).
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts,owner_id) VALUES ('ecancel','coder-build','{}','escalated',?,?,1,'box:10:1782800000000')`).run(OLD, OLD);
    d.prepare(`INSERT INTO job_events (job_id,created_at,kind,actor) VALUES ('ecancel',?,'cancelled','human')`).run(OLD); // the deliberate-cancel marker
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts,owner_id) VALUES ('dold','coder-build','{}','done',?,?,1,'box:10:1782800000000')`).run(OLD, OLD);
    // a give-up owned by a DEAD non-roster owner (no heartbeat) — no live card, stays off the board
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts,owner_id) VALUES ('edead','coder-build','{}','escalated',?,?,1,'box:77:1700000000000')`).run(OLD, OLD);
  });
  const ctx = ctxFor(db);
  const section = PAGES.agents.getSection(db, ctx);
  const coderCards = section.columns.flatMap((c) => c.cards).filter((c) => c.av === 'av-coder');
  assert.equal(coderCards.length, 1, 'exactly ONE coder card (coder-1) — not one per stale/cancelled job');
  assert.equal(coderCards[0].name, 'coder-1');
  assert.equal(coderCards[0].col, 'idle', 'a deliberate cancel is suppressed + stale done skipped → the worker is IDLE');
  const out = PAGES.agents.render(section, ctx);
  assert.doesNotMatch(out.body, /box:77/, 'a dead non-roster owner of a give-up spawns no card (historical stay off)');
  db.close();
});

test('agents: a LIVE worker that GAVE UP (unmarked escalation) surfaces "gave up — needs you"; a CANCEL stays suppressed', () => {
  const db = makeDb((d) => {
    const hb = d.prepare(`INSERT INTO worker_heartbeat (owner_id,last_beat_at,job_id,phase,updated_at,worker_name) VALUES (?,?,null,'idle',?,?)`);
    hb.run('box:10:1782800000000', NOW - 10000, NOW - 10000, 'coder-1');
    hb.run('box:11:1782800000001', NOW - 10000, NOW - 10000, 'coder-2');
    // coder-1 OWNS a genuine give-up (escalated, UNMARKED) → must surface as "gave up — needs you"
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts,owner_id,error) VALUES ('gv','coder-build','{"title":"Deploy Status board"}','escalated',?,?,1,'box:10:1782800000000','Lead loop: max-iter 3 reached without converging')`).run(NOW - 600000, NOW - 600000);
    // coder-2 OWNS a deliberate cancel (escalated, MARKED 'cancelled') → must NOT alarm; card stays idle
    d.prepare(`INSERT INTO jobs (id,type,payload,status,created_at,updated_at,attempts,owner_id) VALUES ('cn','coder-build','{}','escalated',?,?,1,'box:11:1782800000001')`).run(NOW - 600000, NOW - 600000);
    d.prepare(`INSERT INTO job_events (job_id,created_at,kind,actor) VALUES ('cn',?,'cancelled','human')`).run(NOW - 600000);
  });
  const ctx = ctxFor(db);
  const section = PAGES.agents.getSection(db, ctx);
  const cards = section.columns.flatMap((c) => c.cards).filter((c) => c.av === 'av-coder');
  const c1 = cards.find((c) => c.name === 'coder-1');
  const c2 = cards.find((c) => c.name === 'coder-2');
  // coder-1 gave up → Blocked column, "Gave up — needs you", a TG button (a real failure is VISIBLE)
  assert.equal(c1.col, 'blocked', 'a live worker that gave up is surfaced, not shown idle');
  assert.equal(c1.waitPill.text, 'Gave up — needs you');
  assert.ok(c1.button, 'a TG button to open it');
  // coder-2 cancelled → suppressed (no false alarm); the worker shows its true idle state
  assert.equal(c2.col, 'idle', 'a deliberate cancel is NOT a "needs you"');
  const out = PAGES.agents.render(section, ctx);
  assert.match(out.body, /Gave up — needs you/, 'the give-up is rendered');
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
