'use strict';

// Labour Centre L1 — the six-tab shell on /coyote/labour (the operator ruled the centre takes
// the route), EXECUTIVE + ROTA VS ACTUAL built to the mock. (L2 built forecast/kitchen/foh —
// proofs in mission-control-labour-centre-l2.test.js; L3 built coverage — proofs in
// mission-control-labour-centre-l3.test.js; this file keeps the shell, the L1 tabs, and the
// cross-tab NO-NAMES / empty-DB boundary controls.) Honesty under test:
//   • TRUE ruler (labour_day: locked rates × 1.159 burden + salaried/365) everywhere on the
//     built tabs; RC-screen renders ONLY inside the cost-definition translation card;
//   • formula budget = salaried + 22.4% × net (K 14.3% + F 8.1%), OVER only beyond the ruled
//     £45 materiality — arithmetic hand-computed in the fixtures;
//   • cross-ruler % / SPLH over the sales∩labour INTERSECTION days only;
//   • the June hole renders as GAPS with the Leon Mackay caption — never bridged/interpolated;
//   • NO-NAMES negative control: labour_shifts.user_name never renders on ANY tab (the
//     surveillance-boundary ruling);
//   • empty DB → honest states, zero fabricated £ values.

const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite = require('node:sqlite');

const DATA = require('../mission-control/ui/data.js');
const labour = require('../mission-control/ui/pages/coyote/labour.js');

const NOW = 1784800000000;

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
  `);
  return db;
}

function ctxFor(db, query) {
  return { q: (sql, p) => DATA.safeSelect(db, sql, p), now: NOW, halt: { halted: false }, query: query || {} };
}
function renderTab(db, query) {
  const ctx = ctxFor(db, query);
  return labour.render(labour.getSection(db, ctx), ctx).body;
}

// One full Mon–Sun week (2026-07-13 → 2026-07-19, max = the Sunday): per day net £3,000,
// TRUE actual £900 (salaried £200 inside), scheduled £850, 50h worked, 50.8h paid.
function seedKpiWeek(db) {
  const sd = db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence) VALUES (?, 300000)`);
  const ld = db.prepare(`INSERT INTO labour_day (business_date, scheduled_minutes, actual_minutes, actual_paid_minutes, scheduled_cost_pence, actual_cost_pence, salaried_cost_pence, unmapped_names) VALUES (?, 3100, 3000, 3050, 85000, 90000, 20000, '[]')`);
  for (let i = 13; i <= 19; i++) { sd.run(`2026-07-${i}`); ld.run(`2026-07-${i}`); }
}

// ---------------- shell + nav ----------------

test('shell: six tabs on the ONE route, executive default, ?tab= switches; title = the centre', () => {
  const db = makeDb();
  assert.equal(labour.route, '/coyote/labour', 'the centre TAKES the existing route (operator ruling)');
  assert.equal(labour.title, 'Labour');
  assert.match(labour.sub, /TRUE/, 'the sub names the TRUE-ruler basis');
  const body = renderTab(db);
  for (const label of ['Executive', 'Labour Forecast', 'Rota vs Actual', 'Kitchen', 'Front of House', 'Coverage &amp; People']) {
    assert.ok(body.includes(label), `tab ${label} present`);
  }
  assert.match(body, /class="r-tab active" href="\/coyote\/labour\?tab=executive"/, 'executive is the default tab');
  const rota = renderTab(db, { tab: 'rota' });
  assert.match(rota, /class="r-tab active" href="\/coyote\/labour\?tab=rota"/, '?tab=rota activates');
  assert.match(renderTab(db, { tab: 'nonsense' }), /class="r-tab active" href="\/coyote\/labour\?tab=executive"/, 'an unknown tab falls back to executive');
});

test('nav move: labour lives in the Reports group AFTER reservations; Departments no longer holds it', () => {
  const S = require('../mission-control/ui/shared.js');
  const coyote = S.WORKSPACES.find((w) => w.key === 'coyote');
  const reports = coyote.groups.find((g) => g.group === 'Reports');
  assert.deepEqual(reports.items.map((i) => i.key), ['revenue', 'report-library', 'rota-review', 'reservations', 'labour'], 'Reports order — labour after reservations');
  const labItem = reports.items[4];
  assert.equal(labItem.label, 'Labour');
  assert.equal(labItem.route, '/coyote/labour', 'same route — no redirect needed');
  const depts = coyote.groups.find((g) => g.group === 'Departments');
  assert.deepEqual(depts.items.map((i) => i.key), ['recipes', 'reviews', 'issues'], 'Departments without labour');
});

// ---------------- executive ----------------

test('executive KPI strip: hand-computed TRUE arithmetic — labour %, formula budget delta, SPLH, OT, sched-vs-actual, salaried share', () => {
  const db = makeDb();
  seedKpiWeek(db);
  // OT shifts: +90, +30, −60 → Σ positive = 120min = 2.0h
  const sh = db.prepare(`INSERT INTO labour_shifts (business_date, user_id, user_name, sched_minutes, act_minutes, variance_minutes, rate_pence) VALUES (?,?,?,?,?,?,?)`);
  sh.run('2026-07-14', 1, 'Shift Person A', 480, 570, 90, 1200);
  sh.run('2026-07-15', 2, 'Shift Person B', 480, 510, 30, 1200);
  sh.run('2026-07-16', 3, 'Shift Person C', 480, 420, -60, 1200);
  const body = renderTab(db);
  // week: net £21,000 · TRUE £6,300 → 30.0%; budget % = (1400 + 0.224×21000)/21000 = 29.1%
  assert.ok(body.includes('30.0%'), 'labour % of net = TRUE ÷ net over the intersection');
  assert.ok(body.includes('+0.9pp vs formula 29.1%'), 'delta vs the hand-computed formula budget %');
  assert.ok(body.includes('£6,300.00'), 'labour £/week — TRUE all-in');
  assert.ok(body.includes('£60.00'), 'SPLH = £21,000 ÷ 350h intersection hours');
  assert.ok(body.includes('2.0h'), 'overtime = Σ positive variance minutes only');
  assert.ok(body.includes('+£350.00'), 'scheduled-vs-actual £ (TRUE-basis approx)');
  assert.ok(body.includes('22.2%'), 'salaried share = 140000 ÷ 630000');
  assert.ok(body.includes('7 intersection day(s)'), 'the intersection day-count is labelled');
  assert.ok(body.includes('TRUE all-in'), 'the ruler is captioned');
  assert.ok(body.includes('2026-07-13') && body.includes('2026-07-19'), 'the last full Mon–Sun window is named');
});

test('executive department control: variable TRUE (dept × burden) vs the ruled dept splits, £45-classed chips', () => {
  const db = makeDb();
  seedKpiWeek(db);
  const ld = db.prepare(`INSERT INTO labour_dept (business_date, department, sched_minutes, act_minutes, sched_cost_rc_pence, act_cost_rc_pence, rc_uncosted_sched_min, rc_uncosted_act_min, rc_uncosted_names) VALUES (?,?,?,?,?,?,0,0,'[]')`);
  for (let i = 13; i <= 19; i++) {
    ld.run(`2026-07-${i}`, 'kitchen', 1500, 1500, 40000, 40000);
    ld.run(`2026-07-${i}`, 'foh', 700, 700, 20000, 20000);
  }
  const body = renderTab(db);
  // kitchen: 280000 × 1.159 = £3,245.20 vs 14.3% × £21,000 = £3,003.00 → +£242.20 OVER (>£45)
  assert.ok(body.includes('£3,245.20'), 'kitchen variable TRUE = RC hourly × 1.159');
  assert.ok(body.includes('£3,003.00'), 'kitchen budget = 14.3% × intersection net');
  assert.ok(body.includes('OVER £242.20'), 'kitchen chip OVER beyond the £45 materiality');
  // foh: 140000 × 1.159 = £1,622.60 vs 8.1% × £21,000 = £1,701.00 → −£78.40 UNDER
  assert.ok(body.includes('£1,622.60') && body.includes('£1,701.00'), 'FOH both sides');
  assert.ok(body.includes('UNDER budget'), 'FOH under');
  assert.ok(body.includes('salaried') && body.includes('cancels'), 'the salaried-cancels basis is captioned');
  assert.ok(body.includes('no department key'), 'senior-mix omission is stated, not silent');
});

test('executive 13-week trend: June-hole weeks render as GAPS with the Leon Mackay caption, never interpolated', () => {
  const db = makeDb();
  // two islands: w/c 2026-05-25 (30%) and w/c 2026-07-13 (25%); the whole of June = no rows
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence) VALUES ('2026-05-25', 100000), ('2026-07-13', 100000)`).run();
  db.prepare(`INSERT INTO labour_day (business_date, actual_cost_pence, salaried_cost_pence) VALUES
    ('2026-05-25', 30000, 0), ('2026-07-13', 25000, 0), ('2026-07-19', 1000, 0)`).run();
  const body = renderTab(db);
  assert.ok(body.includes('render as GAPS'), 'gap weeks are declared');
  assert.ok(body.includes('June 2026 hole') && body.includes('Leon Mackay'), 'the known hole is named with its blocker');
  assert.ok(body.includes('never bridged'), 'the no-bridging rule is stated');
  const svg = body.match(/aria-label="Thirteen-week labour control trend"[\s\S]*?<\/svg>/);
  assert.ok(svg, 'trend svg renders');
  assert.ok(!svg[0].includes('<polyline'), 'isolated weeks stay isolated points — NO line crosses the hole');
  assert.ok(svg[0].includes('<circle'), 'the real weeks render as points');
});

test('executive attention queue: seeded verdicts £-valued with the Rota Review pointer; WTR/parity/unmapped counted', () => {
  const db = makeDb();
  seedKpiWeek(db);
  db.prepare(`UPDATE labour_day SET unmapped_names = '["Una Mapped"]' WHERE business_date = '2026-07-19'`).run();
  const rep = (verdicts) => JSON.stringify({ weekMonday: '2026-07-13', verdicts, items: [], mixNotes: {}, gaps: [] });
  const ins = db.prepare(`INSERT INTO rota_review_runs (mode, week_monday, ran_at, status, trigger, report_json) VALUES (?,?,?,?,?,?)`);
  ins.run('forward', '2026-07-13', NOW - 3600000, 'ok', 'thursday', rep([{ dept: 'kitchen', deltaPence: 18500, budgetPence: 441500, salariedPence: 78239 }]));
  ins.run('hindsight', '2026-07-13', NOW - 7200000, 'ok', 'monday', rep([{ dept: 'foh', deltaPence: -5000, budgetPence: 300000, salariedPence: 143255 }]));
  db.prepare(`INSERT INTO labour_wtr_flags VALUES ('2026-07-14', 1, 'Rio Alexander', 'day_over_8h', 'd', 1), ('2026-07-15', 1, 'Rio Alexander', 'night_22_24', 'n', 1)`).run();
  db.prepare(`INSERT INTO labour_rate_parity VALUES (9, 'Ciaran Elder', 1, 'FOH', 'role_rate_mismatch', '£12.25/h', '£12.75/h', 1)`).run();
  const body = renderTab(db);
  assert.ok(body.includes('KITCHEN — FORWARD w/c 2026-07-13'), 'verdict titled with dept + mode + week');
  assert.ok(body.includes('£185.00 OVER'), 'the £ delta');
  assert.match(body, /r-alert bad[\s\S]{0,400}KITCHEN — FORWARD/, 'over-materiality verdict = bad tone');
  assert.ok(body.includes('FOH — HINDSIGHT w/c 2026-07-13') && body.includes('£50.00 under'), 'under verdict too');
  assert.ok(body.includes('£4,415.00'), 'the formula budget is named');
  assert.ok(body.includes('href="/coyote/rota-review"') && body.includes('Rota Review report'), 'action pointer to the receipts');
  assert.ok(body.includes('2 flag(s)'), 'WTR count');
  assert.ok(body.includes('1 finding(s)'), 'rate-parity count');
  assert.ok(body.includes('Una Mapped'), 'unmapped-shift names surfaced (data hygiene — ruled compliant)');
  assert.ok(body.includes('EXCLUDED BY RULING'), 'the People queue exclusion is recorded on-panel');
});

test('executive variance bridge: hand-computed decomposition + an honestly-labelled remainder, no person keys', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO labour_day (business_date, scheduled_cost_pence, actual_cost_pence, salaried_cost_pence) VALUES ('2026-07-19', 100000, 120000, 0)`).run();
  const sh = db.prepare(`INSERT INTO labour_shifts (business_date, user_id, user_name, sched_minutes, act_minutes, variance_minutes, rate_pence) VALUES (?,?,?,?,?,?,?)`);
  sh.run('2026-07-19', 1, 'Bridge Person A', 480, 540, 60, 1200);   // matched over-run: 1200p × 1.159 = £13.91
  sh.run('2026-07-19', 2, 'Bridge Person B', null, 300, null, 1000); // unrota'd: 5000p × 1.159 = £57.95
  sh.run('2026-07-19', 3, 'Bridge Person C', 240, null, null, 1000); // not worked: −4000p × 1.159 = −£46.36
  // dept rate mix: kitchen 20p/min rota'd → 22p/min worked over 540min = 1080p × 1.159 = £12.52
  db.prepare(`INSERT INTO labour_dept (business_date, department, sched_minutes, act_minutes, sched_cost_rc_pence, act_cost_rc_pence, rc_uncosted_sched_min, rc_uncosted_act_min, rc_uncosted_names) VALUES ('2026-07-19','kitchen',480,540,9600,11880,0,0,'[]')`).run();
  const body = renderTab(db);
  assert.ok(body.includes('£1,000.00') && body.includes('£1,200.00'), 'endpoints: scheduled → actual TRUE');
  assert.ok(body.includes('+£13.91'), 'hours variance at locked rate × burden');
  assert.ok(body.includes('+£57.95'), 'unrota&#39;d worked shifts');
  assert.ok(body.includes('−£46.36'), 'rota&#39;d not worked');
  assert.ok(body.includes('+£12.52'), 'dept-level rate-mix effect');
  // remainder = 20000 − (1391 + 5795 − 4636 + 1252) = 16198
  assert.ok(body.includes('+£161.98'), 'the remainder is a labelled figure, never hidden');
  assert.ok(body.includes('never hidden'), 'remainder honesty label');
  assert.ok(body.includes('no person keys'), 'aggregate-only pledge on the panel');
  assert.ok(!body.includes('Bridge Person'), 'and indeed no shift name renders');
});

test('executive daily control strip: ruled chips at the £45 boundary; absent labour day = honest cell', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO sales_day (business_date, net_sales_pence) VALUES ('2026-07-17', 100000), ('2026-07-18', 100000), ('2026-07-19', 100000)`).run();
  // budget/day = 20000 + round(0.224 × 100000) = 42400
  db.prepare(`INSERT INTO labour_day (business_date, actual_cost_pence, salaried_cost_pence, actual_minutes) VALUES
    ('2026-07-18', 46900, 20000, 600), ('2026-07-19', 47000, 20000, 600)`).run();
  const body = renderTab(db);
  assert.ok(body.includes('On formula'), 'delta £45.00 exactly = ON formula (materiality is a strict >)');
  assert.ok(!body.includes('Over £45.00'), 'the boundary itself never reads OVER');
  assert.ok(body.includes('Over £46.00'), 'delta £46.00 = OVER, £-valued');
  assert.ok(body.includes('no labour record'), 'the sales-only day says so — never zeros');
  assert.ok(body.includes('salaried + 22.4% × net'), 'the daily budget formula is captioned');
});

// ---------------- rota vs actual ----------------

function seedRota(db) {
  // OR IGNORE: the NO-NAMES test layers this over seedKpiWeek, which already owns 2026-07-19.
  db.prepare(`INSERT OR IGNORE INTO labour_day (business_date, scheduled_minutes, actual_minutes, actual_paid_minutes, scheduled_cost_pence, actual_cost_pence, salaried_cost_pence) VALUES ('2026-07-19', 960, 1050, 1060, 50000, 60000, 15000)`).run();
  const sh = db.prepare(`INSERT INTO labour_shifts (business_date, user_id, user_name, sched_minutes, act_minutes, variance_minutes, rate_pence) VALUES (?,?,?,?,?,?,?)`);
  sh.run('2026-07-15', 1, 'Rota Person A', 480, 540, 60, 1200);  // over-rota'd +60
  sh.run('2026-07-16', 2, 'Rota Person B', 480, 510, 30, 1200);  // over-rota'd +30
  sh.run('2026-07-15', 3, 'Rota Person C', null, 300, null, 1000); // unrota'd 300
  sh.run('2026-07-17', 4, 'Rota Person D', 240, 90, -150, 1000);   // under-worked 150
  sh.run('2026-07-18', 5, 'Rota Person E', 120, null, null, 1000); // rota'd, not worked 120
  sh.run('2026-07-14', 6, 'Rota Person F', 480, 470, -10, 1000);   // within ±15 → accuracy + under 10
}

test('rota vs actual: variance decomposition — over/unrota\'d/under seeded, aggregate, timestamps-gap stated', () => {
  const db = makeDb();
  seedRota(db);
  const body = renderTab(db, { tab: 'rota' });
  assert.ok(body.includes('Where the extra hours came from'), 'panel present');
  assert.ok(body.includes('2 · 1.5h'), `over-rota'd: 2 shifts, +90min`);
  assert.ok(body.includes('1 · 5.0h'), `unrota'd worked: 1 shift, 300min`);
  assert.ok(body.includes('3 · 4.7h'), 'under-worked: 150 + 120 + 10 = 280min across 3 shifts');
  assert.ok(body.includes('CANNOT be split'), 'early-in vs late-out honestly not claimable (no per-shift timestamps)');
  assert.ok(body.includes('no department key'), 'site-level basis stated');
  assert.ok(body.includes('NO names'), 'the surveillance boundary named on-panel');
});

test('rota vs actual: daily reconciliation — sched/actual/paid + Δ£ with the ruled chip; absent days stated', () => {
  const db = makeDb();
  seedRota(db);
  const body = renderTab(db, { tab: 'rota' });
  assert.ok(body.includes('16.0h'), 'sched hrs (960)');
  assert.ok(body.includes('17.5h'), 'actual hrs (1050)');
  assert.ok(body.includes('17.7h'), 'PAID hrs (actual_paid_minutes 1060) — its own column');
  assert.ok(body.includes('£500.00') && body.includes('£600.00'), 'TRUE sched £ and actual £');
  assert.ok(body.includes('Over sched £100.00'), 'Δ beyond £45 → OVER, £-valued');
  assert.ok(body.includes('ABSENT row, never zeros'), 'missing days stated');
  assert.ok(body.includes('no labour_day record'), 'the hours chart declares its absent days');
});

test('rota vs actual: schedule accuracy is SITE-level (labour_shifts has no dept key — checked) + dept hours from labour_dept', () => {
  const db = makeDb();
  seedRota(db);
  db.prepare(`INSERT INTO labour_dept (business_date, department, sched_minutes, act_minutes, sched_cost_rc_pence, act_cost_rc_pence, rc_uncosted_sched_min, rc_uncosted_act_min, rc_uncosted_names) VALUES
    ('2026-07-19','kitchen',600,660,20000,22000,0,0,'[]'), ('2026-07-19','foh',360,390,10000,11000,0,0,'[]')`).run();
  const body = renderTab(db, { tab: 'rota' });
  assert.ok(body.includes('20.0%'), '1 of 5 rota\'d shifts within ±15min');
  assert.ok(body.includes('SITE-level'), 'the site-level basis is loud');
  assert.ok(body.includes('no department key'), 'and the reason is named');
  assert.ok(body.includes('Kitchen') && body.includes('Front of House'), 'dept hours rows (labour_dept minute grain)');
  assert.ok(body.includes('+10.0%'), 'kitchen hours deviation 600→660');
});

test('rota vs actual: cost-definition reconciliation — RC-screen vs TRUE side by side, the live-rates ruling verbatim', () => {
  const db = makeDb();
  seedRota(db);
  db.prepare(`INSERT INTO labour_dept (business_date, department, sched_minutes, act_minutes, sched_cost_rc_pence, act_cost_rc_pence, rc_uncosted_sched_min, rc_uncosted_act_min, rc_uncosted_names) VALUES
    ('2026-07-19','kitchen',600,660,28000,30000,0,120,'[]'), ('2026-07-19','foh',360,390,19000,20000,0,0,'[]')`).run();
  const body = renderTab(db, { tab: 'rota' });
  assert.ok(body.includes('RC-screen (pre-burden)'), 'the RC column is labelled as the other ruler');
  assert.ok(body.includes('TRUE (operating truth)'), 'the TRUE column');
  assert.ok(body.includes('£500.00') && body.includes('£600.00'), 'RC actual £500 vs TRUE actual £600 for the week');
  assert.ok(body.includes('+£100.00'), 'the delta is a figure');
  assert.ok(body.includes('×1.159 employer burden') && body.includes('salaried/365'), 'the delta is EXPLAINED');
  assert.ok(body.includes('RC screens recomputed from LIVE rates, never cached'), 'the standing ruling, verbatim');
  assert.ok(body.includes('2.0h') && body.includes('uncosted in RC'), 'RC-uncosted minutes surfaced');
});

// ---------------- L2-built tabs + boundaries ----------------

test('L3 complete: NO tab carries a pending banner — the centre is fully built (coverage proofs live in the L3 file)', () => {
  const db = makeDb();
  seedKpiWeek(db);
  for (const tabKey of ['executive', 'forecast', 'rota', 'kitchen', 'foh', 'coverage']) {
    const body = renderTab(db, { tab: tabKey });
    assert.ok(!body.includes('PENDING'), `${tabKey} carries no pending note (the centre is complete)`);
    assert.ok(!body.includes('banner amber'), `${tabKey} carries no pending banner class`);
  }
});

test('NO-NAMES negative control: labour_shifts.user_name NEVER renders on ANY tab (surveillance boundary)', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedRota(db);
  db.prepare(`INSERT INTO labour_shifts (business_date, user_id, user_name, sched_minutes, act_minutes, variance_minutes, rate_pence) VALUES ('2026-07-19', 99, 'Xavier Shiftname', 480, 600, 120, 1300)`).run();
  db.prepare(`INSERT INTO labour_wtr_flags VALUES ('2026-07-14', 1, 'Rio Alexander', 'day_over_8h', 'd', 1)`).run();
  db.prepare(`INSERT INTO labour_rate_parity VALUES (9, 'Ciaran Elder', 1, 'FOH', 'role_rate_mismatch', '£12.25/h', '£12.75/h', 1)`).run();
  db.prepare(`INSERT INTO labour_hourly (business_date, hour, actual_minutes) VALUES ('2026-07-19', 12, 300)`).run();
  for (const tabKey of ['executive', 'forecast', 'rota', 'kitchen', 'foh', 'coverage']) {
    const body = renderTab(db, { tab: tabKey });
    for (const name of ['Xavier Shiftname', 'Rota Person', 'Bridge Person', 'Shift Person']) {
      assert.ok(!body.includes(name), `${tabKey}: labour_shifts name "${name}" must never render`);
    }
  }
});

test('empty DB (tables present, zero rows): honest states on every tab, zero £ data values, no throw', () => {
  const db = makeDb();
  for (const tabKey of ['executive', 'forecast', 'rota', 'kitchen', 'foh', 'coverage']) {
    const body = renderTab(db, { tab: tabKey });
    assert.ok(!/NaN|Infinity|undefined/.test(body), `${tabKey}: no fabricated value`);
    assert.ok(!/£\d[\d,]*\.\d{2}/.test(body), `${tabKey}: no £ data value invented from an empty DB`);
  }
  assert.ok(renderTab(db).includes('No settled labour-day record yet'), 'executive names the wire + the ruler');
  assert.ok(renderTab(db, { tab: 'rota' }).includes('No settled labour-day record yet'), 'rota too');
  const stamp = labour.render(labour.getSection(db, ctxFor(db)), ctxFor(db)).stamp;
  assert.ok(stamp.includes('awaiting labour-day record'), 'the stamp never claims freshness without data');
});

test('no-clock ruling captions (2026-07-21): SPLH strip, coverage heatmap and the drift decomposition each state the rota-as-worked proxy', () => {
  const db = makeDb();
  seedKpiWeek(db);
  seedRota(db);
  const exec = renderTab(db);
  assert.match(exec, /SPLH denominator\) include rota-as-worked for no-clock salaried/, 'the Executive strip caption');
  const rota = renderTab(db, { tab: 'rota' });
  assert.match(rota, /their variance is 0 by construction, so they never appear here/, 'the decomposition states WHY deemed staff are absent from variance classes');
  // the heatmap needs staffing rows to render either branch (empty grid = no caption to carry)
  db.prepare(`INSERT INTO labour_hourly (business_date, hour, actual_minutes, actual_cost_pence) VALUES ('2026-07-18', 12, 120, 20000), ('2026-07-18', 13, 60, 10000)`).run();
  const cov = renderTab(db, { tab: 'coverage' });
  assert.match(cov, /staffed hours include rota-as-worked for no-clock salaried/, 'the heatmap actual line (either branch)');
});
