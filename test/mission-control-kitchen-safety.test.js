'use strict';
// Kitchen Safety Centre — the oversight page over the Kitchen Safety App (mirrored into ks_*).
// THE load-bearing test is the RED-CAP NEGATIVE CONTROL: 1000 green checks + 1 open critical
// = RED, always. The module exists so a wall of passes can never hide one severe failure. Also
// pinned: the critical-ONLY severity ruling (open 'high' shows amber, not red-cap), the one-home
// thresholds (from ks_app_settings, never hardcoded), the honest calibration flag, the NEEDS-KEY
// state (no mock numbers), the four cap triggers, registry/nav, and the surveillance boundary.
const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const page = require('../mission-control/ui/pages/coyote/kitchen-safety.js');
const S = require('../mission-control/ui/shared.js');

const NOW = Date.parse('2026-07-22T12:00:00Z');
const ISO = (ms) => new Date(ms).toISOString();
const render = (db) => { const ctx = { q: (s, p) => DATA.safeSelect(db, s, p), now: NOW, query: {} }; return page.render(page.getSection(db, ctx), ctx); };
const sectionOf = (db) => { const ctx = { q: (s, p) => DATA.safeSelect(db, s, p), now: NOW, query: {} }; return page.getSection(db, ctx); };

// A CONNECTED, otherwise-GREEN Kitchen Safety mirror. Helpers then add red-cap triggers on top.
function greenDb() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE ks_sync_meta(table_name TEXT PRIMARY KEY,row_count INTEGER,synced_at INTEGER);
    CREATE TABLE ks_app_settings(id TEXT,key TEXT,value TEXT,category TEXT);
    CREATE TABLE ks_incident_reports(id TEXT,reference_number TEXT,title TEXT,category TEXT,severity TEXT,status TEXT,occurred_at TEXT,reported_to_authority INTEGER,affected_people_count INTEGER);
    CREATE TABLE ks_allergen_incidents(id TEXT,incident_report_id TEXT,allergen TEXT,menu_item_name_snapshot TEXT,medical_attention_required INTEGER,created_at TEXT);
    CREATE TABLE ks_checklist_items(id TEXT,is_critical INTEGER);
    CREATE TABLE ks_checklist_responses(id TEXT,item_id TEXT,is_pass INTEGER,corrective_action_required INTEGER,is_corrected INTEGER);
    CREATE TABLE ks_checklist_runs(id TEXT,status TEXT,signed_off_at TEXT);
    CREATE TABLE ks_corrective_actions(id TEXT,title TEXT,status TEXT,priority TEXT,due_date TEXT);
    CREATE TABLE ks_temp_log_entries(id TEXT,mode TEXT,status TEXT,logged_at TEXT);
    CREATE TABLE ks_allergen_menu_items(id TEXT,celery INTEGER,is_active INTEGER);
    CREATE TABLE ks_equipment_units(id TEXT,name TEXT,equipment_type TEXT,min_temp_celsius REAL,max_temp_celsius REAL,calibration_due_date TEXT,is_active INTEGER);
    CREATE TABLE ks_training_records(id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE ks_haccp_documents(id TEXT,title TEXT,document_type TEXT,is_active INTEGER,created_at TEXT);
    CREATE TABLE ks_house_rules_versions(id TEXT,section_id TEXT,version_number INTEGER,status TEXT,published_at TEXT,created_at TEXT);
    CREATE TABLE ks_risk_assessments(id TEXT,critical_control_point INTEGER);
    CREATE TABLE ks_sites(id TEXT,name TEXT,local_authority TEXT,registration_number TEXT);
    CREATE TABLE labour_day(actual_minutes INTEGER);
    INSERT INTO ks_sync_meta VALUES('ks_temp_log_entries',802,${NOW - 3600000});
    INSERT INTO ks_app_settings VALUES('a','fridge_max_temp_celsius','"5"','temperature'),('b','cooking_min_temp_celsius','"75"','temperature'),('c','freezer_max_temp_celsius','"-18"','temperature'),('d','reheating_min_temp_celsius','"82"','temperature'),('e','hot_hold_min_temp_celsius','"63"','temperature'),('f','delivery_max_chilled_temp_celsius','"8"','temperature');
    INSERT INTO ks_sites VALUES('s','Coyote','Test Council','REG-1');
    INSERT INTO ks_house_rules_versions VALUES('h','sec1',1,'active',NULL,'2026-01-01');
    INSERT INTO ks_haccp_documents VALUES('hd','Cook plan','plan',1,'2026-01-01');
    INSERT INTO labour_day VALUES(120000);
    INSERT INTO ks_checklist_items VALUES('crit',1),('norm',0);
    INSERT INTO ks_checklist_runs VALUES('run','completed','2026-07-22');
  `);
  // 1000 passing critical checks + 200 passing temperature readings + full allergen matrix + current training
  const rr = db.prepare(`INSERT INTO ks_checklist_responses VALUES(?,?,1,0,0)`);
  for (let i = 0; i < 1000; i++) rr.run('r' + i, 'crit');
  const tp = db.prepare(`INSERT INTO ks_temp_log_entries VALUES(?,?,'pass','2026-07-22')`);
  for (let i = 0; i < 200; i++) tp.run('t' + i, i % 2 ? 'cooking' : null);
  const am = db.prepare(`INSERT INTO ks_allergen_menu_items VALUES(?,0,1)`);
  for (let i = 0; i < 57; i++) am.run('a' + i);
  const trm = db.prepare(`INSERT INTO ks_training_records VALUES(?,'completed',?)`);
  for (let i = 0; i < 20; i++) trm.run('tr' + i, ISO(NOW + 90 * 864e5));
  db.prepare(`INSERT INTO ks_equipment_units VALUES('e1','Prep Fridge #1','fridge',0,5,?,1)`).run(ISO(NOW + 30 * 864e5));
  return db;
}

test('registry + nav: kitchen-safety in Reports AFTER inventory; server requires it; contract', () => {
  const reports = S.WORKSPACES.find((w) => w.key === 'coyote').groups.find((g) => g.group === 'Reports');
  const keys = reports.items.map((i) => i.key);
  assert.ok(keys.includes('kitchen-safety'), 'kitchen-safety in the Reports group'); // canonical order pinned in the registry tests
  assert.equal(reports.items.find((i) => i.key === 'kitchen-safety').route, '/coyote/kitchen-safety');
  const srv = require('node:fs').readFileSync(require('node:path').join(__dirname, '../mission-control/server.js'), 'utf8');
  assert.match(srv, /require\('\.\/ui\/pages\/coyote\/kitchen-safety\.js'\)/);
  assert.equal(page.key, 'kitchen-safety'); assert.equal(page.route, '/coyote/kitchen-safety');
});

test('NEEDS-KEY: no ks_* tables → honest not-connected state, zero mock numbers, names the key unlock, all 7 sections', () => {
  const db = new sqlite.DatabaseSync(':memory:'); // no ks_* at all
  const r = render(db);
  assert.match(r.body, /Not connected yet/);
  assert.match(r.stamp, /NEEDS-KEY/);
  assert.deepEqual(r.body.match(/£[\d,]+/g) || [], [], 'no mock £ figures');
  assert.match(r.body, /kitchen-safety\.env/, 'names the key file to drop');
  for (const id of ['overview', 'critical', 'allergens', 'hygiene', 'people', 'audit', 'integration']) assert.ok(r.body.includes(`id="${id}"`), `section ${id}`);
});

test('THE NEGATIVE CONTROL — 1000 green checks + 1 OPEN CRITICAL incident = RED, always', () => {
  const db = greenDb();
  // sanity: with no triggers the cap is clear and the score is not red
  let s = sectionOf(db);
  assert.equal(s.cap.active, false, 'baseline: cap clear');
  assert.notEqual(s.score.status, 'bad', 'baseline: not red');
  // add ONE open critical incident on top of 1000 green checks
  db.prepare(`INSERT INTO ks_incident_reports VALUES('X','INC-C','E.coli outbreak','contamination','critical','open','2026-07-20',0,0)`).run();
  s = sectionOf(db);
  assert.equal(s.cap.active, true, 'one open critical → cap ACTIVE');
  assert.equal(s.score.status, 'bad', 'status forced RED regardless of the blended number');
  assert.ok(s.score.blended >= 85, 'the underlying blended score is still high — proving the cap OVERRIDES, not averages');
  assert.match(render(db).stamp, /RED-CAP ACTIVE/);
});

test('all four cap triggers force RED; a green board clears the cap', () => {
  // (a) open critical checklist breach
  let db = greenDb();
  db.prepare(`INSERT INTO ks_checklist_responses VALUES('brk','crit',0,1,0)`).run();
  assert.equal(sectionOf(db).cap.active, true, 'uncorrected critical breach → RED');
  // (b) open allergen incident
  db = greenDb();
  db.prepare(`INSERT INTO ks_allergen_incidents VALUES('ai',NULL,'peanuts','Satay',1,'2026-07-20')`).run(); // unlinked → open
  assert.equal(sectionOf(db).cap.active, true, 'open allergen incident → RED');
  // (c) overdue critical corrective action
  db = greenDb();
  db.prepare(`INSERT INTO ks_corrective_actions VALUES('ca','Overdue reg action','open','critical',?)`).run(ISO(NOW - 5 * 864e5));
  assert.equal(sectionOf(db).cap.active, true, 'overdue critical corrective → RED');
  // (d) baseline green → clear
  assert.equal(sectionOf(greenDb()).cap.active, false, 'green board → cap clear');
});

test('critical-ONLY ruling: an open HIGH incident does NOT trip the hard cap (shows amber, not red-cap)', () => {
  const db = greenDb();
  db.prepare(`INSERT INTO ks_incident_reports VALUES('h','INC-H','Freezer panel fault','other','high','open','2026-06-08',0,0)`).run();
  const s = sectionOf(db);
  assert.equal(s.cap.active, false, 'open HIGH must not trip the hard cap (operator ruling: critical only)');
  // it still surfaces in the attention queue / incident table, just not as a hard cap
  assert.match(render(db).body, /Freezer panel fault/);
});

test('one-home thresholds: limits come from ks_app_settings (tagged from-app), never hardcoded', () => {
  const s = sectionOf(greenDb());
  const cook = s.thresholds.find((t) => t.key === 'cooking_min_temp_celsius');
  assert.equal(cook.value, 75); assert.equal(cook.fromApp, true);
  assert.equal(s.thresholds.find((t) => t.key === 'fridge_max_temp_celsius').value, 5);
  assert.match(render(greenDb()).body, /app_settings/, 'the source is shown, not a magic constant');
});

test('honest calibration flag: app fridge-storage limit (5) vs a differently-configured fridge unit is surfaced', () => {
  const db = greenDb();
  // add a fridge unit whose max (8) disagrees with the app storage limit (5)
  db.prepare(`INSERT INTO ks_equipment_units VALUES('e2','Cooking Fridge #2','fridge',0,8,?,1)`).run(ISO(NOW + 30 * 864e5));
  const s = sectionOf(db);
  assert.equal(s.fridgeCalibrationFlag, true, 'the 5-vs-8 mismatch is flagged');
  assert.match(render(db).body, /mismatch|disagree/, 'surfaced in the UI, not reconciled away');
});

test('RIDDOR is cross-source (labour hours) + illness is honestly not-captured; surveillance boundary held', () => {
  const db = greenDb();
  const s = sectionOf(db);
  assert.equal(s.accidentsPer10k, 0, '0 accidents over real labour hours → 0.00 per 10k, not null');
  const body = render(db).body;
  assert.match(body, /labour-hours|RotaCloud/, 'the denominator is the labour record');
  assert.match(body, /fitness-to-work isn.t captured|not captured/i, 'illness gap named honestly');
  assert.doesNotMatch(body, /per-person|individual score/i, 'no per-person performance scoring');
});

test('connected render carries real numbers with zero fabricated £, and the app-verdict process table', () => {
  const r = render(greenDb());
  assert.deepEqual(r.body.match(/£[\d,]+/g) || [], [], 'a safety module renders no £ figures');
  assert.match(r.body, /Critical-limit first-pass/, 'executive KPI present');
  assert.match(r.body, /pass\/borderline\/fail/, 'surfaces the app verdict, does not re-judge');
  assert.match(r.stamp, /cap clear/, 'green board stamp says cap clear');
});
