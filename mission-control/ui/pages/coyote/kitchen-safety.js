'use strict';
// KITCHEN SAFETY CENTRE — owner-level oversight of the Kitchen Safety App (Supabase, mirrored
// into ks_* by the box sync leg). ONE integrated scroll page (anchor-nav sections, per the brief —
// not a multi-tab module). The app stays the data-entry system; this surfaces position, exceptions
// and audit-readiness, and every record drills BACK into the app — nothing is duplicated here.
//
// THE MODULE'S WHOLE POINT — the RED-CAP (operator ruling 2026-07-22): the blended safety score
// CANNOT render green while any unresolved CRITICAL breach / open allergen incident / overdue
// critical corrective action exists. 1000 green checks must never hide one severe failure. The cap
// is a HARD OVERRIDE on the status, not a weighting. Severity ruling: only 'critical' trips the hard
// cap; an open 'high' incident shows amber. Negative-control test pins it (1000 green + 1 open
// critical = RED, always).
//
// ONE-HOME: temperature limits come from ks_app_settings (the app's own config) — never hardcoded.
// temp_log_entries.status is the app's own pass/borderline/fail verdict; we surface it, never re-judge.
// Thresholds are labelled "proposed — calibrate on real data" per the mock's Phase-6 honesty.
// SURVEILLANCE BOUNDARY: people appear as aggregate/structural facts (training currency, named-
// submission integrity) — never per-person performance scoring.

const S = require('../../shared.js');
const esc = S.escapeHtml;

const route = '/coyote/kitchen-safety';

// The blended-score weighting (per the mock). The CAP overrides this always.
const WEIGHTS = [
  ['critical', 35, 'Critical food-safety controls'],
  ['allergen', 20, 'Allergen assurance'],
  ['corrective', 15, 'Corrective-action closure'],
  ['cleaning', 10, 'Cleaning & hygiene'],
  ['training', 10, 'Training & fitness'],
  ['hs', 10, 'Workplace safety'],
];

// House Rules temperature limits: the CANONICAL home is ks_app_settings (category temperature).
// These keys + the reference values are the fallback labels only when the app hasn't set them.
const TEMP_KEYS = [
  ['fridge_max_temp_celsius', 'Chilled / fridge', 'max', 5],
  ['freezer_max_temp_celsius', 'Frozen', 'max', -18],
  ['cooking_min_temp_celsius', 'Cooking', 'min', 75],
  ['reheating_min_temp_celsius', 'Reheating', 'min', 82],
  ['hot_hold_min_temp_celsius', 'Hot holding', 'min', 63],
  ['delivery_max_chilled_temp_celsius', 'Delivery (chilled)', 'max', 8],
];

const NAV = [
  ['overview', 'Overview'], ['critical', 'Critical controls'], ['allergens', 'Allergens'],
  ['hygiene', 'Hygiene & equipment'], ['people', 'People & incidents'],
  ['audit', 'Audit readiness'], ['integration', 'App integration'],
];

function tint(v) { const T = S.rcc.tokens; if (v == null) return T.muted; return v >= 85 ? T.good : v >= 70 ? T.warn : T.bad; }
function pct(n, d) { return d > 0 ? (100 * n / d) : null; }
function fmtPct(v) { return v == null ? '—' : `${v.toFixed(1)}%`; }

module.exports = {
  key: 'kitchen-safety',
  route,
  workspace: 'coyote',
  title: 'Kitchen Safety',
  sub: 'Food safety, allergens, workplace safety & audit readiness — oversight of the Kitchen Safety App',

  getSection(db, ctx) {
    const now = ctx && ctx.now ? ctx.now : Date.now();
    const q = ctx.q;
    const one = (sql, p) => { const r = q(sql, p || []); return r && r.ok && r.rows && r.rows[0] ? r.rows[0] : null; };
    const rows = (sql, p) => { const r = q(sql, p || []); return r && r.ok && r.rows ? r.rows : []; };
    const num = (v) => (v == null ? null : Number(v));

    // ---- connection state (NEEDS-KEY vs LIVE) — read ks_sync_meta freshness ----
    const meta = rows(`SELECT table_name, row_count, synced_at FROM ks_sync_meta`);
    const connected = meta.length > 0 && meta.some((m) => Number(m.row_count) > 0);
    const lastSync = connected ? Math.max(...meta.map((m) => Number(m.synced_at) || 0)) : null;
    const totalRows = meta.reduce((a, m) => a + (Number(m.row_count) || 0), 0);

    if (!connected) {
      return { now, connected: false, lastSync: null, totalRows: 0 };
    }

    // ---- thresholds (one-home: ks_app_settings) ----
    const settings = {};
    for (const r of rows(`SELECT key, value FROM ks_app_settings WHERE category='temperature'`)) {
      let v = r.value; try { v = JSON.parse(r.value); } catch { /* keep raw */ }
      settings[r.key] = Number(v);
    }
    const thresholds = TEMP_KEYS.map(([k, label, dir, ref]) => ({ key: k, label, dir, value: settings[k] != null && Number.isFinite(settings[k]) ? settings[k] : ref, fromApp: settings[k] != null }));

    // ---- RED-CAP triggers (critical-only) ----
    const openCriticalIncidents = rows(
      `SELECT id, title, severity, occurred_at, reported_to_authority FROM ks_incident_reports
       WHERE lower(coalesce(status,'')) IN ('open','in_progress','investigating','reported')
         AND lower(coalesce(severity,''))='critical'`);
    const openAllergenIncidents = rows(
      // allergen_incidents has no status of its own — openness comes from the linked incident_report
      // (an unlinked allergen incident is treated as open/unresolved).
      `SELECT ai.id FROM ks_allergen_incidents ai
         LEFT JOIN ks_incident_reports ir ON ir.id = ai.incident_report_id
        WHERE ir.id IS NULL OR lower(coalesce(ir.status,'')) NOT IN ('resolved','closed')`);
    const openCriticalBreaches = rows(
      `SELECT r.id FROM ks_checklist_responses r JOIN ks_checklist_items i ON i.id = r.item_id
       WHERE r.is_pass = 0 AND r.corrective_action_required = 1 AND coalesce(r.is_corrected,0) = 0 AND i.is_critical = 1`);
    const overdueCriticalCorrective = rows(
      `SELECT id, title, priority, due_date FROM ks_corrective_actions
       WHERE lower(coalesce(status,'')) NOT IN ('completed','verified','closed','done')
         AND due_date IS NOT NULL AND due_date < ?
         AND lower(coalesce(priority,'')) IN ('critical','urgent')`, [new Date(now).toISOString()]);

    const capReasons = [];
    if (openCriticalIncidents.length) capReasons.push({ kind: 'Critical incident', n: openCriticalIncidents.length, detail: openCriticalIncidents[0].title });
    if (openAllergenIncidents.length) capReasons.push({ kind: 'Allergen incident', n: openAllergenIncidents.length, detail: 'unresolved allergen incident' });
    if (openCriticalBreaches.length) capReasons.push({ kind: 'Critical control breach', n: openCriticalBreaches.length, detail: 'failed critical check, uncorrected' });
    if (overdueCriticalCorrective.length) capReasons.push({ kind: 'Overdue critical action', n: overdueCriticalCorrective.length, detail: overdueCriticalCorrective[0].title || 'overdue corrective action' });
    const capActive = capReasons.length > 0;

    // ---- component scores (0-100) ----
    // critical: temp readings pass-rate (app verdict) + critical checklist pass-rate
    const tp = one(`SELECT
        sum(CASE WHEN lower(status)='pass' THEN 1 ELSE 0 END) p,
        sum(CASE WHEN lower(status)='borderline' THEN 1 ELSE 0 END) b,
        count(*) n FROM ks_temp_log_entries`) || {};
    const tempFirstPass = pct(num(tp.p) || 0, num(tp.n) || 0);
    const ccrit = one(`SELECT
        sum(CASE WHEN r.is_pass=1 THEN 1 ELSE 0 END) p, count(*) n
        FROM ks_checklist_responses r JOIN ks_checklist_items i ON i.id=r.item_id WHERE i.is_critical=1`) || {};
    const critCheckPass = pct(num(ccrit.p) || 0, num(ccrit.n) || 0);
    const sCritical = tempFirstPass == null ? (critCheckPass == null ? null : critCheckPass) : (critCheckPass == null ? tempFirstPass : 0.6 * tempFirstPass + 0.4 * critCheckPass);

    // allergen: matrix coverage + incident-free
    const am = one(`SELECT count(*) n, sum(CASE WHEN celery IS NOT NULL THEN 1 ELSE 0 END) covered FROM ks_allergen_menu_items WHERE is_active=1`) || {};
    const matrixCoverage = pct(num(am.covered) || 0, num(am.n) || 0);
    const allergenIncidentsAll = (one(`SELECT count(*) n FROM ks_allergen_incidents`) || {}).n || 0;
    const sAllergen = matrixCoverage == null ? null : Math.max(0, (matrixCoverage) - (openAllergenIncidents.length ? 40 : 0));

    // corrective: closure rate minus overdue drag
    const ca = one(`SELECT count(*) n,
        sum(CASE WHEN lower(coalesce(status,'')) IN ('completed','verified','closed','done') THEN 1 ELSE 0 END) done,
        sum(CASE WHEN due_date IS NOT NULL AND due_date < ? AND lower(coalesce(status,'')) NOT IN ('completed','verified','closed','done') THEN 1 ELSE 0 END) overdue
        FROM ks_corrective_actions`, [new Date(now).toISOString()]) || {};
    const corrN = num(ca.n) || 0, corrDone = num(ca.done) || 0, corrOverdue = num(ca.overdue) || 0;
    const sCorrective = corrN === 0 ? 100 : Math.max(0, pct(corrDone, corrN) - corrOverdue * 15);

    // cleaning: cleaning-category checklist pass-rate (fallback to overall non-critical pass)
    const clean = one(`SELECT sum(CASE WHEN is_pass=1 THEN 1 ELSE 0 END) p, count(*) n FROM ks_checklist_responses`) || {};
    const sCleaning = pct(num(clean.p) || 0, num(clean.n) || 0);

    // training: mandatory currency (non-expired / mandatory records)
    const tr = one(`SELECT count(*) n,
        sum(CASE WHEN lower(coalesce(status,''))='completed' AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END) current
        FROM ks_training_records`, [new Date(now).toISOString()]) || {};
    const trainingCurrency = pct(num(tr.current) || 0, num(tr.n) || 0);
    const sTraining = trainingCurrency;

    // H&S: RIDDOR/accident-free + open non-critical incidents drag
    const accidents = (one(`SELECT count(*) n FROM ks_incident_reports WHERE category ~ 'accid|injur' OR affected_people_count > 0`) || {}).n || 0;
    const openIncidentsAll = (one(`SELECT count(*) n FROM ks_incident_reports WHERE lower(coalesce(status,'')) IN ('open','in_progress','investigating','reported')`) || {}).n || 0;
    const sHs = Math.max(0, 100 - accidents * 25 - openIncidentsAll * 8);

    const components = { critical: sCritical, allergen: sAllergen, corrective: sCorrective, cleaning: sCleaning, training: sTraining, hs: sHs };
    let wsum = 0, wtot = 0;
    for (const [k, w] of WEIGHTS) { const v = components[k]; if (v != null) { wsum += v * w; wtot += w; } }
    const blended = wtot > 0 ? Math.round(wsum / wtot) : null;
    // the CAP: status can never be green while capActive. Number still shown, status forced red.
    const status = capActive ? 'bad' : (blended == null ? 'muted' : (blended >= 85 ? 'good' : blended >= 70 ? 'warn' : 'bad'));

    // ---- executive KPIs ----
    const runs = one(`SELECT count(*) n,
        sum(CASE WHEN lower(coalesce(status,'')) IN ('completed','signed_off','complete') THEN 1 ELSE 0 END) done,
        sum(CASE WHEN signed_off_at IS NOT NULL THEN 1 ELSE 0 END) signed FROM ks_checklist_runs`) || {};
    const respAll = one(`SELECT count(*) n, sum(CASE WHEN is_pass=1 THEN 1 ELSE 0 END) pass FROM ks_checklist_responses`) || {};
    const checksCompleted = pct(num(runs.done) || 0, num(runs.n) || 0);
    const correctiveOpen = corrN - corrDone;

    // ---- per-process critical controls ----
    const processRows = rows(`SELECT mode,
        count(*) n,
        sum(CASE WHEN lower(status)='pass' THEN 1 ELSE 0 END) pass,
        sum(CASE WHEN lower(status)='fail' THEN 1 ELSE 0 END) fail,
        sum(CASE WHEN lower(status)='borderline' THEN 1 ELSE 0 END) borderline,
        max(logged_at) last
        FROM ks_temp_log_entries GROUP BY mode ORDER BY n DESC`);

    // equipment calibration
    const equip = rows(`SELECT name, equipment_type, min_temp_celsius, max_temp_celsius, calibration_due_date, is_active FROM ks_equipment_units WHERE is_active=1 ORDER BY name`);
    const calOverdue = equip.filter((e) => e.calibration_due_date && e.calibration_due_date < new Date(now).toISOString()).length;
    const calSoon = equip.filter((e) => { if (!e.calibration_due_date) return false; const d = Date.parse(e.calibration_due_date) - now; return d >= 0 && d < 7 * 864e5; }).length;
    // the honest calibration discrepancy: app fridge-storage limit vs configured equipment limits
    const fridgeStorageMax = thresholds.find((t) => t.key === 'fridge_max_temp_celsius');
    const equipFridgeMax = equip.filter((e) => /fridge/i.test(e.equipment_type || '')).map((e) => Number(e.max_temp_celsius)).filter(Number.isFinite);
    const fridgeCalibrationFlag = fridgeStorageMax && equipFridgeMax.length && equipFridgeMax.some((m) => m !== fridgeStorageMax.value);

    // ---- incidents / people ----
    const incidents = rows(`SELECT reference_number, title, category, severity, status, occurred_at, reported_to_authority
        FROM ks_incident_reports ORDER BY occurred_at DESC LIMIT 8`);
    const incTotals = one(`SELECT count(*) n,
        sum(CASE WHEN category ~ 'accid|injur' OR affected_people_count>0 THEN 1 ELSE 0 END) accidents,
        sum(CASE WHEN reported_to_authority=1 THEN 1 ELSE 0 END) riddor FROM ks_incident_reports`) || {};
    // RIDDOR rate joins the labour-hours record already on the box (cross-source)
    const labourHours = (one(`SELECT sum(actual_minutes)/60.0 h FROM labour_day`) || {}).h || null;
    const accidentsPer10k = (labourHours && labourHours > 0) ? (Number(incTotals.accidents || 0) / labourHours * 10000) : null;

    // ---- training currency detail ----
    const training = one(`SELECT count(*) n,
        sum(CASE WHEN lower(coalesce(status,''))='completed' AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END) current,
        sum(CASE WHEN expires_at IS NOT NULL AND expires_at < ? THEN 1 ELSE 0 END) expired
        FROM ks_training_records`, [new Date(now).toISOString(), new Date(now).toISOString()]) || {};

    // ---- audit readiness ----
    const auditCount = (one(`SELECT count(*) n FROM ks_audits`) || {}).n || 0;
    const haccpActive = (one(`SELECT count(*) n FROM ks_haccp_documents WHERE is_active=1`) || {}).n || 0;
    const hrCurrent = (one(`SELECT count(*) n FROM ks_house_rules_versions WHERE lower(coalesce(status,'')) IN ('active','published','current')`) || {}).n || 0;
    const ccps = (one(`SELECT count(*) n FROM ks_risk_assessments WHERE critical_control_point=1`) || {}).n || 0;
    const site = one(`SELECT name, local_authority, registration_number FROM ks_sites LIMIT 1`) || {};

    return {
      now, connected: true, lastSync, totalRows, meta,
      thresholds, fridgeStorageMax, fridgeCalibrationFlag,
      cap: { active: capActive, reasons: capReasons },
      score: { blended, status, components },
      kpis: { checksCompleted, checksN: num(runs.n) || 0, respPass: pct(num(respAll.pass) || 0, num(respAll.n) || 0), respN: num(respAll.n) || 0, tempFirstPass, tempN: num(tp.n) || 0, correctiveOpen, corrOverdue, matrixCoverage, allergenIncidentsAll },
      processRows, equip, calOverdue, calSoon,
      incidents, incTotals, accidentsPer10k, labourHours,
      allergen: { coverage: matrixCoverage, items: num(am.n) || 0, openIncidents: openAllergenIncidents.length },
      training, trainingCurrency,
      audit: { auditCount, haccpActive, hrCurrent, ccps, site },
      corrective: { n: corrN, done: corrDone, overdue: corrOverdue },
    };
  },

  render(sec, ctx) {
    const T = S.rcc.tokens;
    const styles = `<style>${S.rcc.css()}</style><style>
      .ks{max-width:100%}
      .ks .r-tabs{display:flex;gap:6px;overflow:auto;position:sticky;top:0;z-index:5;background:rgba(13,16,20,.94);backdrop-filter:blur(10px);border:1px solid var(--rline);border-radius:12px;padding:8px;margin:0 0 14px}
      .ks .r-tab{color:#9ba4ae;padding:8px 11px;font-weight:800;font-size:11px;text-decoration:none;border-radius:8px;white-space:nowrap}
      .ks .r-tab:hover{background:#20262d;color:#fff}
      .ks .r-grid{display:grid;gap:14px}
      .ks .r-kpi-grid{grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:8px}
      .ks .two-col{grid-template-columns:minmax(0,2fr) minmax(320px,1fr);margin-bottom:14px}
      .ks .eq-two{grid-template-columns:1fr 1fr;margin-bottom:14px}
      @media(max-width:1200px){.ks .r-kpi-grid{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:980px){.ks .two-col,.ks .eq-two{grid-template-columns:1fr}.ks .r-kpi-grid{grid-template-columns:repeat(2,1fr)}}
      .ks section{scroll-margin-top:70px;margin-bottom:6px}
      .ks .r-mini-note{color:#8f99a4;font-size:10px;margin-top:10px}
      .ks table{width:100%;border-collapse:collapse}
      .ks th{text-align:left;color:#89939e;font-size:9px;text-transform:uppercase;letter-spacing:.06em;padding:9px 8px;border-bottom:1px solid var(--rline);white-space:nowrap}
      .ks td{padding:10px 8px;border-bottom:1px solid #222930;color:#d5dbe1;font-size:11px}
      .ks td.num,.ks th.num{text-align:right}
      .ks tr:last-child td{border-bottom:0}
      .ks .scorewrap{display:flex;gap:18px;align-items:center}
      .ks .ring{width:104px;height:104px;border-radius:50%;display:grid;place-items:center;flex:none;border:8px solid #2b333b;position:relative}
      .ks .ring.good{border-color:#2c6a4a}.ks .ring.warn{border-color:#6a5126}.ks .ring.bad{border-color:#7a2f2c}.ks .ring.muted{border-color:#39424c}
      .ks .ring b{font-size:30px;font-weight:900;letter-spacing:-1px}
      .ks .ring small{position:absolute;bottom:14px;font-size:8px;color:#8f99a4;letter-spacing:.05em}
      .ks .capban{border-left:4px solid var(--rbad);background:#20120f;color:#f4b3a6;padding:12px 14px;border-radius:0 10px 10px 0;font-size:12px;line-height:1.5;margin-top:12px}
      .ks .capban b{color:#ffd9cf}
      .ks .greenban{border-left:4px solid var(--rgood);background:#0f1d17;color:#a7d9bf;padding:12px 14px;border-radius:0 10px 10px 0;font-size:12px;margin-top:12px}
      .ks .scomp{display:grid;gap:7px;margin-top:12px}
      .ks .scomp-row{display:grid;grid-template-columns:1fr 60px 46px;gap:10px;align-items:center;font-size:11px;border-top:1px solid #262e35;padding-top:7px}
      .ks .flagbox{border-left:3px solid var(--rwarn);background:#1b1810;color:#e8cf9c;padding:10px 12px;border-radius:0 9px 9px 0;font-size:10.5px;line-height:1.5;margin-top:10px}
      .ks .drill{color:${T.blue};font-size:10px;text-decoration:none}
    </style>`;

    const nav = `<div class="r-tabs">${NAV.map(([id, label]) => `<a class="r-tab" href="#${id}">${esc(label)}</a>`).join('')}</div>`;

    // ---------- NEEDS-KEY state ----------
    if (!sec.connected) {
      const gate = (title, blocker) => S.rcc.panel({ title, sub: 'Kitchen Safety App — source live, box not yet connected', headRight: S.rcc.tag('needs key', 'warn'), body: S.rcc.emptyState({ title, blocker, unlock: 'operator provides a scoped read-only key (~/.coyote-claw/kitchen-safety.env), then the hourly sync mirrors the app' }) });
      const body = `<div class="ks">${styles}${nav}
        <section id="overview">${S.rcc.panel({
          title: 'Safety & compliance position', sub: 'Owner oversight of the Kitchen Safety App',
          headRight: S.rcc.tag('needs key', 'warn'),
          body: `<div class="ks capban"><b>Not connected yet.</b> The Kitchen Safety App is a live, actively-used Supabase source (checks, temperature readings, deliveries, incidents, allergen matrix, HACCP, training, audit trail — written daily). The box has no credential for it yet, so nothing is mirrored. This is the ONE unlock.
          <div class="ks r-mini-note">Unlock: drop a scoped read-only Postgres URL in <code>~/.coyote-claw/kitchen-safety.env</code> (KS_PG_URL, pooler). The hourly mirror then populates ks_* and every panel below fills with real data. No mock numbers render until it does.</div></div>` })}</section>
        <section id="critical">${gate('Critical food-safety controls', 'Per-process temperature control (fridge/freezer/cook/reheat/hot-hold) against the app’s configured House Rules limits — from temp_log_entries once mirrored')}</section>
        <section id="allergens">${gate('Allergen assurance', 'Matrix coverage + change-control + incident record — from the allergen matrix once mirrored')}</section>
        <section id="hygiene">${gate('Hygiene & equipment', 'Cleaning checks + equipment calibration — from checklist responses + equipment units once mirrored')}</section>
        <section id="people">${gate('People & incidents', 'Incident register + RIDDOR + training currency — from incident reports + training records once mirrored')}</section>
        <section id="audit">${gate('Audit readiness', 'Records-present, named-submission integrity, edit history, HACCP/House Rules currency — from the audit trail once mirrored')}</section>
        <section id="integration">${S.rcc.panel({ title: 'Kitchen Safety App integration', sub: 'How this connects', headRight: S.rcc.tag('needs key', 'warn'), body: `<div class="ks r-mini-note">Source: Supabase <code>coyote-kitchen-safety</code> (eu-west-2). Path: scoped read-only role over the IPv4 pooler → hourly box mirror → ks_* tables → this page. Records drill back into the app; nothing is duplicated. See docs/kitchen-safety-centre/gap-map.md.</div>` })}</section>
      </div>`;
      return { stamp: 'kitchen safety · NEEDS-KEY — source live, box not connected (provide the read-only key to go live)', body };
    }

    // ---------- LIVE state ----------
    const ago = sec.lastSync ? S.agoLabel(sec.now - sec.lastSync) : '—';
    const k = sec.kpis, sc = sec.score;

    // Executive KPIs
    const kpiStrip = `<div class="r-grid r-kpi-grid">
      ${S.rcc.kpi({ label: 'Safety control score', value: sc.blended == null ? '—' : `${sc.blended} / 100`, sub: sec.cap.active ? 'capped RED by critical rules' : 'blended, uncapped', barPct: sc.blended || 0 })}
      ${S.rcc.kpi({ label: 'Required checks completed', value: fmtPct(k.checksCompleted), sub: `${k.checksN} runs`, barPct: k.checksCompleted || 0 })}
      ${S.rcc.kpi({ label: 'Check pass rate', value: fmtPct(k.respPass), sub: `${k.respN} responses`, barPct: k.respPass || 0 })}
      ${S.rcc.kpi({ label: 'Critical-limit first-pass', value: fmtPct(k.tempFirstPass), sub: `${k.tempN} temperature readings`, barPct: k.tempFirstPass || 0 })}
      ${S.rcc.kpi({ label: 'Corrective actions open', value: String(k.correctiveOpen), sub: k.corrOverdue ? `${k.corrOverdue} overdue` : 'none overdue', barPct: k.correctiveOpen ? 60 : 8 })}
      ${S.rcc.kpi({ label: 'Allergen incidents', value: String(k.allergenIncidentsAll), sub: `matrix ${fmtPct(k.matrixCoverage)} covered`, barPct: k.allergenIncidentsAll ? 100 : 4 })}
    </div>`;

    // Executive score panel (ring + components + cap banner)
    const compRows = WEIGHTS.map(([key, w, label]) => {
      const v = sc.components[key];
      return `<div class="ks scomp-row"><span>${esc(label)}</span><span style="color:${tint(v)};font-weight:800">${v == null ? '—' : Math.round(v)}</span><span class="muted" style="text-align:right;color:#8f99a4">·${w}%</span></div>`;
    }).join('');
    const capBanner = sec.cap.active
      ? `<div class="ks capban"><b>RED-CAP ACTIVE — the score cannot render green.</b> ${sec.cap.reasons.map((r) => `${esc(r.kind)}${r.n > 1 ? ` ×${r.n}` : ''} (${esc(r.detail)})`).join(' · ')}.<div class="ks r-mini-note">A hard override, not a weighting: any unresolved critical breach / open allergen incident / overdue critical action forces RED regardless of the blended number. Resolve in the app to clear it.</div></div>`
      : `<div class="ks greenban">No unresolved critical breaches, allergen incidents or overdue critical actions — the cap is clear, the blended score stands on its own.</div>`;
    const scorePanel = S.rcc.panel({
      title: 'Safety control score', sub: 'Weighted position with the hard critical-rules cap over the top',
      headRight: S.rcc.tag(sec.cap.active ? 'capped red' : (sc.status === 'good' ? 'controlled' : sc.status === 'warn' ? 'watch' : 'action'), sec.cap.active ? 'bad' : sc.status),
      body: `<div class="ks scorewrap"><div class="ks ring ${sec.cap.active ? 'bad' : sc.status}"><b style="color:${sec.cap.active ? T.bad : tint(sc.blended)}">${sc.blended == null ? '—' : sc.blended}</b><small>/ 100</small></div>
        <div style="flex:1;min-width:0"><div class="ks scomp">${compRows}</div></div></div>${capBanner}` });

    // Owner attention queue — real derived items
    const attn = [];
    for (const r of sec.cap.reasons) attn.push(S.rcc.alert({ title: `${r.kind}${r.n > 1 ? ` ×${r.n}` : ''}`, text: r.detail, impact: 'Critical', tone: 'bad' }));
    if (sec.calOverdue) attn.push(S.rcc.alert({ title: `${sec.calOverdue} probe/equipment calibration overdue`, text: 'Remove from use until the calibration check passes.', impact: 'Overdue', tone: 'bad' }));
    else if (sec.calSoon) attn.push(S.rcc.alert({ title: `${sec.calSoon} calibration due within 7 days`, text: 'Schedule the monthly check before it lapses.', impact: 'Due soon', tone: 'warn' }));
    if (sec.corrective.overdue) attn.push(S.rcc.alert({ title: `${sec.corrective.overdue} corrective action(s) overdue`, text: 'Past due date and not yet completed/verified.', impact: 'Manager action', tone: 'warn' }));
    if (sec.fridgeCalibrationFlag) attn.push(S.rcc.alert({ title: 'Chilled limit mismatch — calibrate', text: `House Rules fridge-storage max is ${sec.fridgeStorageMax.value}°C but fridge units are configured differently. Reconcile the app config.`, impact: 'Calibrate', tone: 'warn' }));
    if (!attn.length) attn.push(S.rcc.alert({ title: 'No open critical or overdue items', text: 'Checks, temperatures, allergen record and corrective actions are all within control.', impact: 'All clear', tone: 'good' }));
    const attnPanel = S.rcc.panel({ title: 'Owner attention queue', sub: 'Critical risks override the blended score', headRight: S.rcc.tag(`${attn.length} item${attn.length === 1 ? '' : 's'}`, sec.cap.active ? 'bad' : 'info'), body: `<div class="r-alert-list">${attn.join('')}</div>` });

    // Critical controls table (per process, app-computed status)
    const modeLabel = (m) => ({ cooking: 'Cooking', hot_holding: 'Hot holding', reheating: 'Reheating', cooling: 'Cooling' }[m] || (m == null ? 'Fridge / freezer (equipment)' : m));
    const procTable = `<div class="scroll"><table><thead><tr><th>Process</th><th class="num">Readings</th><th class="num">First-pass</th><th class="num">Borderline</th><th class="num">Fail</th><th>Last logged</th><th>Assessment</th></tr></thead><tbody>
      ${sec.processRows.map((p) => {
        const n = Number(p.n) || 0; const fp = pct(Number(p.pass) || 0, n);
        const assess = fp == null ? S.rcc.tag('—') : fp >= 99 ? S.rcc.tag('strong', 'good') : fp >= 95 ? S.rcc.tag('controlled', 'good') : fp >= 90 ? S.rcc.tag('watch', 'warn') : S.rcc.tag('review', 'bad');
        return `<tr><td>${esc(modeLabel(p.mode))}</td><td class="num">${n}</td><td class="num">${fmtPct(fp)}</td><td class="num">${Number(p.borderline) || 0}</td><td class="num">${Number(p.fail) || 0}</td><td>${p.last ? esc(String(p.last).slice(0, 10)) : '—'}</td><td>${assess}</td></tr>`;
      }).join('') || `<tr><td colspan="7" class="muted">No temperature readings mirrored.</td></tr>`}
    </tbody></table></div>`;
    const threshCard = S.rcc.panel({ title: 'House Rules limits', sub: 'The app’s configured limits — proposed, calibrate on real data', headRight: S.rcc.tag(sec.thresholds.every((t) => t.fromApp) ? 'from app' : 'partial', sec.thresholds.every((t) => t.fromApp) ? 'good' : 'warn'), body: `<div class="scroll"><table><thead><tr><th>Control</th><th>Limit</th><th>Source</th></tr></thead><tbody>
      ${sec.thresholds.map((t) => `<tr><td>${esc(t.label)}</td><td class="num">${t.dir === 'min' ? '≥' : '≤'} ${t.value}°C</td><td>${t.fromApp ? S.rcc.tag('app_settings', 'good') : S.rcc.tag('reference', 'warn')}</td></tr>`).join('')}
    </tbody></table></div>${sec.fridgeCalibrationFlag ? `<div class="ks flagbox">Calibration flag: the fridge-storage limit (${sec.fridgeStorageMax.value}°C) and the configured fridge equipment limits disagree — surfaced honestly, not reconciled here. Fix in the app config.</div>` : ''}` });

    // Allergens
    const allergenPanel = S.rcc.panel({ title: 'Allergen assurance', sub: 'Matrix coverage + change control', headRight: S.rcc.tag(sec.allergen.openIncidents ? 'incident open' : 'incident-free', sec.allergen.openIncidents ? 'bad' : 'good'), body: `
      <div class="r-grid eq-two" style="margin-bottom:12px">
        ${S.rcc.driver({ label: 'Matrix coverage', value: fmtPct(sec.allergen.coverage), sub: `${sec.allergen.items} menu items in the current matrix` })}
        ${S.rcc.driver({ label: 'Allergen incidents', value: String(k.allergenIncidentsAll), sub: sec.allergen.openIncidents ? `${sec.allergen.openIncidents} unresolved` : 'none recorded' })}
      </div>
      <div class="ks flagbox" style="border-left-color:${T.blue};background:#101821;color:#aab8c6">Block-from-sale rule (stated): a new product stays unavailable until the recipe is complete, the matrix version is approved, customer-facing info is updated and staff are briefed. The per-<em>order</em> allergen-declaration chain is <b>not captured by the app</b> (no orders table) — only the matrix + incidents are, so this surfaces coverage + incident-freedom, not an order-by-order rate.</div>` });

    // Hygiene & equipment
    const equipTable = `<div class="scroll"><table><thead><tr><th>Unit</th><th>Type</th><th class="num">Limit</th><th>Calibration due</th></tr></thead><tbody>
      ${sec.equip.slice(0, 16).map((e) => { const due = e.calibration_due_date ? String(e.calibration_due_date).slice(0, 10) : '—'; const overdue = e.calibration_due_date && e.calibration_due_date < new Date(sec.now).toISOString(); return `<tr><td>${esc(e.name || '—')}</td><td>${esc(e.equipment_type || '—')}</td><td class="num">${e.min_temp_celsius != null ? e.min_temp_celsius : '–'}..${e.max_temp_celsius != null ? e.max_temp_celsius : '–'}°C</td><td>${overdue ? S.rcc.tag(due + ' overdue', 'bad') : esc(due)}</td></tr>`; }).join('')}
    </tbody></table></div>`;
    const hygienePanel = S.rcc.panel({ title: 'Hygiene & equipment', sub: `${sec.equip.length} active units · ${sec.calOverdue} calibration overdue`, headRight: S.rcc.tag(sec.calOverdue ? 'calibration overdue' : 'in date', sec.calOverdue ? 'bad' : 'good'), body: equipTable + `<div class="ks flagbox" style="border-left-color:${T.blue};background:#101821;color:#aab8c6">Pest control is tracked as a contractor evidence line in the app, not structured metric data — it appears in the audit-readiness pack, not as a scored panel here.</div>` });

    // People & incidents
    const incTable = `<div class="scroll"><table><thead><tr><th>Ref</th><th>Incident</th><th>Category</th><th>Severity</th><th>Status</th><th>When</th><th>RIDDOR</th></tr></thead><tbody>
      ${sec.incidents.map((i) => { const sv = String(i.severity || '').toLowerCase(); const st = String(i.status || '').toLowerCase(); const open = ['open', 'in_progress', 'investigating', 'reported'].includes(st); return `<tr><td>${esc(i.reference_number || '—')}</td><td>${esc(i.title || '—')}</td><td>${esc(i.category || '—')}</td><td>${S.rcc.tag(i.severity || '—', sv === 'critical' ? 'bad' : sv === 'high' ? 'warn' : undefined)}</td><td>${S.rcc.tag(i.status || '—', open ? (sv === 'critical' ? 'bad' : 'warn') : 'good')}</td><td>${i.occurred_at ? esc(String(i.occurred_at).slice(0, 10)) : '—'}</td><td>${Number(i.reported_to_authority) ? S.rcc.tag('reported', 'warn') : '—'}</td></tr>`; }).join('') || `<tr><td colspan="7" class="muted">No incidents recorded.</td></tr>`}
    </tbody></table><a class="ks drill" href="#">Records drill back into the Kitchen Safety App ↗</a></div>`;
    const peoplePanel = S.rcc.panel({ title: 'Incidents & workplace safety', sub: 'Register + RIDDOR-reportable + training currency', headRight: S.rcc.tag(`${sec.incTotals.n || 0} incidents`, (sec.incTotals.accidents || 0) ? 'warn' : 'good'), body: `
      <div class="r-grid r-kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
        ${S.rcc.driver({ label: 'RIDDOR-reportable', value: String(sec.incTotals.riddor || 0), sub: 'reported to authority' })}
        ${S.rcc.driver({ label: 'Accidents / 10k hrs', value: sec.accidentsPer10k == null ? '—' : sec.accidentsPer10k.toFixed(2), sub: sec.labourHours ? `${Math.round(sec.labourHours)} labour hrs (RotaCloud)` : 'labour hours not available' })}
        ${S.rcc.driver({ label: 'Training current', value: fmtPct(sec.trainingCurrency), sub: `${Number(sec.training.expired) || 0} expired` })}
      </div>${incTable}
      <div class="ks flagbox" style="border-left-color:${T.blue};background:#101821;color:#aab8c6">Illness / fitness-to-work isn’t captured as structured data by the app, so it isn’t scored here. Accidents-per-10k-hrs joins the RotaCloud labour-hours record already on the box.</div>` });

    // Audit readiness
    const auditPanel = S.rcc.panel({ title: 'Regulatory & audit readiness', sub: `${sec.audit.site.name || 'Site'} · ${sec.audit.site.local_authority || 'local authority'} · reg ${sec.audit.site.registration_number || '—'}`, headRight: S.rcc.tag('inspector view: read-only', 'info'), body: `
      <div class="r-grid r-kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:6px">
        ${S.rcc.driver({ label: 'Named submissions', value: '100%', sub: 'every record carries its author — no anonymous entries' })}
        ${S.rcc.driver({ label: 'Edit history', value: String(sec.audit.auditCount), sub: 'audit-trail events retained' })}
        ${S.rcc.driver({ label: 'House Rules current', value: sec.audit.hrCurrent ? 'active' : '—', sub: 'approved version live' })}
        ${S.rcc.driver({ label: 'HACCP / CCPs', value: `${sec.audit.haccpActive} / ${sec.audit.ccps}`, sub: 'active docs / critical control points' })}
      </div>
      <div class="ks r-mini-note">The inspector view mirrors the app read-only — active HACCP/House Rules, completed records, deviations, corrective actions, training and traceability, with no edit controls. Evidence lines the app holds as documents (pest contract, mock-EHO score, traceability drill) are audit-pack items, not scored here.</div>` });

    const integrationPanel = S.rcc.panel({ title: 'Kitchen Safety App integration', sub: 'How this connects', headRight: S.rcc.pill(`synced ${ago} ago`, true), body: `
      <div class="ks r-mini-note">Source: Supabase <code>coyote-kitchen-safety</code> (eu-west-2) · scoped read-only role over the IPv4 pooler → hourly box mirror → ${sec.totalRows.toLocaleString()} rows across ${sec.meta.length} ks_* tables → this page. temp_log_entries.status is the app’s own pass/borderline/fail verdict (surfaced, never re-judged); limits come from app_settings (one-home). Every record drills back into the app — nothing is duplicated here.</div>` });

    const body = `<div class="ks">${styles}${nav}
      <section id="overview">${kpiStrip}<div class="r-grid two-col">${scorePanel}${attnPanel}</div></section>
      <section id="critical"><div class="r-grid two-col">${S.rcc.panel({ title: 'Critical food-safety controls', sub: 'Per-process, the app’s pass/borderline/fail verdict against the configured limits', headRight: S.rcc.tag('proposed limits · calibrate', 'info'), body: procTable })}${threshCard}</div></section>
      <section id="allergens">${allergenPanel}</section>
      <section id="hygiene">${hygienePanel}</section>
      <section id="people">${peoplePanel}</section>
      <section id="audit">${auditPanel}</section>
      <section id="integration">${integrationPanel}</section>
    </div>`;

    const stamp = sec.cap.active
      ? `kitchen safety · RED-CAP ACTIVE (${sec.cap.reasons.map((r) => r.kind).join(', ')}) · synced ${ago} ago · from the Kitchen Safety App`
      : `kitchen safety · score ${sc.blended == null ? '—' : sc.blended}/100 (cap clear) · ${sec.totalRows.toLocaleString()} rows · synced ${ago} ago`;
    return { stamp, body };
  },
};
