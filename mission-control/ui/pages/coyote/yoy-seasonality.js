'use strict';
// YoY / Seasonality — long-range sales trend across the PREMISES MOVE. Contract: { key, route, title, sub, getSection, render }.
// SELECT-only via ctx.q (no writes, no network). Reads the box's boundary-safe views:
//   v_sales_month_yoy  — same-month prior-year, with yoy_delta NULL + a reason when it would straddle
//                        the 2023-04-01 premises move, lack a current-premises prior year, or a partial month.
//   v_seasonality_current — avg net £/open-day by month-of-year, CURRENT premises only.
//   v_sales_day_all    — unified daily series (live sales_day + sales_day_history) with a premises flag.
// RULER: Coyote moved to a larger site on 2023-04-01. Pre-move is a DIFFERENT business (lower ceiling) —
// never blended into current-site YoY. This tab shows current-premises figures as truth and pre-move only
// as a clearly-flagged historical arc. NO-FABRICATION: a non-comparable period shows its reason, never a number.
const S = require('../../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(ym) { const m = String(ym || '').match(/^(\d{4})-(\d{2})$/); return m ? `${MONTHS[Number(m[2])] || m[2]} ${m[1]}` : String(ym || ''); }

module.exports = {
  key: 'yoy', route: '/coyote/yoy', workspace: 'coyote', title: 'YoY / Seasonality',
  sub: 'Long-range sales · current-premises YoY (Apr-2023 → ) + seasonal curve — pre-move flagged, never blended',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') return { now, hasData: false };
    const maxRow = rowsOf(q('SELECT MAX(business_date) AS d FROM v_sales_day_all'))[0];
    const maxDate = maxRow && maxRow.d ? String(maxRow.d) : null;
    if (!maxDate) return { now, hasData: false };

    const regime = {};
    for (const r of rowsOf(q('SELECT name, start_date, end_date, note FROM premises_regime'))) regime[r.name] = r;

    const split = rowsOf(q(
      `SELECT premises, MIN(business_date) AS a, MAX(business_date) AS b, COUNT(*) AS days,
              SUM(net_sales_pence>0) AS open_days, SUM(net_sales_pence) AS net
         FROM v_sales_day_all GROUP BY premises`));

    // Full current-premises YoY series, most-recent first (the boundary rows at the tail
    // are the honesty demonstration — they carry a reason, not a number).
    const yoy = rowsOf(q(
      `SELECT month, net_pence, days, cal_days, complete, prior_year_month, prior_year_net_pence,
              yoy_delta_pence, yoy_status
         FROM v_sales_month_yoy WHERE premises='current' ORDER BY month DESC`));

    const seasonality = rowsOf(q(
      `SELECT month_of_year, days, open_days, net_pence, avg_net_per_open_day_pence
         FROM v_seasonality_current ORDER BY month_of_year`));

    // Annual arc (both premises, flagged). Partial years (2022 opening, current year) labelled in render.
    const byYear = rowsOf(q(
      `SELECT substr(business_date,1,4) AS yr, premises, COUNT(*) AS days,
              SUM(net_sales_pence>0) AS open_days, SUM(net_sales_pence) AS net
         FROM v_sales_day_all GROUP BY yr, premises ORDER BY yr`));

    return { now, hasData: true, maxDate, regime, split, yoy, seasonality, byYear };
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const gbp = S.fmtGbpPence;
    const int = S.fmtInt;
    if (!m.hasData) {
      return { stamp: 'awaiting sales history', body: `<div class="banner muted">No sales history yet. This tab lights up once daily sales are in the box (the 4-year archive lives in <span class="mono">sales_day_history</span>; the live daily route feeds <span class="mono">sales_day</span>).</div>` };
    }
    const pct = (d, base) => (num(d) != null && num(base)) ? `${d >= 0 ? '+' : '−'}${Math.abs(num(d) / num(base) * 100).toFixed(1)}%` : '—';
    const signed = (d) => num(d) == null ? '—' : `${num(d) >= 0 ? '+' : '−'}${gbp(Math.abs(num(d)))}`;

    const styles = `<style>
      .yy-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.yy-two{grid-template-columns:1fr}}
      .yy-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:8px}
      .yy-bars{display:flex;align-items:flex-end;gap:6px;height:150px;padding:6px 0 2px;border-bottom:1px solid rgba(255,255,255,.08)}
      .yy-bar{flex:1;background:linear-gradient(180deg,#22D3EE,#0e7d8c);border-radius:3px 3px 0 0;min-height:2px;position:relative}
      .yy-bar span{position:absolute;bottom:-16px;left:0;right:0;text-align:center;font-size:10px;color:var(--muted,#7a8)}
      .yy-bar b{position:absolute;top:-16px;left:0;right:0;text-align:center;font-size:9px;color:var(--muted,#7a8);font-weight:500}
      .yy-none{color:var(--muted,#7a8);font-style:italic}
      .yy-up{color:var(--green,#34d399)} .yy-down{color:var(--red,#f87171)}
      .yy-prevrow td{opacity:.6}
      .yy-cap{font-size:11px;color:var(--muted,#7a8);margin:-4px 0 14px}
    </style>`;

    // ---- premises boundary banner (the ruler, stated up-front) ----
    const cur = m.regime && m.regime.current;
    const prev = m.regime && m.regime.previous;
    const boundary = cur ? String(cur.start_date) : '2023-04-01';
    const splitBy = {};
    for (const s of (m.split || [])) splitBy[s.premises] = s;
    const cs = splitBy.current || {}, ps = splitBy.previous || {};
    const banner = `<div class="banner muted">
      <b>Ruler — premises move ${esc(boundary)}.</b> Coyote moved to a larger site on ${esc(boundary)}${cur && cur.note ? ` (${esc(cur.note)})` : ''}.
      Everything from ${esc(boundary)} is the <b>current premises</b> — a different business ceiling from the ${prev ? esc(`${prev.start_date} → ${prev.end_date}`) : 'pre-move'} smaller site.
      YoY below is <b>current-premises only</b>; a comparison that would straddle the move shows <span class="yy-none">no comparable current-premises period</span> instead of a misleading number.
      Pre-move data is kept (${int(num(ps.days))} days, ${gbp(ps.net)}) but flagged, never blended.
    </div>`;

    // ---- headline tiles ----
    const okRows = (m.yoy || []).filter((r) => r.yoy_status === 'ok');
    const latest = okRows[0] || null;      // most-recent complete comparable month
    const peak = (m.seasonality || []).slice().sort((a, b) => (num(b.avg_net_per_open_day_pence) || 0) - (num(a.avg_net_per_open_day_pence) || 0))[0] || null;
    const trough = (m.seasonality || []).filter((r) => num(r.avg_net_per_open_day_pence) != null).slice().sort((a, b) => (num(a.avg_net_per_open_day_pence) || 0) - (num(b.avg_net_per_open_day_pence) || 0))[0] || null;
    const firstOk = okRows.length ? okRows[okRows.length - 1] : null;

    const tiles = `<div class="yy-grid">
      <div class="tile ${latest && num(latest.yoy_delta_pence) >= 0 ? 'green' : ''}"><div class="lab">Latest full-month YoY</div>
        <div class="val">${latest ? signed(latest.yoy_delta_pence) : '—'}</div>
        <div class="sub">${latest ? `${esc(monthLabel(latest.month))} vs ${esc(monthLabel(latest.prior_year_month))} · ${pct(latest.yoy_delta_pence, latest.prior_year_net_pence)}` : 'no complete comparable month yet'}</div></div>
      <div class="tile blue"><div class="lab">Current-premises net</div><div class="val">${gbp(cs.net)}</div>
        <div class="sub">${cs.a ? `${esc(cs.a)} → ${esc(cs.b)} · ${int(num(cs.open_days))} open days` : '—'}</div></div>
      <div class="tile"><div class="lab">Seasonal peak</div><div class="val">${peak ? gbp(peak.avg_net_per_open_day_pence) : '—'}</div>
        <div class="sub">${peak ? `${esc(MONTHS[Number(peak.month_of_year)] || peak.month_of_year)} · avg net/open-day` : ''}</div></div>
      <div class="tile"><div class="lab">Seasonal trough</div><div class="val">${trough ? gbp(trough.avg_net_per_open_day_pence) : '—'}</div>
        <div class="sub">${trough ? `${esc(MONTHS[Number(trough.month_of_year)] || trough.month_of_year)} · avg net/open-day` : ''}</div></div>
    </div>`;

    // ---- YoY table (full current-premises series, most recent first) ----
    const yoyRows = (m.yoy || []).map((r) => {
      const comparable = r.yoy_status === 'ok';
      const deltaCell = comparable
        ? `<span class="${num(r.yoy_delta_pence) >= 0 ? 'yy-up' : 'yy-down'}">${signed(r.yoy_delta_pence)} <span class="ash">${pct(r.yoy_delta_pence, r.prior_year_net_pence)}</span></span>`
        : `<span class="yy-none">${esc(r.yoy_status)}</span>`;
      const priorCell = comparable ? gbp(r.prior_year_net_pence) : '—';
      const partial = !r.complete ? ` <span class="ash">(${int(num(r.days))}/${int(num(r.cal_days))}d)</span>` : '';
      return `<tr>
        <td>${esc(monthLabel(r.month))}${partial}</td>
        <td class="mono">${gbp(r.net_pence)}</td>
        <td class="mono ash">${priorCell}</td>
        <td class="mono">${deltaCell}</td>
      </tr>`;
    }).join('');

    // ---- seasonality bar chart (current premises, Jan→Dec) ----
    const seas = (m.seasonality || []).filter((r) => num(r.avg_net_per_open_day_pence) != null);
    const maxAvg = seas.reduce((mx, r) => Math.max(mx, num(r.avg_net_per_open_day_pence) || 0), 0) || 1;
    const bars = seas.map((r) => {
      const v = num(r.avg_net_per_open_day_pence) || 0;
      const mn = MONTHS[Number(r.month_of_year)] || r.month_of_year;
      return `<div class="yy-bar" style="height:${Math.max(2, Math.round(v / maxAvg * 132))}px" title="${esc(mn)} — ${gbp(v)}/open-day (${int(num(r.open_days))} open days)"><b>${gbp(v).replace('.00', '')}</b><span>${esc(mn)}</span></div>`;
    }).join('');

    // ---- annual arc (both premises, flagged; partial years labelled) ----
    const curYear = String(m.maxDate).slice(0, 4);
    const yearRows = (m.byYear || []).map((r) => {
      const isPrev = r.premises === 'previous';
      const partialNote = r.yr === '2022' ? ' <span class="ash">(from Feb 20 — opening)</span>' : (r.yr === curYear ? ' <span class="ash">(year to date)</span>' : '');
      const flag = isPrev ? ' <span class="chip">previous premises</span>' : '';
      const avg = num(r.open_days) ? Math.round(num(r.net) / num(r.open_days)) : null;
      return `<tr class="${isPrev ? 'yy-prevrow' : ''}">
        <td>${esc(r.yr)}${partialNote}${flag}</td>
        <td class="mono ash">${int(num(r.open_days))}</td>
        <td class="mono">${gbp(r.net)}</td>
        <td class="mono ash">${gbp(avg)}</td>
      </tr>`;
    }).join('');

    const body = styles
      + banner
      + tiles
      + `<div class="yy-cap">First comparable current-premises YoY: <b>${firstOk ? esc(monthLabel(firstOk.month)) : '—'}</b> (the first month whose prior year is also current premises). Earlier current-premises months have no like-for-like prior year and say so.</div>`
      + `<div class="yy-two">`
        + `<div><div class="sec-label">Seasonality — avg net £/open-day by month <span class="mono">(current premises)</span><span class="rule"></span></div>`
          + `<div class="panel"><div class="panel-body">${bars ? `<div class="yy-bars">${bars}</div><div style="height:16px"></div>` : '<div class="empty-row">—</div>'}</div></div></div>`
        + `<div><div class="sec-label">Annual arc <span class="mono">(net by year)</span><span class="rule"></span></div>`
          + `<div class="panel"><div class="panel-body">${yearRows ? `<table class="tbl"><thead><tr><th>year</th><th>open days</th><th>net</th><th>avg/open-day</th></tr></thead><tbody>${yearRows}</tbody></table>` : '<div class="empty-row">—</div>'}</div></div></div>`
      + `</div>`
      + `<div class="sec-label">Year-over-year by month <span class="mono">(current premises — Δ vs same month prior year)</span><span class="rule"></span></div>`
      + `<div class="panel"><div class="panel-body">${yoyRows ? `<table class="tbl"><thead><tr><th>month</th><th>net</th><th>prior year</th><th>YoY Δ</th></tr></thead><tbody>${yoyRows}</tbody></table>` : '<div class="empty-row">No current-premises months yet.</div>'}</div></div>`;

    return { stamp: `sales trend · <span class="mono">${esc(m.maxDate)}</span>`, body };
  },
};
