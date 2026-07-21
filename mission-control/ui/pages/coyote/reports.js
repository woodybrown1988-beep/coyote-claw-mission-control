'use strict';
// Reports — the REVENUE COMMAND CENTRE (RCC Stage 2, ruled 2026-07-21). ONE route (/coyote/reports),
// five subtabs per the operator mock (docs/revenue-command-centre/ gap map + reference/mock-*.png):
//   executive (P1 BUILT) · drivers (P2 pending) · menu (P5 pending) · reconciliation (P3 pending)
//   · forecast (P4 BUILT)
// Contract unchanged: { key, route, title, sub, getSection, render }. SELECT-only via ctx.q.
// ONE HOME PER FACT (the absorb rule): the old projection panel + long-range + YoY headline are
// ABSORBED by the Forecast tab; the old channel-mix stack/QR hero by the Executive donut (the
// migration table survives as its expand); the decomposition table lives on Executive. The three
// pending tabs carry the surviving flash panels UNRESTYLED until their phase lands.
// NO-FABRICATION rules baked in:
//   • Executive KPI window = the LAST FULL Mon–Sun week vs the weekday-aligned week LY (−364d),
//     premises-guarded — a non-comparable LY drops the delta and says so, never a raw cross-site %.
//   • Covers stay "not wired" (POS guest-count is NOT covers — canon) until OpenTable lands.
//   • Forecast (operator ruling): seasonality-aware headline (weighted per-month YoY ratio,
//     trailing ≤6 complete pairs, ×3/×2 recency) + simple YTD-YoY grey sanity + premises guard
//     (move 2023-04-01). Months without complete per-receipt coverage are GAPS, never estimates.
//     Re-forecast at every read; the ONLY stored input is the journaled management override.
//   • Every blocked panel is the designed empty-state naming blocker + unlock; no mock numbers.
const S = require('../../shared.js');
const NAV = require('../../period-nav.js');
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
];
const TAB_KEYS = TABS.map((t) => t.key);

// Sale filter — MIRRORS src/lightspeed-api/aggregate.ts isSale (the reconciled day-net basis):
// non-cancelled, type not VOID/CANCEL/RECALL; net = net_without_tax_pence (ex-VAT).
const SALE_WHERE = `r.cancelled = 0 AND (r.type IS NULL OR r.type NOT IN ('VOID','CANCEL','RECALL'))`;

const QR_LABEL = 'STOREKIT ORDER & PAY';
const QR_TARGET_PENCE = 3800; // the standing £38 net/txn decision (docs/qr-upsell-spec.md)
const API_ERA_NOTE = 'window inside API-era coverage (from 2026-06-30)';

// Channel palette for the drivers-tab ATV small-multiples (fixed per label; unknown labels
// rotate the grey tail) — kept from the pre-RCC channel section, moved intact.
const CHANNEL_COLORS = {
  'EAT IN': '#22D3EE',
  [QR_LABEL]: '#34D399',
  'MON-FRI DEAL': '#60A5FA',
  'Take-Away': '#FBBF24',
  'ONLINE ORDER': '#A78BFA',
  'PICKUP': '#F0843E',
};
const FALLBACK_COLORS = ['#7d8da5', '#5a6b84', '#93a7c4', '#465a72', '#a5b4c9'];

// RCC donut palette in the mock's order: accent → blue → accent2 → purple → greys.
const DONUT_COLORS = ['#e44b36', '#67a7ff', '#ffb34d', '#ad8cff', '#56616e', '#7d8da5'];

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
    // premises guard: any old-site day on either side → no raw YoY delta, the caption says why
    const lyComparable = num(ly.days) > 0 && num(ly.curdays) === num(ly.days) && num(cur.curdays) === num(cur.days);
    exec.week = {
      from: wk.from, to: wk.to, lyFrom, lyTo, days: num(cur.days) || 0,
      net: num(cur.net), gross: num(cur.gross), txn: num(cur.txn),
      lyNet: lyComparable ? num(ly.net) : null, lyGross: lyComparable ? num(ly.gross) : null,
      lyTxn: lyComparable ? num(ly.txn) : null, lyComparable,
    };

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
    for (const r of rowsOf(q(`SELECT DISTINCT business_date d, revenue_target_pence t FROM rota_ahead_budget WHERE business_date BETWEEN ? AND ?`, [from8, wk.to]))) {
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
  // (3) QR ATV vs the £38 target, trailing 28d of the per-receipt record (the Overview pattern)
  if (apiMax) {
    const qrFrom = K.shiftDays(apiMax, -27);
    const qrr = rowsOf(q(
      `SELECT SUM(r.net_without_tax_pence) net, COUNT(*) txn
         FROM sales_receipts_api r JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
        WHERE r.business_date BETWEEN ? AND ? AND m.channel_label = ? AND ${SALE_WHERE}`, [qrFrom, apiMax, QR_LABEL]))[0];
    if (qrr && num(qrr.txn) > 0) exec.feed.push({ kind: 'qr', atv: Math.round(num(qrr.net) / num(qrr.txn)), txn: num(qrr.txn), to: apiMax });

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

// Per-month channel stats from the per-receipt record (complete or MTD months only — the kept P2
// rules): feeds the Executive migration expand + the drivers-tab ATV small-multiples.
function channelMonthStats(rv2) {
  const isShown = (ym) => rv2.months[ym] && (rv2.months[ym].complete || (ym === rv2.nowYm && rv2.months[ym].okDays > 0));
  const yms = [...new Set(rv2.chanMonths.map((r) => String(r.ym)))].filter(isShown).sort();
  const byYm = new Map(yms.map((ym) => [ym, []]));
  for (const r of rv2.chanMonths) if (byYm.has(String(r.ym))) byYm.get(String(r.ym)).push({ label: String(r.label), net: num(r.net) || 0, txn: num(r.txn) || 0 });
  // noise rule (kept): ≥2% share, >£1 ATV, top 4 — integration ping channels never become cards
  const tot = new Map();
  for (const rows of byYm.values()) for (const r of rows) {
    const t = tot.get(r.label) || { net: 0, txn: 0 };
    t.net += r.net; t.txn += r.txn; tot.set(r.label, t);
  }
  const totalNet = Math.max(1, [...tot.values()].reduce((s, t) => s + Math.max(0, t.net), 0));
  const kept = [...tot.entries()].sort((a, b) => b[1].net - a[1].net)
    .filter(([, t]) => t.net / totalNet >= 0.02 && t.txn > 0 && t.net / t.txn >= 100).slice(0, 4).map(([label]) => label);
  return { yms, byYm, kept, completeYms: yms.filter((ym) => ym !== rv2.nowYm) };
}

module.exports = {
  key: 'reports', route: '/coyote/reports', workspace: 'coyote', title: 'Revenue',
  sub: 'Revenue Command Centre — Executive & Forecast live · Drivers / Menu / Reconciliation pending · covers via OpenTable (not wired)',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    const query = (ctx && ctx.query) || {};
    const tab = TAB_KEYS.includes(String(query.tab || '')) ? String(query.tab) : 'executive';
    if (typeof q !== 'function') return { now, tab, hasData: false, rv2: null };

    // ---- shared: the per-receipt monthly record + projection (P1/P4 canon source) ----
    const nowYm = new Date(now).toISOString().slice(0, 7);
    const boundaryRow = rowsOf(q(`SELECT start_date FROM premises_regime WHERE name='current'`))[0];
    const boundaryDate = boundaryRow && boundaryRow.start_date ? String(boundaryRow.start_date) : '2023-04-01';
    const apiMonths = rowsOf(q(
      `SELECT substr(r.business_date,1,7) AS ym, SUM(r.net_without_tax_pence) AS net, COUNT(*) AS txn
         FROM sales_receipts_api r WHERE ${SALE_WHERE} GROUP BY ym ORDER BY ym`));
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
    if (apiMonths.length || ledgerMonths.length) {
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
    const m = { now, tab, hasData: !!maxDate, maxDate, rv2 };

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
    } else if (maxDate) {
      // ---- pending tabs: the surviving flash panels on the period-nav window ----
      m.nav = NAV.resolveNav(query, maxDate, now, '/coyote/reports');
      const histRow = rowsOf(q('SELECT MIN(business_date) AS d FROM sales_day'))[0];
      m.histStart = histRow && histRow.d ? String(histRow.d) : null;
      const build = (from, to) => {
        const tot = rowsOf(q(
          `SELECT COUNT(*) AS days, SUM(net_sales_pence) AS net, SUM(gross_sales_pence) AS gross,
                  SUM(transactions) AS txn, SUM(tips_pence) AS tips,
                  SUM(discounts_pence) AS disc, SUM(voids_pence) AS voids, SUM(comps_pence) AS comps,
                  SUM(refunds_pence) AS refunds
             FROM sales_day WHERE business_date BETWEEN ? AND ?`, [from, to]))[0] || {};
        const payments = rowsOf(q(`SELECT method_name AS name, SUM(total_pence) AS total, SUM(tips_pence) AS tips
             FROM sales_by_payment WHERE business_date BETWEEN ? AND ? GROUP BY method_id, method_name ORDER BY total DESC`, [from, to]));
        const cats = rowsOf(q(`SELECT category_name AS name, SUM(net_sales_pence) AS net
             FROM sales_by_category WHERE grain='statistic_group' AND business_date BETWEEN ? AND ?
             GROUP BY category_id, category_name HAVING SUM(net_sales_pence) > 0 ORDER BY net DESC LIMIT 12`, [from, to]));
        const prodsTop = rowsOf(q(`SELECT product_name AS name, SUM(total_amount_pence) AS amt, SUM(quantity) AS qty
             FROM sales_by_product WHERE business_date BETWEEN ? AND ? GROUP BY sku, product_name HAVING SUM(total_amount_pence) > 0 ORDER BY amt DESC LIMIT 8`, [from, to]));
        const prodsBottom = rowsOf(q(`SELECT product_name AS name, SUM(total_amount_pence) AS amt, SUM(quantity) AS qty
             FROM sales_by_product WHERE business_date BETWEEN ? AND ? GROUP BY sku, product_name HAVING SUM(total_amount_pence) > 0 ORDER BY amt ASC LIMIT 5`, [from, to]));
        const hourly = rowsOf(q(`SELECT hour, SUM(net_sales_pence) AS net FROM sales_hourly WHERE business_date BETWEEN ? AND ? GROUP BY hour ORDER BY hour`, [from, to]));
        // Margin coverage: share of product sales whose SKU has a COMPLETE recipe (≥1 line, no uncosted ingredient).
        const cov = rowsOf(q(
          `SELECT (SELECT COALESCE(SUM(total_amount_pence),0) FROM sales_by_product WHERE business_date BETWEEN ? AND ?) AS total_amt,
                  (SELECT COALESCE(SUM(total_amount_pence),0) FROM sales_by_product sp WHERE sp.business_date BETWEEN ? AND ?
                     AND sp.sku IN (SELECT p.lightspeed_sku FROM products p
                       WHERE (SELECT COUNT(*) FROM recipe_lines rl WHERE rl.product_id=p.id) > 0
                         AND (SELECT COUNT(*) FROM recipe_lines rl JOIN sub_items si ON si.id=rl.sub_item_id
                                WHERE rl.product_id=p.id AND (si.pack_cost_pence IS NULL OR si.pack_qty IS NULL)) = 0)) AS costed_amt`,
          [from, to, from, to]))[0] || { total_amt: 0, costed_amt: 0 };
        // Labour (RotaCloud, TRUE cost = locked rates × 1.159 burden; salaried annual/365).
        const lab = rowsOf(q(
          `SELECT COUNT(*) AS days, SUM(scheduled_minutes) AS sm, SUM(actual_minutes) AS am,
                  SUM(actual_paid_minutes) AS pm, SUM(scheduled_cost_pence) AS sc, SUM(actual_cost_pence) AS ac,
                  SUM(salaried_cost_pence) AS sal, SUM(unmapped_actual_minutes) AS uam, SUM(unmapped_scheduled_minutes) AS usm
             FROM labour_day WHERE business_date BETWEEN ? AND ?`, [from, to]))[0] || null;
        // Labour % is computed against net for the SAME days labour covers — thin labour
        // history must never dilute the % against a fuller sales period (no-fabrication).
        const labNet = rowsOf(q(
          `SELECT SUM(s.net_sales_pence) AS net, COUNT(*) AS days FROM sales_day s
             JOIN labour_day l ON l.business_date = s.business_date
            WHERE s.business_date BETWEEN ? AND ?`, [from, to]))[0] || null;
        const labNames = [];
        for (const r of rowsOf(q(`SELECT unmapped_names AS n FROM labour_day WHERE business_date BETWEEN ? AND ? AND unmapped_names IS NOT NULL AND unmapped_names != '[]'`, [from, to]))) {
          try { for (const nm of JSON.parse(r.n)) if (labNames.indexOf(nm) < 0) labNames.push(nm); } catch (e) { /* keep going — a bad row never takes the flash down */ }
        }
        const labHourly = rowsOf(q(`SELECT hour, SUM(actual_minutes) AS am, SUM(actual_cost_pence) AS ac FROM labour_hourly WHERE business_date BETWEEN ? AND ? GROUP BY hour ORDER BY hour`, [from, to]));
        // CLOSED vs MISSING (edge honesty): captured zero-net day = CLOSED; no row = NO RECORD.
        const closed = rowsOf(q(`SELECT COUNT(*) AS n FROM sales_day WHERE business_date BETWEEN ? AND ? AND net_sales_pence = 0`, [from, to]))[0] || { n: 0 };
        return { from, to, tot, payments, cats, prodsTop, prodsBottom, hourly, cov, lab, labNet, labNames, labHourly, closedDays: num(closed.n) || 0 };
      };
      m.current = build(m.nav.from, m.nav.to);
      m.comparator = m.nav.comparator ? build(m.nav.comparator.from, m.nav.comparator.to) : null;
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
      /* surviving legacy grammar (pending tabs + expands keep their pre-restyle form) */
      .rp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:8px}
      .rp-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      @media(max-width:840px){.rp-two{grid-template-columns:1fr}}
      .rp-bars{display:flex;align-items:flex-end;gap:3px;height:120px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08)}
      .rp-bar{flex:1;background:linear-gradient(180deg,#22D3EE,#0e7d8c);border-radius:3px 3px 0 0;min-height:2px;position:relative}
      .rp-bar span{position:absolute;bottom:-17px;left:0;right:0;text-align:center;font-size:9px;color:var(--muted,#7a8)}
      .rp-notwired{opacity:.72}
      .rp-notwired .val{color:var(--amber,#e0b050)}
      .rp-hint{font-size:11px;color:var(--muted,#7a8);margin:-4px 0 14px}
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
      .rv2-multi{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
      .rv2-multi .cell{background:rgba(255,255,255,.02);border:1px solid rgba(125,165,205,.08);border-radius:9px;padding:10px 12px}
      .rv2-multi .nm{font-family:var(--font-mono,monospace);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-2,#9ab);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .rv2-multi .v{font-family:var(--font-mono,monospace);font-size:16px;font-weight:600}
      .rv2-multi .s{font-family:var(--font-mono,monospace);font-size:9.5px;color:var(--muted,#7a8);margin-bottom:3px}
    </style>`;

    // ---- subtab nav: 5 links, mock's .tabs/.tab grammar; ?tab only (nothing else preserved) ----
    const tabsNav = `<div class="r-tabs">${TABS.map((t) =>
      `<a class="r-tab${t.key === tab ? ' active' : ''}" href="/coyote/reports?tab=${t.key}">${esc(t.label)}</a>`).join('')}</div>`;

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
        // Covers stay NOT WIRED — POS guest-count is not covers (canon); never a number here.
        S.rcc.kpi({ label: 'Covers', value: 'not wired', sub: 'unlock: OpenTable email export' }),
        S.rcc.kpi({ label: 'Average spend / cover', value: 'not wired', sub: 'needs real covers — OpenTable' }),
        S.rcc.kpi({
          label: 'Average transaction', value: atv != null ? gbp(atv) : '—',
          delta: deltaFor(atv, lyAtv),
          sub: 'net ÷ transactions · ex-VAT',
          barPct: barFor(atv, lyAtv),
        }),
        S.rcc.kpi({ label: 'Revenue quality score', value: 'not ruled', sub: 'composite pending operator definition' }),
      ].join('');
      const kpiCaption = wk
        ? `<div class="rv2-caption">${esc(wk.from)} → ${esc(wk.to)} (last full week, Mon–Sun) · vs same weekday-aligned week LY (−364d: ${esc(wk.lyFrom)} → ${esc(wk.lyTo)}) · per-receipt truth (day-net canon, v_sales_day_all)${wk.lyComparable ? '' : ' · LY not comparable (premises guard / no record) — deltas omitted, never a cross-site %'}</div>`
        : `<div class="rv2-caption">No Lightspeed sales yet — the daily ingest (05:30) fills the day-grain record; covers stay not-wired until OpenTable lands.</div>`;

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
          <div class="r-mini-note">target = rota-ahead forecast basis (rota_ahead_budget, per-day, dept rows deduplicated) — weeks without a published forecast show no target point.</div>`;
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
          const below = f.atv < QR_TARGET_PENCE;
          alerts.push(below
            ? S.rcc.alert({ tone: 'bad', title: `QR ATV ${gbp(f.atv)} vs the £38 target`, text: `28d to ${f.to} · ${int(f.txn)} txn · per-receipt record · push checkout cross-sell`, impact: `−${gbp((QR_TARGET_PENCE - f.atv) * f.txn)}` })
            : S.rcc.alert({ tone: 'good', title: 'QR ATV on target', text: `28d to ${f.to} · ${int(f.txn)} txn · per-receipt record`, impact: gbp(f.atv) }));
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
          <div class="source"><h4>Revenue basis</h4><p>Recognised net revenue ex-VAT — the day-net canon (v_sales_day_all) and the per-receipt API record; tips and processor timing excluded.</p><div class="sync">FINANCE-CLEAN INPUT</div></div>
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
            .then(function(x){return x.json();}).then(function(j){ if(j&&j.ok){location.reload();} else {o.textContent=(j&&j.error)||'save failed';busy=false;b.disabled=false;} })
            .catch(function(){o.textContent='network error';busy=false;b.disabled=false;});
        });})();</script>`;

      return `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="rv2-caption">projection basis: per-receipt API record (ledger-complete months) · YTD facts: day-net canon (v_sales_day_all / v_sales_month, premises current) · override: forecast_overrides journal.</div>
        <div class="monthly-layout">${columnsPanel}${enginePanel}</div>
        ${planPanel}${govPanel}${script}`;
    };

    // ============================ PENDING TABS (P2 / P3 / P5) ============================
    const PENDING_BANNERS = {
      drivers: 'Phase 2 pending — interim panels below keep their pre-restyle form.',
      reconciliation: 'Phase 3 pending — the tender-to-bank match is the build; interim panels below keep their pre-restyle form.',
      menu: 'Phase 5 pending — costing the top-20 unlocks the full tab (59.5% of net sales in one afternoon).',
    };

    const renderPending = (which) => {
      const banner = S.rcc.note(PENDING_BANNERS[which] || 'pending');
      if (!m.hasData) {
        return `${banner}<div class="banner muted">No Lightspeed sales yet. The daily ingest (05:30) pulls yesterday's exports into the box; this tab lights up after the first run.</div>`;
      }
      // period-nav (build windows) survives ONLY here; tab preserved on every nav link + the form
      const strip = NAV.renderNavStrip(m.nav, '/coyote/reports', esc)
        .replace(/href="\/coyote\/reports\?period=/g, `href="/coyote/reports?tab=${which}&amp;period=`)
        .replace('<input type="hidden" name="period" value="custom"/>', `<input type="hidden" name="tab" value="${which}"/><input type="hidden" name="period" value="custom"/>`);
      // Custom-range comparator: net vs the same-length PRECEDING window (a lookup, labelled).
      let comparatorHtml = '';
      if (m.nav.comparator && m.comparator) {
        const curNet = num((m.current.tot || {}).net);
        const prevNet = num((m.comparator.tot || {}).net);
        const prevDays = num((m.comparator.tot || {}).days) || 0;
        comparatorHtml = !prevDays
          ? `<div class="rp-hint">Comparator (${esc(m.nav.comparator.label)}): no record — history starts ${esc(m.histStart || '?')}.</div>`
          : `<div class="rp-hint">vs ${esc(m.nav.comparator.label)}: net ${gbp(prevNet)} → ${gbp(curNet)}${curNet != null && prevNet != null ? ` (${curNet - prevNet >= 0 ? '+' : '−'}${gbp(Math.abs(curNet - prevNet))})` : ''}${prevDays < (num((m.current.tot || {}).days) || 0) ? ` · comparator covers only ${prevDays} day(s)` : ''}.</div>`;
      }
      const p = m.current;
      const t = p.tot || {};
      if (!num(t.days)) {
        return `${banner}${strip}<div class="banner muted">No record for this period — history starts ${esc(m.histStart || '(no sales history yet)')}. Nothing is interpolated; days without a record are never shown as zeros.</div>`;
      }
      const parts = [banner, strip, comparatorHtml];
      // settled span of this window (never expects the future): from → min(to, maxDate)
      const settledEnd = m.maxDate < p.to ? m.maxDate : p.to;
      const expected = Math.max(0, Math.round((Date.parse(settledEnd + 'T12:00:00Z') - Date.parse(p.from + 'T12:00:00Z')) / 86400000) + 1);
      const missing = Math.max(0, expected - (num(t.days) || 0));
      if (p.closedDays > 0 || missing > 0) {
        const bits = [];
        if (p.closedDays > 0) bits.push(`<b>${p.closedDays} closed day${p.closedDays === 1 ? '' : 's'}</b> (captured with zero trade — closed, not missing)`);
        if (missing > 0) bits.push(`<b>${missing} day${missing === 1 ? '' : 's'} with no record</b> (not captured — never counted as zeros)`);
        parts.push(`<div class="rp-hint">${bits.join(' · ')}</div>`);
      }

      if (which === 'drivers') {
        // sales by hour (moved intact)
        const hrs = p.hourly.filter((h) => num(h.net) != null);
        const maxNet = hrs.reduce((mx, h) => Math.max(mx, num(h.net) || 0), 0) || 1;
        const bars = hrs.map((h) => `<div class="rp-bar" style="height:${Math.max(2, Math.round((num(h.net) || 0) / maxNet * 108))}px" title="${esc(String(h.hour))}:00 — ${gbp(h.net)}"><span>${esc(String(h.hour))}</span></div>`).join('');
        parts.push(`<div class="sec-label">Sales by hour<span class="rule"></span></div><div class="panel"><div class="panel-body">${bars ? `<div class="rp-bars">${bars}</div><div style="height:14px"></div>` : '<div class="empty-row">No hourly data.</div>'}</div></div>`);

        // labour (RotaCloud · TRUE cost) — both numbers + variance; unmapped surfaced, never estimated
        parts.push(`<div class="sec-label">Labour (RotaCloud · true cost)<span class="rule"></span></div>`);
        const lb = p.lab;
        if (!lb || !num(lb.days)) {
          parts.push(`<div class="banner muted">No labour pulled for this period yet — the RotaCloud ingest (06:35 / 18:05 settlement) fills this in. Hours and cost are never estimated.</div>`);
        } else {
          const hrs2 = (mn) => (num(mn) != null ? (num(mn) / 60).toFixed(1) + 'h' : '—');
          const sameDayNet = p.labNet && num(p.labNet.net) > 0 ? num(p.labNet.net) : null;
          const pct = sameDayNet != null && num(lb.ac) != null ? (num(lb.ac) / sameDayNet) * 100 : null;
          // £-CONSEQUENCE first (operator-locked): permitted = 30% × same-day net; the £
          // delta leads, the % is the subtitle. Bands: green ≤30 · amber ≤33 · red >33.
          const permitted = sameDayNet != null ? Math.round(sameDayNet * 0.30) : null;
          const deltaPence = permitted != null && num(lb.ac) != null ? num(lb.ac) - permitted : null;
          const ragColor = pct == null ? '' : pct <= 30 ? 'var(--green,#34d399)' : pct <= 33 ? 'var(--amber,#e0b050)' : 'var(--red,#f87171)';
          const varMin = num(lb.am) != null && num(lb.sm) != null ? num(lb.am) - num(lb.sm) : null;
          const partial = num(lb.days) && num(t.days) && num(lb.days) < num(t.days);
          parts.push(`<div class="rp-grid">
            <div class="tile"><div class="lab">vs the 30% target — true-cost ruler</div><div class="val"${ragColor ? ` style="color:${ragColor}"` : ''}>${deltaPence != null ? (deltaPence > 0 ? gbp(deltaPence) + ' OVER' : gbp(-deltaPence) + ' under') : '—'}</div><div class="sub">${deltaPence != null ? `${pct.toFixed(1)}% of net · permitted ${gbp(permitted)} at 30% · same-day net only` : 'needs same-day sales'}</div></div>
            <div class="tile"><div class="lab">Labour cost (true)</div><div class="val">${gbp(lb.ac)}</div><div class="sub">rates + 15.9% burden · ${gbp(lb.sal)} salaried/365</div></div>
            <div class="tile"><div class="lab">Rota'd → worked</div><div class="val">${hrs2(lb.sm)} → ${hrs2(lb.am)}</div><div class="sub">${varMin != null ? (varMin >= 0 ? '+' : '−') + hrs2(Math.abs(varMin)) + ' vs rota' : '—'} · paid ${hrs2(lb.pm)}</div></div>
            <div class="tile"><div class="lab">Scheduled cost</div><div class="val">${gbp(lb.sc)}</div><div class="sub">what the rota would cost</div></div>
            ${num(lb.uam) || num(lb.usm) ? `<div class="tile rp-notwired"><div class="lab">Unmapped staff</div><div class="val">${hrs2(Math.max(num(lb.uam) || 0, num(lb.usm) || 0))}</div><div class="sub">hours counted, cost EXCLUDED — ${esc(p.labNames.join(', ') || 'names in labour_day')} · fix rates.ts</div></div>` : ''}
          </div>`);
          if (partial) parts.push(`<div class="rp-hint">Labour covers ${esc(String(num(lb.days)))} of ${esc(String(num(t.days)))} sales day(s) — cost and % reflect only the covered days, never scaled up.</div>`);

          // Daypart: labour cost per hour against the sales-by-hour curve. RotaCloud hours
          // 24..29 are post-midnight wall-clock 0..5 of the same trading day — merged onto
          // the matching sales hour.
          const labBy = {};
          for (const lh of p.labHourly) {
            const wall = num(lh.hour) >= 24 ? num(lh.hour) - 24 : num(lh.hour);
            if (!labBy[wall]) labBy[wall] = { am: 0, ac: 0 };
            labBy[wall].am += num(lh.am) || 0;
            labBy[wall].ac += num(lh.ac) || 0;
          }
          const salesBy = {};
          for (const h of p.hourly) salesBy[num(h.hour)] = num(h.net) || 0;
          const dayHours = [];
          for (let hh = 0; hh < 24; hh++) if (salesBy[hh] != null || labBy[hh]) dayHours.push(hh);
          if (dayHours.length) {
            const rowsHtml = dayHours.map((hh) => {
              const sNet = salesBy[hh] != null ? salesBy[hh] : null;
              const l = labBy[hh];
              const hp = l && sNet != null && sNet > 0 ? (l.ac / sNet) * 100 : null;
              const hpColor = hp == null ? '' : hp <= 30 ? 'var(--green,#34d399)' : hp <= 50 ? 'var(--amber,#e0b050)' : 'var(--red,#f87171)';
              const hourSplh = l && l.am > 0 && sNet != null ? gbp(Math.round(sNet / (l.am / 60))) : '—';
              return `<tr><td class="mono">${esc(String(hh))}:00</td><td class="mono">${sNet != null ? gbp(sNet) : '—'}</td><td class="mono">${l ? gbp(Math.round(l.ac)) : '—'}</td><td class="mono ash">${l ? hrs2(l.am) : '—'}</td><td class="mono"${hpColor ? ` style="color:${hpColor}"` : ''}>${hp != null ? hp.toFixed(0) + '%' : '—'}</td><td class="mono ash">${hourSplh}</td></tr>`;
            }).join('');
            parts.push(`<div class="sec-label">Daypart — labour vs sales by hour<span class="rule"></span></div>
              <div class="panel"><div class="panel-body"><table class="tbl"><thead><tr><th>hour</th><th>sales net</th><th>labour cost</th><th>hours</th><th>labour %</th><th>SPLH</th></tr></thead><tbody>${rowsHtml}</tbody></table>
              <div class="rp-hint" style="margin-top:8px">Hourly labour % is a staffing-shape signal (a quiet 15:00 at 200% means FOH carried against thin trade) — the day headline above is the operating truth.</div></div></div>`);
          }
        }

        // margin (not costed yet)
        const cov = p.cov || {};
        const covPct = num(cov.total_amt) && num(cov.total_amt) > 0 ? (num(cov.costed_amt) || 0) / num(cov.total_amt) : 0;
        parts.push(`<div class="sec-label">Margin (prime cost)<span class="rule"></span></div>`);
        if (covPct <= 0) {
          parts.push(`<div class="banner muted">Not costed yet — <b>0% coverage</b>. Margin lights up once recipes/ingredient costs are entered in <a href="/coyote/recipes">Recipes &amp; Costs</a> (Slice 2). We never estimate a cost we don't have. <span class="ash">(Lightspeed's own margin figures are stored as a cross-check, not shown as truth.)</span></div>`);
        } else {
          parts.push(`<div class="banner muted">Recipes cover <b>${(covPct * 100).toFixed(1)}%</b> of product sales — margin shown for costed items only; the rest is a visible gap, never estimated.</div>`);
        }

        // ATV small-multiples (moved intact from the old channel-mix section; sparse rule kept)
        if (m.rv2) {
          const cs = channelMonthStats(m.rv2);
          if (cs.kept.length) {
            const colorOf = (label) => CHANNEL_COLORS[label] || FALLBACK_COLORS[Math.max(0, cs.kept.indexOf(label)) % FALLBACK_COLORS.length];
            const multis = cs.kept.map((label) => {
              const pts = cs.completeYms.map((ym) => {
                const rs = (cs.byYm.get(ym) || []).filter((r) => r.label === label);
                const tt = rs.reduce((s, r) => s + r.txn, 0);
                return { v: tt > 0 ? Math.round(rs.reduce((s, r) => s + r.net, 0) / tt) : null };
              });
              const nPts = pts.filter((x) => x.v != null).length;
              const lastPt = pts.filter((x) => x.v != null).pop();
              const isQr = label === QR_LABEL;
              const spark = REP.svgSparkline({ points: pts, color: colorOf(label), rulePence: isQr ? QR_TARGET_PENCE : null });
              return `<div class="cell"><div class="nm" title="${esc(label)}">${esc(label)}</div>
                <div class="v">${lastPt ? gbp(lastPt.v) : '—'}</div>
                <div class="s">ATV/txn${isQr ? ' · £38 target' : ''}${!spark && nPts === 1 ? ' · one month of record' : ''}</div>${spark}</div>`;
            }).join('');
            parts.push(`<div class="sec-label">ATV by channel <span class="mono">(monthly, complete months · per-receipt)</span><span class="rule"></span></div>
              <div class="rv2-multi" style="margin-bottom:10px">${multis}</div>`);
          }
        } else {
          parts.push(`<div class="banner muted">ATV by channel needs the per-receipt API record — no per-receipt API record yet.</div>`);
        }
      }

      if (which === 'reconciliation') {
        const payTotal = p.payments.reduce((s, x) => s + (num(x.total) || 0), 0);
        const payRows = p.payments.map((x) => `<tr><td>${esc(x.name || '')}</td><td class="mono">${gbp(x.total)}</td><td class="mono ash">${gbp(x.tips)}</td></tr>`).join('');
        parts.push(`<div class="sec-label">Payments <span class="mono">(reconciliation)</span><span class="rule"></span></div><div class="panel"><div class="panel-body">${payRows ? `<table class="tbl"><thead><tr><th>method</th><th>taken</th><th>tips</th></tr></thead><tbody>${payRows}<tr><td><b>Total</b></td><td class="mono"><b>${gbp(payTotal)}</b></td><td></td></tr></tbody></table>` : '<div class="empty-row">—</div>'}</div></div>`);
        parts.push(`<div class="sec-label">Exceptions<span class="rule"></span></div><div class="rp-grid">
          <div class="tile"><div class="lab">Discounts</div><div class="val">${gbp(t.disc)}</div><div class="sub">given away</div></div>
          <div class="tile"><div class="lab">Voids</div><div class="val">${gbp(t.voids)}</div><div class="sub">cancelled items</div></div>
          <div class="tile"><div class="lab">Comps</div><div class="val">${gbp(t.comps)}</div><div class="sub">comped</div></div>
          <div class="tile"><div class="lab">Refunds</div><div class="val">${gbp(t.refunds)}</div><div class="sub">returned</div></div>
        </div>`);
      }

      if (which === 'menu') {
        const catRows = p.cats.map((c) => `<tr><td>${esc((c.name || '').replace(/::/g, ' · '))}</td><td class="mono">${gbp(c.net)}</td></tr>`).join('');
        const topRows = p.prodsTop.map((x) => `<tr><td>${esc(x.name || '')}</td><td class="mono">${gbp(x.amt)}</td><td class="mono ash">${int(Math.round(num(x.qty) || 0))}</td></tr>`).join('');
        const botRows = p.prodsBottom.map((x) => `<tr><td>${esc(x.name || '')}</td><td class="mono">${gbp(x.amt)}</td><td class="mono ash">${int(Math.round(num(x.qty) || 0))}</td></tr>`).join('');
        parts.push(`<div class="rp-two">
          <div><div class="sec-label">Category performance <span class="mono">(top 12)</span><span class="rule"></span></div><div class="panel"><div class="panel-body">${catRows ? `<table class="tbl"><thead><tr><th>category</th><th>net</th></tr></thead><tbody>${catRows}</tbody></table>` : '<div class="empty-row">—</div>'}</div></div></div>
          <div><div class="sec-label">Best sellers <span class="mono">(by sales)</span><span class="rule"></span></div><div class="panel"><div class="panel-body">${topRows ? `<table class="tbl"><thead><tr><th>product</th><th>sales</th><th>qty</th></tr></thead><tbody>${topRows}</tbody></table>` : '<div class="empty-row">—</div>'}
            ${botRows ? `<div class="sec-label" style="margin-top:14px">Slowest sellers<span class="rule"></span></div><table class="tbl"><thead><tr><th>product</th><th>sales</th><th>qty</th></tr></thead><tbody>${botRows}</tbody></table>` : ''}</div></div></div>
        </div>`);
      }

      return parts.join('\n');
    };

    let tabBody;
    if (tab === 'forecast') tabBody = renderForecast();
    else if (tab === 'executive') tabBody = renderExecutive();
    else tabBody = renderPending(tab);

    const body = `<div class="rcc">`
      + styles
      + `<style>${NAV.NAV_CSS}</style>`
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
