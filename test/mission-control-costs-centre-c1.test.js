'use strict';
// Costs Centre C1 — the seven-tab shell on /coyote/costs + EXECUTIVE, FIXED & SEMI-FIXED and
// CASH COMMITMENTS built (the QB-strong core). Every expected number is HAND-COMPUTED in the
// fixture comments, never re-derived through the module. Pinned here:
//   (a) SHELL + REGISTRY: 7 subtabs, executive default, ?tab= switches, unknown falls back;
//       forecast/cogs/margins/suppliers each render the ONE 'C2/C3 build pending' note; nav
//       Reports order = …reservations, labour, costs; server.js requires the page after
//       reservations.js; the contract fields.
//   (b) KPI ARITHMETIC: prime cost = COGS% + labour% on the ONE net base; break-even week =
//       (fixed + semi overheads ÷ CM ratio) × 12/52 — hand-computed; the caption states the
//       month + BOTH bases (pinned).
//   (c) MONTHLY GRAIN: the trend states the monthly grain (QB month-grain ledger — the mock's
//       weekly frame renders monthly, stated in sub + note).
//   (d) ATTENTION QUEUE from seeded deltas: supplier day-span delta (like-for-like windows —
//       a beyond-day-span decoy must NOT enter the average); the fee-collapse finding with
//       REAL £-scale; the rent-step reminder with days-until DERIVED from ctx.now (two NOWs
//       10 days apart must differ by 10 — never a hardcoded day count); the recipe carrot.
//   (e) BRIDGE ARITHMETIC: revenue → −COGS → −labour → −overheads → contribution (site basis,
//       after ALL overheads) + the theoretical-overlay-absent recipe-gate note.
//   (f) RENT STEP: 2026-10-28 with BOTH amounts (£60,000 → £65,000) everywhere it renders.
//   (g) RECURRING-CADENCE PROJECTION: a seeded 28-day counterparty projects (median cadence ×
//       median £, 'projected from observed cadence'); a ONE-OFF decoy must NOT project; the
//       surveillance boundary: person-named payees pool into ONE Staff-payroll aggregate and
//       NO person name renders.
//   (h) AP AGEING: the mapped empty-state verbatim ('QB Bills not in use — 8 rows since 2022').
//   (i) IMPORT POINTERS: the labour month £ renders ONCE (2dp, beside /coyote/labour); the
//       revenue month £ once (beside /coyote/revenue) — no duplicated panels.
//   (j) EMPTY DB: zero derived £ anywhere — the ONLY £ digits allowed are the ENCODED rent
//       canon (contractual constants, not wire data).
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/costs.js');
const S = require('../mission-control/ui/shared.js');

const DAY = 86400000;
// NOW = 2026-07-22T12:00:00Z. Rent step 2026-10-28T00:00:00Z − NOW = 97.5 days → ceil = 98.
const NOW = Date.parse('2026-07-22T12:00:00Z');

const DDL = `
CREATE TABLE v_sales_day_all (business_date TEXT, net_sales_pence INTEGER, premises TEXT);
CREATE TABLE labour_day (business_date TEXT PRIMARY KEY, actual_cost_pence INTEGER, salaried_cost_pence INTEGER, updated_at INTEGER);
CREATE TABLE qb_accounts (realm_id TEXT, account_id TEXT, name TEXT, fq_name TEXT, acct_type TEXT, acct_subtype TEXT, classification TEXT, active INTEGER, currency TEXT, updated_at INTEGER);
CREATE TABLE qb_pl_monthly (realm_id TEXT, month TEXT, account_id TEXT, account_name TEXT, net_pence INTEGER, updated_at INTEGER);
CREATE TABLE qb_journal_lines (realm_id TEXT, period_month TEXT, txn_date TEXT, txn_type TEXT, doc_num TEXT, account_id TEXT, account_name TEXT, entity_name TEXT, memo TEXT, debit_pence INTEGER, credit_pence INTEGER, updated_at INTEGER);
CREATE TABLE qb_bank_txns (realm_id TEXT, txn_kind TEXT, txn_id TEXT, txn_date TEXT, bank_account_id TEXT, bank_account_name TEXT, total_pence INTEGER, counterparty TEXT, memo TEXT, lines_json TEXT, qb_updated TEXT, updated_at INTEGER);
CREATE TABLE recipe_lines (product_id TEXT, sub_item_id TEXT, quantity REAL);
CREATE TABLE products (id TEXT PRIMARY KEY, lightspeed_sku TEXT, name TEXT, category TEXT);
CREATE TABLE sub_items (id TEXT PRIMARY KEY, name TEXT, pack_cost_pence INTEGER, pack_qty REAL, unit_of_measure TEXT);
`;

function makeDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(DDL);
  return db;
}
const render = (db, query, now) => {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: now || NOW, query: query || {} };
  return page.render(page.getSection(db, ctx), ctx).body;
};
const count = (hay, needle) => hay.split(needle).length - 1;

// ---------------------------------------------------------------------------------------------
// EXECUTIVE fixture — every figure hand-computed.
//   Sales (v_sales_day_all, premises 'current'; max = 2026-06-30 = a month-final day → the
//   reference month is Jun 2026): Jun = 5,000,000 + 5,000,000 = £100,000.00 over 2 days
//   (+ a premises='old' decoy 999,999 that must NOT count). Mar/Apr/May = 10,000,000 each.
//   Labour (labour_day TRUE): Jun = 1,250,000 + 1,250,000 = £25,000.00 · Mar/Apr/May 2,000,000.
//   QB P&L Jun (accounts → buckets):
//     Cost of sales (203) [COGS-class] 2,000,000            → COGS £20,000
//     Wages and Salaries (204) [payroll-class] 3,000,000    → EXCLUDED from overheads
//     Rent (205) 500,000 + Insurance (207) 500,000          → fixed £10,000
//     Lighting and Heating (205) 500,000                    → semi £5,000
//     Advertising costs (206) 300,000 + Bank charges (207) 200,000 → variable £5,000
//     (+ an Income-classification decoy 12,345,678 that must not enter any bucket)
//   Mar/Apr/May QB: Cost of sales 2,500,000 + Rent 500,000 each.
//   HAND-COMPUTED KPIs (Jun): COGS% = 20.0% · labour% = 25.0% · PRIME = 45.0%
//     contribution = 100,000 − 20,000 − 25,000 − 5,000(var) = £50,000 · CM ratio = 0.5
//     overheads = 10,000 + 5,000 + 5,000 = £20,000
//     break-even week = (15,000 fixed+semi ÷ 0.5) × 12/52 = 30,000 × 12/52 = £6,923.077 → £6,923
//   BRIDGE (site basis): 100,000 − 20,000 − 25,000 − 20,000(ALL overheads) = £35,000
//   RATIO ARROW: COGS 3-mo avg = 2,500,000/10,000,000 = 25.0% → Jun 20.0% = ▼ 5.0%
//   SUPPLIER DELTA (bank purchases, like-for-like day spans; bank max = 2026-07-20 → day 20):
//     Booker Jul days ≤20: 100,000 + 100,000 = £2,000
//     Booker Apr/May/Jun days ≤20: 1,000,000 each → 3-mo same-span avg £10,000
//     (+ a Jun-25 decoy 500,000 BEYOND day 20 that must NOT enter the average)
//     delta = 2,000 − 10,000 = −£8,000
//   FEE COLLAPSE ('Bank charges' journal; ref month Jun → prior6 = 2025-11..2026-04, recent2 =
//     2026-05..06): prior6 150,000/mo → £1,500 · recent2 (2,000 + 4,000)/2 = £30 → fires.
// ---------------------------------------------------------------------------------------------
function seedExec(db) {
  const sd = db.prepare(`INSERT INTO v_sales_day_all VALUES (?,?,?)`);
  sd.run('2026-06-01', 5000000, 'current'); sd.run('2026-06-30', 5000000, 'current');
  sd.run('2026-06-15', 999999, 'old'); // the premises decoy
  sd.run('2026-03-15', 10000000, 'current'); sd.run('2026-04-15', 10000000, 'current'); sd.run('2026-05-15', 10000000, 'current');
  const ld = db.prepare(`INSERT INTO labour_day (business_date, actual_cost_pence) VALUES (?,?)`);
  ld.run('2026-06-01', 1250000); ld.run('2026-06-30', 1250000);
  ld.run('2026-03-15', 2000000); ld.run('2026-04-15', 2000000); ld.run('2026-05-15', 2000000);
  const ac = db.prepare(`INSERT INTO qb_accounts (realm_id, account_id, name, acct_type, classification) VALUES ('r1',?,?,?,?)`);
  ac.run('60', 'Cost of sales (203)', 'Cost of Goods Sold', 'Expense');
  ac.run('77', 'Wages and Salaries (204)', 'Expense', 'Expense');
  ac.run('10', 'Rent (205)', 'Expense', 'Expense');
  ac.run('11', 'Lighting and Heating (205)', 'Expense', 'Expense');
  ac.run('12', 'Advertising costs (206)', 'Expense', 'Expense');
  ac.run('13', 'Insurance (207)', 'Expense', 'Expense');
  ac.run('25', 'Bank charges (207)', 'Expense', 'Expense');
  ac.run('90', 'Sales', 'Income', 'Revenue'); // the income decoy
  const pl = db.prepare(`INSERT INTO qb_pl_monthly (realm_id, month, account_id, account_name, net_pence) VALUES ('r1',?,?,?,?)`);
  pl.run('2026-06', '60', 'Cost of sales (203)', 2000000);
  pl.run('2026-06', '77', 'Wages and Salaries (204)', 3000000);
  pl.run('2026-06', '10', 'Rent (205)', 500000);
  pl.run('2026-06', '13', 'Insurance (207)', 500000);
  pl.run('2026-06', '11', 'Lighting and Heating (205)', 500000);
  pl.run('2026-06', '12', 'Advertising costs (206)', 300000);
  pl.run('2026-06', '25', 'Bank charges (207)', 200000);
  pl.run('2026-06', '90', 'Sales', 12345678);
  for (const ym of ['2026-03', '2026-04', '2026-05']) {
    pl.run(ym, '60', 'Cost of sales (203)', 2500000);
    pl.run(ym, '10', 'Rent (205)', 500000);
  }
  // supplier-delta bank world
  const bk = db.prepare(`INSERT INTO qb_bank_txns (realm_id, txn_kind, txn_id, txn_date, total_pence, counterparty) VALUES ('r1','purchase',?,?,?,?)`);
  let id = 0;
  bk.run(`b${++id}`, '2026-07-05', 100000, 'Booker'); bk.run(`b${++id}`, '2026-07-18', 100000, 'Booker');
  for (const [d1, d2] of [['2026-04-05', '2026-04-15'], ['2026-05-05', '2026-05-15'], ['2026-06-05', '2026-06-15']]) {
    bk.run(`b${++id}`, d1, 500000, 'Booker'); bk.run(`b${++id}`, d2, 500000, 'Booker');
  }
  bk.run(`b${++id}`, '2026-06-25', 500000, 'Booker'); // the beyond-day-span decoy
  bk.run(`b${++id}`, '2026-07-20', 10000, 'Zed Shop'); // sets bank max = day 20; sub-£500 noise
  // A SECOND supplier that posts NORMALLY every month. Without it, Booker's collapse IS the whole
  // feed collapsing, which is indistinguishable from the purchase ledger simply being un-posted —
  // the live 2026-08 condition that produced a fabricated "£12,471 Booker saving". Steady Dairy
  // keeps overall posting healthy (2026-08-19 gate), so a single supplier's collapse still reads as
  // the real finding it is. Its own delta is zero, so it never out-ranks Booker.
  for (const [ym2, d] of [['2026-04', '08'], ['2026-05', '08'], ['2026-06', '08'], ['2026-07', '08']]) {
    bk.run(`b${++id}`, `${ym2}-${d}`, 900000, 'Steady Dairy');
  }
  // fee-collapse journal world
  const jl = db.prepare(`INSERT INTO qb_journal_lines (realm_id, period_month, txn_date, account_id, account_name, debit_pence) VALUES ('r1',?,?,'25','Bank charges (207)',?)`);
  for (const ym of ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04']) jl.run(ym, `${ym}-15`, 150000);
  jl.run('2026-05', '2026-05-15', 2000); jl.run('2026-06', '2026-06-15', 4000);
  // recipe_lines stays EMPTY → the carrot fires
}

// ---------------- (a) shell + registry ----------------

test('contract + shell: seven tabs on /coyote/costs, executive default, ?tab= switches, unknown falls back', () => {
  assert.equal(page.key, 'costs');
  assert.equal(page.route, '/coyote/costs');
  assert.equal(page.workspace, 'coyote');
  assert.equal(page.title, 'Costs');
  assert.equal(page.sub, 'Costs & supplier command centre · QB ledger shadow + bank truth');
  const db = makeDb();
  const body = render(db);
  for (const label of ['Executive', 'Cost Forecast', 'COGS &amp; Inventory', 'Recipe Margins', 'Suppliers &amp; Purchasing', 'Fixed &amp; Semi-Fixed', 'Cash Commitments']) {
    assert.ok(body.includes(label), `tab ${label} present`);
  }
  assert.match(body, /class="r-tab active" href="\/coyote\/costs\?tab=executive"/, 'executive is the default tab');
  assert.match(render(db, { tab: 'cash' }), /class="r-tab active" href="\/coyote\/costs\?tab=cash"/, '?tab=cash activates');
  assert.match(render(db, { tab: 'nonsense' }), /class="r-tab active" href="\/coyote\/costs\?tab=executive"/, 'unknown falls back to executive');
});

test('the centre is COMPLETE — NO tab renders a pending note (C2 + C3 shipped: Cost Forecast, Suppliers, COGS, Recipe Margins)', () => {
  const db = makeDb();
  for (const tab of ['executive', 'forecast', 'cogs', 'margins', 'suppliers', 'fixed', 'cash']) {
    assert.ok(!render(db, { tab }).includes('C2/C3 build pending'), `${tab} is built — no pending note`);
  }
});

test('registry: Reports nav order ends …reservations, labour, costs; the costs icon is the ruled path; server.js requires the page after reservations', () => {
  const coyote = S.WORKSPACES.find((w) => w.key === 'coyote');
  const reports = coyote.groups.find((g) => g.group === 'Reports');
  assert.deepEqual(reports.items.map((i) => i.key), ['revenue', 'labour', 'costs', 'reservations', 'operations', 'inventory', 'customer-growth', 'kitchen-safety', 'report-library', 'files'], 'Reports order — costs after labour');
  const costs = reports.items.find((i) => i.key === 'costs');
  assert.equal(costs.route, '/coyote/costs');
  assert.equal(costs.label, 'Costs');
  assert.equal(costs.ico, '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>');
  const src = fs.readFileSync(path.join(__dirname, '../mission-control/server.js'), 'utf8');
  const a = src.indexOf(`require('./ui/pages/coyote/reservations.js')`);
  const b = src.indexOf(`require('./ui/pages/coyote/costs.js')`);
  assert.ok(a >= 0 && b > a, 'server.js requires costs.js after reservations.js');
});

// ---------------- (b) KPI arithmetic + caption ----------------

test('executive KPIs: prime cost 45.0% = COGS 20.0% + labour 25.0%; contribution £50,000; overheads £20,000; break-even week £6,923 — hand-computed', () => {
  const db = makeDb(); seedExec(db);
  const body = render(db);
  assert.ok(body.includes('>45.0%<'), 'prime cost = 20.0 + 25.0 = 45.0%');
  assert.ok(body.includes('>20.0%<'), 'COGS % = 2,000,000 / 10,000,000 = 20.0%');
  assert.ok(body.includes('>25.0%<'), 'labour % = 2,500,000 / 10,000,000 = 25.0%');
  assert.ok(body.includes('>£50,000<'), 'contribution = 100,000 − 20,000 − 25,000 − 5,000 variable');
  assert.ok(body.includes('>£20,000<'), 'overheads month = fixed 10,000 + semi 5,000 + variable 5,000');
  // break-even week = (1,500,000p ÷ 0.5) × 12/52 = 692,307.69…p → rounds at display to £6,923
  assert.ok(body.includes('>£6,923<'), 'break-even week hand-computed');
});

test('executive caption states the month + BOTH bases (COGS base + labour base) — pinned', () => {
  const db = makeDb(); seedExec(db);
  const body = render(db);
  // 2026-08-19: the reference month must be calendar-complete AND POSTED. Jul 2026 was
  // calendar-complete on 1 Aug but only ~40% booked, and the executive rendered COGS 5.3% against a
  // ~28% run rate off it. The wording changed with the rule.
  assert.ok(body.includes('month = Jun 2026 (the latest complete AND posted month on the day-net record)'), 'the month is stated');
  assert.ok(body.includes('COGS = QB Cost-of-Goods-Sold accounts, qb_pl_monthly ÷ that net'), 'the COGS basis is stated');
  assert.ok(body.includes('labour = labour_day TRUE month £25,000.00 (locked rates × burden + salaried/365'), 'the labour basis is stated with the TRUE ruler');
  assert.ok(body.includes('prime cost = COGS % + labour % on the ONE net base'), 'the one-net-base rule is stated');
  assert.ok(body.includes('break-even week = (fixed + semi-fixed overheads ÷ contribution-margin ratio) × 12⁄52 — a derivation'), 'the break-even derivation is captioned');
});

// ---------------- (c) the monthly-grain statement ----------------

test('monthly grain: the trend panel states the QB month grain in sub AND note — the mock weekly frame renders monthly', () => {
  const db = makeDb(); seedExec(db);
  const body = render(db);
  assert.ok(body.includes('MONTHLY grain (QB month-grain ledger'), 'grain stated in the panel sub');
  assert.ok(body.includes('monthly grain stated — QB is a month-grain ledger'), 'grain stated in the note');
  for (const lab of ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026']) {
    assert.ok(body.includes(`class="cst-mlabel">${lab}<`), `trend month column ${lab}`);
  }
});

// ---------------- (d) the attention queue ----------------

test('attention queue: supplier day-span delta from the seeded world (£2,000 vs £10,000 = −£8,000); the beyond-day-span decoy never enters the average', () => {
  const db = makeDb(); seedExec(db);
  const body = render(db);
  assert.ok(body.includes('Supplier spend delta — Booker'), 'the largest mover is named');
  assert.ok(body.includes('Jul 2026 to day 20: £2,000'), 'MTD spend, day span stated');
  // avg = 3 × 1,000,000 ÷ 3 = £10,000. Had the 2026-06-25 decoy leaked in: (1,000,000 +
  // 1,000,000 + 1,500,000)/3 = £11,667 — the bug this pin exists to catch.
  assert.ok(body.includes('3-month average £10,000'), 'same-day-span average — the decoy excluded');
  assert.ok(!body.includes('£11,667'), 'the beyond-day-span decoy must not enter');
  assert.ok(body.includes('−£8,000'), 'delta hand-computed');
});

test('attention queue: the fee-collapse finding carries the real £-scale from the seeded journal', () => {
  const db = makeDb(); seedExec(db);
  const body = render(db);
  assert.ok(body.includes('Processor fees vanished from the ledger — net settlement'), 'the finding fires');
  assert.ok(body.includes('ran £1,500/month (card-fee scale), then collapsed to £30/month over May 2026–Jun 2026'), 'both £-scales + the window stated');
});

test('attention queue: rent-step days-until DERIVES from ctx.now (two NOWs 10 days apart differ by 10) + both amounts', () => {
  const db = makeDb(); seedExec(db);
  const body = render(db);
  // NOW = 2026-07-22T12:00Z → 2026-10-28T00:00Z = 97.5d → ceil 98
  assert.ok(body.includes('£60,000 → £65,000/yr from 2026-10-28 — 98 day(s) away'), 'both amounts + the derived day count');
  const earlier = render(db, {}, NOW - 10 * DAY);
  assert.ok(earlier.includes('£60,000 → £65,000/yr from 2026-10-28 — 108 day(s) away'), '10 days earlier → 108 — derived, never hardcoded');
});

test('attention queue: recipe availability is checked live and only complete recipes clear the prompt', () => {
  const db = makeDb(); seedExec(db);
  const body = render(db);
  assert.ok(body.includes('Recipe costing is not available yet'), 'the live empty state is shown');
  assert.ok(body.includes('No recipes have been added'), 'the copy accurately describes the empty recipe book');
  assert.ok(body.includes('/coyote/recipes'), 'pointing at the recipes worklist');
  // A line alone is not enough: the product and ingredient inputs must make a complete recipe.
  db.prepare(`INSERT INTO recipe_lines VALUES ('p1','s1',1.0)`).run();
  assert.ok(render(db).includes('Recipe costing needs complete ingredient details'), 'an incomplete recipe is reported accurately');
  db.prepare(`INSERT INTO products VALUES ('p1','SKU1','Burger','Food')`).run();
  db.prepare(`INSERT INTO sub_items VALUES ('s1','Bun',50,1,'each')`).run();
  const complete = render(db);
  assert.ok(!complete.includes('Recipe costing needs complete ingredient details'), 'a complete recipe clears the prompt');
  assert.ok(complete.includes('Recipe comparison is available for 1 completely costed product(s)'), 'the bridge copy reflects live availability');
});

// ---------------- (e) bridge arithmetic ----------------

test('profitability bridge: £100,000 − £20,000 − £25,000 − £20,000 = £35,000 site contribution; recipe comparison copy is live', () => {
  const db = makeDb(); seedExec(db);
  const body = render(db);
  const wf = body.slice(body.indexOf('class="waterfall"'), body.indexOf('Cost mix'));
  assert.ok(wf.includes('>£100,000<'), 'revenue bar');
  assert.ok(wf.includes('>−£20,000<'), 'COGS bar (negative)');
  assert.ok(wf.includes('>−£25,000<'), 'labour bar (negative, import)');
  assert.match(wf, /wf-col total"><div class="wf-bar"[^>]*><div class="wf-val">£35,000</, 'contribution = after ALL overheads, the total bar');
  assert.ok(wf.includes('Recipe comparison is not available yet because no recipes have been added'), 'the live empty-state note');
  assert.doesNotMatch(wf, /recipe_lines|Calum gate/, 'no storage or project shorthand reaches the operator');
});

// ---------------- ratios ----------------

test('core control ratios: the COGS arrow reads Jun 20.0% vs the 3-month average 25.0% — hand-computed', () => {
  const db = makeDb(); seedExec(db);
  const body = render(db);
  assert.ok(body.includes('▼ 5.0% vs 3-mo avg 25.0%'), 'COGS ratio arrow vs Mar–May average');
  assert.ok(body.includes('>£35,000<'), 'site contribution £ lives in the ratio grid (one home)');
});

// ---------------- (i) import pointers — one home per fact ----------------

test('import pointers: the labour month £ renders ONCE (2dp beside /coyote/labour); the revenue month £ once beside /coyote/revenue', () => {
  const db = makeDb(); seedExec(db);
  const body = render(db);
  assert.equal(count(body, '£25,000.00'), 1, 'the labour TRUE month £ appears exactly once (the pointer caption)');
  assert.equal(count(body, '£100,000.00'), 1, 'the revenue month £ appears exactly once');
  assert.ok(body.includes('href="/coyote/labour"'), 'the labour pointer');
  assert.ok(body.includes('href="/coyote/revenue"'), 'the revenue pointer');
  assert.ok(body.includes('the labour story lives in'), 'stated as an import, not a home');
  assert.ok(!body.includes('Rota vs Actual'), 'no duplicated labour panel');
});

// ---------------- the June-hole honesty path ----------------

test('a month without labour_day rows: labour/prime/contribution/break-even stay empty, stated — never bridged', () => {
  const db = makeDb(); seedExec(db);
  db.exec(`DELETE FROM labour_day WHERE business_date LIKE '2026-06%'`);
  const body = render(db);
  assert.ok(body.includes('labour_day has NO rows for Jun 2026'), 'the hole is stated');
  assert.ok(!body.includes('>45.0%<'), 'no prime cost from a half-based month');
  assert.ok(body.includes('month(s) without a labour_day record show no labour/contribution bar: Jun 2026'), 'the trend states the hole');
  assert.ok(body.includes('Bridge needs revenue, COGS, labour and overheads for the SAME month'), 'the bridge refuses a partial month');
});

// ---------------------------------------------------------------------------------------------
// FIXED & SEMI-FIXED fixture.
//   qb_pl_monthly: Rent (205) 500,000/mo for 2026-02..06 + 250,000 for 2026-07 (the now-month
//   → '(in progress)'); Lighting 300,000 in 2026-06. DECOYS that must NOT render as overheads:
//   Wages and Salaries (204) (payroll-class) + Cost of sales (203) (COGS-class), both 2026-06.
//   Journal rent aggregation (the gap-map rule): Rent (205) 1,500,000 + Rent + SC Clearing
//   Account 186,325 → £16,863 over the trailing 12 ledger months.
//   Rates observed: Highland Council bank payments 379,000 × 3 (Apr/May/Jun) + a 1,000 decoy
//   below the £100 floor → n = 3, median £3,790.
// ---------------------------------------------------------------------------------------------
function seedFixed(db) {
  const ac = db.prepare(`INSERT INTO qb_accounts (realm_id, account_id, name, acct_type, classification) VALUES ('r1',?,?,?,?)`);
  ac.run('10', 'Rent (205)', 'Expense', 'Expense');
  ac.run('11', 'Lighting and Heating (205)', 'Expense', 'Expense');
  ac.run('77', 'Wages and Salaries (204)', 'Expense', 'Expense');
  ac.run('60', 'Cost of sales (203)', 'Cost of Goods Sold', 'Expense');
  const pl = db.prepare(`INSERT INTO qb_pl_monthly (realm_id, month, account_id, account_name, net_pence) VALUES ('r1',?,?,?,?)`);
  for (const ym of ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06']) pl.run(ym, '10', 'Rent (205)', 500000);
  pl.run('2026-07', '10', 'Rent (205)', 250000);
  pl.run('2026-06', '11', 'Lighting and Heating (205)', 300000);
  pl.run('2026-06', '77', 'Wages and Salaries (204)', 1000000);
  pl.run('2026-06', '60', 'Cost of sales (203)', 2000000);
  const jl = db.prepare(`INSERT INTO qb_journal_lines (realm_id, period_month, txn_date, account_id, account_name, debit_pence) VALUES ('r1',?,?,?,?,?)`);
  jl.run('2026-05', '2026-05-01', '10', 'Rent (205)', 1500000);
  jl.run('2026-05', '2026-05-01', '99', 'Rent + SC Clearing Account', 186325);
  const bk = db.prepare(`INSERT INTO qb_bank_txns (realm_id, txn_kind, txn_id, txn_date, total_pence, counterparty) VALUES ('r1','purchase',?,?,?,?)`);
  bk.run('h1', '2026-04-28', 379000, 'Highland Council');
  bk.run('h2', '2026-05-28', 379000, 'Highland Council');
  bk.run('h3', '2026-06-29', 379000, 'Highland Council');
  bk.run('h4', '2026-06-11', 1000, 'Highland Council'); // below the £100 floor — excluded
}

test('fixed tab: overheads table = trailing 6 + current (in progress); Rent classed Fixed at £5,000; payroll + COGS accounts NEVER render as overheads', () => {
  const db = makeDb(); seedFixed(db);
  const body = render(db, { tab: 'fixed' });
  assert.ok(body.includes('Jul 2026 (in progress)'), 'the now-month column is labelled partial');
  assert.ok(body.includes('Rent (205)'), 'the rent account row');
  assert.ok(body.includes('>Fixed<'), 'rent classed Fixed (presentation judgment chip)');
  assert.equal(count(body, '>£5,000<'), 5, 'Feb–Jun rent cells at £5,000 each');
  assert.ok(!body.includes('Wages and Salaries (204)'), 'payroll-class excluded — labour has one home');
  assert.ok(!body.includes('Cost of sales (203)'), 'COGS-class excluded from overheads');
});

test('fixed tab: the behaviour map is captioned as a presentation judgment, not a ruling', () => {
  const db = makeDb(); seedFixed(db);
  const body = render(db, { tab: 'fixed' });
  assert.ok(body.includes('classification = presentation judgment, not a ruling'), 'the caption, verbatim');
});

test('fixed tab renewal calendar: the rent step (contractual, both amounts, ctx.now-derived days) + the journal rent aggregation + rates as observed cadence', () => {
  const db = makeDb(); seedFixed(db);
  const body = render(db, { tab: 'fixed' });
  assert.ok(body.includes('£60,000 → £65,000/yr from 2026-10-28 — 98 day(s) away'), 'the encoded step + derived days');
  assert.ok(body.includes('>contractual<'), 'basis chip: contractual');
  assert.ok(body.includes('lease canon (encoded, never derived)'), 'the canon basis stated');
  // journal aggregation: 1,500,000 + 186,325 = 1,686,325 → £16,863
  assert.ok(body.includes('ledger last 12 months £16,863 (Rent (205) + Rent + SC Clearing Account aggregated)'), 'the two rent accounts aggregate (gap-map rule)');
  assert.ok(body.includes('Highland Council'), 'the rates row');
  assert.ok(body.includes('£3,790 median'), 'median of the 3 real payments (the £10 decoy excluded)');
  assert.ok(body.includes('>observed<'), 'basis chip: observed');
  assert.ok(body.includes('observed cadence — 3 bank payment(s)'), 'observed count stated');
});

// ---------------------------------------------------------------------------------------------
// CASH COMMITMENTS fixture (NOW = 2026-07-22; bank max = 2026-07-20; window 2026-01-19 → 07-20).
//   'EnergyCo DD': 120,000 every 28d — 2026-02-11, 03-11, 04-08, 05-06, 06-03, 07-01 (6 days,
//     gaps all 28) → recurs: cadence 28d, median £1,200; projection from 07-01: 07-29, 08-26,
//     09-23, 10-21 (horizon = 2026-10-21) → next 2026-07-29, landing wk of 2026-07-27.
//   'HMRC': 900,000 every 30d — 02-10, 03-12, 04-11, 05-11, 06-10, 07-10 → cadence 30d, median
//     £9,000 → quarterly scale 900,000 × 91/30 = £27,300 → a large commitment (> £5k/qtr).
//     EnergyCo quarterly = 120,000 × 91/28 = £3,900 → NOT large.
//   PERSONS (the surveillance boundary): Mr Alpha One / Miss Beta Two / Mr Gamma Three —
//     200,000 on 05-01, 05-29, 06-26 each (28d) → pool into 'Staff payroll (3 payees,
//     aggregated)', combined median £6,000, next 07-24 (wk of 2026-07-20 ×3); NO name renders.
//   'OneOff Contractor': ONE payment 999,900 on 05-10 — history, must NEVER project.
//   'Misc Shop': one 5,000 purchase on 07-20 (sets bank max).
//   A 'deposit' decoy 777,777 must not enter any purchase figure.
//   P&L vs cash (Jun): journal expense 1,000,000 (£10,000) vs bank cash 120,000 + 900,000 +
//     3×200,000 = 1,620,000 (£16,200) → delta +£6,200.
//   Working capital (90d window 2026-04-22 → 07-20): 17 purchases, £58,649 total over 11
//     payment days; largest single = OneOff £9,999.
// ---------------------------------------------------------------------------------------------
function seedCash(db) {
  const bk = db.prepare(`INSERT INTO qb_bank_txns (realm_id, txn_kind, txn_id, txn_date, total_pence, counterparty) VALUES ('r1',?,?,?,?,?)`);
  let id = 0;
  for (const d of ['2026-02-11', '2026-03-11', '2026-04-08', '2026-05-06', '2026-06-03', '2026-07-01']) bk.run('purchase', `e${++id}`, d, 120000, 'EnergyCo DD');
  for (const d of ['2026-02-10', '2026-03-12', '2026-04-11', '2026-05-11', '2026-06-10', '2026-07-10']) bk.run('purchase', `h${++id}`, d, 900000, 'HMRC');
  for (const cp of ['Mr Alpha One', 'Miss Beta Two', 'Mr Gamma Three']) {
    for (const d of ['2026-05-01', '2026-05-29', '2026-06-26']) bk.run('purchase', `p${++id}`, d, 200000, cp);
  }
  bk.run('purchase', `o${++id}`, '2026-05-10', 999900, 'OneOff Contractor');
  bk.run('purchase', `m${++id}`, '2026-07-20', 5000, 'Misc Shop');
  bk.run('deposit', `d${++id}`, '2026-07-19', 777777, 'Card Settlement'); // must not count
  const ac = db.prepare(`INSERT INTO qb_accounts (realm_id, account_id, name, acct_type, classification) VALUES ('r1',?,?,?,?)`);
  ac.run('10', 'Rent (205)', 'Expense', 'Expense');
  db.prepare(`INSERT INTO qb_journal_lines (realm_id, period_month, txn_date, account_id, account_name, debit_pence) VALUES ('r1','2026-06','2026-06-15','10','Rent (205)',1000000)`).run();
}

// ---------------- (g) recurring-cadence projection ----------------

test('cash calendar: the 28-day counterparty projects from its observed cadence at the median £; the one-off decoy NEVER projects', () => {
  const db = makeDb(); seedCash(db);
  const body = render(db, { tab: 'cash' });
  // the recurring summary row: 6 payment days · ~28d · £1,200 · next 2026-07-29
  const row = body.slice(body.indexOf('EnergyCo DD'), body.indexOf('EnergyCo DD') + 400);
  assert.ok(row.includes('>6<'), '6 payment days in the window');
  assert.ok(row.includes('~28d'), 'the observed cadence');
  assert.ok(row.includes('£1,200'), 'the median day-£');
  assert.ok(row.includes('2026-07-29'), 'next = last payment (07-01) + 28d');
  assert.ok(row.includes('projected from observed cadence'), 'every projected row carries the basis');
  // the weekly calendar: EnergyCo lands in wk of 2026-07-27 at £1,200
  const wk = body.slice(body.indexOf('wk of 2026-07-27'), body.indexOf('wk of 2026-08-03'));
  assert.ok(wk.includes('£1,200') && wk.includes('EnergyCo DD'), 'the projection lands in its week');
  // the one-off decoy: history, never a projection. Scoped to the CALENDAR panel (recurring
  // summary + 13-week projection) — the working-capital panel legitimately surfaces it as the
  // largest single outflow HISTORY, which is a different, honest display.
  const calRegion = body.slice(body.indexOf('13-week cash commitment calendar'), body.indexOf('Accounts payable ageing'));
  assert.ok(!calRegion.includes('OneOff Contractor'), 'a one-off never projects (and never lists as recurring) in the calendar');
});

test('cash calendar: person-named payees pool into ONE Staff-payroll aggregate — no person name ever renders (the surveillance boundary)', () => {
  const db = makeDb(); seedCash(db);
  const body = render(db, { tab: 'cash' });
  assert.ok(body.includes('Staff payroll (3 payees, aggregated)'), 'the pooled line');
  assert.ok(body.includes('£6,000'), 'combined median 3 × £2,000');
  for (const nm of ['Mr Alpha One', 'Miss Beta Two', 'Mr Gamma Three']) assert.ok(!body.includes(nm), `${nm} never renders`);
  const wk0 = body.slice(body.indexOf('wk of 2026-07-20'), body.indexOf('wk of 2026-07-27'));
  assert.ok(wk0.includes('Staff payroll ×3'), 'the three payees land pooled (06-26 + 28d = 07-24)');
});

test('cash: the rent line is contractual canon (both amounts, ctx.now-derived days), dates never projected', () => {
  const db = makeDb(); seedCash(db);
  const body = render(db, { tab: 'cash' });
  assert.ok(body.includes('£60,000 → £65,000/yr from 2026-10-28 — 98 day(s) away'), 'the step, derived days');
  assert.ok(body.includes('payment dates are observed when they land, never projected'), 'the rent honesty line');
  const later = render(db, { tab: 'cash' }, NOW - 10 * DAY);
  assert.ok(later.includes('108 day(s) away'), 'days derive from ctx.now');
});

// ---------------- (h) AP ageing ----------------

test('AP ageing: the mapped empty-state, verbatim', () => {
  const db = makeDb(); seedCash(db);
  const body = render(db, { tab: 'cash' });
  assert.ok(body.includes('QB Bills not in use — 8 rows since 2022'), 'the ruled wording');
  assert.ok(body.includes('pays suppliers direct from the bank'), 'the corrected premise stated');
});

// ---------------- P&L vs cash + large commitments + working capital ----------------

test('P&L cost vs cash paid: Jun journal £10,000 vs bank £16,200 → delta +£6,200 (basis + timing stated); deposits never count', () => {
  const db = makeDb(); seedCash(db);
  const body = render(db, { tab: 'cash' });
  const row = body.slice(body.indexOf('>Jun 2026<'), body.indexOf('>Jun 2026<') + 300);
  assert.ok(row.includes('£10,000'), 'journal expense side');
  assert.ok(row.includes('£16,200'), 'bank cash side — the 777,777 deposit decoy excluded');
  assert.ok(row.includes('+£6,200'), 'the delta');
  assert.ok(body.includes('the delta is BASIS + TIMING, stated not hidden'), 'the honesty caption');
});

test('large commitments: HMRC at ~£27,300/quarter qualifies (> £5k); the £3,900/quarter pattern does not; the rent step always rows', () => {
  const db = makeDb(); seedCash(db);
  const body = render(db, { tab: 'cash' });
  const big = body.slice(body.indexOf('Upcoming large commitments'), body.indexOf('Working-capital controls'));
  assert.ok(big.includes('HMRC') && big.includes('£27,300'), 'HMRC: 900,000 × 91/30 = £27,300/quarter');
  assert.ok(!big.includes('EnergyCo DD'), 'EnergyCo at £3,900/quarter stays below the £5k bar');
  assert.ok(big.includes('£16,250') && big.includes('£15,000'), 'the rent quarters: 65,000/4 from the step, 60,000/4 now');
});

test('working-capital controls: the honest cash-out set — £58,649 over 17 purchases / 11 days, largest £9,999; debtors n/a — cash business', () => {
  const db = makeDb(); seedCash(db);
  const body = render(db, { tab: 'cash' });
  assert.ok(body.includes('>£58,649<'), '90d cash out (hand-summed; the deposit decoy excluded)');
  assert.ok(body.includes('17 bank purchase(s) over 11 payment day(s)'), 'counts hand-computed');
  assert.ok(body.includes('£9,999') && body.includes('OneOff Contractor · 2026-05-10'), 'largest single outflow — one-off HISTORY renders as history, never as a projection');
  assert.ok(body.includes('n/a — cash business'), 'the debtor side stated honestly');
});

// ---------------- (j) empty DB — no mock numbers ----------------

test('empty DB: the ONLY £ digits anywhere are the ENCODED rent canon; every KPI value is —', () => {
  const db = makeDb();
  const allowed = new Set(['£60,000', '£65,000', '£16,250', '£15,000']); // contractual constants only
  for (const tab of TABS_ALL) {
    const body = render(db, { tab });
    for (const hit of body.match(/£[\d,]+(\.\d\d)?/g) || []) {
      assert.ok(allowed.has(hit), `${tab}: '${hit}' must be encoded canon, never a derived/mock number`);
    }
  }
  const body = render(db);
  for (const v of body.match(/r-kpi-value">([^<]*)</g) || []) assert.ok(v.includes('—'), `empty KPI renders — (got ${v})`);
  assert.ok(body.includes('no day-net sales record yet'), 'the honest no-month state');
});
const TABS_ALL = ['executive', 'forecast', 'cogs', 'margins', 'suppliers', 'fixed', 'cash'];

// --- PURCHASE-FEED POSTING GATE (2026-08-19, data-wiring audit) --------------------------------
// The supplier delta is like-for-like on DAY-SPAN but was not on POSTING. Bank purchases have been
// ~80% un-posted since 2026-07-07 (Jul £20,564 against a Feb–Jun mean of £117,023; Aug 1–18 £3,849
// against ~£67,948 pro-rata — about £160,558 of supplier cash-out simply not in QuickBooks). With
// the current side near-empty EVERY supplier reads as a collapse, and the queue's TOP alert became
// a green "£12,471 Booker saving" — the absence of data wearing the costume of good news.
//
// THE CLASS: a delta whose `cur` side is missing is not a delta. Gate on whether the WINDOW is
// posted, not on the individual supplier, and say so in place of the alert — a silently absent
// alert reads as "nothing to report", which is the same lie more quietly.
test('posting gate: an un-posted purchase window withholds the supplier delta and explains itself', () => {
  const db = makeDb(); seedExec(db);
  // Strip the steady supplier's CURRENT month only: overall posting collapses while the prior
  // months stay intact — exactly the live shape.
  db.prepare(`DELETE FROM qb_bank_txns WHERE counterparty='Steady Dairy' AND txn_date >= '2026-07-01'`).run();
  const ctx = { q: (sql, pp) => DATA.safeSelect(db, sql, pp), now: NOW, query: {} };
  const sp = page.getSection(db, ctx).exec.queue.supplierPosting;
  assert.equal(sp.posted, false, 'the window must be judged un-posted');
  assert.ok(sp.postedRatio < 0.5, `ratio ${sp.postedRatio} should be below the half-of-normal floor`);
  assert.equal(page.getSection(db, ctx).exec.queue.supplier, null, 'and the delta must NOT be offered');

  const body = render(db);
  assert.ok(body.includes('withheld, the purchase feed is behind'), 'the queue says the alert was withheld');
  assert.ok(body.includes('un-posted bookkeeping, not reduced spending'), 'and names what the gap really is');
  assert.ok(!body.includes('Supplier spend delta — Booker'), 'the fabricated saving must not render');
});

test('POSITIVE CONTROL: a healthy purchase window still reports a genuine supplier collapse', () => {
  const db = makeDb(); seedExec(db);
  const ctx = { q: (sql, pp) => DATA.safeSelect(db, sql, pp), now: NOW, query: {} };
  const q2 = page.getSection(db, ctx).exec.queue;
  assert.equal(q2.supplierPosting.posted, true, 'the gate must not refuse a posted window');
  assert.ok(q2.supplier, 'a real single-supplier delta still surfaces');
  assert.equal(q2.supplier.cp, 'Booker');
});
