'use strict';
// LIFE OS — TODAY. The attention surface, not a dashboard (pack ADR-009): one must-win, two
// supports, a capped decision queue, available work, waiting held quietly. This PR is the
// read-only scaffold: REAL counts from life.db (a count is a read, never a mock) + designed
// gate-states naming the exact PR that lights each panel. The librarian db handle the server
// passes is deliberately unused — Life OS state lives in its own file (ruling 2026-08-05).
const LIFE = require('./life-lib.js');

function count(db, sql) {
  const r = LIFE.lifeSelect(db, sql);
  return r.ok && r.rows[0] ? Number(Object.values(r.rows[0])[0]) : null;
}

module.exports = {
  key: 'life-today', route: '/life/today', workspace: 'life', title: 'Today',
  sub: 'What to do next — one must-win, two supports, decisions capped · read-only scaffold, writes land with the gated command path',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      return {
        engine: { ok: true },
        counts: {
          activeOutcomes: count(o.db, `SELECT COUNT(*) FROM life_outcomes WHERE status = 'ACTIVE'`),
          activeProjects: count(o.db, `SELECT COUNT(*) FROM life_projects WHERE status = 'ACTIVE'`),
          availableNow: count(o.db, `SELECT COUNT(*) FROM v_life_available_work`),
          waiting: count(o.db, `SELECT COUNT(*) FROM life_tasks WHERE status = 'WAITING'`),
          decisions: count(o.db, `SELECT COUNT(*) FROM life_tasks WHERE status = 'AWAITING_APPROVAL'`),
          inbox: count(o.db, `SELECT COUNT(*) FROM life_tasks WHERE status = 'INBOX'`),
        },
        inboxRows: (LIFE.lifeSelect(o.db,
          `SELECT id, title, domain_key, created_at FROM life_tasks WHERE status = 'INBOX' ORDER BY created_at DESC LIMIT 10`,
        ).rows) || [],
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (!s.engine || !s.engine.ok) {
      return { stamp: 'life-today · engine gate', body: LIFE.engineGate(s.engine ? s.engine.reason : 'no engine state') };
    }
    const c = s.counts || {};
    const tile = (label, v, hint) =>
      `<div class="tile"><div class="tile-label">${LIFE.esc(label)}</div>`
      + `<div class="tile-value">${v == null ? '—' : Number(v)}</div>`
      + `<div class="tile-sub">${LIFE.esc(hint)}</div></div>`;
    const hero = `<div class="tiles" style="grid-template-columns:repeat(6,minmax(120px,1fr))">`
      + tile('Active outcomes', c.activeOutcomes, 'cap 3 — DB-enforced')
      + tile('Active projects', c.activeProjects, 'cap 4 — DB-enforced')
      + tile('Available now', c.availableNow, 'executable, never waiting')
      + tile('Waiting', c.waiting, 'held quietly, wake-gated')
      + tile('Owner decisions', c.decisions, 'awaiting approval')
      + tile('Inbox', c.inbox, 'uncaptured triage')
      + `</div>`;
    // Inbox: the capture landing zone — a captured task is visible HERE immediately (A5
    // acceptance). ✕ cancels via the gated command path (the capture-mistake eraser), audited.
    let inboxPanel;
    const rows = s.inboxRows || [];
    if (rows.length) {
      const tr = rows.map((r) => {
        const ms = Date.parse(r.created_at);
        const when = Number.isFinite(ms) ? `<time data-ms="${ms}">${LIFE.esc(r.created_at)}</time>` : LIFE.esc(r.created_at);
        return `<tr><td>${LIFE.esc(r.title)}</td><td>${LIFE.esc(r.domain_key)}</td><td>${when}</td>`
          + `<td><button class="lc-cxl" data-lc-cancel="${LIFE.esc(r.id)}" title="Cancel this task (audited)">✕ cancel</button></td></tr>`;
      }).join('');
      inboxPanel = `<div class="panel"><h3>Inbox (${rows.length}${rows.length === 10 ? '+' : ''})</h3><table class="data"><thead>`
        + `<tr><th>Captured</th><th>Domain</th><th>When</th><th></th></tr></thead><tbody>${tr}</tbody></table></div>`;
    } else {
      inboxPanel = `<div class="panel"><h3>Inbox</h3><div style="padding:14px 4px;color:var(--muted,#8aa);font-size:13px">`
        + `Empty — capture with the ＋ button or Ctrl/Cmd+K from any workspace; it lands here immediately.</div></div>`;
    }
    const body = hero
      + inboxPanel
      + LIFE.gatePanel('Must-win + two supports', 'the attention manager (engine PR 7) compiles the daily plan before the 07:05 brief')
      + LIFE.gatePanel('Rex’s read-only brief line', 'Rex read models (Phase-3 acceptance: read-only life.db handle, no command route)')
      + LIFE.gatePanel('Owner decision queue', 'the decision-queue surface (Phase-3 acceptance) — capped, owner-authority items only')

      + LIFE.gatePanel('What the system handled', 'the automation disclosure ledger (confidence engine, PR 6)');
    return { stamp: `life-today · outcomes=${c.activeOutcomes ?? '—'} available=${c.availableNow ?? '—'}`, body };
  },
};
