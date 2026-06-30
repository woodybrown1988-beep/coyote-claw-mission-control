'use strict';

// Reviews panel — per-platform honest grain. Proves the RENDER never fabricates: Google is forced to
// "overall only" (even if a category value somehow sat in the row), OpenTable/TripAdvisor show genuine
// per-review averages with coverage, OT/TA are labelled awareness (no reply queue), and the TripAdvisor
// location-averages row stays "pending" until review_aggregate is populated.
const assert = require('node:assert/strict');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sqlite = require('node:sqlite');

const { getReviewsSection, renderReviews } = require('../mission-control/server.js');

const NOW = 1782695622619;
let counter = 0;

function makeDb() {
  const file = path.join(tmpdir(), `mc-reviews-${process.pid}-${(counter += 1)}.db`);
  const db = new sqlite.DatabaseSync(file);
  db.exec(`
    CREATE TABLE review_corpus (
      review_id TEXT PRIMARY KEY, platform TEXT, platform_review_id TEXT, reviewer TEXT, overall REAL,
      food REAL, service REAL, atmosphere REAL, value REAL, noise REAL, sub_ratings_source TEXT,
      text TEXT, title TEXT, reviewed_date TEXT, has_reply INTEGER, url TEXT, source_ingest TEXT, fetched_at INTEGER
    );
    CREATE TABLE review_aggregate (
      platform TEXT, overall REAL, num_reviews INTEGER, food REAL, service REAL, atmosphere REAL, value REAL,
      fetched_at INTEGER, PRIMARY KEY (platform, fetched_at)
    );
    CREATE TABLE review_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT, total INTEGER, awaiting_response INTEGER,
      awaiting_recent_text INTEGER, awaiting_text_total INTEGER, awaiting_negative INTEGER,
      awaiting_star_only INTEGER, awaiting_over_1y INTEGER, overall_rating REAL,
      google_rating REAL, tripadvisor_rating REAL, opentable_rating REAL, ratings_window TEXT, fetched_at INTEGER
    );
    CREATE TABLE review_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, decision TEXT, reviewed INTEGER, created_at INTEGER, updated_at INTEGER
    );
  `);
  return db;
}

function seed(db, { withAggregate, freshAt = NOW } = {}) {
  const ins = db.prepare(
    `INSERT INTO review_corpus (review_id, platform, overall, food, service, atmosphere, value, sub_ratings_source, has_reply, source_ingest, fetched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  // Google: per-category NULL (no native sub-ratings), reply status unknown.
  ins.run('gh-1', 'google', 5, null, null, null, null, 'csv-real', null, 'api-v1', freshAt);
  ins.run('gh-2', 'google', 4, null, null, null, null, 'overall-fallback', null, 'api-v1', freshAt);
  // OpenTable: dense, genuine per-category (food avg of 1 and 5 = 3.00).
  ins.run('OT-1', 'opentable', 3, 1, 4, 4, 1, 'csv-real', null, 'api-v1', freshAt);
  ins.run('OT-2', 'opentable', 5, 5, 5, 5, 5, 'csv-real', null, 'api-v1', freshAt);
  // TripAdvisor: sparse — one row with genuine cats, one without (overall-fallback → NULL).
  ins.run('ta-1', 'tripadvisor', 4, 3, 5, 4, 2, 'csv-real', null, 'api-v1', freshAt);
  ins.run('ta-2', 'tripadvisor', 5, null, null, null, null, 'overall-fallback', null, 'api-v1', freshAt);
  db.prepare(
    `INSERT INTO review_snapshot (total, awaiting_response, awaiting_recent_text, awaiting_text_total, awaiting_negative, awaiting_star_only, awaiting_over_1y, overall_rating, google_rating, tripadvisor_rating, opentable_rating, ratings_window, fetched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(1344, 959, 6, 685, 113, 274, 950, 4.55, 4.73, 4.57, 3.75, 'Last 30 days (rolling)', freshAt);
  if (withAggregate) {
    db.prepare(
      `INSERT INTO review_aggregate (platform, overall, num_reviews, food, service, atmosphere, value, fetched_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run('tripadvisor', 4.5, 732, 4.5, 4.5, 4.0, 4.5, freshAt);
  }
}

test('reviews section models per-platform grain (Google no cats; OT dense; TA sparse)', () => {
  const db = makeDb();
  seed(db, { withAggregate: false, freshAt: Date.now() });
  const section = getReviewsSection(db);
  assert.equal(section.ok, true);
  assert.equal(section.platforms.google.withCats, 0, 'Google has zero genuine categories');
  assert.equal(section.platforms.opentable.withCats, 2, 'OpenTable dense');
  assert.equal(section.platforms.tripadvisor.withCats, 1, 'TripAdvisor sparse (1 of 2)');
  // OpenTable food average of {1,5} = 3
  assert.equal(Math.round(section.platforms.opentable.food * 100) / 100, 3);
  db.close();
});

test('reviews panel renders honest grain: Google overall-only, OT/TA awareness, aggregate pending', () => {
  const db = makeDb();
  seed(db, { withAggregate: false, freshAt: Date.now() });
  const html = renderReviews(getReviewsSection(db));
  assert.match(html, /Google has no sub-ratings/, 'Google overall-only');
  assert.match(html, /Ambience/, 'OpenTable uses Ambience label');
  assert.match(html, /Atmosphere/, 'TripAdvisor uses Atmosphere label');
  assert.match(html, /\(1\/2\)/, 'TripAdvisor coverage shows 1 of 2 (sparse)');
  assert.match(html, /awareness · no reply capability/, 'OT/TA labelled awareness');
  // Reframe (Step 2 action queue): LEAD with the actionable recent-text queue (6), keep 959 as labelled
  // historical context. The summary moved into the action-queue grain line.
  assert.match(html, /awaiting 30d:/, 'leads with the actionable queue (action-queue grain line)');
  assert.match(html, /6 text · as of/, 'actionable number = 6 recent text');
  assert.match(html, /lifetime 959/, '959 kept as labelled historical context');
  assert.match(html, /950 &gt;1yr · 274 star-only · historical/, '959 labelled historical, not actionable');
  assert.match(html, /6 recent · <span class="muted">actionable \(rev: tap\)/, 'rev: tap queue is the recent 6');
  assert.doesNotMatch(html, /959 awaiting · <span class="muted">actionable/, 'never labels the lifetime 959 as actionable');
  assert.match(html, /averages pending · \/api\/v1\/aggregates not yet live/, 'aggregate empty → pending, never fabricated');
  db.close();
});

test('reviews panel shows the TripAdvisor location averages once review_aggregate is populated', () => {
  const db = makeDb();
  seed(db, { withAggregate: true, freshAt: Date.now() });
  const section = getReviewsSection(db);
  assert.equal(section.aggregates.tripadvisor.numReviews, 732);
  const html = renderReviews(section);
  assert.match(html, /\(732 reviews\)/, 'shows the real location average count');
  assert.doesNotMatch(html, /averages pending/, 'no longer pending once shipped');
  db.close();
});

test('render NEVER shows a Google category, even if a value leaked into the row (defense in depth)', () => {
  const db = makeDb();
  seed(db, { withAggregate: false, freshAt: Date.now() });
  db.prepare(`UPDATE review_corpus SET food=5, service=5, atmosphere=5, value=5 WHERE platform='google'`).run();
  const html = renderReviews(getReviewsSection(db));
  assert.match(html, /Google has no sub-ratings/, 'Google row stays overall-only regardless of stored values');
  db.close();
});

test('reviews panel degrades gracefully when the corpus/aggregate tables are absent', () => {
  const db = makeDb();
  db.exec('DROP TABLE review_corpus; DROP TABLE review_aggregate;');
  db.prepare(
    `INSERT INTO review_snapshot (total, awaiting_response, overall_rating, google_rating, tripadvisor_rating, opentable_rating, ratings_window, fetched_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(1344, 959, 4.55, 4.73, 4.57, 3.75, 'Last 30 days (rolling)', Date.now());
  const section = getReviewsSection(db);
  assert.equal(section.ok, true, 'still ok — snapshot carries it');
  assert.deepEqual(section.platforms, {}, 'no per-platform data');
  const html = renderReviews(section);
  assert.doesNotMatch(html, /Per-review sub-ratings/, 'per-platform table omitted, not errored');
  assert.match(html, /awaiting 30d:/, 'summary still renders (reframed action-queue grain line)');
  db.close();
});
