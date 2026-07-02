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
      // Clock drift: rota'd vs worked per matched shift, £ at the shift's own PRE-BURDEN
      // dated rate (rate_pence is stored pre-burden; salaried rows have NULL → hours-only).
      const drift = rowsOf(q(`SELECT user_name, business_date, sched_minutes, act_minutes, variance_minutes, rate_pence FROM labour_shifts WHERE business_date BETWEEN ? AND ? AND variance_minutes IS NOT NULL AND variance_minutes != 0 ORDER BY ABS(variance_minutes) DESC LIMIT 8`, [from, to]));
      const driftTot = rowsOf(q(`SELECT SUM(CASE WHEN rate_pence IS NOT NULL THEN variance_minutes * rate_pence / 60.0 ELSE 0 END) AS pence, SUM(variance_minutes) AS mins FROM labour_shifts WHERE business_date BETWEEN ? AND ? AND variance_minutes IS NOT NULL`, [from, to]))[0] || null;
      return { from, to, depts, budgets, net: netRow, salesDays, uncostedNames: names.sort(), drift, driftTot };
    };

    const monthStart = maxDate.slice(0, 8) + '01'; // calendar month = the bonus period
    return {
      now, hasData: true, maxDate,
      parity: rowsOf(q(`SELECT user_name, role_name, kind, rc_value, locked_value FROM labour_rate_parity ORDER BY user_name, role_id`)),
      // TODAY — live (hourly snapshot; partial day, as-of-stamped — its own surface,
      // never mixed with the settled periods below).
      intraday: rowsOf(q(`SELECT business_date, department, as_of_ms, sched_minutes_full, sched_cost_rc_full, worked_minutes_so_far, cost_rc_so_far, uncosted_minutes, clocked_in_now, no_shows, ref_date, ref_worked_minutes, ref_net_pence, ref_to_hour FROM labour_intraday ORDER BY department`)),
      // Blended pre-burden £/hr per dept per week — senior-heavy drift shows here.
      blended: rowsOf(q(`SELECT department, strftime('%Y-%W', business_date) AS wk, MIN(business_date) AS wk_from, SUM(act_cost_rc_pence) AS ac, SUM(act_minutes) AS am FROM labour_dept WHERE department IN ('kitchen','foh') AND act_minutes > 0 GROUP BY department, wk ORDER BY wk`)),
      // U18 working-time flags (WTR 1998 young workers; rules cited at ingest) — same
      // severity as rate parity.
      wtr: rowsOf(q(`SELECT business_date, user_name, kind, detail FROM labour_wtr_flags ORDER BY business_date DESC, user_name LIMIT 20`)),
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

    const daysInMonth = (dstr) => new Date(Date.UTC(Number(dstr.slice(0, 4)), Number(dstr.slice(5, 7)), 0)).getUTCDate();

    const deptBlock = (p, d, isMonth) => {
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

      // BONUS PACING (month only): a pure arithmetic restatement of the MTD ledger —
      // "to land the month, the remaining days must absorb the current delta". No
      // revenue projection anywhere: the delta is settled fact, the remainder is a
      // requirement statement, not a forecast.
      let pacing = '';
      if (isMonth && budget != null && num(d.ac) != null) {
        const delta = num(d.ac) - budget;
        const covered = num(d.days) || 0;
        const remaining = Math.max(0, daysInMonth(m.maxDate) - Number(m.maxDate.slice(8, 10)));
        if (remaining === 0) {
          pacing = `<div class="lb-hint"><b>${delta > 0 ? '🔴' : '🟢'} Month closed ${delta > 0 ? gbp(delta) + ' OVER' : gbp(-delta) + ' under'} budget</b> across ${esc(String(covered))} settled day(s).</div>`;
        } else if (delta > 0) {
          pacing = `<div class="lb-hint"><b>🔴 ${gbp(delta)} over budget</b> through ${esc(String(covered))} settled day(s) — the remaining ${esc(String(remaining))} day(s) must run a combined ${gbp(delta)} UNDER their daily budgets to land the month (≈${gbp(Math.round(delta / remaining))}/day).</div>`;
        } else {
          pacing = `<div class="lb-hint"><b>🟢 ${gbp(-delta)} under budget</b> through ${esc(String(covered))} settled day(s) — a cushion of ≈${gbp(Math.round(-delta / remaining))}/day for the remaining ${esc(String(remaining))} day(s).</div>`;
        }
      }

      return `<div><div class="sec-label">${esc(DEPT_LABEL[d.department] || d.department)}<span class="rule"></span></div>
        <div class="panel"><div class="panel-body">
          <table class="tbl"><thead><tr><th></th><th>hours</th><th>cost (pre-burden)</th><th>% of net</th></tr></thead><tbody>${rows.join('')}</tbody></table>
          ${varLines.length ? `<div class="lb-hint" style="margin-top:8px">${esc(varLines.join(' · '))}</div>` : ''}
          ${pacing}
          ${uncosted}
        </div></div></div>`;
    };

    const periodBody = (p, label, isMonth) => {
      const parts = [];
      const covered = p.depts && p.depts.length ? Math.max.apply(null, p.depts.map((d) => num(d.days) || 0)) : 0;
      if (!covered) {
        parts.push(`<div class="banner muted">No department labour for ${esc(label)} yet.</div>`);
        return parts.join('\n');
      }
      const order = ['kitchen', 'foh'];
      const known = order.map((k) => (p.depts || []).find((d) => d.department === k)).filter(Boolean);
      parts.push(`<div class="lb-two">${known.map((d) => deptBlock(p, d, isMonth)).join('')}</div>`);

      // SPLH — net ex-VAT per WORKED hour (ruler-free: revenue ÷ hours, no cost involved).
      // No target line yet: the backfill gives us our own best-week baseline; until then
      // the number stands alone — no invented benchmark.
      const net = p.net && num(p.net.net) > 0 ? num(p.net.net) : null;
      const totMin = known.reduce((x, d) => x + (num(d.am) || 0), 0);
      if (net != null && totMin > 0) {
        const splh = (mn) => (mn > 0 ? gbp(Math.round(net / (mn / 60))) : '—');
        parts.push(`<div class="sec-label">SPLH — net per worked hour<span class="rule"></span></div><div class="rp-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:8px">
          <div class="tile blue"><div class="lab">Site SPLH</div><div class="val">${splh(totMin)}</div><div class="sub">net ÷ all worked hours (${esc(label)})</div></div>
          ${known.map((d) => `<div class="tile"><div class="lab">${esc((DEPT_LABEL[d.department] || d.department).split(' — ')[0])} SPLH</div><div class="val">${splh(num(d.am) || 0)}</div><div class="sub">site net ÷ ${esc((d.department || ''))} hours</div></div>`).join('')}
        </div><div class="lb-hint">Target line arrives once the backfill gives our own best-week baseline — no invented benchmark until then.</div>`);
      }

      // CLOCK DRIFT — top rota'd-vs-worked gaps, £ at each shift's own PRE-BURDEN dated rate.
      if (p.drift && p.drift.length) {
        const dRows = p.drift.map((r) => {
          const dp = num(r.rate_pence) != null && num(r.variance_minutes) != null ? Math.round((num(r.variance_minutes) * num(r.rate_pence)) / 60) : null;
          const v = num(r.variance_minutes) || 0;
          return `<tr><td>${esc(r.user_name || '')}</td><td class="mono">${esc(String(r.business_date))}</td><td class="mono">${hrs(r.sched_minutes)}</td><td class="mono">${hrs(r.act_minutes)}</td><td class="mono"${v > 0 ? ' style="color:var(--amber,#e0b050)"' : ''}>${v >= 0 ? '+' : '−'}${hrs(Math.abs(v))}</td><td class="mono">${dp != null ? (dp >= 0 ? '+' : '−') + gbp(Math.abs(dp)) : '— <span class="ash">(salaried)</span>'}</td></tr>`;
        }).join('');
        const tot = p.driftTot && num(p.driftTot.pence) != null ? Math.round(num(p.driftTot.pence)) : null;
        parts.push(`<div class="sec-label">Clock drift — rota'd vs worked (${esc(label)})<span class="rule"></span></div>
          <div class="panel"><div class="panel-body"><table class="tbl"><thead><tr><th>who</th><th>date</th><th>rota'd</th><th>worked</th><th>Δ hours</th><th>Δ £ pre-burden</th></tr></thead><tbody>${dRows}</tbody></table>
          ${tot != null ? `<div class="lb-hint" style="margin-top:8px">Period drift total: <b>${tot >= 0 ? '+' : '−'}${gbp(Math.abs(tot))}</b> pre-burden (${esc(hrs(Math.abs(num(p.driftTot.mins) || 0)))} ${num(p.driftTot.mins) >= 0 ? 'over' : 'under'} rota). Positive = worked ran past the plan.</div>` : ''}</div></div>`);
      }
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

    // TODAY — live panel (hourly snapshot). Its own honesty: as-of stamped, stale flagged,
    // "so far" figures never presented as a day result.
    const livePanel = () => {
      const rows = (m.intraday || []).filter((r) => r.department !== 'unassigned');
      const un = (m.intraday || []).find((r) => r.department === 'unassigned');
      if (!rows.length && !un) {
        return `<div class="sec-label">Today — live<span class="rule"></span></div><div class="banner muted">No intraday snapshot yet — the hourly pull (at :35) fills this in. Settled days appear below after the morning run.</div>`;
      }
      const asOf = num(rows[0] && rows[0].as_of_ms) || num(un && un.as_of_ms);
      const lonTime = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
      const ageMin = asOf != null ? Math.round((m.now - asOf) / 60000) : null;
      const stale = ageMin != null && ageMin > 130; // two missed hourly pulls
      const hrs = (mn) => (num(mn) != null ? (num(mn) / 60).toFixed(1) + 'h' : '—');
      const blocks = rows.map((r) => {
        let inNow = [];
        try { inNow = JSON.parse(r.clocked_in_now || '[]'); } catch (e) { /* never take the tab down */ }
        const names = inNow.map((x) => `${esc(x.name)} <span class="ash mono">${lonTime(num(x.since_ms))}</span>`).join(' · ');
        let noShows = [];
        try { noShows = JSON.parse(r.no_shows || '[]'); } catch (e) { /* never take the tab down */ }
        const noShowHtml = noShows.length
          ? `<tr><td style="color:var(--red,#f87171)">NO-SHOW (15min+)</td><td style="color:var(--red,#f87171)">${noShows.map((x) => `${esc(x.name)} <span class="mono">rota'd ${lonTime(num(x.rota_start_ms))}</span>`).join(' · ')}</td></tr>`
          : '';
        return `<div><div class="sec-label">${esc(DEPT_LABEL[r.department] || r.department)}<span class="rule"></span></div>
          <div class="panel"><div class="panel-body">
            <table class="tbl"><tbody>
              ${noShowHtml}
              <tr><td>Clocked in now (${inNow.length})</td><td>${names || '<span class="ash">nobody</span>'}</td></tr>
              <tr><td>Worked so far</td><td class="mono">${hrs(r.worked_minutes_so_far)} · ${gbp(r.cost_rc_so_far)} pre-burden</td></tr>
              <tr><td>Rota'd today (full day)</td><td class="mono">${hrs(r.sched_minutes_full)} · ${gbp(r.sched_cost_rc_full)}</td></tr>
            </tbody></table>
            ${num(r.uncosted_minutes) ? `<div class="lb-hint">${hrs(r.uncosted_minutes)} so far at £0 in the scorecard ruler (salaried/unrated) — true cost lands in Reports tomorrow.</div>` : ''}
          </div></div></div>`;
      }).join('');
      // Burn-vs-reference: the last same-weekday SETTLED day truncated to the same hour.
      // A REFERENCE for context — labelled with its date, NEVER a projection of today.
      const r0 = rows[0] || un;
      let refLine = '';
      if (r0 && r0.ref_date != null) {
        const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(String(r0.ref_date) + 'T12:00:00Z').getUTCDay()];
        const soFarMin = rows.reduce((x, rr) => x + (num(rr.worked_minutes_so_far) || 0), 0);
        refLine = `<div class="lb-hint">Reference — last ${esc(wd)} (${esc(String(r0.ref_date))}, settled) by ${esc(String(num(r0.ref_to_hour)))}:00: ${hrs(r0.ref_worked_minutes)} worked · ${gbp(r0.ref_net_pence)} net taken. Today so far: ${hrs(soFarMin)}. Context only — never a projection.</div>`;
      } else if (r0) {
        refLine = `<div class="lb-hint">No settled same-weekday reference exists yet (thin history) — context arrives as the record grows; nothing is borrowed from other weekdays.</div>`;
      }
      return `<div class="sec-label">Today — live · <span class="mono">${esc(rows[0] ? String(rows[0].business_date) : '')}</span><span class="rule"></span></div>`
        + (asOf != null ? `<div class="lb-hint">${stale ? '⚠️ STALE — last snapshot ' : 'as of '}${esc(lonTime(asOf))}${stale ? ` (${Math.round(ageMin / 60)}h ago — check coyote-rotacloud-ingest)` : ' · refreshes hourly at :35'} · partial-day figures, never a day result</div>` : '')
        + refLine
        + `<div class="lb-two">${blocks}</div>`
        + (un ? `<div class="banner">⚠️ ${hrs(un.worked_minutes_so_far)} today on an UNKNOWN RotaCloud location — fix the location in RotaCloud.</div>` : '');
    };

    // HEADLINE — yesterday's £-consequence on THIS ruler: dept spend vs the managers'
    // own RotaCloud budgets, £ first, % as the subtitle.
    const headline = () => {
      const day = m.periods.day;
      const known = (day.depts || []).filter((d) => d.department === 'kitchen' || d.department === 'foh');
      const ac = known.reduce((x, d) => x + (num(d.ac) || 0), 0);
      const bud = (day.budgets || []).reduce((x, b) => x + (num(b.budget_pence) || 0), 0);
      if (!known.length || !bud) return '';
      const delta = ac - Math.round(bud);
      const net = day.net && num(day.net.net) > 0 ? num(day.net.net) : null;
      const col = delta <= 0 ? 'var(--green,#34d399)' : 'var(--red,#f87171)';
      return `<div class="rp-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:14px">
        <div class="tile"><div class="lab">Yesterday vs the managers' budgets — scorecard ruler</div>
          <div class="val" style="color:${col};font-size:26px">${delta <= 0 ? gbp(-delta) + ' under' : gbp(delta) + ' OVER'}</div>
          <div class="sub">spent ${gbp(ac)} against ${gbp(Math.round(bud))} budgeted${net != null ? ` · ${((ac / net) * 100).toFixed(1)}% of net vs ${((bud / net) * 100).toFixed(1)}% budgeted` : ''} · pre-burden</div></div>
      </div>`;
    };

    // BLENDED RATE TREND — dept pre-burden £/hr per week, Δ vs prior week. Senior-heavy
    // scheduling shows up here before it shows in the % headline.
    const blendedHtml = () => {
      const by = { kitchen: [], foh: [] };
      for (const r of m.blended || []) if (by[r.department]) by[r.department].push(r);
      const weeks = Math.max(by.kitchen.length, by.foh.length);
      if (!weeks) return '';
      const rowFor = (dept) => by[dept].map((r, i) => {
        const rate = num(r.am) > 0 ? (num(r.ac) / (num(r.am) / 60)) : null;
        const prev = i > 0 && num(by[dept][i - 1].am) > 0 ? (num(by[dept][i - 1].ac) / (num(by[dept][i - 1].am) / 60)) : null;
        const dlt = rate != null && prev != null ? rate - prev : null;
        return `<tr><td>${esc((DEPT_LABEL[dept] || dept).split(' — ')[0])}</td><td class="mono">w/c ${esc(String(r.wk_from))}</td><td class="mono">${rate != null ? gbp(Math.round(rate)) + '/h' : '—'}</td><td class="mono"${dlt != null && dlt > 0 ? ' style="color:var(--amber,#e0b050)"' : ''}>${dlt != null ? (dlt >= 0 ? '+' : '−') + gbp(Math.round(Math.abs(dlt))) : '—'}</td></tr>`;
      }).join('');
      return `<div class="sec-label" style="margin-top:18px">Blended rate — pre-burden £/hr by week<span class="rule"></span></div>
        <div class="panel"><div class="panel-body"><table class="tbl"><thead><tr><th>dept</th><th>week</th><th>blended £/hr</th><th>Δ vs prior wk</th></tr></thead><tbody>${rowFor('kitchen')}${rowFor('foh')}</tbody></table>
        ${weeks < 2 ? '<div class="lb-hint" style="margin-top:8px">Thin history — the trend needs a second week to say anything; it appears as the record grows.</div>' : ''}</div></div>`;
    };

    // U18 WORKING-TIME GUARD — same severity as rate parity; rules cited at ingest
    // (gov.uk/maximum-weekly-working-hours + gov.uk/night-working-hours).
    const wtrHtml = () => {
      const flags = m.wtr || [];
      if (!flags.length) return `<div class="banner muted">U18 working-time ✓ — no flags (8h/day · 40h/wk fixed · 22:00+ surfaced · 00:00–04:00 absolute; re-checked every ingest).</div>`;
      const KIND = { day_over_8h: '🔴 over 8h day', week_over_40h: '🔴 over 40h week', night_22_24: '🟡 worked past 22:00', night_00_04: '🔴 worked past midnight' };
      const rows2 = flags.map((f) => `<tr><td>${esc(f.user_name || '')}</td><td class="mono">${esc(String(f.business_date))}</td><td>${esc(KIND[f.kind] || f.kind)}</td><td>${esc(f.detail || '')}</td></tr>`).join('');
      return `<div class="banner">🔴 <b>${flags.length} U18 working-time flag${flags.length === 1 ? '' : 's'}</b> — Working Time Regulations, young workers (rules + citations in each row).</div>
        <div class="panel"><div class="panel-body"><table class="tbl"><thead><tr><th>who</th><th>date</th><th>flag</th><th>detail</th></tr></thead><tbody>${rows2}</tbody></table></div></div>`;
    };

    const body = styles
      + `<div class="lb-ruler">Manager scorecard — pre-burden, matches RotaCloud · never compare with Reports' true cost (burden + salaried/365)</div>`
      + livePanel()
      + headline()
      + `<div class="lb-seg" id="lb-seg">
          <button data-p="day">Daily</button>
          <button data-p="week">Weekly</button>
          <button class="active" data-p="month">Monthly</button>
        </div><span class="lb-hint" style="margin-left:10px">monthly = calendar month (the bonus period)</span>`
      + `<div class="lb-period" data-p="day" hidden>${periodBody(m.periods.day, 'yesterday', false)}</div>`
      + `<div class="lb-period" data-p="week" hidden>${periodBody(m.periods.week, 'last 7 days', false)}</div>`
      + `<div class="lb-period" data-p="month">${periodBody(m.periods.month, 'this month', true)}</div>`
      + blendedHtml()
      + `<div class="sec-label" style="margin-top:18px">U18 working-time guard<span class="rule"></span></div>`
      + wtrHtml()
      + `<div class="sec-label" style="margin-top:18px">Rate parity — locked table vs RotaCloud<span class="rule"></span></div>`
      + parityHtml()
      + `<script>(function(){var r=document.getElementById('lb-seg');if(!r)return;var main=r.closest('main')||document;r.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){var p=b.getAttribute('data-p');r.querySelectorAll('button').forEach(function(x){x.classList.toggle('active',x===b);});main.querySelectorAll('.lb-period').forEach(function(x){x.hidden=x.getAttribute('data-p')!==p;});});});})();</script>`;

    return { stamp: `labour · <span class="mono">RotaCloud · ${esc(m.maxDate)}</span>`, body };
  },
};
