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
  if (!fs.existsSync(p)) {
    return { ok: false, reason: 'life.db not initialised — the engine creates it on the Life OS writer’s first run' };
  }
  try {
    const db = new sqlite.DatabaseSync(p, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 5000;');
    return { ok: true, db };
  } catch (e) {
    return { ok: false, reason: `life.db unreadable: ${e.message}` };
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

module.exports = { lifeDbPath, openLifeReadonly, lifeSelect, esc, emptyCard, absentCard };
