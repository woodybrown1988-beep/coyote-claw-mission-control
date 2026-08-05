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
      const listing = LIFE.lifeSelect(o.db,
        `SELECT id, title, status, domain_key, updated_at FROM life_tasks
          WHERE status NOT IN ('DONE','CANCELLED') ORDER BY updated_at DESC LIMIT 30`);
      const finished = LIFE.lifeSelect(o.db,
        `SELECT id, title, status, updated_at FROM life_tasks
          WHERE status IN ('DONE','CANCELLED') ORDER BY updated_at DESC LIMIT 10`);
      return { engine: { ok: true }, byStatus, listing: listing.ok ? listing.rows : [], finished: finished.ok ? finished.rows : [], err: r.ok ? null : r.error };
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
    const row = (r) => `<tr><td><a href="/life/task?id=${encodeURIComponent(r.id)}">${LIFE.esc(r.title)}</a></td><td>${LIFE.esc(r.status)}</td><td>${LIFE.esc(r.domain_key || '')}</td></tr>`;
    if (s.listing && s.listing.length) {
      body += `<div class="panel"><h3>Open tasks (${s.listing.length})</h3><table class="data"><thead><tr><th>Task</th><th>State</th><th>Domain</th></tr></thead><tbody>${s.listing.map(row).join('')}</tbody></table></div>`;
    }
    if (s.finished && s.finished.length) {
      body += `<div class="panel"><h3>Recently finished</h3><table class="data"><tbody>${s.finished.map((r) => `<tr><td><a href="/life/task?id=${encodeURIComponent(r.id)}">${LIFE.esc(r.title)}</a></td><td>${LIFE.esc(r.status)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    return { stamp: 'life-tasks · board', body };
  },
};
