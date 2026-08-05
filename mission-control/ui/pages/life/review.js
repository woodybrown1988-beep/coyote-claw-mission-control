'use strict';
// LIFE OS — WEEKLY REVIEW + QUARTERLY EVOLUTION (A9/A10), LIVE: the compiled snapshot's
// evidence, proposed Big 3, carry-forwards and NAMED subtraction candidates, with owner
// approval via the sole writer. The quarterly review compiles on demand and at approval
// carries calibration + promotion RECOMMENDATIONS (evidence only — promotion is yours).
const LIFE = require('./life-lib.js');

const cmdBtn = (label, command, payload) =>
  `<button class="lc-btn" style="min-width:0" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}">${LIFE.esc(title)}</a>`;

module.exports = {
  key: 'life-review', route: '/life/review', workspace: 'life', title: 'Weekly Review',
  sub: 'Sunday evidence snapshot, Big 3, carry-forwards, subtraction — 30 minutes maximum',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return {
        engine: { ok: true },
        weekly: q(`SELECT * FROM life_weekly_snapshots ORDER BY week_start DESC LIMIT 6`),
        quarterly: q(`SELECT period_start, period_end, status, automation_review_json, operating_patterns_json FROM life_quarterly_reviews ORDER BY period_start DESC LIMIT 4`),
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (!s.engine || !s.engine.ok) {
      return { stamp: 'life-review · engine gate', body: LIFE.engineGate(s.engine ? s.engine.reason : 'no engine state') };
    }
    let body = '';
    const latest = (s.weekly || [])[0];
    if (latest) {
      const ev = JSON.parse(String(latest.evidence_json || '{}'));
      const big3 = JSON.parse(String(latest.proposed_big_three_json || '[]'));
      const carry = JSON.parse(String(latest.carry_forward_json || '[]'));
      const subs = JSON.parse(String(latest.subtraction_json || '[]'));
      body += `<div class="panel"><h3>Week of ${LIFE.esc(String(latest.week_start))} — ${LIFE.esc(String(latest.status))}</h3>
        <div style="font-size:13px;margin:6px 0">Done <b>${ev.done_week ?? 0}</b> · captured <b>${ev.captured_week ?? 0}</b> · cancelled <b>${ev.cancelled_week ?? 0}</b> · proofs moved <b>${ev.outcome_proofs_moved ?? 0}</b> · waiting w/o wake path <b>${ev.waiting_without_wake_path ?? 0}</b> · fallbacks passed <b>${ev.waiting_fallback_passed ?? 0}</b></div>
        <div style="font-size:13px;margin:6px 0"><b>Big 3 proposed:</b> ${big3.length ? big3.map((b) => link(b.id, b.title)).join(' · ') : '<span style="color:var(--muted,#8aa)">nothing available</span>'}</div>
        ${carry.length ? `<div style="font-size:13px;margin:6px 0"><b>Carry-forwards (${carry.length}):</b> ${carry.slice(0, 8).map((c) => `${link(c.id, c.title)} (${Number(c.ageDays)}d)`).join(' · ')}</div>` : ''}
        <div class="lc-row">
          ${String(latest.status) === 'DRAFT' ? cmdBtn('Approve week (Big 3 as proposed)', 'approve_week', { weekStart: latest.week_start }) : ''}
          ${cmdBtn('Recompile snapshot', 'compile_week')}
        </div></div>`;
      if (subs.length) {
        body += `<div class="panel"><h3 style="color:#f5c96b">Subtraction candidates (${subs.length})</h3><table class="data"><tbody>`
          + subs.map((x) => `<tr><td>${link(x.id, x.title)}</td><td style="font-size:12px;color:var(--muted,#8aa)">${LIFE.esc(x.reason)}</td></tr>`).join('')
          + `</tbody></table></div>`;
      }
      const history = (s.weekly || []).slice(1);
      if (history.length) {
        body += `<div class="panel"><h3>History</h3><table class="data"><thead><tr><th>Week</th><th>Status</th></tr></thead><tbody>`
          + history.map((w) => `<tr><td>${LIFE.esc(String(w.week_start))} → ${LIFE.esc(String(w.week_end))}</td><td>${LIFE.esc(String(w.status))}</td></tr>`).join('')
          + `</tbody></table></div>`;
      }
    } else {
      body += `<div class="panel"><h3>Weekly review</h3>
        <div style="padding:10px 4px;color:var(--muted,#8aa);font-size:13px">No snapshot yet — the writer compiles Sundays 17:30 London, or now:</div>
        <div class="lc-row">${cmdBtn('Compile snapshot now', 'compile_week')}</div></div>`;
    }

    const ql = (s.quarterly || [])[0];
    if (ql) {
      const auto = JSON.parse(String(ql.automation_review_json || '{}'));
      const ops = JSON.parse(String(ql.operating_patterns_json || '{}'));
      const recs = Array.isArray(auto.recommendations) ? auto.recommendations : [];
      body += `<div class="panel"><h3>Quarterly evolution — ${LIFE.esc(String(ql.period_start))} (${LIFE.esc(String(ql.status))})</h3>
        <div style="font-size:13px;margin:6px 0">Captured this quarter <b>${ops.captured_this_quarter ?? 0}</b> · done <b>${ops.done_this_quarter ?? 0}</b></div>
        ${recs.length ? `<table class="data"><thead><tr><th>Capability</th><th>Evidence verdict</th><th>Accuracy</th><th>Sample</th></tr></thead><tbody>`
          + recs.map((r) => `<tr><td>${LIFE.esc(String(r.capability))}</td><td>${LIFE.esc(String(r.recommendation))}</td><td>${r.accuracy == null ? '—' : Number(r.accuracy).toFixed(2)}</td><td>${Number(r.sample)}</td></tr>`).join('')
          + `</tbody></table>` : ''}
        <div class="lc-row">
          ${String(ql.status) === 'DRAFT' ? cmdBtn('Approve quarter', 'approve_quarter', { periodStart: ql.period_start }) : ''}
          ${cmdBtn('Recompile quarter', 'compile_quarter')}
        </div></div>`;
    } else {
      body += `<div class="panel"><h3>Quarterly evolution</h3>
        <div style="padding:10px 4px;color:var(--muted,#8aa);font-size:13px">No review compiled for this quarter yet.</div>
        <div class="lc-row">${cmdBtn('Compile quarterly review', 'compile_quarter')}</div></div>`;
    }
    return { stamp: `life-review · w=${(s.weekly || []).length} q=${(s.quarterly || []).length}`, body };
  },
};
