'use strict';
// Labour — the LABOUR COMMAND CENTRE (L1, built from the Stage-1 gap map
// docs/labour-centre/gap-map.md + the operator mock reference/mock-*.png). ONE route
// (/coyote/labour — the operator ruled the centre TAKES the existing route), six subtabs:
//   executive (default) · forecast · rota (Rota vs Actual) · kitchen · foh · coverage
// L1 SCOPE: the shell + EXECUTIVE + ROTA VS ACTUAL fully built.
// L2 SCOPE (this build): LABOUR FORECAST + KITCHEN + FRONT OF HOUSE built to the mock —
//   forecast = interactive weekly forecast (what-if slider, CLIENT-side only, nothing stored)
//   + five-band DERIVED curve + eight-week outlook + forward management view + calibration/
//   guardrails canon; kitchen/foh = ONE shared dept renderer (day performance · role mix ·
//   demand vs staffing · decision ratios). Coverage still renders a pending note HOLDING the
//   old labour page's un-absorbed panels (staffing shape · today-live intraday · U18 WTR
//   guard · rate parity) until its L2/L3 home is built.
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
//   • staffing shape / today-live / WTR / rate parity → HELD on the coverage tab (L2 home).
// THE RULERS (never mixed, every figure captioned):
//   • TRUE (the operating truth): labour_day costs — locked rates × 1.159 employer burden +
//     salaried/365 day-grain apportionment. THIS CENTRE'S BASIS.
//   • RC-screen (the managers' RotaCloud arithmetic): labour_dept costs — RC's own per-user
//     rates, pre-burden, salaried £0. Renders ONLY in the cost-definition reconciliation card,
//     labelled. Standing ruling: RC screens are recomputed from LIVE rates, never cached.
// THE RULED FORMULA (rota-review spec): dept TRUE budget = dept salaried burdened + var% × net
// (kitchen 14.3%, FOH 8.1%; combined 22.4% — ~30% at the High-band anchor); OVER only beyond
// the ruled £45 materiality.
// CROSS-RULER HONESTY (load-bearing, inherited): labour % of net and SPLH divide matching
// numerator and denominator over ONLY the sales∩labour intersection days, day-count labelled.
// JUNE HOLE: labour_day has NO June 2026 rows (the backfill is blocked on the Leon Mackay
// RotaCloud fix) — trends STATE the hole, never bridge it.
// SURVEILLANCE BOUNDARY (ruling, gap map): people appear as rota-STRUCTURAL facts only — no
// per-employee scoring/monitoring queues; labour_shifts user_name never renders on any tab.
// The People exception queue is EXCLUDED-BY-RULING; the gap map records it.
// Contract: { key, route, workspace, title, sub, getSection, render }. SELECT-only via ctx.q.
const S = require('../../shared.js');
const REP = require('../../reporting.js');
const K = require('../../kpi.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
const MONTHS_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dowLabel = (iso) => DOWS[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7];
const dayLabel = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS_ABBR[Number(iso.slice(5, 7))] || ''}`;

const TABS = [
  { key: 'executive', label: 'Executive' },
  { key: 'forecast', label: 'Labour Forecast' },
  { key: 'rota', label: 'Rota vs Actual' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'foh', label: 'Front of House' },
  { key: 'coverage', label: 'Coverage & People' },
];
const TAB_KEYS = TABS.map((t) => t.key);

// The ruled constants (rota-review spec — rulings, not data): variable splits, materiality,
// employer burden. The formula budget derives at read time; nothing here is a stored value.
const VAR_RATE = 0.224;           // kitchen 14.3% + FOH 8.1% combined
const VAR_RATE_DEPT = { kitchen: 0.143, foh: 0.081 };
const MATERIALITY_PENCE = 4500;   // the ruled £45 — OVER only beyond it
const BURDEN = 1.159;             // employer burden multiplier on hourly TRUE

// The June-2026 hole statement (stated once per affected panel, never bridged).
const JUNE_HOLE = 'the June 2026 hole — the labour backfill is blocked on the Leon Mackay RotaCloud fix';
function juneNote(missingDates) {
  return missingDates.some((d) => String(d).startsWith('2026-06')) ? ` (incl. ${JUNE_HOLE})` : '';
}

// The ruled status classes vs a formula/plan budget delta (mirrors the Drivers scorecard):
// OVER only beyond the £45 materiality; on/under both render good.
function ruledChip(deltaPence, overWord, underWord, onWord) {
  if (deltaPence == null) return S.rcc.tag('no labour');
  return deltaPence > MATERIALITY_PENCE ? S.rcc.tag(`${overWord} ${S.fmtGbpPence(deltaPence)}`, 'bad')
    : deltaPence <= 0 ? S.rcc.tag(underWord, 'good')
      : S.rcc.tag(onWord, 'good');
}

// ---------------------------------------------------------------------------------------------
// getSection builders — SELECT-only; every read degrades to an honest null on a missing table.
// ---------------------------------------------------------------------------------------------

// EXECUTIVE — last-full-week KPIs, 13-week control trend, attention queue, variance bridge,
// department control, daily control strip. TRUE ruler throughout (RC never renders here).
function buildExecutive(q, maxDate) {
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
  // budget % ((Σsalaried + 22.4% × net) ÷ net). A week with no labour_day rows is a GAP. ----
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
      budPct: w.interDays > 0 && w.net > 0 ? ((w.sal + VAR_RATE * w.net) / w.net) * 100 : null,
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
    rateMix: rateMix != null ? Math.round(rateMix * BURDEN) : null,
    hoursVar: hoursVar && num(hoursVar.p) != null ? Math.round(num(hoursVar.p) * BURDEN) : null,
    hoursVarMins: hoursVar ? num(hoursVar.mins) : null,
    unrota: unrota && num(unrota.p) != null ? Math.round(num(unrota.p) * BURDEN) : null,
    unrotaN: unrota ? num(unrota.n) || 0 : 0,
    unworked: unworked && num(unworked.p) != null ? -Math.round(num(unworked.p) * BURDEN) : null,
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
    const trueVar = row && num(row.ac) != null ? Math.round(num(row.ac) * BURDEN) : null;
    const budget = e.deptCtl.interNet != null ? Math.round(VAR_RATE_DEPT[d] * e.deptCtl.interNet) : null;
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
  // carries no department key and no per-shift timestamps — both stated on-panel) ----
  const one = (sql) => rowsOf(q(sql, [from14, maxDate]))[0] || null;
  r.decomp = {
    over: one(`SELECT COUNT(*) n, SUM(act_minutes - sched_minutes) mins FROM labour_shifts
                WHERE business_date BETWEEN ? AND ? AND sched_minutes > 0 AND act_minutes > sched_minutes`),
    unrota: one(`SELECT COUNT(*) n, SUM(act_minutes) mins FROM labour_shifts
                  WHERE business_date BETWEEN ? AND ? AND (sched_minutes IS NULL OR sched_minutes = 0) AND act_minutes > 0`),
    under: one(`SELECT COUNT(*) n, SUM(sched_minutes - COALESCE(act_minutes, 0)) mins FROM labour_shifts
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

  // ---- the revenue projection (the P4 assembly verbatim; labour READS it — never a copy) ----
  const nowYm = f.today.slice(0, 7);
  const year = Number(nowYm.slice(0, 4));
  const boundaryRow = rowsOf(q(`SELECT start_date FROM premises_regime WHERE name='current'`))[0];
  const boundaryDate = boundaryRow && boundaryRow.start_date ? String(boundaryRow.start_date) : '2023-04-01';
  const apiMonths = rowsOf(q(
    `SELECT substr(r.business_date,1,7) AS ym, SUM(r.net_without_tax_pence) AS net, COUNT(*) AS txn
       FROM sales_receipts_api r
      WHERE r.cancelled = 0 AND (r.type IS NULL OR r.type NOT IN ('VOID','CANCEL','RECALL'))
      GROUP BY ym ORDER BY ym`));
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

// COVERAGE & PEOPLE (pending) — the holding pen for the old page's un-absorbed panels:
// staffing shape (labour_hourly), today-live (labour_intraday), U18 WTR guard, rate parity.
function buildCoverage(q) {
  const c = {};
  const hm = rowsOf(q(`SELECT MAX(business_date) d FROM labour_hourly`))[0];
  c.hourMax = hm && hm.d ? String(hm.d) : null;
  c.byHour = c.hourMax
    ? rowsOf(q(`SELECT hour, SUM(actual_minutes) am FROM labour_hourly WHERE business_date BETWEEN ? AND ? GROUP BY hour ORDER BY hour`,
        [K.shiftDays(c.hourMax, -13), c.hourMax]))
    : [];
  c.intraday = rowsOf(q(`SELECT business_date, department, as_of_ms, sched_minutes_full, sched_cost_rc_full, worked_minutes_so_far, cost_rc_so_far, uncosted_minutes, clocked_in_now, no_shows, ref_date, ref_worked_minutes, ref_net_pence, ref_to_hour FROM labour_intraday ORDER BY department`));
  // U18 working-time flags — AGGREGATED per person/kind across ALL history (the systemic
  // pattern; a 20-row tail hid it). Rules cited at ingest (WTR 1998 young workers).
  c.wtr = rowsOf(q(`SELECT user_name, kind, COUNT(*) n, MAX(business_date) last FROM labour_wtr_flags GROUP BY user_name, kind`));
  c.wtrTotal = rowsOf(q(`SELECT COUNT(*) n, COUNT(DISTINCT user_name) people, MIN(business_date) lo, MAX(business_date) hi FROM labour_wtr_flags`))[0] || null;
  c.parity = rowsOf(q(`SELECT user_name, role_name, kind, rc_value, locked_value FROM labour_rate_parity ORDER BY user_name, role_id`));
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
    const m = { now, tab, maxDate: null };
    if (typeof q !== 'function') return m;
    const mx = rowsOf(q(`SELECT MAX(business_date) d FROM labour_day`))[0];
    m.maxDate = mx && mx.d ? String(mx.d) : null;
    if (tab === 'executive') m.exec = buildExecutive(q, m.maxDate);
    if (tab === 'rota') m.rota = buildRota(q, m.maxDate);
    if (tab === 'forecast') m.fc = buildForecast(q, m.maxDate, now);
    if (tab === 'kitchen' || tab === 'foh') m.dept = buildDept(q, m.maxDate, tab, now);
    if (tab === 'coverage') m.cov = buildCoverage(q);
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
      /* held coverage panels — the old labour page's grammar, carried with them */
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
      .lb-bars{display:flex;align-items:flex-end;gap:3px;height:90px;padding:6px 10px 0}
      .lb-bar{flex:1;background:linear-gradient(180deg,var(--cyan,#22D3EE),#0e6f7d);border-radius:3px 3px 0 0;min-height:2px;position:relative}
      .lb-bar span{position:absolute;bottom:-16px;left:0;right:0;text-align:center;font-size:9px;color:var(--muted,#7a8695)}
      .lb-live{border:1px solid var(--cyan-dim,rgba(34,211,238,.28));border-radius:14px;padding:2px 16px 14px;margin-bottom:6px;background:rgba(34,211,238,.03)}
      .G{color:var(--green,#34d399)} .A{color:var(--amber,#e0b050)} .R{color:var(--red,#f87171)}
    </style>`;

    const tabsNav = `<div class="r-tabs">${TABS.map((t) =>
      `<a class="r-tab${t.key === tab ? ' active' : ''}" href="/coyote/labour?tab=${t.key}">${esc(t.label)}</a>`).join('')}</div>`;

    const noWire = (what) => `<div class="banner muted">No settled labour-day record yet — ${what} light(s) up as the RotaCloud ingest fills <span class="mono">labour_day</span> (TRUE ruler: locked rates × 1.159 burden + salaried/365). Nothing here is ever estimated.</div>`;

    // ============================ EXECUTIVE ============================
    const renderExecutiveTab = () => {
      const e = m.exec;
      if (!e) return noWire('the executive control view');
      const wk = e.week;
      const agg = e.agg && num(e.agg.days) > 0 ? e.agg : null;
      const inter = e.inter && num(e.inter.days) > 0 && num(e.inter.net) > 0 ? e.inter : null;

      // ---- (1) KPI strip: six tiles, every one captions its ruler ----
      const labPct = inter ? (num(inter.ac) / num(inter.net)) * 100 : null;
      const budPct = inter ? ((num(inter.sal) + VAR_RATE * num(inter.net)) / num(inter.net)) * 100 : null;
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
      const kpiCaption = `<div class="lbc-caption">window = the last full Mon–Sun week ${esc(wk.from)} → ${esc(wk.to)} · ruler: TRUE all-in (labour_day — locked rates × 1.159 burden + salaried/365); RC-screen figures never render on this tab · % and SPLH divide over the sales∩labour intersection only (${inter ? int(num(inter.days)) : 0} day(s)) · formula budget = (Σ salaried + 22.4% × net) ÷ net — kitchen 14.3% + FOH 8.1%, the ruled variable splits.</div>`;

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
        body: trendBody + `<div class="r-mini-note">weekly labour % = Σ TRUE cost ÷ Σ net over each week's intersection days · budget % = (Σ salaried + 22.4% × net) ÷ net${gapCaption}. This trend ABSORBED the old labour hero spark — one home.</div>`,
      });

      // ---- (3) owner attention queue ----
      const alerts = [];
      for (const v of e.verdicts) {
        alerts.push(S.rcc.alert({
          title: `${v.dept.toUpperCase()} — ${v.mode.toUpperCase()} w/c ${v.week}`,
          text: `rota-review verdict vs the formula budget${v.budgetPence != null ? ` ${gbp(v.budgetPence)}` : ''}${v.salariedPence != null ? ` (salaried ${gbp(v.salariedPence)} inside)` : ''}`,
          impact: v.deltaPence > 0 ? `${gbp(v.deltaPence)} OVER` : `${gbp(-v.deltaPence)} under`,
          tone: v.deltaPence > MATERIALITY_PENCE ? 'bad' : v.deltaPence > 0 ? undefined : 'good',
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
        headRight: `<a class="r-pill" href="/coyote/rota-review">Rota Review report →</a>`,
        body: queueBody + `<div class="r-mini-note">verdict receipts (history + full text) stay on the <a href="/coyote/rota-review" style="color:${S.rcc.tokens.accent2}">Rota Review report</a> — no duplication. The People exception queue is EXCLUDED BY RULING (surveillance boundary): people appear as rota-structural facts only.</div>`,
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
          <div class="r-mini-note">endpoints = labour_day scheduled → actual TRUE £ for ${esc(wk.from)} → ${esc(wk.to)} · shift effects at the shift's locked rate × 1.159 burden (salaried/365 sits identically in both endpoints, so it cancels) · AGGREGATE only — no person keys, ever.</div>`;
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
        const rate = `${(VAR_RATE_DEPT[d.dept] * 100).toFixed(1)}%`;
        if (d.trueVar == null || d.budget == null) {
          return S.rcc.panel({
            title: `Department control — ${name}`, sub: `variable TRUE vs ${rate} × net`,
            body: S.rcc.emptyState({ title: `${name} week control`, blocker: dc.interDays === 0 ? 'no sales∩labour intersection day this week — the budget side needs net.' : `no ${name} labour_dept rows on the intersection days.`, unlock: 'the daily ingests' }),
          });
        }
        return S.rcc.panel({
          title: `Department control — ${name}`, sub: `variable TRUE vs the ruled ${rate} × net · ${int(dc.interDays)} intersection day(s)`,
          headRight: ruledChip(d.delta, 'OVER', 'UNDER budget', 'On budget'),
          body: `<table><tbody>
              <tr><td>Variable TRUE cost</td><td class="r-num mono">${gbp(d.trueVar)}</td></tr>
              <tr><td>Variable budget (${esc(rate)} × ${gbp(dc.interNet)} net)</td><td class="r-num mono">${gbp(d.budget)}</td></tr>
              <tr><td>Delta</td><td class="r-num mono">${signGbp(d.delta)}</td></tr>
              <tr><td>Worked hours (intersection days)</td><td class="r-num mono">${hrs(d.mins)}</td></tr>
            </tbody></table>
            <div class="r-mini-note">variable TRUE = dept hourly cost × 1.159 burden; the salaried term sits identically in the ruled budget (salaried burdened + var% × net) and in TRUE cost, so it cancels and the delta is exact · OVER only beyond the ruled £45 materiality · senior-mix vs the ruled &gt;40% MIX threshold is omitted — labour_shifts carries no department key (the rota-review verdicts carry the ruled MIX notes).</div>`,
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
        const budV = netOk ? (((r.lab.sal || 0) + Math.round(VAR_RATE * r.net)) / r.net) * 100 : null;
        const delta = netOk && r.lab.ac != null ? r.lab.ac - ((r.lab.sal || 0) + Math.round(VAR_RATE * r.net)) : null;
        const daySplh = netOk && num(r.lab.am) > 0 ? Math.round(r.net / (num(r.lab.am) / 60)) : null;
        return `<tr><td>${esc(dowLabel(r.date))} ${esc(r.date)}</td>
          <td class="r-num mono">${r.net != null ? gbp(r.net) : '<span class="ash">no sales record</span>'}</td>
          <td class="r-num mono">${gbp(r.lab.ac)}</td>
          <td class="r-num mono">${pct1(pctV)}</td>
          <td class="r-num mono">${pct1(budV)}</td>
          <td>${netOk ? ruledChip(delta, 'Over', 'Under formula', 'On formula') : S.rcc.tag('no net')}</td>
          <td class="r-num mono">${daySplh != null ? gbp(daySplh) : '—'}</td></tr>`;
      }).join('');
      const stripPanel = S.rcc.panel({
        title: 'Daily control strip', sub: `last 7 days to ${e.maxDate} · TRUE labour vs the daily formula budget`,
        body: `<div style="overflow:auto"><table><thead><tr><th>Day</th><th class="r-num">Net</th><th class="r-num">TRUE labour £</th><th class="r-num">Labour %</th><th class="r-num">Budget %</th><th>Status</th><th class="r-num">SPLH</th></tr></thead><tbody>${stripRows}</tbody></table></div>
          <div class="r-mini-note">daily budget = salaried + 22.4% × net (the ruled splits) · STATUS: OVER only beyond the £45 materiality · an absent labour day says so${stripMissing.length ? esc(juneNote(stripMissing)) : ''} — never a zero · the labour DETAIL home is here; the Revenue Drivers scorecard keeps its cross-domain columns and points here.</div>`,
      });

      return `<div class="r-grid r-kpi-grid">${kpis}</div>${kpiCaption}
        <div class="r-grid r-two-col">${trendPanel}${queuePanel}</div>
        ${deptRow}${stripPanel}`;
    };

    // ============================ ROTA VS ACTUAL ============================
    const renderRotaTab = () => {
      const r = m.rota;
      if (!r) return noWire('rota vs actual');
      const days = r.days || [];

      // ---- (1) daily hours: 14d paired columns sched vs actual ----
      let hoursBody;
      const withMins = days.filter((d) => d.sm != null || d.am != null);
      if (withMins.length) {
        const maxMin = Math.max(...withMins.flatMap((d) => [d.sm || 0, d.am || 0]), 1);
        const all14 = [];
        for (let i = 13; i >= 0; i--) all14.push(K.shiftDays(r.maxDate, -i));
        const byDate = new Map(days.map((d) => [d.date, d]));
        const cols = all14.map((iso) => {
          const d = byDate.get(iso);
          if (!d) return `<div class="lbc-day" title="${esc(`${dowLabel(iso)} ${iso} — no labour record`)}"><div class="lbc-bars"></div><span class="lbc-daylabel">${esc(dayLabel(iso))}</span></div>`;
          const hS = Math.max(2, Math.round(((d.sm || 0) / maxMin) * 140));
          const hA = Math.max(2, Math.round(((d.am || 0) / maxMin) * 140));
          const tip = `${dowLabel(iso)} ${iso} — rota'd ${hrs(d.sm)} · worked ${hrs(d.am)}`;
          return `<div class="lbc-day" title="${esc(tip)}"><div class="lbc-bars"><div class="lbc-bar sched" style="height:${hS}px"></div><div class="lbc-bar act" style="height:${hA}px"></div></div><span class="lbc-daylabel">${esc(dayLabel(iso))}</span></div>`;
        }).join('');
        const missing = all14.filter((iso) => !byDate.has(iso));
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
        <div class="r-mini-note">early-in vs late-out CANNOT be split — labour_shifts carries no per-shift clock timestamps, only variance_minutes; what IS computable renders above · SITE-level aggregate (labour_shifts carries no department key — checked) · counts and hours only, NO names — the surveillance boundary ruling.</div>`;
      } else {
        decompBody = S.rcc.emptyState({ title: 'Where the extra hours came from', blocker: 'no labour_shifts rows in the 14-day window.', unlock: 'the daily RotaCloud ingest (shift grain)' });
      }
      const decompPanel = S.rcc.panel({
        title: 'Where the extra hours came from', sub: `shift-variance decomposition · 14 days to ${r.maxDate}`,
        body: decompBody,
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
            <td>${ruledChip(delta, 'Over sched', 'Under sched', 'On sched')}</td></tr>`;
        }).join('');
        reconBody = `<div style="overflow:auto"><table><thead><tr><th>Day</th><th class="r-num">Sched hrs</th><th class="r-num">Sched £</th><th class="r-num">Actual hrs</th><th class="r-num">Actual £</th><th class="r-num">Paid hrs</th><th class="r-num">Δ £</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="r-mini-note">£ = TRUE ruler (labour_day, burdened + salaried/365) · paid hrs = actual_paid_minutes (RotaCloud's paid figure) · a missing day is an ABSENT row, never zeros · STATUS vs schedule: over only beyond the ruled £45 materiality.</div>`;
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
          ${delta != null ? `<div class="r-callout" style="margin-top:10px">actual delta <strong>${signGbp(delta)}</strong> = ×1.159 employer burden on hourly + salaried/365 apportionment (RC shows salaried at £0${rc && num(rc.um) > 0 ? ` — ${hrs(num(rc.um))} uncosted in RC this week` : ''}) + locked-vs-RC rate differences (see Rate parity, Coverage &amp; People).</div>` : ''}
          <div class="r-mini-note">RC-screen = labour_dept (RotaCloud's own per-user rates, pre-burden — what Calum and Jordan manage against in-app) · TRUE = labour_day (locked rates × 1.159 + salaried/365) · <b>RC screens recomputed from LIVE rates, never cached</b> — the standing ruling · the two rulers are never compared as like-for-like; this card exists to translate, not to blend.</div>`;
      } else {
        costBody = S.rcc.emptyState({ title: 'Cost-definition reconciliation', blocker: 'no labour rows in the last full week on either ruler.', unlock: 'the daily RotaCloud ingest' });
      }
      const costPanel = S.rcc.panel({ title: 'Cost-definition reconciliation', sub: 'RC-screen vs TRUE — the two-ruler translation', body: costBody });

      return `<div class="r-grid r-two-col">${hoursPanel}${decompPanel}</div>
        ${reconPanel}
        <div class="r-grid r-two-col">${accPanel}${costPanel}</div>`;
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
      const kVar = basisNet != null ? Math.round(VAR_RATE_DEPT.kitchen * basisNet) : null;
      const fVar = basisNet != null ? Math.round(VAR_RATE_DEPT.foh * basisNet) : null;
      const budget = basisNet != null ? Math.round(VAR_RATE * basisNet) + (sal ? sal.pence : 0) : null;
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
            : `Σ published hourly shifts at locked rate × 1.159${wf.shifts && (wf.shifts.salMins > 0 || wf.shifts.unmapMins > 0) ? ` — PARTIAL: ${hrs(wf.shifts.salMins)} salaried + ${hrs(wf.shifts.unmapMins)} unmapped rota hours carry no £ here` : ''}`}</span>`;
        interactiveBody = `<table><tbody>
            <tr><td>Forecast net — w/c ${esc(wk.from)}</td><td class="r-num mono" id="wf-net">${gbp(basisNet)}</td></tr>
            <tr><td>Kitchen variable (14.3% × net)</td><td class="r-num mono" id="wf-k">${gbp(kVar)}</td></tr>
            <tr><td>FOH variable (8.1% × net)</td><td class="r-num mono" id="wf-f">${gbp(fVar)}</td></tr>
            <tr><td>Salaried (site, burdened day-grain)</td><td class="r-num mono">${sal ? gbp(sal.pence) : '<span class="ash">no settled week to source it — variable-only budget, stated</span>'}</td></tr>
            <tr><td>Formula budget (salaried + 22.4% × net)</td><td class="r-num mono" id="wf-bud">${gbp(budget)}</td></tr>
            <tr><td>Published rota promise</td><td class="r-num mono">${promiseCell}</td></tr>
            <tr><td>Promise vs budget</td><td class="r-num mono">${delta != null ? signGbp(delta) : '—'}</td></tr>
          </tbody></table>
          <div class="slider-wrap">
            <div class="slider-head"><div><div class="r-kpi-label">What-if: net basis ±15%</div><div class="r-panel-sub">what-if only, nothing stored — client-side arithmetic on this page, never persisted, never sent anywhere</div></div><b id="wf-val">0.0%</b></div>
            <input id="wf-range" type="range" min="-15" max="15" step="0.5" value="0" data-net="${basisNet}" data-sal="${sal ? sal.pence : 0}">
            <div class="r-mini-note">the slider rescales the net basis and re-derives the formula lines (textContent only); the promise and the verdict chip stay on the published basis. The journaled management override lives on the Revenue forecast — one home.</div>
          </div>
          <div class="r-mini-note">net basis = ${esc(basisLabel)} · budget = the ruled formula (salaried burdened + K 14.3% / F 8.1% × net)${sal ? ` — salaried from the last settled week ${esc(sal.from)} → ${esc(sal.to)} (day-grain constant by construction)` : ''} · promise ${promiseSrc === 'verdict' ? '= the FORWARD rota-review verdict (the canonical promise)' : promiseSrc === 'shifts' ? '= rota_ahead_shifts hourly TRUE only — salaried is day-apportioned in the engine, never estimated here' : 'awaits a published rota'} · OVER only beyond the ruled £45 materiality.</div>`;
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
        headRight: delta != null ? ruledChip(delta, 'OVER', 'UNDER budget', 'On budget') : S.rcc.tag(basisNet == null ? 'no forecast basis' : 'no published promise'),
        body: interactiveBody,
      });

      // ---- five-band target curve (the DERIVED view — levels are observed quantiles) ----
      let bandsBody;
      if (f.bands && f.bands.levels) {
        const rows = f.bands.levels.map((L) => {
          const bud = Math.round(VAR_RATE * L.net) + (sal ? sal.pence : 0);
          const pct = (bud / L.net) * 100;
          return `<tr><td>${esc(L.name)} <span class="ash">${esc(L.p)}</span></td>
            <td class="r-num mono">${gbp(L.net)}</td><td class="r-num mono">${gbp(bud)}</td>
            <td class="r-num mono">${pct.toFixed(1)}%</td></tr>`;
        }).join('');
        bandsBody = `<table><thead><tr><th>Band</th><th class="r-num">Weekly net level</th><th class="r-num">Formula budget</th><th class="r-num">Budget % of net</th></tr></thead><tbody>${rows}</tbody></table>
          <div class="r-mini-note">bands = observed weekly-net quantiles of the trailing 26 full weeks (${int(f.bands.weeksUsed)} full week(s) used, ${esc(f.bands.from)} → ${esc(f.bands.to)}) — the DERIVED view of the formula, never hand-set rows (the ruling): band % = (salaried + 22.4% × net) ÷ net at each level; the salaried term is fixed, so the % FALLS as net rises${sal ? '' : ' — the salaried term is unsourced (no settled labour week), so these are VARIABLE-ONLY budgets, flat at 22.4%'}${f.bands.excluded.length ? ` · ${int(f.bands.excluded.length)} partial week(s) excluded, not padded${esc(juneNote(f.bands.excluded))}` : ''} · ~30% of net at the High-band anchor is the ruled combined ceiling.</div>`;
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
          const wBud = w.basisNet != null ? Math.round(VAR_RATE * w.basisNet) + (sal ? sal.pence : 0) : null;
          const wProm = w.shifts && w.shifts.hourlyPence != null ? w.shifts.hourlyPence : null;
          const wDelta = wProm != null && wBud != null ? wProm - wBud : null;
          return `<tr><td>${esc(dayLabel(w.from))} <span class="ash">w/c ${esc(w.from)}</span></td>
            <td>${w.basis === 'published' ? S.rcc.tag('published', 'info') : w.basis === 'projection' ? S.rcc.tag('projection') : '<span class="ash">no basis</span>'}${w.basis !== 'published' && w.publishedDays > 0 ? ` <span class="ash">${int(w.publishedDays)}/7 targets</span>` : ''}</td>
            <td class="r-num mono">${w.basisNet != null ? gbp(w.basisNet) : '—'}</td>
            <td class="r-num mono">${wBud != null ? gbp(wBud) : '—'}</td>
            <td class="r-num mono">${wProm != null ? gbp(wProm) : '<span class="ash">rota not published</span>'}</td>
            <td>${wDelta != null ? ruledChip(wDelta, 'Over', 'Under budget', 'On budget') : w.shifts ? S.rcc.tag('hours only') : S.rcc.tag('rota not published')}</td></tr>`;
        }).join('');
        const salHours = f.outlook.reduce((s, w) => s + (w.shifts ? w.shifts.salMins + w.shifts.unmapMins : 0), 0);
        outlookBody = `<div style="overflow:auto"><table><thead><tr><th>Week</th><th>Net basis</th><th class="r-num">Basis £</th><th class="r-num">Formula budget</th><th class="r-num">Rota promise</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="r-mini-note">basis: published = Σ RC daily revenue targets (rota_ahead_budget, dept rows deduplicated, whole weeks only) · projection = the revenue projection's calendar-day weekly share${methodLabel ? ` (${esc(methodLabel)} · ${esc(ovBit)})` : ''} · promise = Σ published HOURLY shifts at locked rate × 1.159${salHours > 0 ? ` — ${hrs(salHours)} salaried/unmapped rota hours across the window carry no £ here (day-apportioned in the engine / never estimated)` : ''} · an unpublished week SAYS so — never a zero, never an estimate.</div>`;
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
          <div class="r-mini-note">next 14 days of the PUBLISHED rota (rota_ahead_shifts snapshot), aggregated per day + department — the rota carries names; they are aggregated away here BY RULING (NO NAMES, the surveillance boundary) · £ = hourly shifts at locked rate × 1.159 (TRUE); salaried hours are day-apportioned in the engine and unmapped hours are never estimated — both render as uncosted hours, stated · a day with nothing published is simply absent.</div>`;
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
          'variable splits (ruled): kitchen 14.3% · FOH 8.1% · combined 22.4%',
          'anchor: ~30% of net combined at the High band — % falls as net rises (salaried is fixed)',
          'bands = observed weekly-net quantiles of the trailing 26 full weeks — a DERIVED view; band rows are never hand-set',
          'OVER only beyond the ruled £45 materiality',
          'TRUE ruler = locked rates × 1.159 employer burden + salaried/365 — RC screens translate on Rota vs Actual only, never mixed',
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
      const rate = VAR_RATE_DEPT[dept];
      const rateStr = `${(rate * 100).toFixed(1)}%`;
      if (!d) return noWire(`the ${name} department view`);

      // ---- (1) day performance: 14 days · dept variable TRUE vs var% × net ----
      let dayBody;
      if (d.maxDate && d.days && d.days.length) {
        const missingDept = d.days.filter((r) => !r.dep).map((r) => r.date);
        const rows = d.days.map((r) => {
          const trueVar = r.dep && r.dep.ac != null ? Math.round(r.dep.ac * BURDEN) : null;
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
            <td>${netOk ? ruledChip(dl, 'Over', 'Under budget', 'On budget') : S.rcc.tag('no net')}</td>
            <td class="r-num mono">${hrs(r.dep.am)}</td>
            <td class="r-num mono">${splh != null ? gbp(splh) : '—'}</td></tr>`;
        }).join('');
        dayBody = `<div style="overflow:auto"><table><thead><tr><th>Day</th><th class="r-num">Site net</th><th class="r-num">${esc(name)} variable TRUE £</th><th class="r-num">Var budget (${esc(rateStr)} × net)</th><th class="r-num">Δ £</th><th>Status</th><th class="r-num">${esc(name)} hrs</th><th class="r-num">Site SPLH</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="r-mini-note">variable TRUE = ${esc(name)} labour_dept hourly cost × 1.159 burden; the salaried term sits identically in the ruled dept budget (salaried burdened + ${esc(rateStr)} × net) and in TRUE cost, so it cancels and the delta is exact (the L1 dept-control discipline) · STATUS: OVER only beyond the ruled £45 materiality · a dept SPLH (site net ÷ dept hours) would be dishonest — it credits one department with the whole site's take — so dept HOURS render with the SITE SPLH (net ÷ site worked hours) as context, captioned${missingDept.length ? ` · ${int(missingDept.length)} day(s) have no ${esc(name)} labour_dept record — absent${esc(juneNote(missingDept))}, never zero` : ''}.</div>`;
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
      const varPct = interNet != null && d.inter && num(d.inter.ac) != null ? ((num(d.inter.ac) * BURDEN) / interNet) * 100 : null;
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
          <div class="r-mini-note">variable % = labour_dept hourly cost × 1.159 ÷ net over the sales∩dept intersection days only (day-count labelled — the cross-ruler discipline) · hours share = labour_dept minute grain, RC paid basis (ruler-free) · senior mix = the rota-review MIX note VERBATIM — one home, never recomputed here.</div>`,
      });

      return `${dayPanel}
        <div class="r-grid r-two-col">${demandPanel}${rolePanel}</div>
        ${ratiosPanel}`;
    };

    const renderKitchenTab = () => renderDeptTab('kitchen');
    const renderFohTab = () => renderDeptTab('foh');

    // ============================ COVERAGE (pending, holds the old panels) ============================
    const pendingNote = (what) => `<div class="banner amber">PENDING — the next stage builds this tab to the mock (${esc(what)}). No number renders here until it is computed honestly; nothing is mocked.</div>`;

    const renderCoverageTab = () => {
      const c = m.cov || {};
      const parts = [pendingNote('combined coverage-vs-required heatmap, aggregate people KPIs, compliance ratios — below, the panels this centre inherited from the old labour page HOLD here until their L2 home is built. The People exception queue is EXCLUDED BY RULING (surveillance boundary) and does not render')];

      // ---- staffing shape (held) — worked minutes by hour, ruler-free ----
      const hoursArr = (c.byHour || []).filter((h) => num(h.am) != null && num(h.am) > 0);
      if (hoursArr.length >= 2) {
        const mx = Math.max(...hoursArr.map((h) => num(h.am) || 0)) || 1;
        const bars = hoursArr.map((h) => { const hh = num(h.hour) >= 24 ? num(h.hour) - 24 : num(h.hour); return `<div class="lb-bar" style="height:${Math.max(2, Math.round((num(h.am) || 0) / mx * 80))}px" title="${esc(String(hh))}:00 — ${hrs(h.am)}"><span>${esc(String(hh))}</span></div>`; }).join('');
        parts.push(`<div class="lb-sec">Staffing shape <span class="lb-sub">worked hours by hour of day · 14 days to ${esc(c.hourMax || '')} · minute grain, ruler-free</span></div>
          <div class="lb-card"><div class="lb-bars">${bars}</div><div style="height:14px"></div>
          <div class="lb-hint" style="margin:0 12px">Where worked hours land across the day — the shape you flex against trade. Becomes the coverage-vs-required heatmap in L2.</div></div>`);
      } else {
        parts.push(`<div class="lb-sec">Staffing shape</div><div class="banner muted">No hourly staffing record yet (labour_hourly) — the RotaCloud ingest fills it; nothing is estimated.</div>`);
      }

      // ---- today-live (held) — the intraday snapshot with its own honesty ----
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
          let noShows = []; try { noShows = JSON.parse(r.no_shows || '[]'); } catch (e) { /* keep going */ }
          const noShowHtml = noShows.length ? `<tr><td class="R">NO-SHOW (15min+)</td><td class="R">${noShows.map((x) => `${esc(x.name)} <span class="mono">rota'd ${lonTime(num(x.rota_start_ms))}</span>`).join(' · ')}</td></tr>` : '';
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

      // ---- U18 working-time guard (held) ----
      parts.push(`<div class="lb-sec">U18 working-time guard <span class="lb-sub">WTR 1998 young workers — all history · regulatory, ruled compliant to render</span></div>`);
      const flags = c.wtr || [];
      if (!flags.length) {
        parts.push(`<div class="banner muted">U18 working-time ✓ — no flags (8h/day · 40h/wk fixed · 22:00+ surfaced · 00:00–04:00 absolute; re-checked every ingest).</div>`);
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
        parts.push(`<div class="banner">🔴 <b>${num(t.n) || flags.reduce((x, f) => x + (num(f.n) || 0), 0)} U18 working-time flag${(num(t.n) || 0) === 1 ? '' : 's'}</b> across ${esc(String(num(t.people) || byUser.size))} young worker${(num(t.people) || 0) === 1 ? '' : 's'}${span}. <b class="R">${hardTotal}</b> are HARD legal limits (over-8h day / over-40h week / worked-past-midnight — no catering exception); the amber column is the permitted-with-conditions 22:00–24:00 window.</div>
          <div class="lb-card"><table class="lb-tbl"><thead><tr><th>young worker</th><th style="text-align:right" class="R">over 8h day</th><th style="text-align:right" class="R">over 40h wk</th><th style="text-align:right" class="R">past midnight</th><th style="text-align:right" class="A">past 22:00</th><th style="text-align:right">last</th></tr></thead><tbody>${wtrRows}</tbody></table>
          <div class="lb-hint" style="margin:8px 12px 0">Limits: 8h/day &amp; 40h/week are fixed with no averaging (gov.uk/maximum-weekly-working-hours); 22:00–06:00 is restricted but catering is an excepted sector, while 00:00–04:00 is an absolute ban (gov.uk/night-working-hours). The red columns are rota-policy action items — raise with Calum &amp; Jordan.</div></div>`);
      }

      // ---- rate parity (held) ----
      parts.push(`<div class="lb-sec">Rate parity <span class="lb-sub">locked table vs RotaCloud · payroll correctness, ruled compliant to render</span></div>`);
      if (!c.parity || c.parity.length === 0) {
        parts.push(`<div class="banner muted">Rate parity ✓ — locked 2026/27 table and RotaCloud's stored rates agree (re-checked every ingest).</div>`);
      } else {
        const KIND = { role_rate_mismatch: 'rate differs', rc_missing_rate: 'no rate in RotaCloud (costs £0 in-app)', locked_missing_rate: 'not in locked table', salary_mismatch: 'salary differs', rc_missing_salary: 'salary missing in RotaCloud' };
        const pRows = c.parity.map((x) => `<tr><td>${esc(x.user_name || '')}</td><td>${esc(x.role_name || '—')}</td><td>${esc(KIND[x.kind] || x.kind)}</td><td class="n">${esc(x.rc_value || '—')}</td><td class="n">${esc(x.locked_value || '—')}</td></tr>`).join('');
        parts.push(`<div class="banner">🔴 <b>${c.parity.length} rate discrepanc${c.parity.length === 1 ? 'y' : 'ies'}</b> between RotaCloud and the locked 2026/27 table — the managers' in-app % uses <i>their</i> rates, so the RC screens are unfair until fixed <b>in RotaCloud</b>.</div>
          <div class="lb-card"><table class="lb-tbl"><thead><tr><th>who</th><th>role</th><th>finding</th><th style="text-align:right">RotaCloud</th><th style="text-align:right">locked table</th></tr></thead><tbody>${pRows}</tbody></table></div>`);
      }

      return parts.join('\n');
    };

    const tabBody = tab === 'rota' ? renderRotaTab()
      : tab === 'forecast' ? renderForecastTab()
      : tab === 'kitchen' ? renderKitchenTab()
      : tab === 'foh' ? renderFohTab()
      : tab === 'coverage' ? renderCoverageTab()
      : renderExecutiveTab();

    const body = `<div class="rcc">` + styles + tabsNav + tabBody + `</div>`;
    const stamp = m.maxDate
      ? `labour · <span class="mono">RotaCloud · ${esc(m.maxDate)}</span>`
      : 'labour · <span class="none">awaiting labour-day record</span>';
    return { stamp, body };
  },
};
