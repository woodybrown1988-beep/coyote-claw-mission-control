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
  assert.match(s, /upstream of us rather than in our pipeline/);
  assert.match(s, /the ratings still arrive, the words do not/, 'it states the observation, not a motive');
  assert.doesNotMatch(s, /guests are writing less/,
    'the routes cannot separate guests writing less from the platform withholding the words — both look identical from here');
  assert.match(s, /Nothing in our delivery to fix/, 'the operator must not be sent hunting a fault that does not exist');
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
  assert.doesNotMatch(s, /upstream of us/, 'it must not claim the change is upstream');
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

// The closing line must AGREE with the verdict above it. It used to end "Restore the feed before
// reading these as a trend" unconditionally, which — the moment the verdict became derived — put
// "Nothing to fix" and "Restore the feed" in the same sentence. A banner that contradicts itself
// teaches the operator to read none of it.
test('the banner does not tell you to fix something it just said needs no fixing', () => {
  const body = render(db_({ opentable: { 'api-v1': [3, 12], email: [2, 11] }, google: { 'gmb-direct': [21, 11] } }));
  assert.match(body, /Nothing in our delivery to fix/);
  assert.doesNotMatch(body, /Restore the feed/, 'the two cannot both be true');
  assert.match(body, /Read these again once the written reviews return/, 'the tail follows the verdict');
});

test('a pipeline verdict DOES close by telling you to restore it', () => {
  const body = render(db_({ opentable: { 'api-v1': [0, 14], email: [11, 11] }, google: { 'gmb-direct': [4, 20] } }));
  assert.match(body, /delivery fault in our pipeline/);
  assert.match(body, /Restore the route named above/);
  assert.doesNotMatch(body, /Nothing in our delivery to fix/);
});

test('an unknown cause closes by asking for one, not by asserting either', () => {
  const body = render(db_({ tripadvisor: { 'api-v1': [2, 14] }, google: { 'gmb-direct': [4, 20] } }));
  assert.match(body, /cause unknown/);
  assert.match(body, /Establish the cause/);
  assert.doesNotMatch(body, /Nothing in our delivery to fix/);
});

// THE RENDER IS WHERE THE OPERATOR MEETS IT (2026-08-21, found by audit).
// data.js separates `collapsed` (what gates the tiles) from `reportable` (that, plus any route
// failure a sibling makes diagnosable). issues.js read only `collapsed`, so the PIPELINE verdict —
// the one verdict the operator can act on — was computed on every request and shown on none. The
// model test passed throughout, which is exactly why it survived: a model assertion cannot see a
// page that throws the answer away.
test('a route failure reaches the operator even when the tiles are not gated', () => {
  const body = render(db_({
    opentable: { 'api-v1': [1, 12], email: [11, 11] },   // total falls 48% — under the gate
    google: { 'gmb-direct': [21, 11] },
  }));
  assert.match(body, /delivery fault in our pipeline/, 'the actionable verdict is on the page');
  assert.match(body, /only api-v1 fell/, 'naming the route to restore');
  assert.match(body, /▼ easing/, 'while the tiles themselves are NOT gated — the total held up');
});

// NEGATIVE CONTROL for the separation above, and the reason it exists: fixing the render gap by
// feeding `reportable` into the GATE made a route failure silence tiles that were perfectly
// readable — the same conflation in the opposite direction, introduced while fixing it.
test('a route failure is reported WITHOUT gating tiles the input can still carry', () => {
  const body = render(db_({
    opentable: { 'api-v1': [1, 12], email: [11, 11] },   // one route dead, total holds at 48%
    google: { 'gmb-direct': [21, 11] },
  }));
  assert.match(body, /delivery fault in our pipeline/, 'the route failure speaks');
  assert.match(body, /▼ easing/, 'and the readable tiles are still read');
  assert.doesNotMatch(body, /have collapsed in this window/, 'nothing collapsed, so nothing claims it did');
});

test('a genuine collapse still gates, even with no route failure to report', () => {
  const body = render(db_({
    opentable: { 'api-v1': [2, 12], email: [2, 11] },    // both routes fell: collapse, no fault
    google: { 'gmb-direct': [4, 11] },
  }));
  assert.match(body, /have collapsed in this window/);
  assert.doesNotMatch(body, /▼ easing/, 'the tiles ARE gated when the input genuinely thinned');
});

// --- THE MIXED STATE (2026-08-21, round-two audit) ---------------------------------------------
// One platform genuinely collapsed with verdict 'platform'; an UNRELATED platform carries a
// non-gating route failure. The first fix joined every reportable sentence into one string and
// dropped it into the collapse banner — whose closing line comes from the GATING verdicts — so the
// deployed page rendered "Nothing in our delivery to fix. Restore the route named above" in ONE
// banner: the exact self-contradiction the closing-line fix existed to kill, rebuilt from its own
// parts. A sentence may only share a banner with a tail that belongs to its platform's verdict.
test('a non-gating route fault cannot borrow the collapse banner or its tail', () => {
  const body = render(db_({
    opentable: { 'api-v1': [3, 12], email: [2, 11] },      // collapsed, verdict 'platform'
    google: { 'gmb-api': [1, 12], 'gmb-direct': [11, 11] }, // route dead, total 12/23 — above the gate
  }));
  // The collapse banner speaks only for the platform that gated, and closes to match ITS verdict.
  assert.match(body, /opentable written reviews fell[^<]*Nothing in our delivery to fix\.[^<]*Read these again once the written reviews return\./,
    'the blind banner and its tail agree, platform-scoped');
  // The route fault renders in its own banner with its own instruction.
  assert.match(body, /google written reviews fell[^<]*delivery fault in our pipeline[^<]*Restore it\./,
    'the pipeline fault still reaches the operator, separately');
  // And the two never share a text run — the contradiction is unrepresentable, not just absent.
  assert.doesNotMatch(body, /Nothing in our delivery to fix\.[^<]*Restore the route named above/,
    'one banner may not both stand down and order a repair');
  assert.doesNotMatch(body, /Restore it\.[^<]*Read these again once the written reviews return/,
    'nor may the route banner inherit the collapse tail');
});

// NEGATIVE CONTROL — when the pipeline fault itself GATES, the restore tail is exactly right and
// must survive: the separation is between banners, not a ban on the word "restore".
test('a GATING pipeline fault still closes with the restore instruction', () => {
  const body = render(db_({
    opentable: { 'api-v1': [0, 14], email: [11, 11] },  // collapsed AND pipeline: 11/25 is past the gate
    google: { 'gmb-direct': [4, 20] },
  }));
  assert.match(body, /delivery fault in our pipeline[^<]*Restore it\./);
  assert.match(body, /Restore the route named above before reading these as a trend\./,
    'the tail belongs to this banner because this platform gated');
});

// --- THE CONTRADICTION, ONE LEVEL DOWN AGAIN (round-three audit) -------------------------------
// Separating gating from non-gating killed the contradiction across that boundary — and it
// reappeared INSIDE it when TWO platforms gated with different verdicts: one joined string, one
// union-derived tail, and the deployed banner read "Nothing in our delivery to fix. ... Restore
// the route named above" again. The rule was never "gating vs not": a sentence may only share a
// banner with a tail that matches its own verdict, all the way down. Each verdict group now closes
// its own banner, pipeline first because it is the only one the operator can act on tonight.
test('two gating platforms with different verdicts each close their own banner', () => {
  const body = render(db_({
    opentable: { 'api-v1': [3, 12], email: [2, 11] },   // collapsed, verdict 'platform'
    google: { 'gmb-api': [0, 14], mail: [6, 11] },      // collapsed AND 'pipeline' (6/25 gates)
  }));
  // Each group self-closes inside one div…
  assert.match(body, /delivery fault in our pipeline[^<]*Restore it\.[^<]*Restore the route named above/,
    'the pipeline group carries the restore tail');
  assert.match(body, /Nothing in our delivery to fix\.[^<]*Read these again once the written reviews return\./,
    'the platform group carries the return tail');
  // …and no text run may both stand down and order a repair, in either order.
  assert.doesNotMatch(body, /Nothing in our delivery to fix\.[^<]*Restore the route named above/);
  assert.doesNotMatch(body, /Restore it\.[^<]*Read these again once the written reviews return/);
});

// --- A SIGNAL GATED BEHIND SOMEONE ELSE'S ALARM (round-three audit) ----------------------------
// covNote was rendered only when NOT blind (a #200 shape), on the theory that the collapse banner
// carried it — which stopped being true when the banner became derived. So a feed silent for
// weeks lost its one warning whenever an UNRELATED platform collapsed.
test('a silent-feed warning still renders while an unrelated collapse is firing', () => {
  const db = db_({ opentable: { 'api-v1': [3, 12], email: [2, 11] } });  // the collapse
  // A tripadvisor feed with a real cadence that stopped 43 days ago — silent by its own history.
  const ins = db.prepare('INSERT INTO review_corpus VALUES (?,?,?,?,?)');
  let i = 500;
  for (let d = 200; d >= 43; d -= 2) ins.run(`ta${i++}`, 'tripadvisor', 'api-v1', day(d), 'w');
  const body = render(db);
  assert.match(body, /have collapsed in this window/, 'the collapse fires');
  assert.match(body, /tripadvisor has delivered no review since/,
    'and the silent feed is STILL named — its warning is not hostage to another platform\'s alarm');
});

// --- A BANNER DOES NOT NEED TILES TO EXIST (round-three audit) ---------------------------------
// Banners were composed below an early return for an empty issue_trends, so on a fresh trend
// table a live "Restore it." was computed and never rendered — the round-one render gap in its
// third outfit. What a banner says has nothing to do with whether there are tiles to gate.
test('a route fault renders even when no trend window has ever been computed', () => {
  const db = db_(
    { opentable: { 'api-v1': [1, 12], email: [11, 11] }, google: { 'gmb-direct': [21, 11] } },
    { trends: [] },
  );
  // The auditor's exact shape: issue_trends empty but review_issues populated, so the page is not
  // in its all-empty state — it renders the tiles section, whose early return was eating banners.
  db.prepare(`INSERT INTO review_issues VALUES ('c0', 'FOOD_QUALITY', 'cold food', 0.9)`).run();
  const body = render(db);
  assert.match(body, /No trend window computed yet/, 'the empty state still shows');
  assert.match(body, /delivery fault in our pipeline[^<]*Restore it\./,
    'and the actionable verdict renders above it rather than dying with the tiles');
});
