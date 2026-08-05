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
    // OPERATOR AMENDMENT 2 (2026-08-05): honest not-connected state ONLY.
    const body = wrap(
      LIFE.emptyCard(
        'No agents are connected to Life OS', 'Nothing acts on your behalf here yet',
        'Today, every change is made by you: suggestions wait for your yes, and nothing applies itself. When mail, calendar or specialist agents are connected — a separate decision — this page becomes their append-only activity ledger with authority limits in plain sight.',
        '<a class="r-btn" href="/life/trust">See Trust & automation</a>',
      ),
    );
    return { stamp: '', body };
  },
};
