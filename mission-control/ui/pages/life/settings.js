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
      const setting = (k, dflt) => { const r = q('SELECT value FROM life_settings WHERE key = ?', [k]); return r.length ? String(r[0].value) : dflt; };
      return {
        paused: q(`SELECT capability_key FROM life_automation_capabilities WHERE emergency_paused = 1`),
        quiet: setting('quiet_support', 'on') === 'on', // DEFAULT-ON (operator ruling 2026-08-05)
      };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    if (s.absent) return { stamp: '', body: wrap(LIFE.absentCard('Settings')) };
    // BEHAVIOUR (A3): quiet-support toggle, default-on. A real control — when on, lower-stakes
    // suggestions fold on Today so only material calls interrupt; off, they sit inline.
    const quietOn = s.quiet !== false;
    const behaviour = S.rcc.panel({
      title: 'Behaviour', sub: 'How much the system interrupts you',
      body: `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0">
          <div><div style="font-weight:600;font-size:13.5px">Quiet support mode</div>
          <div style="font-size:12.5px;color:var(--rmuted);margin-top:3px;line-height:1.5">${quietOn
            ? 'On — only material calls (approvals, high-stakes suggestions, overdue follow-ups) interrupt you on Today. Lower-stakes suggestions fold quietly into All tasks.'
            : 'Off — every open suggestion sits inline on Today. Turn on for a calmer surface.'}</div></div>
          <div class="r-toggle ${quietOn ? 'on' : ''}" data-lc-quiet="${quietOn ? 'on' : 'off'}" role="switch" aria-checked="${quietOn}"><span class="sw"></span></div>
        </div>`,
    });
    // EXECUTION AND GATES (A3): how routing works + the permanent ceilings, informational.
    const gates = S.rcc.panel({
      title: 'Execution and gates', sub: 'Who does the work, and what always needs your yes',
      body: `<div style="font-size:13px;line-height:1.8">
        Every task carries an execution route you set on its own page — ${S.rcc.route('SELF')} you, ${S.rcc.route('AI')} AI drafts or does, ${S.rcc.route('DELEGATE')} someone else, ${S.rcc.route('HYBRID')} a mix.<br>
        Routing to AI or delegation never removes a gate: sending a message, moving money, changing a credential, a people or legal action, and anything with an outside attendee are <b>permanently</b> your call, whatever the route or the confidence.</div>`,
    });
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
    return { stamp: '', body: wrap(`<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">${behaviour}${gates}${charter}${privacy}${controls}</div>`) };
  },
};
