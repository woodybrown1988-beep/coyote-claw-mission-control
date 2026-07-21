'use strict';
// THE ENGINE ROOM — Agents + Health merged (page-map audit 2026-07-21: both answered "is the
// machine fine"; two nav slots and a buried FAILED count answered it badly). One page:
//   1. TRIAGE HERO first — who needs you, how badly: fresh blocked count, aging give-ups,
//      failed jobs (the number the old Health page buried at the bottom), live workers.
//   2. The fleet board (agents.js — blocked now oldest-first with a collapsed >7d aging group).
//   3. The health panels (health.js — ship refs parsed + deduped).
// Composition: the two page modules keep their tested getSection/render; this page composes
// them and adds the hero. READ-ONLY as ever; /claw/agents + /claw/health 308 here.
const S = require('../../shared.js');
const agents = require('./agents.js');
const health = require('./health.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }

module.exports = {
  key: 'engine', route: '/claw/engine', workspace: 'claw', title: 'Engine room',
  sub: 'The whole machine on one page — triage first, then the fleet, then the plumbing · read-only, actions via Telegram',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    const AGING_MS = 7 * 86_400_000;
    const jobs = typeof q === 'function' ? rowsOf(q(`SELECT status, updated_at FROM jobs`)) : [];
    const esc7 = jobs.filter((j) => j.status === 'escalated' && now - Number(j.updated_at) < AGING_MS).length;
    const escAging = jobs.filter((j) => j.status === 'escalated' && now - Number(j.updated_at) >= AGING_MS).length;
    const failed = jobs.filter((j) => j.status === 'failed').length;
    const awaiting = jobs.filter((j) => j.status === 'awaiting_signoff').length;
    return {
      hero: { esc7, escAging, failed, awaiting },
      agents: agents.getSection(db, ctx),
      health: health.getSection(db, ctx),
    };
  },

  render(section, ctx) {
    const m = section || {};
    const h = m.hero || { esc7: 0, escAging: 0, failed: 0, awaiting: 0 };
    const a = agents.render(m.agents || {}, ctx) || { stamp: '', body: '' };
    const hh = health.render(m.health || {}, ctx) || { stamp: '', body: '' };
    const hero = `<div class="tiles" style="grid-template-columns:repeat(4,minmax(150px,1fr))">
      <div class="tile ${h.esc7 + h.awaiting > 0 ? 'red' : 'green'}"><div class="lab">Needs you now</div><div class="val">${S.fmtInt(h.esc7 + h.awaiting)}</div><div class="sub">${S.fmtInt(h.awaiting)} awaiting sign-off · ${S.fmtInt(h.esc7)} fresh give-up${h.esc7 === 1 ? '' : 's'} (≤7d)</div></div>
      <div class="tile ${h.escAging > 0 ? 'amber' : 'muted'}"><div class="lab">Aging give-ups</div><div class="val">${S.fmtInt(h.escAging)}</div><div class="sub">held over 7 days — in the board's collapsed group</div></div>
      <div class="tile ${h.failed > 0 ? 'amber' : 'muted'}"><div class="lab">Failed jobs · lifetime</div><div class="val">${S.fmtInt(h.failed)}</div><div class="sub">incl. the 95 dormant learn-validate — named, never hidden</div></div>
      <div class="tile blue"><div class="lab">Board</div><div class="val" style="font-size:15px">fleet ↓ · plumbing ↓↓</div><div class="sub">blocked column reads OLDEST first</div></div>
    </div>`;
    return {
      stamp: a.stamp || hh.stamp,
      body: hero
        + `<div class="sec-label" style="margin-top:16px">The fleet<span class="rule"></span></div>` + a.body
        + `<div class="sec-label" style="margin-top:22px">The plumbing<span class="rule"></span></div>` + hh.body,
    };
  },
};
