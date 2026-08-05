'use strict';
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-quarterly', route: '/life/quarterly', workspace: 'life', title: 'Quarterly evolution',
  sub: 'What to add, refine, automate or retire — evidence-led, decided by you',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { absent: true };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return { reviews: q(`SELECT * FROM life_quarterly_reviews ORDER BY period_start DESC LIMIT 4`) };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (s.absent) return { stamp: '', body: wrap(LIFE.absentCard('Quarterly evolution')) };
    const ql = (s.reviews || [])[0];
    if (!ql) {
      return { stamp: '', body: wrap(LIFE.emptyCard(
        'Not enough evidence yet', 'A quarter of real use unlocks this review',
        'The quarterly review reads how the system actually behaved — what you captured, finished, ignored, and how well its suggestions earned your trust — and proposes what to add, refine or retire. Build it any time from what exists so far.',
        cmd('Build the quarterly review', 'compile_quarter', {}, 'primary'))) };
    }
    const ops = JSON.parse(String(ql.operating_patterns_json || '{}'));
    const auto = JSON.parse(String(ql.automation_review_json || '{}'));
    const recs = Array.isArray(auto.recommendations) ? auto.recommendations : [];
    const isDraft = String(ql.status) === 'DRAFT';
    const kpis = `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:12px">`
      + S.rcc.kpi({ label: 'Captured', value: String(ops.captured_this_quarter ?? 0), sub: 'this quarter' })
      + S.rcc.kpi({ label: 'Finished', value: String(ops.done_this_quarter ?? 0), sub: 'this quarter' })
      + `</div>`;
    const recsPanel = S.rcc.panel({
      title: `Suggestion quality — ${String(ql.period_start)}`, sub: 'Promotion is evidence-gated and stays your call',
      headRight: isDraft ? cmd('Approve quarter', 'approve_quarter', { periodStart: ql.period_start }, 'small primary') : '<span class="r-tag good">approved</span>',
      body: recs.length ? recs.map((r) => `<div class="r-lrow"><div><div style="font-weight:600">${LIFE.esc(String(r.capability).replace(/_/g, ' '))}</div>
          <div style="font-size:12px;color:var(--rmuted);margin-top:2px">${LIFE.esc(String(r.recommendation))}${r.sample ? ` · ${Number(r.sample)} decided` : ''}${r.accuracy != null ? ` · ${(Number(r.accuracy) * 100).toFixed(0)}% agreed with you` : ''}</div></div></div>`).join('')
        : `<div style="color:var(--rmuted);font-size:13px;padding:6px 0">Not enough observations yet — the suggestions have to earn a track record first.</div>`,
    });
    const actions = `<div style="display:flex;gap:8px;margin-top:12px">${cmd('Rebuild the review', 'compile_quarter')}</div>`;
    return { stamp: '', body: wrap(kpis + recsPanel + actions) };
  },
};
