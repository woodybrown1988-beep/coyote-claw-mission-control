'use strict';
// LIFE OS — 12-WEEK OUTCOMES. Read-only listing (max three active, DB-enforced in the engine).
const LIFE = require('./life-lib.js');

module.exports = {
  key: 'life-outcomes', route: '/life/outcomes', workspace: 'life', title: 'Outcomes',
  sub: '12-week outcomes — maximum three active, proof-defined · read-only',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      const rows = LIFE.lifeSelect(o.db,
        `SELECT title, domain_key, status, target_date, priority FROM life_outcomes
          ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END, priority, created_at LIMIT 50`);
      return { engine: { ok: true }, rows: rows.ok ? rows.rows : [], err: rows.ok ? null : rows.error };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (!s.engine || !s.engine.ok) {
      return { stamp: 'life-outcomes · engine gate', body: LIFE.engineGate(s.engine ? s.engine.reason : 'no engine state') };
    }
    let body;
    if (s.err) body = LIFE.engineGate(`outcomes unreadable: ${s.err}`);
    else if (!s.rows.length) {
      body = `<div class="panel"><h3>Outcomes</h3><div style="padding:14px 4px;color:var(--muted,#8aa);font-size:13px">`
        + `No outcomes yet — honest empty state. Capture arrives with the gated command path; until then the engine CLI is the only writer.</div></div>`;
    } else {
      const tr = s.rows.map((r) =>
        `<tr><td>${LIFE.esc(r.title)}</td><td>${LIFE.esc(r.domain_key)}</td><td>${LIFE.esc(r.status)}</td>`
        + `<td>${LIFE.esc(r.target_date || '—')}</td><td>${Number(r.priority)}</td></tr>`).join('');
      body = `<div class="panel"><h3>Outcomes (${s.rows.length})</h3><table class="data"><thead>`
        + `<tr><th>Outcome</th><th>Domain</th><th>Status</th><th>Target</th><th>Priority</th></tr></thead><tbody>${tr}</tbody></table></div>`;
    }
    body += LIFE.gatePanel('Proof ledger per outcome', 'the outcome-proof drawer (read surfaces PR): BINARY/MEASUREMENT/EVIDENCE/MILESTONE states with evidence links');
    return { stamp: `life-outcomes · ${s.rows ? s.rows.length : 0} rows`, body };
  },
};
