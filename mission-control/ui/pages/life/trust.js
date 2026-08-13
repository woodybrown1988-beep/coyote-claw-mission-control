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
        // RESOLVED counts only real verdicts — CORRECT / CORRECT_AFTER_EDIT / WRONG. The
        // lifecycle sweep (engine Wave 1, 2026-08-13) writes UNRESOLVED on expiry, and that
        // row must move NO capability's accuracy in either direction. This formula matches
        // capabilityCalibration() in the engine's reviews.ts — the two must not drift.
        calib: q(`SELECT p.capability_key, COUNT(*) n, AVG(p.predicted_confidence) mean_conf,
                         SUM(CASE WHEN o2.resolution IN ('CORRECT','CORRECT_AFTER_EDIT') THEN 1 ELSE 0 END) correct,
                         SUM(CASE WHEN o2.resolution IN ('CORRECT','CORRECT_AFTER_EDIT','WRONG') THEN 1 ELSE 0 END) resolved
                    FROM life_confidence_predictions p LEFT JOIN life_confidence_outcomes o2 ON o2.prediction_id = p.id
                   GROUP BY p.capability_key`),
        expired: q(`SELECT COUNT(*) c FROM life_update_proposals WHERE state = 'EXPIRED'`)[0]?.c ?? 0,
        events: q(`SELECT e.event_type, e.reason, e.created_at, c.capability_key
                     FROM life_automation_events e JOIN life_automation_capabilities c ON c.id = e.capability_id
                    ORDER BY e.created_at DESC LIMIT 15`),
        // THE FILING RAIL'S EVIDENCE, finally on the page where promotions are judged (Wave
        // 3, audit §4 counter-example). It runs its own per-rule ladder — each rule armed
        // by an explicit operator tap authorizing a CLASS — so its promotion-grade numbers
        // lived in a parallel set of books this page could not see.
        rail: {
          armed: q(`SELECT COUNT(*) c FROM life_mail_rules WHERE state = 'ARMED'`)[0]?.c ?? 0,
          armedMachine: q(`SELECT COUNT(*) c FROM life_mail_rules WHERE state = 'ARMED' AND origin = 'CLASSIFIER'`)[0]?.c ?? 0,
          disabled: q(`SELECT COUNT(*) c FROM life_mail_rules WHERE state = 'DISABLED'`)[0]?.c ?? 0,
          applied: q(`SELECT COUNT(*) c FROM life_mail_moves WHERE state = 'APPLIED'`)[0]?.c ?? 0,
          undone: q(`SELECT COUNT(*) c FROM life_mail_moves WHERE state = 'UNDONE'`)[0]?.c ?? 0,
        },
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
    // ONE-LINE ROLLUP (Wave 3, audit: 13 identical "0 of 30" cards with no summary). The
    // glanceable truth first; the cards carry the detail.
    const capsArr = s.caps || [];
    let rollup = '';
    if (capsArr.length) {
      const maturities = [...new Set(capsArr.map((c) => String(c.maturity).toLowerCase().replace('_', ' ')))];
      let best = null;
      for (const c of capsArr) {
        const k = calibOf[c.capability_key] || {};
        const r = Number(k.resolved || 0);
        if (!best || r > best.r) best = { name: c.display_name, r, need: Number(c.minimum_sample) };
      }
      rollup = `<div class="r-note" style="margin-bottom:12px"><b>${capsArr.length} capabilities, ${maturities.length === 1 ? `all at ${maturities[0]}` : `at ${maturities.join(' / ')}`}.</b>`
        + (best && best.r > 0
          ? ` Furthest along: ${LIFE.esc(String(best.name))} — ${best.r} of ${best.need} decisions toward its promotion review.`
          : ' None has enough decided suggestions to move yet — deciding proposals on Today is what feeds this page.')
        + (Number(s.expired || 0) ? ` ${s.expired} proposal${s.expired === 1 ? '' : 's'} expired unattended — expiries never count for or against anyone.` : '')
        + `</div>`;
    }
    // THE FILING RAIL'S LEDGER CARD (audit §4): the one class-authorized actor, with its
    // promotion-grade numbers where promotions are judged. Its ladder is per-rule (your tap
    // arms each rule); the undo rate is its standing accuracy measure.
    const rl = s.rail || {};
    const railTotal = Number(rl.applied || 0) + Number(rl.undone || 0);
    const railCard = railTotal ? S.rcc.panel({
      title: 'The filing rail — class-authorized, working', sub: 'Each rule armed by your tap authorizes a CLASS; every move individually reversible',
      body: `<div style="font-size:13px;line-height:1.8">`
        + `<b>${rl.applied}</b> filed by <b>${rl.armed}</b> armed rule${rl.armed === 1 ? '' : 's'} (${rl.armedMachine || 0} machine-authored, armed by you) · `
        + `<b>${rl.undone}</b> put back (${railTotal ? ((Number(rl.undone) / railTotal) * 100).toFixed(1) : '0.0'}%)`
        + `${rl.disabled ? ` · ${rl.disabled} rule${rl.disabled === 1 ? '' : 's'} retired` : ''}.`
        + `<div class="r-note" style="margin-top:6px">This is the trust ladder working at class grain: one tap authorized each rule, the undo is the accuracy measure, and an undo retires its rule. The rails above earn the same shape by being right here first.</div></div>`,
    }) : '';
    const note = `<div class="r-note" style="margin-bottom:12px">Being confident is not the same as being allowed: whatever the numbers say, nothing external ever happens without your yes, and the crossed-out rungs are ceilings that cannot be climbed.</div>`;
    return { stamp: '', body: wrap(note + rollup + railCard + `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin:12px 0 12px">${capsArr.map(card).join('')}</div>` + ledger) };
  },
};
