'use strict';
// LIFE OS — TRUST & AUTOMATION. Capability-level calibration, never one vague score
// (pack ADR-007). Build-ahead scaffold: the tables land with the confidence engine PR.
const LIFE = require('./life-lib.js');

module.exports = {
  key: 'life-trust', route: '/life/trust', workspace: 'life', title: 'Trust & Automation',
  sub: 'Confidence by capability, maturity by evidence — authority never granted by confidence · read-only',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason } };
    try {
      const caps = LIFE.lifeSelect(o.db,
        `SELECT capability_key, display_name, maturity, authority_ceiling FROM life_automation_capabilities ORDER BY capability_key`);
      return { engine: { ok: true }, caps: caps.ok ? caps.rows : null };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (!s.engine || !s.engine.ok) {
      return { stamp: 'life-trust · engine gate', body: LIFE.engineGate(s.engine ? s.engine.reason : 'no engine state') };
    }
    let body;
    if (s.caps && s.caps.length) {
      const tr = s.caps.map((r) =>
        `<tr><td>${LIFE.esc(r.display_name)}</td><td>${LIFE.esc(r.maturity)}</td><td>${LIFE.esc(r.authority_ceiling)}</td></tr>`).join('');
      body = `<div class="panel"><h3>Capabilities (${s.caps.length})</h3><table class="data"><thead>`
        + `<tr><th>Capability</th><th>Maturity</th><th>Ceiling</th></tr></thead><tbody>${tr}</tbody></table></div>`;
    } else {
      body = LIFE.gatePanel('Capability calibration board',
        'the confidence + maturity engine (PR 6): per-capability predictions, resolved outcomes, calibration gaps, promotion evidence — external actions stay tap-gated at EVERY confidence');
    }
    body += LIFE.gatePanel('Automation disclosure + emergency pause', 'the confidence engine PR (pause is an operator control, wired to the gated command path)');
    return { stamp: `life-trust · caps=${s.caps ? s.caps.length : 0}`, body };
  },
};
