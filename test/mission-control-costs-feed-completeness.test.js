'use strict';
// Costs Centre — BANK-RECORD COMPLETENESS (2026-09-02, the Munro direct-debit incident).
//
// qb_bank_txns holds CATEGORISED transactions only (a bank line becomes a QuickBooks Purchase only
// when a human categorises it; Intuit exposes no API for the "For Review" queue). Live on
// 2026-09-02 about five pounds in six of July and August's outgoing money was missing from it
// while MAX(txn_date) was TODAY — fresh and nearly empty at once. Three panels on /coyote/costs
// reasoned "has X been paid?" over that table and printed absence as fact:
//   • the SUPPLIER SCORECARD had no posting gate (the Executive tab on the same page withholds its
//     delta for exactly this reason) — every "vs prior yr" read as a collapse;
//   • the 13-WEEK CASH CALENDAR anchored every recurring commitment on a JUNE payment, and because
//     the detector required EVERY gap inside the cadence band, ONE uncategorised collection deleted
//     the supplier under "No recurring bank-outflow pattern detected";
//   • the P&L-vs-cash caption named two causes (basis, timing) for a delta whose live cause was a
//     posting backlog in BOTH series at once.
//
// THE RULE under test mirrors src/finance/invoiceLedger.ts feedCompleteness() in the engine repo
// (Mission Control cannot import engine code) and must change in step with it. Pinned here:
//   (a) the LIVE SHAPE reproduces the engine's verdict exactly: baseline 192, holedFrom '2026-07';
//   (b) MIRROR CONTROL — the baseline is the UPPER median (sorted[floor(n/2)]), not this file's
//       averaging median(): a bimodal base separates the two, and swapping them goes RED;
//   (c) the 60% floor is strict (a month AT 60% is not holed); the run must be UNBROKEN to the
//       last settled month; the CURRENT month is never judged; < 8 settled months = no verdict;
//   (d) detectRecurrence keeps a supplier for a gap the hole explains and marks it — and STILL
//       rejects the same gap on a complete record, a gap whose missing collections predate the
//       hole, and a too-short gap inside it (the band is not loosened);
//   (e) the calendar DECLARES the holed window, marks stale anchors in the pattern table AND the
//       week grid, and its empty-state stops calling the hole "no pattern detected";
//   (f) the scorecard states the backlog and withholds the trend as "cannot tell" (never "—");
//   (g) the P&L caption names the backlog in BOTH series and withholds holed months' deltas;
//   (h) NEGATIVE CONTROLS: the same fixture with a complete record renders NO caveat anywhere —
//       the original captions, the trend, every delta.
// Every expected number is HAND-COMPUTED in the fixture comments.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/costs.js');
const { feedCompleteness, detectRecurrence } = page;

// NOW = 2026-09-02T12:00:00Z (a Wednesday). thisMonth = 2026-09; the 400-day lookback opens
// 2025-07-29; settled months = 2025-08 → 2026-08 (13); edge = 2026-05..08; base = 2025-09..2026-04.
const NOW = Date.parse('2026-09-02T12:00:00Z');

const DDL = `
CREATE TABLE qb_bank_txns (realm_id TEXT, txn_kind TEXT, txn_id TEXT, txn_date TEXT, total_pence INTEGER, counterparty TEXT);
CREATE TABLE qb_accounts (realm_id TEXT, account_id TEXT, name TEXT, acct_type TEXT, classification TEXT);
CREATE TABLE qb_journal_lines (realm_id TEXT, period_month TEXT, txn_date TEXT, account_id TEXT, account_name TEXT, debit_pence INTEGER, credit_pence INTEGER);
`;
function makeDb() { const db = new sqlite.DatabaseSync(':memory:'); db.exec(DDL); return db; }
const qOf = (db) => (sql, p) => DATA.safeSelect(db, sql, p);
const renderTab = (db, tab, now) => {
  const ctx = { q: qOf(db), now: now || NOW, query: { tab } };
  return page.render(page.getSection(db, ctx), ctx);
};
/** The <tr> holding `name`, so a row's cells can be asserted without bleeding into the next row. */
const rowOf = (body, name) => {
  const i = body.indexOf(name);
  assert.ok(i >= 0, `${name} renders`);
  return body.slice(i, body.indexOf('</tr>', i));
};
const calendarRegion = (body) => body.slice(body.indexOf('13-week cash commitment calendar'), body.indexOf('Accounts payable ageing'));

function monthShift(ym, n) {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------------------------
// THE FIXTURE (holed vs complete differ ONLY in July/August filler counts — the hole is the
// single variable, everything else is identical, so any caveat that appears in one and not the
// other is caused by the hole alone).
//
// FILLER: 1-penny purchases to unique counterparties (never recurring, never a top supplier) —
//   20 per month 2025-08..2026-06; July = 4 (holed) or 20 (complete); August = 2 or 20.
// RECURRING (120,000 = £1,200 per payment day; recurrence window = bank max 2026-09-02 − 182d =
// 2026-03-04 → 09-02):
//   'Munro DD'          03-11, 04-08, 05-06, 06-03, [07-01 UNCATEGORISED], 07-29, 08-26
//                       gaps 28,28,28,56,28 → median 28 → band [11, 45]; 56 fails; 56/2 = 28 fits
//                       and the presumed collection 06-03 + 28 = 07-01 sits inside a hole from
//                       07-01 → BRIDGED: n 6, missing 1, stale, next = 08-26 + 28 = 2026-09-23
//                       (a Wednesday → lands wk of 2026-09-21). On a complete record: DELETED.
//   'Gasco DD'          03-05, 04-02, [04-30 skipped], 05-28, 06-25, 07-23, 08-20
//                       gap 56 whose presumed collection 04-30 PREDATES the hole → a real break:
//                       deleted in BOTH fixtures (the hole explains nothing before 07-01).
//   'Stale Anchor Ltd'  03-11, 04-08, 05-06, 06-03 — nothing since. Recurs (gaps 28); last
//                       categorised payment 06-03 predates the hole → STALE; next = 06-03 + 4×28 =
//                       2026-09-23. On a complete record: projected with no mark.
//   'Fresh Weekly'      08-03, 08-10, 08-17, 08-24, 08-31 — gaps 7, last 08-31 inside the hole
//                       with nothing bridged → NOT stale; next 09-07 (wk of 2026-09-07).
// SCORECARD: 'Booker' 5,000,000 on 2026-06-01 (trailing 12mo) + 4,000,000 on 2025-06-01 (prior
//   year, outside the 400-day feed lookback) → trend +25% on a complete record.
// 'Misc Shop' 5,000 on 2026-09-02 sets bank max (current month, never judged).
// MONTH COUNTS (holed): base 2025-09..2026-02 = 20 each; Mar = 20 + Munro + Gasco + Stale = 23;
//   Apr = 23 → base sorted [20,20,20,20,20,20,23,23] → upper median = 20 = BASELINE.
//   May = 23 (1.15); Jun = 20 + 3 + Booker = 24 (1.2); Jul = 4 + Munro + Gasco = 6 (0.30 HOLED);
//   Aug = 2 + Munro + Gasco + 5 Fresh = 9 (0.45 HOLED) → holedFrom '2026-07'.
//   Complete: Jul = 22 (1.1), Aug = 27 (1.35) → holedFrom null.
// P&L vs cash (journal 'Rent (205)' 1,000,000 in Jun, Jul, Aug):
//   Jun: P&L £10,000 · cash = 20p + 3 × 120,000 + 5,000,000 = 5,360,020 → £53,600 · delta +£43,600
//   Jul (complete): cash = 20p + 2 × 120,000 = 240,020 → £2,400 · delta −£7,600
//   Jul (holed): delta WITHHELD — "cannot tell — posting backlog".
// ---------------------------------------------------------------------------------------------
function seed(db, { holed }) {
  const bk = db.prepare(`INSERT INTO qb_bank_txns (realm_id, txn_kind, txn_id, txn_date, total_pence, counterparty) VALUES ('r1','purchase',?,?,?,?)`);
  let id = 0;
  const fillerFor = (ym) => (ym === '2026-07' ? (holed ? 4 : 20) : ym === '2026-08' ? (holed ? 2 : 20) : 20);
  for (let ym = '2025-08'; ym <= '2026-08'; ym = monthShift(ym, 1)) {
    for (let i = 0; i < fillerFor(ym); i++) bk.run(`f${++id}`, `${ym}-${String(i + 1).padStart(2, '0')}`, 1, `Filler ${ym} #${i}`);
  }
  for (const d of ['2026-03-11', '2026-04-08', '2026-05-06', '2026-06-03', '2026-07-29', '2026-08-26']) bk.run(`m${++id}`, d, 120000, 'Munro DD');
  for (const d of ['2026-03-05', '2026-04-02', '2026-05-28', '2026-06-25', '2026-07-23', '2026-08-20']) bk.run(`g${++id}`, d, 120000, 'Gasco DD');
  for (const d of ['2026-03-11', '2026-04-08', '2026-05-06', '2026-06-03']) bk.run(`s${++id}`, d, 120000, 'Stale Anchor Ltd');
  for (const d of ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']) bk.run(`w${++id}`, d, 120000, 'Fresh Weekly');
  bk.run(`b${++id}`, '2026-06-01', 5000000, 'Booker');
  bk.run(`b${++id}`, '2025-06-01', 4000000, 'Booker');
  bk.run(`x${++id}`, '2026-09-02', 5000, 'Misc Shop');
  db.prepare(`INSERT INTO qb_accounts (realm_id, account_id, name, acct_type, classification) VALUES ('r1','10','Rent (205)','Expense','Expense')`).run();
  const jl = db.prepare(`INSERT INTO qb_journal_lines (realm_id, period_month, txn_date, account_id, account_name, debit_pence) VALUES ('r1',?,?,'10','Rent (205)',1000000)`);
  for (const ym of ['2026-06', '2026-07', '2026-08']) jl.run(ym, `${ym}-15`);
}

/** A bank table shaped ONLY by monthly row counts (all on the 15th) — for pinning the rule itself. */
function feedDb(counts) {
  const db = makeDb();
  const bk = db.prepare(`INSERT INTO qb_bank_txns (realm_id, txn_kind, txn_id, txn_date, total_pence, counterparty) VALUES ('r1','purchase',?,?,100,'X')`);
  let id = 0;
  for (const [ym, n] of Object.entries(counts)) for (let i = 0; i < n; i++) bk.run(`t${++id}`, `${ym}-15`);
  return db;
}
const monthsFrom = (startYm, rows) => Object.fromEntries(rows.map((n, i) => [monthShift(startYm, i), n]));

// ---------------- (a) the rule reproduces the engine's LIVE verdict ----------------

test('feedCompleteness on the live shape (probed 2026-09-02): baseline 192, Jul 0.49 and Aug 0.33 holed, holedFrom 2026-07', () => {
  // The exact monthly purchase counts read from librarian.db (read-only) on 2026-09-02.
  const db = feedDb(monthsFrom('2025-08', [196, 192, 205, 195, 207, 184, 163, 188, 178, 194, 196, 94, 63, 2]));
  const f = feedCompleteness(qOf(db), NOW);
  assert.equal(f.judged, true);
  assert.equal(f.baselineRows, 192, 'sorted base [163,178,184,188,192,195,205,207] → upper median 192');
  assert.equal(f.holedFrom, '2026-07');
  assert.deepEqual(f.holed.map((m) => m.month), ['2026-07', '2026-08']);
  assert.equal(f.holed[0].rows, 94); assert.ok(Math.abs(f.holed[0].ratio - 94 / 192) < 1e-9);
  assert.equal(f.holed[1].rows, 63); assert.ok(Math.abs(f.holed[1].ratio - 63 / 192) < 1e-9);
  const sep = f.months.find((m) => m.month === '2026-09');
  assert.ok(sep && !sep.holed, 'the current month (2 rows on the 2nd) is never judged');
});

// ---------------- (b) MIRROR CONTROL: upper median, not the averaging median ----------------

test('MIRROR CONTROL: the baseline is the engine\'s UPPER median — a bimodal base [10×4, 30×4] yields 30 (an averaging median would say 20 and miss the hole)', () => {
  // base 2025-09..2026-04 = 10,10,10,10,30,30,30,30; edge = 30, 30, 30, 17. 17/30 = 0.57 < 0.6 →
  // holed under the engine's pick; 17/20 = 0.85 under median() → not. Swap them and this goes RED.
  const db = feedDb(monthsFrom('2025-09', [10, 10, 10, 10, 30, 30, 30, 30, 30, 30, 30, 17]));
  const f = feedCompleteness(qOf(db), NOW);
  assert.equal(f.baselineRows, 30);
  assert.equal(f.holedFrom, '2026-08');
});

// ---------------- (c) the floor, the run, the current month, the short record ----------------

test('the 60% floor is STRICT: a month at exactly 60% of baseline is quiet, not holed', () => {
  const db = feedDb(monthsFrom('2025-09', [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 12]));
  const f = feedCompleteness(qOf(db), NOW);
  assert.equal(f.baselineRows, 20);
  assert.equal(f.holedFrom, null, '12/20 = 0.6 is not < 0.6');
  // and one row fewer IS holed — the negative control on the boundary
  const db2 = feedDb(monthsFrom('2025-09', [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 11]));
  assert.equal(feedCompleteness(qOf(db2), NOW).holedFrom, '2026-08');
});

test('only an UNBROKEN run at the recent edge is a backlog: a quiet month behind healthy ones is history', () => {
  const healthyAfter = feedDb(monthsFrom('2025-09', [20, 20, 20, 20, 20, 20, 20, 20, 20, 8, 20, 20]));
  assert.equal(feedCompleteness(qOf(healthyAfter), NOW).holedFrom, null, 'Jun quiet, Jul/Aug healthy → nobody is behind');
  const runToEdge = feedDb(monthsFrom('2025-09', [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 8, 8]));
  assert.equal(feedCompleteness(qOf(runToEdge), NOW).holedFrom, '2026-07', 'the run starts at its FIRST month');
  const wholeEdge = feedDb(monthsFrom('2025-09', [20, 20, 20, 20, 20, 20, 20, 20, 8, 8, 8, 8]));
  assert.equal(feedCompleteness(qOf(wholeEdge), NOW).holedFrom, '2026-05', 'a run can span the whole edge');
});

test('the CURRENT month is never judged and never sets a baseline; fewer than 8 settled months is no verdict', () => {
  const cur = feedDb({ ...monthsFrom('2025-09', [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20]), '2026-09': 1 });
  const f = feedCompleteness(qOf(cur), NOW);
  assert.equal(f.holedFrom, null, '1 row on the 15th of a month that is not over is not a hole');
  assert.equal(f.baselineRows, 20);
  const short = feedDb(monthsFrom('2026-02', [20, 20, 20, 20, 20, 20, 1]));
  const g = feedCompleteness(qOf(short), NOW);
  assert.equal(g.judged, false, '7 settled months → cannot say either way');
  assert.equal(g.holedFrom, null);
  assert.equal(g.baselineRows, null);
});

// ---------------- (d) detectRecurrence: the hole bridges, the band does not loosen ----------------

const munro = ['2026-03-11', '2026-04-08', '2026-05-06', '2026-06-03', '2026-07-29', '2026-08-26'].map((d) => ({ cp: 'Munro DD', d, p: 120000 }));

test('detectRecurrence: ONE collection missing inside the hole is bridged and marked, not fatal', () => {
  const [rec] = detectRecurrence(munro, { from: '2026-07-01' });
  assert.ok(rec, 'the supplier survives');
  assert.equal(rec.cadenceDays, 28);
  assert.equal(rec.n, 6);
  assert.equal(rec.bridged, 1);
  assert.equal(rec.missing, 1, '56 = 2 × 28 → one collection presumed uncategorised');
  assert.equal(rec.lastDate, '2026-08-26');
});

test('NEGATIVE CONTROLS: the same gap is fatal on a complete record, when its missing collection predates the hole, and a too-short gap is never bridged', () => {
  assert.deepEqual(detectRecurrence(munro, null), [], 'no hole → the pre-existing rule: every gap in band or nothing');
  assert.deepEqual(detectRecurrence(munro, { from: '2026-08-01' }), [], 'presumed collection 07-01 sits BEFORE a hole from 08-01 → a real break');
  const gasco = ['2026-03-05', '2026-04-02', '2026-05-28', '2026-06-25', '2026-07-23', '2026-08-20'].map((d) => ({ cp: 'Gasco DD', d, p: 120000 }));
  assert.deepEqual(detectRecurrence(gasco, { from: '2026-07-01' }), [], 'a gap outside the hole stays fatal even when a hole exists');
  // gaps 28, 28, 3, 28 — an extra payment three days after one, inside the hole: g/k < lo for every k
  const burst = ['2026-05-06', '2026-06-03', '2026-07-01', '2026-07-04', '2026-08-01'].map((d) => ({ cp: 'Burst', d, p: 1000 }));
  assert.deepEqual(detectRecurrence(burst, { from: '2026-07-01' }), [], 'a short gap is irregularity, not a missing collection');
  // and the band itself is untouched: a healthy pattern reports nothing bridged
  const [fresh] = detectRecurrence(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'].map((d) => ({ cp: 'Fresh Weekly', d, p: 1 })), { from: '2026-07-01' });
  assert.equal(fresh.bridged, 0); assert.equal(fresh.missing, 0);
});

// ---------------- (e) the cash calendar on a HOLED record ----------------

test('cash calendar DECLARES the holed window in the stamp, the panel tag and a note that names the months and the rows', () => {
  const db = makeDb(); seed(db, { holed: true });
  const { stamp, body } = renderTab(db, 'cash');
  assert.equal(stamp, 'bank truth to 2026-09-02 · incomplete from Jul 2026', 'freshness is not completeness — the stamp carries the hole');
  assert.ok(body.includes('bank record incomplete from Jul 2026'), 'the panel tag');
  assert.ok(body.includes('This window includes a holed period'), 'the declaration');
  assert.ok(body.includes('both incomplete from Jul 2026'), 'the shared sentence — bank AND P&L');
  assert.ok(body.includes('Jul 2026 has 6 categorised payment(s) where a normal month has about 20'), 'July, hand-counted: 4 filler + Munro + Gasco');
  assert.ok(body.includes('Aug 2026 has 9 categorised payment(s) where a normal month has about 20'), 'August: 2 filler + Munro + Gasco + 5 Fresh');
  assert.ok(body.includes('categorisation backlog in QuickBooks'), 'the cause named — not a quiet trading period');
});

test('cash calendar KEEPS Munro DD for the one collection missing inside the hole, marks it stale, and lands it in its week with the mark', () => {
  const db = makeDb(); seed(db, { holed: true });
  const body = renderTab(db, 'cash').body;
  const row = rowOf(calendarRegion(body), 'Munro DD');
  assert.ok(row.includes('>6<'), '6 categorised payment days');
  assert.ok(row.includes('~28d'), 'cadence 28');
  assert.ok(row.includes('£1,200'), 'median day-£');
  assert.ok(row.includes('2026-09-23'), 'next = 08-26 + 28');
  assert.ok(row.includes('anchored on stale data'), 'the projection is marked');
  assert.ok(row.includes('1 collection(s) presumed uncategorised inside the hole'), 'and says why');
  assert.ok(!row.includes('projected from observed cadence'), 'the clean basis chip is NOT shown on a stale row');
  const wk = body.slice(body.indexOf('wk of 2026-09-21'), body.indexOf('wk of 2026-09-28'));
  assert.ok(wk.includes('Munro DD (stale anchor)'), 'the week grid carries the mark too');
  // wk of 09-21 takes Munro (09-23) + Stale Anchor Ltd (09-23) + Fresh Weekly (Mon 09-21) = 3 × £1,200
  assert.ok(wk.includes('£3,600'), 'and the projected £ lands');
});

test('cash calendar marks a pattern whose last categorised payment PREDATES the hole as stale; one that is current inside the hole is not', () => {
  const db = makeDb(); seed(db, { holed: true });
  const cal = calendarRegion(renderTab(db, 'cash').body);
  const stale = rowOf(cal, 'Stale Anchor Ltd');
  assert.ok(stale.includes('anchored on stale data'), 'June-anchored → stale');
  assert.ok(stale.includes('last categorised payment 2026-06-03 predates the hole'), 'the reason, with the date');
  assert.ok(stale.includes('2026-09-23'), 'next = 06-03 + 4 × 28 — projected, but declared as an assumption');
  const fresh = rowOf(cal, 'Fresh Weekly');
  assert.ok(fresh.includes('projected from observed cadence'), 'a pattern current through the hole keeps the clean basis');
  assert.ok(!fresh.includes('stale'), 'and no stale mark');
  assert.ok(!cal.includes('Gasco DD'), 'a gap the hole cannot explain still deletes the supplier');
  const wk = cal.slice(cal.indexOf('wk of 2026-09-07'), cal.indexOf('wk of 2026-09-14'));
  assert.ok(wk.includes('Fresh Weekly') && !wk.includes('Fresh Weekly (stale anchor)'), 'the week grid marks only stale patterns');
});

test('cash calendar empty-state on a holed record says the absence IS the backlog, not "no pattern detected"', () => {
  const db = makeDb(); seed(db, { holed: true });
  db.prepare(`DELETE FROM qb_bank_txns WHERE counterparty IN ('Munro DD','Gasco DD','Stale Anchor Ltd','Fresh Weekly')`).run();
  // Filler only: Jul = 4 (0.2), Aug = 2 (0.1) → still holed; nothing recurs.
  const body = renderTab(db, 'cash').body;
  assert.ok(body.includes('whether the patterns exist cannot be told from this record; absence here is the backlog, not a finding'), 'the honest empty-state');
  assert.ok(!body.includes('No recurring bank-outflow pattern detected in the trailing 6 months (≥3 near-regular payment days)'), 'the confident sentence is gone');
  assert.ok(body.includes('categorising the QuickBooks'), 'the unlock is the backlog, not "more history"');
});

// ---------------- (f) the supplier scorecard on a HOLED record ----------------

test('supplier scorecard states the backlog, captions spend as the POSTED record, and withholds the trend as "cannot tell" — never "—"', () => {
  const db = makeDb(); seed(db, { holed: true });
  const body = renderTab(db, 'suppliers').body;
  assert.ok(body.includes('Posting backlog: the bank record and the P&amp;L are both incomplete from Jul 2026'), 'the shared sentence, verbatim');
  assert.ok(body.includes('Spend and share below are the POSTED record only and understate from Jul 2026'), 'spend is a floor, said so');
  assert.ok(body.includes('Spend 12mo (posted)'), 'the column header says it too');
  assert.ok(body.includes('bank record incomplete from Jul 2026'), 'the panel tag');
  const booker = rowOf(body, 'Booker');
  assert.ok(booker.includes('£50,000'), 'posted spend still renders');
  assert.ok(booker.includes('cannot tell — record incomplete'), 'the trend is an explicit cannot-tell');
  assert.ok(!booker.includes('+25%'), 'the +25% (50k vs 40k) must NOT render off a holed current side');
  assert.ok(!body.includes('r-num mono"><span class="ash">—</span></td></tr>'), 'no trend cell degrades to a dash — a dash says "no prior year"');
  assert.ok(body.includes('posted record only · incomplete from Jul 2026'), 'concentration carries the caveat');
});

// ---------------- (g) the P&L-vs-cash caption + rows on a HOLED record ----------------

test('P&L vs cash: holed months are marked and their delta withheld; the caption names the backlog in BOTH series and that margins read better than the truth', () => {
  const db = makeDb(); seed(db, { holed: true });
  const body = renderTab(db, 'cash').body;
  const jun = rowOf(body, '>Jun 2026<');
  assert.ok(jun.includes('£10,000') && jun.includes('£53,600') && jun.includes('+£43,600'), 'June is before the hole: journal £10,000 vs cash £53,600 → +£43,600');
  assert.ok(!jun.includes('posting backlog'), 'and carries no mark');
  const jul = rowOf(body, '>Jul 2026');
  assert.ok(jul.includes('(incomplete — posting backlog)'), 'July is marked');
  assert.ok(jul.includes('cannot tell — posting backlog'), 'its delta is withheld');
  assert.ok(!jul.includes('−£7,600'), 'the number that would have printed (240,020 − 1,000,000) does not');
  assert.ok(rowOf(body, '>Aug 2026').includes('cannot tell — posting backlog'), 'August too');
  assert.ok(body.includes('the delta is BASIS + TIMING only where both series are posted'), 'the caption is scoped');
  assert.ok(!body.includes('the delta is BASIS + TIMING, stated not hidden'), 'the two-cause sentence is gone from a holed record');
  assert.ok(body.includes('every margin figure built on them reads better than the truth'), 'the consequence is stated');
  assert.ok(body.includes('the first cause of any gap is the backlog, not basis or timing'), 'the third cause is named first');
});

// ---------------- (h) NEGATIVE CONTROLS: the complete record renders NO caveat ----------------

test('COMPLETE RECORD: no caveat anywhere — stamp, tag, note, stale marks, "cannot tell" — and the two-cause caption stands as written', () => {
  const db = makeDb(); seed(db, { holed: false });
  const { stamp, body } = renderTab(db, 'cash');
  assert.equal(stamp, 'bank truth to 2026-09-02');
  for (const needle of ['holed period', 'incomplete from', 'stale anchor', 'anchored on stale data', 'cannot tell', 'posting backlog', 'Posting backlog']) {
    assert.ok(!body.includes(needle), `complete record must not say "${needle}"`);
  }
  assert.ok(body.includes('the delta is BASIS + TIMING, stated not hidden'), 'the original caption');
  assert.ok(rowOf(body, '>Jul 2026').includes('−£7,600'), 'July delta prints: cash £2,400 − journal £10,000');
  const cal = calendarRegion(body);
  assert.ok(!cal.includes('Munro DD'), 'a 56-day gap on a COMPLETE record is a broken pattern — the band is not loosened');
  assert.ok(!cal.includes('Gasco DD'));
  const stale = rowOf(cal, 'Stale Anchor Ltd');
  assert.ok(stale.includes('projected from observed cadence') && stale.includes('2026-09-23'), 'June-anchored projects with the clean basis when the record is complete');
  const sup = renderTab(db, 'suppliers').body;
  assert.ok(rowOf(sup, 'Booker').includes('+25%'), 'the trend renders: 50k vs 40k');
  for (const needle of ['cannot tell', 'Posting backlog', 'incomplete from', '(posted)']) assert.ok(!sup.includes(needle), `scorecard must not say "${needle}"`);
});

test('the hole is the ONLY variable: getSection agrees with render on holedFrom in both fixtures', () => {
  for (const holed of [true, false]) {
    const db = makeDb(); seed(db, { holed });
    const ctx = { q: qOf(db), now: NOW, query: { tab: 'cash' } };
    const cash = page.getSection(db, ctx).cash;
    assert.equal(cash.feed.holedFrom, holed ? '2026-07' : null);
    assert.equal(cash.feed.baselineRows, 20);
    assert.deepEqual(cash.plVsCash.filter((r) => r.holed).map((r) => r.ym), holed ? ['2026-07', '2026-08', '2026-09'] : []);
    const sup = page.getSection(db, { ...ctx, query: { tab: 'suppliers' } }).suppliers;
    assert.equal(sup.trendWithheld, holed);
    // The BUILDER withholds the number itself, not just the renderer — a section consumer that
    // never goes through render() (a report, a chat answer) must not receive a fabricated −80%.
    const booker = sup.suppliers.find((r) => r.cp === 'Booker');
    assert.equal(booker.trendPct, holed ? null : 25, holed ? 'no trend number exists on a holed record' : '50k vs 40k = +25%');
  }
});
