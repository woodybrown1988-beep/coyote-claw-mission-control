'use strict';
// Rota Review page — renders the persisted runs (dated snapshots) per the ruled verdict format.
// Fixture rows mirror the cc engine's report_json shape exactly. Covers: hero verdict lines
// (readable-to-a-manager), the unpublished-rota finding, the FAILED-run red banner, drift +
// ceiling + extractor-staleness lines on HINDSIGHT, dept filter, history, empty-DB honesty.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/rota-review.js');
const library = require('../mission-control/ui/pages/coyote/report-library.js');

const NOW = Date.UTC(2026, 6, 20, 12, 0);
const DDL = `
CREATE TABLE rota_review_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT, week_monday TEXT, ran_at INTEGER, status TEXT, trigger TEXT, rota_fingerprint TEXT, report_json TEXT, report_text TEXT, error TEXT);
CREATE TABLE review_issues (review_id TEXT, issue_code TEXT, evidence_quote TEXT, confidence REAL, model TEXT, extracted_at INTEGER);
`;

const FWD = {
  mode: 'FORWARD', weekMonday: '2026-07-20', from: '2026-07-20', to: '2026-07-26', asOf: NOW - 3600_000,
  baseline: { from: '2026-05-25', to: '2026-07-19', weeks: 8 },
  verdicts: [
    { dept: 'kitchen', plannedTruePence: 96645, salariedPence: 78239, budgetPence: 577300, forecastNetPence: 3490000, deltaPence: -480655, pctOfForecast: 0.0277 },
    { dept: 'foh', plannedTruePence: 406500, salariedPence: 143255, budgetPence: 425900, forecastNetPence: 3490000, deltaPence: -19400, pctOfForecast: 0.1165 },
  ],
  items: [{ kind: 'UNDER', date: '2026-07-25', dept: 'kitchen', part: 'DINNER', hours: 16.4, pence: 34475, note: 'projected £974/h > own p90 £191/h (n=2) — service risk' }],
  mixNotes: { foh: 'senior roles carry >40% of hours in 13 daypart(s) this week (88.8h senior)' },
  lines: [], gaps: ['kitchen rota looks PARTIALLY PUBLISHED (5 shift(s) on the whole week) — verdict provisional until published'],
  ceiling: null,
};
const HIND = {
  mode: 'HINDSIGHT', weekMonday: '2026-07-13', from: '2026-07-13', to: '2026-07-19', asOf: null,
  baseline: { from: '2026-05-18', to: '2026-07-12', weeks: 8 },
  verdicts: [{ dept: 'kitchen', plannedTruePence: 460000, salariedPence: 78239, budgetPence: 441500, forecastNetPence: 2540000, deltaPence: 18500, pctOfForecast: 0.181 }],
  items: [], mixNotes: {}, lines: [], gaps: [],
  ceiling: { topDates: [], topReviews: 66, topIssueReviews: 4, topRatePct: 6.1, restReviews: 466, restIssueReviews: 31, restRatePct: 6.7, verdict: 'p90-ok' },
};
const FWD_SAME_WEEK = { ...FWD, weekMonday: '2026-07-13', verdicts: [{ dept: 'kitchen', plannedTruePence: 430000, salariedPence: 78239, budgetPence: 441500, forecastNetPence: 2540000, deltaPence: -11500, pctOfForecast: 0.169 }] };

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  const ins = db.prepare(`INSERT INTO rota_review_runs (mode, week_monday, ran_at, status, trigger, report_json, report_text) VALUES (?,?,?,?,?,?,?)`);
  ins.run('forward', '2026-07-13', NOW - 8 * 86_400_000, 'ok', 'thursday', JSON.stringify(FWD_SAME_WEEK), 'old fwd text');
  ins.run('hindsight', '2026-07-13', NOW - 3 * 3600_000, 'ok', 'monday', JSON.stringify(HIND), 'HINDSIGHT RENDERED TEXT');
  ins.run('forward', '2026-07-20', NOW - 3600_000, 'ok', 'publish-change', JSON.stringify(FWD), 'FORWARD RENDERED TEXT');
  db.prepare(`INSERT INTO review_issues VALUES ('r1','SERVICE_SPEED','q',0.9,'m',?)`).run(NOW - 15 * 86_400_000);
  return db;
}
const ctxFor = (db, query = {}) => ({ q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query });

test('rota-review: heroes read to a manager verbatim; unpublished-rota finding renders; items + one MIX note', () => {
  const db = makeDb();
  const out = page.render(page.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(out.body, /KITCHEN — FORWARD w\/c 2026-07-20/);
  assert.match(out.body, /£4,807 under/, 'kitchen delta whole-pound');
  assert.match(out.body, /PROVISIONAL — rota unpublished/, 'the unpublished rota renders as the finding it is');
  assert.match(out.body, /£194 under/, 'FOH verdict');
  assert.match(out.body, /UNDER<\/span> 2026-07-25 DINNER · 16\.4h \+£344\.75/);
  assert.match(out.body, /MIX foh: senior roles carry/);
  assert.match(out.body, /GAP: kitchen rota looks PARTIALLY PUBLISHED/);
  assert.match(out.body, /FORWARD RENDERED TEXT/, 'full verdict text behind the expand');
  assert.match(out.body, /trigger publish-change/);
});

test('rota-review: HINDSIGHT carries drift vs the same week\'s FORWARD, the ceiling line, and the stale-extractor caveat', () => {
  const db = makeDb();
  const out = page.render(page.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(out.body, /KITCHEN — HINDSIGHT w\/c 2026-07-13/);
  assert.match(out.body, /£185 OVER/, 'the wk29 kitchen verdict');
  assert.match(out.body, /DRIFT kitchen: rota promised £4,300, the week cost £4,600 \(\+£300 vs plan\)/);
  assert.match(out.body, /SPLH CEILING: p90 stands \(top-decile days 6\.1% speed\/wait\/accuracy vs 6\.7% elsewhere\)/);
  assert.match(out.body, /extractor last wrote 15 day\(s\) ago/);
});

test('rota-review: a FAILED latest run renders the red banner, never quiet', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO rota_review_runs (mode, week_monday, ran_at, status, trigger, error) VALUES ('forward','2026-07-20',?,'error','publish-change','rota-ahead pull failed: HTTP 500')`).run(NOW - 600_000);
  const out = page.render(page.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(out.body, /latest FORWARD run FAILED/);
  assert.match(out.body, /rota-ahead pull failed: HTTP 500/);
  assert.match(out.body, /flagged in Rex/);
});

test('rota-review: the dept filter narrows heroes and items', () => {
  const db = makeDb();
  const out = page.render(page.getSection(db, ctxFor(db, { dept: 'foh' })), ctxFor(db, { dept: 'foh' }));
  assert.doesNotMatch(out.body, /KITCHEN — FORWARD/);
  assert.match(out.body, /FOH — FORWARD/);
  assert.doesNotMatch(out.body, /UNDER<\/span> 2026-07-25 DINNER/, 'kitchen item filtered');
});

test('rota-review: empty DB renders the honest banner; history renders the receipts', () => {
  const empty = new sqlite.DatabaseSync(':memory:');
  empty.exec(DDL);
  const out = page.render(page.getSection(empty, ctxFor(empty)), ctxFor(empty));
  assert.match(out.body, /No Rota Review runs on record yet/);
  const db = makeDb();
  const out2 = page.render(page.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(out2.body, /Run history/);
  assert.match(out2.body, /thursday/);
});

test('report-library: carries the standing Rota Review link — now the Labour tab (consolidated 2026-07-22)', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  const out = library.render(library.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(out.body, /href="\/coyote\/labour\?tab=rota-review"/);
});
