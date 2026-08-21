'use strict';
// PER-PLATFORM REVIEW COVERAGE (2026-08-21).
//
// Every review-freshness signal on this board keyed on review_snapshot.fetched_at — the time of the
// FETCH, never on whether any review CONTENT arrived. The nightly ingest exited clean, so six
// surfaces rendered "fresh / LIVE / green" through 22 days in which Google delivered nothing and
// the corpus sat at 232 rows against Google's own count of 1,386, both numbers on one screen.
//
// A pipeline that reports on its own EXECUTION rather than its own OUTPUT cannot see itself fail.
//
// Two further rules pinned here, learned the expensive way:
//   • A banner that ASSERTS a cause will eventually assert a wrong one. The old text named "Google
//     OAuth expired" and "Anthropic credit dead" — by the time the operator read it he had
//     re-consented the OAuth two days earlier and the extractor had been off Anthropic since
//     2026-08-04. It sent him to fix two things that were not broken.
//   • The threshold is the platform's OWN history, not a constant. A quiet platform must not be
//     accused of being broken, and nobody should have to maintain a number.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const DATA = require('../mission-control/ui/data.js');

const NOW = Date.parse('2026-08-21T06:00:00Z');
const q = (db) => (s, p) => DATA.safeSelect(db, s, p);
const day = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

// `gaps` = how many days ago each review landed, per platform.
function db_(spec, snapTotal) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, reviewed_date TEXT, text TEXT);
           CREATE TABLE review_snapshot (total INT, awaiting_recent_text INT, fetched_at INT);`);
  const ins = db.prepare('INSERT INTO review_corpus VALUES (?,?,?,?)');
  let i = 0;
  for (const [platform, agesAgo] of Object.entries(spec)) {
    for (const a of agesAgo) ins.run(`r${i++}`, platform, day(a) + 'T00:00:00Z', 'text');
  }
  if (snapTotal != null) db.prepare('INSERT INTO review_snapshot VALUES (?,?,?)').run(snapTotal, 21, NOW);
  return db;
}
// A chatty platform: a review every 2 days for 60 days → longest gap 2.
const chatty = (fromDaysAgo, toDaysAgo) => { const out = []; for (let d = fromDaysAgo; d >= toDaysAgo; d -= 2) out.push(d); return out; };

test('a feed silent beyond its own longest gap is flagged; a current one is not', () => {
  const cov = DATA.reviewCoverage(q(db_({
    google: chatty(60, 22),                    // stopped 22 days ago; its longest gap was 2
    tripadvisor: chatty(60, 0),                // current
  })), NOW);
  assert.equal(cov.present, true);
  const g = cov.platforms.find((p) => p.platform === 'google');
  assert.equal(g.silent, true, 'THE POINT: 22 days of nothing from a platform that never went 3');
  assert.equal(g.ageDays, 22);
  assert.equal(g.maxGap, 2, 'the threshold is its OWN history, not a hard-coded constant');
  assert.equal(cov.platforms.find((p) => p.platform === 'tripadvisor').silent, false);
  assert.deepEqual(cov.silent.map((p) => p.platform), ['google']);
});

// NEGATIVE CONTROL — the guard must not fire on a platform that is simply quiet by nature. This is
// the failure mode a fixed threshold would have: a monthly-cadence source permanently accused.
test('a naturally infrequent platform is NOT called silent', () => {
  const monthly = [180, 150, 120, 90, 60, 25].map((d) => d); // ~30-day cadence, newest 25 days ago
  const cov = DATA.reviewCoverage(q(db_({ opentable: monthly })), NOW);
  const p = cov.platforms.find((x) => x.platform === 'opentable');
  assert.equal(p.ageDays, 25);
  assert.ok(p.maxGap >= 25, 'its own history tolerates a long gap');
  assert.equal(p.silent, false, 'quiet is not the same as broken');
});

test('a platform with too little history is never accused', () => {
  const cov = DATA.reviewCoverage(q(db_({ tripadvisor: [400, 30] })), NOW);
  assert.equal(cov.platforms[0].silent, false, 'two rows cannot establish a cadence to judge against');
});

test('the cross-check the board already had: profile count vs what reached the corpus', () => {
  // The live shape: Google's own profile says 1,386; 232 rows arrived.
  const cov = DATA.reviewCoverage(q(db_({ google: chatty(60, 22) }, 1386)), NOW);
  assert.equal(cov.google.getTotal, 1386);
  assert.equal(cov.google.missing, 1386 - cov.google.corpusTotal);
  assert.ok(cov.google.missing > 0, 'the disagreement is computed, not left for a human to spot');

  // And when the feed is whole, the cross-check goes quiet rather than nagging.
  const whole = DATA.reviewCoverage(q(db_({ google: chatty(60, 0) }, 31)), NOW);
  assert.equal(whole.google.missing, 0);
  assert.equal(whole.silent.length, 0);
});

test('the sentence names which feed is quiet and which are current — and says NOTHING when all are fine', () => {
  const note = DATA.coverageSentence(DATA.reviewCoverage(q(db_({ google: chatty(60, 22), tripadvisor: chatty(60, 0) })), NOW));
  assert.match(note, /google has delivered no review since/);
  assert.match(note, /22 days/);
  assert.match(note, /its longest gap in the last year was 2/, 'it shows its working, so the claim is checkable');
  assert.match(note, /tripadvisor is current to/, 'and it does not smear the healthy platforms');
  assert.doesNotMatch(note, /OAuth|Anthropic/, 'IT MUST NOT ASSERT A CAUSE IT CANNOT OBSERVE');

  // NEGATIVE CONTROL: no banner is the correct output of a healthy pipeline. The old one was
  // unconditional and kept announcing an outage for two days after the outage ended.
  assert.equal(DATA.coverageSentence(DATA.reviewCoverage(q(db_({ google: chatty(60, 0) })), NOW)), null);
  assert.equal(DATA.coverageSentence({ present: false, platforms: [], silent: [] }), null);
});

test('no corpus table at all → present:false, not a false all-clear', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  const cov = DATA.reviewCoverage(q(db), NOW);
  assert.equal(cov.present, false);
  assert.equal(DATA.coverageSentence(cov), null);
});
