'use strict';
// Costs — the COSTS & SUPPLIER COMMAND CENTRE (C1, built from the Stage-1 gap map
// docs/costs-centre/gap-map.md + the operator mocks reference/mock-*.png). ONE route
// (/coyote/costs), seven subtabs per the mock:
//   executive (default) · forecast · cogs · margins · suppliers · fixed · cash
// C1 SCOPE: the shell + EXECUTIVE + FIXED & SEMI-FIXED + CASH COMMITMENTS fully built (the
// QB-strong core); forecast/cogs/margins/suppliers each render ONE pending note (the C2/C3
// split) — no frame theatre, no mock digits.
// THE WIRES (all probed, gap map — binding):
//   • qb_pl_monthly — POPULATED (93 months 2018-11 → 2026-07 in the golden snapshot), joined
//     to qb_accounts for classification/acct_type. THE account-month P&L source for COGS,
//     overheads, cost mix. CAVEAT (probed): QB income accounts stop posting after Apr 2026 —
//     REVENUE therefore ALWAYS comes from v_sales_day_all (the day-net canon), never QB income.
//   • qb_journal_lines (55,822 lines, 8yr) — the rent aggregation ('Rent (205)' + 'Rent + SC
//     Clearing Account', quarterly-billed via Workman) + the fee-collapse finding ('Bank
//     charges (207)' — card-fee-scale until Apr 2026, then net settlement) + P&L-vs-cash.
//   • qb_bank_txns purchases by counterparty — the supplier/outflow TRUTH (8yr; Booker-led).
//     The 13-week cash calendar derives from RECURRING bank-outflow patterns (the corrected
//     premise) — NEVER from bill due dates: qb_bills is DEAD (8 rows, all 2022) and AP ageing
//     is a designed empty-state saying exactly that.
//   • labour_day (TRUE ruler: locked rates × burden + salaried/365) + v_sales_day_all IMPORT
//     as summary pointers — one home per fact: the labour story lives in /coyote/labour, the
//     revenue story in /coyote/revenue; each month £ renders ONCE here, beside its pointer.
//   • recipe_lines + products + sub_items + the canonical item-sales feed — live recipe
//     economics, with complete recipes validated before any theoretical cost or margin is shown.
// MONTH-GRAIN HONESTY (ruled): QB is month-grain — the mock's "13-week" executive frame
// renders as TRAILING MONTHS with the grain stated in the sub; weekly figures exist only
// where a wire supports them (the bank-truth cash calendar) or as stated derivations.
// CLASSIFICATION HONESTY: fixed / semi-fixed / variable is a PRESENTATION JUDGMENT, captioned
// as such on every panel that uses it — never a ruling. Payroll-class QB accounts are
// excluded from overheads (labour's one home is the Labour Centre on the TRUE basis) — also
// a stated judgment.
// Contract: { key, route, workspace, title, sub, getSection, render }. SELECT-only via ctx.q.
const S = require('../../shared.js');
const REP = require('../../reporting.js');
const K = require('../../kpi.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
const MONTHS_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(ym) { const m = String(ym || '').match(/^(\d{4})-(\d{2})$/); return m ? `${MONTHS_ABBR[Number(m[2])] || m[2]} ${m[1]}` : String(ym || ''); }
/** Shift 'YYYY-MM' by n months. */
function monthShift(ym, n) {
  const y = Number(ym.slice(0, 4)); const m = Number(ym.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}
/** The latest COMPLETE calendar month on a day-grain record: the max date's own month when the
 *  max date is that month's final day, else the month before. */
function refMonthOf(maxIso) {
  if (!maxIso) return null;
  if (K.shiftDays(maxIso, 1).slice(8, 10) === '01') return maxIso.slice(0, 7);
  return monthShift(maxIso.slice(0, 7), -1);
}

// POSTING COMPLETENESS (2026-08-19, data-wiring audit). refMonthOf answers "is this month over?" —
// a CALENDAR question. Nobody was asking the accrual one: "has it been BOOKED?" Jul 2026 was
// calendar-complete on 1 Aug but held 359 of ~620 journal lines and 16 of ~24 expense accounts, so
// the Costs executive rendered COGS 5.3% against a ~28% run rate, prime cost 32.5% and a
// contribution of £96,881 — every figure fiction, and every one of them presented without caveat.
//
// A month is SETTLED when its journal-line count and its expense-account count are each at least
// this share of the median of the six preceding months. Both, because either alone can look healthy:
// a month can carry plenty of lines from one busy supplier while most cost accounts are still empty.
const SETTLED_FLOOR = 0.7;

/** The latest month that is BOTH calendar-complete and posted, walking back from `startYm`.
 *  Returns { ym, unsettled: [months skipped] } so the surface can say what it stepped over —
 *  silently choosing an older month would be its own kind of lie. */
function settledMonthFrom(q, startYm, rowsOf, num) {
  if (!startYm) return { ym: null, unsettled: [] };
  const stat = (ym) => {
    const r = rowsOf(q(
      `SELECT (SELECT COUNT(*) FROM qb_journal_lines WHERE period_month = ?) lines,
              (SELECT COUNT(DISTINCT account_name) FROM qb_pl_monthly WHERE month = ?) accts`,
      [ym, ym]))[0] || {};
    return { lines: num(r.lines) || 0, accts: num(r.accts) || 0 };
  };
  const unsettled = [];
  let ym = startYm;
  for (let step = 0; step < 6; step += 1) {              // bounded: never walks off into history
    const cur = stat(ym);
    const prior = [];
    for (let i = 1; i <= 6; i += 1) prior.push(stat(monthShift(ym, -i)));
    const medLines = median(prior.map((p) => p.lines).filter((n) => n > 0));
    const medAccts = median(prior.map((p) => p.accts).filter((n) => n > 0));
    // No baseline to judge against → accept rather than invent a verdict.
    if (medLines == null || medAccts == null) return { ym, unsettled };
    if (cur.lines >= medLines * SETTLED_FLOOR && cur.accts >= medAccts * SETTLED_FLOOR) {
      return { ym, unsettled };
    }
    unsettled.push({ ym, lines: cur.lines, medLines: Math.round(medLines), accts: cur.accts, medAccts: Math.round(medAccts) });
    ym = monthShift(ym, -1);
  }
  return { ym, unsettled };
}
function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

const readCanonicalItemSales = S.readCanonicalItemSales;

/** Recipe economics shared by Recipe Margins and COGS & Inventory. A recipe is complete only
 *  when it has at least one line and every line has a positive recipe quantity, a matching
 *  ingredient, a non-negative pack cost and a positive pack quantity. Product costs round once
 *  to integer pence before they are multiplied by sold units, matching the recipes worklist. */
function buildRecipeEconomics(q, refMonth) {
  const lineCountRes = q(`SELECT COUNT(*) c FROM recipe_lines`);
  const lineCountRow = rowsOf(lineCountRes)[0];
  const recipeLines = lineCountRes && lineCountRes.ok && lineCountRow && num(lineCountRow.c) != null
    ? Math.max(0, Math.trunc(num(lineCountRow.c)))
    : null;
  const productsRow = rowsOf(q(`SELECT COUNT(*) c FROM products`))[0];
  const subItemsRow = rowsOf(q(`SELECT COUNT(*) c FROM sub_items`))[0];
  const out = {
    recipeLines,
    products: productsRow && num(productsRow.c) != null ? num(productsRow.c) : 0,
    subItems: subItemsRow && num(subItemsRow.c) != null ? num(subItemsRow.c) : 0,
    costedProducts: 0,
    salesMax: null,
    window: null,
    allNet: null,
    coveredNet: null,
    coveragePct: null,
    costed: [],
    coveredTotals: null,
    leaderboard: [],
    leaderboardTotals: null,
    matrix: null,
    costBuild: null,
    monthly: null,
  };

  const recipeRows = rowsOf(q(
    `SELECT p.id, CAST(p.lightspeed_sku AS TEXT) sku, p.name,
            COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorised') category,
            COUNT(rl.product_id) recipe_line_count,
            SUM(CASE WHEN rl.product_id IS NOT NULL AND
                          (si.id IS NULL OR si.pack_cost_pence IS NULL OR si.pack_cost_pence < 0
                           OR si.pack_qty IS NULL OR si.pack_qty <= 0
                           OR rl.quantity IS NULL OR rl.quantity <= 0)
                     THEN 1 ELSE 0 END) invalid_line_count,
            SUM(rl.quantity * CAST(si.pack_cost_pence AS REAL) / si.pack_qty) unit_cost_pence
       FROM products p
       LEFT JOIN recipe_lines rl ON rl.product_id = p.id
       LEFT JOIN sub_items si ON si.id = rl.sub_item_id
      GROUP BY p.id, CAST(p.lightspeed_sku AS TEXT), p.name, p.category`));
  const completeCandidates = recipeRows
    .filter((r) => (num(r.recipe_line_count) || 0) > 0
      && (num(r.invalid_line_count) || 0) === 0
      && num(r.unit_cost_pence) != null)
    .map((r) => ({
      id: String(r.id), sku: r.sku == null ? '' : String(r.sku),
      name: String(r.name || r.sku || r.id), category: String(r.category || 'Uncategorised'),
      unitCostPence: Math.round(num(r.unit_cost_pence)),
      net: 0, units: 0, achievedPricePence: null, gpPence: null, marginPct: null, costPct: null,
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku) || a.id.localeCompare(b.id));
  // A canonical SKU contributes at most once even if duplicate/alias product records exist.
  const canonicalRecipes = new Map();
  const complete = [];
  for (const product of completeCandidates) {
    if (product.sku && canonicalRecipes.has(product.sku)) continue;
    if (product.sku) canonicalRecipes.set(product.sku, product);
    complete.push(product);
  }
  out.costedProducts = complete.length;

  const itemSales = readCanonicalItemSales(q);
  out.salesMax = itemSales.to;
  const salesRows = itemSales.rows;
  if (itemSales.from && itemSales.to) {
    out.window = { from: itemSales.from, to: itemSales.to };
    out.allNet = salesRows.reduce((sum, r) => sum + r.net, 0);
  }
  const salesBySku = new Map(salesRows.map((r) => [String(r.sku), {
    net: num(r.net) || 0, units: num(r.units) || 0,
  }]));
  const completeBySku = new Map();
  for (const p of complete) {
    const sale = salesBySku.get(p.sku);
    p.net = sale ? sale.net : 0;
    p.units = sale ? sale.units : 0;
    p.achievedPricePence = p.units > 0 ? p.net / p.units : null;
    p.gpPence = p.achievedPricePence != null ? p.achievedPricePence - p.unitCostPence : null;
    p.marginPct = p.achievedPricePence > 0 && p.gpPence != null
      ? (p.gpPence / p.achievedPricePence) * 100 : null;
    p.costPct = p.achievedPricePence > 0 ? (p.unitCostPence / p.achievedPricePence) * 100 : null;
    if (p.sku) completeBySku.set(p.sku, p);
  }
  complete.sort((a, b) => b.net - a.net || a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));
  out.costed = complete;
  out.coveredNet = out.allNet == null
    ? null
    : salesRows.reduce((sum, r) => sum + (completeBySku.has(String(r.sku)) ? (num(r.net) || 0) : 0), 0);
  out.coveragePct = out.allNet > 0 && out.coveredNet != null ? (out.coveredNet / out.allNet) * 100 : null;
  out.leaderboard = complete.slice(0, 20);

  const totalsFor = (list) => {
    const units = list.reduce((sum, p) => sum + p.units, 0);
    const netSales = list.reduce((sum, p) => sum + p.net, 0);
    const recipeCost = list.reduce((sum, p) => sum + p.units * p.unitCostPence, 0);
    const achievedPricePence = units > 0 ? netSales / units : null;
    const unitCostPence = units > 0 ? recipeCost / units : null;
    return {
      units, net: netSales, recipeCost,
      unitCostPence,
      achievedPricePence,
      gpPence: achievedPricePence != null && unitCostPence != null ? achievedPricePence - unitCostPence : null,
      marginPct: achievedPricePence > 0 && unitCostPence != null
        ? ((achievedPricePence - unitCostPence) / achievedPricePence) * 100 : null,
      costPct: netSales > 0 ? (recipeCost / netSales) * 100 : null,
    };
  };
  out.coveredTotals = totalsFor(complete);
  out.leaderboardTotals = totalsFor(out.leaderboard);

  const plottable = complete.filter((p) => p.units > 0 && p.net > 0 && p.gpPence != null);
  if (plottable.length) {
    const volumeMedian = median(plottable.map((p) => p.units));
    const gpMedianPence = median(plottable.map((p) => p.gpPence));
    const quadrants = {
      protect: { label: 'Protect', detail: 'High contribution/unit · high units', products: [] },
      promote: { label: 'Promote', detail: 'High contribution/unit · low units', products: [] },
      fix: { label: 'Fix', detail: 'Low contribution/unit · high units', products: [] },
      replace: { label: 'Replace', detail: 'Low contribution/unit · low units', products: [] },
    };
    for (const p of plottable) {
      const highVolume = p.units >= volumeMedian;
      const highGp = p.gpPence >= gpMedianPence;
      const key = highVolume ? (highGp ? 'protect' : 'fix') : (highGp ? 'promote' : 'replace');
      quadrants[key].products.push(p);
    }
    for (const quadrant of Object.values(quadrants)) {
      quadrant.products.sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
      quadrant.count = quadrant.products.length;
      quadrant.leaders = quadrant.products.slice(0, 3);
    }
    out.matrix = { volumeMedian, gpMedianPence, quadrants };
  }

  if (complete.length) {
    const top = complete[0];
    const lines = rowsOf(q(
      `SELECT si.name ingredient, rl.quantity, si.unit_of_measure,
              CAST(si.pack_cost_pence AS REAL) / si.pack_qty unit_cost_pence,
              rl.quantity * CAST(si.pack_cost_pence AS REAL) / si.pack_qty line_cost_pence
         FROM recipe_lines rl JOIN sub_items si ON si.id = rl.sub_item_id
        WHERE rl.product_id = ?
        ORDER BY line_cost_pence DESC, si.name`, [top.id]))
      .map((r) => ({
        ingredient: String(r.ingredient || ''), quantity: num(r.quantity) || 0,
        unit: String(r.unit_of_measure || ''), unitCostPence: num(r.unit_cost_pence),
        lineCostPence: num(r.line_cost_pence),
      }));
    out.costBuild = { ...top, lines };
  }

  if (refMonth) {
    const monthSales = readCanonicalItemSales(q, {
      from: `${refMonth}-01`, to: K.shiftDays(`${monthShift(refMonth, 1)}-01`, -1),
    }).rows;
    const allNet = monthSales.reduce((sum, r) => sum + (num(r.net) || 0), 0);
    let coveredNet = 0; let theoretical = 0;
    const byCategory = new Map();
    for (const r of monthSales) {
      const p = completeBySku.get(String(r.sku));
      if (!p) continue;
      const productNet = num(r.net) || 0;
      const productTheoretical = (num(r.units) || 0) * p.unitCostPence;
      coveredNet += productNet;
      theoretical += productTheoretical;
      byCategory.set(p.category, (byCategory.get(p.category) || 0) + productTheoretical);
    }
    out.monthly = {
      month: refMonth, allNet, coveredNet, theoretical,
      coveragePct: allNet > 0 ? (coveredNet / allNet) * 100 : null,
      byCategory: [...byCategory.entries()].map(([name, p]) => ({ name, p }))
        .sort((a, b) => b.p - a.p || a.name.localeCompare(b.name)),
    };
  }
  return out;
}

const TABS = [
  { key: 'executive', label: 'Executive' },
  { key: 'forecast', label: 'Cost Forecast' },
  { key: 'cogs', label: 'COGS & Inventory' },
  { key: 'margins', label: 'Recipe Margins' },
  { key: 'suppliers', label: 'Suppliers & Purchasing' },
  { key: 'fixed', label: 'Fixed & Semi-Fixed' },
  { key: 'cash', label: 'Cash Commitments' },
];
const TAB_KEYS = TABS.map((t) => t.key);
// All seven tabs are built (C1 Executive/Fixed/Cash · C2 Cost Forecast/Suppliers · C3 COGS/Recipe
// Margins). No pending tabs remain.
const PENDING_TABS = [];

// ---------------------------------------------------------------------------------------------
// THE RENT STEP — a CONTRACTUAL constant, HARD-ENCODED from the lease canon (the lease's rent
// review: £60,000/yr until 2026-10-27, £65,000/yr from 2026-10-28, quarterly-billed via the
// rent agent Workman). NEVER derived from any wire — the ledger shows payments, the LEASE sets
// the obligation; a derived figure would drift on billing noise. Single home for the canon.
// ---------------------------------------------------------------------------------------------
const RENT_STEP = {
  date: '2026-10-28',
  beforePenceYr: 6000000, // £60,000/yr — the current contractual rent
  afterPenceYr: 6500000,  // £65,000/yr — from the step date
  basis: 'contractual — lease canon (rent review), quarterly-billed via Workman',
};
function rentStepDaysUntil(now) {
  return Math.ceil((Date.parse(`${RENT_STEP.date}T00:00:00Z`) - now) / 86400000);
}

// The recipe gate (the Calum gate): theoretical costing is locked until recipe_lines holds
// rows; the standing carrot names the one-session unlock.
const RECIPE_CARROT = 'recipe costing: top-20 = 59.5% coverage, one session';

// The AP-ageing disposition — the mapped empty-state, verbatim (gap-map probe 1).
const AP_BLOCKER = 'QB Bills not in use — 8 rows since 2022. The venue pays suppliers direct from the bank; there is no bills ledger, so the cash calendar derives from recurring bank-outflow patterns + contractual lines instead.';

// The INVOICE-LINE gate (gap-map's named future build): QB category totals cannot show a unit
// price (beef £7.21 → £7.84/usable-kg). Purchase-price variance + ingredient price watch need
// invoice-LINE data (unit prices, pack sizes, yields → canonical ingredients, normalised units)
// — an ingest that does not yet exist. Candidate routes: K-Series purchase/inventory endpoints
// (currently 403, operations-scope-gated — re-probe on grant) OR invoice-document ingest (Booker
// portal exports → email-ingest → sub_items). Both dependent panels name THIS.
const INVOICE_LINE_BLOCKER = 'supplier invoice-LINE data (unit prices, pack sizes, yields) is not ingested — QB category totals cannot show a per-unit price. This is the named future build (invoice-line ingest → canonical ingredients).';
const INVOICE_LINE_UNLOCK = 'invoice-line ingest — K-Series purchase endpoints (currently operations-scope-gated) or Booker invoice-document ingest';

// ---------------------------------------------------------------------------------------------
// Account bucketing — PRESENTATION JUDGMENTS, captioned wherever they render.
//   bucket: cogs (QB Cost-of-Goods-Sold accounts) · labour (payroll-class names — excluded
//   from overheads; the TRUE labour home is the Labour Centre) · overhead (the rest).
//   behaviour (overheads only): fixed / semi / variable by account-name class.
// ---------------------------------------------------------------------------------------------
const PAYROLL_NAME_RE = /wage|salar|pension|national insurance|paye|recruitment|staff/i;
function bucketOf(acctType, name) {
  if (acctType === 'Cost of Goods Sold') return 'cogs';
  if (PAYROLL_NAME_RE.test(String(name || ''))) return 'labour';
  return 'overhead';
}
function behaviourOf(name) {
  const n = String(name || '').toLowerCase();
  if (/rent|rates|insurance|licen|subscription|software|accountanc|legal|professional|depreciation|amortis/.test(n)) return 'fixed';
  if (/light|heat|gas|electric|energy|water|telephone|broadband|repair|maintain|clean|waste|laundry/.test(n)) return 'semi';
  return 'variable';
}
const BEHAVIOUR_LABEL = { fixed: 'Fixed', semi: 'Semi-fixed', variable: 'Variable' };
const BEHAVIOUR_TONE = { fixed: 'info', semi: 'warn', variable: '' };

// Recurring bank-outflow detection (the corrected Cash-Commitments premise): a counterparty
// recurs when the 6-month purchase window holds ≥3 payment DAYS (same-day txns collapse to one)
// whose day-gaps sit near a regular cadence: median gap m in [2, 45] days and every gap within
// [max(1, 0.5m − 3), 1.5m + 3]. One-off history NEVER projects.
const RECUR_WINDOW_DAYS = 183;
function detectRecurrence(dayRows) {
  // dayRows: [{cp, d, p}] one row per counterparty × date (p = that day's total pence), any order.
  const byCp = new Map();
  for (const r of dayRows) {
    if (!byCp.has(r.cp)) byCp.set(r.cp, []);
    byCp.get(r.cp).push({ d: r.d, p: r.p });
  }
  const out = [];
  for (const [cp, days] of byCp) {
    if (days.length < 3) continue; // a one-off (or a pair) is history, not a pattern
    days.sort((a, b) => (a.d < b.d ? -1 : 1));
    const gaps = [];
    for (let i = 1; i < days.length; i++) {
      gaps.push(Math.round((Date.parse(`${days[i].d}T12:00:00Z`) - Date.parse(`${days[i - 1].d}T12:00:00Z`)) / 86400000));
    }
    const m = median(gaps);
    if (!(m >= 2 && m <= 45)) continue;
    const lo = Math.max(1, 0.5 * m - 3); const hi = 1.5 * m + 3;
    if (!gaps.every((g) => g >= lo && g <= hi)) continue;
    out.push({
      cp,
      n: days.length,
      cadenceDays: Math.round(m),
      medianPence: median(days.map((x) => x.p)),
      lastDate: days[days.length - 1].d,
      spendPence: days.reduce((s, x) => s + x.p, 0),
    });
  }
  out.sort((a, b) => b.spendPence - a.spendPence);
  return out;
}
/** Project a recurring pattern forward: lastDate + k·cadence for every date in (fromIso, toIso]. */
function projectDates(rec, fromIso, toIso) {
  const dates = [];
  for (let k = 1; k <= 400; k++) {
    const d = K.shiftDays(rec.lastDate, k * rec.cadenceDays);
    if (d > toIso) break;
    if (d > fromIso) dates.push(d);
  }
  return dates;
}

// ---------------------------------------------------------------------------------------------
// getSection builders — SELECT-only; every read degrades to an honest null on a missing table.
// ---------------------------------------------------------------------------------------------

/** Per-month QB expense rows (qb_pl_monthly ⋈ qb_accounts) bucketed cogs/labour/overhead,
 *  overheads split by behaviour. Returns Map ym → {cogs, labourQb, over, fixed, semi, variable,
 *  accounts:[{name, acctType, p}]}. */
function qbMonths(q, months) {
  const byYm = new Map();
  for (const ym of months) byYm.set(ym, { cogs: 0, labourQb: 0, over: 0, fixed: 0, semi: 0, variable: 0, any: false, accounts: [] });
  const rows = rowsOf(q(
    `SELECT p.month ym, p.account_name name, a.acct_type at, SUM(p.net_pence) p
       FROM qb_pl_monthly p JOIN qb_accounts a ON a.account_id = p.account_id AND a.realm_id = p.realm_id
      WHERE a.classification = 'Expense' AND p.month BETWEEN ? AND ?
      GROUP BY p.month, p.account_name, a.acct_type`, [months[0], months[months.length - 1]]));
  for (const r of rows) {
    const m = byYm.get(String(r.ym));
    if (!m) continue;
    const p = num(r.p) || 0;
    const bucket = bucketOf(String(r.at || ''), String(r.name || ''));
    m.any = true;
    m.accounts.push({ name: String(r.name || ''), acctType: String(r.at || ''), bucket, p });
    if (bucket === 'cogs') m.cogs += p;
    else if (bucket === 'labour') m.labourQb += p;
    else { m.over += p; m[behaviourOf(r.name)] += p; }
  }
  return byYm;
}

/** Month net from the day-net canon (v_sales_day_all, premises current) — null when no rows. */
function monthNet(q, ym) {
  const r = rowsOf(q(
    `SELECT SUM(net_sales_pence) net, COUNT(*) days FROM v_sales_day_all
      WHERE substr(business_date, 1, 7) = ? AND premises = 'current'`, [ym]))[0];
  return r && num(r.days) > 0 ? { net: num(r.net) || 0, days: num(r.days) } : null;
}

/** Month TRUE labour (labour_day, burdened) — null when the month has no rows (the June hole
 *  renders as an honest gap, never bridged). */
function monthLabour(q, ym) {
  const r = rowsOf(q(
    `SELECT SUM(actual_cost_pence) c, COUNT(*) days FROM labour_day WHERE substr(business_date, 1, 7) = ?`, [ym]))[0];
  return r && num(r.days) > 0 ? { cost: num(r.c) || 0, days: num(r.days) } : null;
}

// EXECUTIVE — KPI strip, trailing-6-month trend (the ruled monthly grain), owner attention
// queue (REAL findings), profitability bridge, cost mix, core control ratios.
function buildExecutive(q, now) {
  const mx = rowsOf(q(`SELECT MAX(business_date) d FROM v_sales_day_all WHERE premises = 'current'`))[0];
  const salesMax = mx && mx.d ? String(mx.d) : null;
  // The reference month must be calendar-complete AND posted — see settledMonthFrom. Stepping back
  // to the last settled month is stated on the panel, never silent.
  const calRef = refMonthOf(salesMax);
  const settled = settledMonthFrom(q, calRef, rowsOf, num);
  const e = { salesMax, refMonth: settled.ym, calRefMonth: calRef, unsettled: settled.unsettled, months: [], recipeLines: null, completeRecipes: null };
  const rl = rowsOf(q(`SELECT COUNT(*) n FROM recipe_lines`))[0];
  e.recipeLines = rl ? (num(rl.n) || 0) : null;
  const complete = rowsOf(q(
    `SELECT COUNT(*) n FROM products p
      WHERE EXISTS (SELECT 1 FROM recipe_lines rl WHERE rl.product_id = p.id)
        AND NOT EXISTS (
          SELECT 1 FROM recipe_lines rl LEFT JOIN sub_items si ON si.id = rl.sub_item_id
           WHERE rl.product_id = p.id
             AND (si.id IS NULL OR si.pack_cost_pence IS NULL OR si.pack_cost_pence < 0
                  OR si.pack_qty IS NULL OR si.pack_qty <= 0 OR rl.quantity IS NULL OR rl.quantity <= 0))`))[0];
  e.completeRecipes = complete && num(complete.n) != null ? num(complete.n) : null;
  const recipeAvailability = e.recipeLines === 0 ? 'empty'
    : e.recipeLines > 0 && e.completeRecipes > 0 ? 'available'
      : e.recipeLines > 0 ? 'incomplete' : 'unknown';
  // The rent step and current recipe availability are checked on every request.
  e.queue = { supplier: null, fees: null, rentDays: rentStepDaysUntil(now), recipeAvailability };
  if (!e.refMonth) return e;

  const months = []; for (let i = 5; i >= 0; i--) months.push(monthShift(e.refMonth, -i));
  const qb = qbMonths(q, months);
  for (const ym of months) {
    const m = qb.get(ym);
    const net = monthNet(q, ym);
    const lab = monthLabour(q, ym);
    e.months.push({
      ym,
      net: net ? net.net : null, netDays: net ? net.days : 0,
      labour: lab ? lab.cost : null, labourDays: lab ? lab.days : 0,
      qbAny: m.any, cogs: m.any ? m.cogs : null, over: m.any ? m.over : null,
      fixed: m.fixed, semi: m.semi, variable: m.variable,
      accounts: m.accounts,
    });
  }
  const cur = e.months[e.months.length - 1];
  // ---- the reference-month KPI set (every derivation captioned at render) ----
  const netP = cur.net, cogsP = cur.cogs, labP = cur.labour, varP = cur.qbAny ? cur.variable : null;
  const k = {};
  k.cogsPct = netP > 0 && cogsP != null ? (cogsP / netP) * 100 : null;
  k.labourPct = netP > 0 && labP != null ? (labP / netP) * 100 : null;
  k.primePct = k.cogsPct != null && k.labourPct != null ? k.cogsPct + k.labourPct : null;
  k.contribution = netP > 0 && cogsP != null && labP != null && varP != null ? netP - cogsP - labP - varP : null;
  k.overheads = cur.qbAny ? cur.over : null;
  k.cmRatio = k.contribution != null && netP > 0 ? k.contribution / netP : null;
  const fixedMonthly = cur.qbAny ? cur.fixed + cur.semi : null; // fixed + semi-fixed classified overheads
  k.fixedMonthly = fixedMonthly;
  k.breakEvenWeek = k.cmRatio > 0 && fixedMonthly != null ? (fixedMonthly / k.cmRatio) * (12 / 52) : null;
  e.kpi = k;

  // ---- owner attention queue: REAL findings only ----
  const queue = e.queue;
  const bmx = rowsOf(q(`SELECT MAX(txn_date) d FROM qb_bank_txns WHERE txn_kind = 'purchase'`))[0];
  const bankMax = bmx && bmx.d ? String(bmx.d) : null;
  if (bankMax) {
    // largest supplier-spend delta: bank-max month-to-date vs the SAME counterparty's average
    // over the SAME DAY-SPAN of the 3 prior months (bank purchases — the supplier truth wire).
    // Like-for-like windows: MTD vs full prior months would flag every supplier as collapsed
    // early in a month — a fabricated finding.
    const curYm = bankMax.slice(0, 7);
    const dd = bankMax.slice(8, 10);
    const curRows = rowsOf(q(
      `SELECT counterparty cp, SUM(total_pence) p FROM qb_bank_txns
        WHERE txn_kind = 'purchase' AND txn_date BETWEEN ? AND ? AND counterparty IS NOT NULL AND counterparty != ''
        GROUP BY counterparty`, [`${curYm}-01`, bankMax]));
    const prevAgg = new Map();
    for (let kk = 1; kk <= 3; kk++) {
      const ym2 = monthShift(curYm, -kk);
      for (const r of rowsOf(q(
        `SELECT counterparty cp, SUM(total_pence) p FROM qb_bank_txns
          WHERE txn_kind = 'purchase' AND txn_date BETWEEN ? AND ? AND counterparty IS NOT NULL AND counterparty != ''
          GROUP BY counterparty`, [`${ym2}-01`, `${ym2}-${dd}`]))) {
        prevAgg.set(String(r.cp), (prevAgg.get(String(r.cp)) || 0) + (num(r.p) || 0));
      }
    }
    const prevAvg = new Map([...prevAgg.entries()].map(([cp, p]) => [cp, p / 3]));
    const curBy = new Map(curRows.map((r) => [String(r.cp), num(r.p) || 0]));
    let best = null;
    for (const cp of new Set([...curBy.keys(), ...prevAvg.keys()])) {
      const curP = curBy.get(cp) || 0; const avg = prevAvg.get(cp) || 0;
      if (Math.max(curP, avg) < 50000) continue; // sub-£500 movements are noise, not findings
      const delta = curP - avg;
      if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { cp, cur: curP, avg, delta };
    }
    // POSTING-COMPLETENESS GATE (2026-08-19, data-wiring audit). The comparison above is
    // like-for-like on DAY-SPAN but not on POSTING. Bank purchases have been ~80% un-posted since
    // 2026-07-07: Jul actual £20,564 against a Feb–Jun mean of £117,023, and Aug 1–18 £3,849
    // against ~£67,948 pro-rata — about £160,558 of supplier cash-out simply not in QuickBooks yet.
    // With the current side near-empty every supplier reads as a collapse, so the queue's TOP alert
    // was a green "£12,471 Booker saving" that is not a saving at all: it is the absence of data
    // wearing the costume of good news, and it is the first thing the owner sees on this page.
    //
    // So measure whether the current window is POSTED before letting any delta off it render:
    // compare this month-to-date's total purchase spend against the same day-span in the prior
    // three months. Below half, the window is un-posted — suppress the alert and say why, rather
    // than report the gap as a business result. A delta whose `cur` side is missing is not a delta.
    const curTotal = [...curBy.values()].reduce((a, b) => a + b, 0);
    const prevTotalAvg = [...prevAgg.values()].reduce((a, b) => a + b, 0) / 3;
    const postedRatio = prevTotalAvg > 0 ? curTotal / prevTotalAvg : null;
    const posted = postedRatio == null || postedRatio >= 0.5;
    queue.supplierPosting = { curTotal, prevTotalAvg, postedRatio, posted };
    queue.supplier = posted && best ? { ...best, month: curYm, dd } : null;
    queue.bankMax = bankMax;
  }
  // fee-collapse: 'Bank charges' journal account — the last-2-months average vs the preceding
  // 6-month avg; a >75% collapse on a card-fee-scale base = the net-settlement finding.
  const feeMonths = []; for (let i = 7; i >= 0; i--) feeMonths.push(monthShift(e.refMonth, -i));
  const feeRows = rowsOf(q(
    `SELECT period_month m, SUM(COALESCE(debit_pence, 0)) - SUM(COALESCE(credit_pence, 0)) p
       FROM qb_journal_lines WHERE account_name LIKE 'Bank charges%' AND period_month BETWEEN ? AND ?
      GROUP BY period_month`, [feeMonths[0], feeMonths[feeMonths.length - 1]]));
  const feeBy = new Map(feeRows.map((r) => [String(r.m), num(r.p) || 0]));
  const recent2 = feeMonths.slice(-2).map((m2) => feeBy.get(m2) || 0);
  const prior6 = feeMonths.slice(0, 6).map((m2) => feeBy.get(m2) || 0);
  const recentAvg = recent2.reduce((a, b) => a + b, 0) / 2;
  const priorAvg = prior6.reduce((a, b) => a + b, 0) / 6;
  if (priorAvg > 50000 && recentAvg < priorAvg * 0.25) {
    queue.fees = { priorAvg, recentAvg, from: feeMonths[feeMonths.length - 2], to: feeMonths[feeMonths.length - 1] };
  }
  return e;
}

// FIXED & SEMI-FIXED — monthly overheads by account, behaviour map, 12-month trend, renewal &
// commitment calendar. Overheads = QB Expense accounts EX COGS-class EX payroll-class (stated).
function buildFixed(q, now) {
  const mx = rowsOf(q(`SELECT MAX(month) m FROM qb_pl_monthly`))[0];
  const qbMax = mx && mx.m ? String(mx.m) : null;
  const f = { qbMax };
  if (!qbMax) return f;
  f.qbMaxPartial = qbMax === new Date(now).toISOString().slice(0, 7); // the now-month is in progress
  const t12 = []; for (let i = 11; i >= 0; i--) t12.push(monthShift(qbMax, -i));
  f.months12 = t12;
  f.tableMonths = t12.slice(-7); // 6 trailing + the current column
  const qb = qbMonths(q, t12);
  // account × month grid (overhead bucket only)
  const acc = new Map(); // name → {name, behaviour, byYm: Map, total6}
  for (const ym of t12) {
    for (const a of qb.get(ym).accounts) {
      if (a.bucket !== 'overhead') continue;
      if (!acc.has(a.name)) acc.set(a.name, { name: a.name, behaviour: behaviourOf(a.name), byYm: new Map(), total6: 0, total12: 0 });
      const e = acc.get(a.name);
      e.byYm.set(ym, (e.byYm.get(ym) || 0) + a.p);
      e.total12 += a.p;
      if (f.tableMonths.slice(0, 6).includes(ym)) e.total6 += a.p;
    }
  }
  const all = [...acc.values()].sort((a, b) => b.total6 - a.total6);
  f.topAccounts = all.slice(0, 15);
  f.otherAccounts = all.slice(15);
  f.monthTotals = t12.map((ym) => ({ ym, over: qb.get(ym).any ? qb.get(ym).over : null, any: qb.get(ym).any }));
  // behaviour classes (averaged over the 6 FULL trailing table months — a partial current
  // month would understate)
  const fullSix = f.tableMonths.slice(0, 6);
  const classes = { fixed: { total: 0, names: [] }, semi: { total: 0, names: [] }, variable: { total: 0, names: [] } };
  for (const a of all) {
    const c = classes[a.behaviour];
    c.total += fullSix.reduce((s, ym) => s + (a.byYm.get(ym) || 0), 0);
    if (a.total6 > 0) c.names.push(a.name);
  }
  f.behaviour = Object.fromEntries(Object.entries(classes).map(([k2, c]) => [k2, { avgMonth: c.total / 6, count: c.names.length, top: c.names.slice(0, 4) }]));
  // 12-month trend: total + the 3 biggest accounts by 12-month total
  f.trendTop3 = [...acc.values()].sort((a, b) => b.total12 - a.total12).slice(0, 3);
  // rent (the gap-map rule): 'Rent (205)' + 'Rent + SC Clearing Account' journal accounts
  // aggregated, quarterly-billed via Workman — the last 4 quarters' journal total.
  const rentFrom = monthShift(qbMax, -11);
  f.rent12 = num(rowsOf(q(
    `SELECT SUM(COALESCE(debit_pence, 0)) - SUM(COALESCE(credit_pence, 0)) p FROM qb_journal_lines
      WHERE account_name IN ('Rent (205)', 'Rent + SC Clearing Account') AND period_month BETWEEN ? AND ?`,
    [rentFrom, qbMax]))[0]?.p);
  // rates observed cadence (Highland Council bank txns, trailing 365d — an OBSERVED pattern,
  // captioned as such, never contractual)
  const bmx = rowsOf(q(`SELECT MAX(txn_date) d FROM qb_bank_txns WHERE txn_kind = 'purchase'`))[0];
  const bankMax = bmx && bmx.d ? String(bmx.d) : null;
  if (bankMax) {
    const rows = rowsOf(q(
      `SELECT txn_date d, total_pence p FROM qb_bank_txns
        WHERE txn_kind = 'purchase' AND counterparty = 'Highland Council' AND total_pence >= 10000
          AND txn_date BETWEEN ? AND ? ORDER BY txn_date`, [K.shiftDays(bankMax, -364), bankMax]));
    if (rows.length) {
      f.rates = {
        n: rows.length,
        medianPence: median(rows.map((r) => num(r.p) || 0)),
        last: String(rows[rows.length - 1].d),
        totalPence: rows.reduce((s, r) => s + (num(r.p) || 0), 0),
      };
    }
  }
  f.rentDays = rentStepDaysUntil(now);
  return f;
}

// CASH COMMITMENTS — 13-week calendar from recurring bank-outflow patterns + the contractual
// rent line; AP ageing empty-state; P&L vs cash; large commitments; working-capital controls.
function buildCash(q, now) {
  const bmx = rowsOf(q(`SELECT MAX(txn_date) d FROM qb_bank_txns WHERE txn_kind = 'purchase'`))[0];
  const bankMax = bmx && bmx.d ? String(bmx.d) : null;
  const c = { bankMax, rentDays: rentStepDaysUntil(now) };
  const todayIso = new Date(now).toISOString().slice(0, 10);
  c.todayIso = todayIso;
  if (bankMax) {
    // ---- recurrence detection over the trailing 6 months of bank purchases ----
    const from = K.shiftDays(bankMax, -(RECUR_WINDOW_DAYS - 1));
    const dayRows = rowsOf(q(
      `SELECT counterparty cp, txn_date d, SUM(total_pence) p FROM qb_bank_txns
        WHERE txn_kind = 'purchase' AND txn_date BETWEEN ? AND ? AND counterparty IS NOT NULL AND counterparty != ''
        GROUP BY counterparty, txn_date`, [from, bankMax]))
      .map((r) => ({ cp: String(r.cp), d: String(r.d), p: num(r.p) || 0 }));
    c.window = { from, to: bankMax };
    c.recurring = detectRecurrence(dayRows);
    // SURVEILLANCE BOUNDARY (the standing labour ruling, applied here): person-named
    // counterparties (payroll payees) are recurring cash outflows — a real commitment — but
    // people render as AGGREGATES, never as per-person £ lines. Pool them into ONE 'Staff
    // payroll' pattern (summed medians, the modal cadence, earliest next date), captioned.
    const persons = c.recurring.filter((r) => /^(mr|mrs|miss|ms)\s/i.test(r.cp));
    if (persons.length) {
      c.recurring = c.recurring.filter((r) => !persons.includes(r));
      const agg = {
        cp: `Staff payroll (${persons.length} payees, aggregated)`, isAggregate: true,
        n: Math.max(...persons.map((p) => p.n)),
        cadenceDays: Math.round(median(persons.map((p) => p.cadenceDays))),
        medianPence: persons.reduce((s2, p) => s2 + p.medianPence, 0),
        lastDate: persons.map((p) => p.lastDate).sort().pop(),
        spendPence: persons.reduce((s2, p) => s2 + p.spendPence, 0),
        members: persons, // kept for the week-landing projection (per-payee cadence, pooled label)
      };
      c.recurring.push(agg);
      c.recurring.sort((a, b) => b.spendPence - a.spendPence);
    }
    // ---- project the next 13 weeks (from today) ----
    const horizonEnd = K.shiftDays(todayIso, 91);
    const weeks = [];
    const monday0 = K.weekMonday(todayIso);
    for (let i = 0; i < 13; i++) weeks.push({ monday: K.shiftDays(monday0, 7 * i), totalPence: 0, items: new Map() });
    const weekOf = new Map(weeks.map((w, i) => [w.monday, i]));
    for (const rec of c.recurring) {
      if (rec.isAggregate) {
        // pooled payroll: project each payee on its OWN cadence, land under the ONE label
        const label = 'Staff payroll';
        let next = null;
        for (const p of rec.members) {
          for (const d of projectDates(p, todayIso, horizonEnd)) {
            if (!next || d < next) next = d;
            const w = weeks[weekOf.get(K.weekMonday(d))];
            if (!w) continue;
            w.totalPence += p.medianPence;
            w.items.set(label, (w.items.get(label) || 0) + 1);
          }
        }
        rec.nextDate = next;
        continue;
      }
      rec.projected = projectDates(rec, todayIso, horizonEnd);
      rec.nextDate = rec.projected[0] || null;
      for (const d of rec.projected) {
        const w = weeks[weekOf.get(K.weekMonday(d))];
        if (!w) continue;
        w.totalPence += rec.medianPence;
        w.items.set(rec.cp, (w.items.get(rec.cp) || 0) + 1);
      }
    }
    c.weeks = weeks.map((w) => ({ monday: w.monday, totalPence: w.totalPence, items: [...w.items.entries()].map(([cp, n]) => ({ cp, n })) }));
    // ---- P&L cost vs cash paid: month grain, trailing 6 ending the bank-max month ----
    const cashYm = bankMax.slice(0, 7);
    const months = []; for (let i = 5; i >= 0; i--) months.push(monthShift(cashYm, -i));
    const jRows = rowsOf(q(
      `SELECT j.period_month m, SUM(COALESCE(j.debit_pence, 0)) - SUM(COALESCE(j.credit_pence, 0)) p
         FROM qb_journal_lines j JOIN qb_accounts a ON a.account_id = j.account_id AND a.realm_id = j.realm_id
        WHERE a.classification = 'Expense' AND j.period_month BETWEEN ? AND ? GROUP BY j.period_month`,
      [months[0], months[months.length - 1]]));
    const bRows = rowsOf(q(
      `SELECT substr(txn_date, 1, 7) m, SUM(total_pence) p FROM qb_bank_txns
        WHERE txn_kind = 'purchase' AND substr(txn_date, 1, 7) BETWEEN ? AND ? GROUP BY 1`,
      [months[0], months[months.length - 1]]));
    const jBy = new Map(jRows.map((r) => [String(r.m), num(r.p)]));
    const bBy = new Map(bRows.map((r) => [String(r.m), num(r.p)]));
    c.plVsCash = months.map((ym) => ({ ym, pl: jBy.get(ym) ?? null, cash: bBy.get(ym) ?? null, partial: ym === cashYm && refMonthOf(bankMax) !== cashYm }));
    // ---- working-capital controls: the honest cash-out cadence set (90d) ----
    const from90 = K.shiftDays(bankMax, -89);
    const w = rowsOf(q(
      `SELECT COUNT(*) n, SUM(total_pence) p, COUNT(DISTINCT txn_date) days FROM qb_bank_txns
        WHERE txn_kind = 'purchase' AND txn_date BETWEEN ? AND ?`, [from90, bankMax]))[0];
    const big = rowsOf(q(
      `SELECT counterparty cp, txn_date d, total_pence p FROM qb_bank_txns
        WHERE txn_kind = 'purchase' AND txn_date BETWEEN ? AND ? ORDER BY total_pence DESC LIMIT 1`, [from90, bankMax]))[0];
    c.controls = w && num(w.n) > 0 ? {
      n: num(w.n), totalPence: num(w.p) || 0, days: num(w.days) || 0,
      largest: big ? { cp: String(big.cp || '—'), d: String(big.d), p: num(big.p) || 0 } : null,
      recurringShare: null,
    } : null;
    if (c.controls && c.controls.totalPence > 0) {
      const recurCps = new Set(c.recurring.flatMap((r) => (r.isAggregate ? r.members.map((p) => p.cp) : [r.cp])));
      const rec90 = rowsOf(q(
        `SELECT SUM(total_pence) p FROM qb_bank_txns
          WHERE txn_kind = 'purchase' AND txn_date BETWEEN ? AND ? AND counterparty IS NOT NULL AND counterparty != ''`,
        [from90, bankMax]))[0];
      let recP = 0;
      for (const r of rowsOf(q(
        `SELECT counterparty cp, SUM(total_pence) p FROM qb_bank_txns
          WHERE txn_kind = 'purchase' AND txn_date BETWEEN ? AND ? GROUP BY counterparty`, [from90, bankMax]))) {
        if (recurCps.has(String(r.cp))) recP += num(r.p) || 0;
      }
      c.controls.recurringShare = num(rec90 && rec90.p) > 0 ? (recP / c.controls.totalPence) * 100 : null;
    }
  }
  return c;
}

// COST FORECAST — the accrual-basis forward cost view (distinct from Cash Commitments' cash-out
// TIMING: this is what cost is INCURRED, that is when money LEAVES). Interactive scenario on the
// revenue projection + the ruled cost ratios; the contractual rent step enters as a hard line.
function buildForecast(q, now) {
  const f = { rentStep: RENT_STEP, rentDays: rentStepDaysUntil(now) };
  // the trailing-3 complete months set the ratio base (COGS% + variable-overhead% of net) — a
  // ratio is a ratio, projected forward on the revenue projection; fixed costs held at their level.
  const salesMx = rowsOf(q(`SELECT MAX(business_date) d FROM v_sales_day_all WHERE premises = 'current'`))[0];
  const salesMax = salesMx && salesMx.d ? String(salesMx.d) : null;
  if (!salesMax) { f.ready = false; return f; }
  f.ready = true;
  const refM = refMonthOf(salesMax) || salesMax.slice(0, 7);
  f.refMonth = refM;
  const base = [monthShift(refM, -2), monthShift(refM, -1), refM];
  const qb = qbMonths(q, base);
  let cogsSum = 0, varSum = 0, fixedSum = 0, netSum = 0, monthsWithBoth = 0;
  for (const ym of base) {
    const net = monthNet(q, ym); const mm = qb.get(ym);
    if (net && mm && mm.any) { cogsSum += mm.cogs; varSum += mm.variable; fixedSum += mm.fixed + mm.semi; netSum += net.net; monthsWithBoth++; }
  }
  f.base = monthsWithBoth ? {
    months: base, monthsWithBoth,
    cogsPct: netSum > 0 ? (cogsSum / netSum) * 100 : null,
    varPct: netSum > 0 ? (varSum / netSum) * 100 : null,
    fixedMonthly: monthsWithBoth ? fixedSum / monthsWithBoth : null,
    netMonthly: monthsWithBoth ? netSum / monthsWithBoth : null,
  } : null;
  // 8-week forward outlook (accrual): the base monthly fixed + COGS%×projected-net; projection net
  // is the trailing monthly net (honest flat carry — the RCC forecast owns the seasonality model,
  // we pointer to it, never re-derive). Rent step lands as a hard event within the horizon.
  f.outlook = [];
  if (f.base && f.base.netMonthly != null) {
    for (let i = 1; i <= 3; i++) {
      const ym = monthShift(refM, i);
      const projNet = f.base.netMonthly; // flat carry, stated
      const cogs = f.base.cogsPct != null ? (f.base.cogsPct / 100) * projNet : null;
      const varo = f.base.varPct != null ? (f.base.varPct / 100) * projNet : null;
      const stepActive = ym >= RENT_STEP.date.slice(0, 7);
      f.outlook.push({ ym, projNet, cogs, varo, fixed: f.base.fixedMonthly, rentStepActive: stepActive });
    }
  }
  return f;
}

// SUPPLIERS & PURCHASING — the scorecard + concentration are REAL (qb_bank_txns purchases by
// counterparty, the corrected supplier-spend wire); PPV + ingredient price watch are invoice-line-
// gated; the invoice queue is the no-bills empty-state.
function buildSuppliers(q, now) {
  const s = {};
  const mx = rowsOf(q(`SELECT MAX(txn_date) d FROM qb_bank_txns WHERE txn_kind = 'purchase'`))[0];
  const bankMax = mx && mx.d ? String(mx.d) : null;
  s.bankMax = bankMax;
  if (!bankMax) return s;
  const from = K.shiftDays(bankMax, -364); // trailing 12 months
  const prevFrom = K.shiftDays(bankMax, -729); const prevTo = K.shiftDays(bankMax, -365);
  const cur = rowsOf(q(
    `SELECT counterparty cp, COUNT(*) n, SUM(total_pence) p FROM qb_bank_txns
      WHERE txn_kind = 'purchase' AND counterparty IS NOT NULL AND counterparty != '' AND txn_date BETWEEN ? AND ?
      GROUP BY counterparty ORDER BY p DESC`, [from, bankMax]));
  const prev = new Map(rowsOf(q(
    `SELECT counterparty cp, SUM(total_pence) p FROM qb_bank_txns
      WHERE txn_kind = 'purchase' AND txn_date BETWEEN ? AND ? GROUP BY counterparty`, [prevFrom, prevTo]))
    .map((r) => [String(r.cp), num(r.p) || 0]));
  // SURVEILLANCE BOUNDARY: person-named counterparties (payroll payees) pool into a Staff-payroll
  // aggregate — spend is a fact, per-person £ lines are not.
  const isPerson = (cp) => /^(mr|mrs|miss|ms)\s/i.test(cp);
  const people = cur.filter((r) => isPerson(String(r.cp)));
  let rows = cur.filter((r) => !isPerson(String(r.cp))).map((r) => ({
    cp: String(r.cp), n: num(r.n), spend: num(r.p) || 0, prev: prev.get(String(r.cp)) ?? null,
  }));
  if (people.length) {
    rows.push({
      cp: `Staff payroll (${people.length} payees, aggregated)`, isAggregate: true,
      n: people.reduce((a, r) => a + num(r.n), 0),
      spend: people.reduce((a, r) => a + (num(r.p) || 0), 0),
      prev: people.reduce((a, r) => a + (prev.get(String(r.cp)) ?? 0), 0) || null,
    });
    rows.sort((a, b) => b.spend - a.spend);
  }
  const total = rows.reduce((a, r) => a + r.spend, 0);
  s.total = total; s.window = { from, to: bankMax };
  s.suppliers = rows.slice(0, 12).map((r) => ({
    ...r, sharePct: total > 0 ? (r.spend / total) * 100 : 0,
    trendPct: r.prev != null && r.prev > 0 ? ((r.spend - r.prev) / r.prev) * 100 : null,
  }));
  // concentration: top-1 and top-3 shares of the total
  s.concentration = total > 0 ? {
    top1: (rows[0]?.spend || 0) / total * 100,
    top3: rows.slice(0, 3).reduce((a, r) => a + r.spend, 0) / total * 100,
    n: rows.length,
  } : null;
  return s;
}

// COGS & INVENTORY — actual QB COGS plus recipe-derived reference-month theoretical COGS.
function buildCogs(q, now) {
  const c = {};
  const salesMx = rowsOf(q(`SELECT MAX(business_date) d FROM v_sales_day_all WHERE premises = 'current'`))[0];
  const salesMax = salesMx && salesMx.d ? String(salesMx.d) : null;
  const qbMx = rowsOf(q(`SELECT MAX(month) m FROM qb_pl_monthly`))[0];
  const qbMax = qbMx && qbMx.m ? String(qbMx.m) : null;
  const desiredMonth = refMonthOf(salesMax) || qbMax;
  if (!desiredMonth) return c;
  c.refMonth = desiredMonth;
  const settled = settledMonthFrom(q, desiredMonth, rowsOf, num);
  c.postingSettled = settled.unsettled.length === 0;
  const net = monthNet(q, desiredMonth);
  c.net = net ? net.net : null;
  c.recipe = buildRecipeEconomics(q, desiredMonth);
  c.recipeLines = c.recipe.recipeLines;
  c.cogsTotal = null;
  c.cogsPct = null;
  c.cogsCats = [];
  c.otherVar = [];
  if (!c.postingSettled) return c;

  const qb = qbMonths(q, [desiredMonth]);
  const mm = qb.get(desiredMonth);
  c.cogsTotal = mm && mm.any ? mm.cogs : null;
  c.cogsPct = c.net && c.net > 0 && c.cogsTotal != null ? (c.cogsTotal / c.net) * 100 : null;
  // actual COGS by category (the COGS-bucket accounts for the month)
  c.cogsCats = (mm && mm.any ? mm.accounts.filter((a) => a.bucket === 'cogs') : [])
    .sort((a, b) => b.p - a.p).map((a) => ({ name: a.name, p: a.p }));
  // OTHER variable cost control: overhead-bucket accounts classed 'variable' (packaging/cleaning
  // etc.) — the honest non-COGS variable set, real at QB category grain.
  c.otherVar = (mm && mm.any ? mm.accounts.filter((a) => a.bucket === 'overhead' && behaviourOf(a.name) === 'variable') : [])
    .sort((a, b) => b.p - a.p).map((a) => ({ name: a.name, p: a.p }));
  return c;
}

// RECIPE MARGINS — achieved economics over the available canonical item-sales period.
function buildMargins(q, now) {
  return buildRecipeEconomics(q, null);
}

module.exports = {
  key: 'costs', route: '/coyote/costs', workspace: 'coyote', title: 'Costs',
  sub: 'Costs & supplier command centre · QB ledger shadow + bank truth',
  buildRecipeEconomics,
  readCanonicalItemSales,

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    const query = (ctx && ctx.query) || {};
    const tab = TAB_KEYS.includes(String(query.tab || '')) ? String(query.tab) : 'executive';
    const m = { now, tab, exec: null, fixed: null, cash: null, forecast: null, suppliers: null, cogs: null, margins: null };
    if (typeof q !== 'function') return m;
    if (tab === 'executive') m.exec = buildExecutive(q, now);
    else if (tab === 'fixed') m.fixed = buildFixed(q, now);
    else if (tab === 'cash') m.cash = buildCash(q, now);
    else if (tab === 'forecast') m.forecast = buildForecast(q, now);
    else if (tab === 'suppliers') m.suppliers = buildSuppliers(q, now);
    else if (tab === 'cogs') m.cogs = buildCogs(q, now);
    else if (tab === 'margins') m.margins = buildMargins(q, now);
    return m;
  },

  render(section, ctx) {
    const m = section || {};
    const tab = TAB_KEYS.includes(String(m.tab || '')) ? String(m.tab) : 'executive';
    const now = m.now || (ctx && ctx.now) || Date.now();
    const esc = S.escapeHtml;
    const int = S.fmtInt;
    const gbp = S.fmtGbpPence; // exact 2dp — the pointer/caption format
    // chart + table display rounding (exact inputs, compute exact, ROUND AT DISPLAY)
    const gbp0 = (p) => {
      if (p == null || !Number.isFinite(Number(p))) return '—';
      const v = Math.round(Number(p) / 100);
      return `${v < 0 ? '−' : ''}£${Math.abs(v).toLocaleString('en-GB')}`;
    };
    const pct1 = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`);

    // Page styles: the RCC canon + the reports shell grammar (r-tabs etc.) + the three
    // page-local grammars this centre needs (month clusters, the waterfall — ported verbatim
    // from the reports reconciliation tab — and the overhead trend chart).
    const styles = `<style>${S.rcc.css()}</style><style>
      .rcc .r-tabs{display:flex;gap:4px;border-bottom:1px solid var(--rline);margin:0 0 14px;overflow:auto}
      .rcc .r-tab{color:#9ba4ae;padding:11px 14px;font-weight:700;border-bottom:2px solid transparent;white-space:nowrap;text-decoration:none;font-size:13px}
      .rcc .r-tab.active{color:#fff;border-bottom-color:var(--raccent)}
      .rcc .r-grid{display:grid;gap:14px}
      .rcc .r-kpi-grid{grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:8px}
      .rcc .r-two-col{grid-template-columns:minmax(0,2fr) minmax(330px,1fr);margin-bottom:14px}
      .rcc .r-three-col{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px}
      @media(max-width:1200px){.rcc .r-kpi-grid{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:1100px){.rcc .r-three-col{grid-template-columns:1fr}}
      @media(max-width:820px){.rcc .r-two-col{grid-template-columns:1fr}.rcc .r-kpi-grid{grid-template-columns:repeat(2,1fr)}}
      .rcc .r-legend{display:flex;gap:12px;flex-wrap:wrap;color:#aeb6bf;font-size:11px}
      .rcc .r-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
      .rcc .r-mini-note{color:#8f99a4;font-size:10px;margin-top:10px}
      .rcc .rv2-caption{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--muted,#7a8);margin:8px 2px 2px;line-height:1.55}
      .rcc .r-driver-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
      @media(max-width:820px){.rcc .r-driver-grid{grid-template-columns:repeat(2,1fr)}}
      .rcc .r-meters{display:grid;gap:10px}
      /* month clusters (the ruled monthly grain replacing the mock's 13-week frame) */
      .rcc .cst-cluster{display:flex;gap:16px;height:210px;padding:4px 2px 0}
      .rcc .cst-mcol{flex:1;display:flex;flex-direction:column;min-width:0}
      .rcc .cst-bars{flex:1;display:flex;align-items:flex-end;gap:4px;border-bottom:1px solid #2a3138;padding:0 5px}
      .rcc .cst-bar{flex:1;border-radius:3px 3px 1px 1px;min-height:2px}
      .rcc .cst-mlabel{color:#7f8994;font-size:10px;text-align:center;margin-top:6px;white-space:nowrap}
      /* waterfall — the reports reconciliation grammar, ported verbatim */
      .rcc .waterfall{display:flex;align-items:flex-end;gap:8px;height:210px;padding:18px 8px 30px;border-bottom:1px solid #303842;position:relative;margin-bottom:26px}
      .rcc .wf-col{flex:1;text-align:center;position:relative;min-width:48px}
      .rcc .wf-bar{margin:0 auto;width:68%;border-radius:8px 8px 3px 3px;background:linear-gradient(180deg,#e6654f,#b83e2e);min-height:8px;position:relative}
      .rcc .wf-col.neg .wf-bar{background:linear-gradient(180deg,#5c6876,#39434e)}
      .rcc .wf-col.total .wf-bar{background:linear-gradient(180deg,#4dc58a,#2d895c)}
      .rcc .wf-val{position:absolute;top:-20px;width:100%;font-size:10px;font-weight:800}
      .rcc .wf-lab{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);width:96px;color:#8e98a2;font-size:9px;line-height:1.2}
      /* overhead trend chart */
      .rcc .chart-wrap{height:250px;position:relative}
      .rcc .chart-wrap svg{width:100%;height:100%;display:block;overflow:visible}
      .rcc .gridline{stroke:#2a3138;stroke-width:1}
      .rcc .axistext{fill:#7f8994;font-size:11px}
      .rcc .cst-line{fill:none;stroke-width:2.5}
      .rcc .cst-pt{stroke:#171b20;stroke-width:2}
      .rcc .cst-behave{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
      @media(max-width:820px){.rcc .cst-behave{grid-template-columns:1fr}}
    </style>`;

    const tabsNav = `<div class="r-tabs">${TABS.map((t) =>
      `<a class="r-tab${t.key === tab ? ' active' : ''}" href="/coyote/costs?tab=${t.key}">${esc(t.label)}</a>`).join('')}</div>`;

    const legend = (items) => `<div class="r-legend">${items.map(([c2, l]) => `<span><i style="background:${c2}"></i>${esc(l)}</span>`).join('')}</div>`;
    const plainEmpty = (title, copy, action) => `<div class="r-empty"><b>${esc(title)}</b><br>${esc(copy)}${action ? `<div class="r-unlock">${esc(action)}</div>` : ''}</div>`;
    // series colours (RCC tokens): COGS accent · labour blue · overheads warn · contribution good
    const C_COGS = S.rcc.tokens.accent, C_LAB = S.rcc.tokens.blue, C_OVER = S.rcc.tokens.warn, C_CONTRIB = S.rcc.tokens.good;
    const behaviourChip = (b) => S.rcc.tag(BEHAVIOUR_LABEL[b] || b, BEHAVIOUR_TONE[b]);
    const rentStepText = (days) => (days >= 0
      ? `£60,000 → £65,000/yr from ${RENT_STEP.date} — ${int(days)} day(s) away`
      : `£60,000 → £65,000/yr stepped on ${RENT_STEP.date} — ${int(-days)} day(s) ago`);

    // ============================ EXECUTIVE ============================
    const renderExecutiveTab = () => {
      const ex = m.exec || {};
      const months = ex.months || [];
      const cur = months.length ? months[months.length - 1] : null;
      const k = ex.kpi || {};
      const refLabel = ex.refMonth ? monthLabel(ex.refMonth) : null;

      // ---- (1) KPI strip: prime cost (the one-home NEW fact) · COGS % · labour % (IMPORT) ·
      // contribution · overheads £ · break-even week £ (one-home derivation) ----
      const labourImportTile = `<div class="r-card r-kpi"><div class="r-kpi-label">Labour %</div><div class="r-kpi-value">${esc(pct1(k.labourPct))}</div><div class="r-kpi-sub">IMPORT · <a href="/coyote/labour" style="color:${S.rcc.tokens.blue}">the Labour Centre</a></div></div>`;
      const kpis = [
        S.rcc.kpi({ label: 'Prime cost %', value: pct1(k.primePct), sub: 'COGS % + labour % · one net base · lives HERE' }),
        S.rcc.kpi({ label: 'COGS %', value: pct1(k.cogsPct), sub: 'QB COGS accounts ÷ month net' }),
        labourImportTile,
        S.rcc.kpi({ label: 'Contribution', value: gbp0(k.contribution), sub: 'net − COGS − labour − variable overheads' }),
        S.rcc.kpi({ label: 'Overheads / month', value: gbp0(k.overheads), sub: 'QB overhead accounts (ex COGS, ex payroll)' }),
        S.rcc.kpi({ label: 'Break-even week', value: gbp0(k.breakEvenWeek), sub: 'fixed monthly ÷ CM ratio · derivation · lives HERE' }),
      ].join('');
      // the ONE-HOME import caption: the labour month £ and the revenue month £ render HERE,
      // once each, beside their pointers — never as duplicated panels.
      let kpiCaption;
      if (cur && ex.refMonth) {
        const labourLine = cur.labour != null
          ? `labour = labour_day TRUE month ${gbp(cur.labour)} (locked rates × burden + salaried/365, ${int(cur.labourDays)} day(s)) — imported; the labour story lives in <a href="/coyote/labour" style="color:${S.rcc.tokens.blue}">the Labour Centre</a>`
          : `labour_day has NO rows for ${esc(refLabel)} — labour %, prime cost, contribution and break-even stay empty (a hole is a hole, never bridged); the labour story lives in <a href="/coyote/labour" style="color:${S.rcc.tokens.blue}">the Labour Centre</a>`;
        const netLine = cur.net != null
          ? `net = ${gbp(cur.net)} (v_sales_day_all, ${int(cur.netDays)} day(s), ex-VAT) — imported; the revenue story lives in <a href="/coyote/revenue" style="color:${S.rcc.tokens.blue}">the Revenue Centre</a>`
          : 'no sales record for the month';
        // If a calendar-complete month was SKIPPED for being under-posted, say so — silently
        // choosing an older month is its own kind of lie, and the reader needs to know the newest
        // month is not yet readable rather than assume it was fine and boring.
        const unsettledNote = (ex.unsettled || []).length
          ? ` · <strong>${esc(monthLabel(ex.unsettled[0].ym))} is calendar-complete but NOT yet posted</strong> — ${int(ex.unsettled[0].lines)} journal lines against a ${int(ex.unsettled[0].medLines)} six-month median and ${int(ex.unsettled[0].accts)} of ~${int(ex.unsettled[0].medAccts)} expense accounts, so every ratio built on it would be fiction (COGS would read a fraction of its true rate). It becomes the reference month by itself once the bookkeeping lands.`
          : '';
        kpiCaption = `<div class="rv2-caption">month = ${esc(refLabel)} (the latest complete AND posted month on the day-net record)${unsettledNote} · ${netLine} · COGS = QB Cost-of-Goods-Sold accounts, qb_pl_monthly ÷ that net · ${labourLine} · prime cost = COGS % + labour % on the ONE net base (both bases stated — its one home is this strip) · contribution = net − COGS − labour − variable-classified overheads (classification = presentation judgment) · break-even week = (fixed + semi-fixed overheads ÷ contribution-margin ratio) × 12⁄52 — a derivation, not a wire fact.</div>`;
      } else {
        kpiCaption = `<div class="rv2-caption">no day-net sales record yet (v_sales_day_all) — no reference month, no derived figure; the strip stays empty rather than guessing.</div>`;
      }

      // ---- (2) trailing-6-month cost & contribution trend — the gap map RULED the mock's
      // 13-week frame onto the QB MONTH grain, grain stated in the sub ----
      let trendBody;
      const plotMonths = months.filter((mo) => mo.qbAny || mo.net != null || mo.labour != null);
      if (plotMonths.length) {
        const vals = [];
        for (const mo of months) { for (const v of [mo.cogs, mo.labour, mo.over, mo.qbAny && mo.net != null && mo.labour != null ? mo.net - mo.cogs - mo.labour - mo.variable : null]) if (v != null) vals.push(v); }
        const maxV = Math.max(...vals.map((v) => Math.abs(v)), 1);
        const bar = (v, color, lab) => (v == null ? '' :
          `<div class="cst-bar" style="height:${Math.max(1, Math.round((Math.abs(v) / maxV) * 100))}%;background:${color}" title="${esc(lab)}: ${esc(gbp0(v))}"></div>`);
        const cols = months.map((mo) => {
          const contrib = mo.qbAny && mo.net != null && mo.labour != null ? mo.net - mo.cogs - mo.labour - mo.variable : null;
          return `<div class="cst-mcol"><div class="cst-bars">${bar(mo.cogs, C_COGS, 'COGS')}${bar(mo.labour, C_LAB, 'Labour')}${bar(mo.over, C_OVER, 'Overheads')}${bar(contrib, C_CONTRIB, 'Contribution')}</div><div class="cst-mlabel">${esc(monthLabel(mo.ym))}</div></div>`;
        }).join('');
        // a HOLE is a month that renders a cost bar (has QB and/or net) but is missing labour —
        // a fully-absent month (outside the data) is not a labour hole, it simply has no bar.
        const holes = months.filter((mo) => (mo.qbAny || mo.net != null) && mo.labour == null).map((mo) => monthLabel(mo.ym));
        trendBody = `<div class="cst-cluster">${cols}</div>
          <div class="r-mini-note">monthly grain stated — QB is a month-grain ledger, so the mock's weekly frame renders as trailing months (interpolating months into weeks would fabricate) · COGS/overheads: qb_pl_monthly · labour: labour_day TRUE · contribution = net − COGS − labour − variable overheads${holes.length ? ` · month(s) without a labour_day record show no labour/contribution bar: ${esc(holes.join(', '))} (never bridged)` : ''}.</div>`;
      } else {
        trendBody = S.rcc.emptyState({ title: 'Cost and contribution trend', blocker: 'No QB month and no day-net record in the trailing 6 months.', unlock: 'the QuickBooks ledger ingest (qb_pl_monthly)' });
      }
      const trendPanel = S.rcc.panel({
        title: 'Cost and contribution trend', sub: 'trailing 6 months · MONTHLY grain (QB month-grain ledger — the mock’s weekly frame renders monthly, stated)',
        headRight: legend([[C_COGS, 'COGS'], [C_LAB, 'Labour'], [C_OVER, 'Overheads'], [C_CONTRIB, 'Contribution']]),
        body: trendBody,
      });

      // ---- (3) owner attention queue — REAL findings only ----
      const qd = ex.queue || {};
      const alerts = [];
      // The supplier delta is suppressed when the purchase feed is un-posted (see the gate in
      // buildExec). Say so in its place — an absent alert with no explanation reads as "nothing to
      // report", which is the same lie in quieter clothes.
      if (!qd.supplier && qd.supplierPosting && !qd.supplierPosting.posted) {
        const sp = qd.supplierPosting;
        alerts.push(S.rcc.alert({
          title: 'Supplier spend delta — withheld, the purchase feed is behind',
          text: `Bank purchases for this window total ${gbp0(sp.curTotal)} against ${gbp0(sp.prevTotalAvg)} over the same day-span of the prior three months (${Math.round((sp.postedRatio || 0) * 100)}% of normal). That gap is un-posted bookkeeping, not reduced spending, so any supplier "saving" computed from it would be fabricated. The comparison returns once purchases are posted.`,
          impact: 'not measurable yet', tone: 'warn',
        }));
      }
      if (qd.supplier) {
        const s2 = qd.supplier;
        alerts.push(S.rcc.alert({
          title: `Supplier spend delta — ${s2.cp}`,
          text: `${monthLabel(s2.month)} to day ${Number(s2.dd)}: ${gbp0(s2.cur)} vs the same day-span's 3-month average ${gbp0(s2.avg)} (bank purchases by counterparty — the supplier truth wire; like-for-like windows). The largest movement this month.`,
          impact: `${s2.delta >= 0 ? '+' : '−'}${gbp0(Math.abs(s2.delta))}`, tone: s2.delta > 0 ? 'bad' : 'good',
        }));
      }
      if (qd.fees) {
        alerts.push(S.rcc.alert({
          title: 'Processor fees vanished from the ledger — net settlement',
          text: `'Bank charges' ran ${gbp0(qd.fees.priorAvg)}/month (card-fee scale), then collapsed to ${gbp0(qd.fees.recentAvg)}/month over ${monthLabel(qd.fees.from)}–${monthLabel(qd.fees.to)}. Reading: the processor now deducts fees at source — current fees are INVISIBLE in QB until the processor statement is wired.`,
          impact: 'fee visibility', tone: 'bad',
        }));
      }
      if (qd.rentDays != null) {
        alerts.push(S.rcc.alert({
          title: 'Rent step — contractual (lease canon)',
          text: `${rentStepText(qd.rentDays)} · quarterly-billed via Workman. Encoded from the lease, never derived from the ledger.`,
          impact: qd.rentDays >= 0 ? `${int(qd.rentDays)}d` : 'stepped',
        }));
      }
      if (qd.recipeAvailability === 'empty') {
        alerts.push(S.rcc.alert({
          title: 'Recipe costing is not available yet',
          text: 'No recipes have been added. Open /coyote/recipes and add complete product recipes to compare recorded COGS with the cost implied by what was sold.',
          impact: 'set up', tone: 'info',
        }));
      } else if (qd.recipeAvailability === 'incomplete') {
        alerts.push(S.rcc.alert({
          title: 'Recipe costing needs complete ingredient details',
          text: 'Recipe entries exist, but no product currently has valid quantities and ingredient pack prices throughout. Complete one product recipe to begin the comparison.',
          impact: 'review', tone: 'warn',
        }));
      }
      const queuePanel = S.rcc.panel({
        title: 'Owner attention queue', sub: 'current findings — supplier movements, fee visibility, the contractual rent step and recipe availability',
        headRight: alerts.length ? S.rcc.tag(`${alerts.length} live`, 'warn') : '',
        body: alerts.length ? `<div style="display:grid;gap:10px">${alerts.join('')}</div>`
          : S.rcc.emptyState({ title: 'Owner attention queue', blocker: 'No bank or ledger record to derive findings from yet.', unlock: 'the QuickBooks ingest (qb_bank_txns + qb_journal_lines)' }),
      });

      // ---- (4) profitability bridge (waterfall grammar) — month grain ----
      let bridgeBody;
      if (cur && cur.net > 0 && cur.cogs != null && cur.labour != null && cur.over != null) {
        const contribAll = cur.net - cur.cogs - cur.labour - cur.over; // site contribution: after ALL overheads
        const H = 175;
        const barH = (v) => Math.max(1, Math.round((Math.abs(v) / cur.net) * H));
        const col = (label, v, cls, val) =>
          `<div class="wf-col${cls ? ' ' + cls : ''}"><div class="wf-bar" style="height:${barH(v)}px"><div class="wf-val">${esc(val)}</div></div><div class="wf-lab">${esc(label)}</div></div>`;
        const recipeComparison = ex.completeRecipes > 0
          ? `Recipe comparison is available for ${int(ex.completeRecipes)} completely costed product(s); see COGS &amp; Inventory and Recipe Margins.`
          : ex.recipeLines === 0
            ? 'Recipe comparison is not available yet because no recipes have been added.'
            : 'Recipe comparison is not available yet because no product recipe is complete.';
        bridgeBody = `<div class="waterfall">
            ${col('Revenue (net ex-VAT)', cur.net, '', gbp0(cur.net))}
            ${col('COGS', cur.cogs, 'neg', `−${gbp0(cur.cogs)}`)}
            ${col('Labour (import)', cur.labour, 'neg', `−${gbp0(cur.labour)}`)}
            ${col('Overheads', cur.over, 'neg', `−${gbp0(cur.over)}`)}
            ${col('Contribution', contribAll, 'total', gbp0(contribAll))}
          </div>
          <div class="r-mini-note">${esc(refLabel)} · month grain · revenue: v_sales_day_all (import) · COGS + overheads: qb_pl_monthly · labour: labour_day TRUE (import) · bridge contribution = after ALL overheads (the site-contribution basis) · ${recipeComparison}</div>`;
      } else {
        const missing = !cur ? 'no reference month' : cur.labour == null ? `labour_day has no rows for ${refLabel}` : !cur.qbAny ? 'no QB ledger rows for the month' : 'no sales record for the month';
        bridgeBody = S.rcc.emptyState({ title: 'Profitability bridge', blocker: `Bridge needs revenue, COGS, labour and overheads for the SAME month — ${missing}; a partial bridge would fabricate a contribution.`, unlock: 'the missing wire for the month' });
      }
      const bridgePanel = S.rcc.panel({ title: 'Profitability bridge', sub: 'revenue → COGS → labour → overheads → contribution · month grain', body: bridgeBody });

      // ---- (5) cost mix: QB expense-account shares for the month (top 8 + other) ----
      let mixBody;
      if (cur && cur.qbAny && cur.accounts.length) {
        const positive = cur.accounts.filter((a) => a.p > 0).sort((a, b) => b.p - a.p);
        const total = positive.reduce((s2, a) => s2 + a.p, 0);
        const top = positive.slice(0, 8);
        const otherP = total - top.reduce((s2, a) => s2 + a.p, 0);
        const rows = top.map((a) => S.rcc.barrow({
          label: a.name, value: `${pct1((a.p / total) * 100)} · ${gbp0(a.p)}`,
          segs: [{ pct: (a.p / total) * 100, color: a.bucket === 'cogs' ? C_COGS : a.bucket === 'labour' ? C_LAB : C_OVER }],
        }));
        if (otherP > 0) rows.push(S.rcc.barrow({ label: `Other (${int(positive.length - top.length)} accounts)`, value: `${pct1((otherP / total) * 100)} · ${gbp0(otherP)}`, segs: [{ pct: (otherP / total) * 100, color: '#56616e' }] }));
        mixBody = `<div class="r-meters">${rows.join('')}</div>
          <div class="r-mini-note">${esc(refLabel)} · QB P&amp;L expense accounts (qb_pl_monthly), shares of total month expenses ${gbp0(total)} · QB LEDGER basis — the payroll-class accounts here are the ledger's wage lines, NOT the TRUE labour ruler (that story lives in the Labour Centre).</div>`;
      } else {
        mixBody = S.rcc.emptyState({ title: 'Cost mix', blocker: 'No QB ledger rows for the reference month.', unlock: 'the QuickBooks ledger ingest (qb_pl_monthly)' });
      }
      const mixPanel = S.rcc.panel({ title: 'Cost mix', sub: 'where the month’s cost went · QB expense categories', body: mixBody });

      // ---- (6) core control ratios: month + 3-month trend arrows + site contribution ----
      let ratioBody;
      if (cur && cur.net > 0 && cur.qbAny) {
        const prior3 = months.slice(-4, -1);
        const avgRatio = (fn) => {
          const vals = prior3.map(fn).filter((v) => v != null);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        };
        const arrow = (curV, avgV, goodWhenDown) => {
          if (curV == null || avgV == null) return { txt: 'no 3-mo base', cls: 'r-flat' };
          const d = curV - avgV;
          if (Math.abs(d) < 0.15) return { txt: `→ flat vs 3-mo avg ${pct1(avgV)}`, cls: 'r-flat' };
          const up = d > 0;
          const good = goodWhenDown ? !up : up;
          return { txt: `${up ? '▲' : '▼'} ${pct1(Math.abs(d))} vs 3-mo avg ${pct1(avgV)}`, cls: good ? 'r-up' : 'r-down' };
        };
        const ratioOf = {
          cogs: (mo) => (mo.net > 0 && mo.cogs != null ? (mo.cogs / mo.net) * 100 : null),
          labour: (mo) => (mo.net > 0 && mo.labour != null ? (mo.labour / mo.net) * 100 : null),
          over: (mo) => (mo.net > 0 && mo.over != null ? (mo.over / mo.net) * 100 : null),
          cm: (mo) => (mo.net > 0 && mo.cogs != null && mo.labour != null && mo.qbAny ? ((mo.net - mo.cogs - mo.labour - mo.variable) / mo.net) * 100 : null),
        };
        const driver = (label, curV, a, sub) => `<div class="r-driver"><small>${esc(label)}</small><strong>${esc(pct1(curV))}</strong><p><span class="${a.cls}">${esc(a.txt)}</span> · ${esc(sub)}</p></div>`;
        const siteContrib = cur.labour != null ? cur.net - cur.cogs - cur.labour - cur.over : null;
        ratioBody = `<div class="r-driver-grid">
            ${driver('COGS ÷ revenue', ratioOf.cogs(cur), arrow(ratioOf.cogs(cur), avgRatio(ratioOf.cogs), true), 'QB COGS ÷ month net')}
            ${driver('Labour ÷ revenue', ratioOf.labour(cur), arrow(ratioOf.labour(cur), avgRatio(ratioOf.labour), true), 'TRUE labour ÷ month net (import)')}
            ${driver('Overheads ÷ revenue', ratioOf.over(cur), arrow(ratioOf.over(cur), avgRatio(ratioOf.over), true), 'QB overheads ÷ month net')}
            ${driver('Contribution margin', ratioOf.cm(cur), arrow(ratioOf.cm(cur), avgRatio(ratioOf.cm), false), 'after variable overheads')}
          </div>
          <div style="margin-top:10px">${S.rcc.driver({ label: 'Site contribution', value: gbp0(siteContrib), sub: `net − COGS − labour − ALL overheads · ${refLabel} · its one home` })}</div>
          <div class="r-mini-note">${esc(refLabel)} vs the 3 prior months' average (arrows; cost ratios read down-as-good) · same bases as the strip · a month missing a wire contributes nothing to the average.</div>`;
      } else {
        ratioBody = S.rcc.emptyState({ title: 'Core control ratios', blocker: 'No month with both a sales record and QB ledger rows yet.', unlock: 'the QuickBooks + Lightspeed ingests' });
      }
      const ratioPanel = S.rcc.panel({ title: 'Core control ratios', sub: 'the driver set · month + 3-month trend', body: ratioBody });

      return `<div class="r-grid r-kpi-grid">${kpis}</div>${kpiCaption}
        <div class="r-grid r-two-col">${trendPanel}${queuePanel}</div>
        ${bridgePanel}
        <div class="r-grid r-two-col">${mixPanel}${ratioPanel}</div>`;
    };

    // ============================ FIXED & SEMI-FIXED ============================
    const renderFixedTab = () => {
      const f = m.fixed || {};

      // ---- (1) monthly overheads by account: trailing 6 + current, top 15 + aggregate ----
      let tableBody;
      if (f.qbMax && (f.topAccounts || []).length) {
        const cols = f.tableMonths;
        const colLabel = (ym, i) => `${monthLabel(ym)}${i === cols.length - 1 && f.qbMaxPartial ? ' (in progress)' : ''}`;
        const head = `<tr><th>Account</th><th>Class</th>${cols.map((ym, i) => `<th class="r-num">${esc(colLabel(ym, i))}</th>`).join('')}</tr>`;
        const rowHtml = (a) => `<tr><td>${esc(a.name)}</td><td>${behaviourChip(a.behaviour)}</td>${cols.map((ym) =>
          `<td class="r-num mono">${a.byYm.has(ym) ? esc(gbp0(a.byYm.get(ym))) : '—'}</td>`).join('')}</tr>`;
        const otherRow = f.otherAccounts.length
          ? `<tr><td>All other overhead accounts (${int(f.otherAccounts.length)}) — aggregated</td><td>${S.rcc.tag('mixed')}</td>${cols.map((ym) => {
            const s2 = f.otherAccounts.reduce((acc, a) => acc + (a.byYm.get(ym) || 0), 0);
            return `<td class="r-num mono">${s2 !== 0 ? esc(gbp0(s2)) : '—'}</td>`;
          }).join('')}</tr>` : '';
        tableBody = `<div style="overflow:auto"><table><thead>${head}</thead><tbody>${f.topAccounts.map(rowHtml).join('')}${otherRow}</tbody></table></div>
          <div class="r-mini-note">qb_pl_monthly ⋈ qb_accounts, Expense classification EX Cost-of-Goods-Sold EX payroll-class accounts (labour's one home is the Labour Centre) · top ${int(f.topAccounts.length)} accounts by trailing-6-month size, the rest aggregated (stated) · account names as the ledger writes them, '(NNN)' suffixes included · class chips = the presentation judgment below.</div>`;
      } else {
        tableBody = S.rcc.emptyState({ title: 'Monthly overheads', blocker: 'No QB ledger months yet (qb_pl_monthly is empty).', unlock: 'the QuickBooks ledger ingest' });
      }
      const tablePanel = S.rcc.panel({ title: 'Monthly fixed and semi-fixed overheads', sub: 'QB expense accounts by month · trailing 6 + current', body: tableBody });

      // ---- (2) cost behaviour map — the captioned presentation judgment ----
      let mapBody;
      if (f.behaviour) {
        const card = (key2, tone) => {
          const b = f.behaviour[key2];
          return `<div class="r-driver"><small>${esc(BEHAVIOUR_LABEL[key2])}</small><strong>${esc(gbp0(b.avgMonth))}<span style="font-size:11px;color:#8d97a2">/mo avg</span></strong><p>${int(b.count)} account(s)${b.top.length ? ` · ${esc(b.top.join(' · '))}` : ''}</p>${tone ? '' : ''}</div>`;
        };
        mapBody = `<div class="cst-behave">${card('fixed')}${card('semi')}${card('variable')}</div>
          <div class="r-mini-note">classification = presentation judgment, not a ruling — rent/rates/insurance/subscriptions read fixed, energy/water/repairs semi-fixed, the rest variable (account-name classes; say the word and any account moves) · monthly averages over the 6 full trailing months.</div>`;
      } else {
        mapBody = S.rcc.emptyState({ title: 'Cost behaviour map', blocker: 'No QB ledger months to classify.', unlock: 'the QuickBooks ledger ingest' });
      }
      const mapPanel = S.rcc.panel({ title: 'Cost behaviour map', sub: 'fixed / semi-fixed / variable · a presentation judgment, captioned', body: mapBody });

      // ---- (3) overhead trend: 12-month line, total + the 3 biggest accounts ----
      let trendBody;
      if (f.months12 && (f.monthTotals || []).some((r) => r.any)) {
        const T = 20, B = 220, L = 60, R = 865;
        const n = f.months12.length;
        const X = (i) => Math.round((L + (i * (R - L)) / Math.max(1, n - 1)) * 10) / 10;
        const series = [
          { name: 'Total overheads', color: S.rcc.tokens.accent, pts: f.monthTotals.map((r) => (r.any ? r.over : null)) },
          ...(f.trendTop3 || []).map((a, i) => ({
            name: a.name, color: [S.rcc.tokens.blue, S.rcc.tokens.accent2, S.rcc.tokens.purple][i],
            pts: f.months12.map((ym) => (a.byYm.has(ym) ? a.byYm.get(ym) : null)),
          })),
        ];
        const maxV = Math.max(...series.flatMap((s2) => s2.pts.filter((v) => v != null)), 1);
        const Y = (v) => Math.round((B - ((B - T) * v) / maxV) * 10) / 10;
        const grid = [0.25, 0.5, 0.75, 1].map((t) => `<line x1="54" y1="${Y(maxV * t)}" x2="870" y2="${Y(maxV * t)}" class="gridline"/><text x="2" y="${Y(maxV * t) + 4}" class="axistext">${esc(gbp0(maxV * t))}</text>`).join('');
        const lines = series.map((s2) => {
          const idx = s2.pts.map((v, i) => ({ i, v }));
          return REP.contiguousRuns(idx, (p) => p.v != null).map((run) => run.length === 1
            ? `<circle cx="${X(run[0].i)}" cy="${Y(run[0].v)}" r="3.5" fill="${s2.color}" class="cst-pt"/>`
            : `<polyline points="${run.map((p) => `${X(p.i)},${Y(p.v)}`).join(' ')}" class="cst-line" stroke="${s2.color}"/>`).join('');
        }).join('');
        const xlabs = f.months12.map((ym, i) => (i % 2 === 0 ? `<text x="${X(i) - 12}" y="243" class="axistext">${esc(MONTHS_ABBR[Number(ym.slice(5, 7))])}</text>` : '')).join('');
        trendBody = `<div class="chart-wrap"><svg viewBox="0 0 900 260" role="img" aria-label="Twelve month overhead trend">${grid}${lines}${xlabs}</svg></div>
          <div style="margin-top:8px">${legend(series.map((s2) => [s2.color, s2.name]))}</div>
          <div class="r-mini-note">trailing 12 QB months to ${esc(monthLabel(f.qbMax))}${f.qbMaxPartial ? ' (current month in progress)' : ''} · a month without a posting is a GAP — the line breaks, never interpolates.</div>`;
      } else {
        trendBody = S.rcc.emptyState({ title: 'Overhead trend', blocker: 'No QB ledger months to plot.', unlock: 'the QuickBooks ledger ingest' });
      }
      const trendPanel = S.rcc.panel({ title: 'Overhead trend and budget control', sub: 'total + the three biggest accounts · 12 months', body: trendBody });

      // ---- (4) renewal & commitment calendar — basis-carrying entries ----
      const calRows = [];
      calRows.push(`<tr><td>Rent — the step</td><td class="mono">${esc(RENT_STEP.date)}</td><td class="r-num mono">${esc(rentStepText(f.rentDays != null ? f.rentDays : rentStepDaysUntil(now)))}</td><td>${S.rcc.tag('contractual', 'info')}</td><td>lease canon (encoded, never derived) · quarterly-billed via Workman${f.rent12 != null ? ` · ledger last 12 months ${esc(gbp0(f.rent12))} (Rent (205) + Rent + SC Clearing Account aggregated)` : ''}</td></tr>`);
      if (f.rates) {
        calRows.push(`<tr><td>Business rates — Highland Council</td><td class="mono">last ${esc(f.rates.last)}</td><td class="r-num mono">${esc(gbp0(f.rates.medianPence))} median · ${esc(gbp0(f.rates.totalPence))} / 12 mo</td><td>${S.rcc.tag('observed', 'warn')}</td><td>observed cadence — ${int(f.rates.n)} bank payment(s) ≥ £100 in the trailing year (bank truth, not a rates bill)</td></tr>`);
      } else {
        calRows.push(`<tr><td>Business rates — Highland Council</td><td class="mono">—</td><td class="r-num mono">—</td><td>${S.rcc.tag('observed', 'warn')}</td><td>no Highland Council bank payments in the trailing year — the schedule renders when the bank wire shows one</td></tr>`);
      }
      const calPanel = S.rcc.panel({
        title: 'Renewal and commitment calendar', sub: 'every entry carries its basis — contractual vs observed',
        body: `<div style="overflow:auto"><table><thead><tr><th>Commitment</th><th>When</th><th class="r-num">Amount</th><th>Basis</th><th>Notes</th></tr></thead><tbody>${calRows.join('')}</tbody></table></div>
          <div class="r-mini-note">contractual entries are encoded canon (the lease); observed entries are bank-txn patterns and say so — an observed cadence is evidence, not an obligation.</div>`,
      });

      return `${tablePanel}
        <div class="r-grid r-two-col">${trendPanel}${mapPanel}</div>
        ${calPanel}`;
    };

    // ============================ CASH COMMITMENTS ============================
    const renderCashTab = () => {
      const c = m.cash || {};

      // ---- (1) 13-week cash commitment calendar — the corrected premise ----
      let calBody;
      const rentNote = S.rcc.note(`Rent (via Workman) — contractual, lease canon: ${rentStepText(c.rentDays != null ? c.rentDays : rentStepDaysUntil(now))}. Quarterly-billed; payment dates are observed when they land, never projected.`);
      if (c.bankMax && (c.recurring || []).length) {
        const weekRows = c.weeks.map((w) => `<tr><td class="mono">wk of ${esc(w.monday)}</td><td class="r-num mono">${w.totalPence > 0 ? esc(gbp0(w.totalPence)) : '—'}</td><td>${w.items.length ? esc(w.items.map((it) => it.n > 1 ? `${it.cp} ×${it.n}` : it.cp).join(' · ')) : '<span class="ash">no projected pattern lands</span>'}</td></tr>`).join('');
        const recRows = c.recurring.map((r) => `<tr><td>${esc(r.cp)}</td><td class="r-num mono">${int(r.n)}</td><td class="r-num mono">~${int(r.cadenceDays)}d</td><td class="r-num mono">${esc(gbp0(r.medianPence))}</td><td class="mono">${r.nextDate ? esc(r.nextDate) : '—'}</td><td>${S.rcc.tag('projected from observed cadence', 'warn')}</td></tr>`).join('');
        calBody = `${rentNote}
          <div class="r-grid r-two-col" style="margin-top:12px">
            <div><div style="overflow:auto"><table><thead><tr><th>Counterparty</th><th class="r-num">Days paid · 6mo</th><th class="r-num">Cadence</th><th class="r-num">Median £</th><th>Next projected</th><th>Basis</th></tr></thead><tbody>${recRows}</tbody></table></div></div>
            <div><div style="overflow:auto"><table><thead><tr><th>Week</th><th class="r-num">Projected outflow</th><th>Patterns landing</th></tr></thead><tbody>${weekRows}</tbody></table></div></div>
          </div>
          <div class="r-mini-note">every projected row is PROJECTED FROM OBSERVED CADENCE — bank purchases ${esc(c.window.from)} → ${esc(c.window.to)} (qb_bank_txns): a counterparty recurs at ≥3 payment days with near-regular gaps (median gap 2–45d, every gap within ±half-a-cadence ±3d); projection = last payment + k × median cadence at the median day-£ · a one-off is history, NEVER projected · person-named payroll counterparties pool into ONE Staff-payroll line — people render as aggregates (the surveillance-boundary ruling), the payment pattern itself is a cash fact · no bills ledger exists (qb_bills dead — see AP ageing), so due dates cannot be the source.</div>`;
      } else if (c.bankMax) {
        calBody = `${rentNote}<div style="margin-top:12px">${S.rcc.emptyState({ title: '13-week cash commitment calendar', blocker: 'No recurring bank-outflow pattern detected in the trailing 6 months (≥3 near-regular payment days) — one-off history is never projected.', unlock: 'more bank history (qb_bank_txns)' })}</div>`;
      } else {
        calBody = `${rentNote}<div style="margin-top:12px">${S.rcc.emptyState({ title: '13-week cash commitment calendar', blocker: 'No bank purchases recorded (qb_bank_txns).', unlock: 'the QuickBooks bank ingest' })}</div>`;
      }
      const calPanel = S.rcc.panel({
        title: '13-week cash commitment calendar', sub: 'recurring bank-outflow patterns + contractual lines · NOT bill due dates (no bills ledger — stated)',
        body: calBody,
      });

      // ---- (2) AP ageing — the mapped empty-state, verbatim ----
      const apPanel = S.rcc.panel({
        title: 'Accounts payable ageing', sub: 'the bills ledger the venue does not run',
        headRight: S.rcc.tag('designed empty-state', 'info'),
        body: S.rcc.emptyState({ title: 'Accounts payable ageing', blocker: AP_BLOCKER }),
      });

      // ---- (3) P&L cost versus cash paid — month grain, timing delta stated ----
      let pvBody;
      if (c.plVsCash && c.plVsCash.some((r) => r.pl != null || r.cash != null)) {
        const rows = c.plVsCash.map((r) => {
          const delta = r.pl != null && r.cash != null ? r.cash - r.pl : null;
          return `<tr><td class="mono">${esc(monthLabel(r.ym))}${r.partial ? ' <span class="ash">(in progress)</span>' : ''}</td><td class="r-num mono">${esc(gbp0(r.pl))}</td><td class="r-num mono">${esc(gbp0(r.cash))}</td><td class="r-num mono">${delta != null ? `${delta >= 0 ? '+' : '−'}${esc(gbp0(Math.abs(delta)))}` : '—'}</td></tr>`;
        }).join('');
        pvBody = `<div style="overflow:auto"><table><thead><tr><th>Month</th><th class="r-num">P&amp;L expense (journal)</th><th class="r-num">Cash paid (bank)</th><th class="r-num">Delta</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="r-mini-note">month grain, trailing 6 to the bank record's latest month · P&amp;L = qb_journal_lines expense-classified accounts (debit − credit) · cash = qb_bank_txns purchases — which include VAT, payroll, HMRC and capital items the P&amp;L expense line does not · the delta is BASIS + TIMING, stated not hidden.</div>`;
      } else {
        pvBody = S.rcc.emptyState({ title: 'P&L cost versus cash paid', blocker: 'Needs both the journal and the bank record for a month.', unlock: 'the QuickBooks ingests (qb_journal_lines + qb_bank_txns)' });
      }
      const pvPanel = S.rcc.panel({ title: 'P&L cost versus cash paid', sub: 'accrual ledger vs bank truth · month grain', body: pvBody });

      // ---- (4) upcoming large commitments ----
      const bigRows = [];
      bigRows.push(`<tr><td>Rent — the step</td><td class="r-num mono">${esc(gbp0(RENT_STEP.afterPenceYr / 4))}/quarter from ${esc(RENT_STEP.date)} (now ${esc(gbp0(RENT_STEP.beforePenceYr / 4))})</td><td>${S.rcc.tag('contractual', 'info')}</td><td>${esc(rentStepText(c.rentDays != null ? c.rentDays : rentStepDaysUntil(now)))}</td></tr>`);
      const bigRecurring = (c.recurring || []).filter((r) => r.medianPence * (91 / r.cadenceDays) > 500000);
      for (const r of bigRecurring) {
        bigRows.push(`<tr><td>${esc(r.cp)}</td><td class="r-num mono">~${esc(gbp0(r.medianPence * (91 / r.cadenceDays)))}/quarter</td><td>${S.rcc.tag('projected from observed cadence', 'warn')}</td><td>${esc(gbp0(r.medianPence))} every ~${int(r.cadenceDays)}d (bank pattern, 6-month window)</td></tr>`);
      }
      const bigPanel = S.rcc.panel({
        title: 'Upcoming large commitments', sub: 'the rent step + projected recurring above 5k/quarter · basis stated per row',
        body: `<div style="overflow:auto"><table><thead><tr><th>Commitment</th><th class="r-num">Scale</th><th>Basis</th><th>Detail</th></tr></thead><tbody>${bigRows.join('')}</tbody></table></div>`,
      });

      // ---- (5) working-capital controls — the honest set ----
      let wcBody;
      if (c.controls) {
        const w = c.controls;
        wcBody = `<div class="r-driver-grid">
            ${S.rcc.driver({ label: 'Cash out · 90d', value: gbp0(w.totalPence), sub: `${int(w.n)} bank purchase(s) over ${int(w.days)} payment day(s)` })}
            ${S.rcc.driver({ label: 'Payment days / week', value: (w.days / (90 / 7)).toFixed(1), sub: 'distinct outflow days ÷ 90d weeks — the cash-out cadence' })}
            ${S.rcc.driver({ label: 'Largest single outflow', value: gbp0(w.largest ? w.largest.p : null), sub: w.largest ? `${w.largest.cp} · ${w.largest.d}` : '' })}
            ${S.rcc.driver({ label: 'Recurring-pattern share', value: w.recurringShare != null ? pct1(w.recurringShare) : '—', sub: 'share of 90d cash-out from detected recurring counterparties' })}
          </div>
          <div style="margin-top:10px">${S.rcc.driver({ label: 'Debtor days', value: 'n/a — cash business', sub: 'customers pay at the till; there is no debtor book to age' })}</div>
          <div class="r-mini-note">what the wires honestly support: bank cash-out cadence stats (qb_bank_txns, 90d to ${esc(c.bankMax)}) · stock-holding and creditor-days need wires that do not exist (no stock counts, no bills ledger) — absent, not faked.</div>`;
      } else {
        wcBody = S.rcc.emptyState({ title: 'Working-capital controls', blocker: 'No bank purchases in the trailing 90 days (qb_bank_txns).', unlock: 'the QuickBooks bank ingest' });
      }
      const wcPanel = S.rcc.panel({ title: 'Working-capital controls', sub: 'cash-out cadence · the debtor side stated honestly', body: wcBody });

      return `${calPanel}
        <div class="r-grid r-two-col">${pvPanel}${apPanel}</div>
        <div class="r-grid r-two-col">${bigPanel}${wcPanel}</div>`;
    };

    // ============================ COST FORECAST (C2) ============================
    const renderForecastTab = () => {
      const f = m.forecast || {};
      const rentLine = S.rcc.note(`Contractual rent step — lease canon: ${rentStepText(f.rentDays != null ? f.rentDays : rentStepDaysUntil(now))}. Enters the outlook as a hard line the ${esc(RENT_STEP.date)} obligation begins, never inferred from the ledger.`);
      if (!f.ready || !f.base) {
        return S.rcc.panel({ title: 'Cost forecast', sub: 'accrual-basis forward cost — distinct from the cash-out timing on Cash Commitments',
          body: rentLine + `<div style="margin-top:12px">${S.rcc.emptyState({ title: 'Cost forecast', blocker: 'not enough complete months with BOTH day-net sales and QB expense rows to set the cost-ratio base.', unlock: 'the QuickBooks P&L + sales ingest over ≥1 complete month' })}</div>` });
      }
      const b = f.base;
      // interactive scenario: client-only slider scaling revenue; recompute COGS/variable/contribution.
      const netP = Math.round(b.netMonthly), cogsP = b.cogsPct != null ? Math.round(b.netMonthly * b.cogsPct / 100) : 0,
        varP = b.varPct != null ? Math.round(b.netMonthly * b.varPct / 100) : 0, fixP = Math.round(b.fixedMonthly || 0);
      const scenarioPanel = S.rcc.panel({
        title: 'Interactive cost scenario', sub: `base = trailing ${b.monthsWithBoth} complete month(s) · ratios carried forward · what-if only, nothing stored`,
        body: `<div class="cst-scn" data-net="${netP}" data-cogspct="${b.cogsPct != null ? b.cogsPct.toFixed(3) : ''}" data-varpct="${b.varPct != null ? b.varPct.toFixed(3) : ''}" data-fixed="${fixP}">
            <div class="r-grid" style="grid-template-columns:1fr;gap:8px">
              <label class="cst-slabel">Revenue vs base <b id="cst-rv">0%</b><input id="cst-rslider" type="range" min="-20" max="20" step="1" value="0" style="width:100%;accent-color:${S.rcc.tokens.accent}"></label>
            </div>
            <table style="margin-top:10px"><tbody>
              <tr><td>Revenue (month)</td><td class="r-num mono" id="cst-net">${esc(gbp0(netP))}</td></tr>
              <tr><td>− COGS <span class="ash">(${b.cogsPct != null ? b.cogsPct.toFixed(1) : '—'}% of net)</span></td><td class="r-num mono" id="cst-cogs">${esc(gbp0(cogsP))}</td></tr>
              <tr><td>− Variable overheads <span class="ash">(${b.varPct != null ? b.varPct.toFixed(1) : '—'}%)</span></td><td class="r-num mono" id="cst-var">${esc(gbp0(varP))}</td></tr>
              <tr><td>− Fixed + semi-fixed <span class="ash">(held)</span></td><td class="r-num mono">${esc(gbp0(fixP))}</td></tr>
              <tr style="border-top:1px solid ${S.rcc.tokens.line}"><td><b>Contribution</b></td><td class="r-num mono" id="cst-con"><b>${esc(gbp0(netP - cogsP - varP - fixP))}</b></td></tr>
            </tbody></table>
          </div>
          <script>(function(){
            var box=document.querySelector('.cst-scn'); if(!box) return;
            var net=+box.dataset.net, cp=parseFloat(box.dataset.cogspct)||0, vp=parseFloat(box.dataset.varpct)||0, fx=+box.dataset.fixed;
            var sl=document.getElementById('cst-rslider');
            function gbp(p){var v=Math.round(p/100);return '\\u00a3'+v.toLocaleString('en-GB');}
            function upd(){var pct=+sl.value; var n=net*(1+pct/100); var c=n*cp/100, vo=n*vp/100;
              document.getElementById('cst-rv').textContent=(pct>=0?'+':'')+pct+'%';
              document.getElementById('cst-net').textContent=gbp(n);
              document.getElementById('cst-cogs').textContent=gbp(c);
              document.getElementById('cst-var').textContent=gbp(vo);
              document.getElementById('cst-con').innerHTML='<b>'+gbp(n-c-vo-fx)+'</b>';}
            sl.addEventListener('input',upd);
          })();</script>`,
      });
      const rulePanel = S.rcc.panel({ title: 'Scenario decision rule', sub: 'the ruled cost discipline',
        body: `<div class="r-formula">${['COGS and variable overheads move WITH revenue (ratio-held); fixed + semi-fixed are level.',
          'A revenue fall does NOT proportionally cut cost — the fixed base is the exposure.',
          'The contractual rent step is a hard obligation, not a scenario input.',
          'Theoretical COGS (recipe-costed) would sharpen COGS% — locked behind the Calum gate.'].map(esc).join('<br>')}</div>` });
      const outRows = f.outlook.map((o) => `<tr><td class="mono">${esc(monthLabel(o.ym))}</td><td class="r-num mono">${esc(gbp0(o.projNet))}</td><td class="r-num mono">${esc(gbp0(o.cogs))}</td><td class="r-num mono">${esc(gbp0(o.varo))}</td><td class="r-num mono">${esc(gbp0(o.fixed))}</td><td class="r-num mono">${esc(gbp0((o.projNet || 0) - (o.cogs || 0) - (o.varo || 0) - (o.fixed || 0)))}</td>${o.rentStepActive ? `<td>${S.rcc.tag('rent step live', 'warn')}</td>` : '<td></td>'}</tr>`).join('');
      const outlookPanel = S.rcc.panel({ title: '3-month cost outlook', sub: 'accrual basis — cost INCURRED (Cash Commitments owns the cash-OUT timing) · projected net = flat carry of the base month (the RCC forecast owns the seasonality model — pointered, not re-derived)',
        body: `<div style="overflow:auto"><table><thead><tr><th>Month</th><th class="r-num">Proj net</th><th class="r-num">COGS</th><th class="r-num">Var OH</th><th class="r-num">Fixed</th><th class="r-num">Contribution</th><th></th></tr></thead><tbody>${outRows}</tbody></table></div>
          <div class="r-mini-note">projected revenue is a FLAT CARRY of the base month, stated — for the seasonality-aware headline see <a href="/coyote/revenue?tab=forecast" style="color:${S.rcc.tokens.blue}">Revenue → Forecast</a> (one home) · rent step ${esc(RENT_STEP.date)}: £${(RENT_STEP.beforePenceYr / 100 / 1000)}k → £${(RENT_STEP.afterPenceYr / 100 / 1000)}k/yr.</div>` });
      const risks = [
        { t: 'Contractual rent step', p: `£${(RENT_STEP.beforePenceYr / 100 / 1000)}k → £${(RENT_STEP.afterPenceYr / 100 / 1000)}k/yr from ${RENT_STEP.date} — a fixed-cost increase locked in the lease.`, tone: 'warn' },
        { t: 'Processor fee visibility', p: 'card fees moved to net settlement — current fees are invisible in QB until the processor statement is wired (the Reconciliation unlock).', tone: 'info' },
        { t: 'Recipe-costing gap', p: 'without recipe costs, COGS% cannot be split actual-vs-theoretical — waste/spec drift is unmeasured (the Calum gate).', tone: 'info' },
      ];
      const riskPanel = S.rcc.panel({ title: 'Forward cost risks', sub: 'named, with basis',
        body: `<div class="r-alert-list">${risks.map((r) => S.rcc.alert({ title: r.t, text: r.p, tone: r.tone })).join('')}</div>` });
      return `<div class="r-grid r-two-col">${scenarioPanel}${rulePanel}</div>${outlookPanel}${riskPanel}`;
    };

    // ============================ SUPPLIERS & PURCHASING (C2) ============================
    const renderSuppliersTab = () => {
      const s = m.suppliers || {};
      if (!s.bankMax || !s.suppliers || !s.suppliers.length) {
        return S.rcc.panel({ title: 'Supplier scorecard', sub: 'from bank purchases (qb_bank_txns)',
          body: S.rcc.emptyState({ title: 'Supplier scorecard', blocker: 'no bank purchases recorded (qb_bank_txns).', unlock: 'the QuickBooks bank ingest' }) });
      }
      const rows = s.suppliers.map((r) => `<tr><td>${esc(r.cp)}${r.isAggregate ? ` ${S.rcc.tag('aggregated', 'info')}` : ''}</td><td class="r-num mono">${esc(gbp0(r.spend))}</td><td class="r-num mono">${r.n != null ? int(r.n) : '—'}</td><td class="r-num mono">${r.sharePct.toFixed(1)}%</td><td class="r-num mono">${r.trendPct != null ? `<span style="color:${r.trendPct > 0 ? S.rcc.tokens.bad : S.rcc.tokens.good}">${r.trendPct >= 0 ? '+' : ''}${r.trendPct.toFixed(0)}%</span>` : '<span class="ash">—</span>'}</td></tr>`).join('');
      const scorePanel = S.rcc.panel({ title: 'Supplier scorecard', sub: `bank purchases by counterparty · ${esc(s.window.from)} → ${esc(s.window.to)} (trailing 12mo) · TRUE supplier-spend wire (qb_bills is dead)`,
        body: `<div style="overflow:auto"><table><thead><tr><th>Counterparty</th><th class="r-num">Spend 12mo</th><th class="r-num">Payments</th><th class="r-num">Share</th><th class="r-num">vs prior yr</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="r-mini-note">spend = qb_bank_txns purchases (VAT-inclusive; includes non-food outflows — rent agent, HMRC, utilities) · person-named payees pool into ONE Staff-payroll line (the surveillance boundary) · a supplier scorecard'\''s delivery/quality axis needs data no wire holds — see the dependency matrix.</div>` });
      const con = s.concentration;
      const concPanel = S.rcc.panel({ title: 'Supplier spend concentration', sub: 'dependency risk',
        body: con ? `<div class="r-grid" style="grid-template-columns:1fr 1fr;gap:12px">
            <div class="r-card r-kpi"><div class="r-kpi-label">Top supplier share</div><div class="r-kpi-value">${con.top1.toFixed(1)}%</div><div class="r-kpi-sub">of 12mo purchase spend</div></div>
            <div class="r-card r-kpi"><div class="r-kpi-label">Top-3 share</div><div class="r-kpi-value">${con.top3.toFixed(1)}%</div><div class="r-kpi-sub">${int(con.n)} counterparties total</div></div>
          </div><div class="r-mini-note">concentration = the exposure if a top supplier fails or raises prices · Booker-led food supply is the single largest dependency.</div>`
          : S.rcc.emptyState({ title: 'Concentration', blocker: 'no purchase spend in the window.' }) });
      const ppvPanel = S.rcc.panel({ title: 'Purchase price variance', sub: 'per-unit price movement', headRight: S.rcc.tag('invoice-line gated', 'warn'),
        body: S.rcc.emptyState({ title: 'Purchase price variance', blocker: INVOICE_LINE_BLOCKER, unlock: INVOICE_LINE_UNLOCK }) });
      const invPanel = S.rcc.panel({ title: 'Invoice control queue', sub: 'the bills ledger the venue does not run', headRight: S.rcc.tag('designed empty-state', 'info'),
        body: S.rcc.emptyState({ title: 'Invoice control queue', blocker: AP_BLOCKER }) });
      const depPanel = S.rcc.panel({ title: 'Supplier dependency × performance', sub: 'spend axis real · performance axis absent',
        body: S.rcc.emptyState({ title: 'Dependency × performance', blocker: 'the spend (dependency) axis is real (concentration, above), but the performance axis — on-time delivery, fill rate, quality/credit rate — needs supplier-performance data no current wire holds.', unlock: 'delivery/quality capture (invoice-line ingest carries some; the rest is a supplier-portal decision)' }) });
      const oppPanel = S.rcc.panel({ title: 'Commercial opportunity register', sub: 'operator-curated — a write-path decision',
        body: S.rcc.emptyState({ title: 'Opportunity register', blocker: 'consolidation/renegotiation opportunities are an OPERATOR-ENTERED register — no write-path exists yet (unlike the read-only panels here).', unlock: 'a gated write-path ruling (like the recipe/review action paths)' }) });
      return `${scorePanel}${concPanel}<div class="r-grid r-two-col">${ppvPanel}${invPanel}</div><div class="r-grid r-two-col">${depPanel}${oppPanel}</div>`;
    };

    // ============================ COGS & INVENTORY (C3) ============================
    const renderCogsTab = () => {
      const c = m.cogs || {};
      if (!c.refMonth) {
        return S.rcc.panel({ title: 'COGS & inventory', sub: 'monthly bookkeeping and item sales',
          body: plainEmpty('COGS & inventory', 'There is no completed sales or bookkeeping month to report yet.', 'Add the monthly sales and QuickBooks cost records.') });
      }
      const recipe = c.recipe || {};
      const monthly = recipe.monthly || null;
      const postingGated = c.postingSettled === false;
      const gatePanel = postingGated
        ? S.rcc.panel({ title: 'COGS posting gate', sub: `${esc(monthLabel(c.refMonth))} · purchase posting incomplete`, headRight: S.rcc.tag('ratio withheld', 'warn'),
          body: plainEmpty('COGS ratio withheld', `Purchase posting is incomplete for ${monthLabel(c.refMonth)}, so the COGS ratio and recorded purchase-cost figures are withheld. ${c.net != null ? `Complete automatic-feed sales remain available: ${gbp0(c.net)}.` : 'Complete automatic-feed sales are not available for this month.'} The COGS figure returns automatically once posting is complete.`) })
        : '';
      const categoryMap = new Map();
      for (const a of c.cogsCats || []) categoryMap.set(a.name, { name: a.name, actual: a.p, theoretical: null });
      for (const a of (monthly && monthly.byCategory) || []) {
        const row = categoryMap.get(a.name) || { name: a.name, actual: null, theoretical: null };
        row.theoretical = a.p;
        categoryMap.set(a.name, row);
      }
      const categories = [...categoryMap.values()].sort((a, b) =>
        (b.actual || 0) - (a.actual || 0) || (b.theoretical || 0) - (a.theoretical || 0) || a.name.localeCompare(b.name));
      const catRows = categories.length
        ? categories.map((a) => `<tr><td>${esc(a.name)}</td><td class="r-num mono">${postingGated ? '<span class="ash">withheld</span>' : a.actual == null ? '<span class="ash">—</span>' : esc(gbp0(a.actual))}</td><td class="r-num mono">${a.theoretical == null ? '<span class="ash">—</span>' : esc(gbp0(a.theoretical))}</td></tr>`).join('')
        : postingGated
          ? `<tr><td colspan="3" class="ash">Actual COGS is withheld for ${esc(monthLabel(c.refMonth))} while purchase posting is incomplete.</td></tr>`
          : `<tr><td colspan="3" class="ash">No COGS categories or completely costed product sales in ${esc(monthLabel(c.refMonth))}.</td></tr>`;
      const coverageCopy = monthly && monthly.allNet > 0
        ? `Complete recipes cover ${pct1(monthly.coveragePct)} of ${esc(monthLabel(c.refMonth))} ex-VAT item sales (${gbp0(monthly.coveredNet)} of ${gbp0(monthly.allNet)}).`
        : `No item-level sales are available for ${esc(monthLabel(c.refMonth))}.`;
      const theoreticalTotal = recipe.recipeLines > 0 && monthly && monthly.coveredNet > 0
        ? esc(gbp0(monthly.theoretical)) : '—';
      const avtPanel = S.rcc.panel({ title: 'Actual versus theoretical by category', sub: postingGated
        ? `${esc(monthLabel(c.refMonth))} · actual COGS withheld while purchase posting is incomplete · theoretical = units sold × complete recipe unit cost`
        : `${esc(monthLabel(c.refMonth))} · actual = QB COGS accounts · theoretical = units sold × complete recipe unit cost${c.cogsPct != null ? ` · actual COGS ${c.cogsPct.toFixed(1)}% of net` : ''}`,
        body: `<div style="overflow:auto"><table><thead><tr><th>Category</th><th class="r-num">Actual COGS</th><th class="r-num">Theoretical COGS</th></tr></thead><tbody>${catRows}</tbody><tfoot><tr><th>Total</th><th class="r-num mono">${postingGated ? '<span class="ash">withheld</span>' : c.cogsTotal == null ? '—' : esc(gbp0(c.cogsTotal))}</th><th class="r-num mono">${theoreticalTotal}</th></tr></tfoot></table></div>
          <div class="r-mini-note">${coverageCopy} Bookkeeping categories and menu categories are shown by their own names; matching names share a row.</div>` });

      let bridgeBody; let bridgeTag = '';
      const hasCoveredSales = monthly && monthly.coveredNet > 0;
      if (postingGated) {
        bridgeTag = S.rcc.tag('ratio withheld', 'warn');
        bridgeBody = plainEmpty('COGS variance bridge', `Recorded COGS for ${monthLabel(c.refMonth)} is withheld because purchase posting is incomplete. The comparison returns automatically once posting is complete.`);
      } else if (recipe.recipeLines === 0) {
        bridgeBody = plainEmpty('COGS variance bridge', 'No recipes have been added yet, so expected food cost cannot be calculated.', 'Add complete recipes in Recipes & Costs.');
      } else if (!hasCoveredSales) {
        bridgeBody = plainEmpty('COGS variance bridge', `No ${monthLabel(c.refMonth)} sales have a complete recipe, so there is no theoretical total to compare.`, 'Complete recipes for products sold in this month.');
      } else if (c.cogsTotal == null) {
        bridgeBody = plainEmpty('COGS variance bridge', `The recipe estimate is available, but QuickBooks has no COGS total for ${monthLabel(c.refMonth)}.`, 'Add the month’s COGS postings before comparing the two totals.');
      } else {
        const gap = c.cogsTotal - monthly.theoretical;
        const gapPct = monthly.theoretical > 0 ? (gap / monthly.theoretical) * 100 : null;
        const gapMoney = `${gap > 0 ? '+' : ''}${gbp0(gap)}`;
        const gapPercent = gapPct == null ? 'percentage unavailable' : `${gapPct > 0 ? '+' : ''}${gapPct.toFixed(1)}%`;
        const meaning = gap > 0
          ? 'Recorded COGS is above the recipe estimate. The difference can point to waste, larger portions, buying-price changes, stock timing, or sales that do not yet have complete recipes.'
          : gap < 0
            ? 'Recorded COGS is below the recipe estimate. Check stock timing, supplier credits, late postings and recipe quantities before treating this as a saving.'
            : 'Recorded COGS matches the recipe estimate for the month; continue checking coverage and stock timing before treating the match as exact usage.';
        bridgeTag = S.rcc.tag(gap === 0 ? 'matched' : gap > 0 ? 'actual above recipe' : 'actual below recipe', gap > 0 ? 'bad' : 'good');
        bridgeBody = `<div class="r-grid" style="grid-template-columns:repeat(3,1fr);gap:12px">
            <div class="r-card r-kpi"><div class="r-kpi-label">Actual QB COGS</div><div class="r-kpi-value">${esc(gbp0(c.cogsTotal))}</div><div class="r-kpi-sub">bookkeeping total</div></div>
            <div class="r-card r-kpi"><div class="r-kpi-label">Theoretical COGS</div><div class="r-kpi-value">${esc(gbp0(monthly.theoretical))}</div><div class="r-kpi-sub">sold units × recipe cost</div></div>
            <div class="r-card r-kpi"><div class="r-kpi-label">Gap</div><div class="r-kpi-value">${esc(gapMoney)}</div><div class="r-kpi-sub">${esc(gapPercent)} vs theoretical</div></div>
          </div><div class="r-mini-note">${esc(meaning)} ${coverageCopy}</div>`;
      }
      const bridgePanel = S.rcc.panel({ title: 'COGS variance bridge', sub: `${esc(monthLabel(c.refMonth))} · actual QuickBooks COGS minus theoretical recipe COGS`, headRight: bridgeTag, body: bridgeBody });
      const pricePanel = S.rcc.panel({ title: 'Ingredient price watch', sub: 'item-by-item supplier price movement', headRight: S.rcc.tag('not available', 'info'),
        body: plainEmpty('Ingredient price watch', 'Supplier records currently show total spend by category, not each ingredient’s pack price, pack size and usable quantity.', 'Add itemised supplier invoices to compare ingredient prices over time.') });
      const stockPanel = S.rcc.panel({ title: 'Stock and waste control', sub: 'physical counts and waste records', headRight: S.rcc.tag('not recorded', 'info'),
        body: plainEmpty('Stock and waste control', 'No stock counts or waste logs have been recorded, so expected use cannot yet be compared with what was actually used.', 'Start regular stock counts and record waste quantities and reasons.') });
      const otherRows = !postingGated && c.otherVar.length
        ? c.otherVar.map((a) => `<tr><td>${esc(a.name)}</td><td class="r-num mono">${esc(gbp0(a.p))}</td></tr>`).join('')
        : `<tr><td colspan="2" class="ash">${postingGated ? `Recorded variable costs are withheld for ${esc(monthLabel(c.refMonth))} while purchase posting is incomplete.` : `no other-variable accounts in ${esc(monthLabel(c.refMonth))}`}</td></tr>`;
      const otherPanel = S.rcc.panel({ title: 'Other variable cost control', sub: `${esc(monthLabel(c.refMonth))} · non-COGS variable accounts (packaging, cleaning, consumables)`,
        body: `<div style="overflow:auto"><table><thead><tr><th>Account</th><th class="r-num">Actual £</th></tr></thead><tbody>${otherRows}</tbody></table></div>
          <div class="r-mini-note">variable/COGS classification is a presentation judgment based on QuickBooks account names.</div>` });
      return `${gatePanel}${avtPanel}<div class="r-grid r-two-col">${bridgePanel}${pricePanel}</div><div class="r-grid r-two-col">${stockPanel}${otherPanel}</div>`;
    };

    // ============================ RECIPE MARGINS (C3) ============================
    const renderMarginsTab = () => {
      const g = m.margins || {};
      const productCoverage = g.products > 0 ? (g.costedProducts / g.products) * 100 : null;
      const coveredTotals = g.coveredTotals || {};
      const windowCopy = g.window
        ? `available item sales · ${esc(g.window.from)} → ${esc(g.window.to)}`
        : 'no item-level sales period available';
      const summary = `<div class="r-grid r-three-col">
          ${S.rcc.kpi({ label: 'Sales-weighted recipe coverage', value: pct1(g.coveragePct), sub: g.allNet == null ? 'no item-level sales available' : `${gbp0(g.coveredNet || 0)} of ${gbp0(g.allNet || 0)} ex-VAT item sales` })}
          ${S.rcc.kpi({ label: 'Covered ex-VAT sales', value: g.coveredNet == null ? '—' : gbp0(g.coveredNet), sub: `${int(g.costedProducts || 0)} products with complete recipes` })}
          ${S.rcc.kpi({ label: 'Weighted menu cost', value: pct1(coveredTotals.costPct), sub: 'sold units × ex-VAT recipe cost ÷ covered ex-VAT sales' })}
        </div><div class="rv2-caption">${windowCopy} · achieved sales and recipe costs are ex-VAT.</div>`;

      let leaderboardBody;
      if (g.recipeLines === 0) {
        leaderboardBody = plainEmpty('Recipe margin leaderboard', 'No recipes have been added yet, so product margins cannot be calculated.', 'Add the first complete product recipe in Recipes & Costs.');
      } else if (!(g.leaderboard || []).length) {
        leaderboardBody = plainEmpty('Recipe margin leaderboard', 'No product has a complete recipe yet.', 'Add the missing ingredient, quantity and pack-price details.');
      } else {
        const rows = g.leaderboard.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="ash mono">${esc(p.sku)}</div></td><td class="r-num mono">${esc(gbp(p.unitCostPence))}</td><td class="r-num mono">${p.achievedPricePence == null ? '—' : esc(gbp(p.achievedPricePence))}</td><td class="r-num mono">${p.gpPence == null ? '—' : esc(gbp(p.gpPence))}</td><td class="r-num mono">${esc(pct1(p.marginPct))}</td><td class="r-num mono">${esc(pct1(p.costPct))}</td><td class="r-num mono">${esc(gbp(p.net))}</td><td class="r-num mono">${int(Math.round(p.units))}</td></tr>`).join('');
        const t = g.leaderboardTotals || {};
        leaderboardBody = `<div style="overflow:auto"><table><thead><tr><th>Product</th><th class="r-num">Recipe unit cost</th><th class="r-num">Achieved ex-VAT price</th><th class="r-num">Contribution / unit</th><th class="r-num">Margin %</th><th class="r-num">Cost %</th><th class="r-num">Ex-VAT sales</th><th class="r-num">Units</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th>Top ${int(g.leaderboard.length)} total / weighted average</th><th class="r-num mono">${t.unitCostPence == null ? '—' : esc(gbp(t.unitCostPence))}</th><th class="r-num mono">${t.achievedPricePence == null ? '—' : esc(gbp(t.achievedPricePence))}</th><th class="r-num mono">${t.gpPence == null ? '—' : esc(gbp(t.gpPence))}</th><th class="r-num mono">${esc(pct1(t.marginPct))}</th><th class="r-num mono">${esc(pct1(t.costPct))}</th><th class="r-num mono">${esc(gbp(t.net))}</th><th class="r-num mono">${int(Math.round(t.units || 0))}</th></tr></tfoot></table></div>`;
      }
      const leaderboardPanel = S.rcc.panel({ title: 'Recipe margin leaderboard', sub: `top 20 completely costed products by ex-VAT sales · ${windowCopy}`, body: leaderboardBody });

      let matrixBody;
      if (!g.matrix) {
        matrixBody = plainEmpty('Menu-engineering matrix', g.recipeLines === 0
          ? 'No recipes have been added yet.'
          : 'No completely costed product has both positive units and net sales in the period.', 'Complete recipes for products that are currently selling.');
      } else {
        const cards = ['protect', 'promote', 'fix', 'replace'].map((key) => {
          const quadrant = g.matrix.quadrants[key];
          const leaders = quadrant.leaders.length
            ? quadrant.leaders.map((p) => `<div><b>${esc(p.name)}</b> · <span class="mono">${esc(gbp(p.net))}</span></div>`).join('')
            : '<div class="ash">No products</div>';
          return `<div class="r-card"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(quadrant.label)}</b><span class="mono">${int(quadrant.count)}</span></div><div class="ash" style="font-size:11px;margin:4px 0 8px">${esc(quadrant.detail)}</div>${leaders}</div>`;
        }).join('');
        matrixBody = `<div class="r-grid" style="grid-template-columns:repeat(2,1fr);gap:10px">${cards}</div>
          <div class="r-mini-note">Median split: ${int(Math.round(g.matrix.volumeMedian))} units and ${esc(gbp(g.matrix.gpMedianPence))} contribution/unit. Products exactly on a median enter the high side. Each quadrant lists up to three leaders by ex-VAT sales.</div>`;
      }
      const matrixPanel = S.rcc.panel({ title: 'Menu-engineering matrix', sub: `contribution per unit versus units sold · ${windowCopy}`, body: matrixBody });

      let buildBody; let buildTitle = 'Leading product cost build';
      if (!g.costBuild) {
        buildBody = plainEmpty('Leading product cost build', g.recipeLines === 0 ? 'No recipes have been added yet.' : 'No complete product recipe is available.', 'Complete a product recipe to see its ingredient cost build.');
      } else {
        const p = g.costBuild;
        buildTitle = `${p.name} cost build`;
        const lines = p.lines.map((line) => `<tr><td>${esc(line.ingredient)}</td><td class="r-num mono">${esc(String(line.quantity))}${line.unit ? ` ${esc(line.unit)}` : ''}</td><td class="r-num mono">${line.unitCostPence == null ? '—' : esc(gbp(line.unitCostPence))}</td><td class="r-num mono">${line.lineCostPence == null ? '—' : esc(gbp(line.lineCostPence))}</td></tr>`).join('');
        buildBody = `<div style="overflow:auto"><table><thead><tr><th>Ingredient</th><th class="r-num">Quantity</th><th class="r-num">Unit cost</th><th class="r-num">Line cost</th></tr></thead><tbody>${lines}</tbody><tfoot><tr><th colspan="3">Total recipe cost (ex-VAT)</th><th class="r-num mono">${esc(gbp(p.unitCostPence))}</th></tr><tr><th colspan="3">Achieved average price (ex-VAT)</th><th class="r-num mono">${p.achievedPricePence == null ? '—' : esc(gbp(p.achievedPricePence))}</th></tr></tfoot></table></div>
          <div class="r-mini-note">Highest-selling completely costed product in the available period · ${windowCopy} · ${int(Math.round(p.units))} units · ${esc(gbp(p.net))} ex-VAT sales.</div>`;
      }
      const buildPanel = S.rcc.panel({ title: buildTitle, sub: 'ingredient quantity × usable-unit cost', body: buildBody });

      const qualityPanel = S.rcc.panel({ title: 'Recipe data quality', sub: 'current product and ingredient coverage',
        body: `<div class="r-grid" style="grid-template-columns:repeat(3,1fr);gap:12px">
            <div class="r-card r-kpi"><div class="r-kpi-label">Products</div><div class="r-kpi-value">${int(g.products || 0)}</div><div class="r-kpi-sub">menu products</div></div>
            <div class="r-card r-kpi"><div class="r-kpi-label">Complete recipes</div><div class="r-kpi-value">${int(g.costedProducts || 0)}</div><div class="r-kpi-sub">${productCoverage != null ? productCoverage.toFixed(1) + '% of products' : 'no products yet'}</div></div>
            <div class="r-card r-kpi"><div class="r-kpi-label">Ingredient links</div><div class="r-kpi-value">${g.recipeLines == null ? '—' : int(g.recipeLines)}</div><div class="r-kpi-sub">${g.recipeLines === 0 ? 'no recipes added yet' : 'current recipe entries'}</div></div>
          </div><div class="r-mini-note">A complete recipe has at least one ingredient and valid quantities, pack prices and usable pack quantities throughout. Manage recipes at <a href="/coyote/recipes" style="color:${S.rcc.tokens.blue}">Recipes &amp; Costs</a>.</div>` });
      return `${summary}${leaderboardPanel}<div class="r-grid r-two-col">${matrixPanel}${buildPanel}</div>${qualityPanel}`;
    };

    const tabBody = tab === 'fixed' ? renderFixedTab()
      : tab === 'cash' ? renderCashTab()
      : tab === 'forecast' ? renderForecastTab()
      : tab === 'suppliers' ? renderSuppliersTab()
      : tab === 'cogs' ? renderCogsTab()
      : tab === 'margins' ? renderMarginsTab()
      : renderExecutiveTab();

    const body = `<div class="rcc">` + styles + tabsNav + tabBody + `</div>`;

    // stamp: the active tab's own anchor — QB month for the ledger tabs, bank date for cash.
    let stamp;
    if (tab === 'executive' && m.exec && m.exec.refMonth) stamp = `month ${monthLabel(m.exec.refMonth)} · QB ledger + day-net canon`;
    else if (tab === 'fixed' && m.fixed && m.fixed.qbMax) stamp = `QB ledger to ${monthLabel(m.fixed.qbMax)}`;
    else if (tab === 'cash' && m.cash && m.cash.bankMax) stamp = `bank truth to ${m.cash.bankMax}`;
    else stamp = 'QB ledger shadow + bank truth';
    return { stamp, body };
  },
};
