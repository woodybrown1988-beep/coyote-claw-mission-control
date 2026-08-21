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
//
// EXTENDED 2026-08-21 after adversarially reviewing the google-feed fix, which exposed three holes
// in the guard above — each of which let the page paint green again:
//   (1) it counted ROWS, not reviews WITH TEXT. Only a review with text can produce a tag.
//   (2) it aggregated ACROSS PLATFORMS, so one feed's recovery hides another's collapse. Live on
//       2026-08-21: OpenTable text-input fell 23 -> 3 and TripAdvisor 11 -> 4 (both past the 50%
//       rule) while Google rose 12 -> 23 and carried the total to a 35% fall that did not trip it.
//   (3) it had no SAMPLE-SIZE test, so a fall of 1 -> 0 in 30 reviews went green — an event with
//       52% probability under no change at all.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/issues.js');

const NOW = Date.parse('2026-08-19T12:00:00Z');
const iso = (back) => new Date(NOW - back * 86400000).toISOString().slice(0, 10);

// `spec` may be a plain pair of counts (single platform, all text-bearing) or a per-platform map
// { platform: { cur, prior, curText, priorText } } for the masking cases.
function db_(curReviews, priorReviews, opts = {}) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE issue_trends (issue_code TEXT, count_current INTEGER, count_prior INTEGER, rising INTEGER, computed_at INTEGER);
    CREATE TABLE review_issues (review_id TEXT, issue_code TEXT, evidence_quote TEXT, confidence REAL);
    CREATE TABLE review_corpus (review_id TEXT PRIMARY KEY, platform TEXT, source_ingest TEXT, reviewed_date TEXT, text TEXT);
  `);
  // Themes that have FALLEN to zero — the shape that used to render green unconditionally.
  const trends = opts.trends || [['FOOD_QUALITY', 0, 4], ['SERVICE_SPEED', 0, 3]];
  for (const [code, cur, prior] of trends) {
    db.prepare(`INSERT INTO issue_trends VALUES (?, ?, ?, 0, ?)`).run(code, cur, prior, NOW);
  }
  const rc = db.prepare(`INSERT INTO review_corpus VALUES (?,?,?,?,?)`);
  // A single delivery route per platform unless a test says otherwise — enough for these cases,
  // which are about VOLUME. Route-level diagnosis has its own file (mission-control-source-drop).
  const add = (n, back, plat, tag, withText, src = 'api-v1') => {
    for (let i = 0; i < n; i++) rc.run(`${tag}${plat}${i}`, plat, src, iso(back), withText ? 'some words' : null);
  };
  if (opts.platforms) {
    for (const [plat, v] of Object.entries(opts.platforms)) {
      add(v.curText, 5, plat, 'c', true);
      add((v.cur || v.curText) - v.curText, 5, plat, 'cn', false);
      add(v.priorText, 45, plat, 'p', true);
      add((v.prior || v.priorText) - v.priorText, 45, plat, 'pn', false);
    }
  } else {
    add(curReviews, 5, 'google', 'c', true);
    add(priorReviews, 45, 'google', 'p', true);
  }
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
  assert.match(body, /have collapsed in this window/, 'and the reason is stated');
  assert.match(body, /means nothing arrived to count/, 'in words an operator can act on');
});

test('POSITIVE CONTROL: with the feed healthy, a genuine fall still reads as easing', () => {
  const body = render(db_(38, 40));           // input steady — the fall is real
  assert.match(body, /▼ easing/, 'a real improvement must still be reported as one');
  assert.doesNotMatch(body, /have collapsed in this window/, 'and no banner cries wolf');
});

test('unknown coverage gates too — an unreadable corpus is not treated as healthy', () => {
  const db = db_(10, 10);
  db.exec('DROP TABLE review_corpus');
  const body = render(db);
  assert.match(body, /no input — not easing/, 'if coverage cannot be read, it is not assumed fine');
});


// --- (1) TEXT, NOT ROWS ------------------------------------------------------------------------
// Only a review WITH TEXT can produce a tag. A window can be full of rating-only rows and produce
// nothing to count, while a row-count guard reports the feed as perfectly healthy.
test('rows without text do not count as input — the guard reads what the extractor reads', () => {
  const body = render(db_(0, 0, { platforms: { google: { cur: 40, curText: 2, prior: 40, priorText: 38 } } }));
  assert.match(body, /no input — not easing/, 'forty rows arrived and two could be tagged: that is a collapse');
  assert.doesNotMatch(body, /▼ easing/);
  assert.match(body, /Reviews WITH TEXT have collapsed/, 'the banner names the real denominator');
});

// --- (2) ONE PLATFORM'S RECOVERY MUST NOT HIDE ANOTHER'S COLLAPSE -------------------------------
// This is the live 2026-08-21 shape. The aggregate falls only 35% — under the 50% rule — so the old
// guard stayed silent while two of three feeds had materially stopped delivering text.
test('a per-platform collapse is caught even when the TOTAL looks fine', () => {
  const body = render(db_(0, 0, { platforms: {
    google: { cur: 29, curText: 23, prior: 19, priorText: 12 },     // recovering (+92%)
    opentable: { cur: 20, curText: 3, prior: 44, priorText: 23 },   // collapsed (-87%)
    tripadvisor: { cur: 4, curText: 4, prior: 11, priorText: 11 },  // collapsed (-64%)
  } }));
  assert.doesNotMatch(body, /▼ easing/, 'THE POINT: the total fell only 35%, and it still must not go green');
  // Wording now comes from data.js inputDropSentence, which names the platform, its numbers, and —
  // where the routes can tell them apart — whether the cause is upstream or ours. This fixture
  // gives each platform ONE route, so the honest verdict is "cause unknown", and it says so.
  assert.match(body, /opentable written reviews fell 23 → 3/, 'the banner names which feed, with its numbers');
  assert.match(body, /tripadvisor written reviews fell 11 → 4/);
  assert.match(body, /cause unknown/, 'a single route cannot distinguish a fault from a real drop');
  assert.doesNotMatch(body, /google written reviews fell/, 'and does not smear the platform that is healthy');
});

// NEGATIVE CONTROL — the per-platform rule must not fire on a platform that was always marginal,
// or it would gate the page permanently and teach the operator to ignore it.
test('a platform with a tiny share cannot gate the whole page', () => {
  const body = render(db_(0, 0, { platforms: {
    google: { cur: 40, curText: 40, prior: 40, priorText: 40 },   // the bulk, steady
    tripadvisor: { cur: 1, curText: 1, prior: 3, priorText: 3 },  // 7% of prior text, and tiny
  } }));
  assert.match(body, /▼ easing/, 'a marginal feed wobbling is not an outage');
  assert.doesNotMatch(body, /have collapsed in this window/);
});

// --- (3) A FALL NEEDS A SAMPLE THAT COULD SHOW IT ----------------------------------------------
// Four codes went green on a current count of ZERO with 30 classified reviews against 46. Under no
// change, seeing zero was 13%-52% likely. The board called a coin flip an improvement.
test('a fall indistinguishable from chance is neutral, not green', () => {
  // CLEANLINESS 1 -> 0 with bases 30 vs 46: P(X=0) = (1 - 1/46)^30 = 51.6%.
  const body = render(db_(0, 0, {
    trends: [['CLEANLINESS', 0, 1]],
    platforms: { google: { cur: 30, curText: 30, prior: 46, priorText: 46 } },
  }));
  assert.doesNotMatch(body, /▼ easing/, 'a 52%-likely event is not an improvement');
  assert.match(body, /within normal variation/, 'and the page says so in plain words');
  assert.match(body, /51% likely anyway|52% likely anyway/, 'showing the actual probability');
});

test('POSITIVE CONTROL: a fall the sample CAN carry still goes green', () => {
  // 12 -> 1 with the same bases: overwhelming, and it must not be suppressed.
  const body = render(db_(0, 0, {
    trends: [['VALUE_PRICING', 1, 12]],
    platforms: { google: { cur: 30, curText: 30, prior: 46, priorText: 46 } },
  }));
  assert.match(body, /▼ easing/, 'a real, large improvement must still be reported as one');
  assert.doesNotMatch(body, /within normal variation/);
});

test('the denominator always travels with the counts', () => {
  const body = render(db_(30, 46));
  assert.match(body, /Counts are over reviews WITH TEXT: 30 classified this window vs 46/,
    'the operator can see how big the sample was without asking');
});
