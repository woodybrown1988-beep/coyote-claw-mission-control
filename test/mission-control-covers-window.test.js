'use strict';
// COVERS WINDOW GUARD (2026-08-21) — the cross-feed intersection discipline.
//
// Sales and covers reach this page by DIFFERENT wires at DIFFERENT rates: Lightspeed lands nightly
// at 05:30, covers only when an OpenTable export is dropped by hand. Summing both over one nominal
// window divides a WHOLE week of net by a PART week of covers — and both sides are individually
// correct, so nothing looks wrong. Measured on the live DB the day this was written: sales ran to
// 2026-08-20, covers to 2026-08-18. The KPI week happened to be 08-10..16, covered on both sides,
// so nothing was visibly broken. The following Monday the KPI week becomes 08-17..23, where covers
// hold 2 of 7 days — a ~75% covers "collapse" and a ~3.5x spend/cover "surge" as the page headline.
//
// THE CLASS, not the instance: a ratio whose numerator and denominator come from feeds that can
// fall behind INDEPENDENTLY must be computed over the days both feeds actually hold, or refuse to
// speak. Already applied to SPLH (sales x labour); this extends it to every covers ratio on the
// page. The same shape will arrive again with the next pair of feeds — the fix is the discipline,
// not this window.
//
// A part-week total is not a smaller version of the truth, so covers GATE rather than render
// partial — the opposite of the covers-BASIS guard next door, where the level was true and only
// the delta was withheld. Net, gross and ATV are complete and must stay untouched: a guard that
// blanks sound numbers alongside the unsound ones teaches the operator to ignore it.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');
const DATA = require('../mission-control/ui/data.js');
const revPage = require('../mission-control/ui/pages/coyote/reports.js');

const NOW = Date.parse('2026-07-20T09:00:00Z');   // → last full week = 2026-07-13..19
const q = (db) => (s, p) => DATA.safeSelect(db, s, p);
const range = (a, b) => { const out = []; for (let d = new Date(a + 'T12:00:00Z'); d <= new Date(b + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };

// coversTo = the last date an OpenTable export reached. Sales always run the full window, exactly
// as they do live — that asymmetry IS the defect under test.
function db_(coversTo) {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INT, gross_sales_pence INT, transactions INT, discounts_pence INT, refunds_pence INT, voids_pence INT);
    CREATE TABLE v_sales_day_all (business_date TEXT, net_sales_pence INT, gross_sales_pence INT, transactions INT, premises TEXT);
    CREATE TABLE covers_day (business_date TEXT PRIMARY KEY, reserved_covers INT, walkin_covers INT, total_covers INT);
    CREATE TABLE reservations (reservation_key TEXT PRIMARY KEY, visit_date TEXT, visit_at TEXT, party_size INT, seated_date TEXT);
    CREATE TABLE labour_day (business_date TEXT, actual_minutes INT, actual_cost_pence INT, salaried_cost_pence INT);
    CREATE TABLE sales_receipts_api (receipt_id TEXT, business_date TEXT, net_without_tax_pence INT, cancelled INT, type TEXT, account_profile_code TEXT, table_name TEXT);
    CREATE TABLE sales_receipt_lines_api (receipt_id TEXT, time_of_sale_ms INT, net_without_tax_pence INT, accounting_group TEXT);
    CREATE TABLE sales_channel_map_api (account_profile_code TEXT, channel_label TEXT);
    CREATE TABLE acct_groups_api (code TEXT, name TEXT);
  `);
  const sd = db.prepare('INSERT INTO sales_day VALUES (?,?,?,?,?,?,?)');
  const va = db.prepare('INSERT INTO v_sales_day_all VALUES (?,?,?,?,?)');
  const cd = db.prepare('INSERT INTO covers_day VALUES (?,?,?,?)');
  const rs = db.prepare('INSERT INTO reservations VALUES (?,?,?,?,?)');
  const seed = (from, to, covTo) => {
    for (const d of range(from, to)) {
      sd.run(d, 500000, 600000, 250, 0, 0, 0); va.run(d, 500000, 600000, 250, 'current');
      if (!covTo || d <= covTo) { cd.run(d, 200, 300, 500); rs.run('r' + d, d, d + 'T19:00:00', 4, d + 'T19:05:00'); }
    }
  };
  seed('2026-06-20', '2026-07-19', coversTo);   // current: 500 covers/day @ £5,000 net → £10.00/cover
  seed('2025-07-10', '2025-07-24', null);       // LY complete on both feeds — never the blocked side
  return db;
}
const render = (db) => revPage.render(revPage.getSection(db, { q: q(db), now: NOW, query: { tab: 'executive' } }), { q: q(db), now: NOW, query: { tab: 'executive' } }).body;
const tile = (body, label) => { const i = body.indexOf(`r-kpi-label">${label}`); if (i < 0) return ''; const t = body.slice(i, i + 520); const n = t.indexOf('r-kpi-label', 20); return n < 0 ? t : t.slice(0, n); };

test('NEGATIVE CONTROL: covers whole for the KPI week → nothing is withheld', () => {
  const body = render(db_(null));
  const cov = tile(body, 'Covers');
  const spc = tile(body, 'Average spend / cover');
  assert.match(cov, /3,500/, '7 days x 500 covers renders in full');
  assert.match(spc, /£10/, 'and spend/cover with it');
  assert.doesNotMatch(cov, /withheld/, 'a complete window must NOT be gated — this is the state live today');
  assert.doesNotMatch(spc, /withheld/);
});

test('covers stop mid-week → covers and spend/cover are WITHHELD, not rendered partial', () => {
  // The live shape: the export reached Tuesday, sales ran to Sunday. 2 of 7 days.
  const body = render(db_('2026-07-14'));
  const cov = tile(body, 'Covers');
  const spc = tile(body, 'Average spend / cover');
  assert.doesNotMatch(cov, /1,000/, 'the 2-day partial total must never render as the week');
  assert.match(cov, /withheld/, 'it gates instead');
  assert.match(spc, /withheld/, 'and every ratio built on it gates with it');
  assert.doesNotMatch(spc, /£35/, 'a whole week of net over 2 days of covers would print ~£35/cover');
});

test('the gate says which state it is in — PARTIAL is not "no covers this week"', () => {
  const partial = tile(render(db_('2026-07-14')), 'Covers');
  assert.match(partial, /2 of this week(&#39;|')s 7/, 'it reports the real coverage, so the claim is checkable');
  assert.doesNotMatch(partial, /no covers this week/,
    'telling the operator there are no covers while 2 days sit in the table is the failure, wearing different clothes');

  // ABSENT is the genuinely different state and keeps its own wording.
  const absent = tile(render(db_('2026-07-12')), 'Covers');
  assert.match(absent, /no covers this week/, 'a week with nothing at all still says so plainly');
});

test('the complete numbers beside it are untouched', () => {
  const body = render(db_('2026-07-14'));
  assert.match(tile(body, 'Net revenue'), /£35,000/, 'net is whole and stays true');
  assert.match(tile(body, 'Average transaction'), /£20/, 'ATV divides two complete feeds — never gated');
});

test('the caption names the gap and the unlock', () => {
  const body = render(db_('2026-07-14'));
  assert.match(body, /reaches 2 of the week(&#39;|')s 7 trading days/);
  assert.match(body, /Drop the export and all three return/, 'a gate must say how to clear it');
});

// --- THE SAME CLASS ON THE DRIVERS TAB ------------------------------------------------------------
// Covers/transaction summed the two feeds as independent sub-SELECTs over one 28d window. Every day
// sales held and covers lacked pushed the ratio DOWN — far enough to leave the stated 1.7-2.2 sanity
// band and have the tile announce a DATA finding whose real cause (a late export) it could not name.
// The tile judging itself is right; a ruler that moves with its own input is not.
const drivers = (db) => {
  const ctx = { q: q(db), now: NOW, query: { tab: 'drivers' } };
  return revPage.render(revPage.getSection(db, ctx), ctx).body;
};
const withReceipts = (coversTo) => {
  const db = db_(coversTo);
  const ins = db.prepare(`INSERT INTO sales_receipts_api VALUES (?,?,?,0,'SALE','LOCAL','Table 1')`);
  for (const d of range('2026-06-20', '2026-07-19')) ins.run('R' + d, d, 200000);
  return db;
};

test('covers / transaction divides the SAME days on both sides', () => {
  // Every day carries 500 covers and 250 transactions → the true ratio is 2.00 wherever it is cut.
  // Two days of covers missing must not move it; it may only shrink the window it reports.
  const whole = drivers(withReceipts(null));
  const short = drivers(withReceipts('2026-07-17'));
  const val = (b) => { const i = b.indexOf('r-kpi-label">Covers / transaction'); return b.slice(i, i + 400); };
  assert.match(val(whole), /2\.00/, 'complete window: 2.00');
  assert.match(val(short), /2\.00/, 'covers two days behind: STILL 2.00 — the ratio is not the feed lag');
  assert.doesNotMatch(val(short), /OUTSIDE/, 'and it must not report a data finding it invented itself');
  assert.match(val(short), /2026-07-17/, 'it names the window it actually used, not the one it asked for');
});
