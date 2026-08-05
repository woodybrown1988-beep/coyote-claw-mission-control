'use strict';
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-schedule', route: '/life/schedule', workspace: 'life', title: 'Schedule',
  sub: 'Your calendar stays canonical elsewhere — this view mirrors it, never competes with it',

  getSection(_db, _ctx) { return {}; },

  render(_section, _ctx) {
    // OPERATOR AMENDMENT 2 (2026-08-05): the honest not-connected state ONLY. The populated
    // view is gated at the separate calendar go/no-go; no free time is invented here.
    const body = wrap(
      LIFE.emptyCard(
        'Outlook is not connected', 'Nothing is shown because nothing is known',
        'When a calendar is connected, this page shows your fixed commitments, protected focus blocks, and proposed blocks awaiting your approval — read from the calendar, never invented. Until then, no free time is guessed at and no schedule is simulated.',
        '<a class="r-btn" href="/life/today">Back to Today</a>',
      )
      + `<div class="r-note" style="margin-top:12px">Connecting a calendar is a separate decision you make later — nothing here nags for it.</div>`,
    );
    return { stamp: '', body };
  },
};
