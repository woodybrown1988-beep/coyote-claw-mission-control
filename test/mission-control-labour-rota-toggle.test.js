'use strict';

// Labour Centre — Rota vs Actual HOURS | COSTS toggle (client-only, COSTS default).
// Pairs with the cc ruling (PR #88): deemed (no-clock) staff rows in labour_shifts carry
// rate_pence from 2026-07-21 with act = sched and variance 0 on both axes; before that date
// their rate_pence is NULL (salaried era). Clocked salaried staff have rate_pence NULL always.
// Honesty under test:
//   • both datasets render SERVER-side; the page script swaps visibility via classList only —
//     no fetch, no state; COSTS active by default (hours panes ship hidden);
//   • COSTS daily chart = labour_day TRUE £ (day grain, salaried INCLUDED) — day totals are
//     the fixture values EXACTLY; the Σ footer states the labour_day source identity;
//   • COSTS decomposition prices each class's minutes at the shift's OWN rate_pence × 1.159
//     (shift grain), keeping counts + hours alongside the £ (rate mix stays readable);
//   • NEGATIVE CONTROL: hours-mode markup is byte-identical to the pre-change render — the
//     exact pre-change literals are pinned below and the hours panes carry ZERO £ data;
//   • a deemed-era shift (rate 1692, act = sched) contributes 0 to every variance class in
//     BOTH modes; a clocked salaried shift (rate NULL) counts its hours but prices £0;
//   • every served <script> parses (the template-literal incident class);
//   • empty DB → honest states, zero fabricated £ values; no names in either mode.

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

// Two labour_day days (Sat 18 + Sun 19 = maxDate) with hand-computable minutes AND TRUE £.
//   07-18: sched 800min/£400.00 · actual 700min/£300.00 (salaried £150 inside)
//   07-19: sched 960min/£500.00 · actual 1050min/£600.00 (salaried £150 inside)
function seedDays(db) {
  db.prepare(`INSERT INTO labour_day (business_date, scheduled_minutes, actual_minutes, actual_paid_minutes, scheduled_cost_pence, actual_cost_pence, salaried_cost_pence) VALUES
    ('2026-07-18', 800, 700, 700, 40000, 30000, 15000),
    ('2026-07-19', 960, 1050, 1060, 50000, 60000, 15000)`).run();
}
// Variance-class shifts, every one rated (the Pat Pattern no-names fixture):
//   over-rota'd:  +60min  @ 1200p/h → 1200p  × 1.159 = £13.91
//   unrota'd:      300min @ 1000p/h → 5000p  × 1.159 = £57.95
//   under-worked:  150 + 120 = 270min @ 1000p/h → 4500p × 1.159 = £52.16
function seedShifts(db) {
  const sh = db.prepare(`INSERT INTO labour_shifts (business_date, user_id, user_name, sched_minutes, act_minutes, variance_minutes, rate_pence) VALUES (?,?,?,?,?,?,?)`);
  sh.run('2026-07-15', 1, 'Pat Pattern', 480, 540, 60, 1200);
  sh.run('2026-07-15', 2, 'Pat Pattern Jr', null, 300, null, 1000);
  sh.run('2026-07-17', 3, 'Pat Pattern III', 240, 90, -150, 1000);
  sh.run('2026-07-18', 4, 'Pat Pattern IV', 120, null, null, 1000);
}

// The four dual-rendered mode panes split cleanly on the wrapper marker; order is
// hours-chart · costs-chart · hours-decomp · costs-decomp (the last segment runs on to the
// rest of the tab — containment asserts only there).
function modeSegs(body) {
  const segs = body.split('<div class="lbc-mode');
  assert.equal(segs.length, 5, 'four mode panes render (hours+costs × chart+decomposition)');
  return { hoursChart: segs[1], costsChart: segs[2], hoursDecomp: segs[3], costsDecompOn: segs[4] };
}

// ---------------- toggle shell ----------------

test('toggle shell: HOURS | COSTS segmented control above the daily chart, COSTS active by default, hours panes ship hidden', () => {
  const db = makeDb();
  seedDays(db); seedShifts(db);
  const body = renderTab(db, { tab: 'rota' });
  const seg = body.match(/<div class="lbc-seg" id="rv-mode"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(seg, 'the segmented control renders');
  assert.match(seg[0], /<button type="button" data-mode="hours">HOURS<\/button>/, 'HOURS button');
  assert.match(seg[0], /<button type="button" data-mode="costs" class="active">COSTS<\/button>/, 'COSTS button is the active default');
  assert.ok(body.indexOf('id="rv-mode"') < body.indexOf('<div class="lbc-pairs">'), 'the control sits ABOVE the daily chart');
  const s = modeSegs(body);
  assert.match(s.hoursChart, /^ lbc-hide" data-mode="hours">/, 'hours chart pane ships hidden (COSTS default)');
  assert.match(s.hoursDecomp, /^ lbc-hide" data-mode="hours">/, 'hours decomposition pane ships hidden');
  assert.match(s.costsChart, /^" data-mode="costs">/, 'costs chart pane ships visible');
  assert.match(s.costsDecompOn, /^" data-mode="costs">/, 'costs decomposition pane ships visible');
});

test('client-only discipline: the toggle script uses classList only — no fetch, no XHR, no storage, no innerHTML', () => {
  const db = makeDb();
  seedDays(db); seedShifts(db);
  const body = renderTab(db, { tab: 'rota' });
  const scripts = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  assert.ok(scripts.length >= 1, 'the rota tab ships the toggle script');
  for (const scr of scripts) {
    assert.ok(!/fetch|XMLHttpRequest|localStorage|sessionStorage|innerHTML|location\./.test(scr), 'no fetch/state/markup injection — classList visibility swap only');
    assert.match(scr, /classList\.toggle/, 'the swap is classList-driven');
  }
});

// ---------------- COSTS mode: daily chart ----------------

test('costs chart: paired TRUE £ bars are the labour_day fixture values EXACTLY; the ruler caption is the tab caption verbatim', () => {
  const db = makeDb();
  seedDays(db);
  const s = modeSegs(renderTab(db, { tab: 'rota' }));
  // heights: max pence 60000 → 07-18 sched 93px/act 70px · 07-19 sched 117px/act 140px
  assert.ok(s.costsChart.includes('<div class="lbc-bar sched" style="height:93px"></div><div class="lbc-bar act" style="height:70px"></div>'), '07-18 £ pair, hand-computed');
  assert.ok(s.costsChart.includes('<div class="lbc-bar sched" style="height:117px"></div><div class="lbc-bar act" style="height:140px"></div>'), '07-19 £ pair, hand-computed');
  assert.ok(s.costsChart.includes('title="Sat 2026-07-18 — rota&#39;d £400.00 · worked £300.00"'), '07-18 day totals = the labour_day fixture exactly');
  assert.ok(s.costsChart.includes('title="Sun 2026-07-19 — rota&#39;d £500.00 · worked £600.00"'), '07-19 day totals = the labour_day fixture exactly');
  assert.ok(s.costsChart.includes('TRUE all-in ruler (locked rates × 1.159 + salaried/365; deemed staff rota-priced from 2026-07-21) — matches the surrounding Labour Centre panels'), 'the ruler caption, verbatim');
  assert.ok(s.costsChart.includes('<b>12 day(s) have no labour_day record</b>'), 'absent days stated in costs mode too');
});

test('costs chart footer: Σ daily actual TRUE reconciles to labour_day — a source-identity line, not a second computation', () => {
  const db = makeDb();
  seedDays(db);
  const s = modeSegs(renderTab(db, { tab: 'rota' }));
  // Σ actual = 30000 + 60000 = £900.00
  assert.ok(s.costsChart.includes('Σ daily actual TRUE = £900.00 — reconciles to labour_day'), 'the reconciliation line with the exact Σ');
  assert.ok(s.costsChart.includes('it IS labour_day — the source identity'), 'the identity is stated, no independence pretended');
});

// ---------------- COSTS mode: decomposition ----------------

test('costs decomposition: each class priced at the shift\'s OWN rate × 1.159, £ + count + hours together; salaried-£0 and deemed captions', () => {
  const db = makeDb();
  seedDays(db); seedShifts(db);
  const s = modeSegs(renderTab(db, { tab: 'rota' }));
  assert.ok(s.costsDecompOn.includes('<div class="r-value">£13.91 · 1 · 1.0h</div>'), 'over-rota\'d: 60min × 1200p/h × 1.159');
  assert.ok(s.costsDecompOn.includes('<div class="r-value">£57.95 · 1 · 5.0h</div>'), 'unrota\'d: 300min × 1000p/h × 1.159');
  assert.ok(s.costsDecompOn.includes('<div class="r-value">£52.16 · 2 · 4.5h</div>'), 'under-worked: 270min × 1000p/h × 1.159 — count + hours kept beside the £ (rate mix readable)');
  assert.ok(s.costsDecompOn.includes('OWN locked rate_pence × 1.159 burden (shift grain)'), 'the shift-grain pricing basis is captioned');
  assert.ok(s.costsDecompOn.includes('salaried minutes carry no shift rate — priced £0 here; their cost is annual/365 at day grain'), 'the salaried-£0 rule, verbatim');
  assert.ok(s.costsDecompOn.includes('deemed staff: rota = actual by rule'), 'the deemed-staff zero-variance rule');
  assert.ok(s.costsDecompOn.includes('NO names'), 'the surveillance boundary holds in costs mode');
});

test('clocked salaried shift (rate_pence NULL): its hours COUNT in the class, its £ price ZERO — in the same row', () => {
  const db = makeDb();
  seedDays(db); seedShifts(db);
  // clocked salaried: NULL rate, over-rota'd by 120min → over becomes 2 shifts / 3.0h, £ UNCHANGED
  db.prepare(`INSERT INTO labour_shifts (business_date, user_id, user_name, sched_minutes, act_minutes, variance_minutes, rate_pence) VALUES ('2026-07-16', 9, 'Pat Pattern Sr', 480, 600, 120, NULL)`).run();
  const s = modeSegs(renderTab(db, { tab: 'rota' }));
  assert.ok(s.costsDecompOn.includes('<div class="r-value">£13.91 · 2 · 3.0h</div>'), 'costs mode: hours + count grew, the priced £ did not');
  assert.ok(s.hoursDecomp.includes('<div class="r-value">2 · 3.0h</div>'), 'hours mode counts the same minutes');
});

test('deemed-era shift (rate 1692, act = sched, variance 0): contributes 0 to every variance class in BOTH modes', () => {
  // (a) alongside the class fixture: every class figure is byte-identical before/after
  const db = makeDb();
  seedDays(db); seedShifts(db);
  const before = modeSegs(renderTab(db, { tab: 'rota' }));
  db.prepare(`INSERT INTO labour_shifts (business_date, user_id, user_name, sched_minutes, act_minutes, variance_minutes, rate_pence) VALUES ('2026-07-16', 8, 'Jordan Deemed', 510, 510, 0, 1692)`).run();
  const after = modeSegs(renderTab(db, { tab: 'rota' }));
  assert.equal(after.hoursDecomp, before.hoursDecomp, 'hours decomposition pane byte-identical — the deemed shift lands in no class');
  for (const v of ['£13.91 · 1 · 1.0h', '£57.95 · 1 · 5.0h', '£52.16 · 2 · 4.5h']) {
    assert.ok(after.costsDecompOn.includes(v), `costs class figure unchanged: ${v}`);
  }
  assert.equal(after.costsChart, before.costsChart, 'the day-grain chart is untouched (labour_day carries the deemed cost)');
  // (b) alone: no class row exists at all — the decomposition states so in both modes
  const db2 = makeDb();
  seedDays(db2);
  db2.prepare(`INSERT INTO labour_shifts (business_date, user_id, user_name, sched_minutes, act_minutes, variance_minutes, rate_pence) VALUES ('2026-07-19', 8, 'Jordan Deemed', 510, 510, 0, 1692)`).run();
  const s2 = modeSegs(renderTab(db2, { tab: 'rota' }));
  assert.ok(!s2.hoursDecomp.includes('r-meter-row'), 'hours mode: zero variance bars');
  assert.ok(!s2.costsDecompOn.includes('r-meter-row'), 'costs mode: zero variance bars');
  assert.ok(s2.hoursDecomp.includes('<b>Where the extra hours came from</b> — not wired.'), 'hours mode empty state');
  assert.ok(s2.costsDecompOn.includes('<b>Where the extra cost came from</b> — not wired.'), 'costs mode empty state');
});

// ---------------- NEGATIVE CONTROL: hours mode byte-identical ----------------

test('negative control: hours-mode chart + decomposition markup is byte-identical to the pre-change render (pinned pre-change literals)', () => {
  const db = makeDb();
  seedDays(db); seedShifts(db);
  const s = modeSegs(renderTab(db, { tab: 'rota' }));
  // the exact pre-change chart literals (heights hand-computed on the pre-change algorithm)
  assert.ok(s.hoursChart.includes('<div class="lbc-bar sched" style="height:107px"></div><div class="lbc-bar act" style="height:93px"></div>'), '07-18 minutes pair, pre-change bytes');
  assert.ok(s.hoursChart.includes('<div class="lbc-bar sched" style="height:128px"></div><div class="lbc-bar act" style="height:140px"></div>'), '07-19 minutes pair, pre-change bytes');
  assert.ok(s.hoursChart.includes('title="Sun 2026-07-19 — rota&#39;d 16.0h · worked 17.5h"'), 'pre-change tooltip bytes');
  assert.ok(s.hoursChart.includes('hours only (minute grain, ruler-free) · labour_day scheduled vs actual minutes'), 'pre-change mini-note bytes');
  assert.ok(s.hoursChart.includes('<b>12 day(s) have no labour_day record</b>'), 'pre-change missing-days bytes');
  // the exact pre-change decomposition literals
  assert.ok(s.hoursDecomp.includes('<div class="r-value">1 · 1.0h</div>'), 'over-rota\'d pre-change value bytes');
  assert.ok(s.hoursDecomp.includes('<div class="r-value">1 · 5.0h</div>'), 'unrota\'d pre-change value bytes');
  assert.ok(s.hoursDecomp.includes('<div class="r-value">2 · 4.5h</div>'), 'under-worked pre-change value bytes');
  assert.ok(s.hoursDecomp.includes('CANNOT be split'), 'the timestamps-gap statement survives');
  // and the hours panes stay ruler-free: ZERO £ data anywhere in them
  assert.ok(!/£\d/.test(s.hoursChart), 'hours chart pane carries no £');
  assert.ok(!/£\d/.test(s.hoursDecomp), 'hours decomposition pane carries no £');
});

// ---------------- cross-cutting boundaries ----------------

test('no-names with the toggle present: the Pat Pattern fixture never renders — mode is render-wide, both datasets in one body', () => {
  const db = makeDb();
  seedDays(db); seedShifts(db);
  db.prepare(`INSERT INTO labour_shifts (business_date, user_id, user_name, sched_minutes, act_minutes, variance_minutes, rate_pence) VALUES ('2026-07-16', 9, 'Pat Pattern Sr', 480, 600, 120, NULL)`).run();
  const body = renderTab(db, { tab: 'rota' });
  assert.ok(body.includes('id="rv-mode"'), 'the toggle markup is present');
  assert.ok(!body.includes('Pat Pattern'), 'no labour_shifts name renders in either mode');
});

test('INVARIANT (the template-literal incident class): every <script> the labour page serves must PARSE, on every tab', () => {
  const db = makeDb();
  seedDays(db); seedShifts(db);
  let total = 0;
  for (const tabKey of ['executive', 'forecast', 'rota', 'kitchen', 'foh', 'coverage']) {
    const body = renderTab(db, { tab: tabKey });
    const scripts = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
    for (const scr of scripts) new Function(scr); // throws SyntaxError on a broken script — the incident shape
    if (tabKey === 'rota') assert.ok(scripts.length >= 1, 'the rota tab ships the toggle script');
    total += scripts.length;
  }
  assert.ok(total >= 1, 'at least one served script was parse-checked');
});

test('empty DB: rota tab honest states, zero £ data values, no toggle claims without a wire; shift-less days still dual-render', () => {
  const db = makeDb();
  const body = renderTab(db, { tab: 'rota' });
  assert.ok(body.includes('No settled labour-day record yet'), 'no labour_day at all → the honest no-wire banner');
  assert.ok(!/NaN|Infinity|undefined/.test(body), 'no fabricated value');
  assert.ok(!/£\d[\d,]*\.\d{2}/.test(body), 'no £ data value invented from an empty DB');
  // labour_day present but zero shifts: both decomposition modes state the gap, chart pair renders
  const db2 = makeDb();
  seedDays(db2);
  const s = modeSegs(renderTab(db2, { tab: 'rota' }));
  assert.ok(s.hoursDecomp.includes('<b>Where the extra hours came from</b> — not wired.'), 'hours decomposition empty state');
  assert.ok(s.costsDecompOn.includes('<b>Where the extra cost came from</b> — not wired.'), 'costs decomposition empty state');
  assert.ok(!/£\d/.test(s.hoursDecomp), 'no invented class £ in the hours pane');
  assert.ok(!s.costsDecompOn.includes('r-meter-row'), 'no invented class bars in the costs pane');
});
