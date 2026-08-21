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

// --- A DEAD LEG BEHIND A LIVE SIBLING (2026-08-21, adversarial review) --------------------------
// OpenTable arrives by TWO independent paths: the upstream app's feed ('api-v1') and a Gmail parser
// ('email'). The api-v1 leg stopped on 2026-07-28 — 24 days against its own longest gap of 13 — and
// the platform still read "current to 2026-08-16" because the email leg kept delivering. Grouping
// at PLATFORM grain made a dead source invisible behind a live sibling.
//
// THE CLASS: freshness must be measured at the grain that can INDEPENDENTLY FAIL. Anything coarser
// lets a surviving sibling stand in for a source that has stopped — and when the sibling goes too,
// there is no warning left to give, because the first failure was never reported.
function legDb(spec) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, source_ingest TEXT, reviewed_date TEXT, text TEXT);
           CREATE TABLE review_snapshot (total INT, awaiting_recent_text INT, fetched_at INT);`);
  const ins = db.prepare('INSERT INTO review_corpus VALUES (?,?,?,?,?)');
  let i = 0;
  for (const [platform, sources] of Object.entries(spec)) {
    for (const [source, ages] of Object.entries(sources)) {
      for (const a of ages) ins.run(`r${i++}`, platform, source, day(a) + 'T00:00:00Z', 'words');
    }
  }
  return db;
}
const every = (from, to, step) => { const o = []; for (let d = from; d >= to; d -= step) o.push(d); return o; };

test('a silent LEG is named even when its platform looks perfectly current', () => {
  const cov = DATA.reviewCoverage(q(legDb({
    opentable: {
      'api-v1': every(120, 24, 3),   // stopped 24 days ago; its own longest gap is 3
      email: every(60, 2, 4),        // still delivering
    },
  })), NOW);
  const ot = cov.platforms.find((p) => p.platform === 'opentable');
  assert.equal(ot.silent, false, 'the PLATFORM is genuinely still delivering — that part was right');
  assert.equal(cov.silentLegs.length, 1);
  assert.equal(cov.silentLegs[0].source, 'api-v1');
  const note = DATA.coverageSentence(cov);
  assert.match(note, /opentable still looks current/, 'it does not cry outage');
  assert.match(note, /api-v1 source has produced nothing since/, 'but it names the leg that died');
  assert.match(note, /email/, 'and which one is carrying it');
});

// NEGATIVE CONTROL — a single-leg platform must never be described this way, or every healthy
// platform with one source would generate noise.
test('a platform with only ONE source is never reported as a hidden dead leg', () => {
  const cov = DATA.reviewCoverage(q(legDb({ tripadvisor: { 'api-v1': every(120, 2, 3) } })), NOW);
  assert.equal(cov.silentLegs.length, 0);
  assert.equal(DATA.coverageSentence(cov), null, 'a healthy single-leg platform says nothing at all');
});

test('when the whole platform IS silent, that outranks the leg wording', () => {
  const cov = DATA.reviewCoverage(q(legDb({
    google: { 'gmb-direct': every(120, 40, 2) },   // everything stopped 40 days ago
  })), NOW);
  const note = DATA.coverageSentence(cov);
  assert.match(note, /google has delivered no review since/, 'the louder fact wins');
  assert.doesNotMatch(note, /still looks current/);
});

// --- TEXT-BEARING FRESHNESS --------------------------------------------------------------------
// Only a review WITH TEXT can be classified. A platform can deliver rating-only rows steadily and
// supply nothing the extractor can read — live on 2026-08-21, OpenTable's rows were 4 days old
// while its newest review with text was 22 days old.
test('a platform delivering only rating-only rows is visibly stale on text', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, source_ingest TEXT, reviewed_date TEXT, text TEXT);
           CREATE TABLE review_snapshot (total INT, awaiting_recent_text INT, fetched_at INT);`);
  const ins = db.prepare('INSERT INTO review_corpus VALUES (?,?,?,?,?)');
  let i = 0;
  for (const a of every(120, 22, 2)) ins.run(`t${i++}`, 'opentable', 'email', day(a) + 'T00:00:00Z', 'words'); // steps land exactly on 22
  for (const a of every(20, 2, 2)) ins.run(`n${i++}`, 'opentable', 'email', day(a) + 'T00:00:00Z', null);
  const cov = DATA.reviewCoverage(q(db), NOW);
  const ot = cov.platforms.find((p) => p.platform === 'opentable');
  assert.equal(ot.ageDays, 2, 'rows are arriving');
  assert.equal(ot.textAgeDays, 22, 'but nothing readable has arrived in three weeks');
  assert.ok(ot.textAgeDays > ot.ageDays, 'the two must be reported separately, never conflated');
});

// A RETIRED LEG IS NOT A DEAD LEG (2026-08-21). Google's 'api-v1' source stopped on purpose the day
// the ingest began fetching from Google directly. Reporting that as an outage every day is exactly
// the noise that teaches an operator to stop reading these warnings — and the first version of the
// leg model did, right next to the OpenTable warning that genuinely mattered.
//
// The distinguishing fact is in the data: a sibling holding MORE rows has taken the platform over.
test('a leg superseded by a BIGGER sibling is a handover, and is not reported', () => {
  const cov = DATA.reviewCoverage(q(legDb({
    google: {
      'api-v1': every(200, 60, 4),      // the retired writer — stopped, and small
      'gmb-direct': every(300, 2, 2),   // took over, and holds far more
    },
  })), NOW);
  assert.ok(cov.silentLegs.some((l) => l.source === 'api-v1'), 'the leg IS silent — that fact is still computed');
  assert.equal(DATA.coverageSentence(cov), null, 'but it is not reported: something bigger replaced it');
});

test('a leg whose survivor is SMALLER is still reported — a side-channel is not a replacement', () => {
  const cov = DATA.reviewCoverage(q(legDb({
    opentable: {
      'api-v1': every(300, 24, 3),   // the primary, stopped
      email: every(60, 2, 6),        // a small side-channel, still alive
    },
  })), NOW);
  const note = DATA.coverageSentence(cov);
  assert.match(note, /api-v1 source has produced nothing since/, 'the primary going quiet is real news');
  assert.match(note, /email/, 'and the sentence says what is carrying it');
});

// --- WITHDRAWN ROWS ARE HISTORY, NOT SURPLUS (2026-08-21) --------------------------------------
// Five google rows came from a retired feed and have no counterpart in the 1,386 reviews Google now
// returns. They are kept deliberately — a review the platform has since removed is still a real
// review we once received, and its content cannot be re-derived — and flagged with withdrawn_at.
//
// Counting them as unreconciled duplicates would make the discrepancy banner nag for ever about
// rows that are exactly where they should be, which is precisely how a warning stops being read.
function surplusDb({ current, withdrawn, fetched }) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, source_ingest TEXT, reviewed_date TEXT, text TEXT, withdrawn_at INTEGER);
           CREATE TABLE review_snapshot (total INT, awaiting_recent_text INT, fetched_at INT);`);
  const ins = db.prepare('INSERT INTO review_corpus VALUES (?,?,?,?,?,?)');
  let i = 0;
  for (let n = 0; n < current; n++) ins.run(`c${i++}`, 'google', 'gmb-direct', day(n % 30) + 'T00:00:00Z', 'words', null);
  for (let n = 0; n < withdrawn; n++) ins.run(`w${i++}`, 'google', 'api-v1', day(200 + n) + 'T00:00:00Z', 'words', 1_700_000_000_000);
  db.prepare('INSERT INTO review_snapshot VALUES (?,?,?)').run(fetched, 5, NOW);
  return db;
}

test('withdrawn rows raise neither a surplus nor a shortfall', () => {
  const cov = DATA.reviewCoverage(q(surplusDb({ current: 1386, withdrawn: 5, fetched: 1386 })), NOW);
  assert.equal(cov.google.corpusTotal, 1391, 'the raw row count is still reported honestly');
  assert.equal(cov.google.withdrawn, 5);
  assert.equal(cov.google.currentTotal, 1386, 'but the comparison uses the rows claiming to be current');
  assert.equal(cov.google.surplus, 0, 'THE POINT: no permanent nag about rows that are where they belong');
  assert.equal(cov.google.missing, 0);
});

// NEGATIVE CONTROLS — the exclusion must not blind the check in either direction.
test('a REAL surplus is still caught with withdrawn rows present', () => {
  const cov = DATA.reviewCoverage(q(surplusDb({ current: 1400, withdrawn: 5, fetched: 1386 })), NOW);
  assert.equal(cov.google.surplus, 14, 'duplicates among the current rows still surface');
  assert.equal(cov.google.missing, 0);
});

test('a REAL shortfall is still caught with withdrawn rows present', () => {
  const cov = DATA.reviewCoverage(q(surplusDb({ current: 1300, withdrawn: 5, fetched: 1386 })), NOW);
  assert.equal(cov.google.missing, 86, 'reviews that never reached us still surface');
  assert.equal(cov.google.surplus, 0);
});

test('a database without the withdrawn_at column still reports, rather than erroring', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, source_ingest TEXT, reviewed_date TEXT, text TEXT);
           CREATE TABLE review_snapshot (total INT, awaiting_recent_text INT, fetched_at INT);
           INSERT INTO review_corpus VALUES ('a','google','gmb-direct','2026-08-20T00:00:00Z','x');
           INSERT INTO review_snapshot VALUES (1, 0, 0);`);
  const cov = DATA.reviewCoverage(q(db), NOW);
  assert.equal(cov.google.withdrawn, 0, 'an absent column reads as "none marked", not as a crash');
  assert.equal(cov.google.currentTotal, 1);
});
