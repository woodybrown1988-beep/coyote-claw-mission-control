'use strict';
// LIFE OS — WAITING FOR. Every waiting item carries exactly one ACTIVE wake condition
// (DB-enforced in the engine); this board shows them quietly, never as execution slots.
const LIFE = require('./life-lib.js');

module.exports = {
  key: 'life-waiting', route: '/life/waiting', workspace: 'life', title: 'Waiting',
  sub: 'Held work with a wake path — never occupying an execution slot · read-only',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      const rows = LIFE.lifeSelect(o.db,
        `SELECT t.title, w.dependency_label, w.wake_type, w.fallback_at
           FROM life_waiting_conditions w JOIN life_tasks t ON t.id = w.task_id
          WHERE w.state = 'ACTIVE' ORDER BY w.fallback_at IS NULL, w.fallback_at LIMIT 100`);
      return { engine: { ok: true }, rows: rows.ok ? rows.rows : [], err: rows.ok ? null : rows.error };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (!s.engine || !s.engine.ok) {
      return { stamp: 'life-waiting · engine gate', body: LIFE.engineGate(s.engine ? s.engine.reason : 'no engine state') };
    }
    let body;
    if (s.err) body = LIFE.engineGate(`waiting conditions unreadable: ${s.err}`);
    else if (!s.rows.length) {
      body = `<div class="panel"><h3>Waiting for</h3><div style="padding:14px 4px;color:var(--muted,#8aa);font-size:13px">`
        + `Nothing waiting — or nothing captured yet. Every future waiting item carries one active wake condition by DB constraint.</div></div>`;
    } else {
      const tr = s.rows.map((r) =>
        `<tr><td>${LIFE.esc(r.title)}</td><td>${LIFE.esc(r.dependency_label)}</td>`
        + `<td>${LIFE.esc(r.wake_type)}</td><td>${LIFE.esc(r.fallback_at || 'no fallback')}</td></tr>`).join('');
      body = `<div class="panel"><h3>Waiting for (${s.rows.length})</h3><table class="data"><thead>`
        + `<tr><th>Task</th><th>Waiting on</th><th>Wakes on</th><th>Fallback</th></tr></thead><tbody>${tr}</tbody></table></div>`;
    }
    body += LIFE.gatePanel('Reply-match wake-ups (EMAIL_REPLY)', 'the Microsoft Graph phase — a SEPARATE go/no-go after the 30-day pilot; DATE/HUMAN_UPDATE wakes work without it');
    return { stamp: `life-waiting · ${s.rows ? s.rows.length : 0} active`, body };
  },
};
