'use strict';
// Labour Analysis — the MANAGER SCORECARD. Contract: { key, route, title, sub, getSection, render }.
// SELECT-only via ctx.q. This is the SECOND ruler and the page never mixes the two:
//   • THIS TAB: PRE-BURDEN, mirrors RotaCloud's own arithmetic (their per-user rates, no
//     employer burden, no salaried/365) — the numbers Calum (Kitchen) and Jordan (FOH)
//     manage against in RotaCloud forecasting. £0-in-RotaCloud staff surfaced, never absorbed.
//   • REPORTS TAB: TRUE COST (burden + salaried/365) — the operating truth.
//
// CROSS-RULER HONESTY (2026-07-03 redesign): labour % of net and SPLH need BOTH a labour
// row AND a sales row for the same day. Labour history is now ~425 days deep; sales is
// thin until its backfill lands. So every cross-ruler figure is computed ONLY over the
// sales∩labour intersection and LABELLED with that day-count — never the full labour
// window divided by a 1-day sliver of sales. Scorecard-ruler-only figures (hours,
// pre-burden cost, budget-vs-actual £) use the full navigated window and need no sales.
const S = require('../../shared.js');
const NAV = require('../../period-nav.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

module.exports = {
  key: 'labour', route: '/coyote/labour', workspace: 'coyote', title: 'Labour Analysis',
  sub: 'Manager scorecard · PRE-BURDEN, matches RotaCloud — true cost lives in Reports',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') return { now, hasData: false };
    const maxRow = rowsOf(q('SELECT MAX(business_date) AS d FROM labour_dept'))[0];
    const maxDate = maxRow && maxRow.d ? String(maxRow.d) : null;
    if (!maxDate) return { now, hasData: false };

    const build = (from, to) => {
      // Scorecard-ruler grains over the FULL navigated window (no sales needed).
      const depts = rowsOf(q(
        `SELECT department, SUM(sched_minutes) AS sm, SUM(act_minutes) AS am,
                SUM(sched_cost_rc_pence) AS sc, SUM(act_cost_rc_pence) AS ac,
                SUM(rc_uncosted_sched_min) AS usm, SUM(rc_uncosted_act_min) AS uam,
                COUNT(*) AS days
           FROM labour_dept WHERE business_date BETWEEN ? AND ? GROUP BY department`, [from, to]));
      // Budget £ per dept = Σ(day labour % × that day's net) over the days budget+sales exist.
      const budgets = rowsOf(q(
        `SELECT b.department AS department, SUM(b.labour_pct * s.net_sales_pence) AS budget_pence,
                MIN(b.labour_pct) AS pct_min, MAX(b.labour_pct) AS pct_max, COUNT(*) AS days
           FROM labour_budget b JOIN sales_day s ON s.business_date = b.business_date
          WHERE b.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0 GROUP BY b.department`, [from, to]));

      // CROSS-RULER INTERSECTION — days in-window with BOTH a labour row and a sales row
      // (net>0). Every % / SPLH figure divides matching numerator and denominator over
      // exactly these days. This is the fix for the year-view SPLH nonsense.
      const interDept = rowsOf(q(
        `SELECT ld.department AS department, SUM(ld.act_minutes) AS am,
                SUM(ld.act_cost_rc_pence) AS ac, SUM(ld.sched_cost_rc_pence) AS sc
           FROM labour_dept ld JOIN sales_day s ON s.business_date = ld.business_date
          WHERE ld.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0
          GROUP BY ld.department`, [from, to]));
      const interNet = rowsOf(q(
        `SELECT SUM(net) AS net, COUNT(*) AS days FROM (
           SELECT s.net_sales_pence AS net FROM sales_day s
            WHERE s.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0
              AND s.business_date IN (SELECT business_date FROM labour_dept WHERE business_date BETWEEN ? AND ?))`,
        [from, to, from, to]))[0] || null;

      const salesDays = rowsOf(q(`SELECT COUNT(*) AS n FROM sales_day WHERE business_date BETWEEN ? AND ? AND net_sales_pence > 0`, [from, to]))[0] || null;
      const names = [];
      for (const r of rowsOf(q(`SELECT rc_uncosted_names AS n FROM labour_dept WHERE business_date BETWEEN ? AND ? AND rc_uncosted_names != '[]'`, [from, to]))) {
        try { for (const nm of JSON.parse(r.n)) if (names.indexOf(nm) < 0) names.push(nm); } catch (e) { /* never take the tab down */ }
      }
      // Clock drift: rota'd vs worked per matched shift, £ at the shift's own PRE-BURDEN rate.
      const drift = rowsOf(q(`SELECT user_name, business_date, sched_minutes, act_minutes, variance_minutes, rate_pence FROM labour_shifts WHERE business_date BETWEEN ? AND ? AND variance_minutes IS NOT NULL AND variance_minutes != 0 ORDER BY ABS(variance_minutes) DESC LIMIT 8`, [from, to]));
      const driftTot = rowsOf(q(`SELECT SUM(CASE WHEN rate_pence IS NOT NULL THEN variance_minutes * rate_pence / 60.0 ELSE 0 END) AS pence, SUM(variance_minutes) AS mins FROM labour_shifts WHERE business_date BETWEEN ? AND ? AND variance_minutes IS NOT NULL`, [from, to]))[0] || null;
      // Staffing shape: worked minutes by hour (ruler-free — hours only, no sales needed).
      const byHour = rowsOf(q(`SELECT hour, SUM(actual_minutes) AS am FROM labour_hourly WHERE business_date BETWEEN ? AND ? GROUP BY hour ORDER BY hour`, [from, to]));
      return { from, to, depts, budgets, interDept, interNet, salesDays, uncostedNames: names.sort(), drift, driftTot, byHour };
    };

    const nav = NAV.resolveNav(ctx.query, maxDate, now, '/coyote/labour');
    const histRow = rowsOf(q('SELECT MIN(business_date) AS d FROM labour_dept'))[0];
    return {
      now, hasData: true, maxDate, nav,
      histStart: histRow && histRow.d ? String(histRow.d) : null,
      current: build(nav.from, nav.to),
      comparator: nav.comparator ? build(nav.comparator.from, nav.comparator.to) : null,
      headlineDay: build(maxDate, maxDate),
      parity: rowsOf(q(`SELECT user_name, role_name, kind, rc_value, locked_value FROM labour_rate_parity ORDER BY user_name, role_id`)),
      intraday: rowsOf(q(`SELECT business_date, department, as_of_ms, sched_minutes_full, sched_cost_rc_full, worked_minutes_so_far, cost_rc_so_far, uncosted_minutes, clocked_in_now, no_shows, ref_date, ref_worked_minutes, ref_net_pence, ref_to_hour FROM labour_intraday ORDER BY department`)),
      // Blended pre-burden £/hr per dept per week — senior-heavy drift shows here.
      blended: rowsOf(q(`SELECT department, strftime('%Y-%W', business_date) AS wk, MIN(business_date) AS wk_from, SUM(act_cost_rc_pence) AS ac, SUM(act_minutes) AS am FROM labour_dept WHERE department IN ('kitchen','foh') AND act_minutes > 0 GROUP BY department, wk ORDER BY wk`)),
      // U18 working-time flags — AGGREGATED per person/kind across ALL history (the systemic
      // pattern; a 20-row tail hid it). Rules cited at ingest (WTR 1998 young workers).
      wtr: rowsOf(q(`SELECT user_name, kind, COUNT(*) AS n, MAX(business_date) AS last FROM labour_wtr_flags GROUP BY user_name, kind`)),
      wtrTotal: rowsOf(q(`SELECT COUNT(*) AS n, COUNT(DISTINCT user_name) AS people, MIN(business_date) AS lo, MAX(business_date) AS hi FROM labour_wtr_flags`))[0] || null,
    };
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const gbp = S.fmtGbpPence;
    const hrs = (mn) => (num(mn) != null ? (num(mn) / 60).toFixed(1) + 'h' : '—');
    const pp = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}pp`;
    const DEPT_LABEL = { kitchen: 'Kitchen — Calum', foh: 'Front of House — Jordan', unassigned: 'Unassigned location' };
    const daysInMonth = (dstr) => new Date(Date.UTC(Number(dstr.slice(0, 4)), Number(dstr.slice(5, 7)), 0)).getUTCDate();

    const styles = `<style>
      .lb-two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
      @media(max-width:900px){.lb-two{grid-template-columns:1fr}}
      .lb-hint{font-size:12px;line-height:1.5;color:var(--muted,#8b98a5);margin:2px 0 12px}
      .lb-ruler{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--amber,#e0b050);margin-bottom:14px;font-weight:600}
      .lb-sec{font-size:15px;font-weight:700;color:var(--text,#e8edf2);margin:26px 0 12px;display:flex;align-items:center;gap:10px}
      .lb-sec::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.10)}
      .lb-sub{font-size:11px;font-weight:500;color:var(--muted,#8b98a5);text-transform:none;letter-spacing:0}
      .lb-head{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:14px;margin-bottom:8px}
      @media(max-width:820px){.lb-head{grid-template-columns:1fr}}
      .lb-hero{background:linear-gradient(135deg,rgba(255,255,255,.05),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:18px 20px}
      .lb-hero .lab{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#8b98a5)}
      .lb-hero .big{font-size:34px;font-weight:800;line-height:1.1;margin:6px 0 4px}
      .lb-hero .sub{font-size:12px;color:var(--muted,#8b98a5)}
      .lb-mini{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 16px}
      .lb-mini .lab{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b98a5)}
      .lb-mini .big{font-size:22px;font-weight:700;margin:4px 0 2px}
      .lb-mini .sub{font-size:11px;color:var(--muted,#8b98a5)}
      .lb-tbl{width:100%;border-collapse:collapse;font-size:13px}
      .lb-tbl th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b98a5);font-weight:600;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.10)}
      .lb-tbl td{padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.05)}
      .lb-tbl td.n{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono,ui-monospace,monospace)}
      .lb-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:4px 6px 10px}
      .lb-cardhead{font-size:13px;font-weight:700;padding:12px 12px 8px;display:flex;justify-content:space-between;align-items:baseline}
      .lb-bars{display:flex;align-items:flex-end;gap:3px;height:90px;padding:6px 10px 0}
      .lb-bar{flex:1;background:linear-gradient(180deg,var(--cyan,#22D3EE),#0e6f7d);border-radius:3px 3px 0 0;min-height:2px;position:relative}
      .lb-bar span{position:absolute;bottom:-16px;left:0;right:0;text-align:center;font-size:9px;color:var(--muted,#7a8695)}
      .lb-hb{display:grid;grid-template-columns:130px 1fr 84px;gap:8px;align-items:center;padding:3px 12px;font-size:12px}
      .lb-hb .track{background:rgba(255,255,255,.06);border-radius:4px;height:14px;position:relative;overflow:hidden}
      .lb-hb .fill{position:absolute;top:0;bottom:0;border-radius:4px}
      .lb-hb .amt{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono,ui-monospace,monospace)}
      .lb-spark{display:block}
      .lb-pill{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px}
      .lb-live{border:1px solid var(--cyan-dim,rgba(34,211,238,.28));border-radius:14px;padding:2px 16px 14px;margin-bottom:6px;background:rgba(34,211,238,.03)}
      .G{color:var(--green,#34d399)} .A{color:var(--amber,#e0b050)} .R{color:var(--red,#f87171)}
      .bg-G{background:rgba(52,211,153,.16);color:#7ee7c0} .bg-A{background:rgba(224,176,80,.16);color:#f0cd88} .bg-R{background:rgba(248,113,113,.16);color:#f9a8a8}
    </style>`;

    if (!m.hasData) {
      return { stamp: 'awaiting labour data', body: styles + `<div class="lb-ruler">Manager scorecard — pre-burden, matches RotaCloud</div><div class="banner muted">No department labour yet. The RotaCloud ingest (hourly at :35) fills this in; nothing here is ever estimated. True cost (burden + salaried/365) lives in <a href="/coyote/reports">Reports</a>.</div>` };
    }

    // ---- small chart helpers (inline SVG / CSS, no deps) ----
    const spark = (vals, w, h) => {
      const nums = vals.filter((v) => v != null);
      if (nums.length < 2) return '';
      const lo = Math.min(...nums), hi = Math.max(...nums), rng = hi - lo || 1;
      const pts = vals.map((v, i) => v == null ? null : `${(i / (vals.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - lo) / rng) * (h - 6)).toFixed(1)}`).filter(Boolean).join(' ');
      const last = vals[vals.length - 1];
      const lx = (w - 2).toFixed(1), ly = (h - 3 - ((last - lo) / rng) * (h - 6)).toFixed(1);
      return `<svg class="lb-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="var(--cyan,#22D3EE)" stroke-width="1.6" points="${pts}"/><circle cx="${lx}" cy="${ly}" r="2.2" fill="var(--cyan,#22D3EE)"/></svg>`;
    };

    // ---- HEADLINE: yesterday's £-consequence on THIS ruler (£ first, % subtitle) ----
    const headline = () => {
      const day = m.headlineDay;
      const known = (day.depts || []).filter((d) => d.department === 'kitchen' || d.department === 'foh');
      const ac = known.reduce((x, d) => x + (num(d.ac) || 0), 0);
      const bud = (day.budgets || []).reduce((x, b) => x + (num(b.budget_pence) || 0), 0);
      const net = day.interNet && num(day.interNet.net) > 0 ? num(day.interNet.net) : null;
      const schedMin = known.reduce((x, d) => x + (num(d.sm) || 0), 0);
      const actMin = known.reduce((x, d) => x + (num(d.am) || 0), 0);
      const varMin = actMin - schedMin;
      let heroCell;
      if (known.length && bud) {
        const delta = ac - Math.round(bud);
        const cls = delta <= 0 ? 'G' : 'R';
        heroCell = `<div class="lb-hero"><div class="lab">Latest settled day (${esc(m.maxDate)}) vs the managers' budgets — scorecard ruler</div>
          <div class="big ${cls}">${delta <= 0 ? gbp(-delta) + ' under' : gbp(delta) + ' OVER'}</div>
          <div class="sub">spent ${gbp(ac)} against ${gbp(Math.round(bud))} budgeted${net != null ? ` · ${((ac / net) * 100).toFixed(1)}% of net vs ${((bud / net) * 100).toFixed(1)}% budgeted` : ''} · pre-burden</div></div>`;
      } else {
        heroCell = `<div class="lb-hero"><div class="lab">Latest settled day (${esc(m.maxDate)}) — scorecard ruler</div>
          <div class="big">${gbp(ac)}</div>
          <div class="sub">pre-burden labour · no RotaCloud budget set for this day</div></div>`;
      }
      return `<div class="lb-head">${heroCell}
        <div class="lb-mini"><div class="lab">Rota'd → worked</div><div class="big">${hrs(schedMin)} → ${hrs(actMin)}</div><div class="sub ${varMin > 0 ? 'A' : ''}">${varMin >= 0 ? '+' : '−'}${hrs(Math.abs(varMin))} vs rota</div></div>
        <div class="lb-mini"><div class="lab">Labour % of net</div><div class="big${net != null ? '' : ''}">${net != null ? ((ac / net) * 100).toFixed(1) + '%' : '—'}</div><div class="sub">${net != null ? 'true cost in Reports' : 'needs sales'}</div></div>
      </div>`;
    };

    // ---- SCORECARD dept block: hours + pre-burden cost + budget/variance + pacing ----
    const deptBlock = (p, d, isMonth) => {
      const b = (p.budgets || []).find((x) => x.department === d.department) || null;
      const budget = b && num(b.budget_pence) != null ? Math.round(num(b.budget_pence)) : null;
      const pctTarget = b && num(b.pct_min) != null
        ? (num(b.pct_min) === num(b.pct_max) ? (num(b.pct_min) * 100).toFixed(1) + '%' : `${(num(b.pct_min) * 100).toFixed(1)}–${(num(b.pct_max) * 100).toFixed(1)}%`)
        : null;
      const targetPct = b && num(b.pct_min) === num(b.pct_max) ? num(b.pct_min) * 100 : null;

      const rows = [];
      rows.push(`<tr><td>Budget (RotaCloud)</td><td class="n">—</td><td class="n">${budget != null ? gbp(budget) : '<span class="ash">not set</span>'}</td><td class="n">${pctTarget != null ? esc(pctTarget) : '—'}</td></tr>`);
      rows.push(`<tr><td>Scheduled (rota)</td><td class="n">${hrs(d.sm)}</td><td class="n">${gbp(d.sc)}</td><td class="n">—</td></tr>`);
      rows.push(`<tr><td>Actual (clocked)</td><td class="n">${hrs(d.am)}</td><td class="n">${gbp(d.ac)}</td><td class="n">—</td></tr>`);

      const varLines = [];
      if (budget != null && num(d.sc) != null) { const v = num(d.sc) - budget; varLines.push(`planned vs budget: ${v >= 0 ? '+' : '−'}${gbp(Math.abs(v))}`); }
      if (budget != null && num(d.ac) != null) { const v = num(d.ac) - budget; varLines.push(`landed vs budget: ${v >= 0 ? '+' : '−'}${gbp(Math.abs(v))}`); }
      const uncosted = (num(d.usm) || 0) > 0 || (num(d.uam) || 0) > 0
        ? `<div class="lb-hint">⚠️ ${hrs(Math.max(num(d.usm) || 0, num(d.uam) || 0))} at £0 in RotaCloud (no stored rate) — matches what the manager sees in-app; the real cost of these staff lives in <a href="/coyote/reports">Reports</a>.</div>`
        : '';

      // BONUS PACING (month only) — arithmetic restatement of the MTD ledger, no projection.
      let pacing = '';
      if (isMonth && budget != null && num(d.ac) != null) {
        const delta = num(d.ac) - budget;
        const covered = num(d.days) || 0;
        const lastSettled = m.maxDate < p.to ? m.maxDate : p.to;
        const remaining = Math.max(0, daysInMonth(p.from) - Number(lastSettled.slice(8, 10)));
        if (remaining === 0) pacing = `<div class="lb-hint"><b>${delta > 0 ? '🔴' : '🟢'} Month closed ${delta > 0 ? gbp(delta) + ' OVER' : gbp(-delta) + ' under'} budget</b> across ${esc(String(covered))} settled day(s).</div>`;
        else if (delta > 0) pacing = `<div class="lb-hint"><b>🔴 ${gbp(delta)} over budget</b> through ${esc(String(covered))} settled day(s) — the remaining ${esc(String(remaining))} day(s) must run a combined ${gbp(delta)} UNDER their daily budgets to land the month (≈${gbp(Math.round(delta / remaining))}/day).</div>`;
        else pacing = `<div class="lb-hint"><b>🟢 ${gbp(-delta)} under budget</b> through ${esc(String(covered))} settled day(s) — a cushion of ≈${gbp(Math.round(-delta / remaining))}/day for the remaining ${esc(String(remaining))} day(s).</div>`;
      }

      return `<div class="lb-card"><div class="lb-cardhead">${esc(DEPT_LABEL[d.department] || d.department)}${targetPct != null ? `<span class="lb-sub">target ${esc(pctTarget)}</span>` : ''}</div>
        <table class="lb-tbl"><thead><tr><th></th><th style="text-align:right">hours</th><th style="text-align:right">cost (pre-burden)</th><th style="text-align:right">target %</th></tr></thead><tbody>${rows.join('')}</tbody></table>
        ${varLines.length ? `<div class="lb-hint" style="margin:8px 12px 0">${esc(varLines.join(' · '))}</div>` : ''}
        ${pacing}${uncosted}</div>`;
    };

    // ---- CROSS-RULER block: % of net + SPLH over the sales∩labour intersection ONLY ----
    const crossRulerBlock = (p, label) => {
      const known = ['kitchen', 'foh'].map((k) => (p.interDept || []).find((d) => d.department === k)).filter(Boolean);
      const interNet = p.interNet && num(p.interNet.net) > 0 ? num(p.interNet.net) : null;
      const interDays = p.interNet ? (num(p.interNet.days) || 0) : 0;
      const coveredLabour = p.depts && p.depts.length ? Math.max.apply(null, p.depts.map((d) => num(d.days) || 0)) : 0;
      if (interNet == null || interDays === 0) {
        return `<div class="lb-sec">Labour % of net &amp; SPLH <span class="lb-sub">cross-ruler</span></div>
          <div class="banner muted">Needs sales history — no day in this period has both a labour record and sales yet, so labour % and SPLH can't be computed honestly. They light up as the sales backfill lands. (Hours and pre-burden cost above stand alone.)</div>`;
      }
      const budgets = p.budgets || [];
      const totMin = known.reduce((x, d) => x + (num(d.am) || 0), 0);
      const cell = (deptKey, cost) => {
        if (cost == null || interNet == null) return '—';
        const pct = (cost / interNet) * 100;
        const b = budgets.find((x) => x.department === deptKey);
        const t = b && num(b.pct_min) === num(b.pct_max) ? num(b.pct_min) * 100 : null;
        const cls = t == null ? '' : pct <= t ? ' class="G"' : pct <= t + 1 ? ' class="A"' : ' class="R"';
        return `<span${cls}>${pct.toFixed(1)}%</span>`;
      };
      const splh = (mn) => (mn > 0 ? gbp(Math.round(interNet / (mn / 60))) : '—');
      const rows = known.map((d) => `<tr><td>${esc((DEPT_LABEL[d.department] || d.department).split(' — ')[0])}</td>
        <td class="n">${cell(d.department, num(d.sc))}</td><td class="n">${cell(d.department, num(d.ac))}</td><td class="n">${splh(num(d.am) || 0)}</td></tr>`).join('');
      const partial = interDays < coveredLabour;
      return `<div class="lb-sec">Labour % of net &amp; SPLH <span class="lb-sub">cross-ruler · over ${esc(String(interDays))} day${interDays === 1 ? '' : 's'} with sales</span></div>
        <div class="lb-card"><table class="lb-tbl"><thead><tr><th>dept</th><th style="text-align:right">scheduled %</th><th style="text-align:right">actual %</th><th style="text-align:right">SPLH</th></tr></thead>
        <tbody>${rows}<tr><td><b>Site</b></td><td class="n">—</td><td class="n">—</td><td class="n"><b>${splh(totMin)}</b></td></tr></tbody></table>
        <div class="lb-hint" style="margin:8px 12px 0">Actual % vs each dept's RotaCloud target (green on/under · amber ≤1pp · red over). SPLH = site net ÷ worked hours; target line arrives once the backfill gives our own best-week baseline — no invented benchmark until then.${partial ? ` Labour covers ${esc(String(coveredLabour))} day(s) here but only ${esc(String(interDays))} have sales — these cross-ruler figures use just those ${esc(String(interDays))}.` : ''}</div></div>`;
    };

    // ---- staffing shape: worked minutes by hour (ruler-free) ----
    const staffingShape = (p) => {
      const hoursArr = (p.byHour || []).filter((h) => num(h.am) != null && num(h.am) > 0);
      if (hoursArr.length < 2) return '';
      const mx = Math.max(...hoursArr.map((h) => num(h.am) || 0)) || 1;
      const bars = hoursArr.map((h) => { const hh = num(h.hour) >= 24 ? num(h.hour) - 24 : num(h.hour); return `<div class="lb-bar" style="height:${Math.max(2, Math.round((num(h.am) || 0) / mx * 80))}px" title="${esc(String(hh))}:00 — ${hrs(h.am)}"><span>${esc(String(hh))}</span></div>`; }).join('');
      return `<div class="lb-sec">Staffing shape <span class="lb-sub">worked hours by hour of day · scorecard ruler</span></div>
        <div class="lb-card"><div class="lb-bars">${bars}</div><div style="height:14px"></div>
        <div class="lb-hint" style="margin:0 12px">Where worked hours land across the day — the shape you flex against trade (cross-check the sales curve on <a href="/coyote/reports">Reports</a>).</div></div>`;
    };

    // ---- clock drift: ranked bars + detail table ----
    const driftBlock = (p, label) => {
      if (!p.drift || !p.drift.length) return '';
      const withCost = p.drift.map((r) => ({ ...r, dp: num(r.rate_pence) != null && num(r.variance_minutes) != null ? Math.round((num(r.variance_minutes) * num(r.rate_pence)) / 60) : null }));
      const mx = Math.max(1, ...withCost.map((r) => Math.abs(r.dp || 0)));
      const bars = withCost.filter((r) => r.dp != null).slice(0, 6).map((r) => {
        const w = Math.round(Math.abs(r.dp) / mx * 100);
        const over = (num(r.variance_minutes) || 0) > 0;
        return `<div class="lb-hb"><div>${esc(r.user_name || '')}</div><div class="track"><div class="fill" style="width:${w}%;background:${over ? 'var(--amber,#e0b050)' : 'var(--cyan,#22D3EE)'}"></div></div><div class="amt ${over ? 'A' : ''}">${r.dp >= 0 ? '+' : '−'}${gbp(Math.abs(r.dp))}</div></div>`;
      }).join('');
      const dRows = withCost.map((r) => { const v = num(r.variance_minutes) || 0; return `<tr><td>${esc(r.user_name || '')}</td><td class="n">${esc(String(r.business_date))}</td><td class="n">${hrs(r.sched_minutes)}</td><td class="n">${hrs(r.act_minutes)}</td><td class="n${v > 0 ? ' A' : ''}">${v >= 0 ? '+' : '−'}${hrs(Math.abs(v))}</td><td class="n">${r.dp != null ? (r.dp >= 0 ? '+' : '−') + gbp(Math.abs(r.dp)) : '— <span class="ash">(salaried)</span>'}</td></tr>`; }).join('');
      const tot = p.driftTot && num(p.driftTot.pence) != null ? Math.round(num(p.driftTot.pence)) : null;
      return `<div class="lb-sec">Clock drift <span class="lb-sub">rota'd vs worked · ${esc(label)}</span></div>
        <div class="lb-card">${bars ? `<div style="padding:8px 0 4px">${bars}</div>` : ''}
        <table class="lb-tbl"><thead><tr><th>who</th><th style="text-align:right">date</th><th style="text-align:right">rota'd</th><th style="text-align:right">worked</th><th style="text-align:right">Δ hours</th><th style="text-align:right">Δ £ pre-burden</th></tr></thead><tbody>${dRows}</tbody></table>
        ${tot != null ? `<div class="lb-hint" style="margin:8px 12px 0">Period drift total: <b>${tot >= 0 ? '+' : '−'}${gbp(Math.abs(tot))}</b> pre-burden (${esc(hrs(Math.abs(num(p.driftTot.mins) || 0)))} ${num(p.driftTot.mins) >= 0 ? 'over' : 'under'} rota). Positive = worked ran past the plan.</div>` : ''}</div>`;
    };

    // ---- period body ----
    const periodBody = (p, label, isMonth) => {
      const covered = p.depts && p.depts.length ? Math.max.apply(null, p.depts.map((d) => num(d.days) || 0)) : 0;
      if (!covered) return `<div class="banner muted">No record for this period — history starts ${esc(m.histStart || '(no labour history yet)')}. Nothing is interpolated; days without a record are never shown as zeros.</div>`;
      const order = ['kitchen', 'foh'];
      const known = order.map((k) => (p.depts || []).find((d) => d.department === k)).filter(Boolean);
      const parts = [`<div class="lb-two">${known.map((d) => deptBlock(p, d, isMonth)).join('')}</div>`];
      parts.push(crossRulerBlock(p, label));
      parts.push(staffingShape(p));
      parts.push(driftBlock(p, label));
      const un = (p.depts || []).find((d) => d.department === 'unassigned');
      if (un) parts.push(`<div class="banner">⚠️ ${hrs(un.sm)} rota'd / ${hrs(un.am)} clocked on an UNKNOWN RotaCloud location — not guessed into a department; fix the location in RotaCloud.</div>`);
      return parts.filter(Boolean).join('\n');
    };

    // ---- blended rate: sparkline per dept + current £/hr + Δ ----
    const blendedHtml = () => {
      const by = { kitchen: [], foh: [] };
      for (const r of m.blended || []) if (by[r.department]) by[r.department].push(r);
      const weeks = Math.max(by.kitchen.length, by.foh.length);
      if (!weeks) return '';
      const card = (dept) => {
        const series = by[dept].map((r) => (num(r.am) > 0 ? num(r.ac) / (num(r.am) / 60) : null));
        const cur = series.length ? series[series.length - 1] : null;
        const prev = series.length > 1 ? series[series.length - 2] : null;
        const dlt = cur != null && prev != null ? cur - prev : null;
        return `<div class="lb-card"><div class="lb-cardhead">${esc((DEPT_LABEL[dept] || dept).split(' — ')[0])}<span class="lb-sub">${cur != null ? gbp(Math.round(cur)) + '/h' : '—'}${dlt != null ? ` · <span class="${dlt > 0 ? 'A' : 'G'}">${dlt >= 0 ? '+' : '−'}${gbp(Math.round(Math.abs(dlt)))} vs prior wk</span>` : ''}</span></div>
          <div style="padding:6px 12px 12px">${series.filter((x) => x != null).length >= 2 ? spark(series, 260, 46) : '<span class="lb-hint">Thin history — the trend needs a second week to say anything; it appears as the record grows.</span>'}</div></div>`;
      };
      return `<div class="lb-sec">Blended rate <span class="lb-sub">pre-burden £/hr by week — catches senior-heavy scheduling</span></div><div class="lb-two">${card('kitchen')}${card('foh')}</div>`;
    };

    // ---- U18 WORKING-TIME GUARD: aggregate per-person breach summary ----
    const wtrHtml = () => {
      const flags = m.wtr || [];
      if (!flags.length) return `<div class="banner muted">U18 working-time ✓ — no flags (8h/day · 40h/wk fixed · 22:00+ surfaced · 00:00–04:00 absolute; re-checked every ingest).</div>`;
      const t = m.wtrTotal || {};
      const byUser = new Map();
      for (const f of flags) {
        const u = byUser.get(f.user_name) || { name: f.user_name, day_over_8h: 0, week_over_40h: 0, night_22_24: 0, night_00_04: 0, last: '' };
        u[f.kind] = num(f.n) || 0;
        if (String(f.last) > u.last) u.last = String(f.last);
        byUser.set(f.user_name, u);
      }
      const people = [...byUser.values()].sort((a, b) => (b.day_over_8h + b.week_over_40h + b.night_00_04) - (a.day_over_8h + a.week_over_40h + a.night_00_04) || (b.night_22_24 - a.night_22_24));
      const cellR = (n) => n > 0 ? `<span class="R">${n}</span>` : '<span class="ash">0</span>';
      const cellA = (n) => n > 0 ? `<span class="A">${n}</span>` : '<span class="ash">0</span>';
      const rows = people.map((u) => `<tr><td>${esc(u.name || '')}</td><td class="n">${cellR(u.day_over_8h)}</td><td class="n">${cellR(u.week_over_40h)}</td><td class="n">${cellR(u.night_00_04)}</td><td class="n">${cellA(u.night_22_24)}</td><td class="n"><span class="ash">${esc(u.last)}</span></td></tr>`).join('');
      const hardTotal = people.reduce((x, u) => x + u.day_over_8h + u.week_over_40h + u.night_00_04, 0);
      const span = t.lo && t.hi ? ` ${esc(String(t.lo))} → ${esc(String(t.hi))}` : '';
      return `<div class="banner">🔴 <b>${num(t.n) || flags.reduce((x, f) => x + (num(f.n) || 0), 0)} U18 working-time flag${(num(t.n) || 0) === 1 ? '' : 's'}</b> across ${esc(String(num(t.people) || byUser.size))} young worker${(num(t.people) || 0) === 1 ? '' : 's'}${span}. <b class="R">${hardTotal}</b> are HARD legal limits (over-8h day / over-40h week / worked-past-midnight — no catering exception); the amber column is the permitted-with-conditions 22:00–24:00 window.</div>
        <div class="lb-card"><table class="lb-tbl"><thead><tr><th>young worker</th><th style="text-align:right" class="R">over 8h day</th><th style="text-align:right" class="R">over 40h wk</th><th style="text-align:right" class="R">past midnight</th><th style="text-align:right" class="A">past 22:00</th><th style="text-align:right">last</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="lb-hint" style="margin:8px 12px 0">Limits: 8h/day &amp; 40h/week are fixed with no averaging (gov.uk/maximum-weekly-working-hours); 22:00–06:00 is restricted but catering is an excepted sector, while 00:00–04:00 is an absolute ban (gov.uk/night-working-hours). The red columns are rota-policy action items — raise with Calum &amp; Jordan.</div></div>`;
    };

    const parityHtml = () => {
      if (!m.parity || m.parity.length === 0) return `<div class="banner muted">Rate parity ✓ — locked 2026/27 table and RotaCloud's stored rates agree (re-checked every ingest).</div>`;
      const KIND = { role_rate_mismatch: 'rate differs', rc_missing_rate: 'no rate in RotaCloud (costs £0 in-app)', locked_missing_rate: 'not in locked table', salary_mismatch: 'salary differs', rc_missing_salary: 'salary missing in RotaCloud' };
      const rows = m.parity.map((x) => `<tr><td>${esc(x.user_name || '')}</td><td>${esc(x.role_name || '—')}</td><td>${esc(KIND[x.kind] || x.kind)}</td><td class="n">${esc(x.rc_value || '—')}</td><td class="n">${esc(x.locked_value || '—')}</td></tr>`).join('');
      return `<div class="banner">🔴 <b>${m.parity.length} rate discrepanc${m.parity.length === 1 ? 'y' : 'ies'}</b> between RotaCloud and the locked 2026/27 table — the managers' in-app % uses <i>their</i> rates, so this scorecard is unfair until fixed <b>in RotaCloud</b>.</div>
        <div class="lb-card"><table class="lb-tbl"><thead><tr><th>who</th><th>role</th><th>finding</th><th style="text-align:right">RotaCloud</th><th style="text-align:right">locked table</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    };

    // ---- TODAY — live panel (only on the landing view; own honesty) ----
    const livePanel = () => {
      const rows = (m.intraday || []).filter((r) => r.department !== 'unassigned');
      const un = (m.intraday || []).find((r) => r.department === 'unassigned');
      if (!rows.length && !un) return `<div class="lb-sec">Today — live</div><div class="banner muted">No intraday snapshot yet — the hourly pull (at :35) fills this in. Settled days appear below after the morning run.</div>`;
      const asOf = num(rows[0] && rows[0].as_of_ms) || num(un && un.as_of_ms);
      const lonTime = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
      const ageMin = asOf != null ? Math.round((m.now - asOf) / 60000) : null;
      const stale = ageMin != null && ageMin > 130;
      const blocks = rows.map((r) => {
        let inNow = []; try { inNow = JSON.parse(r.clocked_in_now || '[]'); } catch (e) { /* keep going */ }
        const names = inNow.map((x) => `${esc(x.name)} <span class="ash">${lonTime(num(x.since_ms))}</span>`).join(' · ');
        let noShows = []; try { noShows = JSON.parse(r.no_shows || '[]'); } catch (e) { /* keep going */ }
        const noShowHtml = noShows.length ? `<tr><td class="R">NO-SHOW (15min+)</td><td class="R">${noShows.map((x) => `${esc(x.name)} <span class="mono">rota'd ${lonTime(num(x.rota_start_ms))}</span>`).join(' · ')}</td></tr>` : '';
        return `<div class="lb-card"><div class="lb-cardhead">${esc(DEPT_LABEL[r.department] || r.department)}</div>
          <table class="lb-tbl"><tbody>${noShowHtml}
            <tr><td>Clocked in now (${inNow.length})</td><td>${names || '<span class="ash">nobody</span>'}</td></tr>
            <tr><td>Worked so far</td><td class="n">${hrs(r.worked_minutes_so_far)} · ${gbp(r.cost_rc_so_far)} pre-burden</td></tr>
            <tr><td>Rota'd today (full day)</td><td class="n">${hrs(r.sched_minutes_full)} · ${gbp(r.sched_cost_rc_full)}</td></tr>
          </tbody></table>
          ${num(r.uncosted_minutes) ? `<div class="lb-hint" style="margin:0 12px">${hrs(r.uncosted_minutes)} so far at £0 in the scorecard ruler (salaried/unrated) — true cost lands in Reports tomorrow.</div>` : ''}</div>`;
      }).join('');
      const r0 = rows[0] || un;
      let refLine = '';
      if (r0 && r0.ref_date != null) {
        const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(String(r0.ref_date) + 'T12:00:00Z').getUTCDay()];
        const soFarMin = rows.reduce((x, rr) => x + (num(rr.worked_minutes_so_far) || 0), 0);
        refLine = `<div class="lb-hint">Reference — last ${esc(wd)} (${esc(String(r0.ref_date))}, settled) by ${esc(String(num(r0.ref_to_hour)))}:00: ${hrs(r0.ref_worked_minutes)} worked · ${gbp(r0.ref_net_pence)} net taken. Today so far: ${hrs(soFarMin)}. Context only — never a projection.</div>`;
      } else if (r0) {
        refLine = `<div class="lb-hint">No settled same-weekday reference exists yet (thin history) — context arrives as the record grows; nothing is borrowed from other weekdays.</div>`;
      }
      return `<div class="lb-sec">Today — live <span class="lb-sub">${esc(rows[0] ? String(rows[0].business_date) : '')} · ${asOf != null ? (stale ? '⚠️ STALE, last snapshot ' : 'as of ') + esc(lonTime(asOf)) + (stale ? ` (${Math.round(ageMin / 60)}h ago — check coyote-rotacloud-ingest)` : ', refreshes hourly at :35') : ''} · partial-day figures, never a day result</span></div>`
        + `<div class="lb-live">${refLine}<div class="lb-two">${blocks}</div>${un ? `<div class="banner">⚠️ ${hrs(un.worked_minutes_so_far)} today on an UNKNOWN RotaCloud location — fix the location in RotaCloud.</div>` : ''}</div>`;
    };

    // Custom-range comparator (scorecard cost vs the preceding same-length window).
    const comparatorHtml = () => {
      if (!m.nav.comparator || !m.comparator) return '';
      const sumAc = (per) => (per.depts || []).filter((d) => d.department !== 'unassigned').reduce((x, d) => x + (num(d.ac) || 0), 0);
      const cur = sumAc(m.current), prevC = sumAc(m.comparator);
      const prevDays = (m.comparator.depts || []).length ? Math.max.apply(null, m.comparator.depts.map((d) => num(d.days) || 0)) : 0;
      if (!prevDays) return `<div class="lb-hint">Comparator (${esc(m.nav.comparator.label)}): no record — history starts ${esc(m.histStart || '?')}.</div>`;
      const dlt = cur - prevC;
      const curDays = (m.current.depts || [])[0] ? num(m.current.depts[0].days) || 0 : 0;
      return `<div class="lb-hint">vs ${esc(m.nav.comparator.label)}: labour ${gbp(prevC)} → ${gbp(cur)} (${dlt >= 0 ? '+' : '−'}${gbp(Math.abs(dlt))}, pre-burden${prevDays < curDays ? ` · comparator covers only ${prevDays} day(s)` : ''}).</div>`;
    };

    // Live panel shows ONLY on the landing view (period=day at the latest settled day) —
    // navigating to a historical period must not surface today's live snapshot.
    const showLive = m.nav.period === 'day' && m.nav.from === m.maxDate;

    const body = styles
      + `<style>${NAV.NAV_CSS}</style>`
      + `<div class="lb-ruler">Manager scorecard — pre-burden, matches RotaCloud · never compare with Reports' true cost (burden + salaried/365)</div>`
      + headline()
      + (showLive ? livePanel() : '')
      + `<div class="lb-sec">Analysis <span class="lb-sub">${m.nav.period === 'month' ? 'calendar month = the bonus period' : 'navigate periods below'}</span></div>`
      + NAV.renderNavStrip(m.nav, '/coyote/labour', esc)
      + comparatorHtml()
      + periodBody(m.current, m.nav.label, m.nav.period === 'month')
      + blendedHtml()
      + `<div class="lb-sec">U18 working-time guard <span class="lb-sub">WTR 1998 young workers — all history</span></div>`
      + wtrHtml()
      + `<div class="lb-sec">Rate parity <span class="lb-sub">locked table vs RotaCloud</span></div>`
      + parityHtml();

    return { stamp: `labour · <span class="mono">RotaCloud · ${esc(m.maxDate)}</span>`, body };
  },
};
