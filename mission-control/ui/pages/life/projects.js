'use strict';
// LIFE OS — PROJECTS. Read-only listing (max four active, DB-enforced in the engine).
const LIFE = require('./life-lib.js');

module.exports = {
  key: 'life-projects', route: '/life/projects', workspace: 'life', title: 'Projects',
  sub: 'Maximum four active — stage, risk and due date · read-only',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      const rows = LIFE.lifeSelect(o.db,
        `SELECT title, domain_key, stage, status, risk_state, due_date FROM life_projects
          ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'WAITING' THEN 1 ELSE 2 END, created_at LIMIT 50`);
      return { engine: { ok: true }, rows: rows.ok ? rows.rows : [], err: rows.ok ? null : rows.error };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (!s.engine || !s.engine.ok) {
      return { stamp: 'life-projects · engine gate', body: LIFE.engineGate(s.engine ? s.engine.reason : 'no engine state') };
    }
    let body;
    if (s.err) body = LIFE.engineGate(`projects unreadable: ${s.err}`);
    else if (!s.rows.length) {
      body = `<div class="panel"><h3>Projects</h3><div style="padding:14px 4px;color:var(--muted,#8aa);font-size:13px">`
        + `No projects yet — honest empty state, nothing simulated.</div></div>`;
    } else {
      const tr = s.rows.map((r) =>
        `<tr><td>${LIFE.esc(r.title)}</td><td>${LIFE.esc(r.domain_key)}</td><td>${LIFE.esc(r.stage)}</td>`
        + `<td>${LIFE.esc(r.status)}</td><td>${LIFE.esc(r.risk_state)}</td><td>${LIFE.esc(r.due_date || '—')}</td></tr>`).join('');
      body = `<div class="panel"><h3>Projects (${s.rows.length})</h3><table class="data"><thead>`
        + `<tr><th>Project</th><th>Domain</th><th>Stage</th><th>Status</th><th>Risk</th><th>Due</th></tr></thead><tbody>${tr}</tbody></table></div>`;
    }
    body += LIFE.gatePanel('Stalled-project detector', 'the attention manager (engine PR 7) — flags projects with no executable next action');
    return { stamp: `life-projects · ${s.rows ? s.rows.length : 0} rows`, body };
  },
};
