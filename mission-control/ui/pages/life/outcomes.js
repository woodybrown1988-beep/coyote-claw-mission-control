'use strict';
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-outcomes', route: '/life/outcomes', workspace: 'life', title: '12-week outcomes',
  sub: 'Three active at most — each with explicit proof of completion',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { absent: true };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return {
        outcomes: q(`SELECT id, title, domain_key, status, proof_definition, target_date FROM life_outcomes ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END, created_at LIMIT 20`),
        proofs: q(`SELECT outcome_id, label, proof_type, state FROM life_outcome_proofs ORDER BY created_at`),
        taskCounts: q(`SELECT outcome_id, COUNT(*) n FROM life_tasks WHERE outcome_id IS NOT NULL AND status NOT IN ('DONE','CANCELLED') GROUP BY outcome_id`),
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (s.absent) return { stamp: '', body: wrap(LIFE.absentCard('12-week outcomes')) };
    const active = s.outcomes.filter((o) => o.status === 'ACTIVE');
    const rest = s.outcomes.filter((o) => o.status !== 'ACTIVE');
    const nOf = (id) => (s.taskCounts.find((c) => c.outcome_id === id) || {}).n || 0;
    const card = (o) => `<div class="r-card r-panel"><div class="r-eyebrow">${LIFE.esc(o.status === 'ACTIVE' ? 'Active outcome' : o.status.toLowerCase())}</div>
      <div style="font-size:17px;font-weight:650;line-height:1.3;margin-bottom:8px">${LIFE.esc(o.title)}</div>
      <div>${S.rcc.tag(o.domain_key)} ${o.target_date ? S.rcc.tag('by ' + String(o.target_date).slice(0, 10)) : ''} ${S.rcc.tag(`${nOf(o.id)} open task${nOf(o.id) === 1 ? '' : 's'}`)}</div>
      <div class="r-defbox"><small>Proof of completion</small><div style="font-size:13px;line-height:1.45">${LIFE.esc(o.proof_definition)}</div></div></div>`;
    const openSlot = `<div class="r-card r-panel" style="border-style:dashed;display:flex;flex-direction:column;justify-content:center;text-align:center;color:var(--rmuted)">
      <div style="font-size:13.5px;line-height:1.6;padding:8px 4px">An open outcome slot.<br>Three at most — scarcity is the mechanism.</div></div>`;
    const slots = [...active.map(card)];
    while (slots.length < 3) slots.push(openSlot);
    const form = `<div class="r-card r-panel"><h3 class="r-panel-title" style="margin-bottom:8px">Add an outcome</h3>
      <form class="lc-create-form" data-kind="outcome" style="display:grid;gap:8px">
        <input class="lc-input" name="title" maxlength="200" placeholder="The outcome, in one plain sentence">
        <input class="lc-input" name="proof" maxlength="500" placeholder="Proof of completion — what evidence will exist when this is done?">
        <div style="display:flex;gap:8px;align-items:center"><select class="lc-domain" name="domain"><option value="general">general</option><option value="business">business</option><option value="health">health</option><option value="family">family</option><option value="admin">admin</option><option value="venture">venture</option></select>
        <button type="submit" class="r-btn primary">Add outcome</button></div>
      </form></div>`;
    const restRows = rest.length ? S.rcc.panel({ title: 'Planned and past', body: rest.map((o) => `<div class="r-lrow"><div><div style="font-weight:600">${LIFE.esc(o.title)}</div><div style="margin-top:3px">${S.rcc.tag(o.status.toLowerCase())} ${S.rcc.tag(o.domain_key)}</div></div></div>`).join('') }) : '';
    return { stamp: '', body: wrap(`<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-bottom:12px">${slots.join('')}</div>${active.length < 3 ? form : ''}${restRows}`) };
  },
};
