'use strict';
// Reports — Reporting v2 (Stage 2, operator-tapped): the decision surface, panels ranked by
// decision value. Phase 1 ships P1 (revenue projection) + P2 (channel mix / QR migration) on top;
// the POS-truthful day/period flash (the original tab) stays below until later phases re-home its
// pieces (P5 product mix, P7 weekly verdict). Contract: { key, route, title, sub, getSection, render }.
// SELECT-only via ctx.q (no writes). NO-FABRICATION rules baked in:
//   • P1/P2 render from the BACKFILLED PER-RECEIPT TRUTH (sales_receipts_api) — operator source
//     ruling. A month is COMPLETE only when every calendar day has an 'ok' ledger row
//     (sales_api_ingest_runs; closed days get rows too). Anything less renders as a GAP with its
//     reason — never an estimate, never a low-looking partial month drawn as an actual.
//   • Forecast (operator ruling): seasonality-aware headline (weighted per-month YoY ratio,
//     trailing ≤6 complete pairs, ×3/×2 recency on the newest two) + simple YTD-YoY grey sanity
//     line + the one-line projection-basis caption under the chart. Premises guard: months before
//     the 2023-04-01 move are never used. Re-forecast at every read — nothing stored.
//   • "Covers" from Lightspeed is a POS guest-count, NOT real covers → covers stay "not wired"
//     until OpenTable lands (P6). Margin needs recipes → "not costed yet" (never estimated).
const S = require('../../shared.js');
const NAV = require('../../period-nav.js');
const REP = require('../../reporting.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
const MONTHS_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(ym) { const m = String(ym || '').match(/^(\d{4})-(\d{2})$/); return m ? `${MONTHS_ABBR[Number(m[2])] || m[2]} ${m[1]}` : String(ym || ''); }

// Sale filter — MIRRORS src/lightspeed-api/aggregate.ts isSale (the reconciled day-net basis):
// non-cancelled, type not VOID/CANCEL/RECALL; net = net_without_tax_pence (ex-VAT).
const SALE_WHERE = `r.cancelled = 0 AND (r.type IS NULL OR r.type NOT IN ('VOID','CANCEL','RECALL'))`;

// Channel palette (fixed per label; unknown labels rotate the grey tail). QR = STOREKIT ORDER & PAY.
const QR_LABEL = 'STOREKIT ORDER & PAY';
const CHANNEL_COLORS = {
  'EAT IN': '#22D3EE',
  [QR_LABEL]: '#34D399',
  'MON-FRI DEAL': '#60A5FA',
  'Take-Away': '#FBBF24',
  'ONLINE ORDER': '#A78BFA',
  'PICKUP': '#F0843E',
};
const FALLBACK_COLORS = ['#7d8da5', '#5a6b84', '#93a7c4', '#465a72', '#a5b4c9'];

module.exports = {
  key: 'reports', route: '/coyote/reports', workspace: 'coyote', title: 'Reports',
  sub: 'Reporting v2 — projection & channel mix from the per-receipt API record · day flash below (covers via OpenTable, not wired)',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') return { now, hasData: false, rv2: null };

    // ---- Reporting v2 (P1 + P2): the per-receipt API record, month-complete via the ledger ----
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
    if (!maxDate) return { now, hasData: false, rv2 };

    const build = (from, to) => {
      const tot = rowsOf(q(
        `SELECT COUNT(*) AS days, SUM(net_sales_pence) AS net, SUM(gross_sales_pence) AS gross,
                SUM(transactions) AS txn, SUM(pos_guest_count) AS pgc, SUM(tips_pence) AS tips,
                SUM(discounts_pence) AS disc, SUM(voids_pence) AS voids, SUM(comps_pence) AS comps,
                SUM(refunds_pence) AS refunds, SUM(taxes_pence) AS taxes, SUM(labor_hours) AS labor
           FROM sales_day WHERE business_date BETWEEN ? AND ?`, [from, to]))[0] || {};
      const channels = rowsOf(q(`SELECT profile_name AS name, SUM(net_sales_pence) AS net, SUM(transactions) AS txn
           FROM sales_by_channel WHERE business_date BETWEEN ? AND ? GROUP BY profile_id, profile_name ORDER BY net DESC`, [from, to]));
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
      // Tables land with the labour ingest — until then rowsOf degrades to [] and the
      // section says "not pulled yet" (never estimated, never faked).
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
      // CLOSED vs MISSING (edge honesty): a captured day with zero net = CLOSED (the pull
      // ran and found no trade); a day with no row at all = NO RECORD. Never conflated,
      // never rendered as zero-trading days.
      const closed = rowsOf(q(`SELECT COUNT(*) AS n FROM sales_day WHERE business_date BETWEEN ? AND ? AND net_sales_pence = 0`, [from, to]))[0] || { n: 0 };
      return { from, to, tot, channels, payments, cats, prodsTop, prodsBottom, hourly, cov, lab, labNet, labNames, labHourly, closedDays: num(closed.n) || 0 };
    };

    const nav = NAV.resolveNav(ctx.query, maxDate, now, '/coyote/reports');
    const histRow = rowsOf(q('SELECT MIN(business_date) AS d FROM sales_day'))[0];
    // YoY headline — "vs same month last year" from the box's boundary-safe view
    // (v_sales_month_yoy): current-premises comparisons only; a comparison the
    // premises move / partial month blocks carries its REASON, never a number.
    // Anchor = the month of the viewed period's settled end (clamped to maxDate).
    const anchorMonth = String(nav.to <= maxDate ? nav.to : maxDate).slice(0, 7);
    const yoyCols = 'month, net_pence, days, cal_days, complete, prior_year_month, prior_year_net_pence, yoy_delta_pence, yoy_status';
    const yoyAnchor = rowsOf(q(`SELECT ${yoyCols} FROM v_sales_month_yoy WHERE month = ?`, [anchorMonth]))[0] || null;
    const yoyLatestOk = rowsOf(q(`SELECT ${yoyCols} FROM v_sales_month_yoy WHERE premises='current' AND yoy_status='ok' ORDER BY month DESC LIMIT 1`))[0] || null;
    return {
      now, hasData: true, maxDate, nav, rv2,
      histStart: histRow && histRow.d ? String(histRow.d) : null,
      yoyAnchor, yoyLatestOk,
      current: build(nav.from, nav.to),
      comparator: nav.comparator ? build(nav.comparator.from, nav.comparator.to) : null,
    };
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const gbp = S.fmtGbpPence;
    const int = S.fmtInt;
    const atv = (net, txn) => (num(net) != null && num(txn)) ? gbp(Math.round(num(net) / num(txn))) : '—';

    const styles = `<style>
      .rp-seg{display:inline-flex;gap:2px;background:rgba(255,255,255,.05);border-radius:9px;padding:3px;margin:2px 0 16px}
      .rp-seg button{font:inherit;font-size:13px;font-weight:600;color:var(--text-2,#9aa);background:none;border:0;padding:7px 16px;border-radius:7px;cursor:pointer}
      .rp-seg button.active{background:var(--cyan-dim,rgba(34,211,238,.15));color:#CFF6FB}
      .rp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:8px}
      .rp-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      @media(max-width:840px){.rp-two{grid-template-columns:1fr}}
      .rp-bars{display:flex;align-items:flex-end;gap:3px;height:120px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08)}
      .rp-bar{flex:1;background:linear-gradient(180deg,#22D3EE,#0e7d8c);border-radius:3px 3px 0 0;min-height:2px;position:relative}
      .rp-bar span{position:absolute;bottom:-17px;left:0;right:0;text-align:center;font-size:9px;color:var(--muted,#7a8)}
      .rp-notwired{opacity:.72}
      .rp-notwired .val{color:var(--amber,#e0b050)}
      .rp-hint{font-size:11px;color:var(--muted,#7a8);margin:-4px 0 14px}
      .rp-yoy{font-size:13px;padding:9px 14px;border:1px solid rgba(255,255,255,.08);border-radius:9px;margin:0 0 14px;background:rgba(255,255,255,.03)}
      .rp-yoy-up{color:var(--green,#34d399)} .rp-yoy-down{color:var(--red,#f87171)}
      .rp-yoy-na{color:var(--muted,#7a8);font-style:italic}
      .rp-lib{text-align:right;margin:0 0 10px;font-size:13px}
      .rp-lib a{color:#e57373;text-decoration:none;font-weight:600}
      .rp-lib a:hover{text-decoration:underline}
      /* Reporting v2 */
      .rv2-caption{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--muted,#7a8);margin:6px 2px 2px;line-height:1.5}
      .rv2-legend{display:flex;flex-wrap:wrap;gap:14px;font-family:var(--font-mono,monospace);font-size:10px;color:var(--muted,#7a8);margin:2px 2px 8px}
      .rv2-legend i{display:inline-block;width:14px;height:0;border-top:2px solid;vertical-align:middle;margin-right:5px}
      .rv2-legend i.dash{border-top-style:dashed}
      .rv2-legend b{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:middle;margin-right:5px}
      .rv2-mtable{width:100%;border-collapse:collapse;font-family:var(--font-mono,monospace);font-size:10.5px;margin-top:10px}
      .rv2-mtable th{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted,#7a8);text-align:right;padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:500}
      .rv2-mtable th:first-child,.rv2-mtable td:first-child{text-align:left}
      .rv2-mtable td{text-align:right;padding:3px 6px;color:var(--text-2,#9ab);border-bottom:1px solid rgba(255,255,255,.04)}
      .rv2-gap{color:var(--muted,#7a8);font-style:italic}
      .rv2-stack{display:flex;align-items:flex-end;gap:2px;height:150px;padding:4px 0 0}
      .rv2-col{flex:1;display:flex;flex-direction:column-reverse;height:100%;min-width:7px;border-radius:2px;overflow:hidden}
      .rv2-col i{display:block;width:100%}
      .rv2-xlab{display:flex;gap:2px;font-family:var(--font-mono,monospace);font-size:8.5px;color:var(--muted,#7a8);margin-top:4px}
      .rv2-xlab span{flex:1;text-align:center;min-width:7px;overflow:hidden;white-space:nowrap}
      .rv2-multi{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
      .rv2-multi .cell{background:rgba(255,255,255,.02);border:1px solid rgba(125,165,205,.08);border-radius:9px;padding:9px 11px}
      .rv2-multi .nm{font-family:var(--font-mono,monospace);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-2,#9ab);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .rv2-multi .v{font-family:var(--font-mono,monospace);font-size:15px;font-weight:600}
      .rv2-multi .s{font-family:var(--font-mono,monospace);font-size:9.5px;color:var(--muted,#7a8)}
    </style>`;

    // ================= P1 — REVENUE PROJECTION (per-receipt API record) =================
    const renderProjection = (rv2) => {
      const P = rv2.projection;
      const year = rv2.year;
      const iOf = (ym) => Number(ym.slice(5, 7)) - 1;
      const yearPoints = (y) => REP.ymsOfYear(y).map((ym) => {
        const mm = rv2.months[ym];
        return { i: iOf(ym), v: mm && mm.complete ? mm.netPence : null };
      });
      const actualPoints = REP.ymsOfYear(year).map((ym) => {
        const a = P.actuals.find((x) => x.ym === ym);
        return { i: iOf(ym), v: a && a.kind === 'actual' ? a.netPence : null };
      });
      const lastActual = P.actuals.filter((a) => a.kind === 'actual').pop() || null;
      const joined = (key) => {
        // Nulls stay in the point list — the chart splits paths on them, so a gap month is drawn as
        // ABSENCE, never bridged. The dashed line continues FROM the last actual only when the
        // first forecast month is adjacent and computable.
        const pts = P.forecast.map((f) => ({ i: iOf(f.ym), v: f[key] != null ? f[key] : null }));
        const first = P.forecast[0];
        return lastActual && first && first[key] != null && iOf(first.ym) === iOf(lastActual.ym) + 1
          ? [{ i: iOf(lastActual.ym), v: lastActual.netPence }, ...pts] : pts;
      };
      const series = [
        { label: String(year - 2), color: 'rgba(137,154,177,.45)', width: 1.5, points: yearPoints(year - 2) },
        { label: String(year - 1), color: 'rgba(137,154,177,.85)', width: 1.5, points: yearPoints(year - 1) },
        { label: 'simple sanity', color: 'rgba(170,195,225,.5)', dash: '3 4', width: 1.4, points: joined('simplePence') },
        { label: `${year} actual`, color: '#22D3EE', width: 2.5, points: actualPoints },
        { label: 'forecast', color: '#22D3EE', dash: '7 5', width: 2, points: joined('seasonalPence') },
      ];
      if (P.mtdPence != null) series.push({ label: 'MTD', color: '#22D3EE', dots: true, points: [{ i: iOf(rv2.nowYm), v: P.mtdPence }] });
      const band = { color: 'rgba(34,211,238,.09)', points: P.forecast.map((f) => ({ i: iOf(f.ym), low: f.lowPence, high: f.highPence })) };
      const yFmt = (v) => (v >= 100000 ? `£${Math.round(v / 100000)}k` : `£${Math.round(v / 100)}`);
      const chart = REP.svgMonthlyLines({ series, band, yFmt });

      const fy = P.fullYear;
      // Coverage gaps = ELAPSED months without a complete record; the future is not a gap.
      const gaps = P.actuals.filter((a) => a.kind === 'gap' && a.ym < rv2.nowYm);
      const actSum = P.actuals.filter((a) => a.kind === 'actual').reduce((s, a) => s + a.netPence, 0);
      const pctOf = (r) => (r == null ? '—' : `${r >= 1 ? '+' : '−'}${Math.abs((r - 1) * 100).toFixed(1)}%`);
      const tiles = `<div class="rp-grid">
        <div class="tile green"><div class="lab">Projected ${year} — seasonality-aware</div>
          <div class="val">${fy.seasonalPence != null ? gbp(Math.round(fy.seasonalPence)) : 'not computable'}</div>
          <div class="sub">${fy.seasonalPence != null ? `band ${gbp(Math.round(fy.lowPence))} – ${gbp(Math.round(fy.highPence))} · ratio ${pctOf(P.ratio)} YoY` : `missing: ${fy.missing.map(monthLabel).join(', ') || 'ratio window too thin'}`}</div></div>
        <div class="tile"><div class="lab">Simple sanity — YTD-YoY</div>
          <div class="val">${fy.simplePence != null ? gbp(Math.round(fy.simplePence)) : '—'}</div>
          <div class="sub">${P.ytdRatio != null ? `YTD ${pctOf(P.ytdRatio)} applied to remaining ${year - 1} months` : 'needs a comparable YTD pair'}</div></div>
        <div class="tile blue"><div class="lab">${year} actual to date</div>
          <div class="val">${gbp(Math.round(actSum + (P.mtdPence || 0)))}</div>
          <div class="sub">${P.actuals.filter((a) => a.kind === 'actual').length} complete months${P.mtdPence != null ? ` + MTD ${gbp(Math.round(P.mtdPence))}` : ''}${rv2.maxApiDate ? ` · through ${esc(rv2.maxApiDate)}` : ''}</div></div>
        <div class="tile ${gaps.length ? 'amber' : ''}"><div class="lab">API record coverage</div>
          <div class="val">${P.actuals.filter((a) => a.kind === 'actual').length}/${P.actuals.filter((a) => a.ym < rv2.nowYm).length}</div>
          <div class="sub">${gaps.length ? `gaps: ${gaps.map((g) => monthLabel(g.ym)).join(', ')}` : `every elapsed ${year} month complete`}</div></div>
      </div>`;

      const legend = `<div class="rv2-legend">
        <span><i style="border-color:rgba(137,154,177,.45)"></i>${year - 2}</span>
        <span><i style="border-color:rgba(137,154,177,.85)"></i>${year - 1}</span>
        <span><i style="border-color:#22D3EE"></i>${year} actual</span>
        <span><i class="dash" style="border-color:#22D3EE"></i>forecast (seasonality-aware)</span>
        <span><i class="dash" style="border-color:rgba(170,195,225,.5)"></i>simple YTD-YoY sanity</span>
        <span><b style="background:rgba(34,211,238,.18)"></b>ratio-spread band</span>
      </div>`;

      // The 12-month value strip: actual / MTD / forecast / gap — the chart's numbers, checkable.
      const cells = REP.ymsOfYear(year).map((ym) => {
        const a = P.actuals.find((x) => x.ym === ym);
        if (a && a.kind === 'actual') return `<td>${gbp(a.netPence)}</td>`;
        if (a && a.kind === 'mtd' && P.mtdPence != null) return `<td>${gbp(Math.round(P.mtdPence))} <span class="rv2-gap">MTD</span></td>`;
        const f = P.forecast.find((x) => x.ym === ym);
        if (f && f.seasonalPence != null) return `<td class="rv2-gap">≈ ${gbp(Math.round(f.seasonalPence))}</td>`;
        const reason = (a && a.reason) || (f && f.reason) || 'no record';
        return `<td class="rv2-gap" title="${esc(reason)}">gap</td>`;
      }).join('');
      const mtable = `<table class="rv2-mtable"><thead><tr><th>${year}</th>${REP.ymsOfYear(year).map((ym) => `<th>${MONTHS_ABBR[Number(ym.slice(5, 7))]}</th>`).join('')}</tr></thead>
        <tbody><tr><td>net</td>${cells}</tr></tbody></table>`;

      const windowStr = P.window.length
        ? P.window.map((w) => `${MONTHS_ABBR[Number(w.ym.slice(5, 7))]}×${w.weight}`).join(' ')
        : 'none yet';
      const caption = `<div class="rv2-caption">Projection basis: seasonality-aware — weighted per-month YoY ratio over the trailing ≤6 complete month-pairs (${esc(windowStr)}; newest ×3, next ×2), applied to each remaining month's ${year - 1} actual; grey dashed = simple YTD-YoY sanity; band = the window's min–max ratio spread; current-premises months only (move ${esc(rv2.boundaryDate)}); months without complete per-receipt API coverage render as gaps, never estimates. Re-forecast at every read.</div>`;

      return `<div class="sec-label">P1 · Revenue projection <span class="mono">(per-receipt API record)</span><span class="rule"></span></div>
        ${tiles}
        <div class="panel"><div class="panel-body">${legend}${chart}${mtable}${caption}</div></div>`;
    };

    // ================= P2 — CHANNEL MIX / QR MIGRATION (per-receipt API record) =================
    const renderChannelMix = (rv2) => {
      // Months rendered = complete months + the MTD month (marked). Nothing partial in between.
      const isShown = (ym) => (rv2.months[ym] && (rv2.months[ym].complete || (ym === rv2.nowYm && rv2.months[ym].okDays > 0)));
      const yms = [...new Set(rv2.chanMonths.map((r) => String(r.ym)))].filter(isShown).sort();
      if (!yms.length) {
        return `<div class="sec-label">P2 · Channel mix<span class="rule"></span></div>
          <div class="banner muted">No complete months in the per-receipt record yet — the K-Series backfill fills this in; channel mix renders only whole, ledger-complete months (never partial slices).</div>`;
      }
      const byYm = new Map(yms.map((ym) => [ym, []]));
      for (const r of rv2.chanMonths) if (byYm.has(String(r.ym))) byYm.get(String(r.ym)).push({ label: String(r.label), net: num(r.net) || 0, txn: num(r.txn) || 0 });
      // Global channel rank (stack order + legend + colors are stable across months).
      const totals = new Map();
      for (const rows of byYm.values()) for (const r of rows) totals.set(r.label, (totals.get(r.label) || 0) + r.net);
      const rank = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
      const colorOf = (label) => CHANNEL_COLORS[label] || FALLBACK_COLORS[Math.max(0, rank.indexOf(label)) % FALLBACK_COLORS.length];

      const cols = yms.map((ym) => {
        const rows = byYm.get(ym) || [];
        const tot = rows.reduce((s, r) => s + Math.max(0, r.net), 0) || 1;
        const segs = rank.map((label) => {
          const r = rows.find((x) => x.label === label);
          if (!r || r.net <= 0) return '';
          const pct = (r.net / tot) * 100;
          return `<i style="height:${pct.toFixed(2)}%;background:${colorOf(label)}" title="${esc(label)} ${esc(monthLabel(ym))}: ${gbp(r.net)} (${pct.toFixed(1)}%)"></i>`;
        }).join('');
        return `<div class="rv2-col"${ym === rv2.nowYm ? ' style="opacity:.55"' : ''} title="${esc(monthLabel(ym))}${ym === rv2.nowYm ? ' (MTD)' : ''}">${segs}</div>`;
      }).join('');
      const xlabs = yms.map((ym) => `<span>${ym.slice(5, 7) === '01' || ym === yms[0] ? esc(monthLabel(ym).replace(' 20', ' ')) : esc(ym.slice(5, 7))}${ym === rv2.nowYm ? '°' : ''}</span>`).join('');
      const legend = `<div class="rv2-legend">${rank.map((label) => `<span><b style="background:${colorOf(label)}"></b>${esc(label)}</span>`).join('')}</div>`;

      // ATV small multiples (top channels) — QR carries the £38 checkpoint rule.
      const iOfShown = new Map(yms.map((ym, i) => [ym, i]));
      const multis = rank.slice(0, 6).map((label) => {
        const pts = yms.map((ym) => {
          const r = (byYm.get(ym) || []).find((x) => x.label === label);
          return { v: r && r.txn > 0 ? Math.round(r.net / r.txn) : null };
        });
        const lastPt = pts.filter((p) => p.v != null).pop();
        const isQr = label === QR_LABEL;
        const spark = REP.svgSparkline({ points: pts, color: colorOf(label), rulePence: isQr ? 3800 : null });
        return `<div class="cell"><div class="nm" title="${esc(label)}">${esc(label)}</div>
          <div class="v">${lastPt ? gbp(lastPt.v) : '—'}</div>
          <div class="s">ATV/txn · latest shown month${isQr ? ' · dashed rule = £38 target' : ''}</div>${spark}</div>`;
      }).join('');

      // Migration view — EAT IN + QR as ONE dine-in unit; the QR share inside it is the migration.
      const migRows = yms.map((ym) => {
        const rows = byYm.get(ym) || [];
        const eat = rows.find((x) => x.label === 'EAT IN');
        const qr = rows.find((x) => x.label === QR_LABEL);
        const unit = (eat ? eat.net : 0) + (qr ? qr.net : 0);
        const share = unit > 0 && qr ? (qr.net / unit) * 100 : null;
        return { ym, eat: eat ? eat.net : null, qr: qr ? qr.net : null, unit: unit || null, share };
      });
      const migTable = `<table class="tbl"><thead><tr><th>month</th><th>EAT IN</th><th>QR (Storekit)</th><th>dine-in unit</th><th>QR share</th></tr></thead><tbody>
        ${migRows.slice(-13).map((r) => `<tr><td>${esc(monthLabel(r.ym))}${r.ym === rv2.nowYm ? ' <span class="ash">(MTD)</span>' : ''}</td>
          <td class="mono">${r.eat != null ? gbp(r.eat) : '—'}</td><td class="mono">${r.qr != null ? gbp(r.qr) : '—'}</td>
          <td class="mono">${r.unit != null ? gbp(r.unit) : '—'}</td>
          <td class="mono">${r.share != null ? r.share.toFixed(1) + '%' : '<span class="ash">no QR</span>'}</td></tr>`).join('')}
      </tbody></table>`;
      const shareSpark = REP.svgSparkline({ width: 220, height: 44, points: migRows.map((r) => ({ v: r.share != null ? Math.round(r.share * 100) : null })), color: '#34D399' });

      // Coverage honesty: which window this record covers + the gaps inside it.
      const allLedger = Object.keys(rv2.months).sort();
      const gapsInRange = allLedger.length
        ? (() => { const out = []; for (let ym = allLedger[0]; ym < rv2.nowYm; ym = REP.ymAdd(ym, 1)) if (!rv2.months[ym] || !rv2.months[ym].complete) out.push(ym); return out; })()
        : [];
      const coverage = `<div class="rp-hint">Record covers <b>${yms.filter((ym) => ym !== rv2.nowYm).length} complete month(s)</b> (${esc(monthLabel(yms[0]))} → ${esc(monthLabel(yms[yms.length - 1]))}${yms[yms.length - 1] === rv2.nowYm ? ', last = MTD°' : ''})${gapsInRange.length ? ` · gaps not shown: ${gapsInRange.map(monthLabel).join(', ')}` : ''}. Channel labels: operator + net-match inference (<span class="mono">sales_channel_map_api</span>); unlabelled codes show raw. Integration channels can carry ~£0 receipts — txn counts and ATV are as recorded, never cleaned invisibly.</div>`;

      return `<div class="sec-label">P2 · Channel mix &amp; QR migration <span class="mono">(per-receipt API record)</span><span class="rule"></span></div>
        <div class="panel"><div class="panel-body">${legend}<div class="rv2-stack">${cols}</div><div class="rv2-xlab">${xlabs}</div>${coverage}</div></div>
        <div class="rp-two">
          <div><div class="sec-label">ATV by channel <span class="mono">(net ÷ txn, monthly)</span><span class="rule"></span></div><div class="rv2-multi">${multis}</div></div>
          <div><div class="sec-label">Dine-in migration <span class="mono">(EAT IN + QR as one unit)</span><span class="rule"></span></div><div class="panel"><div class="panel-body">${migTable}<div style="margin-top:8px">${shareSpark} <span class="rp-hint">QR share of the dine-in unit</span></div></div></div></div>
        </div>`;
    };

    const v2Html = m.rv2
      ? renderProjection(m.rv2) + renderChannelMix(m.rv2)
      : `<div class="banner muted">Reporting v2 — no per-receipt API record yet. The K-Series shadow ingest + backfill light these panels up; nothing is estimated in the meantime.</div>`;

    if (!m.hasData) {
      // Fully empty box → the plain honest banner (no v2 scaffolding, no stray CSS). If the API
      // record exists without the scraper's sales_day, the v2 panels still render above the banner.
      return {
        stamp: m.rv2 && m.rv2.maxApiDate ? `api record · <span class="mono">${esc(m.rv2.maxApiDate)}</span>` : 'awaiting sales data',
        body: (m.rv2 ? styles + v2Html : '') + `<div class="banner muted">No Lightspeed sales yet. The daily ingest (05:30) pulls yesterday's exports into the box; the day flash appears here after the first run.</div>`,
      };
    }

    const periodBody = (p, label) => {
      const t = p.tot || {};
      const parts = [];
      if (!num(t.days)) {
        return `<div class="banner muted">No record for this period — history starts ${esc(m.histStart || '(no sales history yet)')}. Nothing is interpolated; days without a record are never shown as zeros.</div>`;
      }
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
      // headline KPIs (POS-truthful) + honest not-wired
      parts.push(`<div class="rp-grid">
        <div class="tile green"><div class="lab">Net sales (ex-VAT)</div><div class="val">${gbp(t.net)}</div><div class="sub">${esc(label)}${num(t.days) ? ` · ${esc(String(t.days))} day${t.days > 1 ? 's' : ''}` : ''}</div></div>
        <div class="tile"><div class="lab">Gross sales</div><div class="val">${gbp(t.gross)}</div><div class="sub">inc. VAT ${gbp(t.taxes)}</div></div>
        <div class="tile"><div class="lab">Transactions</div><div class="val">${int(t.txn)}</div><div class="sub">guest checks (POS-truthful)</div></div>
        <div class="tile blue"><div class="lab">ATV</div><div class="val">${atv(t.net, t.txn)}</div><div class="sub">net ÷ transactions</div></div>
        <div class="tile rp-notwired"><div class="lab">Covers</div><div class="val">not wired</div><div class="sub">from OpenTable · not yet wired (POS guest-count ${int(t.pgc)} kept as cross-check only)</div></div>
        <div class="tile rp-notwired"><div class="lab">Spend / cover</div><div class="val">not wired</div><div class="sub">needs real covers (OpenTable)</div></div>
      </div>`);
      parts.push(`<div class="rp-hint">Covers, spend-per-cover &amp; RevPASH stay “not wired” until OpenTable covers are ingested — we never compute them off the POS guest-count. Labour is real below (RotaCloud); the POS labor_hours field is ignored.</div>`);

      // sales by hour
      const hrs = p.hourly.filter((h) => num(h.net) != null);
      const maxNet = hrs.reduce((mx, h) => Math.max(mx, num(h.net) || 0), 0) || 1;
      const bars = hrs.map((h) => `<div class="rp-bar" style="height:${Math.max(2, Math.round((num(h.net) || 0) / maxNet * 108))}px" title="${esc(String(h.hour))}:00 — ${gbp(h.net)}"><span>${esc(String(h.hour))}</span></div>`).join('');
      parts.push(`<div class="sec-label">Sales by hour<span class="rule"></span></div><div class="panel"><div class="panel-body">${bars ? `<div class="rp-bars">${bars}</div><div style="height:14px"></div>` : '<div class="empty-row">No hourly data.</div>'}</div></div>`);

      // channel + payments (two columns)
      const chRows = p.channels.map((c) => `<tr><td>${esc(c.name || '')}</td><td class="mono">${gbp(c.net)}</td><td class="mono ash">${int(c.txn)}</td></tr>`).join('');
      const payTotal = p.payments.reduce((s, x) => s + (num(x.total) || 0), 0);
      const payRows = p.payments.map((x) => `<tr><td>${esc(x.name || '')}</td><td class="mono">${gbp(x.total)}</td><td class="mono ash">${gbp(x.tips)}</td></tr>`).join('');
      parts.push(`<div class="rp-two">
        <div><div class="sec-label">Channel split<span class="rule"></span></div><div class="panel"><div class="panel-body">${chRows ? `<table class="tbl"><thead><tr><th>profile</th><th>net</th><th>txns</th></tr></thead><tbody>${chRows}</tbody></table>` : '<div class="empty-row">—</div>'}</div></div></div>
        <div><div class="sec-label">Payments <span class="mono">(reconciliation)</span><span class="rule"></span></div><div class="panel"><div class="panel-body">${payRows ? `<table class="tbl"><thead><tr><th>method</th><th>taken</th><th>tips</th></tr></thead><tbody>${payRows}<tr><td><b>Total</b></td><td class="mono"><b>${gbp(payTotal)}</b></td><td></td></tr></tbody></table>` : '<div class="empty-row">—</div>'}</div></div></div>
      </div>`);

      // category performance + best/worst products
      const catRows = p.cats.map((c) => `<tr><td>${esc((c.name || '').replace(/::/g, ' · '))}</td><td class="mono">${gbp(c.net)}</td></tr>`).join('');
      const topRows = p.prodsTop.map((x) => `<tr><td>${esc(x.name || '')}</td><td class="mono">${gbp(x.amt)}</td><td class="mono ash">${int(Math.round(num(x.qty) || 0))}</td></tr>`).join('');
      const botRows = p.prodsBottom.map((x) => `<tr><td>${esc(x.name || '')}</td><td class="mono">${gbp(x.amt)}</td><td class="mono ash">${int(Math.round(num(x.qty) || 0))}</td></tr>`).join('');
      parts.push(`<div class="rp-two">
        <div><div class="sec-label">Category performance <span class="mono">(top 12)</span><span class="rule"></span></div><div class="panel"><div class="panel-body">${catRows ? `<table class="tbl"><thead><tr><th>category</th><th>net</th></tr></thead><tbody>${catRows}</tbody></table>` : '<div class="empty-row">—</div>'}</div></div></div>
        <div><div class="sec-label">Best sellers <span class="mono">(by sales)</span><span class="rule"></span></div><div class="panel"><div class="panel-body">${topRows ? `<table class="tbl"><thead><tr><th>product</th><th>sales</th><th>qty</th></tr></thead><tbody>${topRows}</tbody></table>` : '<div class="empty-row">—</div>'}
          ${botRows ? `<div class="sec-label" style="margin-top:14px">Slowest sellers<span class="rule"></span></div><table class="tbl"><thead><tr><th>product</th><th>sales</th><th>qty</th></tr></thead><tbody>${botRows}</tbody></table>` : ''}</div></div></div>
      </div>`);

      // exceptions
      parts.push(`<div class="sec-label">Exceptions<span class="rule"></span></div><div class="rp-grid">
        <div class="tile"><div class="lab">Discounts</div><div class="val">${gbp(t.disc)}</div><div class="sub">given away</div></div>
        <div class="tile"><div class="lab">Voids</div><div class="val">${gbp(t.voids)}</div><div class="sub">cancelled items</div></div>
        <div class="tile"><div class="lab">Comps</div><div class="val">${gbp(t.comps)}</div><div class="sub">comped</div></div>
        <div class="tile"><div class="lab">Refunds</div><div class="val">${gbp(t.refunds)}</div><div class="sub">returned</div></div>
      </div>`);

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
      return parts.join('\n');
    };

    // ---- YoY headline: vs same month last year (boundary-safe, current premises only) ----
    // A blocked comparison (premises move / partial month / no prior year) shows its
    // reason from the view verbatim; the latest comparable month is offered alongside
    // so the line is useful mid-month without ever fabricating a month-to-date match.
    let yoyHtml = '';
    {
      const a = m.yoyAnchor;
      const l = m.yoyLatestOk;
      const okLine = (r) => {
        const d = num(r.yoy_delta_pence);
        const base = num(r.prior_year_net_pence);
        const pctS = base ? ` / ${d >= 0 ? '+' : '−'}${Math.abs(d / base * 100).toFixed(1)}%` : '';
        return `<b>${esc(monthLabel(r.month))}</b> vs ${esc(monthLabel(r.prior_year_month))}: ${gbp(r.net_pence)} vs ${gbp(r.prior_year_net_pence)} · <span class="${d >= 0 ? 'rp-yoy-up' : 'rp-yoy-down'}"><b>${d >= 0 ? '+' : '−'}${gbp(Math.abs(d))}${pctS}</b></span>`;
      };
      if (a && a.yoy_status === 'ok') {
        yoyHtml = `<div class="rp-yoy">${okLine(a)} <span class="ash">· vs same month last year · current premises</span></div>`;
      } else if (a) {
        const fallback = l && l.month !== a.month ? ` <span class="ash">·</span> latest comparable: ${okLine(l)}` : '';
        yoyHtml = `<div class="rp-yoy"><b>${esc(monthLabel(a.month))}</b> vs same month last year: <span class="rp-yoy-na">${esc(a.yoy_status)}</span>${fallback}</div>`;
      } else if (l) {
        yoyHtml = `<div class="rp-yoy">Latest comparable month — ${okLine(l)} <span class="ash">· vs same month last year · current premises</span></div>`;
      }
      // no YoY rows at all (views not present / no monthly history) → no line, never a fabricated one
    }

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

    const body = styles
      + `<style>${NAV.NAV_CSS}</style>`
      + '<div class="rp-lib"><a href="/coyote/report-library">Report Library — specialist reports, verdict-first →</a></div>'
      + v2Html
      + `<div class="sec-label" style="margin-top:22px">Day / period flash <span class="mono">(POS-truthful · period nav)</span><span class="rule"></span></div>`
      + NAV.renderNavStrip(m.nav, '/coyote/reports', esc)
      + yoyHtml
      + comparatorHtml
      + periodBody(m.current, m.nav.label);

    return { stamp: `sales · <span class="mono">Lightspeed · ${esc(m.maxDate)}</span>`, body };
  },
};
