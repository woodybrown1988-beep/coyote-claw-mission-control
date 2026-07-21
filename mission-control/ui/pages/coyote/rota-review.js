'use strict';
// Rota Review — the weekly FORWARD / HINDSIGHT verdicts (ops/rota-review-spec.md, rulings
// 2026-07-18). Renders the PERSISTED runs from rota_review_runs (dated snapshots — the week-on-
// week receipts for manager conversations; read-time compute stays canonical in the cc engine).
// Contract: { key, route, title, sub, getSection, render }. SELECT-only via ctx.q.
// Coyote Report Standard + the Reporting-v2 idiom: answer-first hero per dept (one line the
// operator can read to a manager verbatim), OVER/UNDER items with £, ONE MIX note per dept,
// collapsible detail, honest gaps (an unpublished rota renders as the finding it is; a FAILED
// run renders red — a dead cadence must never read as quiet).
const S = require('../../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

module.exports = {
  key: 'rota-review', route: '/coyote/rota-review', workspace: 'coyote', title: 'Rota Review',
  sub: 'Labour vs demand — weekly FORWARD (next week’s rota) & HINDSIGHT (last week, as it actually was) · banded formula ruler',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') return { now, hasData: false };
    const dept = ctx.query && (ctx.query.dept === 'kitchen' || ctx.query.dept === 'foh') ? ctx.query.dept : null;
    const latest = (mode) => rowsOf(q(
      `SELECT id, mode, week_monday, ran_at, status, trigger, report_json, report_text, error
         FROM rota_review_runs WHERE mode = ? ORDER BY id DESC LIMIT 1`, [mode]))[0] || null;
    const latestOk = (mode) => rowsOf(q(
      `SELECT id, mode, week_monday, ran_at, status, trigger, report_json
         FROM rota_review_runs WHERE mode = ? AND status = 'ok' ORDER BY id DESC LIMIT 1`, [mode]))[0] || null;
    const history = rowsOf(q(
      `SELECT id, mode, week_monday, ran_at, status, trigger, report_json FROM rota_review_runs ORDER BY id DESC LIMIT 14`));
    // the reviews-loop staleness caveat (HINDSIGHT): the issue extractor's last write
    const extractedMax = rowsOf(q(`SELECT MAX(extracted_at) m FROM review_issues`))[0];
    // planned-vs-worked drift: the latest ok FORWARD run for the SAME week as the hindsight
    const hind = latest('hindsight');
    let plannedForWeek = null;
    if (hind && hind.status === 'ok') {
      plannedForWeek = rowsOf(q(
        `SELECT report_json FROM rota_review_runs WHERE mode='forward' AND status='ok' AND week_monday = ? ORDER BY id DESC LIMIT 1`,
        [hind.week_monday]))[0] || null;
    }
    return {
      now, hasData: history.length > 0, dept,
      forward: latest('forward'), forwardOk: latestOk('forward'),
      hindsight: hind, plannedForWeek,
      history,
      extractorStaleDays: extractedMax && num(extractedMax.m) ? Math.floor((now - num(extractedMax.m)) / 86_400_000) : null,
    };
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const gbp0 = (p) => `£${Math.round(Number(p) / 100).toLocaleString('en-GB')}`;
    const gbp = S.fmtGbpPence;
    const styles = `<style>
      .rr-caption{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--muted,#7a8);margin:8px 2px 2px;line-height:1.55}
      .rr-hero{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
      @media(max-width:900px){.rr-hero{grid-template-columns:1fr}}
      .rr-items{font-family:var(--font-mono,monospace);font-size:12px;line-height:1.9}
      .rr-items .k{display:inline-block;width:52px;font-weight:600}
      .rr-items .k.over{color:var(--amber,#FBBF24)} .rr-items .k.under{color:var(--red,#F87171)}
      .rr-mix{font-family:var(--font-mono,monospace);font-size:11px;color:var(--text-2,#9ab);margin-top:7px}
      .rr-details{margin:9px 2px 0}
      .rr-details summary{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--muted,#7a8);cursor:pointer;list-style:none;user-select:none}
      .rr-details summary::-webkit-details-marker{display:none}
      .rr-details summary:hover,.rr-details[open] summary{color:var(--text-2,#9ab)}
      .rr-filter{display:inline-flex;gap:4px;margin:0 0 12px}
      .rr-filter a{font-family:var(--font-mono,monospace);font-size:11px;padding:4px 12px;border-radius:7px;border:1px solid var(--border,rgba(125,165,205,.1));color:var(--text-2,#9ab)}
      .rr-filter a.on{background:var(--cyan-dim,rgba(34,211,238,.15));color:#CFF6FB;border-color:rgba(34,211,238,.3)}
      pre.rr-raw{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--text-2,#9ab);white-space:pre-wrap;line-height:1.5;margin:8px 0 0}
    </style>`;

    if (!m.hasData) {
      return {
        stamp: 'no runs yet',
        body: styles + `<div class="banner muted">No Rota Review runs on record yet. The cadence timers (FORWARD daily on rota-publish + Thursday; HINDSIGHT Monday) persist their runs here — or seed one with <span class="mono">npm run rota-review -- run-forward</span>. Nothing is estimated in the meantime.</div>`,
      };
    }

    const parse = (row) => { try { return row && row.report_json ? JSON.parse(row.report_json) : null; } catch (e) { return null; } };
    const ago = (ms) => {
      const h = Math.max(0, Math.round((m.now - Number(ms)) / 3600_000));
      return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
    };
    const deptShown = (d) => !m.dept || m.dept === d;

    const filter = `<div class="rr-filter">
      <a href="/coyote/rota-review" class="${m.dept ? '' : 'on'}">both depts</a>
      <a href="/coyote/rota-review?dept=kitchen" class="${m.dept === 'kitchen' ? 'on' : ''}">kitchen</a>
      <a href="/coyote/rota-review?dept=foh" class="${m.dept === 'foh' ? 'on' : ''}">FOH</a>
    </div>`;

    // ---- one mode's section (the ruled verdict format) ----
    const modeSection = (label, row, extra) => {
      if (!row) return `<div class="sec-label">${esc(label)}<span class="rule"></span></div><div class="banner muted">No ${esc(label)} run yet.</div>`;
      if (row.status === 'error') {
        return `<div class="sec-label">${esc(label)}<span class="rule"></span></div>
          <div class="banner red">The latest ${esc(label)} run FAILED (${esc(ago(row.ran_at))}, w/c ${esc(row.week_monday)}): <span class="mono">${esc(String(row.error || 'no detail').slice(0, 200))}</span> — the cadence is DOWN until this greens (also flagged in Rex's morning line).</div>`;
      }
      const rep = parse(row);
      if (!rep) return `<div class="sec-label">${esc(label)}<span class="rule"></span></div><div class="banner amber">Run ${esc(String(row.id))} is stored but its report is unreadable — re-run it.</div>`;
      const unpublished = (rep.gaps || []).some((g) => String(g).includes('PARTIALLY PUBLISHED'));
      const heroes = (rep.verdicts || []).filter((v) => deptShown(v.dept)).map((v) => {
        const provisional = unpublished && v.dept === 'kitchen';
        const line = v.budgetPence == null
          ? `no formula budget (forecast missing)`
          : `${v.deltaPence > 0 ? `${gbp0(v.deltaPence)} OVER` : `${gbp0(-v.deltaPence)} under`} the formula budget (${gbp0(v.budgetPence)} at forecast ${v.forecastNetPence != null ? gbp0(v.forecastNetPence) : '—'})`;
        return `<div class="tile ${provisional ? '' : v.deltaPence != null && v.deltaPence > 0 ? 'amber' : 'green'}">
          <div class="lab">${esc(v.dept.toUpperCase())} — ${esc(label)} w/c ${esc(rep.weekMonday)}</div>
          <div class="val" style="font-size:19px">${esc(line.split(' the formula')[0])}</div>
          <div class="sub">${esc(line.includes(' the formula') ? 'vs formula budget ' + line.split('the formula budget ')[1] : '')}${provisional ? ' · PROVISIONAL — rota unpublished' : ''}${v.pctOfForecast != null ? ` · ${(v.pctOfForecast * 100).toFixed(1)}% of ${label === 'FORWARD' ? 'forecast' : 'actual'} net` : ''}</div>
          <div class="sub">${esc(`salaried fixed ${gbp0(v.salariedPence)} inside; total promised ${gbp0(v.plannedTruePence)}`)}</div>
        </div>`;
      }).join('');
      const items = (rep.items || []).filter((i) => deptShown(i.dept)).slice(0, 8).map((i) =>
        `<div><span class="k ${i.kind.toLowerCase()}">${esc(i.kind)}</span> ${esc(i.date)} ${esc(i.part)} · ${Number(i.hours).toFixed(1)}h ${i.kind === 'OVER' ? '−' : '+'}${gbp(i.pence)} · ${esc(String(i.note).slice(0, 140))}</div>`).join('');
      const mixes = Object.entries(rep.mixNotes || {}).filter(([d]) => deptShown(d)).map(([d, note]) =>
        `<div class="rr-mix">MIX ${esc(d)}: ${esc(String(note))}</div>`).join('');
      const gaps = (rep.gaps || []).map((g) => `<div class="rr-caption">GAP: ${esc(String(g))}</div>`).join('');
      const stamp = `<div class="rr-caption">run ${esc(ago(row.ran_at))} · trigger ${esc(row.trigger)}${rep.asOf ? ` · rota as of ${esc(new Date(Number(rep.asOf)).toISOString().slice(0, 16).replace('T', ' '))}Z` : ''} · baseline ${esc(rep.baseline ? `${rep.baseline.from}..${rep.baseline.to}` : '—')} · ruler: TRUE all-in ÷ ${label === 'FORWARD' ? 'forecast (RC daily targets)' : 'actual net (per-receipt record)'} · targets = banded formula</div>`;
      return `<div class="sec-label">${esc(label)} · w/c ${esc(rep.weekMonday)}<span class="rule"></span></div>
        <div class="rr-hero">${heroes || '<div class="banner muted">dept filtered out</div>'}</div>
        <div class="panel"><div class="panel-body">
          ${items ? `<div class="rr-items">${items}</div>` : '<div class="rr-caption">no OVER/UNDER dayparts above thresholds (≥4h & ≥£45)</div>'}
          ${mixes}${extra || ''}${gaps}${stamp}
          <details class="rr-details"><summary>full verdict text (as rendered) ▸</summary><pre class="rr-raw">${esc(String(row.report_text || '(not stored)'))}</pre></details>
        </div></div>`;
    };

    // HINDSIGHT extras: planned-vs-worked drift + the ceiling line + the reviews-loop caveat
    let hindExtra = '';
    if (m.hindsight && m.hindsight.status === 'ok') {
      const hrep = parse(m.hindsight);
      const frep = parse(m.plannedForWeek);
      if (hrep && frep) {
        const drift = (hrep.verdicts || []).filter((v) => deptShown(v.dept)).map((hv) => {
          const fv = (frep.verdicts || []).find((x) => x.dept === hv.dept);
          if (!fv) return '';
          const d = hv.plannedTruePence - fv.plannedTruePence;
          return `<div class="rr-mix">DRIFT ${esc(hv.dept)}: rota promised ${gbp0(fv.plannedTruePence)}, the week cost ${gbp0(hv.plannedTruePence)} (${d >= 0 ? '+' : '−'}${gbp0(Math.abs(d))} vs plan)</div>`;
        }).join('');
        hindExtra += drift;
      }
      if (hrep && hrep.ceiling) {
        const c = hrep.ceiling;
        hindExtra += `<div class="rr-mix">SPLH CEILING: ${esc(c.verdict === 'drop-to-p75-80' ? 'the best weeks HURT — UNDER threshold drops to p75–80' : c.verdict === 'p90-ok' ? `p90 stands (top-decile days ${c.topRatePct != null ? c.topRatePct.toFixed(1) : '—'}% speed/wait/accuracy vs ${c.restRatePct != null ? c.restRatePct.toFixed(1) : '—'}% elsewhere)` : 'insufficient review volume — p90 stays PROVISIONAL')}</div>`;
      }
      if (m.extractorStaleDays != null && m.extractorStaleDays > 7) {
        hindExtra += `<div class="rr-caption">CAVEAT: the review-issue extractor last wrote ${esc(String(m.extractorStaleDays))} day(s) ago — the reviews loop (and the ceiling check) misses recent weeks until it revives.</div>`;
      }
    }

    // audit 2026-07-21: the receipts carry their VERDICT £ — a history without numbers is a log,
    // not a record for week-on-week manager conversations.
    const verdictOf = (r) => {
      const rep = parse(r);
      if (!rep || !Array.isArray(rep.verdicts)) return '—';
      return rep.verdicts.map((v) => v.deltaPence == null ? `${v.dept[0].toUpperCase()} —`
        : `${v.dept[0].toUpperCase()} ${v.deltaPence > 0 ? '+' : '−'}£${Math.round(Math.abs(v.deltaPence) / 100).toLocaleString('en-GB')}`).join(' · ');
    };
    const histRows = (m.history || []).map((r) => `<tr>
      <td class="mono">${esc(r.week_monday)}</td><td class="mono">${esc(r.mode)}</td><td class="mono ash">${esc(r.trigger)}</td>
      <td class="mono">${r.status === 'ok' ? '<span class="sdot green"></span> ok' : '<span class="sdot red"></span> FAILED'}</td>
      <td class="mono">${esc(r.status === 'ok' ? verdictOf(r) : '—')}</td>
      <td class="mono ash">${esc(ago(r.ran_at))}</td></tr>`).join('');

    const body = styles
      + `<div class="rp-lib" style="text-align:right;margin:0 0 10px;font-size:13px"><a href="/coyote/report-library" style="color:#e57373;font-weight:600">Report Library →</a></div>`
      + filter
      + modeSection('FORWARD', m.forward, '')
      + modeSection('HINDSIGHT', m.hindsight, hindExtra)
      + `<div class="sec-label">Run history <span class="mono">(the week-on-week receipts)</span><span class="rule"></span></div>
         <div class="panel"><div class="panel-body"><table class="tbl"><thead><tr><th>week</th><th>mode</th><th>trigger</th><th>status</th><th>verdict (+ over / − under)</th><th>ran</th></tr></thead><tbody>${histRows}</tbody></table></div></div>`;

    const latestMs = Math.max(...(m.history || []).map((r) => Number(r.ran_at) || 0), 0);
    return { stamp: latestMs ? `latest run · <span class="mono">${esc(ago(latestMs))}</span>` : '', body };
  },
};
