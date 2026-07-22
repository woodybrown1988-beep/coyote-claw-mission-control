'use strict';
// Wave-2 small fixes (audit 2026-07-21): reviews queue triage+paging honesty, rota-review
// history verdict £, health ship-ref parsing. Fixture-driven, hand-set expectations.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const DATA = require('../mission-control/ui/data.js');
const reviews = require('../mission-control/ui/pages/coyote/reviews.js');
const rota = require('../mission-control/ui/pages/coyote/rota-review.js');

const NOW = Date.UTC(2026, 6, 21, 12);
const ctxFor = (db, query = {}) => ({ q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query });

function reviewsDb(n) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, overall REAL, reviewer TEXT, reviewed_date TEXT, text TEXT);
    CREATE TABLE review_drafts (review_id TEXT PRIMARY KEY, draft_text TEXT, draft_status TEXT, review_url TEXT, guard_flagged INTEGER, snoozed_until INTEGER);
    CREATE TABLE review_issues (review_id TEXT, issue_code TEXT); CREATE TABLE issue_trends (issue_code TEXT, window_days INTEGER, cnt INTEGER, prev_cnt INTEGER, computed_at INTEGER);
    CREATE TABLE review_escalations (id INTEGER PRIMARY KEY, review_id TEXT, reason TEXT, status TEXT, raised_at INTEGER);
    CREATE TABLE review_snapshot (fetched_at INTEGER, total INTEGER, awaiting INTEGER, avg_rating REAL, awaiting_recent_text INTEGER);`);
  const ic = db.prepare(`INSERT INTO review_corpus VALUES (?,?,?,?,?,?)`);
  const idr = db.prepare(`INSERT INTO review_drafts VALUES (?,?, 'drafted', 'u', 0, NULL)`);
  for (let i = 0; i < n; i++) {
    // oldest = r0; r5 is the one low-star review (3★) — triage must put it FIRST
    ic.run(`r${i}`, 'tripadvisor', i === 5 ? 3 : 5, `R${i}`, `2026-06-${String(i + 1).padStart(2, '0')}`, `text ${i}`);
    idr.run(`r${i}`, `draft ${i}`);
  }
  return db;
}

test('reviews queue: honest total, low-star first then OLDEST, pager reaches the tail', () => {
  const db = reviewsDb(23);
  const out = reviews.render(reviews.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(out.body, /23 pending · showing 10 \(low-star \+ oldest first\)/);
  assert.ok(out.body.indexOf('draft 5') < out.body.indexOf('draft 0'), 'the 3★ review leads the queue');
  assert.ok(out.body.indexOf('draft 0') < out.body.indexOf('draft 1'), 'then oldest first');
  assert.match(out.body, /next 10 →/);
  const p2 = reviews.render(reviews.getSection(db, ctxFor(db, { qpage: '2' })), ctxFor(db, { qpage: '2' }));
  assert.match(p2.body, /showing 21–23 of 23 pending/);
  assert.match(p2.body, /draft 22/, 'the tail IS reachable now');
});

test('rota-review history: each ok run carries its verdict £', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE rota_review_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT, week_monday TEXT, ran_at INTEGER, status TEXT, trigger TEXT, rota_fingerprint TEXT, report_json TEXT, report_text TEXT, error TEXT);
    CREATE TABLE review_issues (review_id TEXT, issue_code TEXT, extracted_at INTEGER);`);
  db.prepare(`INSERT INTO rota_review_runs (mode, week_monday, ran_at, status, trigger, report_json) VALUES ('hindsight','2026-07-13',?,'ok','monday',?)`)
    .run(NOW - 3600_000, JSON.stringify({ mode: 'HINDSIGHT', weekMonday: '2026-07-13', baseline: {}, verdicts: [{ dept: 'kitchen', deltaPence: 1700 }, { dept: 'foh', deltaPence: -12400 }], items: [], mixNotes: {}, gaps: [] }));
  const out = rota.render(rota.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(out.body, /K \+£17 · F −£124/, 'verdict column carries the week-on-week numbers');
  assert.match(out.body, /verdict \(\+ over \/ − under\)/);
});

test('nav restructure (page-map amendment 2026-07-21): Reports section groups Revenue + Library + Rota Review; old paths 308 to the new home with query preserved', () => {
  const S = require('../mission-control/ui/shared.js');
  const coyote = S.WORKSPACES.find((w) => w.key === 'coyote');
  const reportsGroup = coyote.groups.find((g) => g.group === 'Reports');
  assert.ok(reportsGroup, 'the Reports section exists');
  assert.deepEqual(reportsGroup.items.map((i) => i.key), ['revenue', 'report-library', 'rota-review', 'reservations', 'labour', 'costs', 'inventory'], 'Revenue + Library + Rota Review + Reservations + Labour (centre L1 2026-07-21), in order');
  assert.equal(reportsGroup.items[0].route, '/coyote/revenue');
  const srv = require('node:fs').readFileSync(require('node:path').join(__dirname, '../mission-control/server.js'), 'utf8');
  assert.match(srv, /'\/coyote\/reports': '\/coyote\/revenue'/, 'the old RCC path redirects');
  assert.match(srv, /'\/coyote\/yoy': '\/coyote\/revenue'/, 'chained redirects flattened — no double hop');
  assert.match(srv, /'\/reports': '\/coyote\/revenue'/);
});
