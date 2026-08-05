'use strict';
// LIFE OS — ALL TASKS. Read-only status board (counts per state — real reads, never mocks).
const LIFE = require('./life-lib.js');

const STATUSES = ['INBOX', 'READY', 'SCHEDULED', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'AWAITING_APPROVAL', 'BATCH', 'DONE', 'CANCELLED'];

module.exports = {
  key: 'life-tasks', route: '/life/tasks', workspace: 'life', title: 'Tasks',
  sub: 'Every task by state — the drawer (notes, evidence, proposals) lands with the evidence engine · read-only',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      const r = LIFE.lifeSelect(o.db, `SELECT status, COUNT(*) AS n FROM life_tasks GROUP BY status`);
      const byStatus = {};
      if (r.ok) for (const row of r.rows) byStatus[row.status] = Number(row.n);
      return { engine: { ok: true }, byStatus, err: r.ok ? null : r.error };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (!s.engine || !s.engine.ok) {
      return { stamp: 'life-tasks · engine gate', body: LIFE.engineGate(s.engine ? s.engine.reason : 'no engine state') };
    }
    let body;
    if (s.err) body = LIFE.engineGate(`tasks unreadable: ${s.err}`);
    else {
      const total = Object.values(s.byStatus || {}).reduce((a, b) => a + b, 0);
      const tr = STATUSES.map((st) => `<tr><td>${st}</td><td style="text-align:right">${(s.byStatus && s.byStatus[st]) || 0}</td></tr>`).join('');
      body = `<div class="panel"><h3>Tasks by state (${total})</h3><table class="data"><thead>`
        + `<tr><th>State</th><th style="text-align:right">Count</th></tr></thead><tbody>${tr}</tbody></table></div>`;
    }
    body += LIFE.gatePanel('Task drawer — notes, extracted facts, proposals, accept/edit/reject, audited Undo/Reopen',
      'the task-update evidence engine + the sole-writer command path (Phase-3 acceptance; writes stay gated until that path is documented + tested)');
    return { stamp: 'life-tasks · board', body };
  },
};
