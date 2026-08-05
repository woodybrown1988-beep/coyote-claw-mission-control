'use strict';
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-review', route: '/life/review', workspace: 'life', title: 'Weekly review',
  sub: 'Evidence first, thirty minutes at most — approve the Big 3, decide the carry-forwards',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { absent: true };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return { weekly: q(`SELECT * FROM life_weekly_snapshots ORDER BY week_start DESC LIMIT 6`) };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (s.absent) return { stamp: '', body: wrap(LIFE.absentCard('Weekly review')) };
    const latest = (s.weekly || [])[0];
    if (!latest) {
      return { stamp: '', body: wrap(LIFE.emptyCard(
        'Not enough evidence yet', 'The review builds itself from a week of real use',
        'The snapshot assembles every Sunday evening from what actually happened — finished work, captures, things that stalled. Use the week; the review earns its place. You can also build it now from whatever exists.',
        cmd('Build the snapshot now', 'compile_week', {}, 'primary'))) };
    }
    const ev = JSON.parse(String(latest.evidence_json || '{}'));
    const big3 = JSON.parse(String(latest.proposed_big_three_json || '[]'));
    const carry = JSON.parse(String(latest.carry_forward_json || '[]'));
    const subs = JSON.parse(String(latest.subtraction_json || '[]'));
    const isDraft = String(latest.status) === 'DRAFT';
    const kpis = `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:12px">`
      + S.rcc.kpi({ label: 'Finished', value: String(ev.done_week ?? 0), sub: 'this week' })
      + S.rcc.kpi({ label: 'Captured', value: String(ev.captured_week ?? 0), sub: 'this week' })
      + S.rcc.kpi({ label: 'Let go', value: String(ev.cancelled_week ?? 0), sub: 'cancelled' })
      + S.rcc.kpi({ label: 'Proofs moved', value: String(ev.outcome_proofs_moved ?? 0), sub: 'outcome evidence' })
      + S.rcc.kpi({ label: 'Follow-ups passed', value: String(ev.waiting_fallback_passed ?? 0), sub: 'waiting items to chase' })
      + `</div>`;
    const big3Panel = S.rcc.panel({
      title: `Proposed Big 3 — week of ${String(latest.week_start)}`, sub: isDraft ? 'Approve as proposed, or adjust the plan on Today first' : 'Approved',
      headRight: isDraft ? cmd('Approve week', 'approve_week', { weekStart: latest.week_start }, 'small primary') : '<span class="r-tag good">approved</span>',
      body: big3.length ? big3.map((b) => `<div class="r-lrow"><div style="font-weight:600">${link(b.id, b.title)}</div></div>`).join('')
        : `<div style="color:var(--rmuted);font-size:13px;padding:6px 0">Nothing available to propose — the week starts empty-handed unless something is captured.</div>`,
    });
    const carryPanel = carry.length ? S.rcc.panel({
      title: 'Carried forward', sub: 'Old enough to question — a third week of carrying is a choice',
      body: carry.map((c) => `<div class="r-lrow"><div><div style="font-weight:600">${link(c.id, c.title)}</div><div style="font-size:12px;color:var(--rmuted);margin-top:2px">${Number(c.ageDays)} days old</div></div></div>`).join(''),
    }) : '';
    const subsPanel = subs.length ? S.rcc.panel({
      title: 'Subtraction candidates', sub: 'Park it or let it go — carrying it again costs attention',
      body: subs.map((x) => `<div class="r-lrow"><div><div style="font-weight:600">${link(x.id, x.title)}</div><div style="font-size:12px;color:#f5c96b;margin-top:2px">${LIFE.esc(x.reason)}</div></div>${cmd('Let it go', 'cancel', { taskId: x.id }, 'small')}</div>`).join(''),
    }) : '';
    const history = (s.weekly || []).slice(1);
    const histPanel = history.length ? S.rcc.panel({ title: 'Past weeks', body: history.map((w) => `<div class="r-lrow"><div>${LIFE.esc(String(w.week_start))} → ${LIFE.esc(String(w.week_end))}</div><span class="r-tag${String(w.status) === 'APPROVED' ? ' good' : ''}">${LIFE.esc(String(w.status).toLowerCase())}</span></div>`).join('') }) : '';
    const actions = `<div style="display:flex;gap:8px;margin-bottom:12px">${cmd('Rebuild snapshot', 'compile_week')}</div>`;
    return { stamp: '', body: wrap(kpis + big3Panel + `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));margin-top:12px">${carryPanel}${subsPanel}</div>` + histPanel + actions) };
  },
};
