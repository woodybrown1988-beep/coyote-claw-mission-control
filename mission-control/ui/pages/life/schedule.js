'use strict';
// LIFE OS — SCHEDULE, populated to the VISUAL GOLDEN MASTER (pack v1.1.0,
// png/desktop_full/06_schedule.png) at the calendar go (operator GO 2026-08-10): the
// engine's sole writer mirrors Outlook into life-side calendar tables on a 20-minute
// delta poll, and this page READS that mirror through life-lib's read-only handle.
// Outlook stays canonical — this view mirrors it, never competes with it.
//
// HONESTY LAWS (ruled, and test-pinned):
//  - a staleness caption rides EVERY populated render — fresh names its age, stale says
//    stale; a failed poll is named while the last good picture stays visible;
//  - no mirror yet (or none the engine has filled) = the honest not-connected state;
//  - no free time is computed, implied or offered anywhere — gaps are just gaps.
// Write-side golden slots (Propose focus blocks / Approve block) are EXCLUDED: writing
// to the calendar is a later, separately-gated decision (the A3 discipline — golden
// structure, no invented function). "Sync now" IS wired: the refresh capability exists.
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');

const FRESH_WINDOW_MIN = 45; // the poll runs every 20 min; twice that + slack = stale

function londonDate(nowMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}
function eyebrowDate(nowMs) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(nowMs)).replace(',', ' ·').toUpperCase();
}
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;
const hm = (at) => String(at || '').slice(11, 16);

/** Age caption pieces — the one staleness voice for the whole page. */
function freshness(sync, nowMs) {
  const ageMin = Math.max(0, Math.round((nowMs - Date.parse(sync.last_sync_at)) / 60_000));
  const ageText = ageMin < 60 ? `${ageMin} min` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m`;
  const failed = !!sync.last_error;
  const stale = failed || ageMin > FRESH_WINDOW_MIN;
  const caption = stale
    ? `Stale — last good look at Outlook was ${ageText} ago${failed ? ' and the latest refresh failed' : ''}. Outlook itself is the truth right now.`
    : `Fresh — matched to Outlook ${ageText} ago.`;
  return { stale, caption, pill: stale ? S.rcc.tag(`Stale · ${ageText} ago`, 'warn') : S.rcc.tag(`Fresh · ${ageText} ago`, 'good') };
}

module.exports = {
  key: 'life-schedule', route: '/life/schedule', workspace: 'life', title: 'Schedule',
  sub: 'Your calendar stays canonical elsewhere — this view mirrors it, never competes with it',

  getSection(_db, ctx) {
    const now = (ctx && ctx.now) || Date.now();
    const o = LIFE.openLifeReadonly();
    if (!o.ok) return { engine: { ok: false, reason: o.reason }, now };
    try {
      // Missing table (engine not deployed yet) or no row (never attempted) both read as
      // "nothing is known" — the same honest not-connected state, never an error page.
      const syncQ = LIFE.lifeSelect(o.db, 'SELECT last_sync_at, last_error FROM life_calendar_sync WHERE id = 1');
      const sync = (syncQ.ok && syncQ.rows.length) ? syncQ.rows[0] : null;
      if (!sync || !sync.last_sync_at) return { engine: { ok: true }, now, connected: false, attempted: !!(sync && sync.last_error) };
      const today = londonDate(now);
      const evQ = LIFE.lifeSelect(o.db,
        'SELECT id, subject, start_at, end_at, is_all_day, location, show_as, is_protected FROM life_calendar_events WHERE start_at LIKE ? ORDER BY start_at',
        [`${today}%`]);
      return { engine: { ok: true }, now, connected: true, sync, today, events: evQ.ok ? evQ.rows : [] };
    } finally { o.db.close(); }
  },

  render(section, _ctx) {
    const s = section || {};
    const now = s.now || Date.now();
    const wrap = (inner) => `<style>${S.rcc.css()}${S.rcc.lifeCss()}</style><div class="rcc">${inner}</div>`;

    if (!s.connected) {
      // Nothing is known (no life.db, no mirror table, or the first look at Outlook has
      // not completed) — so nothing is shown, and no free time is guessed at.
      const firstLookLine = s.attempted
        ? `<div class="r-note" style="margin-top:12px">A connection exists but the first look at Outlook hasn't completed yet — until it does, nothing here pretends to know your day.</div>`
        : `<div class="r-note" style="margin-top:12px">Connecting a calendar is a separate decision you make later — nothing here nags for it.</div>`;
      const body = wrap(
        LIFE.emptyCard(
          'Outlook is not connected', 'Nothing is shown because nothing is known',
          'When a calendar is connected, this page shows your fixed commitments, protected focus blocks, and proposed blocks awaiting your approval — read from the calendar, never invented. Until then, no free time is guessed at and no schedule is simulated.',
          '<a class="r-btn" href="/life/today">Back to Today</a>',
        ) + firstLookLine,
      );
      return { stamp: '', body };
    }

    const f = freshness(s.sync, now);
    const events = s.events || [];
    const allDay = events.filter((e) => e.is_all_day);
    const timed = events.filter((e) => !e.is_all_day);
    const commitments = timed.filter((e) => e.show_as !== 'free');
    const protectedBlocks = timed.filter((e) => e.is_protected);

    const head = `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:14px;flex-wrap:wrap">`
      + `<div><div class="r-eyebrow">OUTLOOK IS CANONICAL · ${LIFE.esc(eyebrowDate(now))}</div>`
      + `<div style="font-size:13.5px;color:var(--rmuted)">Read from your calendar, never invented — and nothing is written back.</div></div>`
      + `<div style="display:flex;gap:8px;align-items:center">${f.pill}${cmd('Sync now', 'calendar_sync', {}, '')}</div></div>`;

    // The banner carries the page's one staleness caption in full sentence form.
    const banner = `<div class="r-card r-panel" style="margin-bottom:12px;${f.stale ? 'border-color:rgba(255,179,77,.45)' : ''}">`
      + `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">`
      + `<div><b>Outlook is canonical.</b> <span style="color:var(--rmuted)">Committed appointments are read from Outlook and mirrored here. Proposing new blocks is a later decision — nothing is ever shown as booked that isn't in Outlook.</span></div>`
      + `<div style="flex-shrink:0;font-size:12.5px;color:${f.stale ? '#f5c96b' : 'var(--rmuted)'}">${LIFE.esc(f.caption)}</div></div></div>`;

    const tiles = `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:12px">`
      + S.rcc.kpi({ label: 'Canonical source', value: 'Outlook', sub: 'your real calendar' })
      + S.rcc.kpi({ label: 'This view', value: f.stale ? 'Stale' : 'Fresh', sub: f.stale ? 'Outlook is the truth right now' : 'matched to Outlook' })
      + S.rcc.kpi({ label: "Today's commitments", value: String(commitments.length), sub: allDay.length ? `+ ${allDay.length} all-day` : 'timed events' })
      + S.rcc.kpi({ label: 'Uncommitted proposals', value: '0', sub: 'never shown as booked time' })
      + `</div>`;

    const evRow = (e) => `<div class="r-lrow"><div style="min-width:0"><div style="font-weight:600">`
      + `<span style="font-family:var(--font-mono,monospace);color:#f0a276;font-size:12.5px;margin-right:10px">${LIFE.esc(hm(e.start_at))}–${LIFE.esc(hm(e.end_at))}</span>${LIFE.esc(e.subject || 'Busy')}</div>`
      + `<div style="font-size:12px;color:var(--rmuted);margin-top:3px">${LIFE.esc(e.location || '')}${e.location && e.show_as !== 'busy' ? ' · ' : ''}${e.show_as !== 'busy' ? LIFE.esc(String(e.show_as)) : ''}</div></div>`
      + `<div style="flex-shrink:0">${e.is_protected ? S.rcc.tag('Focus candidate', 'good') : ''}</div></div>`;
    const todayPanel = S.rcc.panel({
      title: 'Today from Outlook', sub: 'Your fixed commitments in one chronological view',
      headRight: commitments.length ? `<span class="r-pill">${commitments.length}</span>` : '',
      body: (allDay.length ? `<div class="r-note">All day: ${allDay.map((e) => LIFE.esc(e.subject || 'Busy')).join(' · ')}</div>` : '')
        + (timed.length
          ? timed.map(evRow).join('')
          : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Nothing is in the calendar today. An empty day here means Outlook shows no fixed commitments — no free time is guessed at around that.</div>`),
    });

    const focusPanel = S.rcc.panel({
      title: 'Protected focus blocks', sub: 'Candidates for deep work — marked in Outlook, honoured here',
      body: protectedBlocks.length
        ? protectedBlocks.map((e) => `<div class="r-lrow"><div><div style="font-weight:600">${LIFE.esc(e.subject || 'Protected block')}</div><div style="font-size:12px;color:var(--rmuted);margin-top:2px">${LIFE.esc(hm(e.start_at))}–${LIFE.esc(hm(e.end_at))} · held for focused work</div></div>${S.rcc.tag('Protected', 'good')}</div>`).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">None today. Give an Outlook event a “Protected” or “Focus” category and it shows here as a focus candidate.</div>`,
    });

    const proposalsPanel = S.rcc.panel({
      title: 'Proposed next block', sub: 'Nothing is written to your calendar from here',
      body: `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">No proposed blocks. Proposing focus time into your calendar is a separate decision you haven't taken yet — until then this stays honestly empty.</div>`,
    });

    const authorityPanel = S.rcc.panel({
      title: 'Calendar authority', sub: 'The standing rules this page lives by',
      body: [
        ['Read, never written', 'This page mirrors Outlook. Nothing here writes to your calendar.'],
        ['Stale means stale', 'If the refresh breaks, this page says so and shows when it last matched Outlook — stale is never dressed as fresh.'],
        ['No invented free time', 'Gaps between events are never offered back as bookable time.'],
      ].map(([t, d]) => `<div class="r-lrow"><div><div style="font-weight:600">${LIFE.esc(t)}</div><div style="font-size:12px;color:var(--rmuted);margin-top:2px">${LIFE.esc(d)}</div></div></div>`).join(''),
    });

    const body = wrap(head + banner + tiles
      + `<div class="ls-main">`
      + `<div style="display:grid;gap:12px;align-content:start">${todayPanel}</div>`
      + `<div style="display:grid;gap:12px;align-content:start">${focusPanel}${proposalsPanel}${authorityPanel}</div>`
      + `</div>`
      + `<style>.ls-main{display:grid;gap:12px;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}@media(max-width:1000px){.ls-main{grid-template-columns:1fr}}</style>`);
    return { stamp: '', body };
  },
};
