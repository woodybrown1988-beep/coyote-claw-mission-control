'use strict';
// Reviews page — the tagging-engine-switch boundary caption on the rising/trend panel (part 4 of the
// 2026-08 Codex re-rail). The rising panel compares trailing-30d vs the prior 30d, so its window spans
// [now-60d, now]; if the classifier switched inside that span, a rise/fall may be the engine, not
// complaints, and must be captioned (premises/StoreKit-boundary doctrine). Switch date is derived from
// the `model` provenance on issue_extractions — no separate store, no fabrication.

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const reviewsPage = require('../mission-control/ui/pages/coyote/reviews.js');

const NOW = Date.UTC(2026, 7, 4, 12, 0); // 2026-08-04
const DAY = 86_400_000;

function bodyOf(db) {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, query: {} };
  return reviewsPage.render(reviewsPage.getSection(db, ctx), ctx).body;
}
function dbWith(extractions) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE issue_extractions (review_id TEXT PRIMARY KEY, tag_count INTEGER, model TEXT, extracted_at INTEGER)`);
  const ins = db.prepare(`INSERT INTO issue_extractions VALUES (?,?,?,?)`);
  extractions.forEach(([model, at], i) => ins.run('r' + i, 0, model, at));
  return db;
}

test('boundary caption RENDERS when the 60d trend window straddles the engine switch', () => {
  const body = bodyOf(dbWith([['claude-sonnet-4-6', NOW - 40 * DAY], ['gpt-5.6-sol', NOW - 5 * DAY]]));
  assert.match(body, /Tagging engine changed 2026-07-30 \(Claude → gpt-5\.6-sol\)/, 'names the switch date + engines');
  assert.match(body, /may reflect the classifier, not complaints/);
});

test('boundary caption ABSENT when the corpus is a single engine (no switch)', () => {
  const body = bodyOf(dbWith([['claude-sonnet-4-6', NOW - 40 * DAY], ['claude-sonnet-4-6', NOW - 5 * DAY]]));
  assert.doesNotMatch(body, /Tagging engine changed/, 'all-Claude → no boundary');
});

test('boundary caption ABSENT when the switch predates the 60d trend window', () => {
  const body = bodyOf(dbWith([['claude-sonnet-4-6', NOW - 200 * DAY], ['gpt-5.6-sol', NOW - 90 * DAY]]));
  assert.doesNotMatch(body, /Tagging engine changed/, 'switch older than the window → the comparison no longer straddles it');
});

test('boundary caption ABSENT + no crash when issue_extractions is missing entirely', () => {
  const db = new sqlite.DatabaseSync(':memory:'); // no tables at all
  const body = bodyOf(db);
  assert.doesNotMatch(body, /Tagging engine changed/);
  assert.match(body, /Action queue/, 'the page still renders (graceful degrade)');
});
