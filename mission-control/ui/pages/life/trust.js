'use strict';
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

const LADDER = ['OBSERVE', 'RECOMMEND', 'SHADOW', 'ASSIST', 'TRUSTED_BOUNDED'];

module.exports = {
  key: 'life-trust', route: '/life/trust', workspace: 'life', title: 'Trust & automation',
  sub: 'Confidence by capability, authority by evidence — never one vague score',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { absent: true };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return {
        caps: q(`SELECT capability_key, display_name, maturity, authority_ceiling, emergency_paused, minimum_sample, required_accuracy FROM life_automation_capabilities ORDER BY capability_key`),
        calib: q(`SELECT p.capability_key, COUNT(*) n, AVG(p.predicted_confidence) mean_conf,
                         SUM(CASE WHEN o2.resolution IN ('CORRECT','CORRECT_AFTER_EDIT') THEN 1 ELSE 0 END) correct,
                         SUM(CASE WHEN o2.id IS NOT NULL THEN 1 ELSE 0 END) resolved
                    FROM life_confidence_predictions p LEFT JOIN life_confidence_outcomes o2 ON o2.prediction_id = p.id
                   GROUP BY p.capability_key`),
        events: q(`SELECT e.event_type, e.reason, e.created_at, c.capability_key
                     FROM life_automation_events e JOIN life_automation_capabilities c ON c.id = e.capability_id
                    ORDER BY e.created_at DESC LIMIT 15`),
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (s.absent) return { stamp: '', body: wrap(LIFE.absentCard('Trust & automation')) };
    const calibOf = {};
    for (const c of s.calib || []) calibOf[c.capability_key] = c;
    const card = (c) => {
      const k = calibOf[c.capability_key] || {};
      const resolved = Number(k.resolved || 0);
      const enough = resolved >= Number(c.minimum_sample);
      const acc = resolved > 0 ? Number(k.correct) / resolved : null;
      const paused = Number(c.emergency_paused) === 1;
      const ladder = LADDER.map((step) => {
        const on = step === c.maturity;
        const beyond = LADDER.indexOf(step) > LADDER.indexOf(c.authority_ceiling);
        return `<span class="r-tag${on ? ' good' : ''}" style="${beyond ? 'opacity:.35;text-decoration:line-through' : on ? '' : 'opacity:.6'}">${step.toLowerCase().replace('_', ' ')}</span>`;
      }).join(' ');
      const evidence = enough && acc !== null
        ? `${resolved} suggestions decided · ${(acc * 100).toFixed(0)}% agreed with you`
        : `Not enough observations yet (${resolved} of ${Number(c.minimum_sample)} needed) — it earns trust by being right, not by asking.`;
      return `<div class="r-card r-panel"${paused ? ' style="opacity:.6"' : ''}>
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div>
        <div style="font-weight:650">${LIFE.esc(c.display_name)}${paused ? ' <span class="r-tag bad">paused</span>' : ''}</div>
        <div style="font-size:12px;color:var(--rmuted);margin:6px 0">${LIFE.esc(evidence)}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${ladder}</div></div>
        <div>${paused ? cmd('Resume', 'resume_capability', { capabilityKey: c.capability_key }, 'small') : cmd('Pause', 'pause_capability', { capabilityKey: c.capability_key }, 'small')}</div></div></div>`;
    };
    const ledger = (s.events || []).length ? S.rcc.panel({
      title: 'The record', sub: 'Every automation change, on the books',
      body: s.events.map((e) => `<div class="r-lrow"><div style="font-size:12.5px"><b>${LIFE.esc(e.capability_key.replace(/_/g, ' '))}</b> — ${LIFE.esc(e.event_type.toLowerCase())} · ${LIFE.esc(String(e.reason))}</div></div>`).join(''),
    }) : '';
    const note = `<div class="r-note" style="margin-bottom:12px">Being confident is not the same as being allowed: whatever the numbers say, nothing external ever happens without your yes, and the crossed-out rungs are ceilings that cannot be climbed.</div>`;
    return { stamp: '', body: wrap(note + `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-bottom:12px">${(s.caps || []).map(card).join('')}</div>` + ledger) };
  },
};
