'use strict';
// Labour Analysis — the MANAGER SCORECARD. Contract: { key, route, title, sub, getSection, render }.
// SELECT-only via ctx.q. This is the SECOND ruler and the page never mixes the two:
//   • THIS TAB: PRE-BURDEN, mirrors RotaCloud's own arithmetic (their per-user rates, no
//     15.9% employer burden, no salaried/365) — the numbers Calum (Kitchen) and Jordan
//     (FOH) manage against in RotaCloud forecasting. Staff RotaCloud costs at £0 (no
//     stored rate) are SURFACED as uncosted, never absorbed.
//   • REPORTS TAB: TRUE COST (burden + salaried/365) — the operating truth.
// Layers per department: BUDGET (RotaCloud daily_revenue labour %) / SCHEDULED (rota) /
// ACTUAL (clocked, paid basis, deemed-Jordan rule upstream). % of net ex-VAT computed
// against SAME-DAY site net only. MONTHLY = calendar month of the latest labour day —
// the bonus period. Rate-parity discrepancies (locked table vs RotaCloud stored rates)
// are named: the managers' in-app % uses THEIR rates, so a drift makes the scorecard
// unfair until fixed IN ROTACLOUD.
const S = require('../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function addDays(d, n) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

module.exports = {
  key: 'labour', route: '/labour', title: 'Labour Analysis',
  sub: 'Manager scorecard · PRE-BURDEN, matches RotaCloud — true cost lives in Reports',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') return { now, hasData: false };
    const maxRow = rowsOf(q('SELECT MAX(business_date) AS d FROM labour_dept'))[0];
    const maxDate = maxRow && maxRow.d ? String(maxRow.d) : null;
    if (!maxDate) return { now, hasData: false };

    const build = (from, to) => {
      const depts = rowsOf(q(
        `SELECT department, SUM(sched_minutes) AS sm, SUM(act_minutes) AS am,
                SUM(sched_cost_rc_pence) AS sc, SUM(act_cost_rc_pence) AS ac,
                SUM(rc_uncosted_sched_min) AS usm, SUM(rc_uncosted_act_min) AS uam,
                COUNT(*) AS days
           FROM labour_dept WHERE business_date BETWEEN ? AND ? GROUP BY department`, [from, to]));
      // Budget £ per dept = Σ(day labour % × that day's net) — target spend given real trade.
      const budgets = rowsOf(q(
        `SELECT b.department AS department, SUM(b.labour_pct * s.net_sales_pence) AS budget_pence,
                MIN(b.labour_pct) AS pct_min, MAX(b.labour_pct) AS pct_max, COUNT(*) AS days
           FROM labour_budget b JOIN sales_day s ON s.business_date = b.business_date
          WHERE b.business_date BETWEEN ? AND ? GROUP BY b.department`, [from, to]));
      // % of net uses the SAME days labour covers — thin history never dilutes the %.
      const netRow = rowsOf(q(
        `SELECT SUM(s.net_sales_pence) AS net, COUNT(*) AS days FROM sales_day s
           JOIN (SELECT DISTINCT business_date FROM labour_dept WHERE business_date BETWEEN ? AND ?) l
             ON l.business_date = s.business_date`, [from, to]))[0] || null;
      const salesDays = rowsOf(q(`SELECT COUNT(*) AS n FROM sales_day WHERE business_date BETWEEN ? AND ?`, [from, to]))[0] || null;
      const names = [];
      for (const r of rowsOf(q(`SELECT rc_uncosted_names AS n FROM labour_dept WHERE business_date BETWEEN ? AND ? AND rc_uncosted_names != '[]'`, [from, to]))) {
        try { for (const nm of JSON.parse(r.n)) if (names.indexOf(nm) < 0) names.push(nm); } catch (e) { /* never take the tab down */ }
      }
      return { from, to, depts, budgets, net: netRow, salesDays, uncostedNames: names.sort() };
    };

    const monthStart = maxDate.slice(0, 8) + '01'; // calendar month = the bonus period
    return {
      now, hasData: true, maxDate,
      parity: rowsOf(q(`SELECT user_name, role_name, kind, rc_value, locked_value FROM labour_rate_parity ORDER BY user_name, role_id`)),
      periods: {
        day: build(maxDate, maxDate),
        week: build(addDays(maxDate, -6), maxDate),
        month: build(monthStart, maxDate),
      },
    };
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const gbp = S.fmtGbpPence;
    const styles = `<style>
      .lb-seg{display:inline-flex;gap:2px;background:rgba(255,255,255,.05);border-radius:9px;padding:3px;margin:2px 0 16px}
      .lb-seg button{font:inherit;font-size:13px;font-weight:600;color:var(--text-2,#9aa);background:none;border:0;padding:7px 16px;border-radius:7px;cursor:pointer}
      .lb-seg button.active{background:var(--cyan-dim,rgba(34,211,238,.15));color:#CFF6FB}
      .lb-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      @media(max-width:900px){.lb-two{grid-template-columns:1fr}}
      .lb-hint{font-size:11px;color:var(--muted,#7a8);margin:-4px 0 14px}
      .lb-ruler{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--amber,#e0b050);margin-bottom:10px}
    </style>`;

    if (!m.hasData) {
      return { stamp: 'awaiting labour data', body: styles + `<div class="lb-ruler">Manager scorecard — pre-burden, matches RotaCloud</div><div class="banner muted">No department labour yet. The RotaCloud ingest (06:35 / 18:05) fills this in; nothing here is ever estimated. True cost (burden + salaried/365) lives in <a href="/reports">Reports</a>.</div>` };
    }

    const DEPT_LABEL = { kitchen: 'Kitchen — Calum', foh: 'Front of House — Jordan', unassigned: 'Unassigned location' };
    const hrs = (mn) => (num(mn) != null ? (num(mn) / 60).toFixed(1) + 'h' : '—');
    const pp = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}pp`;

    const deptBlock = (p, d) => {
      const b = (p.budgets || []).find((x) => x.department === d.department) || null;
      const net = p.net && num(p.net.net) > 0 ? num(p.net.net) : null;
      const budget = b && num(b.budget_pence) != null ? Math.round(num(b.budget_pence)) : null;
      const pctTarget = b && num(b.pct_min) != null
        ? (num(b.pct_min) === num(b.pct_max) ? (num(b.pct_min) * 100).toFixed(1) + '%' : `${(num(b.pct_min) * 100).toFixed(1)}–${(num(b.pct_max) * 100).toFixed(1)}%`)
        : null;
      const pct = (cost) => (net != null && cost != null ? (cost / net) * 100 : null);
      const schedPct = pct(num(d.sc));
      const actPct = pct(num(d.ac));
      const targetPct = b && num(b.pct_min) === num(b.pct_max) ? num(b.pct_min) * 100 : null;
      // Scorecard RAG vs the manager's own target: on/under 🟢 · ≤1pp over 🟡 · >1pp over 🔴.
      const rag = (v) => (v == null || targetPct == null ? '' : v <= targetPct ? ' style="color:var(--green,#34d399)"' : v <= targetPct + 1 ? ' style="color:var(--amber,#e0b050)"' : ' style="color:var(--red,#f87171)"');
      const line = (label, hours, cost, pctVal, pctHtmlAttr) =>
        `<tr><td>${label}</td><td class="mono">${hours}</td><td class="mono">${cost}</td><td class="mono"${pctHtmlAttr || ''}>${pctVal}</td></tr>`;

      const rows = [];
      rows.push(line('Budget (RotaCloud)', '—', budget != null ? gbp(budget) : '<span class="ash">not set</span>', pctTarget != null ? esc(pctTarget) : '—'));
      rows.push(line('Scheduled (rota)', hrs(d.sm), gbp(d.sc), schedPct != null ? schedPct.toFixed(1) + '%' : '—', rag(schedPct)));
      rows.push(line('Actual (clocked)', hrs(d.am), gbp(d.ac), actPct != null ? actPct.toFixed(1) + '%' : '—', rag(actPct)));

      const varLines = [];
      if (budget != null && num(d.sc) != null) {
        const v = num(d.sc) - budget;
        varLines.push(`planned vs budget: ${v >= 0 ? '+' : '−'}${gbp(Math.abs(v))}${schedPct != null && targetPct != null ? ` (${pp(schedPct - targetPct)})` : ''}`);
      }
      if (budget != null && num(d.ac) != null) {
        const v = num(d.ac) - budget;
        varLines.push(`landed vs budget: ${v >= 0 ? '+' : '−'}${gbp(Math.abs(v))}${actPct != null && targetPct != null ? ` (${pp(actPct - targetPct)})` : ''}`);
      }
      const uncosted = (num(d.usm) || 0) > 0 || (num(d.uam) || 0) > 0
        ? `<div class="lb-hint">⚠️ ${hrs(Math.max(num(d.usm) || 0, num(d.uam) || 0))} at £0 in RotaCloud (no stored rate) — matches what the manager sees in-app; the real cost of these staff lives in <a href="/reports">Reports</a>.</div>`
        : '';

      return `<div><div class="sec-label">${esc(DEPT_LABEL[d.department] || d.department)}<span class="rule"></span></div>
        <div class="panel"><div class="panel-body">
          <table class="tbl"><thead><tr><th></th><th>hours</th><th>cost (pre-burden)</th><th>% of net</th></tr></thead><tbody>${rows.join('')}</tbody></table>
          ${varLines.length ? `<div class="lb-hint" style="margin-top:8px">${esc(varLines.join(' · '))}</div>` : ''}
          ${uncosted}
        </div></div></div>`;
    };

    const periodBody = (p, label) => {
      const parts = [];
      const covered = p.depts && p.depts.length ? Math.max.apply(null, p.depts.map((d) => num(d.days) || 0)) : 0;
      if (!covered) {
        parts.push(`<div class="banner muted">No department labour for ${esc(label)} yet.</div>`);
        return parts.join('\n');
      }
      const order = ['kitchen', 'foh'];
      const known = order.map((k) => (p.depts || []).find((d) => d.department === k)).filter(Boolean);
      parts.push(`<div class="lb-two">${known.map((d) => deptBlock(p, d)).join('')}</div>`);
      const un = (p.depts || []).find((d) => d.department === 'unassigned');
      if (un) parts.push(`<div class="banner">⚠️ ${hrs(un.sm)} rota'd / ${hrs(un.am)} clocked on an UNKNOWN RotaCloud location — not guessed into a department; fix the location in RotaCloud.</div>`);
      if (p.salesDays && num(p.salesDays.n) != null && covered < num(p.salesDays.n)) {
        parts.push(`<div class="lb-hint">Labour covers ${esc(String(covered))} of ${esc(String(num(p.salesDays.n)))} sales day(s) in ${esc(label)} — figures reflect covered days only, never scaled up.</div>`);
      }
      if (p.net == null || num(p.net.net) == null) {
        parts.push(`<div class="lb-hint">% of net unavailable — no sales record for the covered day(s).</div>`);
      }
      return parts.join('\n');
    };

    const parityHtml = () => {
      if (!m.parity || m.parity.length === 0) {
        return `<div class="banner muted">Rate parity ✓ — locked 2026/27 table and RotaCloud's stored rates agree (re-checked every ingest).</div>`;
      }
      const KIND = {
        role_rate_mismatch: 'rate differs', rc_missing_rate: 'no rate in RotaCloud (costs £0 in-app)',
        locked_missing_rate: 'not in locked table', salary_mismatch: 'salary differs', rc_missing_salary: 'salary missing in RotaCloud',
      };
      const rows = m.parity.map((x) => `<tr><td>${esc(x.user_name || '')}</td><td>${esc(x.role_name || '—')}</td><td>${esc(KIND[x.kind] || x.kind)}</td><td class="mono">${esc(x.rc_value || '—')}</td><td class="mono">${esc(x.locked_value || '—')}</td></tr>`).join('');
      return `<div class="banner">🔴 <b>${m.parity.length} rate discrepanc${m.parity.length === 1 ? 'y' : 'ies'}</b> between RotaCloud and the locked 2026/27 table — the managers' in-app % uses <i>their</i> rates, so this scorecard is unfair until fixed <b>in RotaCloud</b>.</div>
        <div class="panel"><div class="panel-body"><table class="tbl"><thead><tr><th>who</th><th>role</th><th>finding</th><th>RotaCloud</th><th>locked table</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    };

    const body = styles
      + `<div class="lb-ruler">Manager scorecard — pre-burden, matches RotaCloud · never compare with Reports' true cost (burden + salaried/365)</div>`
      + `<div class="lb-seg" id="lb-seg">
          <button data-p="day">Daily</button>
          <button data-p="week">Weekly</button>
          <button class="active" data-p="month">Monthly</button>
        </div><span class="lb-hint" style="margin-left:10px">monthly = calendar month (the bonus period)</span>`
      + `<div class="lb-period" data-p="day" hidden>${periodBody(m.periods.day, 'yesterday')}</div>`
      + `<div class="lb-period" data-p="week" hidden>${periodBody(m.periods.week, 'last 7 days')}</div>`
      + `<div class="lb-period" data-p="month">${periodBody(m.periods.month, 'this month')}</div>`
      + `<div class="sec-label" style="margin-top:18px">Rate parity — locked table vs RotaCloud<span class="rule"></span></div>`
      + parityHtml()
      + `<script>(function(){var r=document.getElementById('lb-seg');if(!r)return;var main=r.closest('main')||document;r.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){var p=b.getAttribute('data-p');r.querySelectorAll('button').forEach(function(x){x.classList.toggle('active',x===b);});main.querySelectorAll('.lb-period').forEach(function(x){x.hidden=x.getAttribute('data-p')!==p;});});});})();</script>`;

    return { stamp: `labour · <span class="mono">RotaCloud · ${esc(m.maxDate)}</span>`, body };
  },
};
