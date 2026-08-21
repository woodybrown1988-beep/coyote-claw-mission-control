'use strict';
// DID THE PLATFORM CHANGE, OR DID OUR PIPELINE BREAK? (2026-08-21)
//
// The issues page correctly refuses to read falling complaint counts as improvement when the
// text-bearing input has halved. It then told the operator "these counts describe a feed, not the
// kitchen" — asserting a CAUSE nothing in the data supported. On 2026-08-21 that was wrong:
// OpenTable's written reviews fell 23 -> 5, and its two delivery routes had BOTH dropped (hub
// 12 -> 3, Gmail 11 -> 2). Two independent routes do not break together; guests were writing less
// while still leaving ratings. The banner sent the operator looking for a fault that did not exist.
//
// THE CLASS: a guard may state WHAT it observed without stating WHY, and the why is only knowable
// when something in the data distinguishes the candidates. Here something does — a platform
// arriving by more than one INDEPENDENT route carries its own control group:
//   every route fell            -> the change is upstream of all of them (the platform / its guests)
//   one fell, a sibling held    -> the fault is in that route (our pipeline)
//   only one route exists       -> the two are indistinguishable, and the verdict is UNKNOWN
// A confident wrong cause is worse than an admitted absent one, which is why the third case exists.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/issues.js');

const NOW = Date.parse('2026-08-21T12:00:00Z');
const q = (db) => (s, p) => DATA.safeSelect(db, s, p);
const day = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10) + 'T00:00:00Z';

// spec: { platform: { source: [curCount, priorCount] } } — counts of TEXT-BEARING reviews.
function db_(spec, extra = {}) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, source_ingest TEXT, reviewed_date TEXT, text TEXT);
    CREATE TABLE issue_trends (issue_code TEXT, count_current INTEGER, count_prior INTEGER, rising INTEGER, computed_at INTEGER);
    CREATE TABLE review_issues (review_id TEXT, issue_code TEXT, evidence_quote TEXT, confidence REAL);
  `);
  const ins = db.prepare('INSERT INTO review_corpus VALUES (?,?,?,?,?)');
  let i = 0;
  for (const [platform, sources] of Object.entries(spec)) {
    for (const [source, [cur, prior]] of Object.entries(sources)) {
      for (let n = 0; n < cur; n++) ins.run(`c${i++}`, platform, source, day(2 + (n % 25)), 'written words');
      for (let n = 0; n < prior; n++) ins.run(`p${i++}`, platform, source, day(32 + (n % 25)), 'written words');
      // Rating-only rows must never count as input, whichever window they land in.
      for (let n = 0; n < (extra.textless || 0); n++) ins.run(`n${i++}`, platform, source, day(2 + n), null);
    }
  }
  for (const [code, cur, prior] of extra.trends || [['FOOD_QUALITY', 0, 4]]) {
    db.prepare('INSERT INTO issue_trends VALUES (?,?,?,0,?)').run(code, cur, prior, NOW);
  }
  return db;
}
const win = (db) => DATA.reviewInputWindows(q(db), NOW);
const sentence = (db) => DATA.inputDropSentence(win(db));
const render = (db) => {
  const ctx = { q: q(db), now: NOW, query: {} };
  return page.render(page.getSection(db, ctx), ctx).body;
};

test('EVERY route fell together → the platform changed, and it says so', () => {
  // The live 2026-08-21 shape.
  const db = db_({
    opentable: { 'api-v1': [3, 12], email: [2, 11] },
    google: { 'gmb-direct': [21, 11] },
  });
  const p = win(db).platforms.find((x) => x.platform === 'opentable');
  assert.equal(p.collapsed, true);
  assert.equal(p.verdict, 'platform');
  const s = sentence(db);
  assert.match(s, /EVERY source fell with it/);
  assert.match(s, /guests are writing less while still leaving ratings/);
  assert.match(s, /Nothing to fix/, 'the operator must not be sent hunting a fault that does not exist');
  assert.doesNotMatch(s, /describe a feed/, 'the old asserted cause is gone');
});

// A ROUTE DYING IS NEWS WHETHER OR NOT THE PLATFORM TOTAL COLLAPSED. With routes of 12 and 11, one
// can fail COMPLETELY and the total still falls only 48% — under the collapse threshold. Judging
// only collapsed platforms would reproduce, one level down, the masking this check exists to end.
test('one route fell while its sibling held → OUR pipeline, even though the total did not collapse', () => {
  const db = db_({
    opentable: { 'api-v1': [1, 12], email: [11, 11] },
    google: { 'gmb-direct': [21, 11] },
  });
  const p = win(db).platforms.find((x) => x.platform === 'opentable');
  assert.equal(p.collapsed, false, 'the total fell only 48% — the collapse guard alone would say nothing');
  assert.equal(p.verdict, 'pipeline', 'but half the delivery is gone and that is reportable');
  const s = sentence(db);
  assert.match(s, /only api-v1 fell/);
  assert.match(s, /email 11 of 11.*held/);
  assert.match(s, /delivery fault in our pipeline/);
  assert.match(s, /Restore it/, 'this one IS actionable, and says so');
});

// THE HONEST THIRD ANSWER — the one that stops this becoming a new way to assert a wrong cause.
test('a single-route platform returns UNKNOWN rather than guessing', () => {
  const db = db_({
    tripadvisor: { 'api-v1': [2, 14] },
    google: { 'gmb-direct': [21, 20] },
  });
  const p = win(db).platforms.find((x) => x.platform === 'tripadvisor');
  assert.equal(p.collapsed, true);
  assert.equal(p.verdict, 'unknown', 'with one route the two explanations are identical from here');
  const s = sentence(db);
  assert.match(s, /single route/);
  assert.match(s, /cause unknown/);
  assert.doesNotMatch(s, /guests are writing less/, 'it must not claim the platform changed');
  assert.doesNotMatch(s, /delivery fault in our pipeline/, 'nor that we broke — naming both possibilities to say they are indistinguishable is the point');
});

test('a route with no baseline cannot vote on the verdict', () => {
  // The email leg delivered 1 review last window — too little to say anything changed. Without the
  // baseline rule it would read as "not dropped" and turn a genuine pipeline fault into a
  // platform verdict, which is the failure this whole check exists to prevent.
  const db = db_({
    opentable: { 'api-v1': [1, 14], email: [1, 1] },
    google: { 'gmb-direct': [21, 20] },
  });
  const p = win(db).platforms.find((x) => x.platform === 'opentable');
  assert.equal(p.judged.length, 1, 'only the route with a baseline is judged');
  assert.equal(p.verdict, 'unknown', 'one judgeable route is the single-route case');
});

// NEGATIVE CONTROLS
test('a healthy platform produces no verdict and no sentence at all', () => {
  const db = db_({
    opentable: { 'api-v1': [12, 12], email: [11, 11] },
    google: { 'gmb-direct': [21, 20] },
  });
  assert.deepEqual(win(db).collapsed, []);
  assert.equal(sentence(db), null, 'silence is the correct output of a healthy pipeline');
});

test('rating-only reviews are not input, however many arrive', () => {
  // 40 ratings with no words cannot hide a collapse in written reviews.
  const db = db_({ opentable: { 'api-v1': [3, 12], email: [2, 11] }, google: { 'gmb-direct': [21, 20] } }, { textless: 40 });
  const p = win(db).platforms.find((x) => x.platform === 'opentable');
  assert.equal(p.cur, 5, 'only reviews with words count');
  assert.equal(p.verdict, 'platform');
});

test('the issues page renders the derived verdict, and still refuses to call the falls easing', () => {
  const db = db_({
    opentable: { 'api-v1': [3, 12], email: [2, 11] },
    google: { 'gmb-direct': [21, 11] },
  });
  const body = render(db);
  assert.match(body, /EVERY source fell with it/, 'the verdict reaches the operator');
  assert.doesNotMatch(body, /▼ easing/, 'and the counts are still not read as improvement');
  assert.match(body, /Counts are over reviews WITH TEXT/, 'with the denominator beside them');
});

test('an empty corpus gates the tiles and asserts nothing', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, source_ingest TEXT, reviewed_date TEXT, text TEXT);
           CREATE TABLE issue_trends (issue_code TEXT, count_current INTEGER, count_prior INTEGER, rising INTEGER, computed_at INTEGER);
           CREATE TABLE review_issues (review_id TEXT, issue_code TEXT, evidence_quote TEXT, confidence REAL);
           INSERT INTO issue_trends VALUES ('FOOD_QUALITY', 0, 4, 0, 1);`);
  const w = win(db);
  assert.equal(w.present, false);
  assert.equal(DATA.inputDropSentence(w), null);
  assert.doesNotMatch(render(db), /▼ easing/, 'an unreadable corpus is not treated as healthy');
});
