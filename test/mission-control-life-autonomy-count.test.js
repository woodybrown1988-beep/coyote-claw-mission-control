'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('node:sqlite');

const TODAY = require('../mission-control/ui/pages/life/today.js');

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

function withEnv(dbPath, fn) {
  const previous = process.env.COYOTE_LIFE_DB;
  process.env.COYOTE_LIFE_DB = dbPath;
  try { return fn(); } finally {
    if (previous === undefined) delete process.env.COYOTE_LIFE_DB;
    else process.env.COYOTE_LIFE_DB = previous;
  }
}

function fixture(dir) {
  const dbPath = path.join(dir, 'life.db');
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`CREATE TABLE life_mail_moves (
    id TEXT PRIMARY KEY,
    rule_id TEXT,
    redirect_reason TEXT,
    state TEXT,
    moved_at TEXT
  )`);
  const insert = db.prepare(`INSERT INTO life_mail_moves
    (id, rule_id, redirect_reason, state, moved_at) VALUES (?, ?, ?, ?, ?)`);

  // 10 August is a BST day: it starts at 23:00Z on 9 August and ends at 23:00Z.
  insert.run('today-rule', 'rule-1', null, 'APPLIED', '2026-08-09T23:30:00.000Z');
  insert.run('today-allocation', null, 'auto-filed by allocation', 'APPLIED', '2026-08-10T22:30:00.000Z');
  insert.run('today-human', null, 'owner correction', 'APPLIED', '2026-08-10T12:00:00.000Z');
  insert.run('today-undone', 'rule-2', null, 'UNDONE', '2026-08-10T13:00:00.000Z');
  insert.run('yesterday-auto', 'rule-3', null, 'APPLIED', '2026-08-09T22:59:59.000Z');
  insert.run('tomorrow-auto', null, 'auto-filed by allocation', 'APPLIED', '2026-08-10T23:00:00.000Z');
  db.close();
  return dbPath;
}

function renderToday(dbPath) {
  return withEnv(dbPath, () => {
    const section = TODAY.getSection(null, { now: NOW });
    assert.equal(section.engine.ok, true);
    return TODAY.render(section, { now: NOW }).body;
  });
}

function autonomyCount(body) {
  const match = body.match(/applied without you: <b>(\d+)<\/b>/);
  assert.ok(match, 'the Handled quietly autonomy claim renders');
  return Number(match[1]);
}

test('Handled quietly renders a falsifiable count of automated moves on the London day', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-autonomy-'));
  const dbPath = fixture(dir);
  try {
    const initial = renderToday(dbPath);
    assert.equal(autonomyCount(initial), 2,
      'only applied rule-driven and allocation moves on the London day count');
    assert.doesNotMatch(initial, /every suggestion waits for your yes/,
      'the obsolete unconditional-consent claim is absent');

    const db = new sqlite.DatabaseSync(dbPath);
    db.prepare(`INSERT INTO life_mail_moves
      (id, rule_id, redirect_reason, state, moved_at) VALUES (?, ?, ?, ?, ?)`)
      .run('today-new-auto', 'rule-4', null, 'APPLIED', '2026-08-10T14:00:00.000Z');
    db.close();
    assert.equal(autonomyCount(renderToday(dbPath)), 3,
      'the displayed claim changes when another qualifying row is added');

    const cleanup = new sqlite.DatabaseSync(dbPath);
    cleanup.exec("DELETE FROM life_mail_moves WHERE id IN ('today-rule','today-allocation','today-new-auto')");
    cleanup.close();
    assert.equal(autonomyCount(renderToday(dbPath)), 0,
      'manual, non-applied, and adjacent-day rows fall back to zero');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
