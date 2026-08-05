'use strict';
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');
const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;
const link = (id, title) => `<a href="/life/task?id=${encodeURIComponent(id)}" style="color:inherit">${LIFE.esc(title)}</a>`;
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;

module.exports = {
  key: 'life-settings', route: '/life/settings', workspace: 'life', title: 'Settings',
  sub: 'Low-admin by design — the important controls live where the work is',

  getSection(_db, _ctx) {
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { absent: true };
    try {
      const q = (sql, args) => { const r = LIFE.lifeSelect(o.db, sql, args); return r.ok ? r.rows : []; };
      return { paused: q(`SELECT capability_key FROM life_automation_capabilities WHERE emergency_paused = 1`) };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    const charter = S.rcc.panel({
      title: 'The standing design charter', sub: 'What this system promises you, permanently',
      body: `<div style="font-size:13px;line-height:1.8">
        · Nothing acts on your behalf without your yes — suggestions wait, always.<br>
        · Your words are kept exactly as written; interpretations live separately and are yours to reject.<br>
        · Personal content stays in your private space — it never appears on business pages and never leaves this machine.<br>
        · Waiting work always has a wake path; nothing rots silently.<br>
        · Finished means evidenced; reopening is always yours and always on the record.<br>
        · Empty states tell the truth and offer an action — never a fake number.</div>`,
    });
    const privacy = S.rcc.panel({
      title: 'Privacy', sub: 'Where your data lives and who can see it',
      body: `<div style="font-size:13px;line-height:1.8">
        Everything you capture is private to you by default. Business questions asked elsewhere in Mission Control cannot see it.
        Your data stays on this machine; an encrypted backup is taken nightly and never leaves the premises.</div>`,
    });
    const controls = S.rcc.panel({
      title: 'Controls', sub: 'The few that exist, honestly placed',
      body: `<div style="font-size:13px;line-height:1.8">
        · <b>Pause any automation</b> — per capability, on <a href="/life/trust">Trust &amp; automation</a>${s.paused && s.paused.length ? ` (currently paused: ${s.paused.map((p) => LIFE.esc(p.capability_key)).join(', ')})` : ''}.<br>
        · <b>Capture</b> — Ctrl/Cmd+K anywhere, or the ＋ button.<br>
        · <b>Cancel / reopen / undo</b> — on each task's own page, always audited.<br>
        · Calendar and mail connections are separate future decisions; nothing here asks for them.</div>`,
    });
    return { stamp: '', body: wrap(`<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">${charter}${privacy}${controls}</div>`) };
  },
};
