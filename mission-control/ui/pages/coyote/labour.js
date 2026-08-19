'use strict';
// Labour — the LABOUR COMMAND CENTRE (L1, built from the Stage-1 gap map
// docs/labour-centre/gap-map.md + the operator mock reference/mock-*.png). ONE route
// (/coyote/labour — the operator ruled the centre TAKES the existing route), six subtabs:
//   executive (default) · forecast · rota (Rota vs Actual) · kitchen · foh · coverage
// L1 SCOPE: the shell + EXECUTIVE + ROTA VS ACTUAL fully built.
// L2 SCOPE: LABOUR FORECAST + KITCHEN + FRONT OF HOUSE built to the mock —
//   forecast = interactive weekly forecast (what-if slider, CLIENT-side only, nothing stored)
//   + five-band DERIVED curve + eight-week outlook + forward management view + calibration/
//   guardrails canon; kitchen/foh = ONE shared dept renderer (day performance · role mix ·
//   demand vs staffing · decision ratios).
// L3 SCOPE (this build): COVERAGE & PEOPLE — the FINAL tab; the centre is COMPLETE and no
//   pending banner remains anywhere: today-live intraday strip (operational coverage — its
//   home) · aggregate people KPI strip (last full week, ZERO person keys) · combined
//   coverage-vs-required heatmap (staffing = labour_hourly TRUE £, site-level; required =
//   line-grain demand share × the formula budget — a DERIVATION, captioned, never a rota
//   standard) · compliance & structural exceptions (the ruled-in person CLASSES only — the
//   mock's People exception queue is EXCLUDED-BY-RULING) · aggregate ratios · canon +
//   data-architecture cards.
// ONE HOME PER FACT (the absorb rule) — what the old /coyote/labour page's panels became:
//   • hero headline + 8-week labour-% spark → ABSORBED by the Executive KPI strip + 13-week
//     control trend (deleted here, one home);
//   • dept scorecard blocks + bonus pacing + period nav → ABSORBED by the Executive department
//     control + daily control strip (the RotaCloud-budget scorecard framing is superseded by
//     the ruled formula budget; RC-screen arithmetic keeps its home in RotaCloud itself and in
//     the Rota-vs-Actual cost-definition card);
//   • cross-ruler % / SPLH block → ABSORBED by the Executive KPI strip (same intersection
//     discipline);
//   • clock-drift panel → ABSORBED by Rota vs Actual (aggregate decomposition + reconciliation
//     — per-shift NAMES deliberately left behind, see the surveillance boundary below);
//   • blended-rate sparklines → ABSORBED by the variance bridge's dept rate-mix effect;
//   • staffing shape → ABSORBED by the Coverage & People coverage-vs-required heatmap (L3);
//   • today-live intraday → the Coverage & People "Today — live" strip (its home, L3);
//   • WTR guard + rate parity → ABSORBED by the Coverage & People compliance panel (L3).
// THE RULERS (never mixed, every figure captioned):
//   • TRUE (the operating truth): labour_day costs — locked rates × 1.159 employer burden +
//     salaried/365 day-grain apportionment. THIS CENTRE'S BASIS.
//   • RC-screen (the managers' RotaCloud arithmetic): labour_dept costs — RC's own per-user
//     rates, pre-burden, salaried £0. Renders ONLY in the cost-definition reconciliation card,
//     labelled. Standing ruling: RC screens are recomputed from LIVE rates, never cached.
// THE RULED FORMULA (rota-review spec): dept TRUE budget = dept salaried burdened + var% × net
// (as of 2026-08-10: kitchen 14.3%, FOH 8.1%; combined 22.4% — ~30% at the High-band anchor);
// OVER only beyond the ruled £45 materiality. THE VALUES COME FROM THE DB: canon_constants
// (engine schema; single-home ruling 2026-08-10) via loadRuledConstants — this comment quotes
// them as a dated snapshot only; the numbers rendered are ALWAYS the DB's.
// CROSS-RULER HONESTY (load-bearing, inherited): labour % of net and SPLH divide matching
// numerator and denominator over ONLY the sales∩labour intersection days, day-count labelled.
// JUNE HOLE: labour_day has NO June 2026 rows (the backfill is blocked on the Leon Mackay
// RotaCloud fix) — trends STATE the hole, never bridge it.
// SURVEILLANCE BOUNDARY (ruling, gap map): people appear as rota-STRUCTURAL facts only — no
// per-employee scoring/monitoring queues; labour_shifts user_name never renders on any tab.
// The People exception queue is EXCLUDED-BY-RULING; the gap map records it. The boundary is
// CLASS-based, not name-based: the ruled-IN person-keyed classes (WTR regulatory flags,
// rate-parity payroll rows, unmapped-shift names) DO render names — structural/regulatory
// facts, not behavioural framing. Attendance renders as AGGREGATES only — including
// NO-SHOWS, which named the person until 2026-08-12 (found by a register verification, not
// by a test: the boundary test seeded an empty no-show list, so the branch that leaked was
// the one branch never exercised). Presence is structural and may be named; ABSENCE is a
// judgement and is counted, never named.
// Contract: { key, route, workspace, title, sub, getSection, render }. SELECT-only via ctx.q.
const S = require('../../shared.js');
const REP = require('../../reporting.js');
const K = require('../../kpi.js');
// Rota Review consolidation (2026-07-22): the standalone page was retired; its full report
// (FORWARD/HINDSIGHT verdicts + per-daypart items + run history) is hosted here as a tab by
// delegating to the same renderer. The cadence timers still write rota_review_runs, which it reads.
const ROTA_REVIEW = require('./rota-review.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
const MONTHS_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dowIdx = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
const dowLabel = (iso) => DOWS[dowIdx(iso)];
const dayLabel = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS_ABBR[Number(iso.slice(5, 7))] || ''}`;

const TABS = [
  { key: 'executive', label: 'Executive' },
  { key: 'forecast', label: 'Labour Forecast' },
  { key: 'rota', label: 'Rota vs Actual' },
  { key: 'rota-review', label: 'Rota Review' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'foh', label: 'Front of House' },
  { key: 'coverage', label: 'Coverage & People' },
];
const TAB_KEYS = TABS.map((t) => t.key);

// The ruled constants (rota-review spec rulings) are READ FROM THE DB — the engine's
// canon_constants table (operator ruling 2026-08-10, duplication wave: ONE writing store;
// MC is a READER, never a second home for a ruled number). loadRuledConstants returns null
// when the table/keys are absent (e.g. the engine schema PR hasn't merged yet on this DB) —
// the page then renders an EXPLICIT "ruled constants unavailable" state; there is no silent
// hardcoded default by design. Combined var rate = kitchen + foh (DERIVED, matching the
// engine's formula arithmetic — never stored as its own row).
const CANON_KEYS = {
  burden: 'labour.employer_burden_multiplier',
  varKitchen: 'labour.var_rate_kitchen',
  varFoh: 'labour.var_rate_foh',
  materialityPence: 'labour.materiality_pence',
};
function loadRuledConstants(q) {
  const rows = rowsOf(q(`SELECT key, value FROM canon_constants WHERE key IN (?, ?, ?, ?)`,
    [CANON_KEYS.burden, CANON_KEYS.varKitchen, CANON_KEYS.varFoh, CANON_KEYS.materialityPence]));
  const byKey = new Map(rows.map((r) => [String(r.key), Number(r.value)]));
  for (const k of Object.values(CANON_KEYS)) if (!Number.isFinite(byKey.get(k))) return null;
  const kitchen = byKey.get(CANON_KEYS.varKitchen);
  const foh = byKey.get(CANON_KEYS.varFoh);
  return {
    burden: byKey.get(CANON_KEYS.burden),
    varDept: { kitchen, foh },
    varRate: kitchen + foh,
    materialityPence: byKey.get(CANON_KEYS.materialityPence),
  };
}

// The per-receipt SALE filter + LOCAL London hour conversion (the reports-page idiom,
// verbatim — the coverage heatmap's demand side runs on the same line-grain rules).
const SALE_WHERE = `r.cancelled = 0 AND (r.type IS NULL OR r.type NOT IN ('VOID','CANCEL','RECALL'))`;
const LONDON_HOUR_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' });
const londonHourOf = (ms) => Number(LONDON_HOUR_FMT.format(new Date(ms)));
// The coverage grid draws the trading hours 11:00–21:00 (the RCC drivers-heatmap frame).
const HEAT_HOURS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

// Coverage-vs-required level ramp: SIX levels CENTERED on balanced (Δ = 0 sits on the 3|4
// seam); thirds of the window's largest |Δ| each side. 1–3 = staffed UNDER the derived
// requirement, 4–6 = staffed OVER it.
function coverageLevel(delta, maxAbs) {
  if (!(maxAbs > 0)) return 4;
  const t = maxAbs / 3;
  return delta <= -2 * t ? 1 : delta <= -t ? 2 : delta < 0 ? 3 : delta <= t ? 4 : delta <= 2 * t ? 5 : 6;
}

// The June-2026 hole statement (stated once per affected panel, never bridged).
const JUNE_HOLE = 'the June 2026 hole — the labour backfill is blocked on the Leon Mackay RotaCloud fix';
function juneNote(missingDates) {
  return missingDates.some((d) => String(d).startsWith('2026-06')) ? ` (incl. ${JUNE_HOLE})` : '';
}

// The ruled status classes vs a formula/plan budget delta (mirrors the Drivers scorecard):
// OVER only beyond the ruled materiality (canon_constants); on/under both render good.
function ruledChip(C, deltaPence, overWord, underWord, onWord) {
  if (deltaPence == null) return S.rcc.tag('no labour');
  return deltaPence > C.materialityPence ? S.rcc.tag(`${overWord} ${S.fmtGbpPence(deltaPence)}`, 'bad')
    : deltaPence <= 0 ? S.rcc.tag(underWord, 'good')
      : S.rcc.tag(onWord, 'good');
}

// ---------------------------------------------------------------------------------------------
// getSection builders — SELECT-only; every read degrades to an honest null on a missing table.
// ---------------------------------------------------------------------------------------------

// EXECUTIVE — last-full-week KPIs, 13-week control trend, attention queue, variance bridge,
// department control, daily control strip. TRUE ruler throughout (RC never renders here).
// Labour compliance sweep (engine timer, operator brief 2026-08-18): the latest sweep's
// findings, read straight off labour_compliance_findings. NAMES RENDER HERE by the same
// brief ("shifts which were not clocked in or out ... excluding Jordan Williams", sick days
// per employee) — the centre's no-names surveillance boundary stands for performance
// metrics (SPLH/variance); a missed punch or a sick-day total is payroll accuracy the
// operator explicitly asked to see by name. Absent table → null → panel absent (merge
// order across the two repos is not guaranteed).
function buildCompliance(q) {
  const latest = rowsOf(q(`SELECT sweep_date, run_kind FROM labour_compliance_findings ORDER BY sweep_date DESC, run_kind DESC LIMIT 1`))[0];
  if (!latest) return null;
  const rows = rowsOf(q(
    `SELECT kind, business_date, user_name, role_name, detail, minutes, days, window_from, window_to
       FROM labour_compliance_findings WHERE sweep_date = ? AND run_kind = ?
      ORDER BY CASE kind WHEN 'missed_in' THEN 0 WHEN 'missed_out' THEN 1 WHEN 'late' THEN 2 ELSE 3 END, business_date, user_name`,
    [latest.sweep_date, latest.run_kind],
  ));
  return {
    sweepDate: String(latest.sweep_date), runKind: String(latest.run_kind),
    clock: rows.filter((r) => r.kind !== 'sick_days'),
    sick: rows.filter((r) => r.kind === 'sick_days').sort((a, b) => (num(b.days) || 0) - (num(a.days) || 0)),
  };
}

function buildExecutive(q, maxDate, C) {
  if (!maxDate) return null;
  const e = { maxDate };
  const wk = K.lastFullWeek(maxDate);
  e.week = wk;

  // ---- week aggregates: full week (no sales needed) + the sales∩labour intersection ----
  e.agg = rowsOf(q(
    `SELECT SUM(scheduled_cost_pence) sc, SUM(actual_cost_pence) ac, SUM(actual_minutes) am,
            SUM(actual_paid_minutes) apm, SUM(salaried_cost_pence) sal, COUNT(*) days
       FROM labour_day WHERE business_date BETWEEN ? AND ?`, [wk.from, wk.to]))[0] || null;
  e.inter = rowsOf(q(
    `SELECT SUM(l.actual_cost_pence) ac, SUM(l.salaried_cost_pence) sal, SUM(l.actual_minutes) am,
            SUM(s.net_sales_pence) net, COUNT(*) days
       FROM labour_day l JOIN sales_day s ON s.business_date = l.business_date
      WHERE l.business_date BETWEEN ? AND ? AND s.net_sales_pence > 0`, [wk.from, wk.to]))[0] || null;
  e.ot = rowsOf(q(
    `SELECT SUM(variance_minutes) mins, COUNT(*) n FROM labour_shifts
      WHERE business_date BETWEEN ? AND ? AND variance_minutes > 0`, [wk.from, wk.to]))[0] || null;

  // ---- 13-week control trend: weekly TRUE labour % over intersection days + the formula
  // budget % ((Σsalaried + varRate × net) ÷ net, splits from canon_constants). A week with
  // no labour_day rows is a GAP. ----
  const from13 = K.shiftDays(wk.from, -84);
  const weeks = [];
  const byFrom = new Map();
  for (let i = 12; i >= 0; i--) {
    const w = { from: K.shiftDays(wk.from, -7 * i), cost: 0, sal: 0, net: 0, interDays: 0, labourDays: 0 };
    weeks.push(w); byFrom.set(w.from, w);
  }
  for (const r of rowsOf(q(
    `SELECT l.business_date d, l.actual_cost_pence ac, l.salaried_cost_pence sal,
            (SELECT s.net_sales_pence FROM sales_day s
              WHERE s.business_date = l.business_date AND s.net_sales_pence > 0) net
       FROM labour_day l WHERE l.business_date BETWEEN ? AND ?`, [from13, wk.to]))) {
    const w = byFrom.get(K.weekMonday(String(r.d)));
    if (!w) continue;
    w.labourDays += 1;
    if (num(r.net) > 0 && num(r.ac) != null) {
      w.interDays += 1;
      w.cost += num(r.ac) || 0;
      w.sal += num(r.sal) || 0;
      w.net += num(r.net) || 0;
    }
  }
  e.trend = {
    weeks: weeks.map((w) => ({
      from: w.from, labourDays: w.labourDays, interDays: w.interDays,
      pct: w.interDays > 0 && w.net > 0 ? (w.cost / w.net) * 100 : null,
      budPct: w.interDays > 0 && w.net > 0 ? ((w.sal + C.varRate * w.net) / w.net) * 100 : null,
    })),
  };

  // ---- owner attention queue: latest ok rota-review verdicts + WTR + parity + unmapped ----
  e.verdicts = [];
  for (const mode of ['forward', 'hindsight']) {
    const r = rowsOf(q(`SELECT week_monday, report_json FROM rota_review_runs WHERE mode = ? AND status = 'ok' ORDER BY id DESC LIMIT 1`, [mode]))[0];
    if (!r || !r.report_json) continue;
    try {
      const rep = JSON.parse(String(r.report_json));
      for (const v of rep.verdicts || []) {
        if (num(v.deltaPence) === null) continue;
        e.verdicts.push({
          mode, week: String(r.week_monday), dept: String(v.dept || ''),
          deltaPence: num(v.deltaPence), budgetPence: num(v.budgetPence), salariedPence: num(v.salariedPence),
        });
      }
    } catch (err) { /* unreadable run — the Rota Review page surfaces it */ }
  }
  e.hasRuns = rowsOf(q(`SELECT COUNT(*) n FROM rota_review_runs`))[0];
  e.wtrCount = rowsOf(q(`SELECT COUNT(*) n FROM labour_wtr_flags`))[0];
  e.parityCount = rowsOf(q(`SELECT COUNT(*) n FROM labour_rate_parity`))[0];
  e.unmapped = [];
  for (const r of rowsOf(q(`SELECT unmapped_names n FROM labour_day WHERE business_date BETWEEN ? AND ? AND unmapped_names IS NOT NULL AND unmapped_names != '[]'`, [wk.from, wk.to]))) {
    try { for (const nm of JSON.parse(r.n)) if (e.unmapped.indexOf(nm) < 0) e.unmapped.push(nm); } catch (err) { /* never take the tab down */ }
  }
  e.unmapped.sort();

  // ---- variance bridge components (week window). Shift effects run on the shift's locked
  // rate × burden (TRUE hourly basis — salaried/365 is identical on both endpoints, so it
  // cancels sched→actual); the dept rate-mix effect derives from labour_dept minute-rates,
  // × burden onto the same basis. The remainder is labelled, never hidden. ----
  const hoursVar = rowsOf(q(
    `SELECT SUM(variance_minutes * rate_pence / 60.0) p, SUM(variance_minutes) mins
       FROM labour_shifts WHERE business_date BETWEEN ? AND ?
        AND sched_minutes > 0 AND act_minutes > 0 AND variance_minutes IS NOT NULL AND rate_pence IS NOT NULL`,
    [wk.from, wk.to]))[0] || null;
  const unrota = rowsOf(q(
    `SELECT COUNT(*) n, SUM(act_minutes) mins, SUM(act_minutes * rate_pence / 60.0) p
       FROM labour_shifts WHERE business_date BETWEEN ? AND ?
        AND (sched_minutes IS NULL OR sched_minutes = 0) AND act_minutes > 0 AND rate_pence IS NOT NULL`,
    [wk.from, wk.to]))[0] || null;
  const unworked = rowsOf(q(
    `SELECT COUNT(*) n, SUM(sched_minutes) mins, SUM(sched_minutes * rate_pence / 60.0) p
       FROM labour_shifts WHERE business_date BETWEEN ? AND ?
        AND sched_minutes > 0 AND (act_minutes IS NULL OR act_minutes = 0) AND rate_pence IS NOT NULL`,
    [wk.from, wk.to]))[0] || null;
  let rateMix = null;
  const mixRows = rowsOf(q(
    `SELECT department, SUM(sched_minutes) sm, SUM(act_minutes) am,
            SUM(sched_cost_rc_pence) sc, SUM(act_cost_rc_pence) ac
       FROM labour_dept WHERE business_date BETWEEN ? AND ? GROUP BY department`, [wk.from, wk.to]));
  for (const r of mixRows) {
    if (num(r.sm) > 0 && num(r.am) > 0 && num(r.sc) != null && num(r.ac) != null) {
      rateMix = (rateMix || 0) + ((num(r.ac) / num(r.am)) - (num(r.sc) / num(r.sm))) * num(r.am);
    }
  }
  e.bridge = {
    sched: e.agg ? num(e.agg.sc) : null, actual: e.agg ? num(e.agg.ac) : null,
    rateMix: rateMix != null ? Math.round(rateMix * C.burden) : null,
    hoursVar: hoursVar && num(hoursVar.p) != null ? Math.round(num(hoursVar.p) * C.burden) : null,
    hoursVarMins: hoursVar ? num(hoursVar.mins) : null,
    unrota: unrota && num(unrota.p) != null ? Math.round(num(unrota.p) * C.burden) : null,
    unrotaN: unrota ? num(unrota.n) || 0 : 0,
    unworked: unworked && num(unworked.p) != null ? -Math.round(num(unworked.p) * C.burden) : null,
    unworkedN: unworked ? num(unworked.n) || 0 : 0,
  };

  // ---- department control: dept VARIABLE TRUE (RC-screen hourly cost × burden) vs the dept
  // variable budget (var% × intersection net) — the salaried term is identical on both sides
  // of the ruled formula, so it cancels and the delta is EXACT. Intersection days only. ----
  e.deptCtl = { interNet: e.inter ? num(e.inter.net) : null, interDays: e.inter ? num(e.inter.days) || 0 : 0, depts: [] };
  const deptCost = rowsOf(q(
    `SELECT ld.department, SUM(ld.act_cost_rc_pence) ac, SUM(ld.act_minutes) am
       FROM labour_dept ld JOIN sales_day s ON s.business_date = ld.business_date AND s.net_sales_pence > 0
      WHERE ld.business_date BETWEEN ? AND ? GROUP BY ld.department`, [wk.from, wk.to]));
  for (const d of ['kitchen', 'foh']) {
    const row = deptCost.find((r) => String(r.department) === d) || null;
    const trueVar = row && num(row.ac) != null ? Math.round(num(row.ac) * C.burden) : null;
    const budget = e.deptCtl.interNet != null ? Math.round(C.varDept[d] * e.deptCtl.interNet) : null;
    e.deptCtl.depts.push({
      dept: d, trueVar, budget,
      delta: trueVar != null && budget != null ? trueVar - budget : null,
      mins: row ? num(row.am) : null,
    });
  }

  // ---- daily control strip: last 7 days ending at the labour anchor ----
  const from7 = K.shiftDays(maxDate, -6);
  const sales = new Map();
  for (const r of rowsOf(q(`SELECT business_date d, net_sales_pence net FROM sales_day WHERE business_date BETWEEN ? AND ?`, [from7, maxDate])))
    sales.set(String(r.d), num(r.net));
  const lab = new Map();
  for (const r of rowsOf(q(`SELECT business_date d, actual_cost_pence ac, salaried_cost_pence sal, actual_minutes am FROM labour_day WHERE business_date BETWEEN ? AND ?`, [from7, maxDate])))
    lab.set(String(r.d), { ac: num(r.ac), sal: num(r.sal), am: num(r.am) });
  e.strip = [];
  for (let i = 6; i >= 0; i--) {
    const d = K.shiftDays(maxDate, -i);
    e.strip.push({ date: d, net: sales.get(d) != null ? sales.get(d) : null, lab: lab.get(d) || null });
  }
  return e;
}

// ROTA VS ACTUAL — 14d sched-vs-actual chart, variance decomposition, daily reconciliation,
// schedule accuracy, and the cost-definition (RC-screen vs TRUE) reconciliation card.
// HOURS | COSTS toggle (COSTS default): the daily chart + the decomposition dual-render both
// modes server-side; a client-only script swaps visibility (classList, no fetch, no state).
// COSTS chart = labour_day TRUE £ (day grain, salaried INCLUDED); COSTS decomposition = shift
// minutes × the shift's OWN rate_pence × 1.159 (shift grain; rate-less shifts price £0).
function buildRota(q, maxDate) {
  if (!maxDate) return null;
  const r = { maxDate };
  const from14 = K.shiftDays(maxDate, -13);
  r.from14 = from14;

  r.days = rowsOf(q(
    `SELECT business_date d, scheduled_minutes sm, actual_minutes am, actual_paid_minutes apm,
            scheduled_cost_pence sc, actual_cost_pence ac
       FROM labour_day WHERE business_date BETWEEN ? AND ? ORDER BY business_date`, [from14, maxDate]))
    .map((x) => ({
      date: String(x.d), sm: num(x.sm), am: num(x.am), apm: num(x.apm), sc: num(x.sc), ac: num(x.ac),
    }));

  // ---- where the extra hours came from: labour_shifts AGGREGATE (no names; labour_shifts
  // carries no department key and no per-shift timestamps — both stated on-panel). Each class
  // ALSO carries a priced sum (COSTS mode): minutes × the shift's OWN rate_pence ÷ 60, rated
  // shifts only — a NULL rate (clocked salaried always; deemed staff before 2026-07-21) keeps
  // its MINUTES in `mins` but contributes £0 to `p` (its cost is annual/365 at day grain).
  // Deemed staff (cc PR #88, from 2026-07-21) carry act = sched and variance 0 on both axes by
  // construction, so they land in NO variance class — zero in both modes. ----
  const one = (sql) => rowsOf(q(sql, [from14, maxDate]))[0] || null;
  r.decomp = {
    over: one(`SELECT COUNT(*) n, SUM(act_minutes - sched_minutes) mins,
                      SUM(CASE WHEN rate_pence IS NOT NULL THEN (act_minutes - sched_minutes) * rate_pence / 60.0 END) p
                 FROM labour_shifts
                WHERE business_date BETWEEN ? AND ? AND sched_minutes > 0 AND act_minutes > sched_minutes`),
    unrota: one(`SELECT COUNT(*) n, SUM(act_minutes) mins,
                        SUM(CASE WHEN rate_pence IS NOT NULL THEN act_minutes * rate_pence / 60.0 END) p
                   FROM labour_shifts
                  WHERE business_date BETWEEN ? AND ? AND (sched_minutes IS NULL OR sched_minutes = 0) AND act_minutes > 0`),
    under: one(`SELECT COUNT(*) n, SUM(sched_minutes - COALESCE(act_minutes, 0)) mins,
                       SUM(CASE WHEN rate_pence IS NOT NULL THEN (sched_minutes - COALESCE(act_minutes, 0)) * rate_pence / 60.0 END) p
                  FROM labour_shifts
                 WHERE business_date BETWEEN ? AND ? AND sched_minutes > 0 AND COALESCE(act_minutes, 0) < sched_minutes`),
  };

  // ---- schedule accuracy: SITE-level ±15min (labour_shifts has NO department key — checked;
  // the dept split lands when the shift wire carries one) + dept HOURS accuracy (labour_dept
  // minute grain — hours only, ruler-free) ----
  r.accuracy = one(`SELECT COUNT(*) n,
        SUM(CASE WHEN ABS(COALESCE(act_minutes, 0) - sched_minutes) <= 15 THEN 1 ELSE 0 END) w
      FROM labour_shifts WHERE business_date BETWEEN ? AND ? AND sched_minutes > 0`);
  r.deptHours = rowsOf(q(
    `SELECT department, SUM(sched_minutes) sm, SUM(act_minutes) am
       FROM labour_dept WHERE business_date BETWEEN ? AND ? AND department IN ('kitchen','foh')
      GROUP BY department`, [from14, maxDate]))
    .map((x) => ({ dept: String(x.department), sm: num(x.sm), am: num(x.am) }));

  // ---- cost-definition reconciliation: last full week, the two rulers side by side ----
  const wk = K.lastFullWeek(maxDate);
  r.week = wk;
  r.rc = rowsOf(q(
    `SELECT SUM(sched_cost_rc_pence) sc, SUM(act_cost_rc_pence) ac,
            SUM(rc_uncosted_act_min) um, COUNT(DISTINCT business_date) days
       FROM labour_dept WHERE business_date BETWEEN ? AND ?`, [wk.from, wk.to]))[0] || null;
  r.trueWk = rowsOf(q(
    `SELECT SUM(scheduled_cost_pence) sc, SUM(actual_cost_pence) ac, SUM(salaried_cost_pence) sal, COUNT(*) days
       FROM labour_day WHERE business_date BETWEEN ? AND ?`, [wk.from, wk.to]))[0] || null;
  return r;
}

// LABOUR FORECAST (L2) — the banded formula pointed FORWARD. Bases (every one stated on-panel):
//   • forecast net = published RC daily revenue targets (rota_ahead_budget — the site target is
//     DUPLICATED across the per-dept rows, so DISTINCT dedups; the reports-tab gotcha) when the
//     WHOLE week is published, else the revenue projection's calendar-day weekly share (the P4
//     method via REP.computeProjection + the journaled override — one home, a pointer);
//   • rota promise = the FORWARD rota-review verdict's plannedTruePence (incl. salaried
//     apportionment — the canonical promise) when its week matches, else Σ published HOURLY
//     shifts at locked rate × 1.159 (rota_ahead_shifts.sched_cost_true_pence; salaried/unmapped
//     rota hours carry NO £ here — never estimated, hours stated);
//   • salaried term = the last settled full week's Σ salaried_cost_pence (day-grain constant by
//     construction, so the last settled week IS the forward value — an observed fact).
// The five bands are the DERIVED view of the formula (the ruling: never hand-set rows) — the
// levels are OBSERVED weekly-net quantiles, the % is the formula ÷ net at each level.
function buildForecast(q, maxDate, now) {
  const f = { today: new Date(now).toISOString().slice(0, 10) };
  const nextFrom = K.shiftDays(K.weekMonday(f.today), 7);
  f.week = { from: nextFrom, to: K.shiftDays(nextFrom, 6) };

  // ---- the salaried term ----
  f.sal = null;
  if (maxDate) {
    const wk = K.lastFullWeek(maxDate);
    const r = rowsOf(q(`SELECT SUM(salaried_cost_pence) sal, COUNT(*) days FROM labour_day WHERE business_date BETWEEN ? AND ?`, [wk.from, wk.to]))[0];
    if (r && num(r.days) > 0 && num(r.sal) != null) f.sal = { pence: num(r.sal), from: wk.from, to: wk.to };
  }

  // ---- the revenue projection (the P4 assembly verbatim; labour READS it — never a copy).
  // Monthly net = the day-net canon v_sales_day_all (revenue-of-record ruling 2026-08-10) —
  // never re-summed from receipt headers; completeness still gates on the API ingest ledger. ----
  const nowYm = f.today.slice(0, 7);
  const year = Number(nowYm.slice(0, 4));
  const boundaryRow = rowsOf(q(`SELECT start_date FROM premises_regime WHERE name='current'`))[0];
  const boundaryDate = boundaryRow && boundaryRow.start_date ? String(boundaryRow.start_date) : '2023-04-01';
  const apiMonths = rowsOf(q(
    `SELECT substr(business_date,1,7) AS ym, SUM(net_sales_pence) AS net, SUM(transactions) AS txn
       FROM v_sales_day_all GROUP BY ym ORDER BY ym`));
  const ledgerMonths = rowsOf(q(
    `SELECT substr(business_date,1,7) AS ym, COUNT(DISTINCT business_date) AS days
       FROM sales_api_ingest_runs WHERE source='kseries-sales-daily' AND status='ok' GROUP BY ym`));
  f.override = { pct: 0, storeMissing: false };
  const ovRes = q(`SELECT pct FROM forecast_overrides ORDER BY id DESC LIMIT 1`);
  if (ovRes && ovRes.ok) { if (ovRes.rows.length) f.override.pct = Number(ovRes.rows[0].pct) || 0; }
  else f.override.storeMissing = true;
  const fByYm = new Map();
  f.method = null;
  if (apiMonths.length || ledgerMonths.length) {
    const months = REP.buildMonths({ apiMonths, ledgerMonths, nowYm });
    const P = REP.computeProjection({ months, year, nowYm, boundaryDate, windowN: 6 });
    f.method = P.ratio != null ? 'seasonal' : (P.ytdRatio != null ? 'simple' : null);
    for (const fm of P.forecast) {
      const v = fm.seasonalPence != null ? fm.seasonalPence : fm.simplePence;
      if (v != null) fByYm.set(fm.ym, v * (1 + f.override.pct / 100));
    }
  }
  // calendar-day share of the monthly projection — NO weekday shape is claimed; a week with any
  // un-projectable month renders no share at all (honest null, never a partial dressed as whole).
  const weeklyShare = (from) => {
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = K.shiftDays(from, i);
      const v = fByYm.get(d.slice(0, 7));
      if (v == null) return null;
      sum += v / REP.calDays(d.slice(0, 7));
    }
    return Math.round(sum);
  };

  // ---- per-week facts: published target (dedup'd, whole-week only), projection share,
  // published-rota shift aggregate (NO names — aggregate SUMs only) ----
  const weekFacts = (from) => {
    const to = K.shiftDays(from, 6);
    const tgt = rowsOf(q(`SELECT DISTINCT business_date d, revenue_target_pence t FROM rota_ahead_budget WHERE business_date BETWEEN ? AND ?`, [from, to]))
      .filter((r) => num(r.t) != null);
    const published = tgt.length === 7 ? tgt.reduce((s, r) => s + num(r.t), 0) : null;
    const sh = rowsOf(q(
      `SELECT COUNT(*) n,
              SUM(CASE WHEN cost_basis='hourly' THEN sched_cost_true_pence END) hp,
              SUM(CASE WHEN cost_basis='hourly' THEN sched_minutes ELSE 0 END) hm,
              SUM(CASE WHEN cost_basis='salaried' THEN sched_minutes ELSE 0 END) sm,
              SUM(CASE WHEN cost_basis='unmapped' THEN sched_minutes ELSE 0 END) um
         FROM rota_ahead_shifts WHERE business_date BETWEEN ? AND ?`, [from, to]))[0] || null;
    const share = weeklyShare(from);
    return {
      from, to, published, publishedDays: tgt.length, share,
      basis: published != null ? 'published' : (share != null ? 'projection' : null),
      basisNet: published != null ? published : share,
      shifts: sh && num(sh.n) > 0
        ? { n: num(sh.n) || 0, hourlyPence: num(sh.hp), hourlyMins: num(sh.hm) || 0, salMins: num(sh.sm) || 0, unmapMins: num(sh.um) || 0 }
        : null,
    };
  };
  f.outlook = [];
  for (let w = 0; w < 8; w++) f.outlook.push(weekFacts(K.shiftDays(nextFrom, w * 7)));
  f.next = f.outlook[0];

  // ---- the FORWARD verdict for next week (the canonical promise incl. salaried) ----
  f.fwd = null;
  const fr = rowsOf(q(`SELECT report_json FROM rota_review_runs WHERE mode='forward' AND status='ok' AND week_monday = ? ORDER BY id DESC LIMIT 1`, [nextFrom]))[0];
  if (fr && fr.report_json) {
    try {
      const rep = JSON.parse(String(fr.report_json));
      let total = 0, n = 0; const byDept = {};
      for (const v of rep.verdicts || []) {
        if (num(v.plannedTruePence) == null) continue;
        total += num(v.plannedTruePence); n += 1; byDept[String(v.dept || '')] = num(v.plannedTruePence);
      }
      if (n > 0) f.fwd = { total, byDept };
    } catch (err) { /* unreadable run — the Rota Review page surfaces it */ }
  }

  // ---- five-band levels: trailing 26 full weeks of weekly net (sales_day) ----
  f.bands = null;
  const smaxRow = rowsOf(q(`SELECT MAX(business_date) d FROM sales_day`))[0];
  if (smaxRow && smaxRow.d) {
    const swk = K.lastFullWeek(String(smaxRow.d));
    const from26 = K.shiftDays(swk.from, -175);
    const byWeek = new Map();
    for (const r of rowsOf(q(`SELECT business_date d, net_sales_pence n FROM sales_day WHERE business_date BETWEEN ? AND ?`, [from26, swk.to]))) {
      const wfm = K.weekMonday(String(r.d));
      const w = byWeek.get(wfm) || { days: 0, net: 0 };
      w.days += 1; w.net += num(r.n) || 0;
      byWeek.set(wfm, w);
    }
    const nets = [...byWeek.values()].filter((w) => w.days === 7).map((w) => w.net).sort((a, b) => a - b);
    const excluded = [...byWeek.entries()].filter(([, w]) => w.days !== 7).map(([k]) => k);
    const qtl = (p) => nets[Math.round((nets.length - 1) * p)];
    f.bands = {
      weeksUsed: nets.length, from: from26, to: swk.to, excluded,
      levels: nets.length >= 5 ? [
        { name: 'Low', p: 'min', net: qtl(0) },
        { name: 'Lower', p: 'p25', net: qtl(0.25) },
        { name: 'Median', p: 'p50', net: qtl(0.5) },
        { name: 'Upper', p: 'p75', net: qtl(0.75) },
        { name: 'High', p: 'max', net: qtl(1) },
      ] : null,
    };
  }

  // ---- forward management view: next 14 days, aggregated per day + dept (NO NAMES —
  // rota_ahead_shifts carries user_name; it is aggregated away here by ruling) ----
  f.fwdDays = rowsOf(q(
    `SELECT business_date d, department dept, COUNT(*) n, SUM(sched_minutes) mins,
            SUM(CASE WHEN cost_basis='hourly' THEN sched_cost_true_pence END) hp,
            SUM(CASE WHEN cost_basis='hourly' THEN sched_minutes ELSE 0 END) hm,
            SUM(CASE WHEN cost_basis<>'hourly' THEN sched_minutes ELSE 0 END) om
       FROM rota_ahead_shifts WHERE business_date BETWEEN ? AND ?
      GROUP BY d, dept ORDER BY d`, [K.shiftDays(f.today, 1), K.shiftDays(f.today, 14)]))
    .map((r) => ({
      date: String(r.d), dept: String(r.dept), n: num(r.n) || 0, mins: num(r.mins) || 0,
      hourlyPence: num(r.hp), hourlyMins: num(r.hm) || 0, otherMins: num(r.om) || 0,
    }));
  return f;
}

// KITCHEN / FRONT OF HOUSE (L2) — ONE shared build parameterized by dept (mirror tabs).
// Dept-keyed wires: labour_dept (daily minute + RC-cost grain — the ONLY settled dept key) and
// rota_ahead_shifts (FUTURE rota — dept + role). labour_shifts and labour_hourly carry NO
// department key (checked) — nothing here pretends otherwise; every non-dept-keyed fact states
// its site-level basis on-panel.
function buildDept(q, maxDate, dept, now) {
  const d = { dept, maxDate, today: new Date(now).toISOString().slice(0, 10) };
  if (maxDate) {
    const from14 = K.shiftDays(maxDate, -13);
    d.from14 = from14;
    const sales = new Map();
    for (const r of rowsOf(q(`SELECT business_date d, net_sales_pence net FROM sales_day WHERE business_date BETWEEN ? AND ?`, [from14, maxDate]))) sales.set(String(r.d), num(r.net));
    const site = new Map();
    for (const r of rowsOf(q(`SELECT business_date d, actual_minutes am FROM labour_day WHERE business_date BETWEEN ? AND ?`, [from14, maxDate]))) site.set(String(r.d), num(r.am));
    const drows = new Map();
    for (const r of rowsOf(q(`SELECT business_date d, act_minutes am, act_cost_rc_pence ac FROM labour_dept WHERE department = ? AND business_date BETWEEN ? AND ?`, [dept, from14, maxDate]))) drows.set(String(r.d), { am: num(r.am), ac: num(r.ac) });
    d.days = [];
    for (let i = 13; i >= 0; i--) {
      const iso = K.shiftDays(maxDate, -i);
      d.days.push({
        date: iso,
        net: sales.has(iso) ? sales.get(iso) : null,
        siteAm: site.has(iso) ? site.get(iso) : null,
        dep: drows.get(iso) || null,
      });
    }
    // decision-ratio aggregates over the same 14-day window (intersection days for the %)
    d.inter = rowsOf(q(
      `SELECT SUM(ld.act_cost_rc_pence) ac, SUM(s.net_sales_pence) net, COUNT(*) days
         FROM labour_dept ld JOIN sales_day s ON s.business_date = ld.business_date AND s.net_sales_pence > 0
        WHERE ld.department = ? AND ld.business_date BETWEEN ? AND ?`, [dept, from14, maxDate]))[0] || null;
    d.share = rowsOf(q(`SELECT department, SUM(act_minutes) am FROM labour_dept WHERE business_date BETWEEN ? AND ? GROUP BY department`, [from14, maxDate]))
      .map((r) => ({ dept: String(r.department), am: num(r.am) || 0 }));
  }
  // the ruled MIX note — verbatim from the latest ok run carrying one for this dept
  d.mix = null;
  for (const mode of ['forward', 'hindsight']) {
    const r = rowsOf(q(`SELECT week_monday, report_json FROM rota_review_runs WHERE mode = ? AND status = 'ok' ORDER BY id DESC LIMIT 1`, [mode]))[0];
    if (!r || !r.report_json) continue;
    try {
      const rep = JSON.parse(String(r.report_json));
      const note = rep.mixNotes && rep.mixNotes[dept];
      if (note) { d.mix = { mode, week: String(r.week_monday), note: String(note) }; break; }
    } catch (err) { /* unreadable run — the Rota Review page surfaces it */ }
  }
  // FUTURE role mix — rota_ahead_shifts carries dept + role (published rota, forward-looking);
  // the settled shift wire carries roles but NO dept key, so a settled role mix stays a gap.
  d.roles = rowsOf(q(
    `SELECT COALESCE(role_name, '(no role set)') role, SUM(sched_minutes) mins, COUNT(*) n,
            MIN(business_date) lo, MAX(business_date) hi
       FROM rota_ahead_shifts WHERE department = ? AND business_date > ? GROUP BY role ORDER BY mins DESC`, [dept, d.today]))
    .map((r) => ({ role: String(r.role), mins: num(r.mins) || 0, n: num(r.n) || 0, lo: String(r.lo), hi: String(r.hi) }));
  return d;
}

// COVERAGE & PEOPLE (L3, the FINAL tab) — today-live intraday strip, the aggregate people
// KPI strip (last full week, ZERO person keys), the combined coverage-vs-required heatmap
// (staffing = labour_hourly TRUE £, site-level; required = line-grain demand share × the
// formula budget — a DERIVATION), the compliance panel (the ruled-in person CLASSES only —
// the mock's People exception queue is EXCLUDED-BY-RULING), aggregate ratios, and the canon +
// architecture cards. The old page's held panels are ALL absorbed here: staffing shape → the
// heatmap; today-live → the strip; WTR guard + rate parity → the compliance panel.
function buildCoverage(q, maxDate, C) {
  const c = { maxDate };
  c.intraday = rowsOf(q(`SELECT business_date, department, as_of_ms, sched_minutes_full, sched_cost_rc_full, worked_minutes_so_far, cost_rc_so_far, uncosted_minutes, clocked_in_now, no_shows, ref_date, ref_worked_minutes, ref_net_pence, ref_to_hour FROM labour_intraday ORDER BY department`));

  // ---- last-full-week aggregates: the KPI strip, the adherence ratio, the heat budget ----
  c.week = null; c.unmapped = []; c.missing = [];
  if (maxDate) {
    const wk = K.lastFullWeek(maxDate);
    c.week = wk;
    const one = (sql) => rowsOf(q(sql, [wk.from, wk.to]))[0] || null;
    c.ot = one(`SELECT SUM(variance_minutes) mins FROM labour_shifts WHERE business_date BETWEEN ? AND ? AND variance_minutes > 0`);
    c.lateShort = one(`SELECT COUNT(*) n FROM labour_shifts WHERE business_date BETWEEN ? AND ?
        AND sched_minutes > 0 AND act_minutes > 0 AND variance_minutes IS NOT NULL AND ABS(variance_minutes) > 15`);
    c.unrota = one(`SELECT COUNT(*) n FROM labour_shifts WHERE business_date BETWEEN ? AND ?
        AND (sched_minutes IS NULL OR sched_minutes = 0) AND act_minutes > 0`);
    c.agg = one(`SELECT COUNT(*) days, SUM(scheduled_cost_pence) sc, SUM(actual_cost_pence) ac,
            SUM(salaried_cost_pence) sal, SUM(actual_minutes) am, SUM(unmapped_actual_minutes) um
       FROM labour_day WHERE business_date BETWEEN ? AND ?`);
    c.adherence = one(`SELECT COUNT(*) n, SUM(CASE WHEN ABS(variance_minutes) <= 15 THEN 1 ELSE 0 END) w
       FROM labour_shifts WHERE business_date BETWEEN ? AND ?
        AND sched_minutes > 0 AND act_minutes > 0 AND variance_minutes IS NOT NULL`);
    c.inter = one(`SELECT SUM(l.salaried_cost_pence) sal, SUM(s.net_sales_pence) net, COUNT(*) days
       FROM labour_day l JOIN sales_day s ON s.business_date = l.business_date AND s.net_sales_pence > 0
      WHERE l.business_date BETWEEN ? AND ?`);
    const have = new Set(rowsOf(q(`SELECT business_date d FROM labour_day WHERE business_date BETWEEN ? AND ?`, [wk.from, wk.to])).map((r) => String(r.d)));
    for (let i = 0; i < 7; i++) { const d = K.shiftDays(wk.from, i); if (!have.has(d)) c.missing.push(d); }
    for (const r of rowsOf(q(`SELECT unmapped_names n FROM labour_day WHERE business_date BETWEEN ? AND ? AND unmapped_names IS NOT NULL AND unmapped_names != '[]'`, [wk.from, wk.to]))) {
      try { for (const nm of JSON.parse(r.n)) if (c.unmapped.indexOf(nm) < 0) c.unmapped.push(nm); } catch (err) { /* never take the tab down */ }
    }
    c.unmapped.sort();
  }

  // ---- the heatmap STAFFING side: labour_hourly 28d to its own max — SITE-level (no dept
  // key — checked), TRUE ruler at the hour grain (the ingest writes hourly raw × 1.159 + the
  // salaried day-share per bucket), averaged per weekday over the days that HOLD a record
  // (an absent day is absent, never a zero occurrence). ----
  c.heat = null;
  const hm = rowsOf(q(`SELECT MAX(business_date) d FROM labour_hourly`))[0];
  c.hourMax = hm && hm.d ? String(hm.d) : null;
  if (c.hourMax) {
    const from28 = K.shiftDays(c.hourMax, -27);
    const rows = rowsOf(q(`SELECT business_date d, hour h, actual_minutes am, actual_cost_pence ac FROM labour_hourly WHERE business_date BETWEEN ? AND ?`, [from28, c.hourMax]));
    if (rows.length) {
      const dates = new Set(rows.map((r) => String(r.d)));
      const occ = [0, 0, 0, 0, 0, 0, 0];
      const missing = [];
      for (let i = 0; i < 28; i++) {
        const d = K.shiftDays(from28, i);
        if (dates.has(d)) occ[dowIdx(d)] += 1; else missing.push(d);
      }
      const staffM = {}, staffP = {};
      let uncostedMins = 0, staffedMinutes = 0, openSlots = 0;
      for (const r of rows) {
        const mins = num(r.am) || 0;
        const ac = num(r.ac);
        const h = num(r.h);
        if (h == null) continue;
        if (mins > 0) { staffedMinutes += mins; openSlots += 1; if (ac == null) uncostedMins += mins; }
        if (h >= 11 && h <= 21) {
          const key = `${dowIdx(String(r.d))}-${h}`;
          staffM[key] = (staffM[key] || 0) + mins;
          staffP[key] = (staffP[key] || 0) + (ac || 0);
        }
      }
      c.heat = { from: from28, to: c.hourMax, occ, missing, staffM, staffP, uncostedMins, staffedMinutes, openSlots, demand: null, budget: null };
    }
  }
  // ---- the REQUIRED side inputs: the line-grain demand curve (LOCAL London hour, ONLINE
  // excluded — no true hour) + the last settled week's formula budget ----
  if (c.heat) {
    const amx = rowsOf(q(`SELECT MAX(business_date) d FROM sales_receipts_api`))[0];
    const apiMax = amx && amx.d ? String(amx.d) : null;
    if (apiMax) {
      const dFrom = K.shiftDays(apiMax, -27);
      const buckets = rowsOf(q(
        `SELECT r.business_date d, l.time_of_sale_ms/3600000 hb, SUM(l.net_without_tax_pence) net
           FROM sales_receipt_lines_api l
           JOIN sales_receipts_api r ON r.receipt_id = l.receipt_id
           LEFT JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
          WHERE ${SALE_WHERE} AND r.business_date BETWEEN ? AND ? AND l.time_of_sale_ms > 0
            AND COALESCE(m.channel_label,'') <> 'ONLINE ORDER'
          GROUP BY d, hb`, [dFrom, apiMax]));
      if (buckets.length) {
        const online = rowsOf(q(
          `SELECT SUM(l.net_without_tax_pence) net
             FROM sales_receipt_lines_api l
             JOIN sales_receipts_api r ON r.receipt_id = l.receipt_id
             JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
            WHERE ${SALE_WHERE} AND r.business_date BETWEEN ? AND ? AND m.channel_label = 'ONLINE ORDER'`, [dFrom, apiMax]))[0];
        const cells = {}; let total = 0;
        for (const b of buckets) {
          const bkt = num(b.hb);
          if (bkt == null) continue;
          const net = num(b.net) || 0;
          const h = londonHourOf(bkt * 3600000 + 1800000); // bucket midpoint — offset-constant
          total += net; // ALL timed non-online net funds the share denominator (outside-grid too)
          cells[`${dowIdx(String(b.d))}-${h}`] = (cells[`${dowIdx(String(b.d))}-${h}`] || 0) + net;
        }
        if (total > 0) c.heat.demand = { cells, total, apiMax, from: dFrom, onlineExcluded: online ? num(online.net) || 0 : 0 };
      }
    }
    if (c.week && c.inter && num(c.inter.net) > 0 && num(c.inter.sal) != null) {
      // LIKE-FOR-LIKE BASIS (2026-08-19, data-wiring audit). The two sides of this heatmap were
      // measured over different populations. STAFFED comes from labour_hourly, which by design
      // holds only what the people IN each hour cost — a salaried person who is OFF is in no hour,
      // so their fixed daily cost never reaches the grain. REQUIRED spread a budget containing
      // EVERY salaried penny. So every cell was short by the unallocated salary and the whole grid
      // leaned "understaffed" — measured at £1,637 over 28 days, diverging on 407 of 505 days.
      //
      // Rather than push absent salary into labour_hourly (which would redefine what that table has
      // always meant for every consumer), scale the required side onto the same visible-hours basis:
      // the share of day-grain cost that actually reaches the hour grain over the same window. Both
      // sides then describe the hours the grid can see. The ratio is stated on the panel, because a
      // silently adjusted budget is its own kind of lie.
      const alloc = rowsOf(q(
        `SELECT (SELECT COALESCE(SUM(actual_cost_pence),0) FROM labour_hourly WHERE business_date BETWEEN ? AND ?) hourly,
                (SELECT COALESCE(SUM(actual_cost_pence),0) FROM labour_day    WHERE business_date BETWEEN ? AND ?) day`,
        [c.week.from, c.week.to, c.week.from, c.week.to]))[0] || {};
      const dayCost = num(alloc.day) || 0;
      const hourCost = num(alloc.hourly) || 0;
      const ratio = dayCost > 0 ? Math.min(1, hourCost / dayCost) : null;
      const raw = Math.round(num(c.inter.sal) + C.varRate * num(c.inter.net));
      c.heat.budget = {
        pence: ratio != null ? Math.round(raw * ratio) : raw,
        rawPence: raw, allocRatio: ratio,
        days: num(c.inter.days) || 0, from: c.week.from, to: c.week.to,
      };
    }
  }

  // ---- the ruled-in person classes (the compliance panel) + the ratio inputs ----
  // U18 working-time flags — AGGREGATED per person/kind across ALL history (the systemic
  // pattern; a 20-row tail hid it). Rules cited at ingest (WTR 1998 young workers).
  c.wtr = rowsOf(q(`SELECT user_name, kind, COUNT(*) n, MAX(business_date) last FROM labour_wtr_flags GROUP BY user_name, kind`));
  c.wtrTotal = rowsOf(q(`SELECT COUNT(*) n, COUNT(DISTINCT user_name) people, MIN(business_date) lo, MAX(business_date) hi FROM labour_wtr_flags`))[0] || null;
  c.parity = rowsOf(q(`SELECT user_name, role_name, kind, rc_value, locked_value FROM labour_rate_parity ORDER BY user_name, role_id`));
  c.roster = rowsOf(q(`SELECT COUNT(DISTINCT user_name) n FROM labour_shifts WHERE user_name IS NOT NULL`))[0] || null;
  c.parityPeople = rowsOf(q(`SELECT COUNT(DISTINCT user_name) n FROM labour_rate_parity`))[0] || null;

  // ---- covers demand (Phase 2 PR3b): OpenTable arrivals by weekday × hour from covers_slot, 28d to
  // the covers feed's own max — the DEMAND shape in COVERS (the true staffing driver), averaged per
  // weekday occurrence (an absent weekday is absent, never a zero). Additive: read against the
  // staffing/required grid; the working staffing heatmap is untouched. ----
  c.coversHeat = null;
  const cmx = rowsOf(q(`SELECT MAX(business_date) d FROM covers_slot`))[0];
  const cMax = cmx && cmx.d ? String(cmx.d) : null;
  if (cMax) {
    const cFrom = K.shiftDays(cMax, -27);
    const rows = rowsOf(q(`SELECT business_date d, slot_hour h, arrivals a FROM covers_slot WHERE business_date BETWEEN ? AND ?`, [cFrom, cMax]));
    if (rows.length) {
      const occ = [0, 0, 0, 0, 0, 0, 0];
      const dates = new Set(rows.map((r) => String(r.d)));
      for (let i = 0; i < 28; i++) { const d = K.shiftDays(cFrom, i); if (dates.has(d)) occ[dowIdx(d)] += 1; }
      const sum = {};
      for (const r of rows) {
        const h = num(r.h); if (h == null || h < 11 || h > 21) continue;
        sum[`${dowIdx(String(r.d))}-${h}`] = (sum[`${dowIdx(String(r.d))}-${h}`] || 0) + (num(r.a) || 0);
      }
      const avg = {}; const vals = [];
      for (const k of Object.keys(sum)) { const dw = Number(k.split('-')[0]); if (occ[dw] > 0) { const v = sum[k] / occ[dw]; avg[k] = v; if (v > 0) vals.push(v); } }
      if (vals.length) c.coversHeat = { from: cFrom, to: cMax, occ, avg, vals: vals.sort((a, b) => a - b) };
    }
  }
  return c;
}

module.exports = {
  key: 'labour', route: '/coyote/labour', workspace: 'coyote', title: 'Labour',
  sub: 'Labour command centre · TRUE-cost ruler (locked rates × 1.159 burden + salaried/365) — RC screens translate in Rota vs Actual, never mixed',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    const query = (ctx && ctx.query) || {};
    const tab = TAB_KEYS.includes(String(query.tab || '')) ? String(query.tab) : 'executive';
    const m = { now, tab, maxDate: null, canon: null };
    if (typeof q !== 'function') return m;
    // The ruled constants come from the DB (canon_constants — the engine's schema owns it).
    // Absent → m.canon stays null and render shows the EXPLICIT constants-unavailable state
    // (merge order across the two repos is not guaranteed); never a silent hardcoded default.
    m.canon = loadRuledConstants(q);
    const C = m.canon;
    const mx = rowsOf(q(`SELECT MAX(business_date) d FROM labour_day`))[0];
    m.maxDate = mx && mx.d ? String(mx.d) : null;
    if (tab === 'rota-review') { m.rr = ROTA_REVIEW.getSection(db, ctx); return m; } // delegate — no ruled-constant math
    if (!C) return m; // every other tab's math depends on the ruled constants — gate, loudly
    if (tab === 'executive') { m.exec = buildExecutive(q, m.maxDate, C); m.compliance = buildCompliance(q); }
    if (tab === 'rota') m.rota = buildRota(q, m.maxDate);
    if (tab === 'forecast') m.fc = buildForecast(q, m.maxDate, now);
    if (tab === 'kitchen' || tab === 'foh') m.dept = buildDept(q, m.maxDate, tab, now);
    if (tab === 'coverage') m.cov = buildCoverage(q, m.maxDate, C);
    return m;
  },

  render(section, ctx) {
    const m = section || {};
    const tab = TAB_KEYS.includes(String(m.tab || '')) ? String(m.tab) : 'executive';
    const now = m.now || (ctx && ctx.now) || Date.now();
    const esc = S.escapeHtml;
    const gbp = S.fmtGbpPence;
    const int = S.fmtInt;
    const hrs = (mn) => (num(mn) != null ? (num(mn) / 60).toFixed(1) + 'h' : '—');
    const pct1 = (v) => (v != null ? `${v.toFixed(1)}%` : '—');
    const signGbp = (p) => `${p >= 0 ? '+' : '−'}${gbp(Math.abs(p))}`;

    // The ruled constants — DB-read (canon_constants) in getSection; null = unavailable →
    // the EXPLICIT gate below (never silent numbers). Caption fragments derive from C so a
    // future ruling edits ONE DB row, and every rendered figure AND caption follows.
    const C = m.canon || null;
    const vTxt = C ? `${(C.varRate * 100).toFixed(1)}%` : null;         // combined var, e.g. '22.4%'
    const kTxt = C ? `${(C.varDept.kitchen * 100).toFixed(1)}%` : null; // kitchen split, e.g. '14.3%'
    const fTxt = C ? `${(C.varDept.foh * 100).toFixed(1)}%` : null;     // FOH split, e.g. '8.1%'
    const bTxt = C ? String(C.burden) : null;                           // burden multiplier, e.g. '1.159'
    const matTxt = C ? `£${Math.round(C.materialityPence / 100)}` : null; // materiality, e.g. '£45'
    const constantsUnavailable = `<div class="banner bad"><b>Ruled constants unavailable.</b> This centre's budget/burden arithmetic reads the operator-ruled constants from the engine's <span class="mono">canon_constants</span> table (single-home ruling 2026-08-10) — that table is missing or incomplete on this database, so NO formula figures render (a silent hardcoded default is forbidden). Unlock: deploy the engine schema that seeds <span class="mono">canon_constants</span> (the canon-constants PR), then reload.</div>`;

    // Page styles: the RCC canon + the shell grammar (the reports/reservations idiom) + the
    // page-local chart grammars + the lb-* subset the held coverage panels arrived in.
    const styles = `<style>${S.rcc.css()}</style><style>
      .rcc .r-tabs{display:flex;gap:4px;border-bottom:1px solid var(--rline);margin:0 0 14px;overflow:auto}
      .rcc .r-tab{color:#9ba4ae;padding:11px 14px;font-weight:700;border-bottom:2px solid transparent;white-space:nowrap;text-decoration:none;font-size:13px}
      .rcc .r-tab.active{color:#fff;border-bottom-color:var(--raccent)}
      .rcc .r-grid{display:grid;gap:14px}
      .rcc .r-kpi-grid{grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:8px}
      .rcc .r-two-col{grid-template-columns:minmax(0,2fr) minmax(330px,1fr);margin-bottom:14px}
      .rcc .r-three-col{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px}
      @media(max-width:1200px){.rcc .r-kpi-grid{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:1100px){.rcc .r-three-col{grid-template-columns:1fr}}
      @media(max-width:820px){.rcc .r-two-col{grid-template-columns:1fr}.rcc .r-kpi-grid{grid-template-columns:repeat(2,1fr)}}
      .rcc .r-legend{display:flex;gap:12px;flex-wrap:wrap;color:#aeb6bf;font-size:11px}
      .rcc .r-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
      .rcc .r-mini-note{color:#8f99a4;font-size:10.5px;margin-top:10px;line-height:1.5}
      .rcc .r-meters{display:grid;gap:10px}
      .rcc .chart-wrap{height:250px;position:relative}
      .rcc .chart-wrap svg{width:100%;height:100%;display:block;overflow:visible}
      .rcc .gridline{stroke:#2a3138;stroke-width:1}
      .rcc .axistext{fill:#7f8994;font-size:11px}
      .rcc .lbc-caption{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--muted,#7a8);margin:8px 2px 2px;line-height:1.55}
      .rcc .lbc-pairs{display:flex;gap:8px;align-items:stretch;height:170px;padding:4px 2px 0}
      .rcc .lbc-day{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;border-bottom:1px solid #2a3138;min-width:0}
      .rcc .lbc-bars{display:flex;gap:3px;align-items:flex-end;width:100%;height:140px;justify-content:center}
      .rcc .lbc-bar{width:38%;max-width:16px;border-radius:3px 3px 1px 1px;min-height:2px}
      .rcc .lbc-bar.sched{background:${S.rcc.tokens.blue}}
      .rcc .lbc-bar.act{background:${S.rcc.tokens.accent}}
      .rcc .lbc-daylabel{color:#7f8994;font-size:9px;margin:6px 0 4px;white-space:nowrap}
      /* HOURS | COSTS segmented control (Rota vs Actual) — client-only mode swap, COSTS default */
      .rcc .lbc-seg{display:inline-flex;gap:2px;border:1px solid #2e363f;background:#11161a;border-radius:9px;padding:2px;margin:0 0 12px}
      .rcc .lbc-seg button{font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.05em;color:#9ba4ae;background:none;border:0;border-radius:7px;padding:5px 14px;cursor:pointer}
      .rcc .lbc-seg button.active{background:#232b33;color:#fff}
      .rcc .lbc-hide{display:none}
      .rcc .lbc-bar.net{background:${S.rcc.tokens.blue}}
      .rcc .lbc-bar.dept{background:${S.rcc.tokens.cyan}}
      /* the P4 what-if slider grammar (reports forecast idiom) — CLIENT-side only here */
      .rcc .slider-wrap{border:1px solid #2e363f;background:#11161a;border-radius:12px;padding:13px;margin-top:12px}
      .rcc .slider-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:9px}
      .rcc .slider-head b{font-size:18px}
      .rcc .slider-wrap input[type=range]{width:100%;accent-color:${S.rcc.tokens.accent}}
      .rcc .lbc-drivers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      @media(max-width:900px){.rcc .lbc-drivers{grid-template-columns:1fr}}
      .rcc .lbc-mix{font-family:var(--font-mono,monospace);font-size:11px;color:#9aa8b5;margin-top:10px}
      /* coverage heatmap — the RCC drivers-heatmap frame (weekday × 11:00–21:00) */
      .rcc .r-heatmap{display:grid;grid-template-columns:58px repeat(11,1fr);gap:5px;align-items:center}
      .rcc .r-hlabel{color:#818b95;font-size:10px;text-align:center}
      .rcc .r-hday{color:#b3bbc4;font-size:11px;font-weight:700}
      @media(max-width:820px){.rcc .r-heatmap{grid-template-columns:42px repeat(11,32px);overflow:auto}}
      .rcc .lbc-arch{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      @media(max-width:1100px){.rcc .lbc-arch{grid-template-columns:repeat(2,1fr)}}
      /* absorbed coverage panels — the old labour page's grammar, carried with them */
      .lb-two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
      @media(max-width:900px){.lb-two{grid-template-columns:1fr}}
      .lb-hint{font-size:12px;line-height:1.5;color:var(--muted,#8b98a5);margin:2px 0 12px}
      .lb-sec{font-size:15px;font-weight:700;color:var(--text,#e8edf2);margin:26px 0 12px;display:flex;align-items:center;gap:10px}
      .lb-sec::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.10)}
      .lb-sub{font-size:11px;font-weight:500;color:var(--muted,#8b98a5);text-transform:none;letter-spacing:0}
      .lb-tbl{width:100%;border-collapse:collapse;font-size:13px}
      .lb-tbl th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b98a5);font-weight:600;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.10)}
      .lb-tbl td{padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.05)}
      .lb-tbl td.n{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono,ui-monospace,monospace)}
      .lb-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:4px 6px 10px}
      .lb-cardhead{font-size:13px;font-weight:700;padding:12px 12px 8px;display:flex;justify-content:space-between;align-items:baseline}
      .lb-live{border:1px solid var(--cyan-dim,rgba(34,211,238,.28));border-radius:14px;padding:2px 16px 14px;margin-bottom:6px;background:rgba(34,211,238,.03)}
      .G{color:var(--green,#34d399)} .A{color:var(--amber,#e0b050)} .R{color:var(--red,#f87171)}
    </style>`;

    const tabsNav = `<div class="r-tabs">${TABS.map((t) =>
      `<a class="r-tab${t.key === tab ? ' active' : ''}" href="/coyote/labour?tab=${t.key}">${esc(t.label)}</a>`).join('')}</div>`;

    const noWire = (what) => `<div class="banner muted">No settled labour-day record yet — ${what} light(s) up as the RotaCloud ingest fills <span class="mono">labour_day</span> (TRUE ruler: locked rates × ${bTxt} burden + salaried/365). Nothing here is ever estimated.</div>`;

    // ============================ EXECUTIVE ============================
    const renderExecutiveTab = () => {
      // ---- compliance sweep (operator brief 2026-08-18; names by the same brief). Built
      // FIRST and rendered on BOTH paths — sweep findings read their own table and do not
      // depend on the labour aggregates being wired. ----
      const comp = m.compliance;
      let compliancePanel = '';
      if (comp) {
        const KINDS = { missed_in: ['missed clock-in', 'bad'], missed_out: ['missed clock-out', 'bad'], late: ['late', 'warn'] };
        const clockBody = comp.clock.length
          ? comp.clock.slice(0, 12).map((r) => {
            const [lab, tone] = KINDS[r.kind] || [String(r.kind), 'warn'];
            return `<div class="r-lrow"><div style="min-width:0"><div style="font-weight:600">${esc(r.user_name || '?')}${r.role_name ? ` <span style="color:var(--rmuted);font-weight:400">· ${esc(r.role_name)}</span>` : ''}</div>`
              + `<div style="font-size:12px;color:var(--rmuted);margin-top:2px">${esc(r.business_date || '')} — ${esc(r.detail || '')}</div></div>${S.rcc.tag(lab, tone)}</div>`;
          }).join('') + (comp.clock.length > 12 ? `<div class="r-mini-note">…and ${comp.clock.length - 12} more in this sweep.</div>` : '')
          : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">Clock record clean — every completed shift clocked in and out, nobody over the lateness line.</div>`;
        const sickBody = comp.sick.length
          ? comp.sick.slice(0, 8).map((r) => `<div class="r-lrow"><div style="font-weight:600">${esc(r.user_name || '?')}</div>`
            + `<div class="mono" style="font-size:12.5px">${esc(String(num(r.days) ?? '?'))}d since ${esc(String(r.window_from || ''))}</div></div>`).join('')
          : `<div class="r-lrow" style="color:var(--rmuted);font-size:13px">No sick leave recorded this measuring year.</div>`;
        compliancePanel = `<div class="r-grid r-two-col">`
          + S.rcc.panel({
            title: 'Compliance sweep — clock record',
            sub: `latest: ${comp.runKind} · ${comp.sweepDate} — weekly Monday + payroll morning (engine timer); Jordan Williams exempt by rule`,
            body: clockBody,
          })
          + S.rcc.panel({
            title: 'Sick days — measuring year from 1 April',
            sub: 'RotaCloud leave record, sweep-refreshed — totals, not judgements',
            body: sickBody,
          })
          + `</div>`;
      }

      const e = m.exec;
      if (!e) return noWire('the executive control view') + compliancePanel;
      const wk = e.week;
      const agg = e.agg && num(e.agg.days) > 0 ? e.agg : null;
      const inter = e.inter && num(e.inter.days) > 0 && num(e.inter.net) > 0 ? e.inter : null;

      // ---- (1) KPI strip: six tiles, every one captions its ruler ----
      const labPct = inter ? (num(inter.ac) / num(inter.net)) * 100 : null;
      const budPct = inter ? ((num(inter.sal) + C.varRate * num(inter.net)) / num(inter.net)) * 100 : null;
      const splh = inter && num(inter.am) > 0 ? Math.round(num(inter.net) / (num(inter.am) / 60)) : null;
      const otMins = e.ot && num(e.ot.mins) != null ? num(e.ot.mins) : null;
      const schedVar = agg && num(agg.sc) != null && num(agg.ac) != null ? num(agg.ac) - num(agg.sc) : null;
      const salShare = agg && num(agg.ac) > 0 && num(agg.sal) != null ? (num(agg.sal) / num(agg.ac)) * 100 : null;
      const kpis = [
        S.rcc.kpi({
          label: 'Labour % of net', value: pct1(labPct),
          delta: labPct != null && budPct != null
            ? { dir: labPct <= budPct ? 'up' : 'down', text: `${labPct - budPct >= 0 ? '+' : '−'}${Math.abs(labPct - budPct).toFixed(1)}pp vs formula ${budPct.toFixed(1)}%` }
            : null,
          sub: inter ? `TRUE ÷ net · ${int(num(inter.days))} intersection day(s)` : 'no day holds both labour and sales this week',
        }),
        S.rcc.kpi({
          label: 'Labour £ / week', value: agg ? gbp(num(agg.ac)) : '—',
          sub: agg ? `TRUE all-in (burdened + salaried/365) · ${int(num(agg.days))} day(s)` : 'no labour_day rows this week',
        }),
        S.rcc.kpi({
          label: 'SPLH', value: splh != null ? gbp(splh) : '—',
          sub: inter ? `net ÷ worked hrs · intersection day(s) only` : 'needs sales ∩ labour days',
        }),
        S.rcc.kpi({
          label: 'Overtime / variance hrs', value: otMins != null ? hrs(otMins) : '—',
          sub: otMins != null ? `Σ positive shift variance (labour_shifts)` : 'no shift variance recorded this week',
        }),
        S.rcc.kpi({
          label: 'Sched vs actual £', value: schedVar != null ? signGbp(schedVar) : '—',
          sub: 'TRUE-basis approx · labour_day scheduled vs actual cost',
        }),
        S.rcc.kpi({
          label: 'Salaried share', value: pct1(salShare),
          sub: 'salaried/365 ÷ TRUE actual · labour_day',
        }),
      ].join('');
      const kpiCaption = `<div class="lbc-caption">window = the last full Mon–Sun week ${esc(wk.from)} → ${esc(wk.to)} · ruler: TRUE all-in (labour_day — locked rates × ${bTxt} burden + salaried/365); RC-screen figures never render on this tab · % and SPLH divide over the sales∩labour intersection only (${inter ? int(num(inter.days)) : 0} day(s)) · formula budget = (Σ salaried + ${vTxt} × net) ÷ net — kitchen ${kTxt} + FOH ${fTxt}, the ruled variable splits · worked hours (SPLH denominator) include rota-as-worked for no-clock salaried.</div>`;

      // ---- (2) 13-week labour control trend (absorbs the old page's 8-week hero spark) ----
      const weeks = e.trend.weeks;
      const gapWeeks = weeks.filter((w) => w.labourDays === 0);
      const anyPct = weeks.some((w) => w.pct != null);
      let trendBody;
      if (anyPct) {
        const T = 18, B = 218, L = 56, R = 866;
        const vals = weeks.flatMap((w) => [w.pct, w.budPct]).filter((v) => v != null);
        const vMax = Math.max(...vals) + 2, vMin = Math.max(0, Math.min(...vals) - 2);
        const X = (i) => Math.round((L + (i * (R - L)) / Math.max(1, weeks.length - 1)) * 10) / 10;
        const Y = (v) => Math.round((B - ((B - T) * (v - vMin)) / Math.max(0.001, vMax - vMin)) * 10) / 10;
        const gridLines = [0, 1, 2, 3].map((i) => { const v = vMin + ((vMax - vMin) * i) / 3; return `<line x1="50" y1="${Y(v)}" x2="872" y2="${Y(v)}" class="gridline"/><text x="8" y="${Y(v) + 4}" class="axistext">${v.toFixed(1)}%</text>`; }).join('');
        const series = (key, cls, dash) => REP.contiguousRuns(weeks.map((w, i) => ({ i, v: w[key] })), (p) => p.v != null)
          .map((run) => run.length === 1
            ? `<circle cx="${X(run[0].i)}" cy="${Y(run[0].v)}" r="3.5" fill="${cls}"/>`
            : `<polyline points="${run.map((p) => `${X(p.i)},${Y(p.v)}`).join(' ')}" fill="none" stroke="${cls}" stroke-width="${dash ? 2 : 3}"${dash ? ' stroke-dasharray="5 4"' : ''}/>`).join('');
        const xlabs = weeks.map((w, i) => (i % 2 === 0 ? `<text x="${X(i) - 14}" y="243" class="axistext">${esc(dayLabel(w.from))}</text>` : '')).join('');
        trendBody = `<div class="chart-wrap"><svg viewBox="0 0 900 260" role="img" aria-label="Thirteen-week labour control trend">${gridLines}${series('budPct', S.rcc.tokens.warn, true)}${series('pct', S.rcc.tokens.accent, false)}${xlabs}</svg></div>`;
      } else {
        trendBody = S.rcc.emptyState({ title: '13-week labour control trend', blocker: 'no week in the window holds both a labour_day record and net>0 sales.', unlock: 'the daily RotaCloud + Lightspeed ingests' });
      }
      const gapCaption = gapWeeks.length
        ? ` · <b>${int(gapWeeks.length)} week(s) render as GAPS</b> — no labour_day record${juneNote(gapWeeks.map((w) => w.from))}; gaps are stated, never bridged or interpolated`
        : '';
      const trendPanel = S.rcc.panel({
        title: '13-week labour control trend', sub: 'weekly TRUE labour % of net vs the formula budget % · sales∩labour intersection days',
        headRight: `<div class="r-legend"><span><i style="background:${S.rcc.tokens.accent}"></i>Labour % (TRUE)</span><span><i style="background:${S.rcc.tokens.warn}"></i>Formula budget %</span></div>`,
        body: trendBody + `<div class="r-mini-note">weekly labour % = Σ TRUE cost ÷ Σ net over each week's intersection days · budget % = (Σ salaried + ${vTxt} × net) ÷ net${gapCaption}. This trend ABSORBED the old labour hero spark — one home.</div>`,
      });

      // ---- (3) owner attention queue ----
      const alerts = [];
      for (const v of e.verdicts) {
        alerts.push(S.rcc.alert({
          title: `${v.dept.toUpperCase()} — ${v.mode.toUpperCase()} w/c ${v.week}`,
          text: `rota-review verdict vs the formula budget${v.budgetPence != null ? ` ${gbp(v.budgetPence)}` : ''}${v.salariedPence != null ? ` (salaried ${gbp(v.salariedPence)} inside)` : ''}`,
          impact: v.deltaPence > 0 ? `${gbp(v.deltaPence)} OVER` : `${gbp(-v.deltaPence)} under`,
          tone: v.deltaPence > C.materialityPence ? 'bad' : v.deltaPence > 0 ? undefined : 'good',
        }));
      }
      const wtrN = e.wtrCount ? num(e.wtrCount.n) || 0 : 0;
      if (wtrN > 0) alerts.push(S.rcc.alert({ title: 'U18 working-time flags', text: 'WTR 1998 breaches across all history — the full per-person table holds on Coverage & People', impact: `${int(wtrN)} flag(s)`, tone: 'bad' }));
      const parN = e.parityCount ? num(e.parityCount.n) || 0 : 0;
      if (parN > 0) alerts.push(S.rcc.alert({ title: 'Rate parity findings', text: 'RotaCloud stored rates disagree with the locked table — RC screens mis-cost until fixed in RotaCloud (detail on Coverage & People)', impact: `${int(parN)} finding(s)` }));
      if (e.unmapped.length) alerts.push(S.rcc.alert({ title: 'Unmapped shifts this week', text: `no stored mapping for: ${e.unmapped.join(', ')} — data hygiene, fix the mapping in RotaCloud`, impact: `${int(e.unmapped.length)} name(s)` }));
      const hasRuns = e.hasRuns && num(e.hasRuns.n) > 0;
      const queueBody = alerts.length
        ? `<div style="display:grid;gap:8px">${alerts.join('')}</div>`
        : `<div class="r-alert good"><div class="r-bar"></div><div><h4>All clear</h4><p>${hasRuns ? 'no verdict deltas, WTR flags, parity findings or unmapped shifts on record.' : 'no rota-review runs on record yet — the cadence timers persist them; no WTR/parity/unmapped findings.'}</p></div><div class="r-impact"></div></div>`;
      const queuePanel = S.rcc.panel({
        title: 'Owner attention queue', sub: 'ranked findings, £-valued · verdicts from the latest FORWARD + HINDSIGHT runs',
        headRight: `<a class="r-pill" href="/coyote/labour?tab=rota-review">Rota Review →</a>`,
        body: queueBody + `<div class="r-mini-note">the full verdict receipts (per-daypart items + the week-on-week run history) are on the <a href="/coyote/labour?tab=rota-review" style="color:${S.rcc.tokens.accent2}">Rota Review tab</a>. The People exception queue is EXCLUDED BY RULING (surveillance boundary): people appear as rota-structural facts only.</div>`,
      });

      // ---- (4) labour variance bridge (waterfall) ----
      const b = e.bridge;
      let bridgeBody;
      if (b.sched != null && b.actual != null) {
        const comps = [
          { lab: 'Rate mix', v: b.rateMix, note: 'dept-level £/min drift (labour_dept) × burden' },
          { lab: 'Hours var', v: b.hoursVar, note: `rota'd shifts run over/under (${b.hoursVarMins != null ? hrs(b.hoursVarMins) : '—'})` },
          { lab: `Unrota'd`, v: b.unrota, note: `${int(b.unrotaN)} worked shift(s) with no rota line` },
          { lab: 'Not worked', v: b.unworked, note: `${int(b.unworkedN)} rota'd shift(s) not worked` },
        ];
        const known = comps.reduce((x, c) => x + (c.v || 0), 0);
        const remainder = (b.actual - b.sched) - known;
        comps.push({ lab: 'Remainder', v: remainder, note: 'rounding + rate-less shifts + ruler-translation residue — labelled, never hidden' });
        // waterfall geometry
        const steps = [{ lab: 'Scheduled', abs: b.sched }];
        let cum = b.sched;
        for (const c of comps) { steps.push({ lab: c.lab, delta: c.v || 0, from: cum, to: cum + (c.v || 0) }); cum += c.v || 0; }
        steps.push({ lab: 'Actual', abs: b.actual });
        const lo = Math.min(...steps.map((s) => (s.abs != null ? 0 : Math.min(s.from, s.to))), 0);
        const hi = Math.max(...steps.map((s) => (s.abs != null ? s.abs : Math.max(s.from, s.to))), 1);
        const H = 190, T = 26;
        const Y = (v) => Math.round((T + (H - T) * (1 - (v - lo) / Math.max(1, hi - lo))) * 10) / 10;
        const W = 900, bw = Math.floor((W - 40) / steps.length) - 14;
        const bars = steps.map((s, i) => {
          const x = 24 + i * (bw + 14);
          let y0, y1, fill;
          if (s.abs != null) { y0 = Y(s.abs); y1 = Y(0); fill = i === 0 ? '#56616e' : S.rcc.tokens.accent; }
          else { y0 = Y(Math.max(s.from, s.to)); y1 = Y(Math.min(s.from, s.to)); fill = s.delta >= 0 ? S.rcc.tokens.bad : S.rcc.tokens.good; }
          const h = Math.max(2, y1 - y0);
          const val = s.abs != null ? gbp(s.abs) : signGbp(s.delta);
          return `<rect x="${x}" y="${y0}" width="${bw}" height="${h}" rx="3" fill="${fill}"/>`
            + `<text x="${x + bw / 2}" y="${y0 - 6}" text-anchor="middle" class="axistext">${esc(val)}</text>`
            + `<text x="${x + bw / 2}" y="${H + 16}" text-anchor="middle" class="axistext">${esc(s.lab)}</text>`;
        }).join('');
        bridgeBody = `<div class="chart-wrap" style="height:220px"><svg viewBox="0 0 ${W} ${H + 24}" role="img" aria-label="Labour variance bridge — scheduled to actual">${bars}</svg></div>
          <div class="r-mini-note">${comps.map((c) => `${esc(c.lab)}: <b>${c.v != null ? esc(signGbp(c.v)) : '—'}</b> — ${esc(c.note)}`).join(' · ')}.</div>
          <div class="r-mini-note">endpoints = labour_day scheduled → actual TRUE £ for ${esc(wk.from)} → ${esc(wk.to)} · shift effects at the shift's locked rate × ${bTxt} burden (salaried/365 sits identically in both endpoints, so it cancels) · AGGREGATE only — no person keys, ever.</div>`;
      } else {
        bridgeBody = S.rcc.emptyState({ title: 'Labour variance bridge', blocker: 'no labour_day scheduled + actual cost pair in the last full week.', unlock: 'the daily RotaCloud ingest' });
      }
      const bridgePanel = S.rcc.panel({
        title: 'Labour variance bridge', sub: `scheduled → actual £, decomposed by driver · ${wk.from} → ${wk.to}`,
        body: bridgeBody,
      });

      // ---- (5) department control ----
      const dc = e.deptCtl;
      const deptCard = (d) => {
        const name = d.dept === 'kitchen' ? 'Kitchen' : 'Front of House';
        const rate = `${(C.varDept[d.dept] * 100).toFixed(1)}%`;
        if (d.trueVar == null || d.budget == null) {
          return S.rcc.panel({
            title: `Department control — ${name}`, sub: `variable TRUE vs ${rate} × net`,
            body: S.rcc.emptyState({ title: `${name} week control`, blocker: dc.interDays === 0 ? 'no sales∩labour intersection day this week — the budget side needs net.' : `no ${name} labour_dept rows on the intersection days.`, unlock: 'the daily ingests' }),
          });
        }
        return S.rcc.panel({
          title: `Department control — ${name}`, sub: `variable TRUE vs the ruled ${rate} × net · ${int(dc.interDays)} intersection day(s)`,
          headRight: ruledChip(C, d.delta, 'OVER', 'UNDER budget', 'On budget'),
          body: `<table><tbody>
              <tr><td>Variable TRUE cost</td><td class="r-num mono">${gbp(d.trueVar)}</td></tr>
              <tr><td>Variable budget (${esc(rate)} × ${gbp(dc.interNet)} net)</td><td class="r-num mono">${gbp(d.budget)}</td></tr>
              <tr><td>Delta</td><td class="r-num mono">${signGbp(d.delta)}</td></tr>
              <tr><td>Worked hours (intersection days)</td><td class="r-num mono">${hrs(d.mins)}</td></tr>
            </tbody></table>
            <div class="r-mini-note">variable TRUE = dept hourly cost × ${bTxt} burden; the salaried term sits identically in the ruled budget (salaried burdened + var% × net) and in TRUE cost, so it cancels and the delta is exact · OVER only beyond the ruled ${matTxt} materiality · senior-mix vs the ruled &gt;40% MIX threshold is omitted — labour_shifts carries no department key (the rota-review verdicts carry the ruled MIX notes).</div>`,
        });
      };
      const deptRow = `<div class="r-grid r-three-col">${bridgePanel}${dc.depts.map(deptCard).join('')}</div>`;

      // ---- (6) daily control strip ----
      const stripMissing = e.strip.filter((r) => !r.lab).map((r) => r.date);
      const stripRows = e.strip.map((r) => {
        if (!r.lab) {
          return `<tr><td>${esc(dowLabel(r.date))} ${esc(r.date)}</td><td class="r-num mono">${r.net != null ? gbp(r.net) : '—'}</td>
            <td class="r-num mono ash" colspan="3">no labour record</td><td>${S.rcc.tag('no labour')}</td><td class="r-num mono">—</td></tr>`;
        }
        const netOk = r.net != null && r.net > 0;
        const pctV = netOk && r.lab.ac != null ? (r.lab.ac / r.net) * 100 : null;
        const budV = netOk ? (((r.lab.sal || 0) + Math.round(C.varRate * r.net)) / r.net) * 100 : null;
        const delta = netOk && r.lab.ac != null ? r.lab.ac - ((r.lab.sal || 0) + Math.round(C.varRate * r.net)) : null;
        const daySplh = netOk && num(r.lab.am) > 0 ? Math.round(r.net / (num(r.lab.am) / 60)) : null;
        return `<tr><td>${esc(dowLabel(r.date))} ${esc(r.date)}</td>
          <td class="r-num mono">${r.net != null ? gbp(r.net) : '<span class="ash">no sales record</span>'}</td>
          <td class="r-num mono">${gbp(r.lab.ac)}</td>
          <td class="r-num mono">${pct1(pctV)}</td>
          <td class="r-num mono">${pct1(budV)}</td>
          <td>${netOk ? ruledChip(C, delta, 'Over', 'Under formula', 'On formula') : S.rcc.tag('no net')}</td>
          <td class="r-num mono">${daySplh != null ? gbp(daySplh) : '—'}</td></tr>`;
      }).join('');
      const stripPanel = S.rcc.panel({
        title: 'Daily control strip', sub: `last 7 days to ${e.maxDate} · TRUE labour vs the daily formula budget`,
        body: `<div style="overflow:auto"><table><thead><tr><th>Day</th><th class="r-num">Net</th><th class="r-num">TRUE labour £</th><th class="r-num">Labour %</th><th class="r-num">Budget %</th><th>Status</th><th class="r-num">SPLH</th></tr></thead><tbody>${stripRows}</tbody></table></div>
          <div class="r-mini-note">daily budget = salaried + ${vTxt} × net (the ruled splits) · STATUS: OVER only beyond the ${matTxt} materiality · an absent labour day says so${stripMissing.length ? esc(juneNote(stripMissing)) : ''} — never a zero · the labour DETAIL home is here; the Revenue Drivers scorecard keeps its cross-domain columns and points here.</div>`,
      });

      return `<div class="r-grid r-kpi-grid">${kpis}</div>${kpiCaption}
        <div class="r-grid r-two-col">${trendPanel}${queuePanel}</div>
        ${deptRow}${stripPanel}${compliancePanel}`;
    };

    // ============================ ROTA VS ACTUAL ============================
    const renderRotaTab = () => {
      const r = m.rota;
      if (!r) return noWire('rota vs actual');
      const days = r.days || [];

      // ---- (1) daily chart: 14d paired columns sched vs actual — DUAL-RENDERED (HOURS +
      // COSTS panels both server-side; the client-only toggle swaps visibility, COSTS default).
      // The HOURS branch is the pre-toggle chart UNCHANGED (the negative control — costs is an
      // ADDITIVE layer); the shared day frame (all14/byDate/missing) is hoisted, output-identical.
      const all14 = [];
      for (let i = 13; i >= 0; i--) all14.push(K.shiftDays(r.maxDate, -i));
      const byDate = new Map(days.map((d) => [d.date, d]));
      const missing = all14.filter((iso) => !byDate.has(iso));
      let hoursBody;
      const withMins = days.filter((d) => d.sm != null || d.am != null);
      if (withMins.length) {
        const maxMin = Math.max(...withMins.flatMap((d) => [d.sm || 0, d.am || 0]), 1);
        const cols = all14.map((iso) => {
          const d = byDate.get(iso);
          if (!d) return `<div class="lbc-day" title="${esc(`${dowLabel(iso)} ${iso} — no labour record`)}"><div class="lbc-bars"></div><span class="lbc-daylabel">${esc(dayLabel(iso))}</span></div>`;
          const hS = Math.max(2, Math.round(((d.sm || 0) / maxMin) * 140));
          const hA = Math.max(2, Math.round(((d.am || 0) / maxMin) * 140));
          const tip = `${dowLabel(iso)} ${iso} — rota'd ${hrs(d.sm)} · worked ${hrs(d.am)}`;
          return `<div class="lbc-day" title="${esc(tip)}"><div class="lbc-bars"><div class="lbc-bar sched" style="height:${hS}px"></div><div class="lbc-bar act" style="height:${hA}px"></div></div><span class="lbc-daylabel">${esc(dayLabel(iso))}</span></div>`;
        }).join('');
        hoursBody = `<div class="lbc-pairs">${cols}</div>
          <div class="r-mini-note">hours only (minute grain, ruler-free) · labour_day scheduled vs actual minutes${missing.length ? ` · <b>${int(missing.length)} day(s) have no labour_day record</b> — absent${esc(juneNote(missing))}, never zero` : ''}.</div>`;
      } else {
        hoursBody = S.rcc.emptyState({ title: 'Daily hours — scheduled vs actual', blocker: 'no labour_day minutes in the 14-day window.', unlock: 'the daily RotaCloud ingest' });
      }
      const hoursPanel = S.rcc.panel({
        title: 'Daily hours: scheduled vs actual', sub: `14 days to ${r.maxDate}`,
        headRight: `<div class="r-legend"><span><i style="background:${S.rcc.tokens.blue}"></i>Scheduled</span><span><i style="background:${S.rcc.tokens.accent}"></i>Actual</span></div>`,
        body: hoursBody,
      });

      // COSTS mode: per day, sched vs actual TRUE £ from labour_day (scheduled_cost_pence /
      // actual_cost_pence) — the day-grain truth INCLUDING the salaried slice. The Σ footer is
      // a source-identity statement, not a second computation pretending independence.
      let costChartBody;
      const withCost = days.filter((d) => d.sc != null || d.ac != null);
      if (withCost.length) {
        const maxPence = Math.max(...withCost.flatMap((d) => [d.sc || 0, d.ac || 0]), 1);
        const cols = all14.map((iso) => {
          const d = byDate.get(iso);
          if (!d) return `<div class="lbc-day" title="${esc(`${dowLabel(iso)} ${iso} — no labour record`)}"><div class="lbc-bars"></div><span class="lbc-daylabel">${esc(dayLabel(iso))}</span></div>`;
          const hS = Math.max(2, Math.round(((d.sc || 0) / maxPence) * 140));
          const hA = Math.max(2, Math.round(((d.ac || 0) / maxPence) * 140));
          const tip = `${dowLabel(iso)} ${iso} — rota'd ${gbp(d.sc)} · worked ${gbp(d.ac)}`;
          return `<div class="lbc-day" title="${esc(tip)}"><div class="lbc-bars"><div class="lbc-bar sched" style="height:${hS}px"></div><div class="lbc-bar act" style="height:${hA}px"></div></div><span class="lbc-daylabel">${esc(dayLabel(iso))}</span></div>`;
        }).join('');
        const acDays = days.filter((d) => d.ac != null);
        const sumAc = acDays.reduce((s, d) => s + d.ac, 0);
        costChartBody = `<div class="lbc-pairs">${cols}</div>
          <div class="r-mini-note">TRUE all-in ruler (locked rates × ${bTxt} + salaried/365; deemed staff rota-priced from 2026-07-21) — matches the surrounding Labour Centre panels${missing.length ? ` · <b>${int(missing.length)} day(s) have no labour_day record</b> — absent${esc(juneNote(missing))}, never zero` : ''}.</div>
          ${acDays.length ? `<div class="r-mini-note">Σ daily actual TRUE = ${gbp(sumAc)} — reconciles to labour_day (it IS labour_day — the source identity, stated; no second computation).</div>` : ''}`;
      } else {
        costChartBody = S.rcc.emptyState({ title: 'Daily cost — scheduled vs actual', blocker: 'no labour_day costs in the 14-day window.', unlock: 'the daily RotaCloud ingest' });
      }
      const costChartPanel = S.rcc.panel({
        title: 'Daily cost: scheduled vs actual', sub: `14 days to ${r.maxDate} · TRUE £ (labour_day)`,
        headRight: `<div class="r-legend"><span><i style="background:${S.rcc.tokens.blue}"></i>Scheduled</span><span><i style="background:${S.rcc.tokens.accent}"></i>Actual</span></div>`,
        body: costChartBody,
      });

      // ---- (2) where the extra hours came from ----
      const dOver = r.decomp.over, dUn = r.decomp.unrota, dUnder = r.decomp.under;
      const anyShift = (dOver && num(dOver.n) > 0) || (dUn && num(dUn.n) > 0) || (dUnder && num(dUnder.n) > 0);
      let decompBody;
      if (anyShift) {
        const rows = [
          { lab: `Over-rota'd shifts`, n: dOver ? num(dOver.n) || 0 : 0, mins: dOver ? num(dOver.mins) || 0 : 0, color: S.rcc.tokens.bad },
          { lab: `Unrota'd worked shifts`, n: dUn ? num(dUn.n) || 0 : 0, mins: dUn ? num(dUn.mins) || 0 : 0, color: S.rcc.tokens.warn },
          { lab: `Under-worked vs rota`, n: dUnder ? num(dUnder.n) || 0 : 0, mins: dUnder ? num(dUnder.mins) || 0 : 0, color: S.rcc.tokens.good },
        ];
        const maxM = Math.max(...rows.map((x) => x.mins), 1);
        decompBody = `<div class="r-meters">${rows.map((x) => S.rcc.meterRow({
          label: x.lab, pct: (x.mins / maxM) * 100, color: x.color, value: `${int(x.n)} · ${hrs(x.mins)}`,
        })).join('')}</div>
        <div class="r-mini-note">early-in vs late-out CANNOT be split — labour_shifts carries no per-shift clock timestamps, only variance_minutes; what IS computable renders above · SITE-level aggregate (labour_shifts carries no department key — checked) · counts and hours only, NO names — the surveillance boundary ruling · worked hours include rota-as-worked for no-clock salaried (the deemed-from-rota ruling — their variance is 0 by construction, so they never appear here).</div>`;
      } else {
        decompBody = S.rcc.emptyState({ title: 'Where the extra hours came from', blocker: 'no labour_shifts rows in the 14-day window.', unlock: 'the daily RotaCloud ingest (shift grain)' });
      }
      const decompPanel = S.rcc.panel({
        title: 'Where the extra hours came from', sub: `shift-variance decomposition · 14 days to ${r.maxDate}`,
        body: decompBody,
      });

      // COSTS mode decomposition: each class prices its minutes at the shift's OWN rate_pence
      // × 1.159 (shift grain). Counts + hours stay alongside the £ so the rate mix is readable —
      // the same hours at U18 rates and at supervisor rates are different money. Rate-less
      // shifts (clocked salaried always; deemed staff before 2026-07-21) keep their minutes in
      // the hours figures and price £0 here — captioned, never estimated.
      let costDecompBody;
      if (anyShift) {
        const pricedPence = (row) => Math.round((row && num(row.p) != null ? num(row.p) : 0) * C.burden);
        const cRows = [
          { lab: `Over-rota'd shifts`, n: dOver ? num(dOver.n) || 0 : 0, mins: dOver ? num(dOver.mins) || 0 : 0, pence: pricedPence(dOver), color: S.rcc.tokens.bad },
          { lab: `Unrota'd worked shifts`, n: dUn ? num(dUn.n) || 0 : 0, mins: dUn ? num(dUn.mins) || 0 : 0, pence: pricedPence(dUn), color: S.rcc.tokens.warn },
          { lab: `Under-worked vs rota`, n: dUnder ? num(dUnder.n) || 0 : 0, mins: dUnder ? num(dUnder.mins) || 0 : 0, pence: pricedPence(dUnder), color: S.rcc.tokens.good },
        ];
        const maxP = Math.max(...cRows.map((x) => x.pence), 1);
        costDecompBody = `<div class="r-meters">${cRows.map((x) => S.rcc.meterRow({
          label: x.lab, pct: (x.pence / maxP) * 100, color: x.color, value: `${gbp(x.pence)} · ${int(x.n)} · ${hrs(x.mins)}`,
        })).join('')}</div>
        <div class="r-mini-note">minutes priced at each shift's OWN locked rate_pence × ${bTxt} burden (shift grain) · salaried minutes carry no shift rate — priced £0 here; their cost is annual/365 at day grain · deemed staff: rota = actual by rule — zero variance on both axes by construction · £ + counts + hours together: the rate mix stays readable · SITE-level aggregate (labour_shifts carries no department key — checked) · NO names — the surveillance boundary ruling.</div>`;
      } else {
        costDecompBody = S.rcc.emptyState({ title: 'Where the extra cost came from', blocker: 'no labour_shifts rows in the 14-day window.', unlock: 'the daily RotaCloud ingest (shift grain)' });
      }
      const costDecompPanel = S.rcc.panel({
        title: 'Where the extra cost came from', sub: `shift-variance decomposition, priced at shift rates × ${bTxt} · 14 days to ${r.maxDate}`,
        body: costDecompBody,
      });

      // ---- (3) daily labour reconciliation table ----
      let reconBody;
      if (days.length) {
        const rows = days.map((d) => {
          const delta = d.sc != null && d.ac != null ? d.ac - d.sc : null;
          return `<tr><td>${esc(dowLabel(d.date))} ${esc(d.date)}</td>
            <td class="r-num mono">${hrs(d.sm)}</td><td class="r-num mono">${gbp(d.sc)}</td>
            <td class="r-num mono">${hrs(d.am)}</td><td class="r-num mono">${gbp(d.ac)}</td>
            <td class="r-num mono">${hrs(d.apm)}</td>
            <td class="r-num mono">${delta != null ? signGbp(delta) : '—'}</td>
            <td>${ruledChip(C, delta, 'Over sched', 'Under sched', 'On sched')}</td></tr>`;
        }).join('');
        reconBody = `<div style="overflow:auto"><table><thead><tr><th>Day</th><th class="r-num">Sched hrs</th><th class="r-num">Sched £</th><th class="r-num">Actual hrs</th><th class="r-num">Actual £</th><th class="r-num">Paid hrs</th><th class="r-num">Δ £</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="r-mini-note">£ = TRUE ruler (labour_day, burdened + salaried/365) · paid hrs = actual_paid_minutes (RotaCloud's paid figure) · a missing day is an ABSENT row, never zeros · STATUS vs schedule: over only beyond the ruled ${matTxt} materiality.</div>`;
      } else {
        reconBody = S.rcc.emptyState({ title: 'Daily labour reconciliation', blocker: 'no labour_day rows in the 14-day window.', unlock: 'the daily RotaCloud ingest' });
      }
      const reconPanel = S.rcc.panel({ title: 'Daily labour reconciliation', sub: 'scheduled vs actual vs paid · TRUE £', body: reconBody });

      // ---- (4) department schedule accuracy ----
      const acc = r.accuracy;
      let accBody = '';
      if (acc && num(acc.n) > 0) {
        const pctIn = (num(acc.w) / num(acc.n)) * 100;
        accBody += `<div class="r-callout"><strong>${pctIn.toFixed(1)}%</strong> of ${int(num(acc.n))} rota'd shift(s) landed within ±15 min of plan — <b>SITE-level</b>: labour_shifts carries no department key (checked), so a per-dept shift-accuracy split is not computable; it lands when the shift wire carries one.</div>`;
      } else {
        accBody += S.rcc.emptyState({ title: 'Shift accuracy', blocker: `no rota'd labour_shifts rows in the window.`, unlock: 'the daily RotaCloud ingest (shift grain)' });
      }
      if (r.deptHours.length) {
        const rows = r.deptHours.map((d) => {
          const dev = d.sm > 0 && d.am != null ? ((d.am - d.sm) / d.sm) * 100 : null;
          return `<tr><td>${esc(d.dept === 'kitchen' ? 'Kitchen' : 'Front of House')}</td>
            <td class="r-num mono">${hrs(d.sm)}</td><td class="r-num mono">${hrs(d.am)}</td>
            <td class="r-num mono">${dev != null ? `${dev >= 0 ? '+' : '−'}${Math.abs(dev).toFixed(1)}%` : '—'}</td></tr>`;
        }).join('');
        accBody += `<div style="margin-top:10px"><table><thead><tr><th>Dept</th><th class="r-num">Sched hrs</th><th class="r-num">Actual hrs</th><th class="r-num">Hours dev</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="r-mini-note">dept rows = labour_dept minute grain (hours only, ruler-free) — the closest dept-keyed accuracy the wire carries.</div>`;
      }
      const accPanel = S.rcc.panel({ title: 'Department schedule accuracy', sub: `14 days to ${r.maxDate}`, body: accBody });

      // ---- (5) cost-definition reconciliation: the ruling card ----
      const rc = r.rc && num(r.rc.days) > 0 ? r.rc : null;
      const tw = r.trueWk && num(r.trueWk.days) > 0 ? r.trueWk : null;
      let costBody;
      if (rc || tw) {
        const row = (label, a, b) => `<tr><td>${esc(label)}</td><td class="r-num mono">${a != null ? gbp(a) : '—'}</td><td class="r-num mono">${b != null ? gbp(b) : '—'}</td></tr>`;
        const delta = rc && tw && num(rc.ac) != null && num(tw.ac) != null ? num(tw.ac) - num(rc.ac) : null;
        costBody = `<table><thead><tr><th>${esc(`Week ${r.week.from} → ${r.week.to}`)}</th><th class="r-num">RC-screen (pre-burden)</th><th class="r-num">TRUE (operating truth)</th></tr></thead><tbody>
            ${row('Scheduled £', rc ? num(rc.sc) : null, tw ? num(tw.sc) : null)}
            ${row('Actual £', rc ? num(rc.ac) : null, tw ? num(tw.ac) : null)}
            ${row('Salaried inside', rc ? 0 : null, tw ? num(tw.sal) : null)}
          </tbody></table>
          ${delta != null ? `<div class="r-callout" style="margin-top:10px">actual delta <strong>${signGbp(delta)}</strong> = ×${bTxt} employer burden on hourly + salaried/365 apportionment (RC shows salaried at £0${rc && num(rc.um) > 0 ? ` — ${hrs(num(rc.um))} uncosted in RC this week` : ''}) + locked-vs-RC rate differences (see Rate parity, Coverage &amp; People).</div>` : ''}
          <div class="r-mini-note">RC-screen = labour_dept (RotaCloud's own per-user rates, pre-burden — what Calum and Jordan manage against in-app) · TRUE = labour_day (locked rates × ${bTxt} + salaried/365) · <b>RC screens recomputed from LIVE rates, never cached</b> — the standing ruling · the two rulers are never compared as like-for-like; this card exists to translate, not to blend.</div>`;
      } else {
        costBody = S.rcc.emptyState({ title: 'Cost-definition reconciliation', blocker: 'no labour rows in the last full week on either ruler.', unlock: 'the daily RotaCloud ingest' });
      }
      const costPanel = S.rcc.panel({ title: 'Cost-definition reconciliation', sub: 'RC-screen vs TRUE — the two-ruler translation', body: costBody });

      // ---- the HOURS | COSTS toggle (COSTS default) — CLIENT-ONLY: both datasets are already
      // in the markup above; the page script swaps visibility via classList only (no fetch, no
      // state, nothing stored). PARSE-SAFE: no template-literal escapes are needed in this
      // script — the served-script parse test guards the incident class regardless.
      const modeWrap = (mode, html) => `<div class="lbc-mode${mode === 'hours' ? ' lbc-hide' : ''}" data-mode="${mode}">${html}</div>`;
      const modeToggle = `<div class="lbc-seg" id="rv-mode" role="group" aria-label="Rota vs Actual mode — hours or TRUE costs">`
        + `<button type="button" data-mode="hours">HOURS</button>`
        + `<button type="button" data-mode="costs" class="active">COSTS</button></div>`;
      const modeScript = `<script>(function(){
        var seg=document.getElementById('rv-mode');
        if(!seg)return;
        var btns=seg.querySelectorAll('button[data-mode]');
        var panes=document.querySelectorAll('.lbc-mode[data-mode]');
        function set(mode){
          var i;
          for(i=0;i<btns.length;i++)btns[i].classList.toggle('active',btns[i].getAttribute('data-mode')===mode);
          for(i=0;i<panes.length;i++)panes[i].classList.toggle('lbc-hide',panes[i].getAttribute('data-mode')!==mode);
        }
        for(var j=0;j<btns.length;j++)(function(b){
          b.addEventListener('click',function(){set(b.getAttribute('data-mode'));});
        })(btns[j]);
      })();</script>`;

      return `${modeToggle}<div class="r-grid r-two-col">${modeWrap('hours', hoursPanel)}${modeWrap('costs', costChartPanel)}${modeWrap('hours', decompPanel)}${modeWrap('costs', costDecompPanel)}</div>
        ${reconPanel}
        <div class="r-grid r-two-col">${accPanel}${costPanel}</div>${modeScript}`;
    };

    // ============================ LABOUR FORECAST (L2) ============================
    const renderForecastTab = () => {
      const f = m.fc;
      if (!f) return noWire('the labour forecast');
      const wk = f.week;
      const wf = f.next || null;
      const sal = f.sal;
      const basisNet = wf ? wf.basisNet : null;
      const methodLabel = f.method === 'seasonal' ? 'seasonality-aware' : f.method === 'simple' ? 'simple YTD-YoY' : null;
      const ovBit = f.override.storeMissing ? 'override store absent — 0% applied' : (f.override.pct === 0 ? 'override 0%' : `override ${f.override.pct > 0 ? '+' : '−'}${Math.abs(f.override.pct).toFixed(1)}% applied`);
      const basisLabel = wf && wf.basis === 'published'
        ? `published RC daily revenue targets — rota_ahead_budget, per-day, dept rows deduplicated (7/7 days)`
        : wf && wf.basis === 'projection'
          ? `the revenue projection's calendar-day weekly share (${methodLabel} P4 method · ${ovBit})${wf.publishedDays > 0 ? ` — only ${wf.publishedDays}/7 day(s) carry a published target, a partial week is never scaled up` : ' — no published targets this week'}`
          : null;

      // formula budget from the basis (derived at read; the salaried term is an observed fact)
      const kVar = basisNet != null ? Math.round(C.varDept.kitchen * basisNet) : null;
      const fVar = basisNet != null ? Math.round(C.varDept.foh * basisNet) : null;
      const budget = basisNet != null ? Math.round(C.varRate * basisNet) + (sal ? sal.pence : 0) : null;
      // promise: the FORWARD verdict (incl. salaried apportionment) preferred, else hourly TRUE
      let promise = null, promiseSrc = null;
      if (f.fwd) { promise = f.fwd.total; promiseSrc = 'verdict'; }
      else if (wf && wf.shifts && wf.shifts.hourlyPence != null) { promise = wf.shifts.hourlyPence; promiseSrc = 'shifts'; }
      const delta = promise != null && budget != null ? promise - budget : null;

      let interactiveBody, script = '';
      if (basisNet != null) {
        const promiseCell = promise == null
          ? (wf && wf.shifts
            ? `<span class="ash">published rota carries no hourly-costed shifts — ${esc(hrs(wf.shifts.salMins + wf.shifts.unmapMins))} salaried/unmapped hours only (no £ is ever estimated)</span>`
            : `<span class="ash">no published rota (rota_ahead_shifts empty for the week)</span>`)
          : `${gbp(promise)} <span class="ash">${promiseSrc === 'verdict'
            ? `FORWARD verdict incl. salaried apportionment${f.fwd && f.fwd.byDept.kitchen != null ? ` (K ${gbp(f.fwd.byDept.kitchen)}${f.fwd.byDept.foh != null ? ` · F ${gbp(f.fwd.byDept.foh)}` : ''})` : ''}`
            : `Σ published hourly shifts at locked rate × ${bTxt}${wf.shifts && (wf.shifts.salMins > 0 || wf.shifts.unmapMins > 0) ? ` — PARTIAL: ${hrs(wf.shifts.salMins)} salaried + ${hrs(wf.shifts.unmapMins)} unmapped rota hours carry no £ here` : ''}`}</span>`;
        interactiveBody = `<table><tbody>
            <tr><td>Forecast net — w/c ${esc(wk.from)}</td><td class="r-num mono" id="wf-net">${gbp(basisNet)}</td></tr>
            <tr><td>Kitchen variable (${kTxt} × net)</td><td class="r-num mono" id="wf-k">${gbp(kVar)}</td></tr>
            <tr><td>FOH variable (${fTxt} × net)</td><td class="r-num mono" id="wf-f">${gbp(fVar)}</td></tr>
            <tr><td>Salaried (site, burdened day-grain)</td><td class="r-num mono">${sal ? gbp(sal.pence) : '<span class="ash">no settled week to source it — variable-only budget, stated</span>'}</td></tr>
            <tr><td>Formula budget (salaried + ${vTxt} × net)</td><td class="r-num mono" id="wf-bud">${gbp(budget)}</td></tr>
            <tr><td>Published rota promise</td><td class="r-num mono">${promiseCell}</td></tr>
            <tr><td>Promise vs budget</td><td class="r-num mono">${delta != null ? signGbp(delta) : '—'}</td></tr>
          </tbody></table>
          <div class="slider-wrap">
            <div class="slider-head"><div><div class="r-kpi-label">What-if: net basis ±15%</div><div class="r-panel-sub">what-if only, nothing stored — client-side arithmetic on this page, never persisted, never sent anywhere</div></div><b id="wf-val">0.0%</b></div>
            <input id="wf-range" type="range" min="-15" max="15" step="0.5" value="0" data-net="${basisNet}" data-sal="${sal ? sal.pence : 0}">
            <div class="r-mini-note">the slider rescales the net basis and re-derives the formula lines (textContent only); the promise and the verdict chip stay on the published basis. The journaled management override lives on the Revenue forecast — one home.</div>
          </div>
          <div class="r-mini-note">net basis = ${esc(basisLabel)} · budget = the ruled formula (salaried burdened + K ${kTxt} / F ${fTxt} × net)${sal ? ` — salaried from the last settled week ${esc(sal.from)} → ${esc(sal.to)} (day-grain constant by construction)` : ''} · promise ${promiseSrc === 'verdict' ? '= the FORWARD rota-review verdict (the canonical promise)' : promiseSrc === 'shifts' ? '= rota_ahead_shifts hourly TRUE only — salaried is day-apportioned in the engine, never estimated here' : 'awaits a published rota'} · OVER only beyond the ruled ${matTxt} materiality.</div>`;
        script = `<script>(function(){
          var s=document.getElementById('wf-range'),v=document.getElementById('wf-val');
          if(!s||!v)return;
          var net=Number(s.getAttribute('data-net'))||0,sal=Number(s.getAttribute('data-sal'))||0;
          var el=function(id){return document.getElementById(id);};
          var gbp=function(p){return '\\u00a3'+(p/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});};
          s.addEventListener('input',function(){
            var pct=Number(s.value);var n=Math.round(net*(1+pct/100));
            v.textContent=(pct>0?'+':pct<0?'\\u2212':'')+Math.abs(pct).toFixed(1)+'%';
            el('wf-net').textContent=gbp(n);
            el('wf-k').textContent=gbp(Math.round(0.143*n));
            el('wf-f').textContent=gbp(Math.round(0.081*n));
            el('wf-bud').textContent=gbp(Math.round(0.224*n)+sal);
          });})();</script>`;
      } else {
        interactiveBody = S.rcc.emptyState({
          title: 'Interactive weekly forecast',
          blocker: 'no net basis for next week — neither a fully-published rota_ahead_budget week (RC daily targets) nor a computable revenue projection (per-receipt monthly record too thin).',
          unlock: 'publish next week’s RotaCloud forecast, or let the K-Series per-receipt record fill',
        });
      }
      const interactivePanel = S.rcc.panel({
        title: 'Interactive weekly forecast', sub: `next week ${wk.from} → ${wk.to} · formula budget vs the published rota's promise · TRUE ruler`,
        headRight: delta != null ? ruledChip(C, delta, 'OVER', 'UNDER budget', 'On budget') : S.rcc.tag(basisNet == null ? 'no forecast basis' : 'no published promise'),
        body: interactiveBody,
      });

      // ---- five-band target curve (the DERIVED view — levels are observed quantiles) ----
      let bandsBody;
      if (f.bands && f.bands.levels) {
        const rows = f.bands.levels.map((L) => {
          const bud = Math.round(C.varRate * L.net) + (sal ? sal.pence : 0);
          const pct = (bud / L.net) * 100;
          return `<tr><td>${esc(L.name)} <span class="ash">${esc(L.p)}</span></td>
            <td class="r-num mono">${gbp(L.net)}</td><td class="r-num mono">${gbp(bud)}</td>
            <td class="r-num mono">${pct.toFixed(1)}%</td></tr>`;
        }).join('');
        bandsBody = `<table><thead><tr><th>Band</th><th class="r-num">Weekly net level</th><th class="r-num">Formula budget</th><th class="r-num">Budget % of net</th></tr></thead><tbody>${rows}</tbody></table>
          <div class="r-mini-note">bands = observed weekly-net quantiles of the trailing 26 full weeks (${int(f.bands.weeksUsed)} full week(s) used, ${esc(f.bands.from)} → ${esc(f.bands.to)}) — the DERIVED view of the formula, never hand-set rows (the ruling): band % = (salaried + ${vTxt} × net) ÷ net at each level; the salaried term is fixed, so the % FALLS as net rises${sal ? '' : ` — the salaried term is unsourced (no settled labour week), so these are VARIABLE-ONLY budgets, flat at ${vTxt}`}${f.bands.excluded.length ? ` · ${int(f.bands.excluded.length)} partial week(s) excluded, not padded${esc(juneNote(f.bands.excluded))}` : ''} · ~30% of net at the High-band anchor is the ruled combined ceiling.</div>`;
      } else {
        bandsBody = S.rcc.emptyState({
          title: 'Five-band target curve',
          blocker: f.bands ? `only ${f.bands.weeksUsed} full sales week(s) in the trailing 26 — too thin to quote quantiles honestly.` : 'no sales_day record yet — the band levels are OBSERVED weekly-net quantiles, never hand-set.',
          unlock: 'the daily Lightspeed ingest',
        });
      }
      const bandsPanel = S.rcc.panel({
        title: 'Five-band target curve', sub: 'revenue levels → formula budget % · the bands are DERIVED, never hand-set',
        body: bandsBody,
      });

      // ---- eight-week outlook ----
      const anyOutlook = f.outlook.some((w) => w.basisNet != null || w.shifts);
      let outlookBody;
      if (anyOutlook) {
        const rows = f.outlook.map((w) => {
          const wBud = w.basisNet != null ? Math.round(C.varRate * w.basisNet) + (sal ? sal.pence : 0) : null;
          const wProm = w.shifts && w.shifts.hourlyPence != null ? w.shifts.hourlyPence : null;
          const wDelta = wProm != null && wBud != null ? wProm - wBud : null;
          return `<tr><td>${esc(dayLabel(w.from))} <span class="ash">w/c ${esc(w.from)}</span></td>
            <td>${w.basis === 'published' ? S.rcc.tag('published', 'info') : w.basis === 'projection' ? S.rcc.tag('projection') : '<span class="ash">no basis</span>'}${w.basis !== 'published' && w.publishedDays > 0 ? ` <span class="ash">${int(w.publishedDays)}/7 targets</span>` : ''}</td>
            <td class="r-num mono">${w.basisNet != null ? gbp(w.basisNet) : '—'}</td>
            <td class="r-num mono">${wBud != null ? gbp(wBud) : '—'}</td>
            <td class="r-num mono">${wProm != null ? gbp(wProm) : '<span class="ash">rota not published</span>'}</td>
            <td>${wDelta != null ? ruledChip(C, wDelta, 'Over', 'Under budget', 'On budget') : w.shifts ? S.rcc.tag('hours only') : S.rcc.tag('rota not published')}</td></tr>`;
        }).join('');
        const salHours = f.outlook.reduce((s, w) => s + (w.shifts ? w.shifts.salMins + w.shifts.unmapMins : 0), 0);
        outlookBody = `<div style="overflow:auto"><table><thead><tr><th>Week</th><th>Net basis</th><th class="r-num">Basis £</th><th class="r-num">Formula budget</th><th class="r-num">Rota promise</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="r-mini-note">basis: published = Σ RC daily revenue targets (rota_ahead_budget, dept rows deduplicated, whole weeks only) · projection = the revenue projection's calendar-day weekly share${methodLabel ? ` (${esc(methodLabel)} · ${esc(ovBit)})` : ''} · promise = Σ published HOURLY shifts at locked rate × ${bTxt}${salHours > 0 ? ` — ${hrs(salHours)} salaried/unmapped rota hours across the window carry no £ here (day-apportioned in the engine / never estimated)` : ''} · an unpublished week SAYS so — never a zero, never an estimate.</div>`;
      } else {
        outlookBody = S.rcc.emptyState({
          title: 'Eight-week outlook',
          blocker: 'nothing to look out on — no published rota_ahead week, no published targets, and no computable projection share.',
          unlock: 'publish forward rotas/forecasts in RotaCloud; the snapshot puller fills rota_ahead_*',
        });
      }
      const outlookPanel = S.rcc.panel({
        title: 'Eight-week outlook', sub: `w/c ${wk.from} onward · promise vs formula budget per week`,
        body: outlookBody,
      });

      // ---- forward management view (NO NAMES — aggregate day + dept only) ----
      let fwdBody;
      if (f.fwdDays.length) {
        const byDate = new Map();
        for (const r of f.fwdDays) {
          const d0 = byDate.get(r.date) || { kitchen: null, foh: null, unassigned: null };
          d0[r.dept] = r; byDate.set(r.date, d0);
        }
        const cell = (r) => {
          if (!r) return `<td class="r-num mono ash">—</td><td class="r-num mono ash">—</td>`;
          const pounds = r.hourlyPence != null ? gbp(r.hourlyPence) : '<span class="ash">—</span>';
          return `<td class="r-num mono">${hrs(r.mins)}</td><td class="r-num mono">${pounds}${r.otherMins > 0 ? ` <span class="ash">+${hrs(r.otherMins)} uncosted</span>` : ''}</td>`;
        };
        const rows = [...byDate.entries()].map(([date, d0]) =>
          `<tr><td>${esc(dowLabel(date))} ${esc(date)}</td>${cell(d0.kitchen)}${cell(d0.foh)}<td class="r-num mono">${d0.unassigned ? hrs(d0.unassigned.mins) : '<span class="ash">—</span>'}</td></tr>`).join('');
        fwdBody = `<div style="overflow:auto"><table><thead><tr><th>Day</th><th class="r-num">Kitchen hrs</th><th class="r-num">Kitchen £</th><th class="r-num">FOH hrs</th><th class="r-num">FOH £</th><th class="r-num">Unassigned hrs</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="r-mini-note">next 14 days of the PUBLISHED rota (rota_ahead_shifts snapshot), aggregated per day + department — the rota carries names; they are aggregated away here BY RULING (NO NAMES, the surveillance boundary) · £ = hourly shifts at locked rate × ${bTxt} (TRUE); salaried hours are day-apportioned in the engine and unmapped hours are never estimated — both render as uncosted hours, stated · a day with nothing published is simply absent.</div>`;
      } else {
        fwdBody = S.rcc.emptyState({
          title: 'Forward management view',
          blocker: 'no published forward rota in the next 14 days (rota_ahead_shifts is empty for the window).',
          unlock: 'publish the rota in RotaCloud; the forward snapshot puller fills it',
        });
      }
      const fwdPanel = S.rcc.panel({
        title: 'Forward management view', sub: 'next 14 days · published rota per day + dept · aggregate only, NO names',
        body: fwdBody,
      });

      // ---- calibration + guardrails (canon text — rulings, not data) ----
      const calibPanel = S.rcc.panel({
        title: 'How the bands are calibrated', sub: 'the ruled formula — canon, not data',
        body: S.rcc.formula([
          'dept TRUE budget = dept salaried (burdened) + var% × net',
          `variable splits (canon_constants): kitchen ${kTxt} · FOH ${fTxt} · combined ${vTxt}`,
          'anchor: ~30% of net combined at the High band — % falls as net rises (salaried is fixed)',
          'bands = observed weekly-net quantiles of the trailing 26 full weeks — a DERIVED view; band rows are never hand-set',
          `OVER only beyond the ruled ${matTxt} materiality`,
          `TRUE ruler = locked rates × ${bTxt} employer burden + salaried/365 — RC screens translate on Rota vs Actual only, never mixed`,
        ]),
      });
      const guardPanel = S.rcc.panel({
        title: 'Forecast guardrails', sub: 'standing rules this tab obeys',
        body: S.rcc.formula([
          'SPLH ceiling = p90 of observed weeks — "the best week that didn’t hurt": top-decile pace must show no speed/wait/accuracy damage in reviews, else the UNDER threshold drops to p75–80 (the hindsight run checks it)',
          'what-if slider: client-side only, nothing stored — the journaled override lives on the Revenue forecast (one home)',
          'forecast basis precedence: published RC targets (whole weeks) > projection weekly share; a partial week is stated, never scaled',
          'surveillance boundary: people are rota-structural facts only — names never render on this centre',
          'June 2026: trends STATE the labour hole (the Leon Mackay RotaCloud fix), never bridge it',
        ]),
      });

      return `<div class="r-grid r-two-col">${interactivePanel}${bandsPanel}</div>
        <div class="r-grid r-two-col">${outlookPanel}${fwdPanel}</div>
        <div class="r-grid r-two-col">${calibPanel}${guardPanel}</div>${script}`;
    };

    // ============================ KITCHEN / FRONT OF HOUSE (L2, mirror) ============================
    const renderDeptTab = (dept) => {
      const d = m.dept;
      const name = dept === 'kitchen' ? 'Kitchen' : 'Front of House';
      const rate = C.varDept[dept];
      const rateStr = `${(rate * 100).toFixed(1)}%`;
      if (!d) return noWire(`the ${name} department view`);

      // ---- (1) day performance: 14 days · dept variable TRUE vs var% × net ----
      let dayBody;
      if (d.maxDate && d.days && d.days.length) {
        const missingDept = d.days.filter((r) => !r.dep).map((r) => r.date);
        const rows = d.days.map((r) => {
          const trueVar = r.dep && r.dep.ac != null ? Math.round(r.dep.ac * C.burden) : null;
          const netOk = r.net != null && r.net > 0;
          const bud = netOk ? Math.round(rate * r.net) : null;
          const dl = trueVar != null && bud != null ? trueVar - bud : null;
          const splh = netOk && num(r.siteAm) > 0 ? Math.round(r.net / (num(r.siteAm) / 60)) : null;
          if (!r.dep) {
            return `<tr><td>${esc(dowLabel(r.date))} ${esc(r.date)}</td>
              <td class="r-num mono">${r.net != null ? gbp(r.net) : '<span class="ash">no sales record</span>'}</td>
              <td class="r-num mono ash" colspan="3">no ${esc(name)} dept record</td>
              <td>${S.rcc.tag('no dept record')}</td><td class="r-num mono ash">—</td><td class="r-num mono">${splh != null ? gbp(splh) : '—'}</td></tr>`;
          }
          return `<tr><td>${esc(dowLabel(r.date))} ${esc(r.date)}</td>
            <td class="r-num mono">${r.net != null ? gbp(r.net) : '<span class="ash">no sales record</span>'}</td>
            <td class="r-num mono">${trueVar != null ? gbp(trueVar) : '—'}</td>
            <td class="r-num mono">${bud != null ? gbp(bud) : '—'}</td>
            <td class="r-num mono">${dl != null ? signGbp(dl) : '—'}</td>
            <td>${netOk ? ruledChip(C, dl, 'Over', 'Under budget', 'On budget') : S.rcc.tag('no net')}</td>
            <td class="r-num mono">${hrs(r.dep.am)}</td>
            <td class="r-num mono">${splh != null ? gbp(splh) : '—'}</td></tr>`;
        }).join('');
        dayBody = `<div style="overflow:auto"><table><thead><tr><th>Day</th><th class="r-num">Site net</th><th class="r-num">${esc(name)} variable TRUE £</th><th class="r-num">Var budget (${esc(rateStr)} × net)</th><th class="r-num">Δ £</th><th>Status</th><th class="r-num">${esc(name)} hrs</th><th class="r-num">Site SPLH</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="r-mini-note">variable TRUE = ${esc(name)} labour_dept hourly cost × ${bTxt} burden; the salaried term sits identically in the ruled dept budget (salaried burdened + ${esc(rateStr)} × net) and in TRUE cost, so it cancels and the delta is exact (the L1 dept-control discipline) · STATUS: OVER only beyond the ruled ${matTxt} materiality · a dept SPLH (site net ÷ dept hours) would be dishonest — it credits one department with the whole site's take — so dept HOURS render with the SITE SPLH (net ÷ site worked hours) as context, captioned${missingDept.length ? ` · ${int(missingDept.length)} day(s) have no ${esc(name)} labour_dept record — absent${esc(juneNote(missingDept))}, never zero` : ''}.</div>`;
      } else {
        dayBody = S.rcc.emptyState({ title: `${name} day performance`, blocker: 'no settled labour-day record yet (labour_day is empty) — the dept grain hangs off the same daily ingest.', unlock: 'the daily RotaCloud ingest' });
      }
      const dayPanel = S.rcc.panel({
        title: `Day performance — ${name}`, sub: d.maxDate ? `14 days to ${d.maxDate} · dept variable TRUE vs the ruled ${rateStr} × net` : `dept variable TRUE vs the ruled ${rateStr} × net`,
        body: dayBody,
      });

      // ---- (2) role mix: FUTURE from the published rota (dept+role live there); settled = gap ----
      let roleBody;
      if (d.roles && d.roles.length) {
        const tot = d.roles.reduce((s, r) => s + r.mins, 0) || 1;
        const meters = d.roles.map((r, i) => S.rcc.meterRow({
          label: r.role, pct: (r.mins / tot) * 100,
          color: [S.rcc.tokens.accent, S.rcc.tokens.blue, S.rcc.tokens.cyan, S.rcc.tokens.purple, S.rcc.tokens.warn][i % 5],
          value: `${hrs(r.mins)} · ${int(r.n)} shift(s)`,
        })).join('');
        const lo = d.roles.reduce((s, r) => (s == null || r.lo < s ? r.lo : s), null);
        const hi = d.roles.reduce((s, r) => (s == null || r.hi > s ? r.hi : s), null);
        roleBody = `<div class="r-meters">${meters}</div>
          <div class="r-mini-note">published rota, forward-looking (rota_ahead_shifts ${esc(lo || '')} → ${esc(hi || '')}) — the ONLY dept-keyed role grain in the wires; the settled shift wire (labour_shifts) carries roles but NO department key (checked), so a settled/backward role mix stays a named gap until the RotaCloud role export decision · senior-share vs the ruled &gt;40% MIX class is judged in the rota-review verdicts (see Decision ratios) · roles are structural facts — NO names, ever.</div>`;
      } else {
        roleBody = S.rcc.emptyState({
          title: `${name} role mix`,
          blocker: `per-dept role grain is not in the settled wires — labour_shifts carries roles but NO department key (checked) — and no published forward rota covers ${name} right now (rota_ahead_shifts, the one dept+role source, is empty for the dept).`,
          unlock: 'the RotaCloud role export decision (settled grain), or a published forward rota (forward grain)',
        });
      }
      const rolePanel = S.rcc.panel({ title: `Role mix — ${name}`, sub: 'forward role hours from the published rota · settled role-by-dept = named gap', body: roleBody });

      // ---- (3) demand vs staffing: DAILY pairing (the honest grain) ----
      let demandBody;
      const pairDays = d.maxDate && d.days ? d.days : [];
      const anyPair = pairDays.some((r) => (r.net != null && r.net > 0) || (r.dep && num(r.dep.am) > 0));
      if (anyPair) {
        const maxNet = Math.max(...pairDays.map((r) => (r.net != null ? r.net : 0)), 1);
        const maxMin = Math.max(...pairDays.map((r) => (r.dep && num(r.dep.am) != null ? num(r.dep.am) : 0)), 1);
        const cols = pairDays.map((r) => {
          const hN = r.net != null ? Math.max(2, Math.round((r.net / maxNet) * 140)) : 0;
          const hM = r.dep && num(r.dep.am) != null ? Math.max(2, Math.round((num(r.dep.am) / maxMin) * 140)) : 0;
          const tip = `${dowLabel(r.date)} ${r.date} — ${r.net != null ? `${gbp(r.net)} net` : 'no sales record'} · ${r.dep && num(r.dep.am) != null ? `${hrs(r.dep.am)} ${name}` : `no ${name} dept record`}`;
          return `<div class="lbc-day" title="${esc(tip)}"><div class="lbc-bars">${r.net != null ? `<div class="lbc-bar net" style="height:${hN}px"></div>` : ''}${r.dep && num(r.dep.am) != null ? `<div class="lbc-bar dept" style="height:${hM}px"></div>` : ''}</div><span class="lbc-daylabel">${esc(dayLabel(r.date))}</span></div>`;
        }).join('');
        demandBody = `<div class="lbc-pairs">${cols}</div>
          <div class="r-mini-note">a PAIRING on two independent scales (site net £ vs ${esc(name)} worked hours), not a ratio · demand is SITE-wide — no dept-keyed demand exists · the mock's hour-by-hour overlay is NOT rendered: labour_hourly carries no department key (checked), and site-hourly staffing on a dept tab would be dishonest; it lands when the hourly wire carries a dept key — the demand side then comes from the per-receipt line grain on London hour with ONLINE excluded (no true hour, the standing ruling).</div>`;
      } else {
        demandBody = S.rcc.emptyState({
          title: `Demand vs staffing — ${name}`,
          blocker: 'no sales or dept-hours record in the 14-day window.',
          unlock: 'the daily Lightspeed + RotaCloud ingests',
        });
      }
      const demandPanel = S.rcc.panel({
        title: `Demand vs staffing — ${name}`, sub: d.maxDate ? `daily pairing · 14 days to ${d.maxDate} · site net vs dept hours` : 'daily pairing · site net vs dept hours',
        headRight: `<div class="r-legend"><span><i style="background:${S.rcc.tokens.blue}"></i>Site net</span><span><i style="background:${S.rcc.tokens.cyan}"></i>${esc(name)} hours</span></div>`,
        body: demandBody,
      });

      // ---- (4) decision ratios ----
      const interNet = d.inter && num(d.inter.net) > 0 ? num(d.inter.net) : null;
      const interDays = d.inter ? num(d.inter.days) || 0 : 0;
      const varPct = interNet != null && d.inter && num(d.inter.ac) != null ? ((num(d.inter.ac) * C.burden) / interNet) * 100 : null;
      const totAm = d.share ? d.share.reduce((s, x) => s + x.am, 0) : 0;
      const meAm = d.share ? (d.share.find((x) => x.dept === dept) || { am: 0 }).am : 0;
      const sharePct = totAm > 0 ? (meAm / totAm) * 100 : null;
      const drivers = [
        S.rcc.driver({
          label: 'Variable % of net', value: varPct != null ? `${varPct.toFixed(1)}%` : '—',
          sub: varPct != null ? `vs the ruled ${rateStr} target · dept TRUE variable ÷ net · ${interDays} intersection day(s)` : `vs the ruled ${rateStr} target — needs sales ∩ dept-labour days`,
        }),
        S.rcc.driver({
          label: 'Share of labour hours', value: sharePct != null ? `${sharePct.toFixed(1)}%` : '—',
          sub: sharePct != null ? `of all labour_dept worked hours · 14 days (paid basis, minute grain)` : 'no labour_dept hours in the window',
        }),
        S.rcc.driver({
          label: dept === 'foh' ? 'Covers per FOH hour' : 'Covers per labour hour', value: '—',
          sub: 'OpenTable-gated — POS guest-count is NOT covers (no-fabrication ruling); zero digits until the wire exists',
        }),
      ].join('');
      const mixLine = d.mix
        ? `<div class="lbc-mix">MIX ${esc(dept)} (${esc(d.mix.mode)} w/c ${esc(d.mix.week)}, verbatim): ${esc(d.mix.note)}</div>`
        : `<div class="lbc-mix">MIX ${esc(dept)}: — <span class="ash">no rota-review MIX note for this dept on the latest runs (the ruled &gt;40% senior-mix class is judged there, not recomputed here)</span></div>`;
      const ratiosPanel = S.rcc.panel({
        title: `Decision ratios — ${name}`, sub: `the dept control numbers · TRUE ruler · vs the ruled ${rateStr} variable target`,
        body: `<div class="lbc-drivers">${drivers}</div>${mixLine}
          <div class="r-mini-note">variable % = labour_dept hourly cost × ${bTxt} ÷ net over the sales∩dept intersection days only (day-count labelled — the cross-ruler discipline) · hours share = labour_dept minute grain, RC paid basis (ruler-free) · senior mix = the rota-review MIX note VERBATIM — one home, never recomputed here.</div>`,
      });

      return `${dayPanel}
        <div class="r-grid r-two-col">${demandPanel}${rolePanel}</div>
        ${ratiosPanel}`;
    };

    const renderKitchenTab = () => renderDeptTab('kitchen');
    const renderFohTab = () => renderDeptTab('foh');

    // ============================ COVERAGE & PEOPLE (L3, final) ============================
    const renderCoverageTab = () => {
      const c = m.cov || {};
      const parts = [];

      // ---- (0) Today — live: the intraday snapshot strip (operational coverage — its home,
      // ABOVE the KPI strip; absorbed from the old page with its honesty intact) ----
      const DEPT_LABEL = { kitchen: 'Kitchen — Calum', foh: 'Front of House — Jordan', unassigned: 'Unassigned location' };
      const rows = (c.intraday || []).filter((r) => r.department !== 'unassigned');
      const un = (c.intraday || []).find((r) => r.department === 'unassigned');
      if (!rows.length && !un) {
        parts.push(`<div class="lb-sec">Today — live</div><div class="banner muted">No intraday snapshot yet — the hourly pull (at :35) fills this in.</div>`);
      } else {
        const asOf = num(rows[0] && rows[0].as_of_ms) || num(un && un.as_of_ms);
        const lonTime = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
        const ageMin = asOf != null ? Math.round((now - asOf) / 60000) : null;
        const stale = ageMin != null && ageMin > 130;
        const blocks = rows.map((r) => {
          let inNow = []; try { inNow = JSON.parse(r.clocked_in_now || '[]'); } catch (e) { /* keep going */ }
          const names = inNow.map((x) => `${esc(x.name)} <span class="ash">${lonTime(num(x.since_ms))}</span>`).join(' · ');
          // NO-SHOW IS AN AGGREGATE — it names nobody (surveillance boundary, ruling
          // labour-centre-stage2-rulings clause 3). This row used to render the person's name,
          // directly above the caption promising attendance renders as aggregates only. Being
          // present is a rota-structural fact; failing to appear is a judgement about someone,
          // and a named judgement standing on a dashboard is the per-person behavioural queue
          // the ruling excluded — a queue of one is still a queue.
          // The ROTA'D TIME stays, because that is the operational fact: it says which shift is
          // uncovered and since when, which is what a coverage decision needs. The name adds
          // nothing to that decision and everything to the framing.
          let noShows = []; try { noShows = JSON.parse(r.no_shows || '[]'); } catch (e) { /* keep going */ }
          const noShowTimes = noShows.map((x) => num(x.rota_start_ms)).filter((t) => t != null).sort((a, b) => a - b);
          const noShowHtml = noShows.length
            ? `<tr><td class="R">NO-SHOW (15min+)</td><td class="R">${noShows.length} unfilled`
              + (noShowTimes.length ? ` <span class="mono">rota'd ${noShowTimes.map((t) => lonTime(t)).join(' · ')}</span>` : '')
              + `</td></tr>`
            : '';
          return `<div class="lb-card"><div class="lb-cardhead">${esc(DEPT_LABEL[r.department] || r.department)}</div>
            <table class="lb-tbl"><tbody>${noShowHtml}
              <tr><td>Clocked in now (${inNow.length})</td><td>${names || '<span class="ash">nobody</span>'}</td></tr>
              <tr><td>Worked so far</td><td class="n">${hrs(r.worked_minutes_so_far)} · ${gbp(r.cost_rc_so_far)} pre-burden RC-screen</td></tr>
              <tr><td>Rota'd today (full day)</td><td class="n">${hrs(r.sched_minutes_full)} · ${gbp(r.sched_cost_rc_full)}</td></tr>
            </tbody></table>
            ${num(r.uncosted_minutes) ? `<div class="lb-hint" style="margin:0 12px">${hrs(r.uncosted_minutes)} so far at £0 in the RC-screen ruler (salaried/unrated) — the TRUE cost lands in labour_day tomorrow.</div>` : ''}</div>`;
        }).join('');
        const r0 = rows[0] || un;
        let refLine = '';
        if (r0 && r0.ref_date != null) {
          const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(String(r0.ref_date) + 'T12:00:00Z').getUTCDay()];
          const soFarMin = rows.reduce((x, rr) => x + (num(rr.worked_minutes_so_far) || 0), 0);
          refLine = `<div class="lb-hint">Reference — last ${esc(wd)} (${esc(String(r0.ref_date))}, settled) by ${esc(String(num(r0.ref_to_hour)))}:00: ${hrs(r0.ref_worked_minutes)} worked · ${gbp(r0.ref_net_pence)} net taken. Today so far: ${hrs(soFarMin)}. Context only — never a projection.</div>`;
        } else if (r0) {
          refLine = `<div class="lb-hint">No settled same-weekday reference exists yet (thin history) — context arrives as the record grows; nothing is borrowed from other weekdays.</div>`;
        }
        parts.push(`<div class="lb-sec">Today — live <span class="lb-sub">${esc(rows[0] ? String(rows[0].business_date) : '')} · ${asOf != null ? (stale ? '⚠️ STALE, last snapshot ' : 'as of ') + esc(lonTime(asOf)) + (stale ? ` (${Math.round(ageMin / 60)}h ago — check coyote-rotacloud-ingest)` : ', refreshes hourly at :35') : ''} · partial-day figures, never a day result · RC-screen ruler (the in-app view)</span></div>`
          + `<div class="lb-live">${refLine}<div class="lb-two">${blocks}</div>${un ? `<div class="banner">⚠️ ${hrs(un.worked_minutes_so_far)} today on an UNKNOWN RotaCloud location — fix the location in RotaCloud.</div>` : ''}</div>`);
      }

      // ---- (1) aggregate people KPI strip: last full week, ZERO person keys ----
      if (!c.week) {
        parts.push(`<div class="banner muted">No settled labour-day record yet — the aggregate people KPIs anchor on the last full Mon–Sun week of <span class="mono">labour_day</span> (TRUE ruler); the daily RotaCloud ingest fills it. Nothing here is ever estimated.</div>`);
      } else {
        const wk = c.week;
        const otMins = c.ot && num(c.ot.mins) != null ? num(c.ot.mins) : null;
        const agg = c.agg && num(c.agg.days) > 0 ? c.agg : null;
        const payVar = agg && num(agg.sc) != null && num(agg.ac) != null ? num(agg.ac) - num(agg.sc) : null;
        const salShare = agg && num(agg.ac) > 0 && num(agg.sal) != null ? (num(agg.sal) / num(agg.ac)) * 100 : null;
        const noRec = 7 - (agg ? num(agg.days) || 0 : 0);
        const kpis = [
          S.rcc.kpi({
            label: 'Overtime hours', value: otMins != null ? hrs(otMins) : '—',
            sub: otMins != null ? 'Σ positive shift variance · labour_shifts · aggregate, no names' : 'no positive shift variance recorded this week',
          }),
          S.rcc.kpi({
            label: 'Late / short shifts', value: c.lateShort ? int(num(c.lateShort.n) || 0) : '—',
            sub: 'worked rota’d shifts beyond ±15 min of plan — COUNT only, no names (±15 exactly is within)',
          }),
          S.rcc.kpi({
            label: "Unrota'd worked shifts", value: c.unrota ? int(num(c.unrota.n) || 0) : '—',
            sub: 'worked with no rota line · labour_shifts · count only',
          }),
          S.rcc.kpi({
            label: 'No-record days', value: int(noRec),
            sub: `labour_day rows missing vs the 7-day calendar week${juneNote(c.missing)} — absent, never zero`,
          }),
          S.rcc.kpi({
            label: 'Pay-cost variance', value: payVar != null ? signGbp(payVar) : '—',
            sub: 'scheduled → actual £, TRUE ruler (labour_day, burdened + salaried/365)',
          }),
          S.rcc.kpi({
            label: 'Salaried cover share', value: pct1(salShare),
            sub: 'salaried/365 ÷ TRUE actual — the fixed-cover slice of the week',
          }),
        ].join('');
        parts.push(`<div class="r-grid r-kpi-grid">${kpis}</div>
          <div class="lbc-caption">window = the last full Mon–Sun week ${esc(wk.from)} → ${esc(wk.to)} · AGGREGATES ONLY — zero person keys on this strip (the surveillance-boundary ruling; the ruled-in person classes render in Compliance &amp; structural exceptions below) · £ = TRUE ruler (labour_day) · shift counts = labour_shifts, SITE-level (no department key — checked).</div>`);
      }

      // ---- (2) combined coverage vs required staffing (the centrepiece heatmap) ----
      const H = c.heat;
      let heatBody, heatSub = 'weekday × hour · staffed TRUE £ vs the demand-derived requirement', heatLegend = '';
      if (!H) {
        heatBody = S.rcc.emptyState({
          title: 'Combined coverage vs required staffing',
          blocker: 'no hourly labour record yet (labour_hourly is empty) — the staffing side of the grid.',
          unlock: 'the daily RotaCloud ingest (hour grain)',
        });
      } else {
        const D = H.demand, B = H.budget;
        const missNote = H.missing.length ? ` · <b>${int(H.missing.length)} of 28 day(s) carry no hourly labour record</b> — absent${esc(juneNote(H.missing))}, never zero` : '';
        const uncNote = H.uncostedMins > 0 ? ` · ${hrs(H.uncostedMins)} staffed at £0 in the hour grain (slices the ingest could not cost) — stated, never estimated` : '';
        const head = '<div></div>' + HEAT_HOURS.map((h) => `<div class="r-hlabel">${h}</div>`).join('');
        if (D && B) {
          const cells = new Map();
          let maxAbs = 0;
          for (let dw = 0; dw < 7; dw++) {
            for (const h of HEAT_HOURS) {
              const key = `${dw}-${h}`;
              if (!(H.occ[dw] > 0)) { cells.set(key, null); continue; } // no weekday record — unknown, never zero
              const req = Math.round(((D.cells[key] || 0) / D.total) * B.pence);
              const sAvg = Math.round((H.staffP[key] || 0) / H.occ[dw]);
              if (req === 0 && sAvg === 0 && !(H.staffM[key] > 0)) { cells.set(key, null); continue; } // nothing on either side
              const delta = sAvg - req;
              maxAbs = Math.max(maxAbs, Math.abs(delta));
              cells.set(key, { sAvg, req, delta });
            }
          }
          const grid = DOWS.map((nm, dw) => `<div class="r-hday">${nm}</div>` + HEAT_HOURS.map((h) => {
            const cell = cells.get(`${dw}-${h}`);
            if (!cell) return S.rcc.heatCell(null);
            return S.rcc.heatCell(coverageLevel(cell.delta, maxAbs), `${nm} ${h}:00 — staffed ${gbp(cell.sAvg)} vs required ${gbp(cell.req)} (Δ ${signGbp(cell.delta)})`);
          }).join('')).join('');
          const onlineNote = D.onlineExcluded > 0
            ? `${gbp(D.onlineExcluded)} ONLINE excluded — no true hour (the online-order ruling)`
            : 'ONLINE ORDER lines excluded — no true hour (the online-order ruling)';
          heatLegend = `<div class="r-legend"><span><i style="background:${S.rcc.tokens.heat[0]}"></i>Staffed under required</span><span><i style="background:${S.rcc.tokens.heat[5]}"></i>Staffed over required</span></div>`;
          heatBody = `<div class="r-heatmap">${head}${grid}</div>
            <div class="r-mini-note"><b>required = formula budget spread by demand share — a derivation, not a rota standard.</b> budget = Σ salaried + ${vTxt} × net over the last settled week ${esc(B.from)} → ${esc(B.to)} (${gbp(B.rawPence != null ? B.rawPence : B.pence)}, ${int(B.days)} intersection day(s))${B.allocRatio != null && B.allocRatio < 0.999 ? `, scaled to ${gbp(B.pence)} — the ${Math.round(B.allocRatio * 100)}% of day-grain cost that reaches the HOUR grain, so both sides describe the same hours (labour_hourly holds only what the people IN an hour cost; an absent salaried person is in no hour)` : ''} · demand share = line-grain net by weekday × LOCAL London hour, 28d to ${esc(D.apiMax)} · ${esc(onlineNote)} · staffed hours include rota-as-worked for no-clock salaried.</div>
            <div class="r-mini-note">staffed = labour_hourly TRUE £ (hourly × ${bTxt} burden + the ingest's salaried hour share) averaged per weekday occurrence, 28d to ${esc(H.to)} · SITE-level — labour_hourly carries no department key (checked) · levels centre on balanced: 1–3 staffed under the derived requirement, 4–6 over · a weekday with no hourly record renders blank, never zero${missNote}${uncNote}. This grid ABSORBED the old staffing-shape panel — one home.</div>`;
        } else {
          // staffing-only fallback — the honest half while the required side is underivable
          const reasons = [];
          if (!D) reasons.push('no timed per-receipt line record in the demand window');
          if (!B) reasons.push('no settled sales∩labour week to source the formula budget');
          const avg = new Map();
          const vals = [];
          for (let dw = 0; dw < 7; dw++) {
            for (const h of HEAT_HOURS) {
              if (!(H.occ[dw] > 0)) continue;
              const mins = (H.staffM[`${dw}-${h}`] || 0) / H.occ[dw];
              if (mins > 0) { avg.set(`${dw}-${h}`, mins); vals.push(mins); }
            }
          }
          vals.sort((a, b) => a - b);
          const level = (v) => Math.max(1, Math.ceil((vals.filter((x) => x <= v).length / vals.length) * 6));
          const grid = DOWS.map((nm, dw) => `<div class="r-hday">${nm}</div>` + HEAT_HOURS.map((h) => {
            const v = avg.get(`${dw}-${h}`);
            return v ? S.rcc.heatCell(level(v), `${nm} ${h}:00 — ${hrs(v)} staffed (avg per ${nm})`) : S.rcc.heatCell(null);
          }).join('')).join('');
          heatSub = 'weekday × hour · staffing density (the required side is not derivable yet)';
          heatBody = `<div class="r-heatmap">${head}${grid}</div>
            <div class="r-mini-note">STAFFING ONLY — the required side is not derivable: ${esc(reasons.join(' and '))}; shade = worked-hours density by quantile (minute grain, ruler-free) · SITE-level (no department key — checked) · 28d to ${esc(H.to)}${missNote}${uncNote}. This grid ABSORBED the old staffing-shape panel — one home; the derived requirement lights up with the demand + budget wires. · staffed hours include rota-as-worked for no-clock salaried.</div>`;
        }
      }
      const heatPanel = S.rcc.panel({
        title: 'Combined coverage vs required staffing', sub: heatSub,
        headRight: heatLegend, body: heatBody,
      });

      // ---- (3) compliance & structural exceptions — the mock's People-queue POSITION;
      // the queue itself is EXCLUDED BY RULING. Only the ruled-in person CLASSES render:
      // WTR flags (regulatory), rate parity (payroll), unmapped names (data hygiene). ----
      const compParts = [];
      compParts.push(`<div class="lb-sec" style="margin-top:2px">U18 working-time guard ${S.rcc.tag('regulatory — WTR 1998', 'bad')} <span class="lb-sub">all history · re-checked every ingest</span></div>`);
      const flags = c.wtr || [];
      if (!flags.length) {
        compParts.push(`<div class="banner muted">U18 working-time ✓ — no flags (8h/day · 40h/wk fixed · 22:00+ surfaced · 00:00–04:00 absolute; re-checked every ingest).</div>`);
      } else {
        const t = c.wtrTotal || {};
        const byUser = new Map();
        for (const f of flags) {
          const u = byUser.get(f.user_name) || { name: f.user_name, day_over_8h: 0, week_over_40h: 0, night_22_24: 0, night_00_04: 0, last: '' };
          u[f.kind] = num(f.n) || 0;
          if (String(f.last) > u.last) u.last = String(f.last);
          byUser.set(f.user_name, u);
        }
        const people = [...byUser.values()].sort((a, b) => (b.day_over_8h + b.week_over_40h + b.night_00_04) - (a.day_over_8h + a.week_over_40h + a.night_00_04) || (b.night_22_24 - a.night_22_24));
        const cellR = (n) => n > 0 ? `<span class="R">${n}</span>` : '<span class="ash">0</span>';
        const cellA = (n) => n > 0 ? `<span class="A">${n}</span>` : '<span class="ash">0</span>';
        const wtrRows = people.map((u) => `<tr><td>${esc(u.name || '')}</td><td class="n">${cellR(u.day_over_8h)}</td><td class="n">${cellR(u.week_over_40h)}</td><td class="n">${cellR(u.night_00_04)}</td><td class="n">${cellA(u.night_22_24)}</td><td class="n"><span class="ash">${esc(u.last)}</span></td></tr>`).join('');
        const hardTotal = people.reduce((x, u) => x + u.day_over_8h + u.week_over_40h + u.night_00_04, 0);
        const span = t.lo && t.hi ? ` ${esc(String(t.lo))} → ${esc(String(t.hi))}` : '';
        compParts.push(`<div class="banner">🔴 <b>${num(t.n) || flags.reduce((x, f) => x + (num(f.n) || 0), 0)} U18 working-time flag${(num(t.n) || 0) === 1 ? '' : 's'}</b> across ${esc(String(num(t.people) || byUser.size))} young worker${(num(t.people) || 0) === 1 ? '' : 's'}${span}. <b class="R">${hardTotal}</b> are HARD legal limits (over-8h day / over-40h week / worked-past-midnight — no catering exception); the amber column is the permitted-with-conditions 22:00–24:00 window.</div>
          <div class="lb-card"><table class="lb-tbl"><thead><tr><th>young worker</th><th style="text-align:right" class="R">over 8h day</th><th style="text-align:right" class="R">over 40h wk</th><th style="text-align:right" class="R">past midnight</th><th style="text-align:right" class="A">past 22:00</th><th style="text-align:right">last</th></tr></thead><tbody>${wtrRows}</tbody></table>
          <div class="lb-hint" style="margin:8px 12px 0">Limits: 8h/day &amp; 40h/week are fixed with no averaging (gov.uk/maximum-weekly-working-hours); 22:00–06:00 is restricted but catering is an excepted sector, while 00:00–04:00 is an absolute ban (gov.uk/night-working-hours). The red columns are rota-policy action items — raise with Calum &amp; Jordan.</div></div>`);
      }
      compParts.push(`<div class="lb-sec">Rate parity ${S.rcc.tag('payroll correctness')} <span class="lb-sub">locked table vs RotaCloud</span></div>`);
      if (!c.parity || c.parity.length === 0) {
        compParts.push(`<div class="banner muted">Rate parity ✓ — locked 2026/27 table and RotaCloud's stored rates agree (re-checked every ingest).</div>`);
      } else {
        const KIND = { role_rate_mismatch: 'rate differs', rc_missing_rate: 'no rate in RotaCloud (costs £0 in-app)', locked_missing_rate: 'not in locked table', salary_mismatch: 'salary differs', rc_missing_salary: 'salary missing in RotaCloud' };
        const pRows = c.parity.map((x) => `<tr><td>${esc(x.user_name || '')}</td><td>${esc(x.role_name || '—')}</td><td>${esc(KIND[x.kind] || x.kind)}</td><td class="n">${esc(x.rc_value || '—')}</td><td class="n">${esc(x.locked_value || '—')}</td></tr>`).join('');
        compParts.push(`<div class="banner">🔴 <b>${c.parity.length} rate discrepanc${c.parity.length === 1 ? 'y' : 'ies'}</b> between RotaCloud and the locked 2026/27 table — the managers' in-app % uses <i>their</i> rates, so the RC screens are unfair until fixed <b>in RotaCloud</b>.</div>
          <div class="lb-card"><table class="lb-tbl"><thead><tr><th>who</th><th>role</th><th>finding</th><th style="text-align:right">RotaCloud</th><th style="text-align:right">locked table</th></tr></thead><tbody>${pRows}</tbody></table></div>`);
      }
      compParts.push(`<div class="lb-sec">Unmapped shift names ${S.rcc.tag('data hygiene')} <span class="lb-sub">${c.week ? `last settled week ${esc(c.week.from)} → ${esc(c.week.to)}` : 'awaiting a settled week'}</span></div>`);
      if (!c.week) {
        compParts.push(`<div class="banner muted">No settled labour week yet — mapping hygiene lights up with the daily ingest.</div>`);
      } else if (!c.unmapped.length) {
        compParts.push(`<div class="banner muted">Mapping ✓ — every shift name in the week maps to the locked table.</div>`);
      } else {
        compParts.push(`<div class="banner">🔴 <b>${int(c.unmapped.length)} unmapped name(s)</b>: ${c.unmapped.map((n) => esc(n)).join(', ')} — no stored mapping, their hours carry £0 in TRUE cost until fixed <b>in RotaCloud</b>. Data hygiene, not behaviour.</div>`);
      }
      compParts.push(S.rcc.note('per-person behavioural queues are excluded by the surveillance-boundary ruling; attendance renders as aggregates above.'));
      const compPanel = S.rcc.panel({
        title: 'Compliance & structural exceptions',
        sub: 'the ruled-in person classes ONLY — regulatory · payroll · data hygiene (the mock’s People-queue position)',
        body: compParts.join('\n'),
      });

      // ---- (4) people & compliance ratios — aggregate cards, no person keys ----
      const ad = c.adherence;
      const adPct = ad && num(ad.n) > 0 ? (num(ad.w) / num(ad.n)) * 100 : null;
      const wtrN = c.wtrTotal ? num(c.wtrTotal.n) || 0 : 0;
      const wtrLast = c.wtrTotal && c.wtrTotal.hi ? String(c.wtrTotal.hi) : null;
      let streakVal = '—', streakSub = 'needs a settled labour week to anchor the streak';
      if (c.week) {
        if (wtrN === 0) { streakVal = 'clean'; streakSub = 'no WTR flag on record (all history)'; }
        else if (wtrLast) {
          const days = Math.round((new Date(`${c.week.from}T12:00:00Z`) - new Date(`${K.weekMonday(wtrLast)}T12:00:00Z`)) / 86400000);
          streakVal = `${Math.max(0, Math.floor(days / 7))} wk(s)`;
          streakSub = `full weeks since the last flag week (last flag ${wtrLast})`;
        }
      }
      const rosterN = c.roster ? num(c.roster.n) || 0 : 0;
      const parityPeople = c.parityPeople ? num(c.parityPeople.n) || 0 : 0;
      const parityPct = rosterN > 0 ? ((rosterN - Math.min(parityPeople, rosterN)) / rosterN) * 100 : null;
      const unmShare = c.agg && num(c.agg.am) > 0 && num(c.agg.um) != null ? (num(c.agg.um) / num(c.agg.am)) * 100 : null;
      const spoh = H && H.openSlots > 0 ? (H.staffedMinutes / 60) / H.openSlots : null;
      const ratios = [
        S.rcc.driver({
          label: 'Schedule adherence', value: adPct != null ? `${adPct.toFixed(1)}%` : '—',
          sub: adPct != null ? `worked rota'd shifts within ±15 min ÷ ${int(num(ad.n))} with a recorded variance · last full week` : `no rota'd shift variance in the last full week`,
        }),
        S.rcc.driver({ label: 'WTR-clean weeks streak', value: streakVal, sub: streakSub }),
        S.rcc.driver({
          label: 'Parity-clean staff', value: parityPct != null ? `${parityPct.toFixed(1)}%` : '—',
          sub: rosterN > 0 ? `1 − flagged people ÷ ${int(rosterN)} distinct settled-shift names (a PROXY roster, stated) · all history` : 'no settled shift roster yet to divide by',
        }),
        S.rcc.driver({
          label: 'Unmapped-minutes share', value: unmShare != null ? `${unmShare.toFixed(1)}%` : '—',
          sub: unmShare != null ? 'unmapped worked minutes ÷ all worked minutes · labour_day, last full week' : 'needs labour_day worked minutes',
        }),
        S.rcc.driver({
          label: 'Staffing per open hour', value: spoh != null ? spoh.toFixed(1) : '—',
          sub: spoh != null ? 'avg staff on the clock per staffed hour · labour_hourly 28d, site-level' : 'needs the hourly labour record',
        }),
      ].join('');
      const ratiosPanel = S.rcc.panel({
        title: 'People & compliance ratios', sub: 'aggregate ratios only — no person keys',
        body: `<div class="lbc-drivers">${ratios}</div>
          <div class="r-mini-note">every ratio is SITE-level — labour_shifts and labour_hourly carry no department key (checked); the dept split lands when the shift wire carries one · adherence counts SHIFTS, never people · the parity denominator is a stated proxy (the parity check stores findings, not roster size).</div>`,
      });

      // ---- (5) labour accounting rules — canon verbatim (rulings, not data) ----
      const rulesPanel = S.rcc.panel({
        title: 'Labour accounting rules', sub: 'canon — rulings, not data',
        body: S.rcc.formula([
          `TRUE cost = locked rate × minutes × ${bTxt} employer burden (hourly) + salaried annual/365 per calendar day`,
          `RC-screen = RotaCloud's own per-user rates, pre-burden, salaried £0 — recomputed from LIVE rates, never cached`,
          'TRUE and RC-screen never mix — the translation card on Rota vs Actual is the only meeting point',
          `dept TRUE budget = dept salaried (burdened) + var% × net — kitchen ${kTxt} · FOH ${fTxt} · combined ${vTxt} (~30% of net at the High-band anchor; splits from canon_constants)`,
          `OVER only beyond the ruled ${matTxt} materiality`,
        ]),
      });

      // ---- (6) data architecture — definitional cards, no figures ----
      const arch = [
        ['RotaCloud', 'Rota & attendance — LIVE', 'shifts, clock data and rates → labour_day / labour_shifts / labour_hourly + the rota_ahead_* forward snapshots; daily settle + hourly intraday pull. The staffing side of every grid on this centre.'],
        ['Lightspeed K-Series', 'Demand — LIVE', 'per-receipt lines carry the hour truth (ONLINE has no true hour and is excluded from hour grids); sales_day net funds labour %, SPLH and the formula budget.'],
        ['Reservations / covers', 'OpenTable — LIVE', 'real covers from the OpenTable export → covers_day / covers_slot; the POS guest-count is still NOT covers (no-fabrication ruling). Covers demand by weekday × hour lights the Coverage tab; daypart staffing-to-covers is the true driver.'],
        ['Payroll', 'QuickBooks — gated', 'the settlement truth for paid £. Phase 0 is GET-only structural discovery; paid-vs-TRUE reconciliation lands when the wire graduates — until then labour_day TRUE is the operating truth.'],
      ].map(([src, name, txt]) => `<div class="r-driver"><small>${esc(src)}</small><strong>${esc(name)}</strong><p>${esc(txt)}</p></div>`).join('');
      const archPanel = S.rcc.panel({
        title: 'Data architecture', sub: 'where every number on this centre comes from — definitional, no figures',
        body: `<div class="lbc-arch">${arch}</div>`,
      });

      // ---- covers demand heatmap (Phase 2 PR3b) — the DEMAND side in covers, weekday × hour, from
      // covers_slot. Additive alongside the staffing/required grid; the true staffing driver. ----
      const CH = c.coversHeat;
      let coversBody;
      if (!CH || !CH.vals.length) {
        coversBody = S.rcc.emptyState({ title: 'Covers demand by weekday × hour', blocker: 'no covers_slot record yet — OpenTable arrivals by hour.', unlock: 'the OpenTable export + a reservations rebuild' });
      } else {
        const chead = '<div></div>' + HEAT_HOURS.map((h) => `<div class="r-hlabel">${h}</div>`).join('');
        const clevel = (v) => Math.max(1, Math.ceil((CH.vals.filter((x) => x <= v).length / CH.vals.length) * 6));
        const cgrid = DOWS.map((nm, dw) => `<div class="r-hday">${nm}</div>` + HEAT_HOURS.map((h) => {
          const v = CH.avg[`${dw}-${h}`];
          return v ? S.rcc.heatCell(clevel(v), `${nm} ${h}:00 — ${Math.round(v)} covers/${nm} (avg)`) : S.rcc.heatCell(null);
        }).join('')).join('');
        coversBody = `<div class="r-heatmap">${chead}${cgrid}</div>
          <div class="r-mini-note">DEMAND in covers — OpenTable arrivals (covers_slot) by weekday × LOCAL hour, averaged per weekday occurrence, 28d to ${esc(CH.to)} · shade = arrival volume by quantile · this is the TRUE staffing driver (covers, not £) — read it against the staffing/required grid above · a weekday with no record renders blank, never zero.</div>`;
      }
      const coversDemandPanel = S.rcc.panel({
        title: 'Covers demand by weekday × hour', sub: 'OpenTable arrivals — the demand side in covers', headRight: S.rcc.tag('OpenTable', 'info'), body: coversBody,
      });

      return parts.join('\n')
        + `<div class="r-grid r-two-col">${heatPanel}${compPanel}</div>`
        + coversDemandPanel
        + `<div class="r-grid r-two-col">${ratiosPanel}${rulesPanel}</div>`
        + archPanel;
    };

    const tabBody = tab === 'rota-review' ? ROTA_REVIEW.render(m.rr, ctx).body
      : !C ? constantsUnavailable
        : tab === 'rota' ? renderRotaTab()
          : tab === 'forecast' ? renderForecastTab()
            : tab === 'kitchen' ? renderKitchenTab()
              : tab === 'foh' ? renderFohTab()
                : tab === 'coverage' ? renderCoverageTab()
                  : renderExecutiveTab();

    const body = `<div class="rcc">` + styles + tabsNav + tabBody + `</div>`;
    const stamp = !C && tab !== 'rota-review'
      ? 'labour · <span class="none">ruled constants unavailable (canon_constants)</span>'
      : m.maxDate
        ? `labour · <span class="mono">RotaCloud · ${esc(m.maxDate)}</span>`
        : 'labour · <span class="none">awaiting labour-day record</span>';
    return { stamp, body };
  },
};
