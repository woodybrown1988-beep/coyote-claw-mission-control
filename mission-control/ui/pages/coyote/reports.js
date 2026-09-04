'use strict';
// Reports — the REVENUE COMMAND CENTRE (RCC Stage 2, ruled 2026-07-21). ONE route (/coyote/reports),
// six subtabs (the five operator-mock RCC views plus the finance-entry workflow):
//   executive (P1 BUILT) · drivers (P2 BUILT) · menu (P5 BUILT) · reconciliation (P3 BUILT)
//   · forecast (P4 BUILT) · QuickBooks Sales Entry — ALL SIX LIVE.
// Contract unchanged: { key, route, title, sub, getSection, render }. SELECT-only via ctx.q.
// ONE HOME PER FACT (the absorb rule): the old projection panel + long-range + YoY headline are
// ABSORBED by the Forecast tab; the old channel-mix stack/QR hero by the Executive donut (the
// migration table survives as its expand); the decomposition table lives on Executive.
// P2 ABSORPTION (that build): the old drivers-tab flash panels left the page entirely —
//   • sales-by-hour bars → absorbed by the hourly heatmap + peak-hour KPI (their one home now);
//   • labour section + daypart labour-vs-sales + margin (prime cost) → LABOUR canon; home =
//     /coyote/labour (which already carries the scorecard/hero) — DELETED here, not copied there;
//   • ATV small-multiples → DELETED (ATV lives on the Executive strip; the per-channel monthly
//     detail was P2-mock-absent — ruled out of scope, not rehomed).
// P3 ABSORPTION (this build): the parked reconciliation panels left the pending list —
//   • the flash payments table (sales_by_payment, day grain) → REBUILT as the tender-to-bank
//     table on the per-receipt grain (sales_payments_api + the payment_methods_api dict) — its
//     one home now;
//   • the exceptions tile grid (discounts/voids/comps/refunds) → REBUILT as the gross-to-net
//     bridge + the refunds KPI (day grain — the wire never populates per-receipt discounts);
//   • the bank side = qb_bank_txns POSTED deposits (QB Phase-0 rule: "For Review" is not
//     exposed; match on POSTED). NO tender↔deposit matching algorithm exists yet — the bank
//     column renders the POSTED aggregate UNMATCHED; the match build is future work.
// P5 ABSORPTION (this build): the LAST pending tab (menu) is BUILT from the line ledger —
//   • the flash category-performance + best/slowest-sellers panels and the phase banner left
//     the page entirely; their ONE home is now the canonical product performance table + the
//     same-period decline watch (line grain, SKU-consolidated — sales_receipt_lines_api,
//     product truth from 2023-07, NOT the scraper sales_by_product aggregate);
//   • the period-nav machinery left reports WITH them (menu was its last user on this page;
//     /coyote/labour keeps its own strip — the module lives on there);
//   • contribution joins the sales SKU to a complete recipe cost. Incomplete recipes stay out of
//     the portfolio and classification, remain visible in the sales tables, and link to the live
//     recipes worklist. An empty recipe book renders plain-language empty states.
// NO-FABRICATION rules baked in:
//   • Executive KPI window = the LAST FULL Mon–Sun week vs the weekday-aligned week LY (−364d),
//     premises-guarded — a non-comparable LY drops the delta and says so, never a raw cross-site %.
//   • Covers are shown only when covers_day spans every positive-net trading date in the window;
//     POS guest-count is NOT covers (canon), and this page makes no claim about feed existence.
//   • Forecast (operator ruling): seasonality-aware headline (weighted per-month YoY ratio,
//     trailing ≤6 complete pairs, ×3/×2 recency) + simple YTD-YoY grey sanity + premises guard
//     (move 2023-04-01). Months without complete per-receipt coverage are GAPS, never estimates.
//     Re-forecast at every read; the ONLY stored input is the journaled management override.
//   • Every blocked panel is the designed empty-state naming blocker + unlock; no mock numbers.
const S = require('../../shared.js');
const REP = require('../../reporting.js');
const K = require('../../kpi.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
const MONTHS_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n) => String(n).padStart(2, '0');
function monthLabel(ym) { const m = String(ym || '').match(/^(\d{4})-(\d{2})$/); return m ? `${MONTHS_ABBR[Number(m[2])] || m[2]} ${m[1]}` : String(ym || ''); }

const TABS = [
  { key: 'executive', label: 'Executive' },
  { key: 'drivers', label: 'Revenue Drivers' },
  { key: 'menu', label: 'Menu Growth' },
  { key: 'reconciliation', label: 'Reconciliation' },
  { key: 'forecast', label: 'Revenue Forecast' },
  { key: 'qbsales', label: 'QuickBooks Sales Entry' },
];
const TAB_KEYS = TABS.map((t) => t.key);

// Sale filter — MIRRORS src/lightspeed-api/aggregate.ts isSale (the reconciled day-net basis):
// non-cancelled, type not VOID/CANCEL/RECALL; net = net_without_tax_pence (ex-VAT).
const SALE_WHERE = `r.cancelled = 0 AND (r.type IS NULL OR r.type NOT IN ('VOID','CANCEL','RECALL'))`;

// The covers-per-transaction sanity band. Named and exported so the tile can be JUDGED against it
// and a test can pin it — it was previously a phrase inside a caption, which no code could read.
const CPT_BAND = [1.9, 2.0];

// ---- SITTINGS CAPTURE GATE (2026-08-19, from a live wrong-number report) ----------------------
// The current sitting population has three observable grains: receipts clustered at a physical
// table, a closed "Order N" tab kept as one standalone sitting, and a STOREKIT channel slot sharing
// one raw table name for the business day. The panel derives both the population mix and capture from
// the current window's rows so its caption cannot deny a receipt used by its figure.
//
// The arithmetic was never wrong — a biased sample was being presented as a channel verdict. So the
// panel must STATE the capture rate and REFUSE the comparison when the sample cannot carry it.
// Thresholds are named here so a test can pin them, and the verdict is pure so it can go red.
const SITTING_MIN_CAPTURE = 0.50;   // a channel's per-sitting figure stands only if >= half its net is clusterable
const SITTING_MAX_SPREAD = 0.20;    // ...and the two compared channels are sampled within 20pp of each other

function sittingCaptureVerdict(cap) {
  const qr = cap && typeof cap.QR === 'number' ? cap.QR : null;
  const served = cap && typeof cap.served === 'number' ? cap.served : null;
  if (qr == null || served == null) return { ok: false, reason: 'capture rate unknown — cannot say how much of each channel these sittings represent' };
  const pct = (x) => `${Math.round(x * 100)}%`;
  const low = [];
  if (qr < SITTING_MIN_CAPTURE) low.push(`QR ${pct(qr)}`);
  if (served < SITTING_MIN_CAPTURE) low.push(`served ${pct(served)}`);
  const spread = Math.abs(qr - served);
  if (low.length) {
    return { ok: false, qr, served, spread,
      reason: `only ${low.join(' and ')} of that channel's net maps to a sitting (numbered table cluster, standalone Order N tab or QR channel slot) — too little of it is captured to read a per-party figure` };
  }
  if (spread > SITTING_MAX_SPREAD) {
    return { ok: false, qr, served, spread,
      reason: `the channels are captured at different rates (QR ${pct(qr)} vs served ${pct(served)}) — the comparison would measure table-assignment habit, not channel value` };
  }
  return { ok: true, qr, served, spread };
}

function rowValue(row, names) {
  for (const name of names) if (row && Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  return undefined;
}

function rowDate(row) {
  const value = rowValue(row, ['date', 'businessDate', 'business_date', 'd']);
  return value == null ? null : String(value);
}

function inRequestedWindow(date, window) {
  return !!date && (!window || !window.from || date >= window.from) && (!window || !window.to || date <= window.to);
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

// Pure caption seam: the SQL builder supplies current-window rows and this function makes every
// population/capture claim from those rows. An absent required field is different from a genuine
// zero/null value and is named rather than converted into a plausible percentage.
function deriveSittingCaptionState(sittingRows, receiptCaptureRows) {
  const sittings = Array.isArray(sittingRows) ? sittingRows : [];
  const receipts = Array.isArray(receiptCaptureRows) ? receiptCaptureRows : [];
  let tableClusters = 0; let standaloneOrders = 0; let channelSlots = 0; let unclassified = 0;
  const unknownBasisCounts = new Map();
  const populationMissing = new Set();
  const captureMissing = new Set();
  const capturedNet = { QR: 0, served: 0 };
  if (!sittings.length) captureMissing.add('current-window sitting rows');
  // Old fixture databases predate the basis column. Preserve their table-name classification as a
  // schema-compatibility seam; once a result set carries basis, every row must carry a valid value.
  const basisAware = sittings.some((row) => row && Object.prototype.hasOwnProperty.call(row, 'basis'));
  for (const row of sittings) {
    const tableName = rowValue(row, ['tableName', 'table_name', 'tbl']);
    const receiptCount = num(rowValue(row, ['receiptCount', 'receipt_count', 'rcpts']));
    const channelValue = rowValue(row, ['channel']);
    const netValue = rowValue(row, ['net', 'net_pence']);
    if (tableName === undefined) populationMissing.add('table_name');
    if (receiptCount == null) populationMissing.add('receipt_count');
    if (channelValue === undefined || channelValue === null || String(channelValue).trim() === '') captureMissing.add('channel on sitting rows');
    if (netValue === undefined || num(netValue) == null) captureMissing.add('net_pence on sitting rows');
    if (channelValue != null && num(netValue) != null) {
      const channel = String(channelValue);
      if (channel === 'QR' || channel === 'served') capturedNet[channel] += num(netValue);
    }
    const basisValue = rowValue(row, ['basis']);
    if (basisValue === undefined && !basisAware) {
      const name = tableName == null ? '' : String(tableName);
      if (/Table\s+\d/i.test(name)) tableClusters++;
      else if (/^Order\s+\d+$/i.test(name) && receiptCount === 1) standaloneOrders++;
      else unclassified++;
      continue;
    }
    if (basisValue === undefined || basisValue === null || String(basisValue).trim() === '') {
      populationMissing.add('basis');
      unclassified++;
      continue;
    }
    const basis = String(basisValue);
    if (basis === 'table-cluster') tableClusters++;
    else if (basis === 'order-tab') standaloneOrders++;
    else if (basis === 'channel-slot') channelSlots++;
    else unknownBasisCounts.set(basis, (unknownBasisCounts.get(basis) || 0) + 1);
  }
  const unknownBases = Object.fromEntries(unknownBasisCounts);
  const total = sittings.length;
  const pct = (value) => total > 0 ? `${((100 * value) / total).toFixed(1)}%` : '0.0%';
  const populationSupported = populationMissing.size === 0 && unclassified === 0;
  const knownGrains = [
    `basis "table-cluster": ${plural(tableClusters, 'clustered table-served receipt group', 'clustered table-served receipt groups')} (${pct(tableClusters)})`,
    `basis "order-tab": ${plural(standaloneOrders, 'standalone served Order N tab', 'standalone served Order N tabs')} (${pct(standaloneOrders)})`,
    `basis "channel-slot": ${plural(channelSlots, 'QR session slot', 'QR session slots')}—STOREKIT receipts sharing one (business_date, raw table_name), with the ruled session slot spanning the business day (${pct(channelSlots)})`,
  ];
  const unknownBasisCaption = Object.entries(unknownBases).map(([basis, count]) => (
    `${plural(count, 'sitting', 'sittings')} ${count === 1 ? 'carries' : 'carry'} basis "${basis}", which this page does not yet describe`
  )).join('; ');
  const captureGrains = knownGrains.concat(Object.entries(unknownBases).map(([basis, count]) => (
    `basis "${basis}": ${plural(count, 'sitting', 'sittings')} (not yet described)`
  )));
  const populationCaption = !total
    ? 'No sitting rows exist in the current window.'
    : (populationSupported
      ? `${plural(total, 'sitting', 'sittings')}: ${knownGrains.join(' + ')}.${unknownBasisCaption ? ` ${unknownBasisCaption}.` : ''}`
      : `Sitting population unavailable — missing ${[...populationMissing].join(', ') || 'a valid sitting basis classification'} on current-window sitting rows.`);

  if (!receipts.length) captureMissing.add('current-window receipt rows');
  const pool = {
    QR: { net: 0, sittingNet: basisAware ? capturedNet.QR : 0 },
    served: { net: 0, sittingNet: basisAware ? capturedNet.served : 0 },
  };
  const byLabel = {};
  for (const row of receipts) {
    const labelValue = rowValue(row, ['label', 'channelLabel', 'channel_label', 'lbl']);
    const netValue = rowValue(row, ['net', 'net_without_tax_pence']);
    const sittingNetValue = rowValue(row, ['sittingNet', 'sitting_net', 'cnet']);
    if (labelValue === undefined || labelValue === null) captureMissing.add('channel_label');
    if (netValue === undefined || num(netValue) == null) captureMissing.add('net_without_tax_pence');
    if (!basisAware && (sittingNetValue === undefined || num(sittingNetValue) == null)) captureMissing.add('sittingNet');
    if (labelValue === undefined || labelValue === null || netValue === undefined || num(netValue) == null) continue;
    const label = String(labelValue);
    const net = num(netValue) || 0;
    const group = label === QR_LABEL ? 'QR' : 'served';
    pool[group].net += net;
    if (!basisAware && num(sittingNetValue) != null) pool[group].sittingNet += num(sittingNetValue);
    if (!unknownBasisCounts.size && net > 0 && num(sittingNetValue) != null) byLabel[label] = num(sittingNetValue) / net;
  }
  const capture = { supported: captureMissing.size === 0, byLabel };
  if (capture.supported) {
    for (const group of ['QR', 'served']) if (pool[group].net > 0) capture[group] = pool[group].sittingNet / pool[group].net;
    if (capture.QR == null) captureMissing.add('QR channel net');
    if (capture.served == null) captureMissing.add('served channel net');
    capture.supported = captureMissing.size === 0;
  }
  const labelCapture = Object.entries(byLabel).map(([label, value]) => `${label} ${(100 * value).toFixed(1)}%`).join(' · ');
  const captureCaption = capture.supported
    ? `Capture by the same population (${captureGrains.join(' + ')}): QR ${(100 * capture.QR).toFixed(1)}% · served ${(100 * capture.served).toFixed(1)}% of current-window channel net${labelCapture ? ` (${labelCapture})` : ''}.`
    : `Capture unavailable — missing ${[...captureMissing].join(', ')}; no capture percentage is shown.`;
  return {
    population: { total, tableClusters, standaloneOrders, channelSlots, unknownBases, unclassified, supported: populationSupported },
    capture,
    populationCaption,
    captureCaption,
  };
}

function eligibleSalesDates(salesRows, window) {
  const dates = new Map();
  for (const row of (Array.isArray(salesRows) ? salesRows : [])) {
    const date = rowDate(row);
    const net = num(rowValue(row, ['net', 'netSales', 'net_sales_pence']));
    if (inRequestedWindow(date, window) && net != null && net > 0) dates.set(date, net);
  }
  return dates;
}

function coverageRequirement(dates) { return dates.join(', '); }

// A covers row is expected only for a positive-net trading date. Zero-net ingest rows describe a
// legitimate closure and must not turn a complete covers window into a false PARTIAL state.
function deriveCoversCaptionState(salesRows, coversRows, window) {
  const eligible = eligibleSalesDates(salesRows, window);
  const covered = new Map();
  for (const row of (Array.isArray(coversRows) ? coversRows : [])) {
    const date = rowDate(row);
    const total = num(rowValue(row, ['totalCovers', 'total_covers', 'covers']));
    if (inRequestedWindow(date, window) && eligible.has(date) && total != null) covered.set(date, total);
  }
  const eligibleDates = [...eligible.keys()].sort();
  const coveredDates = [...covered.keys()].sort();
  const missingDates = eligibleDates.filter((date) => !covered.has(date));
  const base = {
    eligibleDates, coveredDates, missingDates,
    have: coveredDates.length, need: eligibleDates.length,
    totalCovers: coveredDates.length ? [...covered.values()].reduce((sum, value) => sum + value, 0) : null,
  };
  if (!eligibleDates.length) {
    return { ...base, kind: 'not-applicable', caption: `No cover-applicable trading dates exist in ${window.from} → ${window.to}; closed/non-cover-applicable day rows do not require covers.` };
  }
  if (!missingDates.length) {
    return { ...base, kind: 'complete', caption: `Covers span all ${eligibleDates.length} eligible trading dates (${eligibleDates[0]} → ${eligibleDates[eligibleDates.length - 1]}).` };
  }
  const required = coverageRequirement(missingDates);
  if (!coveredDates.length) {
    return { ...base, kind: 'empty', caption: `No covers exist in this applicable window. Add covers_day coverage for ${required} to clear the gate.` };
  }
  return { ...base, kind: 'partial', caption: `PARTIAL — covers exist for ${coveredDates.length} of ${eligibleDates.length} eligible trading dates; missing ${required}. Add covers_day coverage for those dates to clear the gate.` };
}

// Reconciliation is allowed to use a narrower intersection because both £ sides are summed from
// the exact same verified dates. A covers_day row joins that intersection only when the revenue
// fields required by this particular cross-check are present.
function deriveReconciliationCaptionState(salesRows, coversRows, window) {
  const eligible = eligibleSalesDates(salesRows, window);
  const validCovers = new Map();
  for (const row of (Array.isArray(coversRows) ? coversRows : [])) {
    const date = rowDate(row);
    const revenueCovers = num(rowValue(row, ['revenueCovers', 'revenue_covers']));
    const revenueNet = num(rowValue(row, ['revenueNet', 'revenue_net_pence', 'ot_net']));
    if (inRequestedWindow(date, window) && eligible.has(date) && revenueCovers > 0 && revenueNet != null) validCovers.set(date, row);
  }
  const eligibleDates = [...eligible.keys()].sort();
  const dates = [...validCovers.keys()].sort();
  const missingDates = eligibleDates.filter((date) => !validCovers.has(date));
  if (!dates.length) {
    const requirement = missingDates.length
      ? `Add covers_day revenue_covers and revenue_net_pence for ${coverageRequirement(missingDates)} to clear the gate.`
      : `Select a requested window containing a positive-net trading date with covers_day revenue coverage to clear the gate.`;
    return {
      withheld: true, dates, missingDates, dateLabel: null,
      lightspeedNet: null, openTableNet: null, openTableGross: null,
      revenueCovers: null, seatedCovers: null,
      caption: `Cross-check withheld — no valid requested × eligible trading date × covers_day revenue intersection exists. ${requirement}`,
    };
  }
  let lightspeedNet = 0; let openTableNet = 0; let openTableGross = 0;
  let revenueCovers = 0; let seatedCovers = 0;
  for (const date of dates) {
    const row = validCovers.get(date);
    lightspeedNet += eligible.get(date) || 0;
    openTableNet += num(rowValue(row, ['revenueNet', 'revenue_net_pence', 'ot_net'])) || 0;
    openTableGross += num(rowValue(row, ['revenueGross', 'revenue_gross_pence', 'ot_gross'])) || 0;
    revenueCovers += num(rowValue(row, ['revenueCovers', 'revenue_covers', 'covers'])) || 0;
    seatedCovers += num(rowValue(row, ['seatedCovers', 'seated_covers', 'seated'])) || 0;
  }
  const contiguous = dates.every((date, index) => index === 0 || K.shiftDays(dates[index - 1], 1) === date);
  const span = dates.length === 1 ? dates[0] : (contiguous ? `${dates[0]} → ${dates[dates.length - 1]}` : dates.join(', '));
  const dateLabel = `${span} · ${dates.length} verified ${dates.length === 1 ? 'date' : 'dates'}`;
  const gap = missingDates.length ? ` Missing covers-day revenue coverage: ${coverageRequirement(missingDates)}.` : '';
  return {
    withheld: false, dates, missingDates, dateLabel,
    lightspeedNet, openTableNet, openTableGross, revenueCovers, seatedCovers,
    caption: `${dateLabel}; computed only on the requested × eligible trading dates × covers_day revenue intersection.${gap}`,
  };
}

const QR_LABEL = 'STOREKIT ORDER & PAY';
// The £38/order QR target is RETIRED (operator ruling 2026-07-31): a QR sitting places several
// orders, so per-order ATV structurally understates QR spend. The decision feed renders spend
// per SITTING; per-cover is the honest comparison once the OpenTable covers feed is regular.
// Evidence + sitting-key derivation: docs/qr-sitting-basis-2026-07-31.md.
const API_ERA_NOTE = 'window inside API-era coverage (from 2026-06-30)';

// Drivers scorecard STATUS ruler — the RULED rota-review verdict classes, never invented:
// daily formula budget = salaried_cost_pence + 22.4% × net (the ruled variable splits, K 14.3%
// + F 8.1% combined); TRUE labour = actual_cost_pence (burdened); OVER only beyond the ruled
// £45 materiality.
const LABOUR_VAR_RATE = 0.224;
const LABOUR_MATERIALITY_PENCE = 4500;
// Drivers attachment classes — the DICT decides (acct_groups_api), never a product name-guess:
// DRINK = the four ruled class names; SIDE = the pure FRYER-station family (FRYER but neither
// GRIDDLE nor BUN — the griddle/bun hybrids are mains, not sides).
const DRINK_CLASS_NAMES = ['HOT DRINKS', 'SOFT DRINKS', 'ALCOHOL', 'SHAKES'];

// Menu movers / decline-watch thresholds — PRESENTATION CUTS (captioned as such), not rulings.
const MOVER_PCT = 0.25; // |Δ 28d net| ≥ 25% of the prior window …
const MOVER_FLOOR_PENCE = 10000; // … AND ≥ £100
const DECLINE_FLOOR_PENCE = 5000; // decline watch: net decline ≥ £50

// RCC donut palette in the mock's order: accent → blue → accent2 → purple → greys.
const DONUT_COLORS = ['#e44b36', '#67a7ff', '#ffb34d', '#ad8cff', '#56616e', '#7d8da5'];

// QuickBooks sales-entry rules. STOREKIT card takings arrive as STR; LivePepper is deliberately
// separate on LP (row 8), so it is not in this closed row-2 allowlist.
// Card tenders by PROCESSOR (operator rulings 2026-09-04): both "POS error" buttons are the Adyen
// standalone reader and belong to Lightspeed Payments; STR is Storekit. VISA and MC are the retired
// manual house-card tenders and are NEVER a processor (their 2026 use is gift-card loads keyed on the
// wrong button) — the residual they leave is reported, not absorbed.
const QB_LIGHTSPEED_CODES = new Set(['LSPAY_ADYEN_TERMINAL_API_LOCAL', 'POSERROR', 'POS ERROR - PAID ON DOJO']);
const QB_STOREKIT_CODES = new Set(['STR']);
const QB_ONLINE_CODES = new Set(['LP']);
const QB_NEVER_CARD_CODES = new Set(['VISA', 'MC']);
const QB_CARD_CODES = new Set([...QB_LIGHTSPEED_CODES, ...QB_STOREKIT_CODES]);
const QB_IN_HOUSE_CHANNELS = new Set(['EAT IN', 'STOREKIT ORDER & PAY', 'MON-FRI DEAL']);
// The till-basis comparison admits walk-in takeaway too (it is POS trade, not LivePepper).
const QB_TILL_COMPARISON_CHANNELS = new Set([...QB_IN_HOUSE_CHANNELS, 'TAKE-AWAY']);
// Lightspeed's own daily Total = SALE + SPLIT + VOID + RECALL + TRANSITORY; the reversal types carry
// real money movements (voids, re-rings, day-close ghosts) and belong on the sales side of a till figure.
const QB_TILL_SALES_TYPES = new Set(['SALE', 'SPLIT', 'VOID', 'RECALL', 'TRANSITORY']);
const QB_GIFT_REDEEM_TYPES = new Set(['SALE', 'SPLIT', 'RECALL']);
const QB_OPERATOR_INPUTS = ['pos_fee', 'online_fee', 'online_refunds'];
const QB_FEE_PLAUSIBILITY_THRESHOLD = 0.10;

function latestCompleteMonth(now) {
  const date = new Date(now == null ? Date.now() : now);
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  return new Date(Date.UTC(valid.getUTCFullYear(), valid.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}
function calendarMonthWindow(month) {
  const match = String(month || '').match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return null;
  const y = Number(match[1]); const m = Number(match[2]);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates = [];
  for (let day = 1; day <= days; day++) dates.push(`${match[1]}-${match[2]}-${pad2(day)}`);
  return { month: `${match[1]}-${match[2]}`, from: dates[0], to: dates[dates.length - 1], dates,
    fromMs: Date.UTC(y, m - 1, 1), toMs: Date.UTC(y, m, 1) };
}
function qbPence(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : 0;
}
function formatQuickBooksFeeDerivation({ grossPence, feePence, grossLabel, feeLabel }) {
  const hasFee = Number.isSafeInteger(feePence);
  const resultPence = grossPence + (hasFee ? feePence : 0);
  let explanation;
  if (!hasFee) explanation = `gross ${grossLabel} takings ${grossPence} pence — no processor fee entered for this month`;
  else if (feePence < 0) explanation = `gross ${grossLabel} takings ${grossPence} pence + signed ${feeLabel} processor fee ${feePence} pence (deducted) = net ${resultPence} pence`;
  else if (feePence > 0) explanation = `gross ${grossLabel} takings ${grossPence} pence + signed ${feeLabel} processor fee +${feePence} pence (added) = ${resultPence} pence`;
  else explanation = `gross ${grossLabel} takings ${grossPence} pence + signed ${feeLabel} processor fee 0 pence = unchanged at ${grossPence} pence`;
  let warning = null;
  if (hasFee && feePence !== 0) {
    if (grossPence <= 0) warning = `Suspicious ${feeLabel} processor fee: ${feePence} pence with gross takings ${grossPence} pence; no meaningful percentage exists when gross is zero or negative.`;
    else {
      const ratio = Math.abs(feePence) / grossPence;
      if (ratio > QB_FEE_PLAUSIBILITY_THRESHOLD) warning = `Suspicious ${feeLabel} processor fee: ${feePence} pence is ${(ratio * 100).toFixed(1)}% of positive gross takings, exceeding the named ${Math.round(QB_FEE_PLAUSIBILITY_THRESHOLD * 100)}% plausibility threshold.`;
    }
  }
  return { resultPence, explanation, warning };
}
function uniqueApiRows(rows, keyOf) {
  const seen = new Set(); const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = keyOf(row);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(row);
  }
  return out;
}

/** The QuickBooks monthly Daily Sales receipt on the SETTLEMENT BASIS (operator ruling 2026-09-04:
 *  "we shouldn't have overspills changing the sales values — do it the way our Power BI is worked").
 *
 *  Each processor is a block that nets to zero: Sales = card gross − tips; Card = −(gross − fee);
 *  Tips = +tips; Fee = −fee. Cash takings are a block of their own. Gift cards are the liability
 *  account: cards SOLD (+) and REDEEMED (−), so row 1 also takes + redeemed − sold. Over/Short is
 *  therefore 0.00 BY CONSTRUCTION and says so; it is not a residual and nothing is balanced through it.
 *
 *  SOURCES, declared on every row: processor settlement rows for the month when they exist
 *  (processor_settlement_rows — gross, fee, refunds per processor), otherwise the TILL as a
 *  labelled proxy (tender totals by processor code). Tips are always the till's. Fees and online
 *  refunds are operator inputs unless settlement supplies them; an operator-entered value wins and
 *  the derivation says so. The till's own sales figure survives only as a diagnostic comparison
 *  below the receipt and feeds no row. */
function calculateQuickBooksSales(input) {
  const source = input || {};
  const window = calendarMonthWindow(source.month);
  if (!window) return null;
  const receiptRows = uniqueApiRows(source.receipts, (row) => String(row.receipt_id || row.receiptId || ''))
    .filter((row) => inRequestedWindow(rowDate(row), window));
  const typeOf = (row) => String(row.type || '').trim().toUpperCase();
  const channelOf = (row) => String(row.channel_label || row.channelLabel || '').trim().toUpperCase();
  const receiptGross = (row) => qbPence(rowValue(row, ['net_with_tax_pence', 'netWithTaxPence', 'gross_pence']));
  const notCancelled = (row) => !qbPence(row.cancelled);
  const receiptById = new Map(receiptRows.map((row) => [String(row.receipt_id || row.receiptId), row]));
  const eligibleReceipts = receiptRows.filter((row) => notCancelled(row) && (typeOf(row) === 'SALE' || typeOf(row) === 'SPLIT'));
  const unmappedReceipts = eligibleReceipts.filter((row) => !channelOf(row));
  const onlineReceiptIds = new Set(eligibleReceipts.filter((row) => channelOf(row) === 'ONLINE ORDER')
    .map((row) => String(row.receipt_id || row.receiptId)));

  // ---- online 0% (milkshakes): unchanged receipt-item rule, restricted to online-order receipts ----
  const lineRows = uniqueApiRows(source.lines, (row) => {
    const receiptId = String(row.receipt_id || row.receiptId || '');
    const lineId = String(row.line_id || row.lineId || '');
    return receiptId && lineId ? `${receiptId}|${lineId}` : '';
  }).filter((row) => inRequestedWindow(rowDate(row), window));
  const accountingGroupNames = new Map((Array.isArray(source.accountingGroups) ? source.accountingGroups : [])
    .map((group) => [String(group.code), String(group.name || '').trim().toUpperCase()]));
  const groupNameOf = (line) => {
    const direct = rowValue(line, ['accounting_group_name', 'accountingGroupName']);
    if (direct != null && String(direct).trim()) return String(direct).trim().toUpperCase();
    const raw = rowValue(line, ['accounting_group', 'accountingGroup']);
    return accountingGroupNames.get(String(raw)) || String(raw || '').trim().toUpperCase();
  };
  const onlineLines = lineRows.filter((line) => onlineReceiptIds.has(String(line.receipt_id || line.receiptId)));
  const shakeRootKeys = new Set(onlineLines.filter((line) => groupNameOf(line) === 'SHAKES').map((line) => (
    `${String(line.receipt_id || line.receiptId)}|${String(line.line_id || line.lineId)}`
  )));
  const shakeLines = onlineLines.filter((line) => {
    const receiptId = String(line.receipt_id || line.receiptId);
    const lineId = String(line.line_id || line.lineId);
    const parentId = String(line.parent_line_id || line.parentLineId || '');
    return shakeRootKeys.has(`${receiptId}|${lineId}`) || (parentId && shakeRootKeys.has(`${receiptId}|${parentId}`));
  });
  const lineGross = (line) => qbPence(rowValue(line, ['net_with_tax_pence', 'netWithTaxPence', 'gross_pence']));
  const shakePence = shakeLines.reduce((sum, line) => sum + lineGross(line), 0);

  // ---- tenders (the till) ----
  const paymentRows = uniqueApiRows(source.payments, (row) => {
    const paymentId = rowValue(row, ['payment_id', 'paymentId']);
    if (paymentId != null && String(paymentId)) return String(paymentId);
    const receiptId = String(row.receipt_id || row.receiptId || '');
    const sequence = rowValue(row, ['payment_seq', 'paymentSeq']);
    return receiptId && sequence != null ? `${receiptId}|${String(sequence)}` : '';
  }).filter((row) => inRequestedWindow(rowDate(row), window));
  const paymentCode = (row) => String(row.code || '').trim().toUpperCase();
  const payNet = (row) => qbPence(rowValue(row, ['net_with_tax_pence', 'netWithTaxPence']));
  const payTip = (row) => qbPence(rowValue(row, ['tip_pence', 'tipPence']));
  const sumBy = (rows, f) => rows.reduce((sum, row) => sum + f(row), 0);
  const tillBlock = (codes) => {
    const rows = paymentRows.filter((row) => codes.has(paymentCode(row)));
    return { rows, grossPence: sumBy(rows, (row) => payNet(row) + payTip(row)), tipPence: sumBy(rows, payTip) };
  };
  const tillLightspeed = tillBlock(QB_LIGHTSPEED_CODES);
  const tillStorekit = tillBlock(QB_STOREKIT_CODES);
  const tillOnline = tillBlock(QB_ONLINE_CODES);
  const cashRows = paymentRows.filter((row) => paymentCode(row) === 'CASH');
  const cashPence = sumBy(cashRows, payNet);                 // tip_pence EXCLUDED — cash tips are not the business's
  const cashTipPence = sumBy(cashRows, payTip);
  const neverCardRows = paymentRows.filter((row) => QB_NEVER_CARD_CODES.has(paymentCode(row)));
  const neverCardPence = sumBy(neverCardRows, (row) => payNet(row) + payTip(row));

  // ---- gift cards: the liability account, both sides from the IKGIFT tender ----
  const giftRows = paymentRows.filter((row) => paymentCode(row) === 'IKGIFT');
  const giftSoldRows = giftRows.filter((row) => payNet(row) < 0 && typeOf(receiptById.get(String(row.receipt_id || row.receiptId)) || {}) === 'TRANSFER');
  const giftRedeemedRows = giftRows.filter((row) => {
    const receipt = receiptById.get(String(row.receipt_id || row.receiptId));
    return payNet(row) > 0 && receipt && notCancelled(receipt) && QB_GIFT_REDEEM_TYPES.has(typeOf(receipt));
  });
  const giftSoldPence = -sumBy(giftSoldRows, payNet);
  const giftRedeemedPence = sumBy(giftRedeemedRows, payNet);

  // ---- settlement rows override the till proxy for gross / fee / refunds (never tips) ----
  const settlementRows = Array.isArray(source.settlement) ? source.settlement : [];
  const settlementFor = (name) => settlementRows.find((row) => String(row.processor || '').toLowerCase() === name) || null;
  const stLightspeed = settlementFor('lightspeed');
  const stStorekit = settlementFor('storekit');
  const stOnline = settlementFor('livepepper');
  const grossOf = (st, till) => (st && Number.isSafeInteger(st.grossPence) ? { pence: st.grossPence, source: 'settlement' } : { pence: till.grossPence, source: 'till proxy' });
  const lightspeedGross = grossOf(stLightspeed, tillLightspeed);
  const storekitGross = grossOf(stStorekit, tillStorekit);
  const onlineGross = grossOf(stOnline, tillOnline);
  const cardGrossPence = lightspeedGross.pence + storekitGross.pence;
  const cardTipPence = tillLightspeed.tipPence + tillStorekit.tipPence;
  const cardSource = lightspeedGross.source === 'settlement' && storekitGross.source === 'settlement' ? 'settlement'
    : (lightspeedGross.source === 'settlement' || storekitGross.source === 'settlement' ? 'mixed (settlement + till proxy)' : 'till proxy');

  // ---- operator inputs (qb_sales_fees, all ≤ 0). Operator-entered beats settlement, and says so. ----
  const feeSource = source.fees && typeof source.fees === 'object' ? source.fees : {};
  const entered = (key) => Object.prototype.hasOwnProperty.call(feeSource, key) && Number.isSafeInteger(feeSource[key]);
  const resolveInput = (key, settlementValue, label) => {
    if (entered(key)) {
      const note = Number.isSafeInteger(settlementValue)
        ? `operator-entered ${label} ${feeSource[key]} pence used; settlement carried ${settlementValue} pence — operator entry wins by precedence`
        : `operator-entered ${label} ${feeSource[key]} pence`;
      return { pence: feeSource[key], present: true, source: 'operator input', note };
    }
    if (Number.isSafeInteger(settlementValue)) return { pence: settlementValue, present: true, source: 'settlement', note: `${label} ${settlementValue} pence from settlement rows` };
    return { pence: null, present: false, source: 'missing', note: `no ${label} entered for this month and no settlement rows` };
  };
  const settlementFee = (rows) => rows.filter(Boolean).every((row) => Number.isSafeInteger(row.feePence)) && rows.filter(Boolean).length
    ? rows.filter(Boolean).reduce((sum, row) => sum + row.feePence, 0) : null;
  const posFee = resolveInput('pos_fee', (stLightspeed && stStorekit) ? settlementFee([stLightspeed, stStorekit]) : null, 'POS fee');
  const onlineFee = resolveInput('online_fee', stOnline ? settlementFee([stOnline]) : null, 'online fee');
  const onlineRefunds = resolveInput('online_refunds', stOnline && Number.isSafeInteger(stOnline.refundPence) ? stOnline.refundPence : null, 'online refunds');

  // ---- the processor blocks ----
  const lightspeedSalesPence = lightspeedGross.pence - tillLightspeed.tipPence;
  const storekitSalesPence = storekitGross.pence - tillStorekit.tipPence;
  const onlineNetSalesPence = onlineGross.pence + (onlineRefunds.present ? onlineRefunds.pence : 0);
  const cardNetPence = cardGrossPence + (posFee.present ? posFee.pence : 0);
  const onlineNetPayoutPence = onlineNetSalesPence + (onlineFee.present ? onlineFee.pence : 0);
  const inHouseSalesPence = lightspeedSalesPence + storekitSalesPence + cashPence + giftRedeemedPence - giftSoldPence;
  const posFeeDerivation = formatQuickBooksFeeDerivation({ grossPence: cardGrossPence, feePence: posFee.present ? posFee.pence : null, grossLabel: 'card', feeLabel: 'POS' });
  const onlineFeeDerivation = formatQuickBooksFeeDerivation({ grossPence: onlineNetSalesPence, feePence: onlineFee.present ? onlineFee.pence : null, grossLabel: 'online (net of refunds)', feeLabel: 'online' });
  const sourceWindow = `${window.from} → ${window.to} inclusive`;
  const proxyNote = (s) => (s === 'till proxy' ? ' [TILL PROXY — settlement export not yet loaded for this month]' : ` [${s}]`);
  const refundsNote = onlineRefunds.present ? `${onlineRefunds.note}` : 'online refunds UNKNOWN — none entered and no settlement rows; online figures are gross until they are';

  const rows = [
    {
      line: 1, key: 'in_house_sales', label: 'Sales income (in-house)', amountPence: inHouseSalesPence, entered: true,
      vatTreatment: '20% VAT', includedCount: tillLightspeed.rows.length + tillStorekit.rows.length + cashRows.length + giftSoldRows.length + giftRedeemedRows.length,
      derivation: `Settlement basis: Lightspeed Payments (gross ${lightspeedGross.pence} − tips ${tillLightspeed.tipPence} = ${lightspeedSalesPence})${proxyNote(lightspeedGross.source)} + Storekit (gross ${storekitGross.pence} − tips ${tillStorekit.tipPence} = ${storekitSalesPence})${proxyNote(storekitGross.source)} + cash takings ${cashPence} + gift cards redeemed ${giftRedeemedPence} − gift cards sold ${giftSoldPence} = ${inHouseSalesPence} pence. Tips are always the till's. VISA/MC are never a processor (this month: ${neverCardRows.length} payment(s), ${neverCardPence} pence, left outside the receipt).`,
      sourceGrain: `${cardSource} · sales_payments_api tenders by processor code`, window: sourceWindow,
    },
    {
      line: 2, key: 'card_payments', label: 'Card payments', amountPence: -cardNetPence, entered: true,
      vatTreatment: 'No VAT · settlement', includedCount: tillLightspeed.rows.length + tillStorekit.rows.length,
      derivation: `Lightspeed Payments ${lightspeedGross.pence} (codes ${[...QB_LIGHTSPEED_CODES].join(', ')})${proxyNote(lightspeedGross.source)} + Storekit ${storekitGross.pence} (STR)${proxyNote(storekitGross.source)} = gross ${cardGrossPence}; ${posFeeDerivation.explanation}; ${posFee.note}.`,
      feeWarning: posFeeDerivation.warning,
      sourceGrain: `${cardSource} · net_with_tax_pence + tip_pence`, window: sourceWindow,
    },
    {
      line: 3, key: 'tips_payable', label: 'Tips payable', amountPence: cardTipPence, entered: true,
      vatTreatment: 'Outside scope', includedCount: tillLightspeed.rows.length + tillStorekit.rows.length,
      derivation: `Card processors only: Lightspeed Payments tips ${tillLightspeed.tipPence} + Storekit tips ${tillStorekit.tipPence} = ${cardTipPence} pence (till tip_pence). Cash tips (${cashTipPence} pence this month) are not the business's money and enter no row.`,
      sourceGrain: 'till · sales_payments_api tip_pence', window: sourceWindow,
    },
    {
      line: 4, key: 'cash_payments', label: 'Cash payments', amountPence: -cashPence, entered: true,
      vatTreatment: 'No VAT · settlement', includedCount: cashRows.length,
      derivation: `${cashRows.length} payment(s) where code=CASH; negative SUM(net_with_tax_pence) = ${cashPence} pence; tip_pence (${cashTipPence}) excluded by operator ruling 2026-09-04.`,
      sourceGrain: 'till · sales_payments_api', window: sourceWindow,
    },
    {
      line: 5, key: 'pos_fee', label: 'POS card fees', amountPence: posFee.present ? posFee.pence : null, entered: posFee.present,
      vatTreatment: 'No VAT · fee', includedCount: posFee.present ? 1 : 0,
      derivation: `${posFee.note}; Lightspeed + Storekit combined, signed ≤ 0.`,
      sourceGrain: `${posFee.source} · qb_sales_fees pos_fee`, window: sourceWindow,
    },
    {
      line: 6, key: 'online_twenty_sales', label: 'Online 20% sales', amountPence: onlineNetSalesPence - shakePence, entered: true,
      vatTreatment: '20% VAT', includedCount: tillOnline.rows.length,
      derivation: `Online gross ${onlineGross.pence}${proxyNote(onlineGross.source)} ${onlineRefunds.present ? `+ refunds ${onlineRefunds.pence}` : '(refunds not applied)'} = net online sales ${onlineNetSalesPence}, less row 7 (${shakePence}) = ${onlineNetSalesPence - shakePence} pence. ${refundsNote}.`,
      sourceGrain: `${onlineGross.source} · LP tender; refunds ${onlineRefunds.source}`, window: sourceWindow,
    },
    {
      line: 7, key: 'online_zero_sales', label: 'Online zero-rated sales', amountPence: shakePence, entered: true,
      vatTreatment: 'Zero-rated VAT', includedCount: shakeLines.length,
      derivation: `${shakeLines.length} of ${onlineLines.length} online line(s): SHAKES accounting-group roots plus lines whose parent_line_id directly references a shake line; receipt_id + line_id deduplicated.`,
      sourceGrain: 'receipt items · sales_receipt_lines_api + acct_groups_api', window: sourceWindow,
    },
    {
      line: 8, key: 'online_card_payments', label: 'Online card payments', amountPence: -onlineNetPayoutPence, entered: true,
      vatTreatment: 'No VAT · settlement', includedCount: tillOnline.rows.length,
      derivation: `${onlineFeeDerivation.explanation}; ${onlineFee.note}. ${refundsNote}.`,
      feeWarning: onlineFeeDerivation.warning,
      sourceGrain: `${onlineGross.source} · LP tender; fee ${onlineFee.source}`, window: sourceWindow,
    },
    {
      line: 9, key: 'online_fee', label: 'Online card fees', amountPence: onlineFee.present ? onlineFee.pence : null, entered: onlineFee.present,
      vatTreatment: 'No VAT · fee', includedCount: onlineFee.present ? 1 : 0,
      derivation: `${onlineFee.note}; signed ≤ 0.`,
      sourceGrain: `${onlineFee.source} · qb_sales_fees online_fee`, window: sourceWindow,
    },
    {
      line: 10, key: 'gift_sold', label: 'Gift cards sold (liability +)', amountPence: giftSoldPence, entered: true,
      vatTreatment: 'Outside scope · liability', includedCount: giftSoldRows.length,
      derivation: `${giftSoldRows.length} card load(s): IKGIFT negative on TRANSFER receipts, any paying tender including the free-voucher codes; magnitude ${giftSoldPence} pence credits Gift Card Liability.`,
      sourceGrain: 'till · sales_payments_api IKGIFT on TRANSFER', window: sourceWindow,
    },
    {
      line: 11, key: 'gift_redeemed', label: 'Gift card redemptions (liability −)', amountPence: -giftRedeemedPence, entered: true,
      vatTreatment: 'Outside scope · liability', includedCount: giftRedeemedRows.length,
      derivation: `${giftRedeemedRows.length} redemption(s): IKGIFT positive on non-cancelled SALE/SPLIT/RECALL receipts; ${giftRedeemedPence} pence debits Gift Card Liability. The meals themselves are in row 1 via + redeemed.`,
      sourceGrain: 'till · sales_payments_api IKGIFT on sales', window: sourceWindow,
    },
  ];
  const balanceOfRows = (list) => list.reduce((sum, row) => sum + (row.amountPence == null ? 0 : row.amountPence), 0);
  const subtotalPence = balanceOfRows(rows);
  rows.push({
    line: 12, key: 'over_short', label: 'Over/Short', amountPence: 0, entered: true,
    vatTreatment: 'No VAT · by construction', includedCount: 0,
    derivation: `0.00 by construction: each processor block nets to zero (Sales = gross − tips; Card = −(gross − fee); Tips = +tips; Fee = −fee), cash and gift cards are their own blocks. Rows 1–11 sum to ${subtotalPence} pence. Nothing is balanced through this row; the till comparison below is where differences show.`,
    sourceGrain: 'derived · rows 1–11', window: sourceWindow,
  });
  const balancePence = balanceOfRows(rows);

  // ---- the till, kept visible and OUT of the numbers ----
  const tillReceipts = receiptRows.filter((row) => notCancelled(row) && QB_TILL_SALES_TYPES.has(typeOf(row)) && QB_TILL_COMPARISON_CHANNELS.has(channelOf(row)));
  const tillSalesPence = tillReceipts.reduce((sum, row) => sum + receiptGross(row), 0);
  const tillComparison = {
    tillSalesPence, settlementSalesPence: inHouseSalesPence, differencePence: tillSalesPence - inHouseSalesPence,
    receipts: tillReceipts.length,
    caption: `Till in-house sales (Lightspeed basis: SALE+SPLIT+VOID+RECALL+TRANSITORY, in-house channels incl. Take-Away) ${tillSalesPence} pence; settlement-basis row 1 ${inHouseSalesPence} pence; difference ${tillSalesPence - inHouseSalesPence} pence. Diagnostic only — feeds no row.`,
  };

  const seenSalesDates = new Set((Array.isArray(source.salesDates) ? source.salesDates : []).map((row) => (
    typeof row === 'string' ? row : rowDate(row)
  )).filter((date) => inRequestedWindow(date, window)));
  const missingDates = window.dates.filter((date) => !seenSalesDates.has(date));
  const vatGrossPence = rows[0].amountPence + rows[5].amountPence;
  const vatBaseExact = vatGrossPence % 6 === 0;
  const vatBasePence = Math.round((vatGrossPence * 5) / 6);
  const unmapped = { count: unmappedReceipts.length, valuePence: unmappedReceipts.reduce((sum, row) => sum + receiptGross(row), 0) };
  const feeMissing = [!posFee.present ? 'POS card fees' : null, !onlineFee.present ? 'Online card fees' : null, !onlineRefunds.present ? 'Online refunds' : null].filter(Boolean);
  const sources = { card: cardSource, online: onlineGross.source, posFee: posFee.source, onlineFee: onlineFee.source, onlineRefunds: onlineRefunds.source };
  const sourceCaption = cardSource === 'settlement' && onlineGross.source === 'settlement'
    ? 'Card and online figures from processor settlement rows for this month.'
    : `Card gross ${cardSource === 'till proxy' ? 'from till tenders — settlement export not yet loaded' : cardSource}; online ${onlineGross.source === 'till proxy' ? 'from the LP tender — settlement export not yet loaded' : onlineGross.source}${onlineRefunds.present ? '' : '; online refunds unknown'}.`;
  return {
    month: window.month, from: window.from, to: window.to, rows, subtotalPence, balancePence,
    missingDates, unmapped, vatGrossPence, vatBasePence, vatBaseExact, feeMissing, sources, sourceCaption, tillComparison,
    blocks: {
      lightspeed: { grossPence: lightspeedGross.pence, tipPence: tillLightspeed.tipPence, salesPence: lightspeedSalesPence, source: lightspeedGross.source },
      storekit: { grossPence: storekitGross.pence, tipPence: tillStorekit.tipPence, salesPence: storekitSalesPence, source: storekitGross.source },
      online: { grossPence: onlineGross.pence, refundsPence: onlineRefunds.present ? onlineRefunds.pence : null, netSalesPence: onlineNetSalesPence, source: onlineGross.source },
      cash: { pence: cashPence, tipPence: cashTipPence }, gift: { soldPence: giftSoldPence, redeemedPence: giftRedeemedPence },
      neverCard: { count: neverCardRows.length, pence: neverCardPence },
    },
    complete: missingDates.length === 0 && posFee.present && onlineFee.present && onlineRefunds.present && vatBaseExact,
  };
}

// London wall-clock hour of an epoch instant (daypart ruling cuts on LOCAL hour; the per-UTC-hour
// bucket midpoint is offset-constant, so bucket-level conversion is exact incl. DST switch days).
const LONDON_HOUR_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' });
function londonHourOf(ms) { return Number(LONDON_HOUR_FMT.format(new Date(ms))); }

// ---------------------------------------------------------------------------------------------
// getSection builders (SELECT-only; every helper degrades to an honest null on missing tables)
// ---------------------------------------------------------------------------------------------

// EXECUTIVE (P1) — last-full-week KPIs, 8-week trend, decision feed, donut, daypart, quality.
function buildExec(q, maxDate, rv2) {
  const exec = { week: null, trend: null, feed: [], donut: null, daypart: null, quality: null };
  const apiMax = rv2 && rv2.maxApiDate ? rv2.maxApiDate : null;

  if (maxDate) {
    // ---- KPI window: last full Mon–Sun week vs the weekday-aligned week LY (−364d) ----
    const wk = K.lastFullWeek(maxDate);
    const lyFrom = K.shiftDays(wk.from, -364);
    const lyTo = K.shiftDays(wk.to, -364);
    const agg = (from, to) => rowsOf(q(
      `SELECT SUM(net_sales_pence) net, SUM(gross_sales_pence) gross, SUM(transactions) txn,
              COUNT(*) days, SUM(premises = 'current') curdays
         FROM v_sales_day_all WHERE business_date BETWEEN ? AND ?`, [from, to]))[0] || {};
    const cur = agg(wk.from, wk.to);
    const ly = agg(lyFrom, lyTo);
    // premises guard: any old-site day on either side → no raw YoY delta, the caption says why.
    // DAY-COUNT guard (2026-08-19, data-wiring audit): the premises test alone never compared the
    // two windows' SIZES, so a week missing a day would have been divided against a full LY week —
    // a 1/7 hole reads as a 14% collapse. No realised error to date (zero missing days across the
    // whole 1,641-day record) — which is exactly why it needed pinning rather than leaving to luck:
    // an ingest gap is a WHEN, not an IF, and the first one would have arrived as a business story.
    const sameSpan = num(cur.days) === num(ly.days);
    const lyComparable = num(ly.days) > 0 && num(ly.curdays) === num(ly.days) && num(cur.curdays) === num(cur.days) && sameSpan;
    exec.week = {
      from: wk.from, to: wk.to, lyFrom, lyTo, days: num(cur.days) || 0,
      net: num(cur.net), gross: num(cur.gross), txn: num(cur.txn),
      lyNet: lyComparable ? num(ly.net) : null, lyGross: lyComparable ? num(ly.gross) : null,
      lyTxn: lyComparable ? num(ly.txn) : null, lyComparable,
      spanMismatch: sameSpan ? null : { cur: num(cur.days), ly: num(ly.days) },
    };

    // ---- covers (OpenTable → covers_day, Phase 2 PR1): the covers denominator + reserved/walk-in
    // split. Lightspeed £ stays canonical; spend/cover is the DERIVED join (net ÷ covers). SUM over
    // zero cover-rows is null → the tiles render '—' honestly (no covers that week). ----
    const salesDatesIn = (from, to) => rowsOf(q(
      `SELECT business_date date, net_sales_pence net
         FROM v_sales_day_all WHERE business_date BETWEEN ? AND ?`, [from, to]));
    const coverDatesIn = (from, to) => rowsOf(q(
      `SELECT business_date date, total_covers totalCovers, reserved_covers reserved, walkin_covers walkin
         FROM covers_day WHERE business_date BETWEEN ? AND ?`, [from, to]));
    const curCoverRows = coverDatesIn(wk.from, wk.to);
    const lyCoverRows = coverDatesIn(lyFrom, lyTo);
    const curCoverage = deriveCoversCaptionState(salesDatesIn(wk.from, wk.to), curCoverRows, { from: wk.from, to: wk.to });
    const lyCoverage = deriveCoversCaptionState(salesDatesIn(lyFrom, lyTo), lyCoverRows, { from: lyFrom, to: lyTo });
    const splitFor = (coverage, rows) => {
      const eligible = new Set(coverage.coveredDates);
      let reserved = 0; let walkin = 0;
      for (const row of rows) if (eligible.has(rowDate(row))) {
        reserved += num(row.reserved) || 0;
        walkin += num(row.walkin) || 0;
      }
      return { reserved, walkin };
    };
    const curSplit = splitFor(curCoverage, curCoverRows);

    // COVERS WINDOW GUARD (2026-08-21). The SPLH intersection discipline (see ~L455) applied to the
    // one feed that never got it — the same class as the day-count guard above, one feed along.
    //
    // Sales and covers arrive by DIFFERENT wires at DIFFERENT rates: Lightspeed lands nightly at
    // 05:30, covers only when an OpenTable export is dropped by hand. Summing both over one nominal
    // window silently divides a WHOLE week of net by a PART week of covers. Today the two happen to
    // align (sales to 08-20, covers to 08-18, KPI week 08-10..16 fully covered on both sides), which
    // is exactly why this needed pinning rather than leaving to luck: next Monday the KPI week
    // becomes 08-17..23, where covers hold 2 of 7 days. Unguarded that renders a ~75% covers
    // "collapse" and a ~3.5x spend/cover "surge" as the page's headline — a fabricated business
    // story with no warning attached, from data that is individually correct on both sides.
    //
    // A part-week total is not a smaller version of the truth, so covers gate to '—' rather than
    // render partial, and every ratio built on them (spend/cover, covers/transaction, both YoYs)
    // gates with them. Net, gross and ATV are untouched — they are complete and stay true.
    // Empty and PARTIAL are distinct observable window states. Neither is evidence that a feed is
    // absent: this page can only say which eligible dates do or do not have covers_day rows.
    exec.week.coversWindow = curCoverage.kind === 'complete' ? null : curCoverage;
    exec.week.covers = curCoverage.kind === 'complete' ? curCoverage.totalCovers : null;
    exec.week.reserved = curCoverage.kind === 'complete' ? curSplit.reserved : 0;
    exec.week.walkin = curCoverage.kind === 'complete' ? curSplit.walkin : 0;
    exec.week.lyCovers = lyComparable && lyCoverage.kind === 'complete' ? lyCoverage.totalCovers : null;

    // COVERS BASIS GUARD (2026-08-19). A covers YoY is only like-for-like if BOTH windows were
    // parsed with a working dedup key. The composite key is
    // [visit_date, visit_at, created_date, seated_date, party_size, guest, table_name, source, status]
    // and a row can only be lost when NOTHING in it discriminates one party from another.
    //
    // CORRECTED SAME DAY, and the correction matters more than the guard: the first version tested
    // `visit_at IS NULL`, which is true of ALL 65,959 rows and flagged the entire history as
    // damaged. It is not. The bare "Visit Time" column never parsed, but until 2026-07-23 the export
    // also carried `seated_date` as a timestamp TO THE SECOND, which discriminates on its own — all
    // 63,915 historical rows are uniquely keyed, zero collapse. The export format then NARROWED:
    // seated_date and created_date stopped arriving, the key lost every time component at once, and
    // 773 of 2,812 rows collapsed. The damage was confined to that window, and it is repaired.
    //
    // So the honest test is "no time discriminator AT ALL", not "visit_at is null" — the difference
    // between withholding a sound comparison and catching a broken one. Live today: 0 at-risk rows
    // in the compared weeks, 120 across two years of history.
    const collapsedIn = (from, to) => num((rowsOf(q(
      `SELECT COUNT(*) n FROM reservations WHERE visit_date BETWEEN ? AND ?
         AND visit_at IS NULL AND seated_date IS NULL`,
      [from, to]))[0] || {}).n) || 0;
    const curCollapsed = collapsedIn(wk.from, wk.to);
    const lyCollapsed = lyComparable ? collapsedIn(lyFrom, lyTo) : 0;
    exec.week.coversBasis = (curCollapsed + lyCollapsed) === 0
      ? { ok: true }
      : { ok: false, cur: curCollapsed, ly: lyCollapsed,
          reason: lyCollapsed && !curCollapsed
            ? 'last year’s covers include rows with no time discriminator, so distinct visits may have collapsed — the two windows are not on the same basis'
            : (curCollapsed && !lyCollapsed
              ? 'this week’s covers are not yet re-parsed while last year’s are — not the same basis'
              : 'both windows still hold un-reparsed covers') };

    // ---- 8-week trend: trailing 8 full weeks ending at the KPI week; LY −364d; target =
    // the rota-ahead forecast basis (DISTINCT dedups the per-dept duplicate target rows).
    // A week without published targets simply has NO target point (honest gap in the dash). ----
    const from8 = K.shiftDays(wk.from, -49);
    const weeks = [];
    for (let i = 7; i >= 0; i--) weeks.push({ from: K.shiftDays(wk.from, -7 * i), net: null, lyNet: null, target: null, lyPrev: false });
    const byFrom = new Map(weeks.map((w) => [w.from, w]));
    for (const r of rowsOf(q(`SELECT business_date d, net_sales_pence n FROM v_sales_day_all WHERE business_date BETWEEN ? AND ?`, [from8, wk.to]))) {
      const w = byFrom.get(K.weekMonday(String(r.d)));
      if (w) w.net = (w.net || 0) + (num(r.n) || 0);
    }
    for (const r of rowsOf(q(`SELECT business_date d, net_sales_pence n, premises p FROM v_sales_day_all WHERE business_date BETWEEN ? AND ?`, [K.shiftDays(from8, -364), lyTo]))) {
      const w = byFrom.get(K.shiftDays(K.weekMonday(String(r.d)), 364));
      if (w) { w.lyNet = (w.lyNet || 0) + (num(r.n) || 0); if (String(r.p) !== 'current') w.lyPrev = true; }
    }
    for (const w of weeks) if (w.lyPrev) w.lyNet = null; // premises guard — no cross-site LY point
    // TARGET SOURCE (2026-08-19, data-wiring audit). This read rota_ahead_budget, which is
    // delete-all + FUTURE-ONLY by construction — today it holds 2026-08-20..30 and nothing else. A
    // trailing 8-week window can therefore NEVER intersect it, so the amber Target series and the
    // "vs target" callout were structurally incapable of ever producing a number: not a gap in the
    // data, a comparison that could not exist. It rendered "no rota-ahead forecast published in the
    // window" forever, which reads as an operator omission rather than a wiring fault.
    //
    // labour_budget keeps the same per-day revenue_target_pence but RETAINS history (886 rows from
    // 2025-06-02), so the trend can actually be judged against the target that was set at the time.
    // DISTINCT because both departments carry the same day-level revenue target.
    for (const r of rowsOf(q(`SELECT DISTINCT business_date d, revenue_target_pence t FROM labour_budget WHERE business_date BETWEEN ? AND ?`, [from8, wk.to]))) {
      const w = byFrom.get(K.weekMonday(String(r.d)));
      if (w && num(r.t) != null) w.target = (w.target || 0) + num(r.t);
    }
    exec.trend = { weeks };

    // ---- quality (day grain — per-receipt discount attribution is not populated by the wire) ----
    const qFrom = K.shiftDays(maxDate, -27);
    const qual = rowsOf(q(`SELECT SUM(discounts_pence) disc, SUM(refunds_pence) refunds, SUM(voids_pence) voids, COUNT(*) days FROM sales_day WHERE business_date BETWEEN ? AND ?`, [qFrom, maxDate]))[0];
    if (qual && num(qual.days) > 0) {
      const refCnt = rowsOf(q(`SELECT COUNT(*) n FROM sales_receipts_api WHERE type = 'REFUND' AND business_date BETWEEN ? AND ?`, [qFrom, maxDate]))[0];
      exec.quality = { from: qFrom, to: maxDate, days: num(qual.days), disc: num(qual.disc), refunds: num(qual.refunds), voids: num(qual.voids), refundCount: refCnt ? num(refCnt.n) || 0 : 0 };
    }
  }

  // ---- decision feed — REAL findings only, each with its computed £ ----
  // (1) newest ok rota-review run of each mode → per-dept budget verdicts
  for (const mode of ['forward', 'hindsight']) {
    const r = rowsOf(q(`SELECT week_monday, report_json FROM rota_review_runs WHERE mode = ? AND status = 'ok' ORDER BY id DESC LIMIT 1`, [mode]))[0];
    if (!r || !r.report_json) continue;
    try {
      const rep = JSON.parse(String(r.report_json));
      for (const v of rep.verdicts || []) {
        const d = num(v.deltaPence);
        if (d === null) continue;
        exec.feed.push({ kind: 'rota', mode, week: String(r.week_monday), dept: String(v.dept || ''), deltaPence: d });
      }
    } catch (e) { /* unreadable run — the Rota Review page surfaces it */ }
  }
  // (2) reconciliation, last 14 recorded days — day_gross excluded (the documented VAT-basis class)
  const recAnchor = maxDate || apiMax;
  if (recAnchor) {
    const rec = rowsOf(q(
      `SELECT COUNT(DISTINCT business_date) days, SUM(passed = 0 AND check_name <> 'day_gross') fails
         FROM sales_reconciliation WHERE business_date BETWEEN ? AND ?`, [K.shiftDays(recAnchor, -13), recAnchor]))[0];
    if (rec && num(rec.days) > 0) exec.feed.push({ kind: 'recon', days: num(rec.days), fails: num(rec.fails) || 0 });
  }
  // (3) QR vs EAT IN spend per SITTING, trailing 28d of the per-receipt record (the Overview
  // pattern; £38/order target retired 2026-07-31 — sitting keys per docs/qr-sitting-basis-2026-07-31.md)
  if (apiMax) {
    const qrFrom = K.shiftDays(apiMax, -27);
    const sitRows = rowsOf(q(
      `SELECT m.channel_label ch, SUM(r.net_without_tax_pence) net, COUNT(*) txn,
              COUNT(DISTINCT CASE
                WHEN m.channel_label = ? THEN r.business_date || '|' || r.table_name
                WHEN r.table_name LIKE 'Table %' THEN r.business_date || '|T' || CAST(substr(r.table_name, 7) AS INTEGER)
                ELSE 'R' || r.receipt_id END) sittings
         FROM sales_receipts_api r JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
        WHERE r.business_date BETWEEN ? AND ? AND m.channel_label IN (?, 'EAT IN') AND ${SALE_WHERE}
        GROUP BY 1`, [QR_LABEL, qrFrom, apiMax, QR_LABEL]));
    const sk = sitRows.find((x) => x.ch === QR_LABEL);
    const eatSit = sitRows.find((x) => x.ch === 'EAT IN');
    if (sk && num(sk.sittings) > 0) {
      exec.feed.push({
        kind: 'qr',
        perSit: Math.round(num(sk.net) / num(sk.sittings)), sittings: num(sk.sittings),
        atv: Math.round(num(sk.net) / num(sk.txn)), txn: num(sk.txn),
        eatPerSit: eatSit && num(eatSit.sittings) > 0 ? Math.round(num(eatSit.net) / num(eatSit.sittings)) : null,
        to: apiMax,
      });
    }

    // (4) attachment signal — the DICT decides the drink class (name-guessing on products is
    // banned as fabrication risk); no drink-named accounting group → honest pending note.
    const drinkGroups = rowsOf(q(`SELECT code, name FROM acct_groups_api WHERE upper(name) LIKE '%DRINK%' OR upper(name) LIKE '%BEVERAGE%'`));
    if (!drinkGroups.length) exec.feed.push({ kind: 'attach-unmapped' });
    else {
      const codes = drinkGroups.map((g) => String(g.code));
      const ph = codes.map(() => '?').join(',');
      const attAgg = (from, to) => rowsOf(q(
        `SELECT COUNT(DISTINCT r.receipt_id) recs,
                COUNT(DISTINCT CASE WHEN l.accounting_group IN (${ph}) THEN r.receipt_id END) withd,
                SUM(CASE WHEN l.accounting_group IN (${ph}) THEN l.net_without_tax_pence ELSE 0 END) dnet,
                SUM(CASE WHEN l.accounting_group IN (${ph}) THEN 1 ELSE 0 END) dlines
           FROM sales_receipts_api r LEFT JOIN sales_receipt_lines_api l ON l.receipt_id = r.receipt_id
          WHERE ${SALE_WHERE} AND r.business_date BETWEEN ? AND ?`, [...codes, ...codes, ...codes, from, to]))[0] || {};
      const curA = attAgg(qrFrom, apiMax);
      const priA = attAgg(K.shiftDays(qrFrom, -28), K.shiftDays(apiMax, -28));
      if (num(curA.recs) > 0) {
        exec.feed.push({
          kind: 'attach', groups: drinkGroups.map((g) => String(g.name)),
          cur: num(curA.withd) / num(curA.recs),
          prior: num(priA.recs) > 0 ? num(priA.withd) / num(priA.recs) : null,
          recs: num(curA.recs),
          avgLine: num(curA.dlines) > 0 ? num(curA.dnet) / num(curA.dlines) : null,
        });
      }
    }

    // ---- donut: last 28d net by channel label, per-receipt (API-era window) ----
    const chan = rowsOf(q(
      `SELECT COALESCE(m.channel_label, m.profile_name, COALESCE(NULLIF(r.account_profile_code,''),'(no profile)')) label,
              SUM(r.net_without_tax_pence) net, COUNT(*) txn
         FROM sales_receipts_api r
         LEFT JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
        WHERE ${SALE_WHERE} AND r.business_date BETWEEN ? AND ? GROUP BY label ORDER BY net DESC`, [qrFrom, apiMax]));
    if (chan.length) exec.donut = { from: qrFrom, to: apiMax, rows: chan.map((r) => ({ label: String(r.label), net: num(r.net) || 0, txn: num(r.txn) || 0 })) };

    // ---- daypart: last 28d line-grain net on LOCAL London hour; ONLINE excluded (no true hour) ----
    const hb = rowsOf(q(
      `SELECT l.time_of_sale_ms/3600000 hb, SUM(l.net_without_tax_pence) net
         FROM sales_receipt_lines_api l
         JOIN sales_receipts_api r ON r.receipt_id = l.receipt_id
         LEFT JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
        WHERE ${SALE_WHERE} AND r.business_date BETWEEN ? AND ? AND l.time_of_sale_ms > 0
          AND COALESCE(m.channel_label,'') <> 'ONLINE ORDER'
        GROUP BY hb`, [qrFrom, apiMax]));
    if (hb.length) {
      const online = rowsOf(q(
        `SELECT SUM(l.net_without_tax_pence) net
           FROM sales_receipt_lines_api l
           JOIN sales_receipts_api r ON r.receipt_id = l.receipt_id
           JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
          WHERE ${SALE_WHERE} AND r.business_date BETWEEN ? AND ? AND m.channel_label = 'ONLINE ORDER'`, [qrFrom, apiMax]))[0];
      const parts = { PREP: 0, LUNCH: 0, TROUGH: 0, DINNER: 0, LATE: 0 };
      for (const r of hb) {
        const bkt = num(r.hb);
        if (bkt === null) continue;
        const h = londonHourOf(bkt * 3600000 + 1800000); // bucket midpoint — offset-constant
        const cut = h < 12 ? 'PREP' : h < 16 ? 'LUNCH' : h < 17 ? 'TROUGH' : h < 21 ? 'DINNER' : 'LATE';
        parts[cut] += num(r.net) || 0;
      }
      exec.daypart = { from: qrFrom, to: apiMax, parts, onlineExcluded: online ? num(online.net) || 0 : 0 };
    }
  }
  return exec;
}

// REVENUE DRIVERS (P2) — 28d KPI strip (anchored at the per-receipt max, the donut idiom),
// hourly heatmap on the line grain (LOCAL London hour, ONLINE excluded — no true hour), the
// designed capacity empty-state, and the 14-day trading scorecard on the RULED status classes.
function buildDrivers(q, maxDate, rv2) {
  const d = { apiMax: null, from: null, revHour: null, splh: null, peak: null, attach: null, heat: null, score: null, cpt: null };
  const apiMax = rv2 && rv2.maxApiDate ? rv2.maxApiDate : null;

  if (apiMax) {
    const from = K.shiftDays(apiMax, -27);
    d.apiMax = apiMax; d.from = from;

    // ---- hour buckets: line grain per (day, UTC-hour bucket); ONLINE excluded from hour
    // attribution (no true hour); untimed lines (time_of_sale_ms=0) never fake an hour ----
    const buckets = rowsOf(q(
      `SELECT r.business_date d, l.time_of_sale_ms/3600000 hb, SUM(l.net_without_tax_pence) net
         FROM sales_receipt_lines_api l
         JOIN sales_receipts_api r ON r.receipt_id = l.receipt_id
         LEFT JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
        WHERE ${SALE_WHERE} AND r.business_date BETWEEN ? AND ? AND l.time_of_sale_ms > 0
          AND COALESCE(m.channel_label,'') <> 'ONLINE ORDER'
        GROUP BY d, hb`, [from, apiMax]));
    if (buckets.length) {
      const online = rowsOf(q(
        `SELECT SUM(l.net_without_tax_pence) net
           FROM sales_receipt_lines_api l
           JOIN sales_receipts_api r ON r.receipt_id = l.receipt_id
           JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
          WHERE ${SALE_WHERE} AND r.business_date BETWEEN ? AND ? AND m.channel_label = 'ONLINE ORDER'`, [from, apiMax]))[0];
      const hourNet = new Map(); // London hour → 28d net
      const cells = {}; // `${dowIdx}-${hour}` (Mon=0) → net, 11..21 only
      const hourKeys = new Set(); // distinct (business_date, London hour)
      let total = 0, outside = 0;
      for (const r of buckets) {
        const bkt = num(r.hb);
        if (bkt === null) continue;
        const net = num(r.net) || 0;
        const h = londonHourOf(bkt * 3600000 + 1800000); // bucket midpoint — offset-constant
        const date = String(r.d);
        total += net;
        hourKeys.add(`${date}|${h}`);
        hourNet.set(h, (hourNet.get(h) || 0) + net);
        const dow = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; // Mon-first
        if (h >= 11 && h <= 21) cells[`${dow}-${h}`] = (cells[`${dow}-${h}`] || 0) + net;
        else outside += net;
      }
      d.revHour = { net: total, hours: hourKeys.size };
      let peak = null;
      for (const [h, n] of hourNet) if (!peak || n > peak.net) peak = { hour: h, net: n };
      d.peak = peak;
      d.heat = { cells, total, outside, onlineExcluded: online ? num(online.net) || 0 : 0 };
    }

    // ---- attachment: share of sale receipts holding ≥1 line in the class (dict-decided) ----
    const drinkGroups = rowsOf(q(
      `SELECT code, name FROM acct_groups_api WHERE upper(name) IN (${DRINK_CLASS_NAMES.map(() => '?').join(',')}) ORDER BY code`, DRINK_CLASS_NAMES));
    const sideGroups = rowsOf(q(
      `SELECT code, name FROM acct_groups_api
        WHERE upper(name) LIKE '%FRYER%' AND upper(name) NOT LIKE '%GRIDDLE%' AND upper(name) NOT LIKE '%BUN%' ORDER BY code`));
    const attAgg = (codes, f, t) => {
      const ph = codes.map(() => '?').join(',');
      return rowsOf(q(
        `SELECT COUNT(DISTINCT r.receipt_id) recs,
                COUNT(DISTINCT CASE WHEN l.accounting_group IN (${ph}) THEN r.receipt_id END) withc
           FROM sales_receipts_api r LEFT JOIN sales_receipt_lines_api l ON l.receipt_id = r.receipt_id
          WHERE ${SALE_WHERE} AND r.business_date BETWEEN ? AND ?`, [...codes, f, t]))[0] || {};
    };
    const attachOf = (groups) => {
      if (!groups.length) return { unmapped: true };
      const codes = groups.map((g) => String(g.code));
      const cur = attAgg(codes, from, apiMax);
      if (!(num(cur.recs) > 0)) return null;
      const pri = attAgg(codes, K.shiftDays(from, -28), K.shiftDays(apiMax, -28));
      return {
        names: groups.map((g) => String(g.name)),
        cur: num(cur.withc) / num(cur.recs), recs: num(cur.recs),
        prior: num(pri.recs) > 0 ? num(pri.withc) / num(pri.recs) : null,
      };
    };
    d.attach = { drink: attachOf(drinkGroups), side: attachOf(sideGroups) };

    // ---- SPLH: the cross-ruler intersection discipline (the labour page's fix) — net summed
    // ONLY over days holding BOTH sales (net>0) AND a labour row; ÷ worked hours of those days ----
    const spl = rowsOf(q(
      `SELECT SUM(s.net_sales_pence) net, SUM(l.actual_minutes) mins, COUNT(*) days
         FROM sales_day s JOIN labour_day l ON l.business_date = s.business_date
        WHERE s.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0`, [from, apiMax]))[0];
    if (spl && num(spl.days) > 0 && num(spl.mins) > 0) d.splh = { net: num(spl.net) || 0, mins: num(spl.mins), days: num(spl.days) };

    // ---- covers-per-transaction (Phase 2 PR1): OpenTable covers ÷ Lightspeed transactions — a
    // SANITY metric (~1.9-2.0), NOT a KPI. Null if either side is absent.
    //
    // INTERSECTION (2026-08-21, same guard as COVERS WINDOW above): this summed the two feeds over
    // one nominal 28d window as two independent sub-SELECTs, so every day sales had and covers
    // lacked pushed the ratio down. Covers currently trail sales by two days — enough to drift a
    // ~1.95 ratio below its own sanity band and have the tile report a DATA finding whose stated
    // cause (a real covers/transaction shift) would not be the actual one (a late export). Joining
    // the two makes the numerator and denominator structurally the same days, and the tile reports
    // the window it actually used rather than the one it was asked for. ----
    const cpt = rowsOf(q(
      `SELECT SUM(c.total_covers) covers, SUM(s.transactions) txn, COUNT(*) days,
              MIN(c.business_date) f, MAX(c.business_date) t
         FROM covers_day c JOIN v_sales_day_all s ON s.business_date = c.business_date
        WHERE c.business_date BETWEEN ? AND ? AND c.total_covers IS NOT NULL`,
      [from, apiMax]))[0];
    if (cpt && num(cpt.covers) != null && num(cpt.txn) > 0) {
      d.cpt = { covers: num(cpt.covers), txn: num(cpt.txn), days: num(cpt.days) || 0,
                from: String(cpt.f), to: String(cpt.t), asked: { from, to: apiMax } };
    }

    // ---- SITTINGS (2026-07-31): the honest per-PARTY QR-vs-served basis. dine_in_sittings holds
    // physical-table receipt clusters, standalone closed Order-N tabs and STOREKIT channel slots;
    // net_pence is ex-VAT.
    // Absent/empty table → d.sit stays null → the panel gates. Per-cover here is OVERALL (dine-in
    // net ÷ OpenTable covers) — covers are channel-agnostic and "POS guest-count is never covers". ----
    const sitRows = rowsOf(q(
      `SELECT channel, COUNT(*) sittings, SUM(net_pence) net, SUM(receipt_count) rcpts
         FROM dine_in_sittings WHERE business_date BETWEEN ? AND ? GROUP BY channel`, [from, apiMax]));
    if (sitRows.length) {
      const by = {}; let totNet = 0, totSit = 0;
      for (const r of sitRows) {
        by[String(r.channel)] = { sittings: num(r.sittings), net: num(r.net) || 0, rcpts: num(r.rcpts) || 0 };
        totNet += num(r.net) || 0; totSit += num(r.sittings) || 0;
      }
      // Per-cover is a cross-feed ratio, so it takes the intersection too (2026-08-21): covers over
      // the days that have them, net over those SAME days. Summing a full 28d of dine-in net over a
      // 26d covers total overstates spend per cover by the ratio of the two spans.
      const covDays = `(SELECT business_date FROM covers_day
                         WHERE business_date BETWEEN ? AND ? AND total_covers IS NOT NULL)`;
      const cov = rowsOf(q(
        `SELECT SUM(total_covers) c, COUNT(*) days, MIN(business_date) f, MAX(business_date) t
           FROM covers_day WHERE business_date BETWEEN ? AND ? AND total_covers IS NOT NULL`,
        [from, apiMax]))[0];
      const covers = cov ? num(cov.c) : null;
      // Per-cover numerator must be the FULL dine-in net (all dine-in receipts, every table), NOT the
      // physical-table sittings subset — dividing a ~34% subset by ALL OpenTable covers understates
      // it badly. Dine-in channels = EAT IN + MON-FRI DEAL + STOREKIT ORDER & PAY (QR).
      const dn = rowsOf(q(
        `SELECT SUM(r.net_without_tax_pence) net
           FROM sales_receipts_api r JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
          WHERE r.business_date IN ${covDays} AND ${SALE_WHERE}
            AND m.channel_label IN ('EAT IN','MON-FRI DEAL','STOREKIT ORDER & PAY')`, [from, apiMax]))[0];
      // How much of each channel's net can actually FORM a sitting (see SITTING_MIN_CAPTURE above).
      // Denominator = all dine-in receipt net for the channel; numerator comes from these returned
      // sitting rows, so table clusters, Order-N tabs, STOREKIT business-day channel slots and any
      // future non-empty basis are counted without maintaining a second closed enum over receipts.
      // SELECT * keeps pre-basis fixture databases readable while exposing the authoritative basis
      // value wherever the current schema supplies it.
      const populationResult = q(
        `SELECT *
           FROM dine_in_sittings WHERE business_date BETWEEN ? AND ?`, [from, apiMax]);
      const capResult = q(
        `SELECT m.channel_label lbl, SUM(r.net_without_tax_pence) net,
                -- Legacy-only numerator for fixture/old-schema compatibility. Current basis-aware
                -- rows derive their captured net above from dine_in_sittings itself.
                SUM(CASE WHEN m.channel_label = ? OR r.table_name LIKE '%Table %' OR r.table_name LIKE 'Order %' THEN r.net_without_tax_pence ELSE 0 END) cnet
           FROM sales_receipts_api r JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
          WHERE r.business_date BETWEEN ? AND ? AND ${SALE_WHERE}
            AND m.channel_label IN ('EAT IN','MON-FRI DEAL','STOREKIT ORDER & PAY')
          GROUP BY m.channel_label`, [QR_LABEL, from, apiMax]);
      const populationRows = populationResult && populationResult.ok
        ? populationResult.rows
        : Array.from({ length: totSit }, () => ({ receiptCount: null }));
      const captionState = deriveSittingCaptionState(populationRows, capResult && capResult.ok ? capResult.rows : []);
      const cap = captionState.capture;
      const verdict = !captionState.population.supported
        ? { ok: false, reason: captionState.populationCaption }
        : (!captionState.capture.supported
          ? { ok: false, reason: captionState.captureCaption }
          : sittingCaptureVerdict(cap));
      d.sit = { from, to: apiMax, by, totNet, totSit, dineNet: dn ? num(dn.net) : null, covers: covers != null && covers > 0 ? covers : null,
                coversDays: cov ? num(cov.days) || 0 : 0, coversFrom: cov && cov.f ? String(cov.f) : null, coversTo: cov && cov.t ? String(cov.t) : null,
                capture: cap, captureByLabel: cap.byLabel, captionState, verdict };
    }
  }

  // ---- daily trading scorecard: last 14 recorded days; a missing sales day = an absent row ----
  if (maxDate) {
    const scFrom = K.shiftDays(maxDate, -13);
    const days = rowsOf(q(
      `SELECT business_date d, net_sales_pence net, discounts_pence disc
         FROM sales_day WHERE business_date BETWEEN ? AND ? ORDER BY business_date`, [scFrom, maxDate]));
    if (days.length) {
      const ly = new Map();
      for (const r of rowsOf(q(`SELECT business_date d, net_sales_pence net, premises p FROM v_sales_day_all WHERE business_date BETWEEN ? AND ?`, [K.shiftDays(scFrom, -364), K.shiftDays(maxDate, -364)])))
        ly.set(String(r.d), { net: num(r.net), premises: String(r.p) });
      const lab = new Map();
      for (const r of rowsOf(q(`SELECT business_date d, actual_minutes am, actual_cost_pence ac, salaried_cost_pence sal FROM labour_day WHERE business_date BETWEEN ? AND ?`, [scFrom, maxDate])))
        lab.set(String(r.d), { am: num(r.am), ac: num(r.ac), sal: num(r.sal) });
      const covMap = new Map(); // per-day covers (OpenTable → covers_day)
      for (const r of rowsOf(q(`SELECT business_date d, total_covers c FROM covers_day WHERE business_date BETWEEN ? AND ?`, [scFrom, maxDate])))
        covMap.set(String(r.d), num(r.c));
      d.score = {
        from: scFrom, to: maxDate,
        rows: days.map((r) => ({
          date: String(r.d), net: num(r.net) || 0, disc: num(r.disc),
          twin: ly.get(K.shiftDays(String(r.d), -364)) || null,
          lab: lab.get(String(r.d)) || null,
          covers: covMap.has(String(r.d)) ? covMap.get(String(r.d)) : null,
        })),
      };
    }
  }
  return d;
}

// RECONCILIATION (P3) — 28d control window anchored at the per-receipt max (the established
// anchor): tender KPIs + the per-method tender-to-bank table (dict-named), the QB POSTED-deposit
// bank side (UNMATCHED — no matching algorithm yet), the recon-battery exception ledger and the
// day-grain gross-to-net bridge. Every side degrades to its honest empty-state, never a number.
function buildRecon(q, rv2) {
  const rc = { apiMax: null, from: null, tenders: null, bank: null, refunds: null, exceptions: null, ledger: [], bridge: null, coverCheck: null, coverCheckGate: null };
  const apiMax = rv2 && rv2.maxApiDate ? rv2.maxApiDate : null;
  if (!apiMax) return rc;
  const from = K.shiftDays(apiMax, -27);
  rc.apiMax = apiMax; rc.from = from;

  // ---- tenders per payment METHOD — the dict (payment_methods_api) names methods on code;
  // an undictionaried code renders AS the code, a NULL code as '(no method)' — never dropped.
  // GROUP BY repeats the full expression: a bare `name` would resolve to m.name (NULL for
  // every undictionaried code) and silently MERGE distinct methods — the tested bug. ----
  const methods = rowsOf(q(
    `SELECT COALESCE(m.name, NULLIF(p.code, ''), '(no method)') AS name,
            SUM(p.net_with_tax_pence) amt, COUNT(*) txn, SUM(p.tip_pence) tips, SUM(p.surcharge_pence) sur
       FROM sales_payments_api p LEFT JOIN payment_methods_api m ON m.code = p.code
      WHERE p.business_date BETWEEN ? AND ?
      GROUP BY COALESCE(m.name, NULLIF(p.code, ''), '(no method)') ORDER BY amt DESC`, [from, apiMax]));
  if (methods.length) {
    const rows = methods.map((r) => ({ name: String(r.name), amt: num(r.amt) || 0, txn: num(r.txn) || 0, tips: num(r.tips) || 0, sur: num(r.sur) || 0 }));
    rc.tenders = {
      rows,
      amt: rows.reduce((s, r) => s + r.amt, 0), txn: rows.reduce((s, r) => s + r.txn, 0),
      tips: rows.reduce((s, r) => s + r.tips, 0), sur: rows.reduce((s, r) => s + r.sur, 0),
    };
  }

  // ---- bank side: QB POSTED deposits in-window (Phase-0 rule — the API never exposes "For
  // Review"; deposits only, purchases/transfers are not takings). UNMATCHED aggregate. ----
  const bk = rowsOf(q(`SELECT COUNT(*) n, SUM(total_pence) p FROM qb_bank_txns WHERE txn_kind = 'deposit' AND txn_date BETWEEN ? AND ?`, [from, apiMax]))[0];
  if (bk && num(bk.n) > 0) rc.bank = { n: num(bk.n), pence: num(bk.p) || 0 };

  // ---- refunds: day grain (the wire's only refund £ home) + REFUND-typed receipt count ----
  const rf = rowsOf(q(`SELECT SUM(refunds_pence) p, COUNT(*) days FROM sales_day WHERE business_date BETWEEN ? AND ?`, [from, apiMax]))[0];
  if (rf && num(rf.days) > 0) {
    const rcnt = rowsOf(q(`SELECT COUNT(*) n FROM sales_receipts_api WHERE type = 'REFUND' AND business_date BETWEEN ? AND ?`, [from, apiMax]))[0];
    rc.refunds = { pence: num(rf.p) || 0, days: num(rf.days), receipts: rcnt ? num(rcnt.n) || 0 : 0 };
  }

  // ---- battery exceptions: last 28d, passed=0, day_gross EXCLUDED from the unresolved count
  // (the documented VAT/gross-basis class, ruled 2026-07-20 — it renders classed, below) ----
  const ex = rowsOf(q(
    `SELECT COUNT(DISTINCT business_date) days, SUM(passed = 0 AND check_name <> 'day_gross') fails
       FROM sales_reconciliation WHERE business_date BETWEEN ? AND ?`, [from, apiMax]))[0];
  if (ex && num(ex.days) > 0) rc.exceptions = { days: num(ex.days), fails: num(ex.fails) || 0 };
  rc.ledger = rowsOf(q(
    `SELECT business_date d, check_name c, delta_pence delta, finding
       FROM sales_reconciliation WHERE business_date BETWEEN ? AND ? AND passed = 0
      ORDER BY business_date DESC, check_name`, [from, apiMax]))
    .map((r) => ({ date: String(r.d), check: String(r.c), delta: num(r.delta), finding: r.finding == null ? null : String(r.finding) }));

  // ---- gross-to-net bridge: day grain over the same window (per-receipt discount attribution
  // is not populated by the wire — verified against known-discount days) ----
  const br = rowsOf(q(
    `SELECT SUM(gross_sales_pence) gross, SUM(discounts_pence) disc, SUM(comps_pence) comps,
            SUM(refunds_pence) refunds, SUM(voids_pence) voids, SUM(service_charges_pence) svc,
            SUM(net_sales_pence) net, SUM(taxes_pence) vat, COUNT(*) days
       FROM sales_day WHERE business_date BETWEEN ? AND ?`, [from, apiMax]))[0];
  if (br && num(br.days) > 0 && num(br.gross) > 0) {
    rc.bridge = {
      days: num(br.days), gross: num(br.gross), disc: num(br.disc) || 0, comps: num(br.comps) || 0,
      refunds: num(br.refunds) || 0, voids: num(br.voids) || 0, svc: num(br.svc) || 0,
      net: num(br.net) || 0, vat: num(br.vat) || 0,
    };
  }

  // ---- OpenTable £/cover cross-check (Phase 2 PR2b): OpenTable's POS-integrated revenue vs the
  // Lightspeed net over the same days. Lightspeed £ stays canon — this is a CROSS-CHECK, not a
  // correction. OpenTable revenue is dine-in seated-with-POS-match only (a SUBSET of all-channel
  // Lightspeed net), so OT/LS below 100% is the expected healthy shape; a swing is a data finding. ----
  const reconSalesRows = rowsOf(q(
    `SELECT business_date date, net_sales_pence net
       FROM v_sales_day_all WHERE business_date BETWEEN ? AND ?`, [from, apiMax]));
  const reconCoverRows = rowsOf(q(
    `SELECT business_date date, seated_covers seatedCovers,
            revenue_net_pence revenueNet, revenue_gross_pence revenueGross,
            revenue_covers revenueCovers
       FROM covers_day WHERE business_date BETWEEN ? AND ?`, [from, apiMax]));
  rc.coverCheckGate = deriveReconciliationCaptionState(reconSalesRows, reconCoverRows, { from, to: apiMax });
  if (!rc.coverCheckGate.withheld) {
    const check = rc.coverCheckGate;
    rc.coverCheck = {
      from: check.dates[0], to: check.dates[check.dates.length - 1], days: check.dates.length,
      dateLabel: check.dateLabel, caption: check.caption, missingDates: check.missingDates,
      otNet: check.openTableNet, otGross: check.openTableGross,
      covers: check.revenueCovers, seated: check.seatedCovers, lsNet: check.lightspeedNet,
    };
  }
  return rc;
}

// MENU GROWTH (P5) — the product ledger at line grain (sales_receipt_lines_api — product truth
// from 2023-07): 28d product aggregates vs the prior 28d and the same 28d window LY (−364d).
// Products group by SKU (renamed variants share SKUs — MAX(name) labels the row); SKUs without
// positive window net (zero-value modifier lines) are excluded, stated on the tab. Complete BOM
// cost is joined by the product's Lightspeed SKU; incomplete recipes never enter contribution or
// classification. A line-absence IS a zero here (lines are ledger facts: no line = nothing sold),
// unlike the day-grain no-record rule.

// A weighted median uses item sales (units) as the weight. Sorting by SKU after the value makes
// the exact-half case stable, and >= is the single boundary rule for BOTH axes: an item exactly
// on either median belongs to the high half. Exported because these classifications and the
// de-duplicated risk union are business logic, not markup.
function buildMenuPortfolio(products, decliners) {
  const current = (Array.isArray(products) ? products : []).map((source) => {
    const p = source || {};
    const sku = String(p.sku == null ? '' : p.sku);
    const qty = num(p.qty) || 0;
    const net = num(p.net) || 0;
    const unitCostPence = num(p.unitCostPence);
    const recipeCosted = unitCostPence != null;
    const contributionPence = recipeCosted && qty > 0 ? (net / qty) - unitCostPence : null;
    return { ...p, sku, qty, net, unitCostPence, recipeCosted, contributionPence, className: null, labelled: false };
  });
  const totalNet = current.reduce((sum, p) => sum + p.net, 0);
  const coveredNet = current.filter((p) => p.recipeCosted).reduce((sum, p) => sum + p.net, 0);
  const awaiting = current.filter((p) => !p.recipeCosted);
  const plottable = current.filter((p) => p.contributionPence != null && p.qty > 0 && p.net > 0);

  const weightedMedian = (rows, valueOf) => {
    const sorted = rows.slice().sort((a, b) => valueOf(a) - valueOf(b) || a.sku.localeCompare(b.sku));
    const weight = sorted.reduce((sum, p) => sum + p.qty, 0);
    if (!sorted.length || !(weight > 0)) return null;
    let seen = 0;
    for (const p of sorted) {
      seen += p.qty;
      if (seen >= weight / 2) return valueOf(p);
    }
    return valueOf(sorted[sorted.length - 1]);
  };
  const popularityMedian = weightedMedian(plottable, (p) => p.qty);
  const contributionMedianPence = weightedMedian(plottable, (p) => p.contributionPence);
  for (const p of plottable) {
    const popular = p.qty >= popularityMedian;
    const contributing = p.contributionPence >= contributionMedianPence;
    p.className = popular
      ? (contributing ? 'Winner' : 'Workhorse')
      : (contributing ? 'Opportunity' : 'Dog');
  }

  // The highest-window-net item in each quadrant receives a persistent label; every bubble
  // still carries the complete tooltip. Ties break by SKU so refreshes never move labels around.
  for (const className of ['Winner', 'Workhorse', 'Opportunity', 'Dog']) {
    plottable.filter((p) => p.className === className)
      .sort((a, b) => b.net - a.net || a.sku.localeCompare(b.sku))
      .slice(0, 1)
      .forEach((p) => { p.labelled = true; });
  }

  const dogs = plottable.filter((p) => p.className === 'Dog');
  const riskBySku = new Map();
  for (const p of dogs) riskBySku.set(p.sku, p.net);
  for (const source of (Array.isArray(decliners) ? decliners : [])) {
    const d = source || {};
    const sku = String(d.sku == null ? '' : d.sku);
    if (sku) riskBySku.set(sku, Math.max(0, num(d.now) || 0));
  }
  const riskWindowNet = [...riskBySku.values()].reduce((sum, value) => sum + value, 0);

  return {
    products: current,
    plottable,
    popularityMedian,
    contributionMedianPence,
    totalNet,
    coveredNet,
    coveragePct: totalNet > 0 ? (coveredNet / totalNet) * 100 : 0,
    awaitingCount: awaiting.length,
    awaitingNet: awaiting.reduce((sum, p) => sum + p.net, 0),
    dogCount: dogs.length,
    dogNet: dogs.reduce((sum, p) => sum + p.net, 0),
    weeklyRiskPence: riskWindowNet / 4,
    riskSkus: [...riskBySku.keys()].sort(),
  };
}

function buildMenu(q, rv2) {
  const recipeLineRow = rowsOf(q(`SELECT COUNT(*) n FROM recipe_lines`))[0] || {};
  const mg = {
    apiMax: null, from: null, products: null, movers: null, decline: null, decliners: null,
    recipeLines: num(recipeLineRow.n) || 0, portfolio: buildMenuPortfolio([], []),
  };
  const apiMax = rv2 && rv2.maxApiDate ? rv2.maxApiDate : null;
  if (!apiMax) return mg;
  const from = K.shiftDays(apiMax, -27);
  mg.apiMax = apiMax; mg.from = from;
  const agg = (f, t) => S.readCanonicalItemSales(q, { from: f, to: t, includeName: true }).rows
    .filter((product) => product.net > 0)
    .map((product) => ({ ...product, qty: product.units }));
  const cur = agg(from, apiMax);
  if (!cur.length) return mg;
  const toMap = (rows) => new Map(rows.map((r) => [String(r.sku), { name: String(r.name || r.sku), qty: num(r.qty) || 0, net: num(r.net) || 0 }]));
  const curM = toMap(cur);
  const priM = toMap(agg(K.shiftDays(from, -28), K.shiftDays(apiMax, -28)));
  const lyM = toMap(agg(K.shiftDays(from, -364), K.shiftDays(apiMax, -364)));
  const costs = new Map();
  if (mg.recipeLines > 0) {
    for (const r of rowsOf(q(
      `SELECT CAST(p.lightspeed_sku AS TEXT) sku,
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
        WHERE p.lightspeed_sku IS NOT NULL
        GROUP BY p.id, CAST(p.lightspeed_sku AS TEXT)`))) {
      const lineCount = num(r.recipe_line_count) || 0;
      const invalid = num(r.invalid_line_count) || 0;
      const unitCostPence = num(r.unit_cost_pence);
      costs.set(String(r.sku), lineCount > 0 && invalid === 0 && unitCostPence != null ? unitCostPence : null);
    }
  }
  mg.products = [...curM.entries()]
    .map(([sku, p]) => ({
      sku, name: p.name, qty: p.qty, net: p.net,
      priorNet: priM.has(sku) ? priM.get(sku).net : null,
      lyNet: lyM.has(sku) ? lyM.get(sku).net : null,
      unitCostPence: costs.has(sku) ? costs.get(sku) : null,
    }))
    .sort((a, b) => b.net - a.net);
  // movers: |Δ 28d net| ≥ 25% AND ≥ £100 vs the prior 28d (presentation cut, captioned);
  // a product absent from one window counts when its swing clears the £100 floor.
  const skus = new Set([...curM.keys(), ...priM.keys()]);
  let movers = 0;
  for (const sku of skus) {
    const c = curM.has(sku) ? curM.get(sku).net : 0;
    const p = priM.has(sku) ? priM.get(sku).net : 0;
    const d = Math.abs(c - p);
    if (d >= MOVER_FLOOR_PENCE && (p > 0 ? d >= MOVER_PCT * p : c > 0)) movers++;
  }
  mg.movers = movers;
  // decline watch: top 6 by net DECLINE vs the prior 28d, ≥ £50 floor (presentation cut);
  // a stopped seller is a REAL decline row (its window net truly IS zero), never dropped.
  mg.decliners = [...skus]
    .map((sku) => {
      const p = priM.has(sku) ? priM.get(sku) : null;
      if (!p || !(p.net > 0)) return null;
      const c = curM.has(sku) ? curM.get(sku) : null;
      const now = c ? c.net : 0;
      return now < p.net ? { sku, name: c ? c.name : p.name, prior: p.net, now, pct: (now / p.net - 1) * 100 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.prior - b.now) - (a.prior - a.now) || a.sku.localeCompare(b.sku));
  mg.portfolio = buildMenuPortfolio(mg.products, mg.decliners);
  mg.products = mg.portfolio.products;
  const currentBySku = new Map(mg.products.map((p) => [p.sku, p]));
  mg.decliners = mg.decliners.map((d) => {
    const currentProduct = currentBySku.get(d.sku);
    const unitCostPence = costs.has(d.sku) ? costs.get(d.sku) : null;
    return {
      ...d,
      recipeCosted: unitCostPence != null,
      contributionPence: currentProduct ? currentProduct.contributionPence : null,
      className: currentProduct ? currentProduct.className : null,
    };
  });
  mg.decline = mg.decliners.filter((r) => r.prior - r.now >= DECLINE_FLOOR_PENCE).slice(0, 6);
  return mg;
}

// FORECAST (P4) — YTD facts, 3-year month sums, the journaled management override.
function buildP4(q, nowYm) {
  const year = Number(nowYm.slice(0, 4));
  const p4 = { year, override: { pct: 0, journal: [], storeMissing: false }, ytd: null, ytdVsLy: null, vsMonth: {} };

  // Override — newest journal row wins; an absent store (cc #86 not deployed) degrades to 0% + note.
  const ovRes = q(`SELECT pct, reason, created_at FROM forecast_overrides ORDER BY id DESC LIMIT 3`);
  if (ovRes && ovRes.ok) {
    p4.override.journal = ovRes.rows.map((r) => ({ pct: Number(r.pct) || 0, reason: String(r.reason || ''), at: num(r.created_at) || 0 }));
    if (p4.override.journal.length) p4.override.pct = p4.override.journal[0].pct;
  } else p4.override.storeMissing = true;

  // YTD actual — day-net canon, current premises ONLY (stated on the tile).
  const ytd = rowsOf(q(`SELECT SUM(net_sales_pence) net, COUNT(*) days, MAX(business_date) t FROM v_sales_day_all WHERE substr(business_date,1,4) = ? AND premises = 'current'`, [String(year)]))[0];
  if (ytd && num(ytd.days) > 0) p4.ytd = { net: num(ytd.net) || 0, days: num(ytd.days), to: String(ytd.t) };

  // Month sums for the 3-year columns — day-net canon incl. the history union.
  for (const r of rowsOf(q(`SELECT month, net_pence, complete, premises FROM v_sales_month WHERE month BETWEEN ? AND ? ORDER BY month`, [`${year - 2}-01`, `${year}-12`]))) {
    p4.vsMonth[String(r.month)] = { net: num(r.net_pence) || 0, complete: !!num(r.complete), premises: String(r.premises || '') };
  }

  // YTD vs LY — COMPLETE month pairs only (MTD excluded, stated); premises-guarded both sides.
  let curSum = 0, lySum = 0, pairs = 0;
  for (let mo = 1; mo <= 12; mo++) {
    const ym = `${year}-${pad2(mo)}`;
    if (ym >= nowYm) break;
    const a = p4.vsMonth[ym];
    const b = p4.vsMonth[`${year - 1}-${pad2(mo)}`];
    if (a && a.complete && a.premises === 'current' && b && b.complete && b.premises === 'current') {
      curSum += a.net; lySum += b.net; pairs++;
    }
  }
  if (pairs > 0 && lySum > 0) p4.ytdVsLy = { pct: (curSum / lySum - 1) * 100, months: pairs };
  return p4;
}

function buildQuickBooksSales(q, month) {
  const window = calendarMonthWindow(month);
  if (!window) return null;
  const receipts = rowsOf(q(
    `SELECT r.receipt_id, r.business_date, r.type, r.cancelled, r.account_profile_code,
            r.net_with_tax_pence, m.channel_label
       FROM sales_receipts_api r
       LEFT JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
      WHERE r.business_date BETWEEN ? AND ?`, [window.from, window.to]));
  const lines = rowsOf(q(
    `SELECT receipt_id, line_id, parent_line_id, business_date, accounting_group, net_with_tax_pence
       FROM sales_receipt_lines_api WHERE business_date BETWEEN ? AND ?`, [window.from, window.to]));
  const payments = rowsOf(q(
    `SELECT receipt_id, payment_seq, business_date, code, net_with_tax_pence, tip_pence
       FROM sales_payments_api WHERE business_date BETWEEN ? AND ?`, [window.from, window.to]));
  const accountingGroups = rowsOf(q(`SELECT code, name FROM acct_groups_api`));
  const salesDates = rowsOf(q(
    `SELECT business_date FROM sales_api_ingest_runs
      WHERE source='kseries-sales-daily' AND status='ok' AND business_date BETWEEN ? AND ?
      ORDER BY business_date`, [window.from, window.to]));
  const feeRows = rowsOf(q(
    `SELECT line, value_pence FROM qb_sales_fees WHERE month = ? AND line IN ('pos_fee','online_fee','online_refunds')`,
    [window.month]));
  const fees = {};
  for (const row of feeRows) {
    const line = String(row.line || '');
    if (QB_OPERATOR_INPUTS.includes(line) && Number.isSafeInteger(row.value_pence)) fees[line] = row.value_pence;
  }
  // Processor settlement rows (the engine's ingest of the operator's payout exports). The table may
  // not exist yet: q() then answers ok:false, rowsOf gives [], and the calculator falls back to the
  // labelled till proxy. Stored magnitudes become the receipt's signed (≤ 0) fee and refund operands.
  const settlement = rowsOf(q(
    `SELECT processor, SUM(amount_pence) gross_pence, SUM(fee_pence) fee_pence, SUM(refund_pence) refund_pence, COUNT(*) n
       FROM processor_settlement_rows WHERE occurred_at >= ? AND occurred_at < ? GROUP BY processor`,
    [window.fromMs, window.toMs])).map((row) => ({
    processor: String(row.processor || '').toLowerCase(),
    grossPence: num(row.gross_pence) || 0,
    feePence: row.fee_pence == null ? null : -Math.abs(num(row.fee_pence) || 0),
    refundPence: row.refund_pence == null ? null : -Math.abs(num(row.refund_pence) || 0),
    rows: num(row.n) || 0,
  }));
  return calculateQuickBooksSales({ month: window.month, receipts, lines, payments, accountingGroups, salesDates, fees, settlement });
}

// Per-month channel stats from the per-receipt record (complete or MTD months only — the kept
// rules): feeds the Executive migration expand (its ONE remaining consumer since the P2 build
// deleted the drivers-tab ATV small-multiples).
function channelMonthStats(rv2) {
  const isShown = (ym) => rv2.months[ym] && (rv2.months[ym].complete || (ym === rv2.nowYm && rv2.months[ym].okDays > 0));
  const yms = [...new Set(rv2.chanMonths.map((r) => String(r.ym)))].filter(isShown).sort();
  const byYm = new Map(yms.map((ym) => [ym, []]));
  for (const r of rv2.chanMonths) if (byYm.has(String(r.ym))) byYm.get(String(r.ym)).push({ label: String(r.label), net: num(r.net) || 0, txn: num(r.txn) || 0 });
  return { yms, byYm };
}

module.exports = {
  CPT_BAND,
  QB_FEE_PLAUSIBILITY_THRESHOLD,
  SITTING_MIN_CAPTURE, SITTING_MAX_SPREAD, sittingCaptureVerdict,
  deriveSittingCaptionState, deriveCoversCaptionState, deriveReconciliationCaptionState,
  buildMenuPortfolio, latestCompleteMonth, formatQuickBooksFeeDerivation, calculateQuickBooksSales,
  key: 'revenue', route: '/coyote/revenue', workspace: 'coyote', title: 'Revenue',
  sub: 'Revenue Command Centre — all six tabs live · menu contribution uses completed recipes · covers live via OpenTable (spend/cover derived)',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    const query = (ctx && ctx.query) || {};
    const tab = TAB_KEYS.includes(String(query.tab || '')) ? String(query.tab) : 'executive';
    const qbMonth = calendarMonthWindow(query.month) ? String(query.month) : latestCompleteMonth(now);
    if (typeof q !== 'function') return { now, tab, rv2: null, qbsales: tab === 'qbsales' ? calculateQuickBooksSales({ month: qbMonth }) : null };

    // ---- shared: the monthly revenue-of-record + projection (P1/P4 canon source).
    // REVENUE-OF-RECORD (operator ruling 2026-08-10, duplication wave): monthly net reads the
    // engine's canonical day-net view v_sales_day_all — never re-summed from receipt headers
    // (the two bases disagreed 36/37 months, worst £131.50; receipts stay the LINE-LEVEL grain
    // for channel/hour/SKU below). Month-completeness still gates on the API ingest ledger. ----
    const nowYm = new Date(now).toISOString().slice(0, 7);
    const boundaryRow = rowsOf(q(`SELECT start_date FROM premises_regime WHERE name='current'`))[0];
    const boundaryDate = boundaryRow && boundaryRow.start_date ? String(boundaryRow.start_date) : '2023-04-01';
    const apiMonths = rowsOf(q(
      `SELECT substr(business_date,1,7) AS ym, SUM(net_sales_pence) AS net, SUM(transactions) AS txn
         FROM v_sales_day_all GROUP BY ym ORDER BY ym`));
    const ledgerMonths = rowsOf(q(
      `SELECT substr(business_date,1,7) AS ym, COUNT(DISTINCT business_date) AS days
         FROM sales_api_ingest_runs WHERE source='kseries-sales-daily' AND status='ok' GROUP BY ym`));
    const chanMonths = rowsOf(q(
      `SELECT substr(r.business_date,1,7) AS ym,
              COALESCE(m.channel_label, m.profile_name, COALESCE(NULLIF(r.account_profile_code,''),'(no profile)')) AS label,
              SUM(r.net_without_tax_pence) AS net, COUNT(*) AS txn
         FROM sales_receipts_api r
         LEFT JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
        WHERE ${SALE_WHERE} GROUP BY ym, label ORDER BY ym`));
    const maxApiRow = rowsOf(q(`SELECT MAX(business_date) AS d FROM sales_receipts_api`))[0];
    let rv2 = null;
    // rv2 carries BOTH the monthly revenue-of-record (view) and the per-receipt window anchor
    // (maxApiDate, the line-level analysis grain) — either presence builds it; the projection
    // panels gate themselves on months, the 28d panels on the anchor.
    if (apiMonths.length || ledgerMonths.length || (maxApiRow && maxApiRow.d)) {
      const months = REP.buildMonths({ apiMonths, ledgerMonths, nowYm });
      const year = Number(nowYm.slice(0, 4));
      rv2 = {
        nowYm, year, boundaryDate, months, chanMonths,
        maxApiDate: maxApiRow && maxApiRow.d ? String(maxApiRow.d) : null,
        projection: REP.computeProjection({ months, year, nowYm, boundaryDate, windowN: 6 }),
      };
    }

    const maxRow = rowsOf(q('SELECT MAX(business_date) AS d FROM sales_day'))[0];
    const maxDate = maxRow && maxRow.d ? String(maxRow.d) : null;
    const m = { now, tab, maxDate, rv2 };

    if (tab === 'executive') {
      m.exec = buildExec(q, maxDate, rv2);
      // DECOMPOSITION (one home = Executive): per month of the current year, ΔR = (C1−C0)·A0 +
      // (A1−A0)·C1 (exact identity); current month MTD-aligned; premises/incomplete months carry
      // a reason, never a fabricated split.
      m.decomp = [];
      const kmr = rowsOf(q(`SELECT MAX(business_date) d FROM v_sales_day_all WHERE premises='current'`))[0];
      const kpiMax = kmr && kmr.d ? String(kmr.d) : null;
      if (kpiMax) {
        const yr = kpiMax.slice(0, 4);
        const curMonth = kpiMax.slice(0, 7);
        const maxDay = kpiMax.slice(8, 10);
        const monthAgg = (ym, cap) => rowsOf(q(
          `SELECT SUM(net_sales_pence) net, SUM(transactions) txn, COUNT(*) days, SUM(premises = 'current') curdays
             FROM v_sales_day_all WHERE substr(business_date, 1, 7) = ? AND substr(business_date, 9, 2) <= ?`, [ym, cap]))[0] || {};
        const calDays = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
        for (let mo = 1; mo <= 12; mo++) {
          const ym = `${yr}-${pad2(mo)}`;
          if (ym > curMonth) break;
          const partial = ym === curMonth;
          const cap = partial ? maxDay : '31';
          const lyYm = `${Number(yr) - 1}-${pad2(mo)}`;
          const a = monthAgg(ym, cap), b = monthAgg(lyYm, cap);
          let reason = null;
          if (!num(b.days)) reason = 'no prior-year record';
          else if (num(a.curdays) !== num(a.days) || num(b.curdays) !== num(b.days)) reason = 'premises break — no raw YoY';
          else if (!partial && (num(a.days) < calDays(ym) || num(b.days) < calDays(lyYm))) reason = 'incomplete record';
          const dd = reason === null ? K.decompose(num(b.txn) || 0, num(b.net) || 0, num(a.txn) || 0, num(a.net) || 0) : null;
          m.decomp.push({ month: ym, partial, mtdDay: partial ? maxDay : null, net: num(a.net) || 0, lyNet: num(b.net) || 0, d: dd, reason: reason !== null ? reason : (dd === null ? 'zero transactions — no split' : null) });
        }
      }
    } else if (tab === 'forecast') {
      m.p4 = buildP4(q, nowYm);
    } else if (tab === 'drivers') {
      m.drivers = buildDrivers(q, maxDate, rv2);
    } else if (tab === 'reconciliation') {
      m.recon = buildRecon(q, rv2);
    } else if (tab === 'menu') {
      // menu (P5) — the line-grain product ledger joined read-only to complete recipe cost
      m.menu = buildMenu(q, rv2);
    } else {
      m.qbsales = buildQuickBooksSales(q, qbMonth);
    }
    return m;
  },

  render(section, ctx) {
    const m = section || {};
    const tab = TAB_KEYS.includes(String(m.tab || '')) ? String(m.tab) : 'executive';
    const esc = S.escapeHtml;
    const gbp = S.fmtGbpPence;
    const int = S.fmtInt;
    const gbp0 = (pence) => `£${Math.round(pence / 100).toLocaleString('en-GB')}`;
    const signedGbp = (p) => `${p >= 0 ? '+' : '−'}${gbp(Math.abs(p))}`;
    const pctStr = (v, dp = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(dp)}%`;

    // Page styles: the .r-tabs/.r-tab nav + the mock's trend/donut/monthly-plot grammar ported
    // VERBATIM (Stage-1 extraction values) into the .rcc scope, + the surviving legacy classes
    // the pending tabs and expands still use. Everything RCC-new lives under .rcc.
    const styles = `<style>${S.rcc.css()}</style><style>
      .rcc .r-tabs{display:flex;gap:4px;border-bottom:1px solid var(--rline);margin:0 0 14px;overflow:auto}
      .rcc .r-tab{color:#9ba4ae;padding:11px 14px;font-weight:700;border-bottom:2px solid transparent;white-space:nowrap;text-decoration:none;font-size:13px}
      .rcc .r-tab.active{color:#fff;border-bottom-color:var(--raccent)}
      .rcc .r-grid{display:grid;gap:14px}
      .rcc .r-kpi-grid{grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:8px}
      .rcc .r-two-col{grid-template-columns:minmax(0,2fr) minmax(330px,1fr);margin-bottom:14px}
      .rcc .r-three-col{grid-template-columns:1.1fr 1fr .85fr;margin-bottom:14px}
      @media(max-width:1200px){.rcc .r-kpi-grid{grid-template-columns:repeat(3,1fr)}.rcc .r-three-col{grid-template-columns:1fr}}
      @media(max-width:820px){.rcc .r-two-col{grid-template-columns:1fr}.rcc .r-kpi-grid{grid-template-columns:repeat(2,1fr)}}
      .rcc .r-alert-list{display:grid;gap:9px}
      .rcc .r-bars{display:grid;gap:12px}
      .rcc .r-legend{display:flex;gap:12px;flex-wrap:wrap;color:#aeb6bf;font-size:11px}
      .rcc .r-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
      .rcc .r-legend i.sq{border-radius:2px}
      .rcc .r-mini-note{color:#8f99a4;font-size:10px;margin-top:10px}
      .rcc .chart-wrap{height:250px;position:relative}
      .rcc .chart-wrap svg{width:100%;height:100%;display:block;overflow:visible}
      .rcc .gridline{stroke:#2a3138;stroke-width:1}
      .rcc .axistext{fill:#7f8994;font-size:11px}
      .rcc .line-current{fill:none;stroke:#ef6a50;stroke-width:3}
      .rcc .line-target{fill:none;stroke:#f1b34c;stroke-width:2;stroke-dasharray:6 7}
      .rcc .line-last{fill:none;stroke:#758190;stroke-width:2}
      .rcc .area-current{fill:url(#rccAreaGradient);opacity:.28}
      .rcc .point{fill:#ef6a50;stroke:#171b20;stroke-width:3}
      .rcc .r-callouts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
      .rcc .donut-wrap{display:flex;align-items:center;gap:20px}
      .rcc .donut{width:150px;height:150px;border-radius:50%;position:relative;flex:0 0 auto}
      .rcc .donut:after{content:"";position:absolute;inset:26px;border-radius:50%;background:#14181d;border:1px solid #2a3139}
      .rcc .donut-center{position:absolute;inset:0;display:grid;place-items:center;text-align:center;z-index:2;font-weight:900;font-size:15px}
      .rcc .donut-center small{display:block;color:#8f99a4;font-size:10px;font-weight:600;margin-top:3px}
      .rcc .donut-legend{display:grid;gap:10px;flex:1}
      .rcc .drow{display:grid;grid-template-columns:10px 1fr auto;gap:8px;align-items:center;color:#c7ced5;font-size:12px}
      .rcc .drow span:first-child{width:8px;height:8px;border-radius:3px}
      .rcc .drow b{color:#fff}
      .rcc .r-driver-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
      .rcc .r-driver-grid.g2{grid-template-columns:repeat(2,1fr)}
      @media(max-width:820px){.rcc .r-driver-grid{grid-template-columns:repeat(2,1fr)}}
      /* drivers: hourly heatmap (mock's .heatmap/.hlabel/.day grammar, ported verbatim) */
      .rcc .r-heatmap{display:grid;grid-template-columns:58px repeat(11,1fr);gap:5px;align-items:center}
      .rcc .r-hlabel{color:#818b95;font-size:10px;text-align:center}
      .rcc .r-hday{color:#b3bbc4;font-size:11px;font-weight:700}
      @media(max-width:820px){.rcc .r-heatmap{grid-template-columns:42px repeat(11,32px);overflow:auto}}
      /* reconciliation: recon grid + total row + gross-to-net waterfall (mock grammar, ported verbatim) */
      .rcc .recon-grid{grid-template-columns:1.25fr .75fr;margin-bottom:14px}
      @media(max-width:820px){.rcc .recon-grid{grid-template-columns:1fr}}
      .rcc .recon-total{display:flex;justify-content:space-between;padding:13px 10px;border-top:1px solid #3a434c;font-weight:900}
      .rcc .waterfall{display:flex;align-items:flex-end;gap:8px;height:210px;padding:18px 8px 30px;border-bottom:1px solid #303842;position:relative;margin-bottom:26px}
      .rcc .wf-col{flex:1;text-align:center;position:relative;min-width:48px}
      .rcc .wf-bar{margin:0 auto;width:68%;border-radius:8px 8px 3px 3px;background:linear-gradient(180deg,#e6654f,#b83e2e);min-height:8px;position:relative}
      .rcc .wf-col.neg .wf-bar{background:linear-gradient(180deg,#5c6876,#39434e)}
      .rcc .wf-col.total .wf-bar{background:linear-gradient(180deg,#4dc58a,#2d895c)}
      .rcc .wf-val{position:absolute;top:-20px;width:100%;font-size:10px;font-weight:800}
      .rcc .wf-lab{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);width:96px;color:#8e98a2;font-size:9px;line-height:1.2}
      /* forecast: monthly clustered columns (mock's .monthly-plot grammar, ported) */
      .rcc .monthly-layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,.45fr);gap:14px;margin-bottom:14px}
      @media(max-width:820px){.rcc .monthly-layout{grid-template-columns:1fr}}
      .rcc .monthly-chart-shell{display:grid;grid-template-columns:48px 1fr;gap:8px}
      .rcc .y-axis{position:relative;height:292px;color:#7f8994;font-size:10px}
      .rcc .y-axis span{position:absolute;right:0;transform:translateY(50%)}
      .rcc .monthly-plot{height:292px;display:grid;grid-template-columns:repeat(12,minmax(24px,1fr));gap:7px;align-items:end;padding:12px 4px 0;position:relative;border-bottom:1px solid #3b444e;background:repeating-linear-gradient(to top,transparent 0,transparent calc(25% - 1px),#293039 calc(25% - 1px),#293039 25%)}
      .rcc .month-group{height:280px;display:grid;grid-template-rows:1fr 20px;gap:4px;min-width:0}
      .rcc .month-bars{display:flex;align-items:flex-end;justify-content:center;gap:3px;height:256px;position:relative}
      .rcc .month-name{text-align:center;color:#8b959f;font-size:10px;font-weight:700}
      .rcc .month-bars .r-mbar{width:25%;max-width:17px;min-width:7px}
      .rcc .r-mbar:hover:after{content:attr(data-tip);position:absolute;z-index:10;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%);background:#080a0c;border:1px solid #3a444e;border-radius:8px;color:#fff;padding:6px 8px;font-size:10px;white-space:nowrap;box-shadow:0 10px 24px rgba(0,0,0,.45)}
      .rcc .hatch-sw{display:inline-block;width:10px;height:10px;border-radius:2px;background:repeating-linear-gradient(135deg,#e44b36 0,#e44b36 4px,#702c25 4px,#702c25 8px);vertical-align:middle;margin-left:6px}
      /* forecast: engine card (mock's .forecast-rule/.slider-wrap grammar) */
      .rcc .forecast-rule{border:1px solid #3a3230;background:#1b1514;border-radius:12px;padding:13px}
      .rcc .forecast-rule strong{display:block;font-size:18px;margin:5px 0}
      .rcc .forecast-rule p{margin:0 0 6px;color:#9ca5af;font-size:11px;line-height:1.5}
      .rcc .forecast-rule p.grey{color:#8f99a4}
      .rcc .slider-wrap{border:1px solid #2e363f;background:#11161a;border-radius:12px;padding:13px;margin-top:12px}
      .rcc .slider-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:9px}
      .rcc .slider-head b{font-size:18px}
      .rcc .slider-wrap input[type=range]{width:100%;accent-color:#e44b36}
      .rcc .ov-reason{width:100%;margin-top:8px;background:#171c22;border:1px solid #303740;border-radius:8px;color:#e5e9ee;font-size:12px;padding:7px 9px;box-sizing:border-box}
      .rcc .ov-save{margin-top:8px;font-weight:700;font-size:12px;background:var(--raccent);color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer}
      .rcc .ov-save:disabled{opacity:.5;cursor:default}
      .rcc .source-map{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
      @media(max-width:820px){.rcc .source-map{grid-template-columns:1fr}}
      .rcc .source{border:1px solid #2d353d;background:#12161a;border-radius:12px;padding:12px}
      .rcc .source h4{margin:0 0 6px;font-size:12px}
      .rcc .source p{margin:0;color:#909aa4;font-size:10px;line-height:1.45}
      .rcc .source .sync{margin-top:9px;color:#7fe0ae;font-size:10px;font-weight:800}
      /* menu: portfolio matrix + classification key + decline rows */
      .rcc .menu-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}
      @media(max-width:820px){.rcc .menu-kpis{grid-template-columns:repeat(2,1fr)}}
      .rcc .matrix{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;height:300px;border-left:1px solid #39424b;border-bottom:1px solid #39424b;position:relative;margin:0 6px 30px 40px}
      .rcc .quad{border-right:1px dashed #303943;border-top:1px dashed #303943;padding:10px;color:#717c87;font-size:10px}
      .rcc .quad.opportunity{background:linear-gradient(135deg,rgba(173,140,255,.09),transparent)}
      .rcc .quad.winner{background:linear-gradient(135deg,rgba(69,196,134,.1),transparent)}
      .rcc .quad.dog{background:linear-gradient(135deg,rgba(239,107,104,.09),transparent)}
      .rcc .quad.workhorse{background:linear-gradient(135deg,rgba(240,182,79,.08),transparent)}
      .rcc .axis-y{position:absolute;left:-36px;top:46%;transform:rotate(-90deg);color:#7f8994;font-size:10px}
      .rcc .axis-x{position:absolute;bottom:-24px;left:46%;color:#7f8994;font-size:10px}
      .rcc .matrix-threshold-x{position:absolute;left:50%;bottom:-18px;transform:translateX(-50%);color:#a0a9b2;background:#11161a;padding:1px 5px;font-size:9px;z-index:4;white-space:nowrap}
      .rcc .matrix-threshold-y{position:absolute;left:-7px;top:50%;transform:translate(-100%,-50%);color:#a0a9b2;background:#11161a;padding:1px 5px;font-size:9px;z-index:4;white-space:nowrap}
      .rcc .bubble{position:absolute;z-index:2;transform:translate(-50%,-50%);border:1px solid rgba(255,255,255,.72);border-radius:50%;padding:0;box-shadow:0 4px 14px rgba(0,0,0,.42);cursor:pointer;transition:transform .14s,filter .14s;appearance:none}
      .rcc .bubble.winner{background:rgba(69,196,134,.76)}
      .rcc .bubble.workhorse{background:rgba(240,182,79,.78)}
      .rcc .bubble.opportunity{background:rgba(173,140,255,.8)}
      .rcc .bubble.dog{background:rgba(239,107,104,.78)}
      .rcc .bubble:hover,.rcc .bubble:focus{z-index:8;transform:translate(-50%,-50%) scale(1.12);filter:brightness(1.14);outline:2px solid #fff;outline-offset:2px}
      .rcc .bubble-label{position:absolute;left:calc(100% + 5px);top:50%;transform:translateY(-50%);max-width:112px;overflow:hidden;text-overflow:ellipsis;color:#eef2f5;font-size:9px;font-weight:800;white-space:nowrap;text-shadow:0 1px 3px #000;pointer-events:none}
      .rcc .bubble-tip{display:none;position:absolute;z-index:10;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:max-content;max-width:220px;background:#080a0c;border:1px solid #47515b;border-radius:8px;color:#fff;padding:7px 9px;font-size:10px;font-weight:600;line-height:1.45;text-align:left;white-space:normal;box-shadow:0 10px 24px rgba(0,0,0,.55);pointer-events:none}
      .rcc .bubble:hover .bubble-tip,.rcc .bubble:focus .bubble-tip{display:block}
      .rcc .matrix-empty{position:absolute;inset:0;display:grid;place-items:center;padding:14px;text-align:left}
      .rcc .matrix-empty .r-empty{background:rgba(13,17,21,.93);max-width:430px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
      .rcc .r-worklist-link{color:var(--raccent2);font-size:11px;font-weight:700;margin-top:8px}
      .rcc .r-worklist-link:hover{text-decoration:underline}
      .rcc .classification-key{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:12px}
      @media(max-width:1200px){.rcc .classification-key{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:520px){.rcc .classification-key{grid-template-columns:1fr}}
      .rcc .class-card{border:1px solid #2d353d;border-radius:11px;background:#11161a;padding:10px}
      .rcc .class-card h4{margin:0 0 4px;font-size:11px}
      .rcc .class-card p{margin:0;color:#8f99a3;font-size:9px;line-height:1.4}
      .rcc .class-card h4.k-up{color:var(--rgood)} .rcc .class-card h4.k-flat{color:var(--rwarn)}
      .rcc .class-card h4.k-opp{color:#b9a5ff} .rcc .class-card h4.k-down{color:var(--rbad)}
      .rcc .decline-row{display:grid;grid-template-columns:1.3fr 76px 76px 58px 1fr;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid #252d34;font-size:11px}
      .rcc .decline-row:last-child{border-bottom:0}
      .rcc .decline-row.head{color:#808a94;font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-weight:800}
      .rcc .decline-row strong{font-size:12px}
      .rcc .decline-row .action{color:#aab2ba;line-height:1.3}
      @media(max-width:520px){.rcc .decline-row{grid-template-columns:1fr 60px 60px 48px}.rcc .decline-row .action{display:none}}
      .rcc .not-costed{color:#7f8994;font-style:italic}
      .rcc .recipe-missing{color:var(--raccent2);font-weight:700;text-decoration:none}
      .rcc .recipe-missing:hover{text-decoration:underline}
      .rcc .rv2-caption a,.rcc .r-mini-note a{color:var(--raccent2);text-decoration:none}
      .rcc .rv2-caption a:hover,.rcc .r-mini-note a:hover{text-decoration:underline}
      /* QuickBooks sales entry: one ten-line accounting bundle plus adjacent diagnostics. */
      .rcc .qb-toolbar{display:flex;align-items:end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
      .rcc .qb-month{display:grid;gap:5px;color:#9ca6af;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
      .rcc .qb-month input{background:#11161a;border:1px solid #37414a;border-radius:8px;color:#fff;padding:8px 10px;font:12px var(--font-mono,monospace)}
      .rcc .qb-warnings{display:grid;gap:7px;margin-bottom:12px}
      .rcc .qb-warning{border:1px solid rgba(240,182,79,.45);background:rgba(240,182,79,.08);border-radius:9px;color:#f0c46c;padding:9px 11px;font-size:11px;line-height:1.45}
      .rcc .qb-ok{border-color:rgba(69,196,134,.4);background:rgba(69,196,134,.08);color:#7fe0ae}
      .rcc .qb-table{min-width:1120px}
      .rcc .qb-table td{vertical-align:top;line-height:1.4}
      .rcc .qb-table .qb-line{font-weight:900;color:#fff;white-space:nowrap}
      .rcc .qb-table .qb-derivation{min-width:310px;color:#aab3bc;font-size:10px}
      .rcc .qb-fee-warning{margin-top:7px;border-left:3px solid var(--rwarn);background:rgba(240,182,79,.08);color:#f0c46c;padding:7px 8px;line-height:1.45}
      .rcc .qb-fee-warning strong{color:#ffd98b}
      .rcc .qb-table .qb-source,.rcc .qb-table .qb-window{color:#89949f;font-size:10px}
      .rcc .qb-balance{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
      .rcc .qb-fee-entry{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}
      .rcc .qb-fee-entry input{width:112px;background:#11161a;border:1px solid #37414a;border-radius:7px;color:#fff;padding:6px 8px;font:11px var(--font-mono,monospace)}
      .rcc .qb-fee-entry button{border:0;border-radius:7px;background:var(--raccent);color:#fff;padding:7px 9px;font-size:10px;font-weight:800;cursor:pointer}
      .rcc .qb-diagnostic{margin-top:12px;border:1px solid #333c45;border-radius:10px;padding:11px;color:#aab3bc;font-size:11px;line-height:1.5}
      .rcc .qb-diagnostic strong{color:#fff}
      /* surviving legacy grammar (the expands + decomp/scorecard tables keep their pre-restyle form) */
      .rp-yoy-up{color:var(--green,#34d399)} .rp-yoy-down{color:var(--red,#f87171)}
      .rp-yoy-na{color:var(--muted,#7a8);font-style:italic}
      .rp-lib{text-align:right;margin:0 0 10px;font-size:13px}
      .rp-lib a{color:#e57373;text-decoration:none;font-weight:600}
      .rp-lib a:hover{text-decoration:underline}
      .rv2-details{margin:9px 2px 0}
      .rv2-details summary{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--muted,#7a8);cursor:pointer;list-style:none;user-select:none}
      .rv2-details summary::-webkit-details-marker{display:none}
      .rv2-details summary:hover,.rv2-details[open] summary{color:var(--text-2,#9ab)}
      .rv2-caption{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--muted,#7a8);margin:8px 2px 2px;line-height:1.55}
    </style>`;

    // ---- subtab nav: 6 links, following the existing ?tab-only grammar ----
    const tabsNav = `<div class="r-tabs">${TABS.map((t) =>
      `<a class="r-tab${t.key === tab ? ' active' : ''}" href="/coyote/revenue?tab=${t.key}">${esc(t.label)}</a>`).join('')}</div>`;

    // ============================ EXECUTIVE (P1) ============================
    const renderExecutive = () => {
      const ex = m.exec || {};
      const wk = ex.week;

      // ---- KPI strip: 6 tiles, last full week vs weekday-aligned LY ----
      const deltaFor = (cur, base) => (cur != null && base != null && base > 0)
        ? { dir: cur >= base ? 'up' : 'down', text: `${cur >= base ? '▲' : '▼'} ${Math.abs((cur / base - 1) * 100).toFixed(1)}% ` }
        : null;
      const barFor = (cur, base) => (cur != null && base != null && base > 0) ? Math.min(100, (cur / base) * 100) : null;
      const atv = wk && wk.net != null && wk.txn ? Math.round(wk.net / wk.txn) : null;
      const lyAtv = wk && wk.lyNet != null && wk.lyTxn ? Math.round(wk.lyNet / wk.lyTxn) : null;
      const noLySub = wk && !wk.lyComparable ? 'LY not comparable' : null;
      const covSeated = wk ? (wk.reserved || 0) + (wk.walkin || 0) : 0;
      const resShare = wk && covSeated > 0 ? `${Math.round((100 * wk.reserved) / covSeated)}%` : '—';
      const walkShare = wk && covSeated > 0 ? `${Math.round((100 * wk.walkin) / covSeated)}%` : '—';
      const cptTxt = wk && wk.covers != null && wk.txn ? (wk.covers / wk.txn).toFixed(2) : null;
      // Spend per cover, this year and LY, plus the basis guard that decides whether the two may be
      // compared at all (see COVERS BASIS GUARD where exec.week.coversBasis is built).
      const spc = wk && wk.net != null && wk.covers ? Math.round(wk.net / wk.covers) : null;
      const lySpc = wk && wk.lyNet != null && wk.lyCovers ? Math.round(wk.lyNet / wk.lyCovers) : null;
      const basis = (wk && wk.coversBasis) || { ok: true };
      const covGap = (wk && wk.coversWindow) || null;
      // Two DIFFERENT reasons a YoY can be absent, and they must not wear each other's clothes:
      // "LY not comparable" (premises guard / no LY record) is the pre-existing, correct state and
      // keeps its own wording; a BASIS block is new and means the two sides were parsed differently.
      const basisBlocked = !!(wk && wk.lyComparable && !basis.ok);
      const canCompare = !!(wk && wk.lyComparable && basis.ok);
      const kpis = [
        S.rcc.kpi({
          label: 'Net revenue · ex-VAT', value: wk && wk.net != null ? gbp(wk.net) : '—',
          delta: wk ? deltaFor(wk.net, wk.lyNet) : null,
          sub: wk ? (noLySub || 'vs same weekday-aligned week LY') : 'no settled sales record yet',
          barPct: wk ? barFor(wk.net, wk.lyNet) : null,
        }),
        S.rcc.kpi({
          label: 'Gross sales', value: wk && wk.gross != null ? gbp(wk.gross) : '—',
          delta: wk ? deltaFor(wk.gross, wk.lyGross) : null,
          sub: wk ? (noLySub || 'inc. VAT · vs same week LY') : 'no settled sales record yet',
          barPct: wk ? barFor(wk.gross, wk.lyGross) : null,
        }),
        // Covers are LIVE (OpenTable → covers_day). POS guest-count is STILL not covers (canon).
        S.rcc.kpi({
          label: 'Covers', value: wk && wk.covers != null ? int(wk.covers) : '—',
          delta: canCompare ? deltaFor(wk.covers, wk.lyCovers) : null,
          sub: wk && wk.covers != null
            ? `OpenTable seated · ${resShare} reserved / ${walkShare} walk-in${basisBlocked ? ` · YoY withheld — ${esc(basis.reason)}` : ''}`
            : (covGap && covGap.kind === 'partial'
              ? `withheld — OpenTable covers reach only ${int(covGap.have)} of this week's ${int(covGap.need)} trading days; missing ${esc(covGap.missingDates.join(', '))}`
              : (covGap && covGap.kind === 'empty'
                ? 'no covers this week (OpenTable) — none exist in the applicable window; required dates are listed below'
                : 'no cover-applicable trading dates this week')),
          barPct: canCompare ? barFor(wk.covers, wk.lyCovers) : null,
        }),
        S.rcc.kpi({
          label: 'Average spend / cover', value: spc != null ? gbp(spc) : '—',
          delta: canCompare ? deltaFor(spc, lySpc) : null,
          sub: basisBlocked
            ? `Lightspeed net ÷ OpenTable covers · YoY withheld — ${esc(basis.reason)}`
            : (covGap && covGap.kind === 'partial'
              ? `withheld — a whole week of net over ${int(covGap.have)} of ${int(covGap.need)} days of covers would read as a surge`
              : (covGap && covGap.kind === 'empty'
                ? `withheld — no covers exist in the applicable window; coverage is needed for ${esc(covGap.missingDates.join(', '))}`
                : (canCompare && lySpc != null ? 'Lightspeed net ÷ OpenTable covers · ex-VAT · vs same week LY'
                  : 'Lightspeed net ÷ OpenTable covers · ex-VAT (derived join)'))),
          barPct: canCompare ? barFor(spc, lySpc) : null,
        }),
        S.rcc.kpi({
          label: 'Average transaction', value: atv != null ? gbp(atv) : '—',
          delta: deltaFor(atv, lyAtv),
          sub: 'net ÷ transactions · ex-VAT',
          barPct: barFor(atv, lyAtv),
        }),
        S.rcc.kpi({ label: 'Revenue quality score', value: 'not ruled', sub: 'composite pending operator definition' }),
      ].join('');
      const kpiCaption = wk
        ? `<div class="rv2-caption">${esc(wk.from)} → ${esc(wk.to)} (last full week, Mon–Sun) · vs same weekday-aligned week LY (−364d: ${esc(wk.lyFrom)} → ${esc(wk.lyTo)}) · per-receipt truth (day-net canon, v_sales_day_all)${wk.lyComparable ? '' : (wk.spanMismatch ? ` · LY not comparable — this week has ${int(wk.spanMismatch.cur)} recorded day(s) against LY's ${int(wk.spanMismatch.ly)}; a short window divided by a full one would read as a collapse, so deltas are omitted` : ' · LY not comparable (premises guard / no record) — deltas omitted, never a cross-site %')}${wk.covers != null ? ` · covers = OpenTable seated (covers_day): ${int(wk.covers)} = ${int(wk.reserved)} reserved + ${int(wk.walkin)} walk-in — booked covers are NEVER read as total${cptTxt ? ` · covers/transaction ${cptTxt} (sanity ~1.9–2.0; a material drift is a data finding, not a KPI)` : ''} · spend/cover = Lightspeed net ÷ covers (derived); POS guest-count is still not covers${!basisBlocked ? '' : ` · <strong>covers YoY and spend/cover YoY are withheld</strong> — ${esc(basis.reason)} (${int(basis.ly || 0)} at-risk LY rows, ${int(basis.cur || 0)} this week). Levels are true; only the year-on-year comparison is blocked, and it returns by itself once the reservations history is rebuilt.`}` : (covGap && covGap.kind === 'partial'
          ? ` · <strong>covers, spend/cover and covers/transaction are withheld this week</strong> — covers_day coverage reaches ${int(covGap.have)} of the week's ${int(covGap.need)} trading days. Missing covers_day dates: ${esc(covGap.missingDates.join(', '))}. Sales are whole, covers are not. Drop the export and all three return with no other change once it covers those dates.`
          : (covGap && covGap.kind === 'empty'
            ? ` · <strong>covers, spend/cover and covers/transaction are withheld this week</strong> — no covers exist in the applicable window. Add covers_day coverage for ${esc(covGap.missingDates.join(', '))} to clear the gate.`
            : ' · no cover-applicable trading dates exist in this week; zero-net closed days do not require covers.') )}</div>`
        : `<div class="rv2-caption">No Lightspeed sales yet — the daily ingest (05:30) fills the day-grain record; covers can be evaluated once a positive-net trading date exists.</div>`;

      // ---- 8-week trend (inline SVG, mock grammar: orange current+area, amber dashed target,
      // grey LY; a week without a published target = a GAP in the dash, never an invented point) ----
      let trendBody;
      const weeks = ex.trend ? ex.trend.weeks : [];
      const anyNet = weeks.some((w) => w.net != null);
      if (anyNet) {
        const W = 900, T = 20, B = 220, L = 60, R = 865;
        let vMax = 0;
        for (const w of weeks) for (const v of [w.net, w.lyNet, w.target]) if (v != null && v > vMax) vMax = v;
        vMax = REP.niceCeil(vMax);
        const X = (i) => Math.round((L + (i * (R - L)) / 7) * 10) / 10;
        const Y = (v) => Math.round((B - ((B - T) * v) / vMax) * 10) / 10;
        const idx = (key) => weeks.map((w, i) => ({ i, v: w[key] }));
        const polys = (key, cls) => REP.contiguousRuns(idx(key), (p) => p.v != null).map((run) =>
          run.length === 1
            ? `<circle cx="${X(run[0].i)}" cy="${Y(run[0].v)}" r="3" class="${cls === 'line-current' ? 'point' : ''}" fill="${cls === 'line-target' ? '#f1b34c' : cls === 'line-last' ? '#758190' : '#ef6a50'}"/>`
            : `<polyline points="${run.map((p) => `${X(p.i)},${Y(p.v)}`).join(' ')}" class="${cls}"/>`).join('');
        const curRuns = REP.contiguousRuns(idx('net'), (p) => p.v != null);
        const area = curRuns.map((run) => run.length > 1
          ? `<path d="M${X(run[0].i)} ${Y(run[0].v)} ${run.slice(1).map((p) => `L${X(p.i)} ${Y(p.v)}`).join(' ')} L${X(run[run.length - 1].i)} ${B} L${X(run[0].i)} ${B} Z" class="area-current"/>` : '').join('');
        const grid = [1, 2, 3, 4].map((t) => {
          const v = (vMax * t) / 4;
          return `<line x1="54" y1="${Y(v)}" x2="870" y2="${Y(v)}" class="gridline"/><text x="9" y="${Y(v) + 4}" class="axistext">£${Math.round(v / 100000)}k</text>`;
        }).join('');
        const xlabs = weeks.map((w, i) => `<text x="${X(i) - 2}" y="243" class="axistext">${esc(w.from.slice(8, 10))} ${esc(MONTHS_ABBR[Number(w.from.slice(5, 7))])}</text>`).join('');
        const lastPt = [...idx('net')].reverse().find((p) => p.v != null);
        const svg = `<svg viewBox="0 0 ${W} 260" role="img" aria-label="Eight week net revenue trend">
          <defs><linearGradient id="rccAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ef6a50"/><stop offset="100%" stop-color="#ef6a50" stop-opacity="0"/></linearGradient></defs>
          ${grid}${area}${polys('net', 'line-current')}${polys('target', 'line-target')}${polys('lyNet', 'line-last')}
          ${lastPt ? `<circle cx="${X(lastPt.i)}" cy="${Y(lastPt.v)}" r="6" class="point"/>` : ''}${xlabs}</svg>`;
        // callouts — real numbers only; an incomputable slot says why instead of inventing one
        const lyPairs = weeks.filter((w) => w.net != null && w.lyNet != null);
        const lyPct = lyPairs.length ? ((lyPairs.reduce((s, w) => s + w.net, 0) / lyPairs.reduce((s, w) => s + w.lyNet, 0)) - 1) * 100 : null;
        const tgtPairs = weeks.filter((w) => w.net != null && w.target != null);
        const tgtPct = tgtPairs.length ? ((tgtPairs.reduce((s, w) => s + w.net, 0) / tgtPairs.reduce((s, w) => s + w.target, 0)) - 1) * 100 : null;
        const lastWeek = weeks[weeks.length - 1];
        const callout = (label, strong, sub, tone) => `<div class="r-callout"><div class="r-kpi-label">${esc(label)}</div><strong${tone ? ` class="${tone}"` : ''}>${esc(strong)}</strong><div class="r-panel-sub">${esc(sub)}</div></div>`;
        trendBody = `<div class="chart-wrap">${svg}</div>
          <div class="r-callouts">
            ${callout('Growth vs LY', lyPct != null ? pctStr(lyPct) : '—', lyPct != null ? `${lyPairs.length} comparable week(s)` : 'no comparable LY weeks (premises guard / no record)', lyPct != null ? (lyPct >= 0 ? 'r-up' : 'r-down') : '')}
            ${callout('vs target', tgtPct != null ? pctStr(tgtPct) : '—', tgtPct != null ? `${tgtPairs.length} week(s) with a published forecast` : 'no rota-ahead forecast published in the window', tgtPct != null ? (tgtPct >= 0 ? 'r-up' : 'r-down') : '')}
            ${callout('Last week', lastWeek && lastWeek.net != null ? gbp(lastWeek.net) : '—', lastWeek ? `w/c ${lastWeek.from}` : '')}
          </div>
          <div class="r-mini-note">target = the per-day revenue target set at the time (labour_budget, dept rows deduplicated). It was read from rota_ahead_budget until 2026-08-19 — that table is future-only, so a trailing window could never intersect it and this line could never plot.</div>`;
      } else {
        trendBody = S.rcc.emptyState({ title: '8-week trend', blocker: 'No day-grain sales record in the trailing 8 weeks.', unlock: 'the daily Lightspeed ingest fills v_sales_day_all' });
      }
      const trendPanel = S.rcc.panel({
        title: '8-week net revenue trend', sub: 'actual vs rota-forecast target and same weeks LY · ex-VAT',
        headRight: `<div class="r-legend"><span><i style="background:#ef6a50"></i>Actual</span><span><i style="background:#f1b34c"></i>Target</span><span><i style="background:#758190"></i>Last year</span></div>`,
        body: trendBody,
      });

      // ---- decision feed — real findings only, each with computed £ + one-line action ----
      const alerts = [];
      const cap1 = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
      for (const f of m.exec ? m.exec.feed : []) {
        if (f.kind === 'rota') {
          const over = f.deltaPence > 0;
          alerts.push(S.rcc.alert({
            tone: over ? 'bad' : 'good',
            title: `${cap1(f.dept)} ${gbp(Math.abs(f.deltaPence))} ${over ? 'over' : 'under'} formula budget`,
            text: `${f.mode} rota review · w/c ${f.week} · see Rota Review`,
            impact: signedGbp(f.deltaPence),
          }));
        } else if (f.kind === 'recon') {
          alerts.push(f.fails > 0
            ? S.rcc.alert({ tone: 'bad', title: `${f.fails} reconciliation check failure(s)`, text: `last ${f.days} recorded day(s) · day_gross excluded (documented VAT-basis class) · see Reconciliation`, impact: `${f.fails} checks` })
            : S.rcc.alert({ tone: 'good', title: 'Reconciliation clean', text: `reconciliation clean — ${f.days} days, day_gross variance is the documented VAT-basis class`, impact: 'clean' }));
        } else if (f.kind === 'qr') {
          const behind = f.eatPerSit != null && f.perSit < f.eatPerSit;
          alerts.push(S.rcc.alert({
            tone: behind ? 'bad' : 'good',
            title: `QR ${gbp(f.perSit)}/sitting${f.eatPerSit != null ? ` vs EAT IN ${gbp(f.eatPerSit)}` : ''}`,
            text: `28d to ${f.to} · ${int(f.sittings)} QR sittings · QR orders fragment per sitting — per-order ATV (${gbp(f.atv)}, ${int(f.txn)} txn) understates spend; per-cover basis is the honest comparison`,
            impact: `${gbp(f.perSit)}/sitting`,
          }));
        } else if (f.kind === 'attach') {
          if (f.prior === null) {
            alerts.push(S.rcc.alert({ title: `Drink attachment ${(f.cur * 100).toFixed(1)}%`, text: `first 28d window on record — no prior window to compare yet (${f.groups.join(' + ')})`, impact: 'baseline' }));
          } else {
            const deltaPts = (f.cur - f.prior) * 100;
            const impact = f.avgLine != null ? Math.round((f.cur - f.prior) * f.recs * f.avgLine) : null;
            alerts.push(S.rcc.alert({
              tone: deltaPts < 0 ? 'bad' : 'good',
              title: `Drink attachment ${(f.cur * 100).toFixed(1)}% (${deltaPts >= 0 ? '+' : '−'}${Math.abs(deltaPts).toFixed(1)} pts vs prior 28d)`,
              text: `drink classes: ${f.groups.join(' + ')} · ${int(f.recs)} receipts · line grain · ${deltaPts < 0 ? 'coach the attach prompt' : 'holding'}`,
              impact: impact != null ? signedGbp(impact) : '—',
            }));
          }
        } else if (f.kind === 'attach-unmapped') {
          alerts.push(S.rcc.alert({ title: 'Attachment signal pending drink-class mapping', text: 'no drink-named accounting group in the dict (acct_groups_api) — mapping one lights this up; a name-guess would be fabrication', impact: 'pending' }));
        }
      }
      const openCount = alerts.length;
      const feedPanel = S.rcc.panel({
        title: 'Decision feed', sub: 'real findings only — each carries its computed £ and action',
        headRight: openCount ? S.rcc.tag(`${openCount} item(s)`, 'warn') : '',
        body: openCount ? `<div class="r-alert-list">${alerts.join('')}</div>`
          : S.rcc.emptyState({ title: 'Decision feed', blocker: 'No computable findings yet — rota-review runs, reconciliation days and the per-receipt record feed this.', unlock: 'the daily ingests + rota review timers' }),
      });

      // ---- donut: last-28d channel mix, per-receipt; migration table survives as the expand ----
      let donutBody;
      if (ex.donut) {
        const rows = ex.donut.rows;
        const total = rows.reduce((s, r) => s + Math.max(0, r.net), 0) || 1;
        const top = rows.filter((r) => r.net > 0).slice(0, 5);
        const restNet = rows.filter((r) => r.net > 0).slice(5).reduce((s, r) => s + r.net, 0);
        const segs = top.map((r, i) => ({ label: r.label, net: r.net, color: DONUT_COLORS[i % DONUT_COLORS.length] }));
        if (restNet > 0) segs.push({ label: `other (${rows.length - top.length})`, net: restNet, color: DONUT_COLORS[5] });
        let acc = 0;
        const conic = segs.map((s2) => {
          const from = (acc / total) * 100; acc += s2.net;
          return `${s2.color} ${from.toFixed(2)}% ${((acc / total) * 100).toFixed(2)}%`;
        }).join(',');
        const legend = segs.map((s2) => `<div class="drow"><span style="background:${s2.color}"></span><div>${esc(s2.label)} <small>${gbp(s2.net)}</small></div><b>${((s2.net / total) * 100).toFixed(1)}%</b></div>`).join('');
        // negative-net channels (refund-heavy) cannot join a conic gradient — listed, never hidden
        const neg = rows.filter((r) => r.net <= 0);
        const negRows = neg.length ? neg.map((r) => `<div class="drow"><span style="background:#39434d"></span><div>${esc(r.label)} <small>${gbp(r.net)}</small></div><b>—</b></div>`).join('') : '';
        // migration detail (moved intact from the old channel-mix section)
        let mig = '';
        if (m.rv2) {
          const cs = channelMonthStats(m.rv2);
          const migRows = cs.yms.map((ym) => {
            const rws = cs.byYm.get(ym) || [];
            const eat = rws.filter((x) => x.label === 'EAT IN').reduce((s, r) => s + r.net, 0);
            const qr = rws.filter((x) => x.label === QR_LABEL).reduce((s, r) => s + r.net, 0);
            const unit = eat + qr;
            return { ym, eat: eat || null, qr: qr || null, unit: unit || null, share: unit > 0 && qr > 0 ? (qr / unit) * 100 : null };
          });
          if (migRows.length) {
            const migTable = `<table class="tbl"><thead><tr><th>month</th><th>EAT IN</th><th>QR (Storekit)</th><th>dine-in unit</th><th>QR share</th></tr></thead><tbody>
              ${migRows.slice(-13).map((r) => `<tr><td>${esc(monthLabel(r.ym))}${r.ym === m.rv2.nowYm ? ' <span class="ash">(MTD)</span>' : ''}</td>
                <td class="mono">${r.eat != null ? gbp(r.eat) : '—'}</td><td class="mono">${r.qr != null ? gbp(r.qr) : '—'}</td>
                <td class="mono">${r.unit != null ? gbp(r.unit) : '—'}</td>
                <td class="mono">${r.share != null ? r.share.toFixed(1) + '%' : '<span class="ash">no QR</span>'}</td></tr>`).join('')}
            </tbody></table>`;
            const shareSpark = REP.svgSparkline({ width: 220, height: 44, points: migRows.map((r) => ({ v: r.share != null ? Math.round(r.share * 100) : null })), color: '#34D399' });
            mig = `<details class="rv2-details"><summary>QR migration detail (monthly, complete months) ▸</summary><div style="margin-top:8px">${migTable}${shareSpark ? `<div style="margin-top:8px">${shareSpark} <span class="rv2-caption" style="margin:0">QR share of the dine-in unit</span></div>` : ''}</div></details>`;
          }
        }
        donutBody = `<div class="donut-wrap">
            <div class="donut" style="background:conic-gradient(${conic})"><div class="donut-center">${gbp(total)}<small>net · 28d</small></div></div>
            <div class="donut-legend">${legend}${negRows}</div>
          </div>
          <div class="r-mini-note">28d to ${esc(ex.donut.to)} · per-receipt · ${esc(API_ERA_NOTE)}</div>${mig}`;
      } else {
        donutBody = S.rcc.emptyState({ title: 'Channel mix', blocker: 'no per-receipt API record yet — channel truth is per-receipt only, never the scraper aggregate.', unlock: 'the K-Series daily API ingest' });
      }
      const donutPanel = S.rcc.panel({ title: 'Revenue by service channel', sub: 'share of net · last 28 days · ex-VAT', body: donutBody });

      // ---- daypart bars (the ruled cuts on London hour; ONLINE excluded — no true hour) ----
      let daypartBody;
      if (ex.daypart) {
        const order = [['PREP', 'before 12'], ['LUNCH', '12–16'], ['TROUGH', '16–17'], ['DINNER', '17–21'], ['LATE', 'from 21']];
        const totalDp = order.reduce((s, [k]) => s + ex.daypart.parts[k], 0) || 1;
        const rowsHtml = order.map(([k, hrs]) => S.rcc.barrow({
          label: `${k} · ${hrs}`,
          segs: [{ pct: (ex.daypart.parts[k] / totalDp) * 100, color: 'linear-gradient(90deg,#e44b36,#ff8a5b)' }],
          value: `${gbp(ex.daypart.parts[k])} · ${((ex.daypart.parts[k] / totalDp) * 100).toFixed(0)}%`,
        })).join('');
        const onlineNote = ex.daypart.onlineExcluded > 0
          ? `${gbp(ex.daypart.onlineExcluded)} ONLINE excluded — no true hour (the online-order ruling)`
          : 'ONLINE ORDER lines excluded — no true hour (the online-order ruling)';
        daypartBody = `<div class="r-bars">${rowsHtml}</div>
          <div class="r-mini-note">${esc(onlineNote)} · cuts on LOCAL London hour · 28d to ${esc(ex.daypart.to)} · line grain (sales_receipt_lines_api)</div>`;
      } else {
        daypartBody = S.rcc.emptyState({ title: 'Daypart', blocker: 'no per-receipt API record yet at line grain — dayparts cut on the ruled London hours only when true sale times exist.', unlock: 'the K-Series daily API ingest (line grain)' });
      }
      const daypartPanel = S.rcc.panel({ title: 'Revenue by daypart', sub: 'ruled cuts · PREP / LUNCH / TROUGH / DINNER / LATE', body: daypartBody });

      // ---- revenue quality (day grain — the wire never populates per-receipt discounts) ----
      let qualityBody;
      if (ex.quality) {
        qualityBody = `<div class="r-driver-grid g2">
            ${S.rcc.driver({ label: 'Discounts · 28d', value: gbp(ex.quality.disc), sub: `${ex.quality.days} recorded day(s) · sales_day day grain` })}
            ${S.rcc.driver({ label: 'Refunds · 28d', value: gbp(ex.quality.refunds), sub: `${ex.quality.refundCount} REFUND receipt(s) in the window` })}
            ${S.rcc.driver({ label: 'Voids · 28d', value: gbp(ex.quality.voids), sub: 'cancelled items · day grain' })}
            ${S.rcc.driver({ label: 'Processor fees', value: 'no source', sub: 'not in the POS record — statement/QB fact' })}
          </div>
          <div class="r-mini-note">per-receipt discount attribution not populated by the wire — day grain only.</div>`;
      } else {
        qualityBody = S.rcc.emptyState({ title: 'Revenue quality', blocker: 'No day-grain record in the trailing 28 days.', unlock: 'the daily Lightspeed ingest' });
      }
      const qualityPanel = S.rcc.panel({ title: 'Revenue quality', sub: 'leakage · discounts / refunds / voids / fees', body: qualityBody });

      // ---- decomposition (ONE home — absorbed from the old expand): current month as driver
      // cards, the full monthly table behind the expand ----
      let decompPanel = '';
      if (m.decomp && m.decomp.length) {
        const cur = m.decomp[m.decomp.length - 1];
        let curHtml;
        if (cur && cur.d) {
          const dd = cur.d;
          curHtml = `<div class="r-driver-grid">
            ${S.rcc.driver({ label: `Δ net vs LY · ${monthLabel(cur.month)}${cur.partial ? ' MTD' : ''}`, value: signedGbp(Math.round(dd.delta)), sub: 'exact identity: ΔR = volume + spend' })}
            ${S.rcc.driver({ label: 'Growth from volume', value: signedGbp(Math.round(dd.volume)), sub: '(C1−C0)·A0 — check count at LY spend' })}
            ${S.rcc.driver({ label: 'Growth from spend', value: signedGbp(Math.round(dd.spend)), sub: '(A1−A0)·C1 — spend/check at current volume' })}
            ${S.rcc.driver({ label: 'Lead lever', value: `${dd.lead.toUpperCase()}-led`, sub: dd.checkOk ? 'identity reconciles exactly' : 'identity check FAILED — inspect' })}
          </div>`;
        } else {
          curHtml = S.rcc.emptyState({ title: `Decomposition · ${monthLabel(cur.month)}`, blocker: cur.reason || 'no comparable prior year', unlock: 'a comparable current-premises LY month' });
        }
        const rows2 = m.decomp.map((r) => {
          if (r.reason) return `<tr><td>${esc(monthLabel(r.month))}${r.partial ? ` <span class="ash">MTD d${esc(String(Number(r.mtdDay)))}</span>` : ''}</td><td class="mono">${gbp(r.net)}</td><td colspan="3" class="rp-yoy-na">${esc(r.reason)}</td></tr>`;
          const dd = r.d;
          const bar = (v) => { const w = Math.min(60, Math.round(Math.abs(v) / 100000 * 6)); return `<span style="display:inline-block;height:8px;width:${w}px;background:${v >= 0 ? 'var(--green,#34D399)' : 'var(--amber,#FBBF24)'};border-radius:2px;vertical-align:middle"></span>`; };
          return `<tr><td>${esc(monthLabel(r.month))}${r.partial ? ` <span class="ash">MTD d${esc(String(Number(r.mtdDay)))}</span>` : ''}</td>
            <td class="mono">${gbp(r.net)}</td>
            <td class="mono"><span class="${dd.delta >= 0 ? 'rp-yoy-up' : 'rp-yoy-down'}">${dd.delta >= 0 ? '+' : '−'}${gbp(Math.abs(dd.delta))}</span></td>
            <td class="mono">${bar(dd.volume)} ${dd.volume >= 0 ? '+' : '−'}${gbp(Math.abs(dd.volume))}</td>
            <td class="mono">${bar(dd.spend)} ${dd.spend >= 0 ? '+' : '−'}${gbp(Math.abs(dd.spend))}${dd.checkOk ? '' : ' <span class="rp-yoy-down">Σ✗</span>'}</td></tr>`;
        }).join('');
        const table = `<details class="rv2-details"><summary>decomposition — which lever moved each month (ΔR = volume + spend, exact identity) ▸</summary>
          <div style="margin-top:8px"><table class="tbl"><thead><tr><th>month</th><th>net</th><th>Δ vs LY</th><th>volume effect</th><th>spend effect</th></tr></thead><tbody>${rows2}</tbody></table></div></details>`;
        decompPanel = S.rcc.panel({
          title: 'Decomposition — volume vs spend', sub: 'ΔR = (C1−C0)·A0 + (A1−A0)·C1 · vs same month LY · MTD-aligned',
          body: curHtml + table,
        });
      }

      return `<div class="r-grid r-kpi-grid">${kpis}</div>${kpiCaption}
        <div class="r-grid r-two-col">${trendPanel}${feedPanel}</div>
        <div class="r-grid r-three-col">${donutPanel}${daypartPanel}${qualityPanel}</div>
        ${decompPanel}`;
    };

    // ============================ FORECAST (P4) ============================
    const renderForecast = () => {
      const rv2 = m.rv2;
      const P = rv2 ? rv2.projection : null;
      const p4 = m.p4 || { year: rv2 ? rv2.year : Number(new Date(m.now || Date.now()).toISOString().slice(0, 4)), override: { pct: 0, journal: [], storeMissing: true }, ytd: null, ytdVsLy: null, vsMonth: {} };
      const year = p4.year;
      const nowYm = rv2 ? rv2.nowYm : `${year}-${pad2(new Date(m.now || Date.now()).getUTCMonth() + 1)}`;
      const ov = p4.override.pct;
      const ovF = 1 + ov / 100;
      const fy = P ? P.fullYear : null;
      const methodSeasonal = fy && fy.seasonalPence != null;
      const base = fy ? (methodSeasonal ? fy.seasonalPence : fy.simplePence) : null;
      const methodLabel = methodSeasonal ? 'seasonality-aware' : (fy && fy.simplePence != null ? 'simple YTD-YoY (promoted — window too thin)' : null);
      // the override scales FORECAST months only — actuals are frozen fact
      const fKey = methodSeasonal ? 'seasonalPence' : 'simplePence';
      const forecastSum = P ? P.forecast.reduce((s, f) => s + (f[fKey] != null ? f[fKey] : 0), 0) : 0;
      const adjusted = base != null ? base + forecastSum * (ov / 100) : null;
      // 2025 full year on the per-receipt record (the projection's own basis)
      const lyAll = rv2 && REP.ymsOfYear(year - 1).every((ym) => rv2.months[ym] && rv2.months[ym].complete);
      const lyTotal = lyAll ? REP.ymsOfYear(year - 1).reduce((s, ym) => s + rv2.months[ym].netPence, 0) : null;

      // ---- KPI strip (6) ----
      const ratioPct = P && P.ratio != null ? (P.ratio - 1) * 100 : null;
      const kpis = [
        S.rcc.kpi({
          label: `${year} actual YTD`, value: p4.ytd ? gbp(p4.ytd.net) : '—',
          sub: p4.ytd ? `${int(p4.ytd.days)} days to ${p4.ytd.to} · premises current only · day-net canon` : 'no day-grain record this year yet',
        }),
        S.rcc.kpi({
          label: `YTD vs ${year - 1}`, value: p4.ytdVsLy ? pctStr(p4.ytdVsLy.pct) : '—',
          delta: p4.ytdVsLy ? { dir: p4.ytdVsLy.pct >= 0 ? 'up' : 'down', text: '' } : null,
          sub: p4.ytdVsLy ? `${p4.ytdVsLy.months} complete month-pair(s) · MTD excluded · v_sales_month` : 'no comparable complete months yet',
        }),
        base != null
          ? S.rcc.kpi({ label: 'Full-year forecast', value: gbp0(base), sub: `${methodLabel} · re-forecast at every read` })
          : S.rcc.kpi({ label: 'Full-year forecast', value: 'record filling', sub: fy && fy.missing.length ? `uncovered: ${fy.missing.slice(0, 3).map(monthLabel).join(', ')}${fy.missing.length > 3 ? ` +${fy.missing.length - 3} more` : ''}` : 'per-receipt record not started' }),
        S.rcc.kpi({
          label: 'After adjustment', value: adjusted != null ? gbp0(adjusted) : '—',
          sub: p4.override.storeMissing ? 'override store pending deploy (cc #86) — 0% applied'
            : (ov === 0 ? 'override 0% — matches the base rule' : `override ${pctStr(ov)} applied to forecast months only`),
        }),
        S.rcc.kpi({
          label: 'Carry-forward factor', value: ratioPct != null ? `${(P.ratio * 100).toFixed(1)}%` : (P && P.ytdRatio != null ? `${(P.ytdRatio * 100).toFixed(1)}%` : '—'),
          sub: ratioPct != null ? 'weighted YoY over trailing ≤6 pairs · ×3/×2 recency' : (P && P.ytdRatio != null ? 'simple YTD-YoY (window too thin for seasonality)' : 'needs comparable month-pairs'),
        }),
        S.rcc.kpi({
          label: `Forecast vs ${year - 1}`, value: adjusted != null && lyTotal ? pctStr((adjusted / lyTotal - 1) * 100) : '—',
          sub: adjusted != null && lyTotal ? `vs ${year - 1} full year · per-receipt record` : `${year - 1} per-receipt record incomplete — no full-year base`,
        }),
      ].join('');

      // ---- monthly clustered columns (absorbs the old projection chart + long-range arc + YoY) ----
      const bars = []; // [{mo, y0,y1, act, fc}] pence or null
      let vMax = 0;
      for (let mo = 1; mo <= 12; mo++) {
        const ym = `${year}-${pad2(mo)}`;
        const m0 = p4.vsMonth[`${year - 2}-${pad2(mo)}`];
        const m1 = p4.vsMonth[`${year - 1}-${pad2(mo)}`];
        const y0 = m0 && m0.complete ? m0.net : null;
        const y1 = m1 && m1.complete ? m1.net : null;
        const complete = rv2 && rv2.months[ym] && rv2.months[ym].complete && ym < nowYm;
        const act = complete ? rv2.months[ym].netPence : null;
        const f = P ? P.forecast.find((x) => x.ym === ym) : null;
        const fv = f && f[fKey] != null ? f[fKey] * ovF : null;
        const fc = ym >= nowYm ? fv : null;
        for (const v of [y0, y1, act, fc]) if (v != null && v > vMax) vMax = v;
        bars.push({ mo, y0, y1, act, fc });
      }
      let columnsBody;
      if (vMax > 0) {
        vMax = REP.niceCeil(vMax);
        const h = (v) => (v / vMax) * 100;
        const groups = bars.map((b) => {
          const bb = [];
          if (b.y0 != null) bb.push(S.rcc.mbar(year - 2, h(b.y0), `${year - 2}: ${gbp0(b.y0)}`));
          if (b.y1 != null) bb.push(S.rcc.mbar(year - 1, h(b.y1), `${year - 1}: ${gbp0(b.y1)}`));
          if (b.act != null) bb.push(S.rcc.mbar(year, h(b.act), `${year} actual: ${gbp0(b.act)}`));
          else if (b.fc != null) bb.push(S.rcc.mbar(year, h(b.fc), `${year} forecast: ${gbp0(b.fc)}`, true));
          return `<div class="month-group"><div class="month-bars">${bb.join('')}</div><div class="month-name">${MONTHS_ABBR[b.mo]}</div></div>`;
        }).join('');
        const yAxis = [0, 1, 2, 3, 4].map((t) => `<span style="bottom:${t * 25}%">£${Math.round((vMax * t) / 4 / 100000)}k</span>`).join('');
        columnsBody = `<div class="monthly-chart-shell"><div class="y-axis">${yAxis}</div><div class="monthly-plot">${groups}</div></div>
          <div class="r-mini-note">${year - 2}/${year - 1} bars: day-net canon incl. history (v_sales_month, complete months only) · ${year} actuals: per-receipt API record, ledger-complete months only · hatched = forecast ×(1+override), never presented as actual · a missing bar is a GAP, never a zero.</div>`;
      } else {
        columnsBody = S.rcc.emptyState({ title: 'Monthly revenue', blocker: 'No complete monthly record on either basis yet (day-net canon or per-receipt ledger).', unlock: 'the daily ingest + K-Series backfill' });
      }
      const columnsPanel = S.rcc.panel({
        title: `Monthly revenue: ${year - 2} vs ${year - 1} vs ${year}`,
        sub: 'net ex-VAT · clustered columns · hatched = forecast',
        headRight: `<div class="r-legend"><span><i class="sq" style="background:#56616e"></i>${year - 2}</span><span><i class="sq" style="background:#67a7ff"></i>${year - 1}</span><span><i class="sq" style="background:#e44b36"></i>${year} actual</span><span><i class="sq" style="background:repeating-linear-gradient(135deg,#e44b36 0,#e44b36 4px,#702c25 4px,#702c25 8px)"></i>${year} forecast</span></div>`,
        body: columnsBody,
      });

      // ---- forecast engine card: the RULED method + the journaled management override ----
      const windowStr = P && P.window.length ? P.window.map((w) => `${MONTHS_ABBR[Number(w.ym.slice(5, 7))]}×${w.weight}`).join(' ') : '—';
      const boundary = rv2 ? rv2.boundaryDate : '2023-04-01';
      const ruleStrong = P && P.ratio != null ? `${year - 1} same month × ${(P.ratio * 100).toFixed(1)}%`
        : (P && P.ytdRatio != null ? `${year - 1} same month × ${(P.ytdRatio * 100).toFixed(1)}% (simple)` : 'record filling — no rule yet');
      const sanity = P && P.ytdRatio != null
        ? `Simple YTD-YoY sanity: ${pctStr((P.ytdRatio - 1) * 100)}${fy && fy.simplePence != null ? ` → full year ${gbp0(fy.simplePence)}` : ''} (grey line on the old chart, now the check figure).`
        : 'Simple YTD-YoY sanity: not computable yet — needs at least one comparable month-pair.';
      const ruleCard = `<div class="forecast-rule"><div class="r-kpi-label">Automatic base rule</div>
        <strong>${esc(ruleStrong)}</strong>
        <p>Seasonality-aware headline (operator-ruled): weighted per-month YoY ratio over the trailing ≤6 complete month-pairs — newest ×3, next ×2 (window ${esc(windowStr)}) — applied to each remaining month's ${year - 1} actual. Premises guard: months before the ${esc(boundary)} move are never used. Months without complete per-receipt API coverage render as gaps, never estimates. Re-forecast at every read — nothing stored.</p>
        <p class="grey">${esc(sanity)}</p></div>`;
      const jr = p4.override.journal;
      const journal = jr.length
        ? `<table class="tbl"><thead><tr><th>when</th><th>override</th><th>reason</th></tr></thead><tbody>${jr.map((j) => `<tr><td class="mono">${esc(j.at ? new Date(j.at).toISOString().slice(0, 10) : '—')}</td><td class="mono">${esc(pctStr(j.pct))}</td><td>${esc(j.reason)}</td></tr>`).join('')}</tbody></table>`
        : `<div class="rv2-caption">no overrides journaled yet — the base rule stands.</div>`;
      const ovDisplay = `${ov > 0 ? '+' : ov < 0 ? '−' : ''}${Math.abs(ov).toFixed(1)}%`;
      const slider = `<div class="slider-wrap">
        <div class="slider-head"><div><div class="r-kpi-label">Management override</div><div class="r-panel-sub">journaled operator assumption · non-zero needs its reason</div></div><b id="ov-val">${esc(ovDisplay)}</b></div>
        <input id="ov-range" type="range" min="-15" max="15" step="0.5" value="${Number.isFinite(ov) ? ov : 0}">
        <input id="ov-reason" class="ov-reason" type="text" maxlength="200" placeholder="reason (required for a non-zero override)">
        <button id="ov-save" class="ov-save" type="button">Save override</button>
        <span id="ov-out" class="r-mini-note"></span>
        ${p4.override.storeMissing ? `<div class="r-mini-note">override store not deployed (cc #86) — a save will refuse honestly (503); 0% applied meanwhile.</div>` : ''}
        <details class="rv2-details"><summary>override journal (last 3) ▸</summary><div style="margin-top:8px">${journal}</div></details>
      </div>`;
      const enginePanel = S.rcc.panel({ title: 'Forecast engine', sub: 'ruled base method + a controlled, journaled override', body: ruleCard + slider });

      // ---- monthly planning table (the labour formulas READ these projections — a pointer) ----
      const planRows = [];
      for (let mo = 1; mo <= 12; mo++) {
        const ym = `${year}-${pad2(mo)}`;
        const a = P ? P.actuals.find((x) => x.ym === ym) : null;
        const isActual = a && a.kind === 'actual';
        const f = P ? P.forecast.find((x) => x.ym === ym) : null;
        const fv = ym >= nowYm && f && f[fKey] != null ? f[fKey] * ovF : null;
        const lyM = rv2 && rv2.months[`${year - 1}-${pad2(mo)}`];
        const lyNet = lyM && lyM.complete ? lyM.netPence : null;
        const cmp = isActual ? a.netPence : fv;
        const vsLy = cmp != null && lyNet ? pctStr((cmp / lyNet - 1) * 100) : '—';
        let chip;
        if (isActual) chip = S.rcc.tag('Actual', 'good');
        else if (ym === nowYm) chip = S.rcc.tag('Current', 'warn');
        // a future month WITHOUT a computable forecast is a gap with its reason, never "Forecast"
        else if (ym > nowYm) chip = fv != null ? S.rcc.tag('Forecast', 'info') : S.rcc.tag((f && f.reason) || 'no prior-year base');
        else chip = S.rcc.tag((a && a.reason) || (f && f.reason) || 'no record');
        planRows.push(`<tr><td>${MONTHS_FULL[mo]}</td>
          <td class="r-num mono">${isActual ? gbp(a.netPence) : '—'}</td>
          <td class="r-num mono">${fv != null ? `${gbp0(fv)}<span class="hatch-sw" title="forecast — hatched, never an actual"></span>` : '—'}</td>
          <td class="r-num mono">${esc(vsLy)}</td>
          <td>${chip}</td></tr>`);
      }
      const planPanel = S.rcc.panel({
        title: 'Monthly revenue planning table', sub: `${year} · actuals frozen, forecast ×(1+override) · vs ${year - 1} per-receipt`,
        headRight: S.rcc.tag('LABOUR FEED', 'info'),
        body: `<div style="overflow:auto"><table><thead><tr><th>Month</th><th class="r-num">${year} actual</th><th class="r-num">${year} forecast</th><th class="r-num">vs ${year - 1}</th><th>Status</th></tr></thead><tbody>${planRows.join('')}</tbody></table></div>
          <div class="r-mini-note">this table is the labour-formula's forecast-net input — one home: the rota formulas READ these projections (a pointer, never a copy).</div>`,
      });

      // ---- governance ----
      const gov = `<div class="source-map">
          <div class="source"><h4>Comparable calendar</h4><p>Current-premises months only — the ${esc(boundary)} move blocks cross-site YoY; a blocked comparison carries its reason, never a number.</p><div class="sync">PREMISES GUARD</div></div>
          <div class="source"><h4>Revenue basis</h4><p>Recognised net revenue ex-VAT — the day-net canon v_sales_day_all is the revenue-of-record (ruling 2026-08-10); the per-receipt API record is the line-level analysis grain, never re-summed as "the" net; tips and processor timing excluded.</p><div class="sync">FINANCE-CLEAN INPUT</div></div>
          <div class="source"><h4>Known-event overrides</h4><p>Every non-zero override is journaled with its reason — see the override journal in the engine card.</p><div class="sync">AUDITABLE</div></div>
          <div class="source"><h4>Future labour handoff</h4><p>The forecast feeds the banded labour formula — the rota formulas read these projections directly.</p><div class="sync">POINTER, NOT A COPY</div></div>
        </div>`;
      const govPanel = S.rcc.panel({ title: 'Forecast governance', sub: 'the controls that make the forecast safe to feed labour budgets', body: gov });

      // override save — aqBusy-style: POST {pct, reason} then reload; client hints the reason rule
      const script = `<script>(function(){
        var s=document.getElementById('ov-range'),v=document.getElementById('ov-val'),r=document.getElementById('ov-reason'),b=document.getElementById('ov-save'),o=document.getElementById('ov-out');
        if(!s||!b)return; var busy=false;
        s.addEventListener('input',function(){var n=Number(s.value);v.textContent=(n>0?'+':n<0?'\\u2212':'')+Math.abs(n).toFixed(1)+'%';});
        b.addEventListener('click',function(){ if(busy)return; var pct=Number(s.value); var reason=(r.value||'').trim();
          if(pct!==0&&!reason){o.textContent='a non-zero override needs its reason';return;}
          busy=true;b.disabled=true;
          fetch('/api/forecast-override',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pct:pct,reason:reason})})
            .then(function(x){return x.json();}).then(function(j){ if(j&&j.ok){(window.__lcReload||function(){location.reload();})();} else {o.textContent=(j&&j.error)||'save failed';busy=false;b.disabled=false;} })
            .catch(function(){o.textContent='network error';busy=false;b.disabled=false;});
        });})();</script>`;

      return `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="rv2-caption">projection basis: day-net canon v_sales_day_all, API-ledger-complete months only (revenue-of-record ruling 2026-08-10) · YTD facts: the same canon (v_sales_day_all / v_sales_month, premises current) · override: forecast_overrides journal.</div>
        <div class="monthly-layout">${columnsPanel}${enginePanel}</div>
        ${planPanel}${govPanel}${script}`;
    };

    // ============================ REVENUE DRIVERS (P2) ============================
    const renderDrivers = () => {
      const dv = m.drivers || {};
      const att = dv.attach || {};
      const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const HOURS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

      // ---- KPI strip: 6 tiles on the 28d per-receipt window ----
      const revHr = dv.revHour && dv.revHour.hours > 0 ? Math.round(dv.revHour.net / dv.revHour.hours) : null;
      const splh = dv.splh ? Math.round(dv.splh.net / (dv.splh.mins / 60)) : null;
      const attachKpi = (label, a, basisSub) => {
        if (!dv.apiMax) return S.rcc.kpi({ label, value: '—', sub: 'needs the per-receipt line grain' });
        if (a && a.unmapped) return S.rcc.kpi({ label, value: '—', sub: 'no matching class in the dict (acct_groups_api) — a name-guess would be fabrication' });
        if (!a) return S.rcc.kpi({ label, value: '—', sub: 'no sale receipts in the window' });
        return S.rcc.kpi({
          label, value: `${(a.cur * 100).toFixed(1)}%`,
          delta: a.prior != null ? { dir: a.cur >= a.prior ? 'up' : 'down', text: `${a.cur >= a.prior ? '▲' : '▼'} ${Math.abs((a.cur - a.prior) * 100).toFixed(1)} pp ` } : null,
          sub: `${a.prior != null ? 'vs prior 28d' : 'first 28d window on record'} · ${basisSub}`,
        });
      };
      const kpis = [
        S.rcc.kpi({
          label: 'Revenue / trading hour', value: revHr != null ? gbp0(revHr) : '—',
          sub: revHr != null ? `net ÷ ${int(dv.revHour.hours)} observed (day, hour) buckets · ONLINE excluded` : 'no timed per-receipt lines yet',
        }),
        S.rcc.kpi({
          label: 'Sales / labour hour', value: splh != null ? gbp(splh) : '—',
          sub: splh != null ? `cross-ruler intersection days only · ${int(dv.splh.days)} day(s) · net ÷ worked hours` : 'no day holds both sales and labour in the window',
        }),
        S.rcc.kpi({
          label: 'Peak revenue hour', value: dv.peak ? `${pad2(dv.peak.hour)}:00 ${gbp0(dv.peak.net)}` : '—',
          sub: dv.peak ? 'top London hour by 28d line-grain net · ONLINE excluded' : 'no timed per-receipt lines yet',
        }),
        // Covers / transaction: LIVE (OpenTable covers ÷ Lightspeed transactions) — a SANITY metric,
        // not a KPI. POS guest-count is still not covers (canon).
        // A RULER THAT CAN ACTUALLY FAIL (2026-08-19, data-wiring audit). This tile declared the
        // band "~1.9–2.0" and then rendered whatever number came out, in plain type, with no state
        // — so it sat outside its own band for the whole covers-collapse window and said nothing.
        // A stated tolerance that is never evaluated is decoration; the reader assumes a number
        // shown without alarm is a number inside the band. Now it judges itself.
        (() => {
          const v = dv.cpt ? dv.cpt.covers / dv.cpt.txn : null;
          const out = v != null && (v < CPT_BAND[0] || v > CPT_BAND[1]);
          return S.rcc.kpi({
            label: 'Covers / transaction', value: v != null ? v.toFixed(2) : '—',
            delta: out ? { dir: 'down', text: 'OUT OF BAND ' } : null,
            sub: v == null ? 'no covers in the window (OpenTable)'
              : `${out ? `OUTSIDE the ${CPT_BAND[0]}–${CPT_BAND[1]} sanity band — treat as a DATA finding, not a KPI move`
                : `inside the ${CPT_BAND[0]}–${CPT_BAND[1]} sanity band`} · OpenTable covers ÷ txns over the ${int(dv.cpt.days)} day(s) holding BOTH (${esc(dv.cpt.from)}→${esc(dv.cpt.to)})`,
          });
        })(),
        attachKpi('Drink attachment', att.drink, 'receipts with ≥1 drink-class line'),
        attachKpi('Side attachment', att.side, 'sides = FRYER-station classes'),
      ].join('');
      const dictBits = [];
      if (att.drink && att.drink.names) dictBits.push(`drink classes: ${att.drink.names.join(' + ')}`);
      if (att.side && att.side.names) dictBits.push(`sides = FRYER-station classes: ${att.side.names.join(' + ')}`);
      const kpiCaption = dv.apiMax
        ? `<div class="rv2-caption">28d to ${esc(dv.apiMax)} (per-receipt max) · line grain (sales_receipt_lines_api) · hour KPIs on LOCAL London hour, ONLINE ORDER excluded (no true hour)${dictBits.length ? ` · ${esc(dictBits.join(' · '))}` : ''} · SPLH: cross-ruler intersection days only (sales_day ∩ labour_day)</div>`
        : `<div class="rv2-caption">No per-receipt API record yet — the K-Series daily ingest fills the line grain; the hour, attachment and SPLH KPIs light up with it.</div>`;

      // ---- hourly heatmap: Mon–Sun × 11:00–21:00, levels by quantile of trading cells ----
      let heatBody;
      if (dv.heat) {
        const vals = Object.values(dv.heat.cells).sort((a, b) => a - b);
        const level = (v) => Math.max(1, Math.ceil((vals.filter((x) => x <= v).length / vals.length) * 6));
        const head = '<div></div>' + HOURS.map((h) => `<div class="r-hlabel">${h}</div>`).join('');
        const grid = DOWS.map((nm, di) => `<div class="r-hday">${nm}</div>` + HOURS.map((h) => {
          const v = dv.heat.cells[`${di}-${h}`];
          return v ? S.rcc.heatCell(level(v), `${nm} ${pad2(h)}:00 — ${gbp(v)}`) : S.rcc.heatCell(null);
        }).join('')).join('');
        const onlineNote = dv.heat.onlineExcluded > 0
          ? `${gbp(dv.heat.onlineExcluded)} ONLINE excluded — no true hour (the online-order ruling)`
          : 'ONLINE ORDER lines excluded — no true hour (the online-order ruling)';
        // hours outside the 11–21 grid with MATERIAL net (>2% of the window) get an honest
        // note rather than silent omission; they always count in the KPI strip above
        const outsideNote = dv.heat.outside > dv.heat.total * 0.02
          ? ` · ${gbp(dv.heat.outside)} traded outside the 11:00–21:00 grid — not drawn here, counted in every KPI` : '';
        heatBody = `<div class="r-heatmap">${head}${grid}</div>
          <div class="r-mini-note">shade = revenue density (levels by quantile of trading cells; blank cell = no record) · ${esc(onlineNote)} · line grain, 28d to ${esc(dv.apiMax)}${esc(outsideNote)}</div>`;
      } else {
        heatBody = S.rcc.emptyState({ title: 'Hourly revenue heatmap', blocker: 'No timed per-receipt lines in the window — hour truth comes from time_of_sale_ms only, never an even spread.', unlock: 'the K-Series daily API ingest (line grain)' });
      }
      const heatPanel = S.rcc.panel({ title: 'Hourly revenue heatmap', sub: 'net revenue density by day and hour · last 28 days · ex-VAT', body: heatBody });

      // ---- capacity and demand conversion: the DESIGNED not-wired state — the mock's column
      // headers render (headers only, zero data rows, zero digits) until OpenTable lands ----
      const capacityPanel = S.rcc.panel({
        title: 'Capacity and demand conversion', sub: 'revenue opportunity by trading window',
        body: `<table><thead><tr><th>Window</th><th class="r-num">Seat use</th><th class="r-num">RevPASH</th><th class="r-num">Wait / lost</th><th>Decision</th></tr></thead></table>`
          + S.rcc.emptyState({ title: 'Capacity and demand conversion', blocker: 'covers, seat-use and wait-lost land with the OpenTable email wire — POS guest-count is never covers.', unlock: 'the OpenTable email export' }),
      });

      // ---- daily trading scorecard: last 14 recorded days, one row per RECORDED day ----
      let scoreBody;
      if (dv.score && dv.score.rows.length) {
        const rowsHtml = dv.score.rows.map((r) => {
          const dow = DOWS[(new Date(`${r.date}T12:00:00Z`).getUTCDay() + 6) % 7];
          let yoy;
          if (!r.twin || r.twin.net == null) yoy = `<span class="rp-yoy-na" title="no LY record (−364d twin)">—</span>`;
          else if (r.twin.premises !== 'current') yoy = `<span class="rp-yoy-na" title="premises break — no raw YoY">—</span>`;
          else if (!(r.twin.net > 0)) yoy = `<span class="rp-yoy-na" title="LY twin closed (zero net) — no %">—</span>`;
          else {
            const p = (r.net / r.twin.net - 1) * 100;
            yoy = `<span class="${p >= 0 ? 'rp-yoy-up' : 'rp-yoy-down'}">${esc(pctStr(p))}</span>`;
          }
          const hrs = r.lab && r.lab.am != null ? r.lab.am / 60 : null;
          const daySplh = hrs > 0 && r.net > 0 ? Math.round(r.net / hrs) : null;
          const discPct = r.disc != null && r.net > 0 ? (r.disc / r.net) * 100 : null;
          let chip;
          if (!r.lab || r.lab.ac == null) chip = S.rcc.tag('no labour');
          else {
            const budget = (r.lab.sal || 0) + Math.round(LABOUR_VAR_RATE * r.net);
            const delta = r.lab.ac - budget;
            chip = delta > LABOUR_MATERIALITY_PENCE ? S.rcc.tag(`Over ${gbp(delta)}`, 'bad')
              : delta <= 0 ? S.rcc.tag('Under formula', 'good')
                : S.rcc.tag('On formula', 'good');
          }
          return `<tr><td>${esc(dow)} ${esc(r.date)}</td><td class="r-num mono">${gbp(r.net)}</td><td class="r-num mono">${yoy}</td>
            <td class="r-num mono${r.covers != null ? '' : ' ash'}">${r.covers != null ? int(r.covers) : '—'}</td><td class="r-num mono${r.covers ? '' : ' ash'}">${r.covers ? gbp(Math.round(r.net / r.covers)) : '—'}</td>
            <td class="r-num mono">${hrs != null ? `${hrs.toFixed(1)}h` : '—'}</td>
            <td class="r-num mono">${daySplh != null ? gbp(daySplh) : '—'}</td>
            <td class="r-num mono">${discPct != null ? `${discPct.toFixed(1)}%` : '—'}</td>
            <td>${chip}</td></tr>`;
        }).join('');
        scoreBody = `<div style="overflow:auto"><table><thead><tr><th>Day</th><th class="r-num">Net revenue</th><th class="r-num">YoY</th><th class="r-num">Covers</th><th class="r-num">Spend / cover</th><th class="r-num">Labour hrs</th><th class="r-num">Sales / labour hr</th><th class="r-num">Discount %</th><th>Status</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
          <div class="r-mini-note">last 14 recorded days to ${esc(dv.score.to)} — a missing sales day is an ABSENT row, never zeros · net/discounts: sales_day (day grain) · YoY: v_sales_day_all −364d weekday twin, premises-guarded · covers: OpenTable covers_day (blank day = no cover record); spend/cover = net ÷ covers · labour hrs: labour_day worked minutes; day SPLH = net ÷ worked hours · STATUS: TRUE labour (actual_cost_pence, burdened) vs the banded formula budget = salaried + 22.4% × net (K 14.3% + F 8.1% combined — banded formula, rota-review spec); OVER only beyond the ruled £45 materiality.</div>`;
      } else {
        scoreBody = S.rcc.emptyState({ title: 'Daily trading scorecard', blocker: 'No day-grain sales record in the trailing 14 days.', unlock: 'the daily Lightspeed ingest' });
      }
      const scorePanel = S.rcc.panel({
        title: 'Daily trading scorecard', sub: 'volume, spend and operational efficiency per trading day',
        body: scoreBody,
      });

      // ---- SITTINGS panel: the honest QR-vs-served unit (net per party, not per order) + per-cover.
      // A per-order ATV under-counts QR because QR fragments a party into many small receipts. ----
      const sit = dv.sit;
      const perSit = (x) => (x && x.sittings > 0 ? gbp(Math.round(x.net / x.sittings)) : '—');
      const chOf = (k) => (sit && sit.by[k] && sit.by[k].sittings > 0 ? sit.by[k] : null);
      const qrSit = chOf('QR'), servedSit = chOf('served'), mixedSit = chOf('mixed');
      // The per-party figures only stand if enough of each channel maps to the three-part sitting
      // population (SITTING_MIN_CAPTURE). When it does not, the value is WITHHELD rather than shown
      // with a caveat underneath — a number on a KPI tile gets read, whatever the small print says.
      const sitV = sit && sit.verdict ? sit.verdict : null;
      const capBlocked = !!(sit && sitV && !sitV.ok);
      const sittingFieldsMissing = !!(sit && sit.captionState
        && (!sit.captionState.population.supported || !sit.captionState.capture.supported));
      const capPct = (x) => (typeof x === 'number' ? `${Math.round(x * 100)}%` : '—');
      const sitTiles = [
        S.rcc.kpi({
          label: 'Net / QR sitting', value: capBlocked ? '—' : perSit(qrSit),
          sub: capBlocked
            ? (sittingFieldsMissing ? `withheld — ${sitV.reason}` : `withheld — only ${capPct(sit.capture && sit.capture.QR)} of QR net maps to a numbered table cluster, standalone Order N tab or QR channel slot`)
            : (qrSit ? `${int(qrSit.sittings)} QR sittings · ${(qrSit.rcpts / qrSit.sittings).toFixed(2)} receipts/sitting`
              : (sit ? 'no QR sittings in the window' : 'no sittings yet — run: lightspeed-api -- sittings-backfill')),
        }),
        S.rcc.kpi({
          label: 'Net / served sitting', value: capBlocked ? '—' : perSit(servedSit),
          sub: capBlocked
            ? (sittingFieldsMissing ? `withheld — ${sitV.reason}` : `withheld — only ${capPct(sit.capture && sit.capture.served)} of served net maps to a numbered table cluster, standalone Order N tab or QR channel slot`)
            : (servedSit ? `${int(servedSit.sittings)} served sittings (EAT IN + MON-FRI DEAL)`
              : (sit ? 'no served sittings in the window' : 'dine_in_sittings not populated')),
        }),
        S.rcc.kpi({
          label: 'Net / cover (overall)', value: (sit && sit.covers && sit.dineNet != null ? gbp(Math.round(sit.dineNet / sit.covers)) : '—'),
          sub: (sit && sit.covers && sit.dineNet != null) ? `full dine-in net ÷ ${int(sit.covers)} OpenTable covers, both over the ${int(sit.coversDays)} day(s) holding covers (${esc(sit.coversFrom)}→${esc(sit.coversTo)}) · sanity cross-check · not channel-split (POS guest-count is never covers)`
            : 'no covers in the window (OpenTable)',
        }),
      ].join('');
      const mixNote = mixedSit ? ` MIXED (both channels in one sitting): ${int(mixedSit.sittings)} (${(mixedSit.sittings / sit.totSit * 100).toFixed(1)}% — immaterial, hybrid ordering).` : '';
      const labelCap = sit && sit.captureByLabel
        ? Object.entries(sit.captureByLabel).map(([k, v]) => `${esc(k)} ${capPct(v)}`).join(' · ') : '';
      const capLine = sit && sit.capture
        ? `<div class="rv2-caption"><strong>Capture:</strong> ${esc(sit.captionState ? sit.captionState.captureCaption : (labelCap ? `${labelCap} of each channel's net.` : 'capture could not be measured.'))}${capBlocked ? ` <strong>The per-party comparison is withheld:</strong> ${esc(sitV.reason)}. It becomes readable when current-window receipts carry the required net and channel fields and either tables are assigned on the POS or the standalone Order N identifier is retained.` : ''}</div>`
        : '';
      const sitCaption = sit
        ? capLine + `<div class="rv2-caption">${esc(sit.captionState ? sit.captionState.populationCaption : `${int(sit.totSit)} current-window sittings.`)} Sittings 28d to ${esc(sit.to)} · population = table-cluster receipt groups + standalone served order-tab sittings + STOREKIT channel-slot sessions on one (business_date, raw table_name), with each channel slot spanning the business day; derived from dine_in_sittings rows in this window (20-min table clustering, ex-VAT). Per-cover is OVERALL: OpenTable covers are day-total + channel-agnostic, so it is not split by channel.${mixNote}</div>`
        : `<div class="rv2-caption">dine_in_sittings not populated yet — after the derivation deploys, run <code>npm run lightspeed-api -- sittings-backfill</code> (ongoing days fill at ingest); until then this gates honestly.</div>`;
      const sitPanel = S.rcc.panel({
        title: 'Sittings — net per party by channel',
        sub: 'the honest QR-vs-served unit: net per sitting (party), not per order',
        body: `<div class="r-grid r-kpi-grid">${sitTiles}</div>${sitCaption}`,
      });

      return `<div class="r-grid r-kpi-grid">${kpis}</div>${kpiCaption}
        ${sitPanel}
        <div class="r-grid r-two-col">${heatPanel}${capacityPanel}</div>
        ${scorePanel}`;
    };

    // ============================ RECONCILIATION (P3) ============================
    const renderReconciliation = () => {
      const rc = m.recon || {};
      const t = rc.tenders;

      // ---- KPI strip: 6 tiles on the 28d per-receipt window. Fees + the not-computable
      // variance are ZERO-DIGIT states — no number exists, so none renders. ----
      const kpis = [
        S.rcc.kpi({
          label: 'Expected tenders', value: t ? gbp(t.amt) : '—',
          sub: t ? `gross basis (inc VAT) · ${int(t.txn)} payment(s) · sales_payments_api` : 'no per-receipt payment record in the window',
        }),
        rc.bank
          ? S.rcc.kpi({
            label: 'Processed / banked', value: gbp(rc.bank.pence),
            sub: `QB POSTED deposits — unmatched to tenders (match build pending) · ${int(rc.bank.n)} deposit(s)`,
          })
          : S.rcc.kpi({ label: 'Processed / banked', value: 'not wired', sub: 'unlock: the QuickBooks statement wire — POSTED deposits (qb_bank_txns)' }),
        (t && rc.bank)
          ? S.rcc.kpi({
            label: 'Gross variance', value: signedGbp(t.amt - rc.bank.pence),
            sub: 'tenders − POSTED deposits · sides UNMATCHED — payout timing + non-sales deposits included until the match build',
          })
          : S.rcc.kpi({ label: 'Gross variance', value: 'not computable', sub: 'needs both sides real — tenders and banked deposits' }),
        S.rcc.kpi({ label: 'Processor fees', value: 'no source', sub: 'no fee field in the POS record — statement/QB fact' }),
        S.rcc.kpi({
          label: 'Refunds · 28d', value: rc.refunds ? gbp(rc.refunds.pence) : '—',
          sub: rc.refunds
            ? `sales_day day grain · ${int(rc.refunds.days)} recorded day(s)${rc.refunds.receipts > 0 ? ` · ${int(rc.refunds.receipts)} REFUND receipt(s)` : ''}`
            : 'no day-grain record in the window',
        }),
        S.rcc.kpi({
          label: 'Unresolved exceptions', value: rc.exceptions ? String(rc.exceptions.fails) : '—',
          sub: rc.exceptions
            ? `battery fails · ${int(rc.exceptions.days)} recorded day(s) · day_gross documented class excluded`
            : 'the recon batteries have not recorded this window',
        }),
      ].join('');
      const kpiCaption = rc.apiMax
        ? `<div class="rv2-caption">28d to ${esc(rc.apiMax)} (per-receipt max) · tenders: sales_payments_api, gross basis (net_with_tax_pence, inc VAT) · methods named by the payment_methods_api dict · bank: qb_bank_txns POSTED deposits (QB Phase-0 — "For Review" is never exposed) · exceptions: sales_reconciliation batteries</div>`
        : `<div class="rv2-caption">No per-receipt payment record yet — the K-Series daily ingest fills sales_payments_api; the tender KPIs, ledger and bridge light up with it.</div>`;

      // ---- tender-to-bank table: one row per METHOD; the bank side is the POSTED-deposit
      // aggregate, UNMATCHED (no tender↔deposit matching algorithm exists — future build) ----
      let tenderBody;
      if (t) {
        const rowsHtml = t.rows.map((r) =>
          `<tr><td>${esc(r.name)}</td><td class="r-num mono">${gbp(r.amt)}</td><td class="r-num mono">${int(r.txn)}</td><td class="r-num mono">${gbp(r.tips)}</td><td class="r-num mono">${gbp(r.sur)}</td><td class="r-num mono ash">—</td><td>${S.rcc.tag('Recorded')}</td></tr>`).join('');
        const bankRow = rc.bank
          ? `<tr><td>QB POSTED deposits <span class="ash">(bank side)</span></td><td class="r-num mono ash">—</td><td class="r-num mono">${int(rc.bank.n)}</td><td class="r-num mono ash">—</td><td class="r-num mono ash">—</td><td class="r-num mono">${gbp(rc.bank.pence)}</td><td><span title="POSTED deposits in the window — no tender↔deposit match yet (the match build is future work)">${S.rcc.tag('Unmatched', 'info')}</span></td></tr>`
          : '';
        tenderBody = `<div style="overflow:auto"><table><thead><tr><th>Method</th><th class="r-num">Tendered · 28d</th><th class="r-num">Txns</th><th class="r-num">Tips</th><th class="r-num">Surcharge</th><th class="r-num">Bank</th><th>Status</th></tr></thead><tbody>${rowsHtml}${bankRow}</tbody></table></div>
          <div class="recon-total"><span>Total</span><span class="mono">${gbp(t.amt)} tendered${rc.bank ? ` · ${gbp(rc.bank.pence)} banked · variance ${signedGbp(t.amt - rc.bank.pence)} (unmatched)` : ''}</span></div>`
          + (rc.bank ? '' : S.rcc.emptyState({ title: 'Bank side', blocker: 'No POSTED deposits recorded in the window — the bank column stays empty rather than guessing.', unlock: 'the QuickBooks statement wire (qb_bank_txns POSTED deposits)' }))
          + `<div class="r-mini-note">gross basis (net_with_tax_pence, inc VAT) · method names: payment_methods_api dict · ${rc.bank ? 'bank = QB POSTED deposits by date, UNMATCHED to tenders — the tender↔deposit matching algorithm is the future build' : 'tips/surcharge are the POS record’s own fields'}.</div>`;
      } else {
        tenderBody = S.rcc.emptyState({ title: 'Tender-to-bank reconciliation', blocker: 'No per-receipt payment record in the window.', unlock: 'the K-Series daily API ingest (sales_payments_api)' });
      }
      const tenderPanel = S.rcc.panel({
        title: 'Tender-to-bank reconciliation', sub: 'POS tenders by method · bank = QB POSTED deposits · match build pending',
        body: tenderBody,
      });

      // ---- control formulas: the canonical rulings VERBATIM — text, no computation ----
      const formulaPanel = S.rcc.panel({
        title: 'Control formulas', sub: 'the rulings the batteries enforce',
        body: S.rcc.formula([
          'day net revenue-of-record = v_sales_day_all (day-net canon, ruled 2026-08-10); the battery cross-checks it against SUM(net_without_tax_pence) over non-cancelled SALE receipts',
          'ATV = net ÷ receipts · ex-VAT · per-receipt record basis',
          'QR = STOREKIT ORDER & PAY · sitting = table/QR-slot per day, split bills grouped; per-order ATV understates QR spend (fragmentation ruling 2026-07-31)',
          'gross = net + VAT; day_gross deltas vs the scraper eras = DOCUMENTED VAT-basis class (ruled 2026-07-20)',
          'covers ≠ POS guest count (OpenTable only)',
          'single-writer: values live in the DB; docs carry pointers',
        ]),
      });

      // ---- gross-to-net bridge: the mock's waterfall grammar; bars scaled to gross ----
      let bridgeBody;
      if (rc.bridge) {
        const b = rc.bridge;
        const H = 175; // the mock's tallest bar
        const barH = (v) => Math.max(1, Math.round((Math.abs(v) / b.gross) * H));
        const col = (label, v, cls, val) =>
          `<div class="wf-col${cls ? ' ' + cls : ''}"><div class="wf-bar" style="height:${barH(v)}px"><div class="wf-val">${esc(val)}</div></div><div class="wf-lab">${esc(label)}</div></div>`;
        bridgeBody = `<div class="waterfall">
            ${col('Gross sales inc VAT', b.gross, '', gbp(b.gross))}
            ${col('Discounts', b.disc, 'neg', `−${gbp(b.disc)}`)}
            ${col('Comps', b.comps, 'neg', `−${gbp(b.comps)}`)}
            ${col('Refunds', b.refunds, 'neg', `−${gbp(b.refunds)}`)}
            ${col('Voids', b.voids, 'neg', `−${gbp(b.voids)}`)}
            ${col('Service charges', b.svc, '', `+${gbp(b.svc)}`)}
            ${col('Net revenue ex VAT', b.net, 'total', gbp(b.net))}
          </div>
          <div class="r-mini-note">28d to ${esc(rc.apiMax)} · ${int(b.days)} recorded day(s) · sales_day · VAT in window ${gbp(b.vat)} (net + VAT = the gross basis — the documented day_gross class) · per-receipt discount attribution not populated by the wire; day grain (verified against known-discount days).</div>`;
      } else {
        bridgeBody = S.rcc.emptyState({ title: 'Gross-to-net bridge', blocker: 'No day-grain sales record in the window.', unlock: 'the daily Lightspeed ingest (sales_day)' });
      }
      const bridgePanel = S.rcc.panel({ title: 'Gross-to-net revenue bridge', sub: 'day grain · gross → leakage → net ex-VAT · last 28 days', body: bridgeBody });

      // ---- exception ledger: every battery failure in-window, one row per (date, check);
      // day_gross renders CLASSED (Documented), never as an open exception ----
      let ledgerBody;
      if (!rc.exceptions) {
        ledgerBody = S.rcc.emptyState({ title: 'Exception ledger', blocker: 'The recon batteries have not recorded this window yet.', unlock: 'the daily reconcile run (sales_reconciliation)' });
      } else if (!rc.ledger.length) {
        ledgerBody = `${S.rcc.pill('no exceptions in the window — batteries green', true)}
          <div class="r-mini-note">${int(rc.exceptions.days)} recorded day(s) of battery checks, all passed.</div>`;
      } else {
        const rowsHtml = rc.ledger.map((r) => {
          const chip = r.check === 'day_gross'
            ? `<span title="VAT/gross-basis class, ruled 2026-07-20">${S.rcc.tag('Documented', 'info')}</span>`
            : S.rcc.tag('Open', 'warn');
          return `<tr><td class="mono">${esc(r.date)}</td><td class="mono"${r.finding ? ` title="${esc(r.finding)}"` : ''}>${esc(r.check)}</td><td class="r-num mono">${r.delta != null ? signedGbp(r.delta) : '—'}</td><td>box</td><td>${chip}</td></tr>`;
        }).join('');
        ledgerBody = `<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Check</th><th class="r-num">Delta</th><th>Owner</th><th>Status</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
          <div class="r-mini-note">one row per (date, check) · sales_reconciliation batteries, last 28d · day_gross = the documented VAT/gross-basis class (ruled 2026-07-20), never an open exception · owner ‘box’ = the battery raised it — owner/assignment lands with the workflow build.</div>`;
      }
      const ledgerPanel = S.rcc.panel({
        title: 'Exception ledger', sub: 'every battery failure in the window, classed',
        headRight: rc.exceptions && rc.exceptions.fails > 0 ? S.rcc.tag(`${rc.exceptions.fails} open`, 'warn') : '',
        body: ledgerBody,
      });

      // OpenTable £/cover cross-check (Phase 2 PR2b): OpenTable's POS-integrated revenue vs Lightspeed
      // net over the same window. Lightspeed stays canon — this reconciles the two sources.
      const cvk = rc.coverCheck;
      const coverCheckPanel = cvk
        ? S.rcc.panel({
            title: 'OpenTable £/cover cross-check', sub: `OpenTable POS revenue vs Lightspeed net · ${esc(cvk.dateLabel)}`,
            headRight: S.rcc.tag('cross-check', 'info'),
            body: `<div class="r-driver-grid">
                ${S.rcc.driver({ label: 'OpenTable £/cover (net)', value: gbp(Math.round(cvk.otNet / cvk.covers)), sub: 'revenue_net ÷ revenue_covers · ex-VAT' })}
                ${S.rcc.driver({ label: 'OpenTable net · window', value: gbp0(cvk.otNet), sub: `${int(cvk.covers)} covers with a POS match` })}
                ${S.rcc.driver({ label: 'Lightspeed net · window', value: gbp0(cvk.lsNet), sub: 'all channels · v_sales_day_all' })}
                ${S.rcc.driver({ label: 'OpenTable ÷ Lightspeed', value: cvk.lsNet ? `${((100 * cvk.otNet) / cvk.lsNet).toFixed(1)}%` : '—', sub: 'dine-in matched share of all-channel net' })}
              </div>
              <div class="r-mini-note">${esc(cvk.caption)} OpenTable surfaces the SAME Lightspeed POS £ per booking — Lightspeed stays the canon (v_sales_day_all); this is a CROSS-CHECK, not a correction. OpenTable revenue is dine-in seated with a POS match only (${cvk.seated ? `${Math.round((100 * cvk.covers) / cvk.seated)}% of seated covers` : 'a subset'}), so OT ÷ LS sits BELOW 100% by design — a material swing is a reconciliation finding.</div>`,
          })
        : (() => {
            const blocker = `no OpenTable POS revenue in the window's verified intersection. ${rc.coverCheckGate ? rc.coverCheckGate.caption : 'No valid requested × eligible trading date × covers_day revenue intersection exists.'}`;
            const unlock = rc.coverCheckGate && rc.coverCheckGate.missingDates.length
              ? `add covers_day revenue_covers and revenue_net_pence for ${rc.coverCheckGate.missingDates.join(', ')} to clear the gate`
              : 'select a window containing an eligible trading date with covers_day revenue coverage';
            return S.rcc.panel({
              title: 'OpenTable £/cover cross-check', sub: 'OpenTable POS revenue vs Lightspeed net',
              body: `<div class="r-empty"><b>OpenTable £/cover cross-check withheld</b><br>${esc(blocker)}<div class="r-unlock">Coverage needed: ${esc(unlock)}</div></div>`,
            });
          })();

      return `<div class="r-grid r-kpi-grid">${kpis}</div>${kpiCaption}
        <div class="r-grid recon-grid">${tenderPanel}${formulaPanel}</div>
        <div class="r-grid r-two-col">${bridgePanel}${ledgerPanel}</div>
        ${coverCheckPanel}`;
    };

    // ============================ QUICKBOOKS SALES ENTRY ============================
    const renderQuickBooksSales = () => {
      const qb = m.qbsales || calculateQuickBooksSales({ month: latestCompleteMonth(m.now) });
      const warnings = [];
      if (qb.missingDates.length) {
        warnings.push(`Expected sales dates absent from the completed daily K-Series ingest (${qb.missingDates.length}): ${qb.missingDates.join(', ')}. This calendar month is partial.`);
      }
      if (qb.unmapped.count) {
        warnings.push(`${plural(qb.unmapped.count, 'receipt lacks', 'receipts lack')} a channel mapping, gross value ${gbp(qb.unmapped.valuePence)}. On the settlement basis their card and cash payments are still counted; only the till comparison below is affected.`);
      }
      if (qb.feeMissing.length) {
        warnings.push(`QuickBooks sales receipt incomplete — missing ${qb.feeMissing.join(', ')}. Rows that depend on a missing input stay gross and say so in their derivation; Over/Short stays 0.00 because no row balances through it.`);
      }
      if (!qb.vatBaseExact) {
        warnings.push(`VAT-base precision warning — (row 1 + row 6) / 1.2 does not resolve to an integer penny; ${gbp(qb.vatBasePence)} is display rounding only and no QuickBooks row was altered.`);
      }
      if (!warnings.length) warnings.push('Complete — every expected date is present, both fees and the online refunds are entered, and the VAT base resolves to the penny.');
      const warningHtml = `<div class="qb-warnings">${warnings.map((warning) => `<div class="qb-warning${qb.complete ? ' qb-ok' : ''}">${esc(warning)}</div>`).join('')}</div>`;
      const monthPicker = `<form class="qb-month" method="get" action="/coyote/revenue">
          <input type="hidden" name="tab" value="qbsales">
          <label for="qb-month">Calendar month</label>
          <input id="qb-month" name="month" type="month" value="${esc(qb.month)}" onchange="this.form.submit()">
        </form>`;
      const stateTag = qb.complete ? S.rcc.tag('COMPLETE', 'good') : S.rcc.tag('INCOMPLETE', 'warn');
      const feeControl = (row) => `<div class="qb-fee-entry">
          <input class="qb-fee-value" type="number" step="1" inputmode="numeric" data-qb-line="${row.key}" value="${row.entered ? row.amountPence : ''}" placeholder="signed pence" aria-label="${esc(row.label)} signed pence">
          <button class="qb-fee-save" type="button" data-qb-line="${row.key}">Save signed pence</button>
          <span class="qb-fee-out r-mini-note" data-qb-line="${row.key}"></span>
        </div>`;
      const refundsEntered = qb.blocks && qb.blocks.online && Number.isSafeInteger(qb.blocks.online.refundsPence);
      const refundsControl = () => `<div class="qb-fee-entry">
          <span class="r-mini-note">Online refunds this month (signed pence, ≤ 0) — from the LivePepper/Stripe export until the settlement ingest carries them</span>
          <input class="qb-fee-value" type="number" step="1" inputmode="numeric" data-qb-line="online_refunds" value="${refundsEntered ? qb.blocks.online.refundsPence : ''}" placeholder="signed pence" aria-label="Online refunds signed pence">
          <button class="qb-fee-save" type="button" data-qb-line="online_refunds">Save signed pence</button>
          <span class="qb-fee-out r-mini-note" data-qb-line="online_refunds"></span>
        </div>`;
      const tableRows = qb.rows.map((row) => {
        const feeBlank = (row.key === 'pos_fee' || row.key === 'online_fee') && !row.entered;
        const amount = feeBlank ? '—' : gbp(Math.abs(row.amountPence));
        const sign = feeBlank ? '—' : (row.amountPence < 0 ? '−' : (row.amountPence > 0 ? '+' : '0'));
        const feeNote = feeBlank
          ? '<div class="r-mini-note">Operator input required — from the card processor statement; not held on this box.</div>'
          : '';
        const label = row.key === 'over_short'
          ? `<div class="qb-balance"><span>${esc(row.label)}</span>${S.rcc.tag(`0.00 by construction · rows 1–11 sum ${gbp(qb.subtotalPence)}`, qb.subtotalPence === 0 ? 'good' : 'bad')}</div>`
          : esc(row.label);
        return `<tr data-qb-line="${row.line}">
            <td class="qb-line">${row.line}. ${label}</td>
            <td class="r-num mono">${sign}</td>
            <td class="r-num mono">${amount}${feeNote}${row.key === 'pos_fee' || row.key === 'online_fee' ? feeControl(row) : ''}${row.key === 'online_card_payments' ? refundsControl() : ''}</td>
            <td>${esc(row.vatTreatment)}</td>
            <td class="qb-derivation">${esc(row.derivation)}${row.feeWarning ? `<div class="qb-fee-warning" role="note"><strong>Fee plausibility warning</strong> — ${esc(row.feeWarning)}</div>` : ''}</td>
            <td class="qb-source">${esc(row.sourceGrain)}</td>
            <td class="qb-window mono">${esc(row.window)}</td>
          </tr>`;
      }).join('');
      const bundle = S.rcc.panel({
        title: `QuickBooks sales receipt · ${monthLabel(qb.month)}`,
        sub: 'twelve lines · integer pence · settlement basis — each processor block nets to zero',
        headRight: stateTag,
        body: `${warningHtml}<div class="qb-diagnostic"><strong>Sources</strong> — ${esc(qb.sourceCaption)}</div><div style="overflow:auto"><table class="qb-table"><thead><tr><th>QuickBooks line</th><th class="r-num">Sign</th><th class="r-num">Amount</th><th>VAT treatment</th><th>Plain-English derivation</th><th>Source</th><th>Exact date window</th></tr></thead><tbody>${tableRows}</tbody></table></div>
          <div class="qb-diagnostic"><strong>Till comparison (diagnostic only — feeds no row)</strong> — till in-house sales on Lightspeed's basis (SALE+SPLIT+VOID+RECALL+TRANSITORY, in-house channels incl. Take-Away) ${gbp(qb.tillComparison.tillSalesPence)} · settlement-basis row 1 ${gbp(qb.tillComparison.settlementSalesPence)} · difference ${qb.tillComparison.differencePence < 0 ? '−' : ''}${gbp(Math.abs(qb.tillComparison.differencePence))}. Gift cards redeemed but not sold this month, uncaptured "paid on reader" tickets, reader tips not keyed, and processor orders that never reached the till all live in this difference.</div>
          <div class="qb-diagnostic"><strong>Unmapped receipts diagnostic</strong> — ${plural(qb.unmapped.count, 'receipt', 'receipts')} · ${gbp(qb.unmapped.valuePence)} gross. Eligible SALE/SPLIT receipt identifiers with no channel_label are deduplicated, counted here and never assigned to an invented channel; their payments are still counted on the settlement basis.</div>`,
      });
      const checks = `<div class="r-grid r-two-col">
        ${S.rcc.panel({
          title: '20% VAT base', sub: '(row 1 + row 6) / 1.2 · diagnostic only',
          headRight: S.rcc.tag(qb.vatBaseExact ? 'PENNY EXACT' : 'DISPLAY ROUNDING', qb.vatBaseExact ? 'good' : 'warn'),
          body: `<div class="r-kpi-value mono">${gbp(qb.vatBasePence)}</div><div class="r-mini-note">(${gbp(qb.rows[0].amountPence)} + ${gbp(qb.rows[5].amountPence)}) / 1.2 = ${gbp(qb.vatBasePence)}${qb.vatBaseExact ? ' exactly' : ' after display rounding'}. This check never alters rows 1 or 6.</div>`,
        })}
        ${S.rcc.panel({
          title: 'Settlement basis', sub: 'operator ruling 2026-09-04 · the Power BI method',
          headRight: S.rcc.tag('BY CONSTRUCTION', 'info'),
          body: `<div class="qb-diagnostic"><strong>Each processor is a block that nets to zero.</strong> Lightspeed Payments: sales ${gbp(qb.blocks.lightspeed.salesPence)} = gross ${gbp(qb.blocks.lightspeed.grossPence)} − tips ${gbp(qb.blocks.lightspeed.tipPence)} [${esc(qb.blocks.lightspeed.source)}]. Storekit: sales ${gbp(qb.blocks.storekit.salesPence)} = gross ${gbp(qb.blocks.storekit.grossPence)} − tips ${gbp(qb.blocks.storekit.tipPence)} [${esc(qb.blocks.storekit.source)}]. Online: net sales ${gbp(qb.blocks.online.netSalesPence)} = gross ${gbp(qb.blocks.online.grossPence)} ${qb.blocks.online.refundsPence == null ? '(refunds unknown)' : `less refunds ${gbp(Math.abs(qb.blocks.online.refundsPence))}`} [${esc(qb.blocks.online.source)}]. Cash takings ${gbp(qb.blocks.cash.pence)} (till cash tips ${gbp(qb.blocks.cash.tipPence)} excluded). Gift cards: sold ${gbp(qb.blocks.gift.soldPence)}, redeemed ${gbp(qb.blocks.gift.redeemedPence)} — the liability account. VISA/MC never a processor: ${qb.blocks.neverCard.count} payment(s), ${gbp(qb.blocks.neverCard.pence)}, outside the receipt.</div>`,
        })}
      </div>`;
      const script = `<script>(function(){
        var busy=false;
        document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.qb-fee-save');if(!b||busy)return;
          var line=b.getAttribute('data-qb-line'),input=document.querySelector('.qb-fee-value[data-qb-line="'+line+'"]'),out=document.querySelector('.qb-fee-out[data-qb-line="'+line+'"]'),raw=input?input.value.trim():'';
          if(!/^-?\\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))){if(out)out.textContent='enter signed whole pence';return;}
          busy=true;b.disabled=true;
          fetch('/api/review-action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'set_qb_sales_fee',month:'${esc(qb.month)}',line:line,value_pence:Number(raw)})})
            .then(function(x){return x.json();}).then(function(j){if(j&&j.ok&&j.value_pence===Number(raw)){(window.__lcReload||function(){location.reload();})();}else{if(out)out.textContent=(j&&j.error)||'save failed';busy=false;b.disabled=false;}})
            .catch(function(){if(out)out.textContent='network error';busy=false;b.disabled=false;});
        });})();</script>`;
      return `<div class="qb-toolbar"><div><div class="r-panel-title">QuickBooks Sales Entry</div><div class="r-panel-sub">inclusive calendar month · latest completed month by default</div></div>${monthPicker}</div>${bundle}${checks}${script}`;
    };

    // ============================ MENU GROWTH (P5) ============================
    const renderMenu = () => {
      const mg = m.menu || {};
      const hasLines = !!(mg.products && mg.products.length);
      const portfolio = mg.portfolio || buildMenuPortfolio([], []);
      const hasRecipes = (num(mg.recipeLines) || 0) > 0;
      const hasContribution = portfolio.plottable.length > 0;
      const coverageCopy = `Contribution on ${portfolio.coveragePct.toFixed(1)}% of window net`;
      const contributionGbp = (pence) => pence < 0 ? `−${gbp(Math.abs(pence))}` : gbp(pence);
      const menuEmpty = (title, copy, link) => `<div class="r-empty"><b>${esc(title)}</b><br>${esc(copy)}${link ? `<div class="r-unlock"><a class="r-worklist-link" href="/coyote/recipes">${esc(link)} →</a></div>` : ''}</div>`;

      // ---- KPI strip (4): line-ledger facts plus the live recipe-backed risk and Dogs views ----
      const kpis = [
        S.rcc.kpi({
          label: 'Products selling', value: hasLines ? String(mg.products.length) : '—',
          sub: hasLines ? 'distinct till SKUs with positive 28-day net' : 'no item-level sales in the window',
        }),
        S.rcc.kpi({
          label: 'Weekly revenue at risk', value: hasRecipes && hasContribution ? gbp(portfolio.weeklyRiskPence) : '—',
          sub: hasRecipes && hasContribution
            ? `Dogs plus every item down vs the prior window, counted once · 28-day net ÷ 4 · ${coverageCopy}`
            : 'Add complete recipes for sold items to include Dogs without understating risk',
        }),
        S.rcc.kpi({
          label: 'Menu movers', value: hasLines ? String(mg.movers) : '—',
          sub: hasLines ? '|Δ net| ≥ 25% and ≥ £100 vs prior 28d — presentation cut, not a ruling' : 'no per-receipt line record yet',
        }),
        S.rcc.kpi({
          label: 'Dogs', value: hasRecipes && hasContribution ? String(portfolio.dogCount) : '—',
          sub: hasRecipes && hasContribution
            ? `${gbp(portfolio.dogNet)} combined current-window net · ${coverageCopy}`
            : 'Add complete recipes for sold items to classify the portfolio',
        }),
      ].join('');
      const kpiCaption = mg.apiMax
        ? `<div class="rv2-caption">28 days to ${esc(mg.apiMax)} vs the prior 28 days · till item lines consolidated by SKU, so renamed variants count once · the latest till name labels each item · SKUs without positive window net are excluded${hasRecipes ? ` · ${coverageCopy}` : ' · Add menu recipes to calculate contribution and classification'}.</div>`
        : `<div class="rv2-caption">No item-level sales have arrived yet. The daily till feed will populate products, movers, decline watch and performance; menu recipes will add contribution once sales are present.</div>`;

      // ---- menu engineering portfolio: every completely costed SKU is plotted. The visual
      // boundary is the unit-sales-weighted median on each axis; exact medians use the high side. ----
      const quadFrame = `<div class="quad opportunity"><strong>OPPORTUNITIES / PUZZLES</strong><br>High contribution · low popularity</div>
          <div class="quad winner"><strong>WINNERS / STARS</strong><br>High contribution · high popularity</div>
          <div class="quad dog"><strong>DOGS</strong><br>Low contribution · low popularity</div>
          <div class="quad workhorse"><strong>WORKHORSES / PLOWHORSES</strong><br>Low contribution · high popularity</div>
          <div class="axis-y">Contribution / item</div><div class="axis-x">Current-window units →</div>`;
      let quads;
      if (!hasContribution) {
        const copy = hasRecipes
          ? 'No sold item has a complete recipe yet. Finish one or more recipes to compare popularity with contribution.'
          : 'Add a menu recipe to compare popularity with contribution. Sales performance remains available below.';
        quads = `<div class="matrix">${quadFrame}<div class="matrix-empty">${menuEmpty('Portfolio awaiting recipes', copy, 'Open the recipes worklist')}</div></div>`;
      } else {
        const plotted = portfolio.plottable;
        const minUnits = Math.min(...plotted.map((p) => p.qty));
        const maxUnits = Math.max(...plotted.map((p) => p.qty));
        const minContribution = Math.min(...plotted.map((p) => p.contributionPence));
        const maxContribution = Math.max(...plotted.map((p) => p.contributionPence));
        const axisPct = (value, min, median, max) => {
          if (value < median) return median > min ? 8 + ((value - min) / (median - min)) * 38 : 27;
          return max > median ? 54 + ((value - median) / (max - median)) * 38 : 73;
        };
        const maxNet = Math.max(...plotted.map((p) => p.net));
        const bubbles = plotted.slice().sort((a, b) => a.net - b.net || a.sku.localeCompare(b.sku)).map((p) => {
          const left = axisPct(p.qty, minUnits, portfolio.popularityMedian, maxUnits);
          const top = 100 - axisPct(p.contributionPence, minContribution, portfolio.contributionMedianPence, maxContribution);
          // Diameter follows sqrt(net), so the visible circle AREA follows current-window net.
          const size = Math.max(8, 54 * Math.sqrt(p.net / maxNet));
          const tip = `${p.name} · ${int(Math.round(p.qty))} units · ${contributionGbp(p.contributionPence)} contribution/item · ${gbp(p.net)} net · ${p.className}`;
          return `<button type="button" class="bubble ${p.className.toLowerCase()}" data-menu-sku="${esc(p.sku)}" data-menu-class="${esc(p.className)}" data-window-net-pence="${p.net}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px" aria-label="${esc(tip)}">${p.labelled ? `<span class="bubble-label">${esc(p.name)}</span>` : ''}<span class="bubble-tip" role="tooltip">${esc(tip)}</span></button>`;
        }).join('');
        quads = `<div class="matrix">${quadFrame}${bubbles}
          <div class="matrix-threshold-x">median ${int(Math.round(portfolio.popularityMedian))} units</div>
          <div class="matrix-threshold-y">median ${contributionGbp(portfolio.contributionMedianPence)}</div></div>`;
      }
      const classKey = `<div class="classification-key">
          <div class="class-card"><h4 class="k-up">Winners</h4><p>Protect availability, feature prominently and use in paid creative. Avoid unnecessary discounting.</p></div>
          <div class="class-card"><h4 class="k-flat">Workhorses</h4><p>Keep because guests want them, but improve recipe cost, price architecture or add-on conversion.</p></div>
          <div class="class-card"><h4 class="k-opp">Opportunities</h4><p>Profitable but under-ordered. Improve naming, menu position, photography and staff prompts.</p></div>
          <div class="class-card"><h4 class="k-down">Dogs</h4><p>Low popularity and weak economics. Rework once, then remove unless strategically necessary.</p></div>
        </div>`;
      const portfolioPanel = S.rcc.panel({
        title: 'Menu engineering portfolio', sub: 'current-window units vs contribution per item · bubble area = current-window net',
        headRight: hasContribution ? S.rcc.tag(`${portfolio.plottable.length} costed`, 'good') : '',
        body: quads + classKey
          + (hasContribution
            ? `<div class="r-mini-note">${coverageCopy} · thresholds are unit-sales-weighted medians: ${int(Math.round(portfolio.popularityMedian))} units and ${contributionGbp(portfolio.contributionMedianPence)} contribution/item · items exactly on a median enter the high side · Awaiting recipes: ${portfolio.awaitingCount} items, ${gbp(portfolio.awaitingNet)} net.</div>`
            : (hasLines
              ? `<div class="r-mini-note">Awaiting recipes: ${portfolio.awaitingCount} items, ${gbp(portfolio.awaitingNet)} net. Uncosted items remain visible in the performance and decline tables.</div>`
              : '<div class="r-mini-note">The portfolio will populate when item-level sales and complete menu recipes overlap.</div>')),
      });

      // ---- same-period decline watch: top net declines vs the prior 28d; the response carries
      // achieved contribution for costed current sellers and the recipes link for uncosted ones. ----
      let declineBody;
      if (!hasLines) {
        declineBody = menuEmpty('Same-period decline watch', 'No item-level sales are available in the current window.', null);
      } else if (!mg.decline.length) {
        declineBody = `${S.rcc.pill('no product declined ≥ £50 net vs the prior 28 days', true)}
          <div class="r-mini-note">decline floor £50 (presentation cut, not a ruling) · 28 days to ${esc(mg.apiMax)} vs the prior 28 days${hasContribution ? ` · ${coverageCopy}` : ''}</div>`;
      } else {
        const response = (r) => {
          if (r.contributionPence != null) return `<span class="mono">${contributionGbp(r.contributionPence)} / item</span>${r.className ? ` · ${esc(r.className)}` : ''}`;
          if (!r.recipeCosted) return `<a class="recipe-missing" href="/coyote/recipes">No recipe yet</a>`;
          return 'No current sales to establish achieved price';
        };
        const rowsHtml = mg.decline.map((r) => `<div class="decline-row"><div><strong>${esc(r.name)}</strong></div>
            <div class="r-num mono">${gbp(r.prior)}</div><div class="r-num mono">${gbp(r.now)}</div>
            <div class="r-num mono r-down">${esc(pctStr(r.pct))}</div>
            <div class="action">${response(r)}</div></div>`).join('');
        declineBody = `<div class="decline-row head"><div>Item</div><div class="r-num">Prior 28d</div><div class="r-num">Now 28d</div><div class="r-num">Δ%</div><div class="action">Response</div></div>${rowsHtml}
          <div class="r-mini-note">top ${mg.decline.length} net decline(s) ≥ £50 (presentation floor, not a ruling) · 28 days to ${esc(mg.apiMax)} vs the prior 28 days · a stopped seller shows its true £0.00 window net · ${coverageCopy}</div>`;
      }
      const declinePanel = S.rcc.panel({
        title: 'Same-period decline watch', sub: 'largest net declines · 28d vs the prior 28d · ex-VAT',
        headRight: hasLines && mg.decline.length ? S.rcc.tag(`${mg.decline.length} declining`, 'bad') : '',
        body: declineBody,
      });

      // ---- canonical product performance: sales facts for every consolidated SKU, contribution
      // and classification only where a complete recipe makes them real. ----
      let perfBody;
      if (!hasLines) {
        perfBody = menuEmpty('Canonical product performance', 'No item-level sales are available in the current window.', null);
      } else {
        const totalNet = mg.products.reduce((s, p) => s + p.net, 0) || 1;
        const na = (why) => `<span class="rp-yoy-na" title="${esc(why)}">—</span>`;
        const pcell = (v) => `<span class="${v >= 0 ? 'r-up' : 'r-down'}">${esc(pctStr(v))}</span>`;
        const classTone = { Winner: 'good', Workhorse: 'warn', Opportunity: 'info', Dog: 'bad' };
        const rowsHtml = mg.products.slice(0, 15).map((p) => {
          const trend = p.priorNet != null && p.priorNet > 0 ? (p.net / p.priorNet - 1) * 100 : null;
          const yoy = p.lyNet != null && p.lyNet > 0 ? (p.net / p.lyNet - 1) * 100 : null;
          const economics = p.contributionPence != null
            ? `<td class="r-num mono">${contributionGbp(p.contributionPence)}</td><td>${S.rcc.tag(p.className, classTone[p.className])}</td>`
            : `<td class="r-num not-costed"><a class="recipe-missing" href="/coyote/recipes">No recipe yet</a></td><td>${S.rcc.tag('Awaiting recipe', 'info')}</td>`;
          return `<tr><td>${esc(p.name)}</td>
            <td class="r-num mono">${int(Math.round(p.qty))}</td>
            <td class="r-num mono">${gbp(p.net)}</td>
            <td class="r-num mono">${((p.net / totalNet) * 100).toFixed(1)}%</td>
            <td class="r-num mono">${trend != null ? pcell(trend) : na('no prior-28d record')}</td>
            <td class="r-num mono">${yoy != null ? pcell(yoy) : na('no LY record (same 28d window −364d)')}</td>
            ${economics}</tr>`;
        }).join('');
        perfBody = `<div style="overflow:auto"><table><thead><tr><th>Product</th><th class="r-num">Units</th><th class="r-num">Net · 28d</th><th class="r-num">Mix</th><th class="r-num">Trend vs prior 28d</th><th class="r-num">YoY</th><th class="r-num">Contribution / item</th><th>Class</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
          <div class="r-mini-note">top 15 of ${int(mg.products.length)} products by 28-day net · till item lines consolidated by SKU · mix = share of 28-day product net · YoY = same 28-day window −364 days · ${coverageCopy} · Awaiting recipes: ${portfolio.awaitingCount} items, ${gbp(portfolio.awaitingNet)} net.</div>`;
      }
      const perfPanel = S.rcc.panel({
        title: 'Canonical product performance', sub: 'units · net · mix · momentum per SKU-consolidated product',
        headRight: S.rcc.tag('zero-value modifier lines excluded', 'good'),
        body: perfBody,
      });

      return `<div class="r-grid r-kpi-grid menu-kpis">${kpis}</div>${kpiCaption}
        <div class="r-grid r-two-col">${portfolioPanel}${declinePanel}</div>
        ${perfPanel}`;
    };

    let tabBody;
    if (tab === 'forecast') tabBody = renderForecast();
    else if (tab === 'executive') tabBody = renderExecutive();
    else if (tab === 'drivers') tabBody = renderDrivers();
    else if (tab === 'reconciliation') tabBody = renderReconciliation();
    else if (tab === 'menu') tabBody = renderMenu();
    else tabBody = renderQuickBooksSales();

    const body = `<div class="rcc">`
      + styles
      + '<div class="rp-lib"><a href="/coyote/report-library">Report Library — specialist reports, verdict-first →</a></div>'
      + tabsNav
      + tabBody
      + `</div>`;

    const stamp = m.maxDate
      ? `sales · <span class="mono">Lightspeed · ${esc(m.maxDate)}</span>`
      : (m.rv2 && m.rv2.maxApiDate ? `api record · <span class="mono">${esc(m.rv2.maxApiDate)}</span>` : 'awaiting sales data');
    return { stamp, body };
  },
};
