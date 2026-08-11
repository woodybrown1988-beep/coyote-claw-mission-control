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

module.exports = { lifeDbPath, openLifeReadonly, lifeSelect, esc, emptyCard, absentCard, freshness, FRESH_WINDOW_MIN };
