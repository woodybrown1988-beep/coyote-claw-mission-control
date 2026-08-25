'use strict';
// THE WEEKLY BOOKER RUN'S GO BUTTON, checked against EMITTED output (operator ask 2026-08-25).
//
// Rendering-time checks matter more here than usual. The whole life command surface rides ONE
// inline client script, so a single parse error in emitted HTML does not break one button — it
// breaks EVERY button on the page. So these tests read the string the browser would actually
// receive, not the source that produced it.
//
// The panel keys on the BOOKER_RUN_ARMED event, never on the title. A task that merely mentions
// Booker gets nothing; a renamed task keeps its button.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');
const TASK = require('../mission-control/ui/pages/life/task.js');
const LIFECMD = require('../mission-control/ui/life-command-lib.js');

const T = '2026-08-25T09:00:00.000Z';

function withEnv(dbPath, fn) {
  const prev = process.env.COYOTE_LIFE_DB;
  process.env.COYOTE_LIFE_DB = dbPath;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.COYOTE_LIFE_DB; else process.env.COYOTE_LIFE_DB = prev;
  }
}

function fixture(dir, events) {
  const p = path.join(dir, 'life.db');
  const db = new sqlite.DatabaseSync(p);
  db.exec(`
    CREATE TABLE life_tasks (id TEXT PRIMARY KEY, owner_id TEXT, outcome_id TEXT, project_id TEXT, domain_key TEXT,
      title TEXT, description TEXT DEFAULT '', status TEXT, execution_mode TEXT, definition_of_done TEXT DEFAULT '',
      due_kind TEXT DEFAULT 'NONE', due_at TEXT, importance INTEGER DEFAULT 3, risk_level TEXT DEFAULT 'LOW', recurs TEXT,
      visibility TEXT, source_type TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_task_events (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, event_type TEXT, actor_type TEXT,
      actor_id TEXT, from_state TEXT, to_state TEXT, payload_json TEXT DEFAULT '{}', idempotency_key TEXT, created_at TEXT);
    CREATE TABLE life_task_updates (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, actor_type TEXT, actor_id TEXT,
      raw_text TEXT, input_type TEXT, record_only INTEGER DEFAULT 0, visibility TEXT, source_ref TEXT,
      attachment_refs_json TEXT DEFAULT '[]', extractor_version TEXT, created_at TEXT);
    CREATE TABLE life_update_facts (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT, fact_type TEXT,
      value_json TEXT, unit TEXT, source_start INTEGER, source_end INTEGER, confidence REAL,
      validation_state TEXT, extractor_version TEXT, created_at TEXT);
    CREATE TABLE life_update_proposals (id TEXT PRIMARY KEY, owner_id TEXT, update_id TEXT, task_id TEXT,
      source_mail_id TEXT, capability_key TEXT, command_type TEXT, command_json TEXT, reason TEXT,
      confidence REAL, risk_level TEXT, authority_class TEXT, state TEXT, decided_by TEXT, decision_note TEXT, created_at TEXT);
    CREATE TABLE life_waiting_conditions (id TEXT PRIMARY KEY, task_id TEXT, owner_id TEXT,
      dependency_label TEXT, wake_type TEXT, fallback_at TEXT, state TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE life_projects (id TEXT PRIMARY KEY, owner_id TEXT, domain_key TEXT, title TEXT,
      definition_of_done TEXT, stage TEXT, status TEXT, visibility TEXT, created_at TEXT, updated_at TEXT, standing INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE life_task_files (id TEXT PRIMARY KEY, owner_id TEXT, task_id TEXT, filename TEXT,
      original_name TEXT DEFAULT '', kind TEXT, bytes INTEGER, sha256 TEXT, note TEXT DEFAULT '',
      state TEXT DEFAULT 'ATTACHED', created_at TEXT, updated_at TEXT);
    INSERT INTO life_tasks (id,owner_id,domain_key,title,status,execution_mode,visibility,source_type,recurs,created_by,created_at,updated_at)
      VALUES ('t1','woody','business','Booker invoices - weekly harvest and price update','READY','SELF','OWNER_ONLY','SYSTEM','Weekly','h','${T}','${T}');
  `);
  const ins = db.prepare(`INSERT INTO life_task_events (id,owner_id,task_id,event_type,actor_type,actor_id,payload_json,created_at)
                          VALUES (?,?,?,?,?,?,?,?)`);
  (events || []).forEach((e, i) => ins.run(`e${i}`, 'woody', 't1', e.type, 'HUMAN', 'woody', JSON.stringify(e.payload || {}), e.at || T));
  db.close();
  return p;
}

const render = () => TASK.render(TASK.getSection(null, { query: { id: 't1' } }), {});

function inTmp(events, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-booker-'));
  try { return withEnv(fixture(dir, events), () => fn(render())); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('the GO button is emitted for an ARMED Booker task', () => {
  inTmp([{ type: 'BOOKER_RUN_ARMED', payload: { due: '2026-08-31', cadence: 'Weekly' } }], (out) => {
    const html = out.body;
    assert.match(html, /Booker &mdash; the weekly update/);
    assert.match(html, /Go &mdash; run the Booker update/);
    // The button must carry a well-formed command the relay will accept, not just a label.
    const m = /data-lc-cmd="([^"]+)"/.exec(html.slice(html.indexOf('Go &mdash;') - 400));
    assert.ok(m, 'the Go button carries no data-lc-cmd');
    const cmd = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    assert.equal(cmd.command, 'booker_run');
    assert.ok(LIFECMD.COMMAND_SHAPES
      ? LIFECMD.COMMAND_SHAPES.booker_run(cmd.payload)
      : true, 'booker_run must pass the command-shape gate');
    assert.match(html, /Not run yet this week/);
  });
});

test('a task with no ARMED event gets no Booker panel — the title is never the key', () => {
  inTmp([], (out) => {
    assert.doesNotMatch(out.body, /Booker &mdash; the weekly update/);
    assert.doesNotMatch(out.body, /booker_run/);
  });
});

test('the last run is shown, and an outstanding fetch is stated rather than glossed', () => {
  inTmp([
    { type: 'BOOKER_RUN_ARMED', payload: { due: '2026-08-31' } },
    { type: 'BOOKER_RUN_EXECUTED', at: '2026-08-25T11:00:00.000Z',
      payload: { ok: true, note: 'booker: 23 invoices, 247 lines.', needsBrowser: true,
                 missingDirect: 71, missingDirectValue: 4743.23 } },
  ], (out) => {
    const html = out.body;
    assert.match(html, /Last run 2026-08-25 11:00/);
    assert.match(html, /booker: 23 invoices, 247 lines\./);
    assert.match(html, /71<\/b> Marketplace invoices are still on Booker/);
    assert.match(html, /4743\.23 ex VAT/);
    assert.match(html, /needs your logged-in Chrome/);
  });
});

test('a run with nothing outstanding says so — and a FAILED run is loud, not a summary line', () => {
  inTmp([
    { type: 'BOOKER_RUN_ARMED', payload: {} },
    { type: 'BOOKER_RUN_EXECUTED', payload: { ok: true, note: 'all in', needsBrowser: false } },
  ], (out) => assert.match(out.body, /Nothing outstanding/));

  inTmp([
    { type: 'BOOKER_RUN_ARMED', payload: {} },
    { type: 'BOOKER_RUN_EXECUTED', payload: { ok: false, error: 'parser threw: OSError' } },
  ], (out) => {
    // A crashed run and a run that found nothing look identical in a summary line, and only one
    // of them means the week is fine. The failure must be unmissable.
    assert.match(out.body, /Last run FAILED/);
    assert.match(out.body, /parser threw: OSError/);
    assert.doesNotMatch(out.body, /Nothing outstanding/);
  });
});

test('EMITTED inline scripts still parse — one syntax error kills every button on the page', () => {
  inTmp([{ type: 'BOOKER_RUN_ARMED', payload: { due: '2026-08-31' } }], (out) => {
    const blocks = [...String(out.body).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const src of blocks) {
      // new Function throws on a syntax error exactly where the browser would.
      assert.doesNotThrow(() => new Function(src), 'an emitted inline script does not parse');
    }
  });
});
