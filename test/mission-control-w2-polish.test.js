'use strict';

// W2 polish (audit 2026-07-21 design changes #3-#4): the shared KPI-tile-with-sparkline component,
// its wirings (labour hero weekly %, reviews 12mo rating trend), and the rota-review caveat collapse.

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const S = require('../mission-control/ui/shared.js');
const DATA = require('../mission-control/ui/data.js');
const labourPage = require('../mission-control/ui/pages/coyote/labour.js');
const reviewsPage = require('../mission-control/ui/pages/coyote/reviews.js');

const NOW = Date.UTC(2026, 6, 21, 12, 0);
function ctxFor(db, query) { return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: query || {} }; }

test('kpiTile: >=2 points renders the sparkline; <2 points renders NONE (a one-point trend is noise, never faked)', () => {
  const withSpark = S.kpiTile({ lab: 'ATV', val: '£38.10', sub: 'basis', points: [{ v: 3700 }, { v: 3810 }] });
  assert.match(withSpark, /<svg /, 'two points → spark');
  assert.match(withSpark, /class="tile /);
  const onePoint = S.kpiTile({ lab: 'ATV', val: '£38.10', points: [{ v: 3700 }] });
  assert.doesNotMatch(onePoint, /<svg /, 'one point → no spark');
  const noPoints = S.kpiTile({ lab: 'ATV', val: '—' });
  assert.doesNotMatch(noPoints, /<svg |NaN|undefined/);
  // gap-aware: a null point breaks the line rather than interpolating (two separate segments/dots)
  const gappy = S.sparkline([{ v: 1 }, { v: null }, { v: 3 }]);
  assert.doesNotMatch(gappy, /NaN/);
});

test('labour 13-week trend %: CROSS-RULER INTERSECTION — a day without net>0 sales contributes NOTHING', () => {
  // (Centre L1: the old 8-week hero spark was ABSORBED by the Executive 13-week control trend —
  // this pin moved with the discipline: intersection days only, never 0% or ∞ from a sales gap.)
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE labour_day (business_date TEXT PRIMARY KEY, scheduled_minutes INTEGER, actual_minutes INTEGER,
             actual_paid_minutes INTEGER, scheduled_cost_pence INTEGER, actual_cost_pence INTEGER, salaried_cost_pence INTEGER,
             unmapped_scheduled_minutes INTEGER, unmapped_actual_minutes INTEGER, unmapped_names TEXT, anomalies TEXT,
             staff_scheduled INTEGER, staff_worked INTEGER, updated_at INTEGER);
           CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER);`);
  // one Mon–Sun week (w/c 2026-07-13, max = Sunday 07-19): the Monday holds labour AND sales
  // (10000p TRUE on 100000p net = 10%); Tue + Sun hold labour with NO sales row → they must be
  // EXCLUDED from the week's %, not counted as 0% or ∞
  db.prepare(`INSERT INTO labour_day (business_date, actual_cost_pence, salaried_cost_pence) VALUES
    ('2026-07-13', 10000, 0), ('2026-07-14', 12000, 0), ('2026-07-19', 5000, 0)`).run();
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence) VALUES ('2026-07-13',100000)`).run();
  const m = labourPage.getSection(db, ctxFor(db));
  const wk = (m.exec.trend.weeks || []).find((w) => w.from === '2026-07-13');
  assert.ok(wk, 'the seeded week is in the 13-week window');
  assert.equal(wk.interDays, 1, 'ONLY the intersection day contributes');
  assert.equal(wk.labourDays, 3, 'the sales-less labour days are counted as present, not bridged into the %');
  assert.equal(wk.pct, 10, '10% — never diluted by sales-less days');
  const out = labourPage.render(m, ctxFor(db));
  assert.doesNotMatch(out.body, /NaN|Infinity/);
});

test('reviews 12mo rating trend: monthly means oldest-first; the trend tile renders via the shared component', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, overall REAL, reviewer TEXT, text TEXT, reviewed_date TEXT);
           CREATE TABLE review_drafts (review_id TEXT PRIMARY KEY, platform TEXT, draft_text TEXT, draft_status TEXT, review_url TEXT, guard_flagged TEXT, snoozed_until INTEGER);
           CREATE TABLE review_issues (review_id TEXT, issue_code TEXT);
           CREATE TABLE issue_trends (issue_code TEXT, count_current INTEGER, count_prior INTEGER, rising INTEGER, computed_at INTEGER);
           CREATE TABLE review_actions (issue_code TEXT, status TEXT, evidence_summary TEXT, escalate INTEGER, auto INTEGER, id INTEGER);
           CREATE TABLE review_snapshot (total INTEGER, awaiting_response INTEGER, awaiting_recent_text INTEGER, awaiting_over_1y INTEGER, awaiting_star_only INTEGER, overall_rating REAL, google_rating REAL, tripadvisor_rating REAL, opentable_rating REAL, ratings_window TEXT, fetched_at INTEGER);`);
  db.prepare(`INSERT INTO review_snapshot VALUES (500, 79, 8, 40, 20, 4.4, 4.5, 4.2, 4.3, '12mo', ?)`).run(NOW - 3600_000);
  db.prepare(`INSERT INTO review_corpus (review_id, platform, overall, reviewed_date) VALUES
    ('a','google',4,'2026-06-05'), ('b','google',5,'2026-06-20'), ('c','tripadvisor',3,'2026-07-02')`).run();
  const m = reviewsPage.getSection(db, ctxFor(db));
  assert.deepEqual(m.ratingTrend.map((p) => p.v), [4.5, 3], 'June mean 4.5 then July 3 — oldest first');
  const out = reviewsPage.render(m, ctxFor(db));
  assert.match(out.body, /Trend · 12mo/);
  assert.match(out.body, /<svg /, 'the trend tile carries its spark');
  assert.doesNotMatch(out.body, /NaN|undefined/);
});

test('rota-review gaps: >1 collapses to "gaps & assumptions (n)"; a single gap stays inline (caveat discipline)', () => {
  const rotaPage = require('../mission-control/ui/pages/coyote/rota-review.js');
  const db = new sqlite.DatabaseSync(':memory:');
  // mirrors src/schema.sql rota_review_runs EXACTLY (wire-first: the column is mode, not kind)
  db.exec(`CREATE TABLE rota_review_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL CHECK (mode IN ('forward','hindsight')), week_monday TEXT NOT NULL, ran_at INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('ok','error')), trigger TEXT NOT NULL, rota_fingerprint TEXT, report_json TEXT, report_text TEXT, error TEXT);
           CREATE TABLE issue_extractions (review_id TEXT, extracted_at INTEGER);`);
  const rep = (gaps) => JSON.stringify({ weekMonday: '2026-07-20', verdicts: [{ dept: 'kitchen', budgetPence: 100000, deltaPence: 1700, salariedPence: 50000, plannedTruePence: 101700, forecastNetPence: 700000, pctOfForecast: 0.145 }], items: [], mixNotes: {}, gaps });
  db.prepare(`INSERT INTO rota_review_runs (mode, week_monday, trigger, status, ran_at, report_json, report_text) VALUES
    ('forward','2026-07-20','thursday','ok',?,?,'txt')`).run(NOW - 3600_000, rep(['no bookings feed', 'forecast provisional', 'RC rates cached']));
  const many = rotaPage.render(rotaPage.getSection(db, ctxFor(db)), ctxFor(db));
  assert.match(many.body, /gaps &amp; assumptions \(3\)/, '3 gaps → one collapsed line with the count');
  assert.match(many.body, /GAP: no bookings feed/, 'the detail is inside the details, honesty intact');

  db.prepare(`UPDATE rota_review_runs SET report_json = ?`).run(rep(['no bookings feed']));
  const one = rotaPage.render(rotaPage.getSection(db, ctxFor(db)), ctxFor(db));
  assert.doesNotMatch(one.body, /gaps &amp; assumptions/, 'a single gap needs no collapse');
  assert.match(one.body, /GAP: no bookings feed/);
});
