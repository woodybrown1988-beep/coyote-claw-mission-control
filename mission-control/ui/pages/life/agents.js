'use strict';
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-agents', route: '/life/agents', workspace: 'life', title: 'Agent activity',
  sub: 'What worked on your behalf, with what authority — when anything does',

  getSection(_db, _ctx) { return {}; },

  render(_section, _ctx) {
    // AMENDMENT 2 (2026-08-05): honest not-connected state — NO fabricated activity. But the
    // handoff/authority map (placement ruling 2026-08-05) lives here: how work WILL be handed
    // off and where the gates sit, framed plainly as the design, not as live events.
    const stage = (name, sub) => `<div style="flex:1;min-width:120px;background:rgba(255,255,255,.04);border:1px solid var(--rline);border-radius:10px;padding:12px"><div style="font-weight:600;font-size:13px">${LIFE.esc(name)}</div><div style="font-size:11.5px;color:var(--rmuted);margin-top:3px;line-height:1.4">${LIFE.esc(sub)}</div></div>`;
    const pipeline = `<div style="display:flex;gap:8px;align-items:stretch;flex-wrap:wrap">
      ${stage('You capture', 'a task, a note, a question')}
      <div style="align-self:center;color:var(--rmuted)">→</div>
      ${stage('Frontdoor routes', 'reads intent, hands off the right way')}
      <div style="align-self:center;color:var(--rmuted)">→</div>
      ${stage('A specialist prepares', 'research or a draft — scoped, never the whole inbox')}
      <div style="align-self:center;color:var(--rmuted)">→</div>
      ${stage('The gate is you', 'send, spend, invite, deploy: always your yes')}
    </div>`;
    const empty = LIFE.emptyCard(
      'No agents are connected yet', 'Nothing acts on your behalf here',
      'Every change today is made by you — suggestions wait for your yes and nothing applies itself. When mail, calendar or specialist agents are connected (a separate decision), each handoff shown above appears here as an append-only line, with the authority it held.',
      '<a class="r-btn" href="/life/trust">See Trust & automation</a>',
    );
    const authority = S.rcc.panel({
      title: 'How work is handed off', sub: 'The path any task would take, and where it always stops for you',
      body: pipeline + `<div class="r-note" style="margin-top:12px">The right edge is a permanent boundary: an external message, spend, a credential change, a people or legal action, or an outside-attendee event never passes it without you — no matter how confident the step before it was.</div>`,
    });
    return { stamp: '', body: wrap(authority + empty) };
  },
};
