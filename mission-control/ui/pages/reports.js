'use strict';
// Reports — the daily sales flash from Lightspeed (Slice 1). Contract: { key, route, title, sub, getSection, render }.
// SELECT-only via ctx.q (no writes). NO-FABRICATION rules baked in:
//   • "Covers" from Lightspeed is a POS guest-count, NOT real covers → stored as pos_guest_count, shown
//     ONLY as an honest, clearly-labelled cross-check; real covers come from OpenTable (not wired), so
//     Covers + every cover-derived metric (spend-per-cover / RevPASH) render "not wired — OpenTable".
//   • Margin needs recipes (Slice 2) → shows "not costed yet — X% coverage" (NULL, never an estimate).
//   • Everything POS-truthful ships live: net (ex-VAT), transactions, ATV (net÷txn), channel split,
//     sales-by-hour, payment reconciliation, category performance, best/worst products, discounts/voids.
// Daily/Weekly/Monthly is a client-side toggle over server-rendered periods (no network call from here).
const S = require('../shared.js');
const NAV = require('../period-nav.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function addDays(d, n) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

module.exports = {
  key: 'reports', route: '/reports', title: 'Reports',
  sub: 'Daily sales flash · Lightspeed — POS-truthful KPIs (covers via OpenTable, not wired)',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') return { now, hasData: false };
    const maxRow = rowsOf(q('SELECT MAX(business_date) AS d FROM sales_day'))[0];
    const maxDate = maxRow && maxRow.d ? String(maxRow.d) : null;
    if (!maxDate) return { now, hasData: false };

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

    const nav = NAV.resolveNav(ctx.query, maxDate, now, '/reports');
    const histRow = rowsOf(q('SELECT MIN(business_date) AS d FROM sales_day'))[0];
    return {
      now, hasData: true, maxDate, nav,
      histStart: histRow && histRow.d ? String(histRow.d) : null,
      current: build(nav.from, nav.to),
      comparator: nav.comparator ? build(nav.comparator.from, nav.comparator.to) : null,
    };
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const gbp = S.fmtGbpPence;
    const int = S.fmtInt;
    if (!m.hasData) {
      return { stamp: 'awaiting sales data', body: `<div class="banner muted">No Lightspeed sales yet. The daily ingest (05:30) pulls yesterday's exports into the box; KPIs appear here after the first run.</div>` };
    }
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
    </style>`;

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
        const hrs = (mn) => (num(mn) != null ? (num(mn) / 60).toFixed(1) + 'h' : '—');
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
          <div class="tile"><div class="lab">Rota'd → worked</div><div class="val">${hrs(lb.sm)} → ${hrs(lb.am)}</div><div class="sub">${varMin != null ? (varMin >= 0 ? '+' : '−') + hrs(Math.abs(varMin)) + ' vs rota' : '—'} · paid ${hrs(lb.pm)}</div></div>
          <div class="tile"><div class="lab">Scheduled cost</div><div class="val">${gbp(lb.sc)}</div><div class="sub">what the rota would cost</div></div>
          ${num(lb.uam) || num(lb.usm) ? `<div class="tile rp-notwired"><div class="lab">Unmapped staff</div><div class="val">${hrs(Math.max(num(lb.uam) || 0, num(lb.usm) || 0))}</div><div class="sub">hours counted, cost EXCLUDED — ${esc(p.labNames.join(', ') || 'names in labour_day')} · fix rates.ts</div></div>` : ''}
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
            return `<tr><td class="mono">${esc(String(hh))}:00</td><td class="mono">${sNet != null ? gbp(sNet) : '—'}</td><td class="mono">${l ? gbp(Math.round(l.ac)) : '—'}</td><td class="mono ash">${l ? hrs(l.am) : '—'}</td><td class="mono"${hpColor ? ` style="color:${hpColor}"` : ''}>${hp != null ? hp.toFixed(0) + '%' : '—'}</td><td class="mono ash">${hourSplh}</td></tr>`;
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
        parts.push(`<div class="banner muted">Not costed yet — <b>0% coverage</b>. Margin lights up once recipes/ingredient costs are entered in <a href="/recipes">Recipes &amp; Costs</a> (Slice 2). We never estimate a cost we don't have. <span class="ash">(Lightspeed's own margin figures are stored as a cross-check, not shown as truth.)</span></div>`);
      } else {
        parts.push(`<div class="banner muted">Recipes cover <b>${(covPct * 100).toFixed(1)}%</b> of product sales — margin shown for costed items only; the rest is a visible gap, never estimated.</div>`);
      }
      return parts.join('\n');
    };

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
      + NAV.renderNavStrip(m.nav, '/reports', esc)
      + comparatorHtml
      + periodBody(m.current, m.nav.label);

    return { stamp: `sales · <span class="mono">Lightspeed · ${esc(m.maxDate)}</span>`, body };
  },
};
