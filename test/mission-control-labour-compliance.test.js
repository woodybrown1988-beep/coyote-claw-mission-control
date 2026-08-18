'use strict';
// Labour compliance panel (operator brief 2026-08-18): the latest sweep's findings on the
// executive tab. Pinned:
//   • the LATEST sweep renders — clock findings by name (the brief explicitly asks for
//     names; the centre's no-names boundary stands for performance metrics, and this panel
//     reads labour_compliance_findings, never labour_shifts), sick league by days;
//   • a clean clock record says so in words; missing table → NO panel (merge order across
//     repos), and the rest of the executive tab is untouched.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const labour = require('../mission-control/ui/pages/coyote/labour.js');

const NOW = 1784800000000;

function baseDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sales_day (business_date TEXT PRIMARY KEY, net_sales_pence INTEGER, updated_at INTEGER);
    CREATE TABLE labour_day (business_date TEXT PRIMARY KEY, scheduled_minutes INTEGER, actual_minutes INTEGER, actual_paid_minutes INTEGER, scheduled_cost_pence INTEGER, actual_cost_pence INTEGER, salaried_cost_pence INTEGER, unmapped_scheduled_minutes INTEGER, unmapped_actual_minutes INTEGER, unmapped_names TEXT, anomalies TEXT, staff_scheduled INTEGER, staff_worked INTEGER, updated_at INTEGER);
    CREATE TABLE labour_dept (business_date TEXT, department TEXT, sched_minutes INTEGER, act_minutes INTEGER, sched_cost_rc_pence INTEGER, act_cost_rc_pence INTEGER, rc_uncosted_sched_min INTEGER, rc_uncosted_act_min INTEGER, rc_uncosted_names TEXT, updated_at INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE labour_shifts (business_date TEXT, user_id INTEGER, user_name TEXT, sched_minutes INTEGER, act_minutes INTEGER, variance_minutes INTEGER, rate_pence INTEGER, cost_basis TEXT, updated_at INTEGER);
    CREATE TABLE labour_hourly (business_date TEXT, hour INTEGER, scheduled_minutes INTEGER, actual_minutes INTEGER, scheduled_cost_pence INTEGER, actual_cost_pence INTEGER, updated_at INTEGER);
    CREATE TABLE labour_wtr_flags (business_date TEXT, user_id INTEGER, user_name TEXT, kind TEXT, detail TEXT, created_at INTEGER, PRIMARY KEY (business_date, user_id, kind));
    CREATE TABLE labour_rate_parity (user_id INTEGER, user_name TEXT, role_id INTEGER, role_name TEXT, kind TEXT, rc_value TEXT, locked_value TEXT, checked_at INTEGER);
    CREATE TABLE rota_review_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT, week_monday TEXT, ran_at INTEGER, status TEXT, trigger TEXT, rota_fingerprint TEXT, report_json TEXT, report_text TEXT, error TEXT);
    CREATE TABLE labour_intraday (business_date TEXT, department TEXT, as_of_ms INTEGER, sched_minutes_full INTEGER, sched_cost_rc_full INTEGER, worked_minutes_so_far INTEGER, cost_rc_so_far INTEGER, uncosted_minutes INTEGER, clocked_in_now TEXT, no_shows TEXT, ref_date TEXT, ref_worked_minutes INTEGER, ref_net_pence INTEGER, ref_to_hour INTEGER, updated_at INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE canon_constants (key TEXT PRIMARY KEY, value TEXT NOT NULL, as_of TEXT NOT NULL, note TEXT);
  `);
  db.exec(`INSERT INTO canon_constants (key, value, as_of, note) VALUES
      ('labour.employer_burden_multiplier','1.159','2026-07-02',NULL),
      ('labour.var_rate_kitchen','0.143','2026-07-18',NULL),
      ('labour.var_rate_foh','0.081','2026-07-18',NULL),
      ('labour.combined_anchor','0.30','2026-07-18',NULL),
      ('labour.materiality_pence','4500','2026-07-18',NULL);`);
  return db;
}

function withFindings(db) {
  db.exec(`CREATE TABLE labour_compliance_findings (run_kind TEXT, sweep_date TEXT, window_from TEXT, window_to TEXT,
    kind TEXT, business_date TEXT, user_name TEXT, role_name TEXT, detail TEXT, minutes INTEGER, days REAL, created_at INTEGER);`);
  const ins = db.prepare(`INSERT INTO labour_compliance_findings VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  // An OLDER sweep that must NOT render.
  ins.run('weekly', '2026-08-11', '2026-08-04', '2026-08-10', 'late', '2026-08-05', 'Old Sweep Row', 'FOH', 'stale', 25, null, NOW);
  // The latest sweep.
  ins.run('weekly', '2026-08-18', '2026-08-11', '2026-08-17', 'missed_in', '2026-08-14', 'Ailsa Fixture', 'FOH', "rota'd 09:00–17:00 but never clocked in", null, null, NOW);
  ins.run('weekly', '2026-08-18', '2026-08-11', '2026-08-17', 'late', '2026-08-15', 'Cara Fixture', 'Kitchen Assistant', 'clocked in 12:34, 34 min after the 12:00 rota start', 34, null, NOW);
  ins.run('weekly', '2026-08-18', '2026-04-01', '2026-08-17', 'sick_days', null, 'Brodie Fixture', null, '4 sick days since 2026-04-01', null, 4, NOW);
  ins.run('weekly', '2026-08-18', '2026-04-01', '2026-08-17', 'sick_days', null, 'Ailsa Fixture', null, '1 sick day since 2026-04-01', null, 1, NOW);
  return db;
}

function renderExec(db) {
  const ctx = { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: {} };
  return labour.render(labour.getSection(db, ctx), ctx).body;
}

test('the latest sweep renders by name; the older sweep does not; sick league ordered by days', () => {
  const body = renderExec(withFindings(baseDb()));
  assert.match(body, /Compliance sweep — clock record/);
  assert.match(body, /latest: weekly · 2026-08-18/);
  assert.match(body, /Jordan Williams exempt by rule/, 'the operator exemption is stated on the panel');
  assert.match(body, /Ailsa Fixture/);
  assert.match(body, /never clocked in/);
  assert.match(body, /34 min after the 12:00 rota start/);
  assert.ok(!body.includes('Old Sweep Row'), 'only the LATEST sweep renders');
  assert.match(body, /Sick days — measuring year from 1 April/);
  assert.ok(body.indexOf('Brodie Fixture') < body.indexOf('4d since 2026-04-01') + 200, 'sick totals carry days + window');
  assert.ok(body.indexOf('Brodie Fixture') < body.indexOf('Ailsa Fixture', body.indexOf('Sick days')), 'league ordered by days desc');
});

test('no findings table → no panel, executive tab intact; empty latest sweep says clean', () => {
  const bare = renderExec(baseDb());
  assert.ok(!bare.includes('Compliance sweep'), 'missing table = absent panel, never an error');
  assert.match(bare, /No settled labour-day record yet/, 'the executive tab renders its own honest empty state, untouched');

  const db = baseDb();
  db.exec(`CREATE TABLE labour_compliance_findings (run_kind TEXT, sweep_date TEXT, window_from TEXT, window_to TEXT,
    kind TEXT, business_date TEXT, user_name TEXT, role_name TEXT, detail TEXT, minutes INTEGER, days REAL, created_at INTEGER);`);
  db.prepare(`INSERT INTO labour_compliance_findings VALUES ('weekly','2026-08-18','2026-04-01','2026-08-17','sick_days',NULL,'Solo Sick',NULL,'2 sick days since 2026-04-01',NULL,2,${NOW})`).run();
  const clean = renderExec(db);
  assert.match(clean, /Clock record clean — every completed shift clocked in and out/);
  assert.match(clean, /Solo Sick/);
});
