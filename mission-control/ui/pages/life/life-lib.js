'use strict';
// Life OS read adapter — the ONLY Mission Control file allowed to touch life.db, and it opens
// READ-ONLY + busy_timeout, full stop. Operator ruling 2026-08-05: MC holds NO life.db write
// handle; every Life OS write goes authenticated-MC → the engine's sole-writer command path,
// which lands (documented + tested) in its own separately-tapped PR. Until then every board
// here is a read surface over the separate personal database.
//
// life.db absent is NOT an error: the engine creates it on the writer's first run. Pages render
// a designed gate-state naming that unlock — never a crash, never a fabricated number.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');

function lifeDbPath() {
  return process.env.COYOTE_LIFE_DB || path.join(os.homedir(), 'coyote-claw', 'data', 'life.db');
}

/** Open life.db read-only with the canon busy_timeout (incident 4cc58fda: a handle without it
 *  fails SQLITE_BUSY on a writer's brief exclusive window instead of waiting it out). */
function openLifeReadonly() {
  const p = lifeDbPath();
  // Owner-voice reasons (defence-in-depth): these can only surface to the owner, so no
  // engineering vocabulary or raw error text even though pages currently render absentCard.
  if (!fs.existsSync(p)) {
    return { ok: false, reason: 'Life OS isn’t set up yet — it starts the first time you capture something.' };
  }
  try {
    const db = new sqlite.DatabaseSync(p, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 5000;');
    return { ok: true, db };
  } catch (_) {
    return { ok: false, reason: 'Life OS data couldn’t be read right now — try again in a moment.' };
  }
}

/** Guarded SELECT — a missing table (schema from a later PR) degrades to ok:false, so a page
 *  renders its gate-state instead of throwing. The read-only handle makes writes impossible. */
function lifeSelect(db, sql, params = []) {
  try {
    return { ok: true, rows: db.prepare(sql).all(...params) };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function esc(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** OWNER-VOICE empty state (visual pack EMPTY_STATE_RULES): one truthful line + one useful
 *  action. Never scaffold language, never a fake number, never an "unlock". */
function emptyCard(title, sub, text, actionHtml) {
  return `<div class="r-card r-panel"><div class="r-panel-head"><div><h3 class="r-panel-title">${esc(title)}</h3>${sub ? `<div class="r-panel-sub">${esc(sub)}</div>` : ''}</div></div>`
    + `<div style="font-size:13.5px;line-height:1.6;color:var(--rmuted);padding:4px 0">${esc(text)}</div>`
    + (actionHtml ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${actionHtml}</div>` : '') + `</div>`;
}

/** Whole-page owner state before anything has been captured (life.db not started yet). */
function absentCard(what) {
  return emptyCard(what, 'Nothing here yet', 'Nothing has been captured yet. Capture the first thing on your mind and this page takes shape from there.',
    '<button class="r-btn primary" data-lc-fab>Capture your first task</button>');
}

// CALENDAR FRESHNESS — ONE definition of "is this picture of Outlook still true", shared by
// every surface that shows the calendar. It lives here because it was already duplicated
// (Schedule and Today each carried their own 45), and a week view would have made three
// copies of a rule whose whole point is that it never drifts. The poll runs every 20 min;
// twice that plus slack is the honest window.
const FRESH_WINDOW_MIN = 45;

/** Age + the one staleness sentence. A failed refresh is stale by definition, however
 *  recent it was: a broken poll must never read as a fresh picture. */
function freshness(sync, nowMs) {
  const ageMin = Math.max(0, Math.round((nowMs - Date.parse(sync.last_sync_at)) / 60_000));
  const ageText = ageMin < 60 ? `${ageMin} min` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m`;
  const failed = !!sync.last_error;
  const stale = failed || ageMin > FRESH_WINDOW_MIN;
  const caption = stale
    ? `Stale — last good look at Outlook was ${ageText} ago${failed ? ' and the latest refresh failed' : ''}. Outlook itself is the truth right now.`
    : `Fresh — matched to Outlook ${ageText} ago.`;
  return { stale, caption, ageText };
}

// ── AGENT PRESENCE (operator ask 2026-08-13): who is on a task, and where they are ──────
// The job STATE MACHINE is the stage — never a fabricated percentage. Life pages supply the
// task→job mapping (AGENT_DISPATCHED events, latest per task, from life.db); the BUSINESS
// ctx.q supplies live job status from librarian.db — a cross-domain read BY REFERENCE (ids
// only), exactly the canon shape. A missing jobs table or a stale id degrades to no chip.
// Agent names come from the shared roster (shared.js), so a task page and the engine board can
// never disagree about who is on the job. This was a hand-written 3-entry map — a task dispatched
// to the Financial Planner or the Accountant showed the raw job type ('finplan') on the task page,
// while the board showed something else again.
const SHARED = require('../../shared.js');
const AGENT_NAME = Object.fromEntries(Object.keys(SHARED.FLEET).map((k) => [k, SHARED.FLEET[k].name]));
const STAGE_LABEL = {
  queued: 'queued', preparing: 'picked up', dispatched: 'picked up', running: 'working now',
  awaiting_plan_feedback: 'plan awaits your approval', awaiting_signoff: 'in review',
  done: 'delivered', failed: 'gave up', escalated: 'gave up',
};
const IN_FLIGHT_STATUSES = ['queued', 'preparing', 'dispatched', 'running', 'awaiting_plan_feedback', 'awaiting_signoff'];

// THE COMPANION LANE IS NOT THE AGENT ON THE TASK (audit finding, 2026-08-27).
// A buying decision earns a market check: the dispatcher enqueues the primary lane and then,
// in the SAME loop iteration, a context-only research job (dispatch.ts — contextOnly: true).
// Its AGENT_DISPATCHED event is therefore ALWAYS the later of the two — measured 10ms apart on
// the live board (16:07:01.211Z boxquery, then 16:07:01.221Z research). Both maps below are
// last-wins, so without this guard the companion always won: the task rail named "Researcher"
// while the desk that actually owned the verdict went unnamed, and the Box Query -> Financial
// Planner handoff attribution was lost with it. The companion INFORMS a decision; it is never
// the agent working the task.
const isCompanionLane = (pj) => !!pj && pj.contextOnly === true;

/** rows of AGENT_DISPATCHED events (ordered ASC by created_at) → Map(taskId → {jobId, jobKind}),
 *  LAST dispatch wins (a sent-back task's live job is its newest one). */
function latestDispatchByTask(eventRows) {
  const m = new Map();
  for (const r of eventRows || []) {
    let pj = {};
    try { pj = JSON.parse(String(r.payload_json || '{}')); } catch (_) { continue; }
    if (isCompanionLane(pj)) continue;                       // the market check informs; it is not the agent
    if (pj && typeof pj.jobId === 'string' && pj.jobId) m.set(r.task_id, { jobId: pj.jobId, jobKind: String(pj.jobKind || '') });
  }
  return m;
}

/** Batch job-status lookup over the BUSINESS q (ctx.q shape: (sql, params) → {ok, rows}). */
function jobStates(bizQ, jobIds) {
  const out = new Map();
  const ids = [...new Set(jobIds)].filter(Boolean).slice(0, 200);
  if (!ids.length || typeof bizQ !== 'function') return out;
  const ph = ids.map(() => '?').join(',');
  // attempts/max_attempts ride along: a 'failed' job that can still retry is NOT a give-up,
  // and calling it one would send the owner to a task the fleet is about to pick up again.
  const res = bizQ(`SELECT id, type, status, updated_at, result, attempts, max_attempts FROM jobs WHERE id IN (${ph})`, ids);
  if (!res || !res.ok || !Array.isArray(res.rows)) return out;
  for (const r of res.rows) out.set(String(r.id), r);
  return out;
}

// ── "THE AGENT IS STUCK UNTIL YOU SPEAK" (operator ask 2026-08-13) ───────────────────────
// The owner asked for a light-red row wherever a task is waiting on HIM to talk to its
// agent — "currently I have to go into the task to see this". Four honest states, all of
// them the agent unable to proceed without words only he has:
//   · it asked a question (a done job whose outcome is 'cant-see' — the ask rail)
//   · it gave up (escalated, or failed with no attempts left)
//   · its plan needs his approval (the Lead's soft gate)
//   · it needs his sign-off
// DELIBERATELY NOT flagged: a delivered answer awaiting accept (that is a DECISION, and
// Today's queue owns it — colouring it red would drown the real asks), and a task he has
// ALREADY sent back (queued to go again, not stuck — the red case in the tests).

/** taskId → { jobId, jobKind, reopened } from AGENT_DISPATCHED + REOPENED rows (ASC).
 *  A REOPENED after the last dispatch means the owner already answered: not stuck.
 *  A newer dispatch resets it (the agent is off again on the fresh brief). */
function dispatchStateByTask(eventRows) {
  const m = new Map();
  for (const r of eventRows || []) {
    if (String(r.event_type) === 'REOPENED') {
      const cur = m.get(r.task_id);
      if (cur) cur.reopened = true;
      continue;
    }
    let pj = {};
    try { pj = JSON.parse(String(r.payload_json || '{}')); } catch (_) { continue; }
    if (isCompanionLane(pj)) continue;                       // ditto — and it must not decide "needs you"
    if (pj && typeof pj.jobId === 'string' && pj.jobId) {
      m.set(r.task_id, { jobId: pj.jobId, jobKind: String(pj.jobKind || ''), reopened: false });
    }
  }
  return m;
}

/** null, or why the agent cannot proceed without the owner. */
function agentNeedsYou(entry, job) {
  if (!entry || entry.reopened || !job) return null;
  const s = String(job.status);
  const who = AGENT_NAME[entry.jobKind] || entry.jobKind || 'the agent';
  if (s === 'awaiting_plan_feedback') return { who, reason: 'its plan needs your approval before it builds' };
  if (s === 'awaiting_signoff') return { who, reason: 'it needs your sign-off to finish' };
  if (s === 'escalated' || (s === 'failed' && Number(job.attempts) >= Number(job.max_attempts))) {
    return { who, reason: 'it gave up — send it back with what it was missing' };
  }
  if (s === 'done') {
    let jr = {};
    try { jr = JSON.parse(String(job.result || '{}')); } catch (_) { return null; }
    if (jr && String(jr.outcome) === 'cant-see') return { who, reason: 'it asked you a question' };
  }
  return null;
}

/** The light-red row treatment + its one-line reason. ONE definition, every list. */
const NEEDS_YOU_ROW_STYLE = 'background:rgba(239,107,104,.10);border-left:3px solid var(--rbad,#ef6b68);padding-left:9px';
function needsYouChip(nu) {
  if (!nu) return '';
  return `<div style="font-size:12px;color:var(--rbad,#ef6b68);font-weight:600;margin-top:3px">🗣 ${esc(nu.who)} needs you — ${esc(nu.reason)}</div>`;
}

/** The one-line presence chip: '🤖 Data Desk · working now' (empty when nothing live). */
function agentChip(jobKind, status) {
  if (!status) return '';
  const name = AGENT_NAME[jobKind] || jobKind || 'agent';
  const stage = STAGE_LABEL[status] || status;
  const tone = status === 'awaiting_plan_feedback' ? 'color:#ef6b68;font-weight:600'
    : status === 'awaiting_signoff' ? 'color:#f5c96b' : 'color:var(--rmuted)';
  return `<span style="font-size:11.5px;${tone}">🤖 ${esc(name)} · ${esc(stage)}</span>`;
}

/** The honest stage strip: the REAL state machine as steps, current highlighted. No %s —
 *  a one-shot job has no truthful percentage; the machine's position is the truth. */
function stageStrip(status) {
  const STEPS = [
    { label: 'queued', at: ['queued'] },
    { label: 'working', at: ['preparing', 'dispatched', 'running'] },
    { label: 'review', at: ['awaiting_plan_feedback', 'awaiting_signoff'] },
    { label: 'delivered', at: ['done'] },
  ];
  if (status === 'failed' || status === 'escalated') {
    return `<span style="font-size:11px;color:#ef6b68">✕ gave up — reopen or send back to try again</span>`;
  }
  let reached = -1;
  STEPS.forEach((st, i) => { if (st.at.includes(status)) reached = i; });
  if (reached === -1 && status === 'done') reached = 3;
  const seg = (st, i) => {
    const isNow = i === reached;
    const past = i < reached || status === 'done';
    const col = isNow ? (status === 'awaiting_plan_feedback' ? '#ef6b68' : '#f0b64f') : past ? 'var(--rgood,#45c486)' : 'var(--rmuted)';
    const w = isNow ? 'font-weight:650;' : '';
    return `<span style="${w}color:${col}">${esc(st.label)}</span>`;
  };
  return `<span style="font-size:11px;display:inline-flex;gap:6px;align-items:center">${STEPS.map(seg).join('<span style="color:var(--rmuted)">›</span>')}</span>`;
}

// ── DATES A PERSON CAN ACT ON (audit 2026-08-28) ─────────────────────────────────────────
// Every Life OS surface printed "Due 2026-08-24" and left the reader to do the arithmetic —
// against a board where the overdue and the merely-scheduled looked identical. "4 days overdue"
// is a fact you can act on; an ISO date is homework.
//
// London, deliberately: the whole system plans in Europe/London and a UTC day boundary would
// call something overdue for the last hour of the previous evening. Whole DAYS apart, not
// elapsed hours, so a task due at 09:00 does not read "due in 0 days" all morning.
const LONDON = 'Europe/London';
function londonDayNumber(d) {
  // Days since epoch AS SEEN IN LONDON — the en-CA locale gives YYYY-MM-DD, which Date.UTC can
  // take back apart without re-introducing a timezone.
  const [y, m, day] = new Intl.DateTimeFormat('en-CA', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, day) / 86400000);
}

/** "4 days overdue" · "due today" · "due tomorrow" · "due in 6 days" · "due 12 Sep".
 *  Returns '' for anything unparseable — a bad date must print nothing, never "NaN days". */
function duePhrase(iso, nowMs = Date.now()) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  const days = londonDayNumber(new Date(t)) - londonDayNumber(new Date(nowMs));
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days === -1) return '1 day overdue';
  if (days < 0) return `${-days} days overdue`;
  if (days <= 13) return `due in ${days} days`;
  // Beyond a fortnight a relative count stops meaning anything — a date reads better.
  return `due ${new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, day: 'numeric', month: 'short' }).format(new Date(t))}`;
}

/** How urgent, as a class the eye can sort before the words are read.
 *  'crit' overdue or due today · 'soon' inside three days · 'ok' everything else. */
function dueSeverity(iso, nowMs = Date.now()) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return 'none';
  const days = londonDayNumber(new Date(t)) - londonDayNumber(new Date(nowMs));
  if (days <= 0) return 'crit';
  if (days <= 3) return 'soon';
  return 'ok';
}

module.exports = {
  lifeDbPath, openLifeReadonly, lifeSelect, esc, emptyCard, absentCard, freshness, FRESH_WINDOW_MIN,
  AGENT_NAME, STAGE_LABEL, IN_FLIGHT_STATUSES, latestDispatchByTask, jobStates, agentChip, stageStrip,
  dispatchStateByTask, agentNeedsYou, needsYouChip, NEEDS_YOU_ROW_STYLE,
  duePhrase, dueSeverity,
};
