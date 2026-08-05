'use strict';
// LIFE OS — TRUST & AUTOMATION (A12), LIVE: capability-level calibration (never one vague
// score — ADR-007), maturity + ceilings, the emergency pause, and the automation event
// ledger. Confidence never grants authority; promotion is evidence-gated and OWNER-applied.
const LIFE = require('./life-lib.js');

const cmdBtn = (label, command, payload) =>
  `<button class="lc-btn lc-ghost" style="min-width:0" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-trust', route: '/life/trust', workspace: 'life', title: 'Trust & Automation',
  sub: 'Confidence by capability, maturity by evidence — authority never granted by confidence',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return {
        engine: { ok: true },
        caps: q(`SELECT capability_key, display_name, maturity, authority_ceiling, emergency_paused, minimum_sample, required_accuracy FROM life_automation_capabilities ORDER BY capability_key`),
        calib: q(`SELECT p.capability_key, COUNT(*) n, AVG(p.predicted_confidence) mean_conf,
                         SUM(CASE WHEN o2.resolution IN ('CORRECT','CORRECT_AFTER_EDIT') THEN 1 ELSE 0 END) correct,
                         SUM(CASE WHEN o2.id IS NOT NULL THEN 1 ELSE 0 END) resolved
                    FROM life_confidence_predictions p LEFT JOIN life_confidence_outcomes o2 ON o2.prediction_id = p.id
                   GROUP BY p.capability_key`),
        events: q(`SELECT e.event_type, e.reason, e.actor_id, e.created_at, c.capability_key
                     FROM life_automation_events e JOIN life_automation_capabilities c ON c.id = e.capability_id
                    ORDER BY e.created_at DESC LIMIT 20`),
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (!s.engine || !s.engine.ok) {
      return { stamp: 'life-trust · engine gate', body: LIFE.engineGate(s.engine ? s.engine.reason : 'no engine state') };
    }
    const calibOf = {};
    for (const c of s.calib || []) calibOf[c.capability_key] = c;
    let body;
    if (s.caps && s.caps.length) {
      const tr = s.caps.map((c) => {
        const k = calibOf[c.capability_key] || {};
        const resolved = Number(k.resolved || 0);
        const acc = resolved > 0 ? (Number(k.correct) / resolved) : null;
        const gap = resolved > 0 && k.mean_conf != null ? Math.abs(Number(k.mean_conf) - acc) : null;
        const paused = Number(c.emergency_paused) === 1;
        return `<tr${paused ? ' style="opacity:.55"' : ''}>
          <td>${LIFE.esc(c.display_name)}${paused ? ' <b style="color:#ff9b8a">PAUSED</b>' : ''}</td>
          <td>${LIFE.esc(c.maturity)} <span style="color:var(--muted,#8aa)">(ceiling ${LIFE.esc(c.authority_ceiling)})</span></td>
          <td style="text-align:right">${Number(k.n || 0)}</td>
          <td style="text-align:right">${resolved}</td>
          <td style="text-align:right">${acc == null ? '—' : acc.toFixed(2)}</td>
          <td style="text-align:right">${gap == null ? '—' : gap.toFixed(2)}</td>
          <td>${paused
            ? cmdBtn('Resume', 'resume_capability', { capabilityKey: c.capability_key })
            : cmdBtn('Pause', 'pause_capability', { capabilityKey: c.capability_key })}</td></tr>`;
      }).join('');
      body = `<div class="panel"><h3>Capabilities (${s.caps.length})</h3>
        <div style="font-size:12px;color:var(--muted,#8aa);margin:4px 0 8px">Promotion needs sample ≥ minimum AND accuracy ≥ required AND your explicit call — a confident capability still cannot act beyond its maturity.</div>
        <table class="data"><thead><tr><th>Capability</th><th>Maturity</th><th>Predictions</th><th>Resolved</th><th>Accuracy</th><th>Calibration gap</th><th></th></tr></thead><tbody>${tr}</tbody></table></div>`;
    } else {
      body = LIFE.gatePanel('Capability calibration board', 'capabilities seed on the writer’s first start after the planner-engine deploy');
    }
    const evRows = (s.events || []).map((e) => {
      const ms = Date.parse(String(e.created_at));
      return `<tr><td><time data-ms="${Number.isFinite(ms) ? ms : 0}">${LIFE.esc(String(e.created_at))}</time></td><td>${LIFE.esc(e.capability_key)}</td><td>${LIFE.esc(e.event_type)}</td><td style="font-size:12px">${LIFE.esc(e.reason)}</td></tr>`;
    }).join('');
    body += `<div class="panel"><h3>Automation ledger</h3>${evRows
      ? `<table class="data"><thead><tr><th>When</th><th>Capability</th><th>Event</th><th>Why</th></tr></thead><tbody>${evRows}</tbody></table>`
      : '<div style="padding:10px 4px;color:var(--muted,#8aa);font-size:13px">No automation events yet.</div>'}</div>`;
    return { stamp: `life-trust · caps=${(s.caps || []).length}`, body };
  },
};
