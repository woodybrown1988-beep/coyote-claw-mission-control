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

// ── WHAT IS ACTUALLY HAPPENING (operator ask 2026-08-13: "nothing has moved") ──────────────────
// The board moved fine. It was TIMED OUT: a live boxquery went queued → running → done in under
// twelve seconds, so the Working column is empty almost every time anyone looks at it, and five
// columns of instantaneous state describe a machine that appears permanently asleep. The columns
// answer "where is each agent RIGHT NOW"; nothing answered "what has this thing been doing".
//
// So this reads the DAY, not the instant — finished, failed and still-running work since LONDON
// midnight, grouped by department. A quiet department shows a real zero rather than being left
// out, because "no Finance work today" is itself an answer.
function flowToday(q, now) {
  if (typeof q !== 'function') return null;
  const since = S.londonMidnightMs(now);
  const rows = rowsOf(q(
    `SELECT type, status, updated_at FROM jobs WHERE updated_at >= ? OR status IN ('preparing','dispatched','running','queued')`,
    [since],
  ));
  const byDept = new Map();
  for (const d of Object.values(S.DEPARTMENTS)) {
    byDept.set(d.key, { key: d.key, label: d.label, colour: d.colour, finished: 0, failed: 0, live: 0, lastAt: null });
  }
  let finished = 0; let failed = 0; let live = 0; let lastFinishedAt = null;
  for (const r of rows) {
    const id = S.agentIdentity(r.type);
    const d = byDept.get(id.dept);
    const at = Number(r.updated_at);
    const inWindow = at >= since;
    const running = ['preparing', 'dispatched', 'running'].indexOf(r.status) !== -1;
    if (running) { live++; if (d) d.live++; continue; }
    if (!inWindow) continue; // a still-queued older job is not today's flow
    if (r.status === 'done') {
      finished++; if (d) { d.finished++; d.lastAt = Math.max(Number(d.lastAt || 0), at) || at; }
      if (lastFinishedAt === null || at > lastFinishedAt) lastFinishedAt = at;
    } else if (r.status === 'failed') {
      failed++; if (d) d.failed++;
    }
  }
  return {
    since, finished, failed, live, lastFinishedAt,
    depts: Array.from(byDept.values()).sort((a, b) => (b.live - a.live) || (b.finished - a.finished) || (a.label < b.label ? -1 : 1)),
  };
}

module.exports = {
  key: 'engine', route: '/claw/engine', workspace: 'claw', title: 'Engine room',
  sub: 'The whole machine on one page — triage first, then the fleet, then the plumbing · read-only, actions via Telegram',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    const AGING_MS = 7 * 86_400_000;
    const jobs = typeof q === 'function' ? rowsOf(q(`SELECT status, type, updated_at FROM jobs`)) : [];
    const esc7 = jobs.filter((j) => j.status === 'escalated' && now - Number(j.updated_at) < AGING_MS).length;
    const escAging = jobs.filter((j) => j.status === 'escalated' && now - Number(j.updated_at) >= AGING_MS).length;
    const failed = jobs.filter((j) => j.status === 'failed').length;
    const failedLearnValidate = jobs.filter((j) => j.status === 'failed' && j.type === 'learn-validate').length;
    const awaiting = jobs.filter((j) => j.status === 'awaiting_signoff').length;
    return {
      hero: { esc7, escAging, failed, failedLearnValidate, awaiting },
      flow: flowToday(q, now),
      agents: agents.getSection(db, ctx),
      health: health.getSection(db, ctx),
    };
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;

    // The day's flow, by department. Read this line and you know whether the machine did anything,
    // which desks did it, and whether anything is moving this second — none of which the five
    // instantaneous columns below can tell you.
    function flowHtml(flow) {
      if (!flow) return '';
      const live = flow.live > 0
        ? `<b style="color:var(--green)">${S.fmtInt(flow.live)} moving right now</b>`
        : (flow.lastFinishedAt
          ? `<span class="muted">nothing running this second · last finished ${esc(S.agoLabel(Date.now() - flow.lastFinishedAt))}</span>`
          : '<span class="muted">nothing running this second</span>');
      const failedBit = flow.failed > 0
        ? ` · <b style="color:var(--amber)">${S.fmtInt(flow.failed)} failed</b>`
        : '';
      const cards = flow.depts.map((d) => {
        const quiet = d.finished === 0 && d.live === 0 && d.failed === 0;
        const sub = d.live > 0
          ? S.fmtInt(d.live) + ' moving now'
          : d.failed > 0
            ? S.fmtInt(d.failed) + ' failed'
            : d.lastAt ? 'last ' + S.agoLabel(Date.now() - Number(d.lastAt)) : 'quiet today';
        // Solid top bar in the department's colour — same signal as the cards below, so the
        // roll-call and the board read as one colour language rather than two.
        return `<div class="dept-card${quiet ? ' quiet' : ''}" style="border-color:${d.colour}40;border-top-color:${d.colour};background:${d.colour}0F">`
          + `<div class="dn" style="color:${d.colour}">${esc(d.label)}</div>`
          + `<div class="dv">${S.fmtInt(d.finished)}</div>`
          + `<div class="ds">${esc(sub)}</div></div>`;
      }).join('');
      return `<div class="sec-label" style="margin-top:18px">Today<span class="rule"></span></div>`
        + `<div style="font-size:13px;color:var(--text-2);margin:2px 0 2px">`
        + `<b>${S.fmtInt(flow.finished)}</b> job${flow.finished === 1 ? '' : 's'} finished since midnight${failedBit} · ${live}`
        + `</div><div class="dept-rollcall">${cards}</div>`;
    }

    const h = m.hero || { esc7: 0, escAging: 0, failed: 0, failedLearnValidate: 0, awaiting: 0 };
    const a = agents.render(m.agents || {}, ctx) || { stamp: '', body: '' };
    const hh = health.render(m.health || {}, ctx) || { stamp: '', body: '' };
    const failedSubcopy = h.failedLearnValidate > 0
      ? `failed jobs — incl. the ${S.fmtInt(h.failedLearnValidate)} dormant learn-validate — named, never hidden`
      : 'failed jobs — named, never hidden';
    const hero = `<div class="tiles" style="grid-template-columns:repeat(4,minmax(150px,1fr))">
      <div class="tile ${h.esc7 + h.awaiting > 0 ? 'red' : 'green'}"><div class="lab">Needs you now</div><div class="val">${S.fmtInt(h.esc7 + h.awaiting)}</div><div class="sub">${S.fmtInt(h.awaiting)} awaiting sign-off · ${S.fmtInt(h.esc7)} fresh give-up${h.esc7 === 1 ? '' : 's'} (≤7d)</div></div>
      <div class="tile ${h.escAging > 0 ? 'amber' : 'muted'}"><div class="lab">Aging give-ups</div><div class="val">${S.fmtInt(h.escAging)}</div><div class="sub">held over 7 days — in the board's collapsed group</div></div>
      <div class="tile ${h.failed > 0 ? 'amber' : 'muted'}"><div class="lab">Failed jobs · lifetime</div><div class="val">${S.fmtInt(h.failed)}</div><div class="sub">${failedSubcopy}</div></div>
      <div class="tile blue"><div class="lab">Board</div><div class="val" style="font-size:15px">fleet ↓ · plumbing ↓↓</div><div class="sub">blocked column reads OLDEST first</div></div>
    </div>`;
    return {
      stamp: a.stamp || hh.stamp,
      body: hero
        + flowHtml(m.flow)
        + `<div class="sec-label" style="margin-top:16px">The fleet<span class="rule"></span></div>` + a.body
        + `<div class="sec-label" style="margin-top:22px">The plumbing<span class="rule"></span></div>` + hh.body,
    };
  },
};
