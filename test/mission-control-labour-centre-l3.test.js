'use strict';

// Labour Centre L3 — COVERAGE & PEOPLE, the FINAL tab on /coyote/labour (replacing the L2
// pending banner + the held panels; the centre is COMPLETE). Honesty under test:
//   • the aggregate people KPI strip (last full week): hand-computed arithmetic incl. a ±15min
//     BOUNDARY shift (±15 exactly is WITHIN — never counted late/short), zero person keys;
//   • the combined coverage-vs-required heatmap: staffed = labour_hourly TRUE £ per weekday
//     occurrence; required = line-grain demand share × the formula budget — hand-pinned on a
//     small fixture, captioned 'a derivation, not a rota standard'; ONLINE exclusion + the
//     June-hole caveat; a weekday with no hourly record renders blank, never zero;
//   • the CLASS-based surveillance boundary pinned BOTH directions: a seeded behavioural
//     pattern (same name, 3 late shifts) NEVER renders as a queue row, while the SAME name in
//     a seeded WTR flag DOES render in the compliance panel; the exclusion line is present;
//   • aggregate ratios arithmetic (adherence / WTR streak / parity-clean / unmapped share /
//     staffing-per-open-hour), all site-level, captioned;
//   • the today-live intraday strip renders ABOVE the KPI strip (its ruled home);
//   • NO pending banner remains on ANY of the six tabs — the centre is complete;
//   • empty DB → honest states, zero fabricated £ values, the canon cards still render.

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const labour = require('../mission-control/ui/pages/coyote/labour.js');

const NOW = 1784800000000; // 2026-07-23 (Thursday); labour anchor 2026-07-19 → last full week 07-13 → 07-19

function makeDb() {
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
    CREATE TABLE rota_ahead_budget (business_date TEXT, department TEXT, labour_pct REAL, revenue_target_pence INTEGER, as_of INTEGER, PRIMARY KEY (business_date, department));
    CREATE TABLE rota_ahead_shifts (business_date TEXT, rc_shift_id INTEGER, user_id INTEGER, user_name TEXT, role_id INTEGER, role_name TEXT, department TEXT, sched_start INTEGER, sched_end INTEGER, sched_break_min INTEGER, sched_minutes INTEGER, cost_basis TEXT, rate_pence INTEGER, sched_cost_true_pence INTEGER, sched_cost_rc_pence INTEGER, as_of INTEGER);
    CREATE TABLE sales_receipts_api (receipt_id TEXT PRIMARY KEY, business_date TEXT, type TEXT, cancelled INTEGER, account_profile_code TEXT, net_without_tax_pence INTEGER, updated_at INTEGER);
    CREATE TABLE sales_receipt_lines_api (receipt_id TEXT, line_id TEXT, business_date TEXT, net_without_tax_pence INTEGER, accounting_group TEXT, time_of_sale_ms INTEGER, updated_at INTEGER, PRIMARY KEY (receipt_id, line_id));
    CREATE TABLE sales_channel_map_api (account_profile_code TEXT PRIMARY KEY, profile_name TEXT, delivery_mode TEXT, channel_label TEXT, first_seen INTEGER, updated_at INTEGER, label_source TEXT);
    CREATE TABLE sales_api_ingest_runs (business_date TEXT, source TEXT, status TEXT);
  `);
  // The ruled constants — canon_constants fixture (the labour page READS these from the DB;
  // the engine's schema.sql seeds the live table — ruling 2026-08-10, one home).
  db.exec(`CREATE TABLE IF NOT EXISTS canon_constants (key TEXT PRIMARY KEY, value TEXT NOT NULL, as_of TEXT NOT NULL, note TEXT);
    INSERT INTO canon_constants (key, value, as_of, note) VALUES
      ('labour.employer_burden_multiplier','1.159','2026-07-02',NULL),
      ('labour.var_rate_kitchen','0.143','2026-07-18',NULL),
      ('labour.var_rate_foh','0.081','2026-07-18',NULL),
      ('labour.combined_anchor','0.30','2026-07-18',NULL),
      ('labour.materiality_pence','4500','2026-07-18',NULL);`);
  return db;
}

function ctxFor(db, query) {
  return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: query || {} };
}
function renderTab(db, query) {
  const ctx = ctxFor(db, query);
  return labour.render(labour.getSection(db, ctx), ctx).body;
}

// The centre fixture week (2026-07-13 → 2026-07-19, Mon–Sun): net £3,000/day; TRUE actual
// £900/day (salaried £200 inside), scheduled £850; 50h worked (3,000 min)/day.
function seedKpiWeek(db) {
  const sd = db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence) VALUES (?, 300000)`);
  const ld = db.prepare(`INSERT INTO labour_day (business_date, scheduled_minutes, actual_minutes, actual_paid_minutes, scheduled_cost_pence, actual_cost_pence, salaried_cost_pence, unmapped_names) VALUES (?, 3100, 3000, 3050, 85000, 90000, 20000, '[]')`);
  for (let i = 13; i <= 19; i++) { sd.run(`2026-07-${i}`); ld.run(`2026-07-${i}`); }
}

function seedShift(db, date, id, name, sched, act, variance, rate) {
  db.prepare(`INSERT INTO labour_shifts (business_date, user_id, user_name, sched_minutes, act_minutes, variance_minutes, rate_pence) VALUES (?,?,?,?,?,?,?)`)
    .run(date, id, name, sched, act, variance, rate);
}

// ---------------- (1) the aggregate people KPI strip ----------------

test('KPI strip: hand-computed aggregates incl. the ±15min BOUNDARY (exactly ±15 is WITHIN, never late/short); zero person keys', () => {
  const db = makeDb();
  seedKpiWeek(db);
  db.prepare(`DELETE FROM labour_day WHERE business_date = '2026-07-15'`).run(); // one no-record day
  seedShift(db, '2026-07-14', 1, 'Kai Overrun', 480, 570, 90, 1200);   // +90 → OT + late/short
  seedShift(db, '2026-07-14', 2, 'Lena Overrun', 480, 510, 30, 1200);  // +30 → OT + late/short
  seedShift(db, '2026-07-16', 3, 'Mo Short', 480, 420, -60, 1200);     // −60 → late/short
  seedShift(db, '2026-07-17', 4, 'Bea Boundary', 480, 465, -15, 1200); // THE BOUNDARY — within
  seedShift(db, '2026-07-17', 5, 'Cy Within', 480, 470, -10, 1200);    // within
  seedShift(db, '2026-07-18', 6, 'Uma Unrota', null, 300, null, 1000); // unrota'd worked
  const body = renderTab(db, { tab: 'coverage' });
  assert.ok(body.includes('2.0h'), 'overtime = Σ positive variance (90+30)/60 — negatives never offset');
  assert.match(body, /Late \/ short shifts<\/div><div class="r-kpi-value">3</, 'late/short COUNT = 3 (±15 exactly is within — the boundary shift never counts)');
  assert.match(body, /Unrota&#39;d worked shifts<\/div><div class="r-kpi-value">1</, `unrota'd worked shifts = 1`);
  assert.match(body, /No-record days<\/div><div class="r-kpi-value">1</, 'no-record days = 7-day calendar minus labour_day rows');
  assert.ok(body.includes('+£300.00'), 'pay-cost variance £ = Σ actual − Σ scheduled TRUE over the 6 recorded days');
  assert.ok(body.includes('22.2%'), 'salaried cover share = 120,000 ÷ 540,000');
  assert.ok(body.includes('2026-07-13') && body.includes('2026-07-19'), 'the last full Mon–Sun window is named');
  assert.ok(body.includes('zero person keys'), 'the aggregates-only pledge is captioned');
  assert.ok(body.includes('±15 exactly is within'), 'the boundary rule is captioned');
  assert.ok(body.includes('no department key'), 'the site-level basis is stated');
  for (const name of ['Kai Overrun', 'Lena Overrun', 'Mo Short', 'Bea Boundary', 'Cy Within', 'Uma Unrota']) {
    assert.ok(!body.includes(name), `shift name "${name}" never renders (surveillance boundary)`);
  }
});

// ---------------- (2) the combined coverage-vs-required heatmap ----------------

test('heatmap: derived-requirement arithmetic hand-pinned; captioned as a derivation, not a rota standard; ONLINE + June-hole caveats', () => {
  const db = makeDb();
  seedKpiWeek(db); // budget inputs: Σ salaried £1,400 + 22.4% × £21,000 net = £6,104.00
  const lh = db.prepare(`INSERT INTO labour_hourly (business_date, hour, actual_minutes, actual_cost_pence) VALUES (?,?,?,?)`);
  lh.run('2026-07-13', 12, 240, 500000); // Mon 12:00 — £5,000 TRUE staffed
  lh.run('2026-07-17', 12, 60, 100000);  // Fri 12:00 — £1,000 TRUE staffed (no demand there)
  db.prepare(`INSERT INTO sales_channel_map_api VALUES ('LOCAL','Local','NONE','EAT IN',1,1,'operator'), ('online','Online','DELIVERY','ONLINE ORDER',1,1,'operator')`).run();
  const rc = db.prepare(`INSERT INTO sales_receipts_api (receipt_id, business_date, type, cancelled, account_profile_code, net_without_tax_pence) VALUES (?,?,NULL,0,?,?)`);
  const ln = db.prepare(`INSERT INTO sales_receipt_lines_api (receipt_id, line_id, business_date, net_without_tax_pence, accounting_group, time_of_sale_ms) VALUES (?,?,?,?,NULL,?)`);
  const msMon = Date.UTC(2026, 6, 13, 11, 30); // London 12:30 BST → hour 12
  const msFri = Date.UTC(2026, 6, 17, 18, 30); // London 19:30 BST → hour 19
  rc.run('RA', '2026-07-13', 'LOCAL', 450000); ln.run('RA', '1', '2026-07-13', 450000, msMon); // 75% share
  rc.run('RB', '2026-07-17', 'LOCAL', 150000); ln.run('RB', '1', '2026-07-17', 150000, msFri); // 25% share
  rc.run('RC', '2026-07-17', 'online', 99999); ln.run('RC', '1', '2026-07-17', 99999, msFri);  // ONLINE — excluded
  const body = renderTab(db, { tab: 'coverage' });
  // required = demand share × £6,104.00: Mon-12 = 75% → £4,578.00; Fri-19 = 25% → £1,526.00
  assert.ok(body.includes('Mon 12:00 — staffed £5,000.00 vs required £4,578.00 (Δ +£422.00)'), 'Mon 12: staffed vs derived requirement, hand-computed');
  assert.ok(body.includes('Fri 19:00 — staffed £0.00 vs required £1,526.00 (Δ −£1,526.00)'), 'Fri 19: a recorded Friday with nobody on — a real £0, demand unmet');
  assert.ok(body.includes('Fri 12:00 — staffed £1,000.00 vs required £0.00 (Δ +£1,000.00)'), 'Fri 12: staffed with no demand share');
  // the ramp centres on balanced: +£422 (≤ ⅓·maxAbs) → 4; +£1,000 → 5; −£1,526 (the extreme) → 1
  assert.ok(body.includes('r-l4" data-tip="Mon 12:00'), 'near-balanced overstaffing = level 4');
  assert.ok(body.includes('r-l5" data-tip="Fri 12:00'), 'clear overstaffing = level 5');
  assert.ok(body.includes('r-l1" data-tip="Fri 19:00'), 'the deepest understaffing = level 1');
  assert.equal((body.match(/r-cell r-l/g) || []).length, 3, 'exactly the 3 computed cells carry a level — every other cell is a blank frame, never a fake zero');
  assert.ok(body.includes('a derivation, not a rota standard'), 'the required side is captioned as DERIVED');
  assert.ok(body.includes('£6,104.00') && body.includes('7 intersection day(s)'), 'the budget basis is named with its window');
  assert.ok(body.includes('£999.99 ONLINE excluded — no true hour'), 'the ONLINE exclusion is stated with its £');
  assert.ok(body.includes('26 of 28 day(s) carry no hourly labour record'), 'missing staffing days counted');
  assert.ok(body.includes('June 2026 hole') && body.includes('never zero'), 'the June-hole caveat, never bridged');
  assert.ok(body.includes('no department key (checked)'), 'the site-level staffing basis is stated');
  assert.ok(body.includes('ABSORBED the old staffing-shape panel'), 'the one-home absorption is recorded on-panel');
});

// ---------------- (3) the CLASS-based boundary, pinned BOTH directions ----------------

test('surveillance boundary is CLASS-based: a behavioural pattern (same name, 3 late shifts) NEVER renders; the SAME name in a WTR flag DOES', () => {
  const db = makeDb();
  seedKpiWeek(db);
  // the behavioural-pattern decoy — the mock's People queue would rank this person
  seedShift(db, '2026-07-14', 7, 'Pat Pattern', 480, 540, 60, 1200);
  seedShift(db, '2026-07-15', 7, 'Pat Pattern', 480, 545, 65, 1200);
  seedShift(db, '2026-07-16', 7, 'Pat Pattern', 480, 550, 70, 1200);
  const before = renderTab(db, { tab: 'coverage' });
  assert.ok(!before.includes('Pat Pattern'), 'the behavioural pattern NEVER renders as a queue row — only the aggregate count');
  assert.match(before, /Late \/ short shifts<\/div><div class="r-kpi-value">3</, 'the pattern surfaces ONLY as the aggregate late/short count');
  assert.ok(before.includes('per-person behavioural queues are excluded by the surveillance-boundary ruling; attendance renders as aggregates above.'), 'the exclusion line is present verbatim');
  // the SAME name entering a ruled-IN class (regulatory) — now it renders, as that class
  db.prepare(`INSERT INTO labour_wtr_flags VALUES ('2026-07-14', 7, 'Pat Pattern', 'day_over_8h', 'd', 1)`).run();
  db.prepare(`INSERT INTO labour_rate_parity VALUES (9, 'Ciaran Elder', 1, 'FOH', 'role_rate_mismatch', '£12.25/h', '£12.75/h', 1)`).run();
  db.prepare(`UPDATE labour_day SET unmapped_names = '["Una Mapped"]' WHERE business_date = '2026-07-19'`).run();
  const after = renderTab(db, { tab: 'coverage' });
  assert.equal((after.match(/Pat Pattern/g) || []).length, 1, 'the name renders EXACTLY once — the WTR table row, never a behavioural queue');
  assert.ok(after.includes('regulatory — WTR 1998'), 'the regulatory class is labelled');
  assert.ok(after.includes('Ciaran Elder') && after.includes('payroll correctness'), 'the payroll class renders with its label');
  assert.ok(after.includes('Una Mapped') && after.includes('data hygiene'), 'the hygiene class renders with its label');
  assert.ok(after.includes('per-person behavioural queues are excluded by the surveillance-boundary ruling'), 'the exclusion line survives alongside the compliant classes');
});

// ---------------- (4) people & compliance ratios ----------------

test('ratios: adherence / WTR streak / parity-clean / unmapped share / staffing-per-open-hour — hand-computed, site-level captioned', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedShift(db, '2026-07-14', 1, 'Ann Shift', 480, 570, 90, 1200);
  seedShift(db, '2026-07-14', 2, 'Ben Shift', 480, 510, 30, 1200);
  seedShift(db, '2026-07-16', 3, 'Cal Shift', 480, 420, -60, 1200);
  seedShift(db, '2026-07-17', 4, 'Dee Shift', 480, 465, -15, 1200); // boundary — within
  seedShift(db, '2026-07-17', 5, 'Erin Shift', 480, 470, -10, 1200);
  db.prepare(`INSERT INTO labour_wtr_flags VALUES ('2026-06-30', 9, 'Rio Alexander', 'day_over_8h', 'd', 1)`).run();
  db.prepare(`INSERT INTO labour_rate_parity VALUES (5, 'Erin Shift', 1, 'FOH', 'role_rate_mismatch', '£12.25/h', '£12.75/h', 1)`).run();
  db.prepare(`UPDATE labour_day SET unmapped_actual_minutes = 150`).run(); // 150 × 7 = 1,050 of 21,000 min
  db.prepare(`INSERT INTO labour_hourly (business_date, hour, actual_minutes, actual_cost_pence) VALUES ('2026-07-18', 12, 120, 20000), ('2026-07-18', 13, 60, 10000)`).run();
  const body = renderTab(db, { tab: 'coverage' });
  assert.match(body, /Schedule adherence<\/small><strong>40\.0%<\/strong>/, 'adherence = 2 of 5 within ±15 (the −15 boundary is within)');
  assert.match(body, /WTR-clean weeks streak<\/small><strong>2 wk\(s\)<\/strong>/, 'streak = full weeks since the last flag week (w/c 06-29 → w/c 07-13)');
  assert.match(body, /Parity-clean staff<\/small><strong>80\.0%<\/strong>/, 'parity-clean = 1 − 1 flagged ÷ 5 roster names');
  assert.ok(body.includes('PROXY roster, stated'), 'the proxy denominator is stated, not smuggled');
  assert.match(body, /Unmapped-minutes share<\/small><strong>5\.0%<\/strong>/, 'unmapped share = 1,050 ÷ 21,000 worked minutes');
  assert.match(body, /Staffing per open hour<\/small><strong>1\.5<\/strong>/, 'staffing per open hour = 3.0h ÷ 2 staffed hour slots');
  assert.ok(body.includes('no person keys'), 'the aggregate pledge is on-panel');
  assert.ok(body.includes('labour_shifts and labour_hourly carry no department key (checked)'), 'the site-level basis is stated');
  // the staffing-only heat fallback: demand wire empty here — the reason is named, honestly
  assert.ok(body.includes('STAFFING ONLY') && body.includes('no timed per-receipt line record'), 'required-side gap named');
  assert.ok(!body.includes('no settled sales∩labour week'), 'the budget IS derivable here — only the true blocker is claimed');
});

// ---------------- (5) the today-live strip ----------------

test('today-live intraday strip renders ABOVE the KPI strip — operational coverage, its ruled home', () => {
  const db = makeDb();
  seedKpiWeek(db);
  db.prepare(`INSERT INTO labour_intraday VALUES ('2026-07-23', 'kitchen', ?, 960, 20000, 300, 6000, 0, '[{"name":"Dana Onclock","since_ms":1784790000000}]', '[]', NULL, NULL, NULL, NULL, 1)`).run(NOW - 600000);
  db.prepare(`INSERT INTO labour_intraday VALUES ('2026-07-23', 'foh', ?, 700, 15000, 200, 4000, 0, '[]', '[]', NULL, NULL, NULL, NULL, 1)`).run(NOW - 600000);
  const body = renderTab(db, { tab: 'coverage' });
  assert.ok(body.includes('Today — live'), 'the strip is present');
  assert.ok(body.indexOf('Today — live') < body.indexOf('class="r-grid r-kpi-grid"'), 'and it sits ABOVE the KPI strip');
  assert.ok(body.includes('partial-day figures, never a day result'), 'the partial-day honesty holds');
  assert.ok(body.includes('Dana Onclock'), 'who is on the clock NOW renders — live operational coverage, not behavioural history');
});

// ---------------- (6) the centre is complete ----------------

test('NO pending banner remains on ANY of the six tabs — the centre is complete', () => {
  const db = makeDb();
  seedKpiWeek(db);
  for (const tabKey of ['executive', 'forecast', 'rota', 'kitchen', 'foh', 'coverage']) {
    const body = renderTab(db, { tab: tabKey });
    assert.ok(!body.includes('PENDING'), `${tabKey}: no pending note`);
    assert.ok(!body.includes('banner amber'), `${tabKey}: no pending banner class`);
  }
});

// ---------------- (7) empty DB ----------------

test('empty DB (all tables present, zero rows): honest states, zero £ data values, canon cards still render', () => {
  const db = makeDb();
  for (const tabKey of ['executive', 'forecast', 'rota', 'kitchen', 'foh', 'coverage']) {
    const body = renderTab(db, { tab: tabKey });
    assert.ok(!/NaN|Infinity|undefined/.test(body), `${tabKey}: no fabricated value`);
    assert.ok(!/£\d[\d,]*\.\d{2}/.test(body), `${tabKey}: no £ data value invented from an empty DB`);
  }
  const cov = renderTab(db, { tab: 'coverage' });
  assert.ok(cov.includes('labour_hourly is empty'), 'the heatmap names its staffing blocker');
  assert.ok(cov.includes('No settled labour-day record yet'), 'the KPI strip names its wire');
  assert.ok(cov.includes('per-person behavioural queues are excluded by the surveillance-boundary ruling'), 'the exclusion line holds even empty');
  assert.ok(cov.includes('Labour accounting rules') && cov.includes('1.159') && cov.includes('£45 materiality'), 'the canon card renders (rulings, not data)');
  assert.ok(cov.includes('RotaCloud') && cov.includes('Lightspeed') && cov.includes('OpenTable') && cov.includes('QuickBooks'), 'the four data-architecture cards render (definitional)');
  assert.ok(cov.includes('NOT covers'), 'the covers no-fabrication ruling is stated in the architecture card');
});
