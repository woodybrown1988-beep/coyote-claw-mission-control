'use strict';
// ISSUES CENTRE — a fall is only "easing" if something was measured (2026-08-19, wiring audit).
//
// count_current falls to 0 both when a complaint genuinely stops AND when the review feed stops
// arriving. The tiles turned any fall GREEN and labelled it "easing", so with Google and
// TripAdvisor dead since ~2026-07-06 the page painted 16 fabricated zeros as complaints solved —
// under a timestamp that looked fresh, because the trend job kept running happily on an empty input.
//
// THE CLASS: a derived count is only a measurement if its INPUT covered the window. Any metric
// computed over a feed must check the feed arrived before reading a fall as improvement.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/issues.js');

const NOW = Date.parse('2026-08-19T12:00:00Z');
const iso = (back) => new Date(NOW - back * 86400000).toISOString().slice(0, 10);

function db_(curReviews, priorReviews) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE issue_trends (issue_code TEXT, count_current INTEGER, count_prior INTEGER, rising INTEGER, computed_at INTEGER);
    CREATE TABLE review_issues (review_id TEXT, issue_code TEXT, evidence_quote TEXT, confidence REAL);
    CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, reviewed_date TEXT);
  `);
  // A theme that has FALLEN to zero — the shape that used to render green.
  db.prepare(`INSERT INTO issue_trends VALUES ('FOOD_QUALITY', 0, 4, 0, ?)`).run(NOW);
  db.prepare(`INSERT INTO issue_trends VALUES ('SERVICE_SPEED', 0, 3, 0, ?)`).run(NOW);
  const rc = db.prepare(`INSERT INTO review_corpus VALUES (?,?,?)`);
  for (let i = 0; i < curReviews; i++) rc.run('c' + i, 'google', iso(5));
  for (let i = 0; i < priorReviews; i++) rc.run('p' + i, 'google', iso(45));
  return db;
}
const render = (db) => {
  const ctx = { q: (s, p) => DATA.safeSelect(db, s, p), now: NOW, query: {} };
  return page.render(page.getSection(db, ctx), ctx).body;
};

test('feed collapsed → a fall to zero is NOT painted as easing, and the page says why', () => {
  const body = render(db_(2, 40));            // input fell to 5% of the prior window
  assert.match(body, /no input — not easing/, 'the fall must not read as an improvement');
  assert.doesNotMatch(body, /▼ easing/, 'no green easing tile may survive a collapsed input');
  assert.match(body, /Review input has collapsed/, 'and the reason is stated');
  assert.match(body, /means nothing arrived to count/, 'in words an operator can act on');
});

test('POSITIVE CONTROL: with the feed healthy, a genuine fall still reads as easing', () => {
  const body = render(db_(38, 40));           // input steady — the fall is real
  assert.match(body, /▼ easing/, 'a real improvement must still be reported as one');
  assert.doesNotMatch(body, /Review input has collapsed/, 'and no banner cries wolf');
});

test('unknown coverage gates too — an unreadable corpus is not treated as healthy', () => {
  const db = db_(10, 10);
  db.exec('DROP TABLE review_corpus');
  const body = render(db);
  assert.match(body, /no input — not easing/, 'if coverage cannot be read, it is not assumed fine');
});
