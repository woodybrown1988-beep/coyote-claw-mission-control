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
//
// WEEK VIEW (operator ask 2026-08-11) rides ?view=week&start=YYYY-MM-DD — the day view is
// still what the page opens on, so nothing that was true of this page yesterday changed.
// Three rules the week inherits and does NOT get to soften:
//  - the SAME staleness caption, from the same shared helper — a week of days is not seven
//    chances to imply the picture is fresher than it is;
//  - NO GRID. A time grid draws every gap as a tidy white rectangle, which is offering free
//    time back with a straight face. Days are lists; a gap is just an absence;
//  - a day beyond the synced window is NAMED as beyond it, never drawn as an empty day.
const LIFE = require('./life-lib.js');
const S = require('../../shared.js');

const FRESH_WINDOW_MIN = LIFE.FRESH_WINDOW_MIN;

// How far either side of today the mirror can be trusted. The engine syncs 28 days back and
// 84 forward, but Graph pins that window when the delta link is created and it is only
// re-anchored weekly — so the GUARANTEED forward horizon is 84 − 7. Navigation stops at the
// guarantee, not the optimistic figure.
const WINDOW_BACK_DAYS = 28;
const WINDOW_FWD_DAYS = 77;
const WEEK_LEN = 7;

function londonDate(nowMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}
function eyebrowDate(nowMs) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(nowMs)).replace(',', ' ·').toUpperCase();
}
const cmd = (label, command, payload, cls) => `<button class="r-btn ${cls || ''}" data-lc-cmd="${LIFE.esc(JSON.stringify({ command, payload: payload || {} }))}">${LIFE.esc(label)}</button>`;
const hm = (at) => String(at || '').slice(11, 16);
/** Trim to a length, and SAY it was trimmed. A silent cut lands mid-sentence and reads as a
 *  finished thought — a swap proposal lost its second priority that way, leaving a number
 *  that looked deliberate and was wrong. */
const clamp = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** Age caption pieces — the one staleness voice for the whole page, and now for the week
 *  too. The sentence itself lives in life-lib so the two views cannot drift apart. */
function freshness(sync, nowMs) {
  const f = LIFE.freshness(sync, nowMs);
  return { ...f, pill: f.stale ? S.rcc.tag(`Stale · ${f.ageText} ago`, 'warn') : S.rcc.tag(`Fresh · ${f.ageText} ago`, 'good') };
}

/** Day arithmetic on London calendar dates, done as plain date strings. Calendar rows store
 *  London-local `YYYY-MM-DDTHH:MM:SS` text, so every comparison here is lexicographic —
 *  parsing into UTC and back is how a 23:00 event lands on the wrong day. */
function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Which DAY a pending calendar question is about, so it can be shown beside the day it
 *  would change rather than in one undifferentiated pile. A placement carries its own date;
 *  a move or a swap carries the time it is moving TO; a plain removal names only a block, so
 *  the day comes from the block itself. Unknown stays null and renders in the general list —
 *  never guessed onto a day. */
function proposalDay(db, p) {
  let c = {};
  try { c = JSON.parse(String(p.command_json || '{}')); } catch (_) { return null; }
  if (typeof c.planDate === 'string' && c.planDate) return c.planDate;
  if (typeof c.startAt === 'string' && c.startAt.length >= 10) return c.startAt.slice(0, 10);
  const blockId = c.blockId || c.fromBlockId;
  if (typeof blockId === 'string' && blockId) {
    const r = LIFE.lifeSelect(db, 'SELECT start_at FROM life_calendar_blocks WHERE id = ?', [blockId]);
    if (r.ok && r.rows.length) return String(r.rows[0].start_at).slice(0, 10);
  }
  return null;
}

/** Which 7 days the week view shows. Defaults to a ROLLING week — today plus six — rather
 *  than snapping to a Monday: the question this page answers is "what is coming", and a
 *  Monday-snapped week answers it with two days of history on a Wednesday. */
function resolveWeek(query, today) {
  const raw = String((query && query.start) || '');
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  const min = addDays(today, -WINDOW_BACK_DAYS);
  const max = addDays(today, WINDOW_FWD_DAYS - (WEEK_LEN - 1));
  const start = asked < min ? min : asked > max ? max : asked;
  return {
    start, end: addDays(start, WEEK_LEN - 1), clamped: start !== asked, clampedBack: asked < min,
    prev: start > min ? addDays(start, -WEEK_LEN) : null,
    next: start < max ? addDays(start, WEEK_LEN) : null,
  };
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
      const week = resolveWeek(ctx && ctx.query, today);
      const view = String(((ctx && ctx.query) || {}).view || '') === 'week' ? 'week' : 'day';
      const evQ = LIFE.lifeSelect(o.db,
        'SELECT id, subject, start_at, end_at, is_all_day, location, show_as, is_protected, calendar_key FROM life_calendar_events WHERE start_at LIKE ? ORDER BY start_at',
        [`${today}%`]);
      // Legacy mirror (pre-Stage-W column) degrades to no calendar_key — everything default.
      const evQ2 = evQ.ok ? evQ : LIFE.lifeSelect(o.db,
        'SELECT id, subject, start_at, end_at, is_all_day, location, show_as, is_protected FROM life_calendar_events WHERE start_at LIKE ? ORDER BY start_at',
        [`${today}%`]);
      // Open block proposals (Stage W): the golden's "Proposed next block" made real —
      // accept places the block via its own HUMAN-gated verb; reject touches nothing.
      // Every state-changing calendar verb is here, not just placement: a replan's move,
      // swap or removal is the same kind of question and waits the same way (2026-08-11).
      const propQ = LIFE.lifeSelect(o.db,
        `SELECT id, command_type, command_json, reason, confidence, created_at FROM life_update_proposals
          WHERE state = 'PROPOSED' AND capability_key = 'calendar_block' ORDER BY created_at LIMIT 40`);
      const propCountQ = LIFE.lifeSelect(o.db,
        `SELECT COUNT(*) c FROM life_update_proposals WHERE state = 'PROPOSED' AND capability_key = 'calendar_block'`);
      const proposals = (propQ.ok ? propQ.rows : []).map((p) => ({ ...p, targetDay: proposalDay(o.db, p) }));
      // London wall-clock now, the writer's own comparison basis — so a card whose slot has
      // passed can say so INSTEAD of offering a Place tap that can only be refused (live
      // failure 2026-08-18: 15–17 Aug cards still carried Place buttons on the 18th).
      const localNow = `${today}T${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(now))}`;
      // Open work for the owner's own "Place a block" form AND the recommendations list
      // (operator asks 2026-08-18). Same availability view the planner drafts from, with
      // the two planner exclusions: work already holding a future block, and work already
      // carrying an open placement question, are not re-recommended.
      const tasksQ = LIFE.lifeSelect(o.db,
        `SELECT w.id, w.title, w.due_kind, w.due_at, w.recurs, w.calculated_priority,
                EXISTS (SELECT 1 FROM life_calendar_blocks b
                         WHERE b.task_id = w.id AND b.state IN ('PLACED','MOVED') AND b.end_at > ?) AS has_block,
                EXISTS (SELECT 1 FROM life_update_proposals pr
                         WHERE pr.task_id = w.id AND pr.state = 'PROPOSED'
                           AND pr.capability_key = 'calendar_block' AND pr.command_type = 'place_block') AS has_proposal
           FROM v_life_available_work w
          ORDER BY w.calculated_priority DESC, w.created_at ASC LIMIT 60`,
        [localNow]);
      // Today's standing blocks, so the day view can offer Move on what already stands.
      // task_status rides along so a PASSED block whose task is still open can say the
      // truth: the slot lapsed and the task is back in the suggestions (operator ask
      // 2026-08-18 — the exclusion above only ever counted FUTURE blocks, so the return
      // is automatic; this is the visibility half).
      const dbQ = LIFE.lifeSelect(o.db,
        `SELECT b.id, b.task_id, b.title, b.start_at, b.end_at, b.state, t.status AS task_status
           FROM life_calendar_blocks b LEFT JOIN life_tasks t ON t.id = b.task_id
          WHERE b.state IN ('PLACED','MOVED') AND b.start_at LIKE ? ORDER BY b.start_at`, [`${today}%`]);
      const base = {
        engine: { ok: true }, now, connected: true, sync, today, view, week, localNow,
        events: evQ2.ok ? evQ2.rows : [],
        blockProposals: proposals,
        proposalTotal: propCountQ.ok ? propCountQ.rows[0].c : proposals.length,
        openTasks: tasksQ.ok ? tasksQ.rows : [],
        dayBlocks: dbQ.ok ? dbQ.rows : [],
      };
      if (view !== 'week') return base;

      // WEEK READ. One range query, not seven day-queries: an event that STARTS the day
      // before and runs into the window is invisible to a `start_at LIKE 'day%'` filter, and
      // a week is exactly where that shows up. Overlap, not prefix — then bucket each event
      // into every day it actually covers.
      const from = `${week.start}T00:00:00`;
      const to = `${addDays(week.end, 1)}T00:00:00`;
      const wQ = LIFE.lifeSelect(o.db,
        `SELECT id, subject, start_at, end_at, is_all_day, location, show_as, is_protected, calendar_key
           FROM life_calendar_events WHERE end_at > ? AND start_at < ? ORDER BY start_at`, [from, to]);
      const wQ2 = wQ.ok ? wQ : LIFE.lifeSelect(o.db,
        `SELECT id, subject, start_at, end_at, is_all_day, location, show_as, is_protected
           FROM life_calendar_events WHERE end_at > ? AND start_at < ? ORDER BY start_at`, [from, to]);
      // Blocks Life OS placed, read from its OWN registry so a block still shows as ours
      // even on a legacy mirror with no calendar_key. Removed ones are gone, not greyed.
      const bQ = LIFE.lifeSelect(o.db,
        `SELECT b.id, b.task_id, b.title, b.start_at, b.end_at, b.state, b.graph_event_id, t.status AS task_status
           FROM life_calendar_blocks b LEFT JOIN life_tasks t ON t.id = b.task_id
          WHERE b.state IN ('PLACED','MOVED') AND b.end_at > ? AND b.start_at < ? ORDER BY b.start_at`, [from, to]);
      return { ...base, weekEvents: wQ2.ok ? wQ2.rows : [], weekBlocks: bQ.ok ? bQ.rows : [] };
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

    const isWeek = s.view === 'week';
    const w = s.week || {};
    const toggle = `<div style="display:flex;gap:6px">`
      + `<a class="r-btn small${isWeek ? '' : ' primary'}" href="/life/schedule">Day</a>`
      + `<a class="r-btn small${isWeek ? ' primary' : ''}" href="/life/schedule?view=week">Week</a></div>`;

    const head = `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:14px;flex-wrap:wrap">`
      + `<div><div class="r-eyebrow">OUTLOOK IS CANONICAL · ${LIFE.esc(eyebrowDate(now))}</div>`
      + `<div style="font-size:13.5px;color:var(--rmuted)">Read from your calendar, never invented — nothing is written without your approval, and only ever into the Life OS calendar.</div></div>`
      + `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${toggle}${f.pill}${cmd('Sync now', 'calendar_sync', {}, '')}</div></div>`;

    const proposals = s.blockProposals || [];

    // The banner carries the page's one staleness caption in full sentence form.
    const banner = `<div class="r-card r-panel" style="margin-bottom:12px;${f.stale ? 'border-color:rgba(255,179,77,.45)' : ''}">`
      + `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">`
      + `<div><b>One calendar, two states.</b> <span style="color:var(--rmuted)">Committed appointments are read from Outlook. Proposed blocks stay proposals until you approve one — only then is it written, into the dedicated Life OS calendar and nowhere else.</span></div>`
      + `<div style="flex-shrink:0;font-size:12.5px;color:${f.stale ? '#f5c96b' : 'var(--rmuted)'}">${LIFE.esc(f.caption)}</div></div></div>`;

    const tiles = `<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:12px">`
      + S.rcc.kpi({ label: 'Canonical source', value: 'Outlook', sub: 'your real calendar' })
      + S.rcc.kpi({ label: 'This view', value: f.stale ? 'Stale' : 'Fresh', sub: f.stale ? 'Outlook is the truth right now' : 'matched to Outlook' })
      + S.rcc.kpi(isWeek
        // In week view the tile would be computed from a prefix match while the day cards
        // below use overlap — so an event running in from last night made the two numbers
        // disagree on one screen. The week states its own span instead.
        ? { label: 'This week', value: `${w.start.slice(8, 10)}–${w.end.slice(8, 10)} ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', month: 'short' }).format(new Date(`${w.end}T12:00:00Z`))}`, sub: 'seven days from today' }
        : { label: "Today's commitments", value: String(commitments.length), sub: allDay.length ? `+ ${allDay.length} all-day` : 'timed events' })
      + S.rcc.kpi({ label: 'Uncommitted proposals', value: String(s.proposalTotal ?? proposals.length), sub: 'never shown as booked time' })
      + `</div>`;

    const evRow = (e) => `<div class="r-lrow"><div style="min-width:0"><div style="font-weight:600">`
      + `<span style="font-family:var(--font-mono,monospace);color:#f0a276;font-size:12.5px;margin-right:10px">${LIFE.esc(hm(e.start_at))}–${LIFE.esc(hm(e.end_at))}</span>${LIFE.esc(e.subject || 'Busy')}</div>`
      + `<div style="font-size:12px;color:var(--rmuted);margin-top:3px">${LIFE.esc(e.location || '')}${e.location && e.show_as !== 'busy' ? ' · ' : ''}${e.show_as !== 'busy' ? LIFE.esc(String(e.show_as)) : ''}</div></div>`
      + `<div style="flex-shrink:0;display:flex;gap:6px">${e.calendar_key === 'life' ? S.rcc.tag('Life OS', 'info') : ''}${e.is_protected ? S.rcc.tag('Focus candidate', 'good') : ''}</div></div>`;
    const todayPanel = S.rcc.panel({
      title: 'Today from Outlook', sub: 'Your fixed commitments in one chronological view',
      headRight: commitments.length ? `<span class="r-pill">${commitments.length}</span>` : '',
      body: (allDay.length ? `<div class="r-note">All day: ${allDay.map((e) => LIFE.esc(e.subject || 'Busy')).join(' · ')}</div>` : '')
        + (timed.length
          ? timed.map(evRow).join('')
          : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Nothing is in the calendar today. An empty day here means Outlook shows no fixed commitments — no free time is guessed at around that.</div>`),
    });

    // The day view's standing Life OS blocks, each with its Move affordance — the same
    // mover the week's drag-and-drop uses, so both views change a block the same one way.
    const myBlocksPanel = (s.dayBlocks || []).length ? S.rcc.panel({
      title: 'Life OS blocks today', sub: 'Placed by your approval — movable while they are still ahead',
      body: (s.dayBlocks || []).map((b) => {
        const bj = LIFE.esc(JSON.stringify({ blockId: b.id, title: b.title || 'Focus block', startAt: b.start_at, endAt: b.end_at }));
        const movable = String(b.end_at) > s.localNow;
        const lapsed = !movable && b.task_id && b.task_status && b.task_status !== 'DONE' && b.task_status !== 'CANCELLED';
        const label = b.task_id
          ? `<a href="/life/task?id=${encodeURIComponent(String(b.task_id))}" style="color:inherit">${LIFE.esc(b.title || 'Focus block')}</a>`
          : LIFE.esc(b.title || 'Focus block');
        return `<div class="r-lrow"${movable ? ` draggable="true" data-lc-block="${bj}" style="cursor:grab"` : ''}><div style="min-width:0"><div style="font-weight:600">`
          + `<span style="font-family:var(--font-mono,monospace);color:#8ab4f8;font-size:12.5px;margin-right:10px">${LIFE.esc(hm(b.start_at))}–${LIFE.esc(hm(b.end_at))}</span>${label}</div></div>`
          + `<div style="flex-shrink:0;display:flex;gap:6px">${movable ? `<button class="r-btn small" data-lc-blockmove="${bj}">Move</button>` : lapsed ? S.rcc.tag('not done — re-suggested', 'warn') : S.rcc.tag('Passed', 'warn')}</div></div>`;
      }).join(''),
    }) : '';

    const focusPanel = S.rcc.panel({
      title: 'Protected focus blocks', sub: 'Candidates for deep work — marked in Outlook, honoured here',
      body: protectedBlocks.length
        ? protectedBlocks.map((e) => `<div class="r-lrow"><div><div style="font-weight:600">${LIFE.esc(e.subject || 'Protected block')}</div><div style="font-size:12px;color:var(--rmuted);margin-top:2px">${LIFE.esc(hm(e.start_at))}–${LIFE.esc(hm(e.end_at))} · held for focused work</div></div>${S.rcc.tag('Protected', 'good')}</div>`).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">None today. Give an Outlook event a “Protected” or “Focus” category and it shows here as a focus candidate.</div>`,
    });

    // Proposed blocks (Stage W): the golden's "Proposed next block" made REAL. Accept rides
    // the block's own HUMAN-gated verb (the writer places/removes the actual Outlook event
    // in the Life OS calendar only); No is a plain reject and touches nothing in Outlook.
    // Each verb says what it would DO, in the owner's words. A "Place block" button on a
    // proposal to REMOVE one, or a bare "Accept", is the kind of ambiguity that gets a tap it
    // did not deserve — every button here names its own consequence.
    const VERB = {
      place_block: { action: 'Place block', fallbackTitle: 'Focus block' },
      remove_block: { action: 'Remove block', fallbackTitle: 'Remove a standing block' },
      move_block: { action: 'Move block', fallbackTitle: 'Move a block' },
      swap_block: { action: 'Swap the slot', fallbackTitle: 'Give the slot to better work' },
    };
    const propCard = (p) => {
      let c = {}; try { c = JSON.parse(String(p.command_json || '{}')); } catch (_) { /* renders generic */ }
      const v = VERB[p.command_type] || { action: 'Apply', fallbackTitle: 'Calendar change' };
      const span = String(c.startAt || '').length >= 16
        ? `${String(c.startAt).slice(11, 16)}–${String(c.endAt || '').slice(11, 16)}`
        : '';
      const when = p.targetDay ? `${p.targetDay}${span ? ` · ${span}` : ''}` : 'a block already standing';
      // A slot that has already passed gets the TRUTH, not a Place button that can only be
      // refused (live failure 2026-08-18). The writer's sweep retires these within a minute;
      // this guard covers the render in between — and carries the owner's real choices:
      // the work happened (mark it done), or let the planner offer a fresh time.
      const slotPassed = String(c.endAt || '') !== '' && String(c.endAt) <= s.localNow;
      const actions = slotPassed
        ? `${(p.command_type === 'place_block' && typeof c.taskId === 'string' && c.taskId)
          ? cmd('I did this — mark done', 'complete', { taskId: c.taskId }, 'small primary') : ''}`
          + cmd('Dismiss', 'decide', { proposalId: p.id, decision: 'reject' }, 'small')
        : cmd(v.action, p.command_type, { proposalId: p.id }, 'small primary')
          + cmd('No', 'decide', { proposalId: p.id, decision: 'reject' }, 'small');
      return `<div style="border:1px solid rgba(255,179,77,.4);background:rgba(255,179,77,.06);border-radius:10px;padding:12px;margin:8px 0${slotPassed ? ';opacity:.85' : ''}">
        <div style="font-size:11px;color:#f5c96b;font-weight:700">${LIFE.esc(when)}</div>
        <div style="font-weight:650;margin:4px 0">${LIFE.esc(String(c.title || v.fallbackTitle))}</div>
        <div style="font-size:12px;color:var(--rmuted);margin-bottom:8px">${LIFE.esc(clamp(String(p.reason), 400))} ${S.rcc.conf(p.confidence)}</div>
        ${slotPassed ? `<div style="font-size:12px;color:#f5c96b;margin-bottom:8px">This slot passed before it was decided — it retires itself shortly and a fresh time gets offered at the next plan run.</div>` : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end">${actions}</div></div>`;
    };

    // The owner's own block (operator ask 2026-08-18): pick a task — or name the time
    // yourself — and it is written through the same HUMAN-gated writer, Life OS calendar
    // only. The writer refuses the past and re-validates every field.
    // Times are ONE 15-minute dropdown each (operator ask, same day): a native time input
    // makes the owner dial hours and minutes separately; the day runs 06:00–22:00 (the
    // planner's own bounds), which is 64 quarter-hours — one flat list.
    const quarterHours = (fromMin, toMin) => {
      const out = [];
      for (let m = fromMin; m <= toMin; m += 15) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      return out;
    };
    const timeSelect = (name, label, fromMin, toMin) =>
      `<select name="${name}" class="r-input" style="width:110px"><option value="">${label}</option>`
      + quarterHours(fromMin, toMin).map((t) => `<option value="${t}">${t}</option>`).join('') + `</select>`;
    const proposeForm = () => {
      const opts = (s.openTasks || []).map((t) => `<option value="${LIFE.esc(t.id)}">${LIFE.esc(clamp(String(t.title || ''), 70))}</option>`).join('');
      return S.rcc.panel({
        title: 'Place your own block', sub: 'Your pick, your time — written only into the Life OS calendar',
        body: `<form data-kind="blockform" onsubmit="return false" style="display:grid;gap:8px">
          <select name="bf-task" class="r-input"><option value="">— pick a task (or title it below) —</option>${opts}</select>
          <input name="bf-title" class="r-input" type="text" maxlength="200" placeholder="Or a title of its own (optional when a task is picked)">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input name="bf-date" class="r-input" type="date" value="${LIFE.esc(s.today)}" style="flex:1;min-width:130px">
            ${timeSelect('bf-start', 'Start', 6 * 60, 21 * 60 + 45)}
            ${timeSelect('bf-end', 'End', 6 * 60 + 15, 22 * 60)}
          </div>
          <div style="display:flex;justify-content:flex-end"><button type="button" class="r-btn small primary" data-lc-blockplace>Place block</button></div>
        </form>`,
      });
    };

    // WORTH SCHEDULING NEXT (operator ask 2026-08-18: "we are getting the recommendations
    // which are right — ordered in importance and then also by any approaching deadlines").
    // The list is the planner's OWN candidate pool (v_life_available_work minus work that
    // already holds a future block or an open placement question), presented rather than
    // silently waiting for the 09:20/15:20 compile. Ordering: anything due inside 14 days
    // first, soonest first (hard before soft on the same day); then everything else by
    // calculated priority. Schedule prefills the form — nothing is written by this list.
    const recommendPanel = () => {
      const horizon = addDays(s.today, 14);
      const cands = (s.openTasks || []).filter((t) => !t.has_block && !t.has_proposal);
      const dueSoon = (t) => t.due_at && String(t.due_at).slice(0, 10) <= horizon;
      const ranked = [
        ...cands.filter(dueSoon).sort((a, b) => {
          const da = String(a.due_at).slice(0, 10); const db = String(b.due_at).slice(0, 10);
          if (da !== db) return da < db ? -1 : 1;
          if ((a.due_kind === 'HARD') !== (b.due_kind === 'HARD')) return a.due_kind === 'HARD' ? -1 : 1;
          return (b.calculated_priority || 0) - (a.calculated_priority || 0);
        }),
        ...cands.filter((t) => !dueSoon(t)),
      ].slice(0, 6);
      const dueChip = (t) => {
        if (!t.due_at) return '';
        const d = String(t.due_at).slice(0, 10);
        const label = `due ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${d}T12:00:00Z`))}${t.due_kind === 'HARD' ? ' · hard' : ''}`;
        const tone = d < s.today ? 'bad' : d <= addDays(s.today, 3) ? 'bad' : d <= addDays(s.today, 7) ? 'warn' : 'info';
        return S.rcc.tag(d < s.today ? `overdue${t.due_kind === 'HARD' ? ' · hard' : ''}` : label, tone);
      };
      // Every row is ACTIONABLE in place (operator ask 2026-08-18: "we cant go into the
      // tasks to update or say its already completed"): the title opens the task page;
      // Done rides the SAME completion flow as the task page — a recurring obligation
      // offers its next date prefilled from its own cadence (live failure 2026-08-18: a
      // bare complete on "Top up HSBC and Pleo" could only be refused); Later asks when to
      // suggest again and parks the task on a DATE wake (the writer's tick brings it back).
      const rows = ranked.map((t) => `<div class="r-lrow"><div style="min-width:0;flex:1">`
        + `<div style="font-weight:600;overflow-wrap:anywhere"><a href="/life/task?id=${encodeURIComponent(String(t.id))}" style="color:inherit">${LIFE.esc(clamp(String(t.title || ''), 90))}</a>`
        + `${t.recurs ? ` ${S.rcc.tag(`repeats · ${LIFE.esc(String(t.recurs).toLowerCase())}`, 'info')}` : ''}</div></div>`
        + `<div style="flex-shrink:0;display:flex;gap:6px;align-items:center">${dueChip(t)}`
        + `<button class="r-btn small" data-lc-complete="${LIFE.esc(String(t.id))}"${t.recurs ? ` data-lc-recap="${LIFE.esc(JSON.stringify({ cadence: t.recurs, due: String(t.due_at || '').slice(0, 10) }))}"` : ''}>Done</button>`
        + `<button class="r-btn small" data-lc-recsnooze="${LIFE.esc(JSON.stringify({ taskId: t.id, title: clamp(String(t.title || ''), 60) }))}">Later</button>`
        // Schedule carries the DUE DATE into the form (operator ask 2026-08-18) — an
        // overdue task prefills today instead (the writer refuses the past, and overdue
        // means "do it now", not "backdate it").
        + `<button class="r-btn small" data-lc-recfill="${LIFE.esc(JSON.stringify({ taskId: t.id, due: t.due_at ? String(t.due_at).slice(0, 10) : null }))}">Schedule</button></div></div>`).join('');
      const more = cands.length > ranked.length
        ? `<div class="r-note" style="margin-top:6px;font-size:11.5px">${cands.length - ranked.length} more open task${cands.length - ranked.length === 1 ? '' : 's'} wait in the form's picker, priority-ordered.</div>`
        : '';
      return S.rcc.panel({
        title: 'Worth scheduling next', sub: 'Deadlines first, then importance — Schedule fills the form below; nothing is written until you place it',
        headRight: ranked.length ? `<span class="r-pill">${ranked.length}</span>` : '',
        body: ranked.length
          ? rows + more
          : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Everything open either holds a block already or is waiting on a placement question above. Nothing is being left unscheduled.</div>`,
      });
    };
    const proposalsPanel = S.rcc.panel({
      title: 'Proposed next block', sub: 'Not written to Outlook until you approve — and only ever into the Life OS calendar',
      headRight: proposals.length ? `<span class="r-pill">${proposals.length}</span>` : '',
      body: proposals.length
        ? proposals.map(propCard).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">No proposed blocks right now. The daily compile proposes up to three focus blocks around your real commitments — each waits for your yes.</div>`,
    });

    const authorityPanel = S.rcc.panel({
      title: 'Calendar authority', sub: 'The standing rules this page lives by',
      body: [
        ['Only the Life OS calendar', 'Approved blocks are written there and nowhere else — your other calendars are read-only by construction.'],
        ['Your approval, every time', 'Nothing is placed, moved or removed without your tap; agents are refused by name.'],
        ['Stale means stale', 'If the refresh breaks, this page says so and shows when it last matched Outlook — stale is never dressed as fresh.'],
        ['No invented free time', 'Gaps between events are never offered back as bookable time.'],
      ].map(([t, d]) => `<div class="r-lrow"><div><div style="font-weight:600">${LIFE.esc(t)}</div><div style="font-size:12px;color:var(--rmuted);margin-top:2px">${LIFE.esc(d)}</div></div></div>`).join(''),
    });

    // ── WEEK ──────────────────────────────────────────────────────────────────
    // Seven day CARDS, each a list. Deliberately not a time grid: a grid draws the space
    // between two meetings as a clean empty rectangle, and an empty rectangle on a calendar
    // is an offer. These are lists, so a gap is an absence and nothing more.
    const weekPanel = () => {
      const events = s.weekEvents || [];
      const blocks = s.weekBlocks || [];
      const props = s.blockProposals || [];
      const days = [];
      for (let i = 0; i < WEEK_LEN; i++) days.push(addDays(w.start, i));

      const dayCard = (day) => {
        const ahead = daysBetween(s.today, day);
        // A day past the synced horizon is NAMED, never drawn as a quiet empty day —
        // "nothing in the calendar" and "we haven't looked that far" are different facts.
        const beyond = ahead > WINDOW_FWD_DAYS;
        // Overlap, so an event running in from the previous day appears on both.
        const dayEvents = events.filter((e) => String(e.start_at).slice(0, 10) <= day && String(e.end_at) > `${day}T00:00:00`);
        const timed = dayEvents.filter((e) => !e.is_all_day);
        const allDay = dayEvents.filter((e) => e.is_all_day);
        // Commitments EXCLUDE free-marked events, matching Today's rail and the day tiles.
        const dayBlocks = blocks.filter((b) => String(b.start_at).slice(0, 10) === day);
        // Our own blocks are mirrored into the calendar, so without this a placed block was
        // counted once as a commitment and again as a block, and the stated count could not
        // be reconciled against the list under it.
        const blockEventIds = new Set(blocks.map((b) => b.graph_event_id));
        const commitments = timed.filter((e) => e.show_as !== 'free' && !blockEventIds.has(e.id));
        const dayProps = props.filter((p) => p.targetDay === day);
        const label = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' })
          .format(new Date(`${day}T12:00:00Z`));
        const rel = ahead === 0 ? 'Today' : ahead === 1 ? 'Tomorrow' : '';

        // `title` is escaped here; pass {html} for a title that is ALREADY safe markup
        // (the block→task links — every interpolated value inside is esc'd at build).
        const row = (time, title, sub, tagHtml, tone) => `<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-top:1px solid var(--rline)">`
          + `<div style="font-family:var(--font-mono,monospace);font-size:11.5px;color:${tone || '#f0a276'};flex-shrink:0;width:82px">${LIFE.esc(time)}</div>`
          + `<div style="min-width:0;flex:1"><div style="font-size:12.5px;font-weight:600;overflow-wrap:anywhere">${title != null && typeof title === 'object' && title.html != null ? title.html : LIFE.esc(title)}</div>`
          + (sub ? `<div style="font-size:11px;color:var(--rmuted);margin-top:1px">${LIFE.esc(sub)}</div>` : '')
          + `</div>${tagHtml || ''}</div>`;

        let inner = '';
        if (beyond) {
          inner = `<div style="font-size:12px;color:var(--rmuted);padding:8px 0">Beyond how far the calendar has been read. Nothing is shown for this day because nothing is known about it yet.</div>`;
        } else {
          if (allDay.length) inner += `<div class="r-note" style="margin:6px 0;font-size:11.5px">All day: ${allDay.map((e) => LIFE.esc(e.subject || 'Busy')).join(' · ')}</div>`;
          // Outlook commitments and Life OS blocks side by side, in one chronological
          // column — the point of the week is seeing them against each other.
          // An event that crosses midnight appears on BOTH days it covers, which is right —
          // but last night's 22:00–05:00 and tonight's 22:00–05:00 would otherwise render as
          // two identical rows on the same day. Each says which way it runs.
          const shortDay = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' })
            .format(new Date(`${d}T12:00:00Z`));
          const spanOf = (e) => {
            const before = String(e.start_at).slice(0, 10) < day;
            const after = String(e.end_at).slice(0, 10) > day;
            if (before && after) {
              return { time: 'all day', note: `runs ${shortDay(String(e.start_at).slice(0, 10))} to ${shortDay(String(e.end_at).slice(0, 10))}` };
            }
            if (before) return { time: `→ ${hm(e.end_at)}`, note: `carried over from ${shortDay(String(e.start_at).slice(0, 10))}` };
            if (after) return { time: `${hm(e.start_at)} →`, note: `runs into ${shortDay(String(e.end_at).slice(0, 10))}` };
            return { time: `${hm(e.start_at)}–${hm(e.end_at)}`, note: '' };
          };
          const items = [
            ...timed.filter((e) => !blockEventIds.has(e.id)).map((e) => {
              const sp = spanOf(e);
              const detail = [e.location || '', e.show_as !== 'busy' ? String(e.show_as) : '', sp.note].filter(Boolean).join(' · ');
              return {
                at: `${String(e.start_at).slice(0, 10) < day ? '00:00:00' : String(e.start_at).slice(11)}`,
                html: row(sp.time, e.subject || 'Busy', detail, e.is_protected ? S.rcc.tag('Focus', 'good') : ''),
              };
            }),
            ...dayBlocks.map((b) => {
              // Ours to move: draggable onto another day card, or the Move button for
              // precise times (and for touch, where HTML5 drag does not exist). A PASSED
              // block whose task is still open says so — the slot lapsed and the task is
              // already back in the suggestions (the exclusion only counts future blocks).
              const bj = LIFE.esc(JSON.stringify({ blockId: b.id, title: b.title || 'Focus block', startAt: b.start_at, endAt: b.end_at }));
              const movable = String(b.end_at) > s.localNow;
              const lapsed = !movable && b.task_id && b.task_status && b.task_status !== 'DONE' && b.task_status !== 'CANCELLED';
              // The block's TITLE opens its task (operator ask 2026-08-18: "click on the
              // task and update as required with notes, updates etc") — the task page holds
              // the notes rail and every verb. A titled block with no task has nothing to open.
              const label = b.task_id
                ? `<a href="/life/task?id=${encodeURIComponent(String(b.task_id))}" style="color:inherit">${LIFE.esc(b.title || 'Focus block')}</a>`
                : LIFE.esc(b.title || 'Focus block');
              const inner = row(`${hm(b.start_at)}–${hm(b.end_at)}`, { html: label },
                lapsed ? 'slot passed, task still open — back in the suggestions' : 'held for focused work',
                (movable ? `<button class="r-btn small" data-lc-blockmove="${bj}">Move</button>` : '')
                + (lapsed ? S.rcc.tag('not done — re-suggested', 'warn') : S.rcc.tag('Life OS', 'info')), '#8ab4f8');
              return {
                at: String(b.start_at).slice(11),
                html: movable ? `<div draggable="true" data-lc-block="${bj}" style="cursor:grab">${inner}</div>` : inner,
              };
            }),
          ].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
          inner += items.length
            ? items.map((i) => i.html).join('')
            : `<div style="font-size:12px;color:var(--rmuted);padding:8px 0">Nothing in the calendar.</div>`;
          if (dayProps.length) {
            inner += `<div style="margin-top:6px;border-top:1px dashed rgba(255,179,77,.45);padding-top:4px">`
              + dayProps.map(propCard).join('') + `</div>`;
          }
        }
        // A future (or today) day inside the synced window takes block drops — dropping IS
        // the owner naming the day; the times ride the one confirm prompt.
        const droppable = !beyond && day >= s.today;
        return `<div class="r-card"${droppable ? ` data-lc-dropday="${LIFE.esc(day)}"` : ''} style="padding:10px 12px${ahead === 0 ? ';border-color:rgba(138,180,248,.5)' : ''}">`
          + `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">`
          + `<div style="font-weight:700;font-size:12.5px">${LIFE.esc(label)}${rel ? ` <span style="font-weight:500;color:var(--rmuted)">· ${rel}</span>` : ''}</div>`
          + `<div style="font-size:11px;color:var(--rmuted)">${beyond ? 'not read yet' : `${commitments.length} commitment${commitments.length === 1 ? '' : 's'}${dayBlocks.length ? ` · ${dayBlocks.length} block${dayBlocks.length === 1 ? '' : 's'}` : ''}`}</div>`
          + `</div>${inner}</div>`;
      };

      const nav = `<div style="display:flex;gap:6px;align-items:center">`
        + (w.prev ? `<a class="r-btn small" href="/life/schedule?view=week&start=${LIFE.esc(w.prev)}">‹ Previous 7 days</a>`
          : `<span class="r-btn small" style="opacity:.4">‹ Previous 7 days</span>`)
        + (w.start === s.today ? '' : `<a class="r-btn small" href="/life/schedule?view=week">Back to today</a>`)
        + (w.next ? `<a class="r-btn small" href="/life/schedule?view=week&start=${LIFE.esc(w.next)}">Next 7 days ›</a>`
          : `<span class="r-btn small" style="opacity:.4">Next 7 days ›</span>`)
        + `</div>`;

      // The navigation bound is stated rather than silently enforced — a greyed button with
      // no reason is the same lie as an invented day.
      const edge = !w.next
        ? `<div class="r-note" style="margin-top:10px;font-size:12px">This is as far forward as the calendar has been read. Days beyond it aren’t empty — they’re unknown, and nothing here will pretend otherwise.</div>`
        : !w.prev
          ? `<div class="r-note" style="margin-top:10px;font-size:12px">This is as far back as the mirror is kept. Older days have been let go, not lost — Outlook still has them.</div>`
          : '';

      return S.rcc.panel({
        title: 'The next seven days',
        sub: 'Your commitments and the blocks Life OS holds, side by side — no free time is computed between them',
        headRight: nav,
        body: `<div style="font-size:12px;color:var(--rmuted);margin:2px 0 10px">${LIFE.esc(w.start)} to ${LIFE.esc(w.end)}`
          // The two bounds are different facts and get different words: forward is a reading
          // horizon, backward is a retention one. One sentence for both told the owner that
          // days he HAD looked at were never read.
          + (w.clamped ? (w.clampedBack
            ? ' — moved to the earliest week the mirror still keeps.'
            : ' — moved to the furthest week the calendar has actually been read for.') : '')
          + `</div><div class="ls-week">${days.map(dayCard).join('')}</div>`
          + edge,
      });
    };

    // Proposals already shown against their own day are not repeated in the side panel —
    // but any that could not be placed on a day still surface there, never nowhere.
    const shownDays = new Set();
    if (isWeek) for (let i = 0; i < WEEK_LEN; i++) shownDays.add(addDays(w.start, i));
    const leftover = isWeek ? proposals.filter((p) => !shownDays.has(p.targetDay)) : proposals;
    const sideProposals = S.rcc.panel({
      title: isWeek ? 'Waiting on you, outside this week' : 'Proposed next block',
      sub: 'Not written to Outlook until you approve — and only ever into the Life OS calendar',
      headRight: leftover.length ? `<span class="r-pill">${leftover.length}</span>` : '',
      body: leftover.length
        ? leftover.map(propCard).join('')
        : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">${isWeek
          ? 'Every open calendar question is shown against its own day.'
          : 'No proposed blocks right now. The daily compile proposes up to three focus blocks around your real commitments — each waits for your yes.'}</div>`,
    });

    const overflowNote = s.proposalTotal > proposals.length
      ? `<div class="r-note" style="margin-bottom:12px">Showing ${proposals.length} of ${s.proposalTotal} open calendar questions — the rest are on Today.</div>`
      : '';

    const body = wrap(head + banner + tiles + overflowNote
      + `<div class="ls-main">`
      + `<div style="display:grid;gap:12px;align-content:start">${isWeek ? weekPanel() : todayPanel + myBlocksPanel}</div>`
      + `<div style="display:grid;gap:12px;align-content:start">${focusPanel}${isWeek ? sideProposals : proposalsPanel}${recommendPanel()}${proposeForm()}${authorityPanel}</div>`
      + `</div>`
      + `<style>.ls-main{display:grid;gap:12px;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}`
      + `.ls-week{display:grid;gap:8px}`
      + `@media(max-width:1000px){.ls-main{grid-template-columns:1fr}}</style>`);
    return { stamp: '', body };
  },
};
