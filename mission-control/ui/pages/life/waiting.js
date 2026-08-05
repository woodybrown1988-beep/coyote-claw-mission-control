'use strict';
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-waiting', route: '/life/waiting', workspace: 'life', title: 'Waiting for',
  sub: 'Visible, never occupying an execution slot — every item has a wake path',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { absent: true };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return {
        rows: q(`SELECT t.id AS task_id, t.title, w.dependency_label, w.wake_type, w.fallback_at
                   FROM life_waiting_conditions w JOIN life_tasks t ON t.id = w.task_id
                  WHERE w.state = 'ACTIVE' ORDER BY w.fallback_at IS NULL, w.fallback_at LIMIT 100`),
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (s.absent) return { stamp: '', body: wrap(LIFE.absentCard('Waiting for')) };
    const nowIso = new Date().toISOString();
    const rule = `<div class="r-note" style="margin-bottom:12px">The rule: nothing waits without a wake path — a follow-up date at minimum, so no dependency can rot silently. Park any task from its own page ("Park waiting…").</div>`;
    if (!s.rows.length) {
      return { stamp: '', body: wrap(rule + LIFE.emptyCard('Waiting for', 'Nothing parked', 'Nothing is waiting on anyone. When you park a task on a person or a date, it sits here — visible, costing you nothing.', '<button class="r-btn primary" data-lc-fab>Capture a task</button>')) };
    }
    const row = (r) => {
      const overdue = r.fallback_at && String(r.fallback_at) < nowIso;
      return `<div class="r-lrow"${overdue ? ' style="color:#f5c96b"' : ''}><div style="min-width:0"><div style="font-weight:600">${link(r.task_id, r.title)}</div>
        <div style="font-size:12px;margin-top:3px;color:${overdue ? '#f5c96b' : 'var(--rmuted)'}">Waiting on ${LIFE.esc(r.dependency_label)} · ${r.wake_type === 'DATE' ? 'wakes on its date' : 'wakes when you note an update'}${r.fallback_at ? ` · follow-up ${LIFE.esc(String(r.fallback_at).slice(0, 10))}${overdue ? ' — PASSED' : ''}` : ''}</div></div>
        ${cmd(overdue ? 'Wake it' : 'Wake', 'wake', { taskId: r.task_id }, overdue ? 'small primary' : 'small')}</div>`;
    };
    const overdueRows = s.rows.filter((r) => r.fallback_at && String(r.fallback_at) < nowIso);
    const quietRows = s.rows.filter((r) => !overdueRows.includes(r));
    let body = rule;
    if (overdueRows.length) body += S.rcc.panel({ title: 'Past their follow-up date', sub: 'Chase, wake or re-park — silence is the one wrong answer', headRight: `<span class="r-pill">${overdueRows.length}</span>`, body: overdueRows.map(row).join('') });
    if (quietRows.length) body += S.rcc.panel({ title: 'Tracked quietly', headRight: `<span class="r-pill">${quietRows.length}</span>`, body: quietRows.map(row).join('') });
    return { stamp: '', body: wrap(body) };
  },
};
