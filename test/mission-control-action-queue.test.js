'use strict';

// Action queue (Step 2): the board RENDERS stored drafts + real issue tags + rising trends + the
// ALLERGEN alert (never generates a draft), and the NARROW write-path applies only safe/reversible
// ops — with NO path to post a Google reply (the two-tier boundary).
const assert = require('node:assert/strict');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sqlite = require('node:sqlite');

const { getReviewsSection, renderReviews, applyReviewAction, REVIEW_ACTION_OPS } = require('../mission-control/server.js');

const NOW = 1782700000000;
let counter = 0;

function makeDb() {
  const file = path.join(tmpdir(), `mc-aq-${process.pid}-${(counter += 1)}.db`);
  const db = new sqlite.DatabaseSync(file);
  db.exec(`
    CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, overall REAL, reviewer TEXT,
      food REAL, service REAL, atmosphere REAL, value REAL, noise REAL, sub_ratings_source TEXT,
      text TEXT, reviewed_date TEXT, has_reply INTEGER, url TEXT, source_ingest TEXT, fetched_at INTEGER);
    CREATE TABLE review_snapshot (id INTEGER PRIMARY KEY AUTOINCREMENT, total INTEGER, awaiting_response INTEGER,
      awaiting_recent_text INTEGER, awaiting_text_total INTEGER, awaiting_negative INTEGER, awaiting_star_only INTEGER,
      awaiting_over_1y INTEGER, overall_rating REAL, google_rating REAL, tripadvisor_rating REAL, opentable_rating REAL,
      ratings_window TEXT, fetched_at INTEGER);
    CREATE TABLE review_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, decision TEXT, reviewed INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE review_aggregate (platform TEXT, overall REAL, num_reviews INTEGER, food REAL, service REAL, atmosphere REAL, value REAL, fetched_at INTEGER, PRIMARY KEY (platform, fetched_at));
    CREATE TABLE review_drafts (review_id TEXT PRIMARY KEY, platform TEXT NOT NULL, draft_text TEXT NOT NULL,
      draft_status TEXT NOT NULL DEFAULT 'draft', review_url TEXT, guard_flagged TEXT, snoozed_until INTEGER,
      generated_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE review_issues (review_id TEXT, issue_code TEXT, evidence_quote TEXT, confidence REAL, model TEXT, extracted_at INTEGER, PRIMARY KEY (review_id, issue_code));
    CREATE TABLE issue_trends (issue_code TEXT, count_current INTEGER, count_prior INTEGER, rising INTEGER, last_seen TEXT, window_end INTEGER, computed_at INTEGER, PRIMARY KEY (issue_code, computed_at));
    CREATE TABLE review_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_code TEXT, identified_at INTEGER,
      evidence_summary TEXT, hypothesised_cause TEXT, action_taken TEXT, action_date INTEGER, status TEXT DEFAULT 'open',
      issue_rate_before REAL, issue_rate_after REAL, reviewed_at INTEGER, escalate INTEGER DEFAULT 0, auto INTEGER DEFAULT 0);
    CREATE TABLE system_state (key TEXT PRIMARY KEY, value TEXT);
  `);
  return db;
}

function seedQueue(db) {
  db.prepare(`INSERT INTO review_snapshot (total, awaiting_response, awaiting_recent_text, awaiting_over_1y, awaiting_star_only, overall_rating, google_rating, tripadvisor_rating, opentable_rating, ratings_window, fetched_at) VALUES (1344,959,6,950,274,4.55,4.73,4.57,3.75,'Last 30 days (rolling)',?)`).run(NOW);
  const corpus = db.prepare(`INSERT INTO review_corpus (review_id, platform, overall, reviewer, text, reviewed_date, source_ingest, fetched_at) VALUES (?,?,?,?,?,?,'api-v1',?)`);
  corpus.run('ta-1', 'tripadvisor', 1, 'Michael P', 'Food arrived 54 mins after ordering.', '2026-06-28T12:00:00Z', NOW);
  corpus.run('OT-319314-101014-100115508720', 'opentable', 4, 'Tracy', 'orders were messed up on two different occasions', '2026-06-27T20:45:00', NOW);
  corpus.run('g-1', 'google', 3, 'Jordan', 'Staff was inattentive.', '2026-06-26T12:00:00Z', NOW);
  const draft = db.prepare(`INSERT INTO review_drafts (review_id, platform, draft_text, draft_status, review_url, generated_at, updated_at) VALUES (?,?,?,?,?,?,?)`);
  draft.run('ta-1', 'tripadvisor', 'Hey Michael, 54 minutes is too long.', 'draft', 'https://www.tripadvisor.com/ShowUserReviews-r1', NOW, NOW);
  draft.run('OT-319314-101014-100115508720', 'opentable', 'Hey Tracy, two in a row is not on.', 'draft', 'https://guestcenter.opentable.com/restaurant/319314/feedback/reviews/collection?reviewId=OT-319314-101014-100115508720', NOW, NOW);
  draft.run('g-1', 'google', 'Hey Jordan, that is not the welcome we want.', 'draft', null, NOW, NOW);
  const issue = db.prepare(`INSERT INTO review_issues (review_id, issue_code, evidence_quote, extracted_at) VALUES (?,?,?,?)`);
  issue.run('ta-1', 'SERVICE_SPEED', 'Food arrived 54 mins after ordering', NOW);
  issue.run('OT-319314-101014-100115508720', 'ORDER_ACCURACY', 'orders were messed up', NOW);
  issue.run('g-1', 'STAFF_ATTITUDE', 'Staff was inattentive', NOW);
  const tr = db.prepare(`INSERT INTO issue_trends (issue_code, count_current, count_prior, rising, last_seen, window_end, computed_at) VALUES (?,?,?,?,?,?,?)`);
  tr.run('ORDER_ACCURACY', 3, 1, 1, '2026-06-27', NOW, NOW);
  tr.run('SERVICE_SPEED', 1, 1, 0, '2026-06-28', NOW, NOW);
  db.prepare(`INSERT INTO review_actions (issue_code, identified_at, evidence_summary, status, escalate, auto) VALUES ('ALLERGEN_HANDLING', ?, '4 review(s) tagged ALLERGEN_HANDLING — SAFETY: dairy served despite allergy', 'escalated', 1, 1)`).run(NOW);
}

test('render: action-queue cards with badges, real tags, stored draft, per-platform action', () => {
  const db = makeDb();
  seedQueue(db);
  const html = renderReviews(getReviewsSection(db));
  // cards present, colour-coded badges
  assert.match(html, /class="aq-card b-ta"/, 'TripAdvisor card');
  assert.match(html, /class="aq-card b-ot"/, 'OpenTable card');
  assert.match(html, /class="aq-card b-google"/, 'Google card');
  // real issue tags from review_issues
  assert.match(html, /SERVICE_SPEED/, 'TA card shows its issue tag');
  assert.match(html, /ORDER_ACCURACY/, 'OT card shows its issue tag');
  // the STORED draft is rendered (board never generates)
  assert.match(html, /54 minutes is too long/, 'TA stored draft rendered');
  // per-platform action: TA/OT get copy + open + mark-responded; Google gets Telegram, NOT a post button
  assert.match(html, /Copy reply/, 'TA/OT copy button');
  assert.match(html, /Open review/, 'TA/OT open-review deep-link');
  assert.match(html, /Mark responded/, 'TA/OT mark-responded');
  assert.match(html, /Approve in Telegram/, 'Google action is the Telegram tap');
  db.close();
});

test('render: rising-issues strip + ALLERGEN top alert', () => {
  const db = makeDb();
  seedQueue(db);
  const html = renderReviews(getReviewsSection(db));
  assert.match(html, /Rising 30d/, 'rising strip present');
  assert.match(html, /ORDER_ACCURACY ↑3 <span class="muted">\(was 1\)/, 'rising chip shows current vs prior');
  assert.doesNotMatch(html, /SERVICE_SPEED ↑/, 'non-rising issue not in the strip');
  assert.match(html, /⚠ ALLERGEN/, 'allergen alert rendered prominently');
  assert.match(html, /dairy served despite allergy/, 'allergen alert carries the evidence');
  db.close();
});

test('render: Google card has NO post/responded control (status only)', () => {
  const db = makeDb();
  seedQueue(db);
  const html = renderReviews(getReviewsSection(db));
  // the Google card region must not carry a mark-responded button (its lifecycle is the tap)
  const googleCard = html.slice(html.indexOf('class="aq-card b-google"'));
  const googleCardOnly = googleCard.slice(0, googleCard.indexOf('</article>'));
  assert.doesNotMatch(googleCardOnly, /data-op="mark_responded"/, 'Google card cannot be marked responded from the board');
  assert.doesNotMatch(googleCardOnly, /data-review=/, 'Google card has no write-path affordance');
  db.close();
});

// ---- write-path boundary ----
test('write-path: op allowlist is closed — no posting op exists', () => {
  assert.deepEqual([...REVIEW_ACTION_OPS].sort(), ['log_action', 'mark_responded', 'skip', 'snooze']);
  assert.ok(![...REVIEW_ACTION_OPS].some((o) => /post|reply|google|approve|publish/i.test(o)), 'no op can post a reply');
});

test('write-path: mark_responded writes for TA/OT', () => {
  const db = makeDb();
  seedQueue(db);
  const r = applyReviewAction(db, { op: 'mark_responded', review_id: 'ta-1' }, NOW);
  assert.equal(r.ok, true);
  assert.equal(db.prepare(`SELECT draft_status FROM review_drafts WHERE review_id='ta-1'`).get().draft_status, 'responded');
  db.close();
});

test('write-path BOUNDARY: mark_responded REFUSES a Google review (no board path to a Google post)', () => {
  const db = makeDb();
  seedQueue(db);
  const r = applyReviewAction(db, { op: 'mark_responded', review_id: 'g-1' }, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  // the Google draft is untouched — only the Telegram tap can advance it
  assert.equal(db.prepare(`SELECT draft_status FROM review_drafts WHERE review_id='g-1'`).get().draft_status, 'draft');
  db.close();
});

test('write-path: unknown / dangerous op rejected', () => {
  const db = makeDb();
  seedQueue(db);
  for (const op of ['post_google', 'reply', 'approve', 'delete', 'arbitrary']) {
    const r = applyReviewAction(db, { op, review_id: 'ta-1' }, NOW);
    assert.equal(r.ok, false, `${op} rejected`);
    assert.equal(r.status, 400);
  }
  assert.equal(db.prepare(`SELECT draft_status FROM review_drafts WHERE review_id='ta-1'`).get().draft_status, 'draft', 'no write occurred');
  db.close();
});

test('write-path: snooze hides from queue; log_action records an operator action', () => {
  const db = makeDb();
  seedQueue(db);
  // getReviewsSection filters snooze against the REAL clock, so snooze from real now (as production does).
  const realNow = Date.now();
  const s = applyReviewAction(db, { op: 'snooze', review_id: 'OT-319314-101014-100115508720', hours: 24 }, realNow);
  assert.equal(s.ok, true);
  assert.ok(s.snoozed_until > realNow);
  // snoozed review drops out of the queue model
  const cards = getReviewsSection(db).cards.map((c) => c.reviewId);
  assert.ok(!cards.includes('OT-319314-101014-100115508720'), 'snoozed review hidden from the queue');

  const l = applyReviewAction(db, { op: 'log_action', issue_code: 'ORDER_ACCURACY', action_taken: 'retrained kitchen pass', action_date: NOW }, NOW);
  assert.equal(l.ok, true);
  const act = db.prepare(`SELECT issue_code, action_taken, status, auto FROM review_actions WHERE id=?`).get(l.id);
  assert.equal(act.action_taken, 'retrained kitchen pass');
  assert.equal(act.auto, 0);
  db.close();
});
