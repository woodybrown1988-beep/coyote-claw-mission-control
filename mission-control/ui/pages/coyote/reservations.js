'use strict';
// Reservations — the RESERVATIONS & GUEST COMMAND CENTRE (R1, built from the Stage-1 gap map
// docs/reservations-centre/gap-map.md + the operator mock reference/mock-*.png). ONE route
// (/coyote/reservations), six subtabs per the mock:
//   executive (default) · demand · behaviour · capacity · customers · reviews
// R1 SCOPE: the shell + the REVIEWS & RECOVERY tab fully built (mostly REAL — the wired reviews
// dept: review_snapshot / review_corpus / review_issues / review_actions).
// R2 SCOPE (this build): the five OpenTable-gated tabs render as DESIGNED GATE-STATES per their
// mocks — the mock's own layout grammar (headers, axes, quadrant frames, table columns, heat
// grids) rendered REAL, but ZERO data rows, ZERO data digits, and ONE blocker line per gated
// panel (verbatim, below). The Executive tab additionally carries the TWO HONEST POS VARIANTS
// from the gap map (dine-in net · 28d + spend/transaction — per-receipt EAT IN truth, labelled
// transactions-basis) and the Data-readiness panel MOVED here from the reviews tab (its mock
// home is Executive — one home per fact). Customer-Intelligence panels are identity-gated and
// name the identity blocker instead. Time labels use the ruled daypart cuts (PREP/LUNCH/TROUGH/
// DINNER/LATE — the reports canon) so gate frames stay digit-free; calendar-week labels render
// ONLY on Executive beside the two real variants.
// THE HONESTY CONSTRAINT (gap map, verified 2026-07-21): the OpenTable weekly-export inbox has
// received ZERO files — every booking/cover/occupancy/identity fact is OpenTable-gated. Canon:
// POS guest-count is NEVER covers, and the per-receipt record carries NO reservation flag and
// NO guest identity — walk-in vs booked cannot be inferred from POS data.
// NO-FABRICATION rules baked in:
//   • Response rate = Google replied ÷ Google total ONLY (has_reply is not tracked for TA/OT —
//     a blended rate would be fake); the tile says so.
//   • Monthly rating trend: a month without a rated review is a GAP — the line breaks, never
//     interpolates.
//   • Service recovery + review-to-return are IDENTITY-GATED designed empty-states carrying
//     zero digits (per-guest facts need review↔guest identity linking, which needs OpenTable).
//   • Data readiness renders REAL DB statuses; the export inbox is a box path the board cannot
//     see, and the caption says so.
// Contract: { key, route, workspace, title, sub, getSection, render }. SELECT-only via ctx.q.
const S = require('../../shared.js');
const REP = require('../../reporting.js');
const K = require('../../kpi.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
const MONTHS_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(ym) { const m = String(ym || '').match(/^(\d{4})-(\d{2})$/); return m ? `${MONTHS_ABBR[Number(m[2])] || m[2]} ${m[1]}` : String(ym || ''); }

const TABS = [
  { key: 'executive', label: 'Executive' },
  { key: 'demand', label: 'Demand & Forecast' },
  { key: 'behaviour', label: 'Booking Behaviour' },
  { key: 'capacity', label: 'Capacity & Flow' },
  { key: 'customers', label: 'Customer Intelligence' },
  { key: 'reviews', label: 'Reviews & Recovery' },
];
const TAB_KEYS = TABS.map((t) => t.key);

// The R1 reviews-tab OpenTable blocker (the gap-map wording; pinned by the R1 tests — the two
// identity-gated reviews panels keep it verbatim).
const OT_BLOCKER = 'OpenTable weekly export — no files received yet; unlock = start the emailed export to the inbox';
// The identity blocker for the two per-guest panels on the reviews tab.
const IDENTITY_BLOCKER = 'per-guest recovery needs review↔guest identity linking (OpenTable + the identity-map decision)';
// R2: the ONE blocker line, VERBATIM — every OpenTable-gated panel names it EXACTLY ONCE.
const GATE_BLOCKER = 'OpenTable weekly export — no files received yet; unlock = start the emailed export to ~/coyote-claw/data/opentable-inbox/';
// R2: the identity blocker — Customer-Intelligence panels name THIS instead (guest identity is
// the deeper gate: it needs OpenTable AND the operator identity-map ruling).
const IDENTITY_GATE_BLOCKER = 'guest identity map — not started; needs OpenTable + the identity-map decision';

// The ruled daypart cuts (the reports canon — local hour <12 PREP · 12–16 LUNCH · 16–17 TROUGH ·
// 17–21 DINNER · 21+ LATE). Gate frames label time axes with THESE (digit-free), never with
// mock hour columns.
const DAYPARTS = ['PREP', 'LUNCH', 'TROUGH', 'DINNER', 'LATE'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// The per-receipt SALE filter — the reports.js canon, verbatim (cancelled and void/cancel/recall
// receipts are never sales).
const SALE_WHERE = `r.cancelled = 0 AND (r.type IS NULL OR r.type NOT IN ('VOID','CANCEL','RECALL'))`;

// review_actions status → chip tone (the ruled classes; an unknown status renders neutral).
const STATUS_TONE = { open: 'warn', actioned: 'info', escalated: 'bad', resolved: 'good' };

// ---------------------------------------------------------------------------------------------
// getSection — SELECT-only; every read degrades to an honest null on a missing table.
// ---------------------------------------------------------------------------------------------
function buildReviews(q, now) {
  const r = { snap: null, resp: null, last90: null, trend: null, themes: null, backlog: null, actions: [] };
  const from90 = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
  r.from90 = from90;

  // ---- newest snapshot = the platform ratings (point-in-time, window stated) ----
  const sr = rowsOf(q(
    `SELECT overall_rating, google_rating, tripadvisor_rating, opentable_rating, ratings_window, fetched_at
       FROM review_snapshot ORDER BY fetched_at DESC LIMIT 1`))[0];
  if (sr) {
    r.snap = {
      overall: num(sr.overall_rating), google: num(sr.google_rating),
      tripadvisor: num(sr.tripadvisor_rating), opentable: num(sr.opentable_rating),
      window: sr.ratings_window == null ? '' : String(sr.ratings_window),
      fetchedAt: num(sr.fetched_at) || 0,
    };
  }

  // ---- response rate: GOOGLE ONLY — has_reply is not tracked for TA/OT (NULL); blending
  // platforms whose reply state is unknown would fabricate a rate. SUM skips NULLs. ----
  const g = rowsOf(q(`SELECT COUNT(*) total, SUM(has_reply = 1) replied FROM review_corpus WHERE platform = 'google'`))[0];
  if (g && num(g.total) > 0) r.resp = { total: num(g.total), replied: num(g.replied) || 0 };

  // ---- reviews last 90d (corpus, by reviewed_date; substr handles date-or-datetime strings) ----
  const c90 = rowsOf(q(
    `SELECT COUNT(*) n FROM review_corpus WHERE reviewed_date IS NOT NULL AND substr(reviewed_date, 1, 10) >= ?`, [from90]))[0];
  if (c90) r.last90 = num(c90.n) || 0;

  // ---- monthly rating trend: trailing 12 months; a month with no rated review = an honest
  // GAP (no row → null avg → the line breaks, never interpolates) ----
  const d0 = new Date(now);
  const yms = [];
  for (let i = 11; i >= 0; i--) yms.push(new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const byYm = new Map();
  for (const row of rowsOf(q(
    `SELECT substr(reviewed_date, 1, 7) ym, AVG(overall) a, COUNT(*) n
       FROM review_corpus WHERE overall IS NOT NULL AND reviewed_date IS NOT NULL GROUP BY ym`)))
    byYm.set(String(row.ym), { avg: num(row.a), n: num(row.n) || 0 });
  r.trend = yms.map((ym) => { const e = byYm.get(ym); return { ym, avg: e ? e.avg : null, n: e ? e.n : 0 }; });

  // ---- sentiment themes = the extraction taxonomy (review_issues): all-time + last-90d ----
  const all = rowsOf(q(`SELECT issue_code, COUNT(*) n FROM review_issues GROUP BY issue_code ORDER BY n DESC, issue_code ASC`));
  if (all.length) {
    const m90 = new Map();
    for (const row of rowsOf(q(
      `SELECT i.issue_code code, COUNT(*) n FROM review_issues i JOIN review_corpus c ON c.review_id = i.review_id
        WHERE c.reviewed_date IS NOT NULL AND substr(c.reviewed_date, 1, 10) >= ? GROUP BY i.issue_code`, [from90])))
      m90.set(String(row.code), num(row.n) || 0);
    r.themes = all.map((row) => ({ code: String(row.issue_code), n: num(row.n) || 0, n90: m90.get(String(row.issue_code)) || 0 }));
  }
  // extraction backlog — the SAME has-text filter as the extractor's own claim query
  // (src/reviews/issues/extract.ts), so the two can never disagree about "awaiting classification".
  const bl = q(`SELECT COUNT(*) n FROM review_corpus
                 WHERE text IS NOT NULL AND TRIM(text) != ''
                   AND review_id NOT IN (SELECT review_id FROM issue_extractions)`);
  r.backlog = bl && bl.ok && bl.rows[0] ? (num(bl.rows[0].n) || 0) : null;

  // ---- reputation management actions: the action log, newest 8 ----
  r.actions = rowsOf(q(
    `SELECT issue_code, identified_at, action_taken, action_date, status, issue_rate_before, issue_rate_after, escalate, auto
       FROM review_actions ORDER BY identified_at DESC LIMIT 8`))
    .map((row) => ({
      code: String(row.issue_code || ''),
      identifiedAt: num(row.identified_at) || 0,
      action: row.action_taken == null ? '' : String(row.action_taken),
      actionDate: num(row.action_date) || 0,
      status: String(row.status || ''),
      before: num(row.issue_rate_before), after: num(row.issue_rate_after),
      escalate: Number(row.escalate) === 1, auto: Number(row.auto) === 1,
    }));

  return r;
}

// R2: the Executive tab's REAL facts — the data-readiness probes (moved here from the reviews
// tab: the mock's readiness home is Executive — one home per fact) + the two honest POS variants
// from the gap map. Everything else on the tab is a designed gate-state.
function buildExecutive(q) {
  const e = { pos: null, ready: null };

  // ---- data readiness: REAL DB probes — a failed SELECT (missing table) = null, an honest
  // distinct state from a present-but-empty store ----
  const probe = (table) => { const res = q(`SELECT COUNT(*) n FROM ${table}`); return res && res.ok && res.rows[0] ? (num(res.rows[0].n) || 0) : null; };
  e.ready = {
    receipts: probe('sales_receipts_api'),
    corpus: probe('review_corpus'),
    otRes: probe('opentable_reservations'),
    otCovers: probe('covers_day'),
  };

  // ---- the two honest POS variants (gap map): per-receipt EAT IN channel, trailing 28d to the
  // record's own max day, SALE receipts only, net ex-VAT. TRANSACTIONS basis — POS guest-count is
  // NEVER covers, so nothing here claims to be a cover fact. ----
  const mx = rowsOf(q(`SELECT MAX(business_date) d FROM sales_receipts_api`))[0];
  const apiMax = mx && mx.d ? String(mx.d) : null;
  if (apiMax) {
    const from28 = K.shiftDays(apiMax, -27);
    const row = rowsOf(q(
      `SELECT SUM(r.net_without_tax_pence) net, COUNT(*) txn
         FROM sales_receipts_api r JOIN sales_channel_map_api m ON m.account_profile_code = COALESCE(r.account_profile_code,'')
        WHERE r.business_date BETWEEN ? AND ? AND m.channel_label = 'EAT IN' AND ${SALE_WHERE}`, [from28, apiMax]))[0];
    if (row && num(row.txn) > 0) e.pos = { from: from28, to: apiMax, net: num(row.net) || 0, txn: num(row.txn) || 0 };
  }
  return e;
}

module.exports = {
  key: 'reservations', route: '/coyote/reservations', workspace: 'coyote', title: 'Reservations',
  sub: 'Guest & reservations command centre · OpenTable feed pending',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    const query = (ctx && ctx.query) || {};
    const tab = TAB_KEYS.includes(String(query.tab || '')) ? String(query.tab) : 'executive';
    const m = { now, tab, rev: null, exec: null };
    if (typeof q !== 'function') return m;
    if (tab === 'reviews') m.rev = buildReviews(q, now);
    if (tab === 'executive') m.exec = buildExecutive(q);
    return m;
  },

  render(section, ctx) {
    const m = section || {};
    const tab = TAB_KEYS.includes(String(m.tab || '')) ? String(m.tab) : 'executive';
    const now = m.now || (ctx && ctx.now) || Date.now();
    const esc = S.escapeHtml;
    const int = S.fmtInt;

    // Page styles: the RCC canon (S.rcc.css — incl. the Reservations cyan token + stackCol/
    // meterRow/stars extensions) + the reports shell grammar ported VERBATIM (.r-tabs nav,
    // grids, trend-SVG classes, captions) + the two page-local grammars this tab needs.
    const styles = `<style>${S.rcc.css()}</style><style>
      .rcc .r-tabs{display:flex;gap:4px;border-bottom:1px solid var(--rline);margin:0 0 14px;overflow:auto}
      .rcc .r-tab{color:#9ba4ae;padding:11px 14px;font-weight:700;border-bottom:2px solid transparent;white-space:nowrap;text-decoration:none;font-size:13px}
      .rcc .r-tab.active{color:#fff;border-bottom-color:var(--raccent)}
      .rcc .r-grid{display:grid;gap:14px}
      .rcc .r-kpi-grid{grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:8px}
      .rcc .r-two-col{grid-template-columns:minmax(0,2fr) minmax(330px,1fr);margin-bottom:14px}
      @media(max-width:1200px){.rcc .r-kpi-grid{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:820px){.rcc .r-two-col{grid-template-columns:1fr}.rcc .r-kpi-grid{grid-template-columns:repeat(2,1fr)}}
      .rcc .r-legend{display:flex;gap:12px;flex-wrap:wrap;color:#aeb6bf;font-size:11px}
      .rcc .r-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
      .rcc .r-legend i.sq{border-radius:2px}
      .rcc .r-mini-note{color:#8f99a4;font-size:10px;margin-top:10px}
      .rcc .chart-wrap{height:250px;position:relative}
      .rcc .chart-wrap svg{width:100%;height:100%;display:block;overflow:visible}
      .rcc .gridline{stroke:#2a3138;stroke-width:1}
      .rcc .axistext{fill:#7f8994;font-size:11px}
      .rcc .line-current{fill:none;stroke:#ef6a50;stroke-width:3}
      .rcc .point{fill:#ef6a50;stroke:#171b20;stroke-width:3}
      .rcc .r-meters{display:grid;gap:10px}
      .rcc .r-driver-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
      .rcc .r-driver-grid.g2{grid-template-columns:repeat(2,1fr)}
      @media(max-width:820px){.rcc .r-driver-grid{grid-template-columns:repeat(2,1fr)}}
      .rcc .rsv-qrow{display:grid;grid-template-columns:1.2fr 1fr 1fr .9fr .9fr;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid #252d34;font-size:11px}
      .rcc .rsv-qrow.head{color:#808a94;font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-weight:800}
      .rcc .rsv-gate{margin-top:12px}
      .rcc .rv2-caption{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--muted,#7a8);margin:8px 2px 2px;line-height:1.55}
      /* R2 gate-state grammar — FRAME-ONLY css ported from the mock (week-bars, funnel rows,
         quad matrix, heat grid, leak rows, donut ring). NO data classes: no level ramps, no
         width/height data styles — a frame class can never carry a value. */
      .rcc .r-three-col{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px}
      @media(max-width:1100px){.rcc .r-three-col{grid-template-columns:1fr}}
      .rcc .rsv-weekbars{display:flex;gap:10px;align-items:stretch;height:150px;padding:4px 2px 0}
      .rcc .rsv-week-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;border-bottom:1px solid #2a3138}
      .rcc .rsv-week-label{color:#7f8994;font-size:10px;margin:6px 0 4px;white-space:nowrap}
      .rcc .rsv-funnel{display:grid;gap:6px}
      .rcc .rsv-funnel-row{display:flex;justify-content:space-between;gap:10px;background:#1a2129;border:1px solid #273039;border-radius:8px;padding:9px 11px;font-size:11px;color:#c9d0d6}
      .rcc .rsv-funnel-row b{color:#8f99a4;font-weight:700}
      .rcc .rsv-quad{position:relative;height:230px;border:1px solid #2a3139;border-radius:12px;background:linear-gradient(#2a3138,#2a3138) 50% 0/1px 100% no-repeat,linear-gradient(#2a3138,#2a3138) 0 50%/100% 1px no-repeat,#101419}
      .rcc .rsv-quad .rsv-q-label{position:absolute;font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:#8d97a2;font-weight:800;max-width:46%}
      .rcc .rsv-q-tl{top:10px;left:12px}.rcc .rsv-q-tr{top:10px;right:12px;text-align:right}
      .rcc .rsv-q-bl{bottom:10px;left:12px}.rcc .rsv-q-br{bottom:10px;right:12px;text-align:right}
      .rcc .rsv-heatgrid{display:grid;grid-template-columns:52px repeat(5,1fr);gap:5px;align-items:center}
      .rcc .rsv-hlabel{color:#7f8994;font-size:9px;text-transform:uppercase;letter-spacing:.06em;text-align:center;font-weight:800}
      .rcc .rsv-hday{color:#9aa4ae;font-size:11px}
      .rcc .rsv-leak-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #252d34}
      .rcc .rsv-leak-row:last-child{border-bottom:0}
      .rcc .rsv-leak-row h4{margin:0 0 3px;font-size:12px}
      .rcc .rsv-leak-row p{margin:0;color:#8f99a4;font-size:10.5px;line-height:1.45}
      .rcc .rsv-leak-row strong{font-size:16px;color:#9aa4ae}
      .rcc .rsv-donut-frame{width:130px;height:130px;border-radius:50%;border:14px solid #252c33;margin:8px auto}
    </style>`;

    // ---- subtab nav: 6 links, the reports .r-tabs grammar; ?tab only ----
    const tabsNav = `<div class="r-tabs">${TABS.map((t) =>
      `<a class="r-tab${t.key === tab ? ' active' : ''}" href="/coyote/reservations?tab=${t.key}">${esc(t.label)}</a>`).join('')}</div>`;

    // ============================ R2 GATE-STATE HELPERS ============================
    // THE RULE for every gate-state panel: the mock's own layout grammar rendered REAL — but
    // zero data rows, zero data digits, and the ONE blocker line exactly once per panel.
    const gate = (title) => `<div class="rsv-gate">${S.rcc.emptyState({ title, blocker: GATE_BLOCKER })}</div>`;
    const identityGate = (title) => `<div class="rsv-gate">${S.rcc.emptyState({ title, blocker: IDENTITY_GATE_BLOCKER })}</div>`;
    const noFeedKpi = (label) => S.rcc.kpi({ label, value: '—', sub: 'no feed — OpenTable weekly export' });
    const legend = (items) => `<div class="r-legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('')}</div>`;
    // Empty-table frame: the mock's column headers, NO rows — a header is grammar, a row would
    // be a claim.
    const emptyTable = (cols) => `<div style="overflow:auto"><table><thead><tr>${cols.map(([h, n]) =>
      `<th${n ? ' class="r-num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
    // Axis-only chart frame: gridlines + baseline, NO scale labels (a y-scale with no data would
    // be a fabricated claim), optional REAL x labels supplied by the caller.
    const chartFrame = (w, h, ys, aria, xLabels) => `<div class="chart-wrap"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">${ys
      .map((y) => `<line x1="55" y1="${y}" x2="${w - 20}" y2="${y}" class="gridline"/>`).join('')}${xLabels || ''}</svg></div>`;
    // Real calendar weeks (the ONLY digits a gate frame may carry, Executive only): Mondays
    // labelled like the mock's week axis ('20 Jul').
    const monday0 = K.weekMonday(new Date(now).toISOString().slice(0, 10));
    const weekLabel = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS_ABBR[Number(iso.slice(5, 7))] || ''}`;

    // ============================ EXECUTIVE (R2 gate-states + the two POS variants) ============================
    const renderExecutiveTab = () => {
      const ex = m.exec || { pos: null, ready: null };
      const pos = ex.pos;

      // ---- (1) KPI strip: the mock's 6 tiles = 4 OpenTable-gated zero-digit 'no feed' tiles +
      // the TWO HONEST POS VARIANTS from the gap map (per-receipt EAT IN truth) ----
      const kpis = [
        noFeedKpi('Seated dine-in covers'),
        noFeedKpi('Reserved cover share'),
        noFeedKpi('Booking → seated'),
        noFeedKpi('No-show cover rate'),
        S.rcc.kpi({ label: 'Dine-in net · 28d', value: pos ? S.fmtGbpPence(pos.net) : '—', sub: 'transactions basis, not covers' }),
        S.rcc.kpi({ label: 'Spend / transaction', value: pos ? S.fmtGbpPence(pos.net / pos.txn) : '—', sub: 'per TRANSACTION — per-cover unlocks with OpenTable' }),
      ].join('');
      const kpiCaption = pos
        ? `<div class="rv2-caption">the two POS variants = the per-receipt record (sales_receipts_api, EAT IN channel label, SALE receipts only), trailing 28d ${esc(pos.from)} → ${esc(pos.to)}, net ex-VAT · TRANSACTIONS basis — POS guest-count is never covers · spend/transaction = net ÷ ${int(pos.txn)} transactions; per-cover unlocks with OpenTable · the four gated tiles carry no number until the reservation feed lands.</div>`
        : `<div class="rv2-caption">the two POS variants (dine-in net · spend/transaction) light up from the per-receipt record (sales_receipts_api + the channel map, EAT IN label) — no window computable yet · the four gated tiles carry no number until the reservation feed lands.</div>`;

      // ---- (2) 13-week cover performance: the stacked-column FRAME — axis + REAL calendar-week
      // labels (the 13 Mondays ending this week), NO columns ----
      const wk13 = [];
      for (let i = 12; i >= 0; i--) wk13.push(K.shiftDays(monday0, -7 * i));
      const X13 = (i) => Math.round((62 + (i * (846 - 62)) / 12) * 10) / 10;
      const stackPanel = S.rcc.panel({
        title: '13-week dine-in cover performance',
        sub: 'reserved seated covers + walk-in covers vs total dine-in covers last year · real calendar weeks, no columns until the feed',
        headRight: legend([[S.rcc.tokens.accent, 'Reserved'], [S.rcc.tokens.cyan, 'Walk-in'], ['#7a8490', 'LY total']]),
        body: chartFrame(900, 260, [30, 88, 146, 204], 'Thirteen-week dine-in cover frame — no data yet',
          wk13.map((iso, i) => `<text x="${X13(i) - 14}" y="250" class="axistext">${esc(weekLabel(iso))}</text>`).join(''))
          + gate('13-week dine-in cover performance'),
      });

      // ---- (3) owner attention queue: the alert-card frame, zero cards ----
      const queuePanel = S.rcc.panel({
        title: 'Owner attention queue', sub: 'ranked by estimated revenue or loyalty impact',
        headRight: S.rcc.tag('no feed', 'warn'),
        body: `<div class="r-alert"><div class="r-bar"></div><div>${S.rcc.emptyState({ title: 'Owner attention queue', blocker: GATE_BLOCKER })}</div><div class="r-impact"></div></div>`,
      });

      // ---- (4) next 6 weeks on-books: the week-bars frame — REAL upcoming Mondays, no bars ----
      const wk6 = [];
      for (let i = 0; i < 6; i++) wk6.push(K.shiftDays(monday0, 7 * i));
      const pickupPanel = S.rcc.panel({
        title: 'Next 6 weeks: on-books and expected pickup',
        sub: 'forecast separates what is already booked from what normally arrives later',
        body: `<div class="rsv-weekbars">${wk6.map((iso) => `<div class="rsv-week-col"><span class="rsv-week-label">${esc(weekLabel(iso))}</span></div>`).join('')}</div>
          <div style="margin-top:12px">${legend([[S.rcc.tokens.blue, 'Already booked'], [S.rcc.tokens.accent, 'Expected pickup']])}</div>`
          + gate('Next 6 weeks: on-books and expected pickup'),
      });

      // ---- (5) dine-in demand mix: the mock's mix is COVERS-based → gate-state + the one-line
      // pointer (one home per fact — the transaction-basis donut is NOT duplicated here) ----
      const mixPanel = S.rcc.panel({
        title: 'Dine-in demand mix', sub: 'how guests entered the restaurant · covers-based, OpenTable-gated',
        body: gate('Dine-in demand mix')
          + `<div class="rv2-caption">transaction-basis channel mix lives on Revenue → Executive</div>`,
      });

      // ---- (6) data readiness: REAL DB statuses (moved from the reviews tab — the mock's
      // readiness home is Executive; one home per fact) ----
      const ready = ex.ready || { receipts: null, corpus: null, otRes: null, otCovers: null };
      const readyRow = (name, tagHtml, detail) => `<tr><td>${esc(name)}</td><td>${tagHtml}</td><td>${esc(detail)}</td></tr>`;
      const storeState = (n, readyDetail, emptyDetail, missingDetail) => (n == null
        ? { tag: S.rcc.tag('missing', 'bad'), detail: missingDetail }
        : n > 0
          ? { tag: S.rcc.tag('Ready', 'good'), detail: readyDetail }
          : { tag: S.rcc.tag('no rows', 'bad'), detail: emptyDetail });
      const rec = storeState(ready.receipts,
        'sales_receipts_api — per-receipt truth flowing (Lightspeed K-Series API)',
        'sales_receipts_api exists but is empty — the daily API ingest fills it',
        'no per-receipt store in the DB');
      const cor = storeState(ready.corpus,
        'review_corpus + review_snapshot — the wired reviews dept feeds the reviews tab',
        'review_corpus exists but is empty — the daily reviews ingest fills it',
        'no reviews store in the DB');
      let ot;
      if (ready.otRes == null && ready.otCovers == null) {
        ot = { tag: S.rcc.tag('no feed — 0 files received', 'bad'), detail: 'no reservation store in the DB — the weekly export has never landed' };
      } else if ((ready.otRes || 0) + (ready.otCovers || 0) === 0) {
        ot = { tag: S.rcc.tag('no feed — 0 files received', 'bad'), detail: 'reservation store present but empty — no export ingested yet' };
      } else {
        ot = { tag: S.rcc.tag('Ready', 'good'), detail: 'reservation rows present' };
      }
      const readinessPanel = S.rcc.panel({
        title: 'Data readiness', sub: 'what the centre can already stand on · real statuses',
        body: `<table><thead><tr><th>Source</th><th>Status</th><th>Detail</th></tr></thead><tbody>
          ${readyRow('Per-receipt sales record', rec.tag, rec.detail)}
          ${readyRow('Reviews dept', cor.tag, cor.detail)}
          ${readyRow('OpenTable reservations', ot.tag, ot.detail)}
          ${readyRow('Guest identity map', S.rcc.tag('not started'), 'review↔guest identity linking — needs OpenTable + the identity-map decision')}
        </tbody></table>
        <div class="r-mini-note">readiness read from the DB; the export inbox is a box path the board cannot see.</div>`,
      });

      return `<div class="r-grid r-kpi-grid">${kpis}</div>${kpiCaption}
        <div class="r-grid r-two-col">${stackPanel}${queuePanel}</div>
        <div class="r-grid r-three-col">${pickupPanel}${mixPanel}${readinessPanel}</div>`;
    };

    // ============================ DEMAND & FORECAST (all gated) ============================
    const renderDemandTab = () => {
      const forecastPanel = S.rcc.panel({
        title: 'Eight-week demand forecast', sub: 'actual history, forecast covers and last-year baseline',
        headRight: legend([[S.rcc.tokens.accent, 'Actual/forecast'], ['#758190', 'Last year']]),
        body: chartFrame(900, 260, [34, 92, 150, 208, 235], 'Eight-week demand forecast frame — no data yet')
          + gate('Eight-week demand forecast'),
      });
      const assumptionsPanel = S.rcc.panel({
        title: 'Forecast assumptions', sub: 'management overrides the statistical baseline · definitional until the feed lands',
        body: S.rcc.formula([
          'Forecast covers =',
          'on-books',
          '+ expected booking pickup',
          '+ expected walk-ins',
          '− expected cancellations',
          '− expected no-shows',
        ])
          + `<div class="r-mini-note">booking-pickup multiplier: raise only on evidence — stronger pace, events, campaigns or added availability · no-show assumption: service-specific — Saturday-evening risk never applies to Tuesday lunch · the correct feed for later labour budgeting: labour follows forecast covers by daypart, not monthly revenue alone.</div>`
          + gate('Forecast assumptions'),
      });
      const pickupCurvePanel = S.rcc.panel({
        title: 'Booking pickup curve', sub: 'share of final reserved covers already booked by days before service',
        body: chartFrame(700, 250, [40, 105, 170, 228], 'Booking pickup curve frame — no data yet')
          + gate('Booking pickup curve'),
      });
      const occupancyPanel = S.rcc.panel({
        title: 'Forward occupancy by daypart', sub: 'expected seated covers as a share of practical capacity · the ruled daypart cuts',
        body: `<div class="r-meters">${DAYPARTS.map((d) =>
          `<div class="r-meter-row"><div class="r-label">${esc(d)}</div><div class="r-track"></div><div class="r-value">—</div></div>`).join('')}</div>`
          + gate('Forward occupancy by daypart'),
      });
      const bookingViewPanel = S.rcc.panel({
        title: 'Next fourteen days — management booking view',
        sub: 'reservations report enriched with history, spend, tags and forecasted walk-ins',
        headRight: S.rcc.tag('operational drill-down', 'info'),
        body: emptyTable([['Date'], ['Service'], ['On books', 1], ['Forecast covers', 1], ['Forecast occupancy', 1], ['Large parties', 1], ['VIP / high spender', 1], ['Risk / action']])
          + gate('Next fourteen days — management booking view'),
      });
      return `<div class="r-grid r-two-col">${forecastPanel}${assumptionsPanel}</div>
        <div class="r-grid r-two-col">${pickupCurvePanel}${occupancyPanel}</div>
        ${bookingViewPanel}`;
    };

    // ============================ BOOKING BEHAVIOUR (all gated) ============================
    const renderBehaviourTab = () => {
      const sourcePanel = S.rcc.panel({
        title: 'Reservation source performance', sub: 'seated covers, conversion, no-shows, lead time and matched spend',
        body: emptyTable([['Source'], ['Seated covers', 1], ['Booking → seated', 1], ['No-show', 1], ['Lead time', 1], ['Spend / cover', 1], ['Decision']])
          + gate('Reservation source performance'),
      });
      const funnelPanel = S.rcc.panel({
        title: 'Booking funnel', sub: 'cover outcomes for the period',
        body: `<div class="rsv-funnel">${['Reserved covers created', 'Still expected after cancellation', 'Arrived / seated', 'POS check matched', 'Guest identity reusable']
          .map((stage) => `<div class="rsv-funnel-row"><span>${esc(stage)}</span><b>—</b></div>`).join('')}</div>
          <div class="r-mini-note">the last stage matters — a booking without a durable, consented customer identity is operational data but weak CRM data.</div>`
          + gate('Booking funnel'),
      });
      const leadPanel = S.rcc.panel({
        title: 'Lead-time distribution', sub: 'when guests book relative to arrival',
        body: chartFrame(700, 230, [40, 100, 160, 208], 'Lead-time distribution frame — no data yet')
          + gate('Lead-time distribution'),
      });
      const partyPanel = S.rcc.panel({
        title: 'Party-size mix', sub: 'reserved parties only',
        body: `<div class="rsv-donut-frame"></div>` + gate('Party-size mix'),
      });
      const nvrPanel = S.rcc.panel({
        title: 'New versus returning', sub: 'guest profile history',
        body: `<div class="r-driver-grid g2">${[
          ['First visit', 'acquisition pipeline'],
          ['Returning', 'known profiles'],
          ['Regular base', 'frequent-visit tier'],
          ['VIP candidates', 'top visit tier'],
        ].map(([lab, tier]) => S.rcc.driver({ label: lab, value: '—', sub: tier })).join('')}</div>`
          + gate('New versus returning'),
      });
      const diagPanel = S.rcc.panel({
        title: 'No-show and cancellation diagnosis', sub: 'do not treat all reservations as equal risk',
        body: emptyTable([['Segment'], ['Reservations', 1], ['Cancellation', 1], ['No-show', 1], ['Estimated lost covers', 1], ['Estimated revenue risk', 1], ['Recommended control']])
          + gate('No-show and cancellation diagnosis'),
      });
      return `<div class="r-grid r-two-col">${sourcePanel}${funnelPanel}</div>
        <div class="r-grid r-three-col">${leadPanel}${partyPanel}${nvrPanel}</div>
        ${diagPanel}`;
    };

    // ============================ CAPACITY & FLOW (all gated) ============================
    const renderCapacityTab = () => {
      // The heatCell GRID with EVERY cell no-data-unclassed — the frame IS the honest state.
      // Columns = the ruled daypart cuts (digit-free), rows = the seven weekdays.
      const heatPanel = S.rcc.panel({
        title: 'Actual occupancy heatmap', sub: 'seated covers versus practical seat capacity · the ruled daypart cuts',
        body: `<div class="rsv-heatgrid"><div></div>${DAYPARTS.map((d) => `<div class="rsv-hlabel">${esc(d)}</div>`).join('')}${WEEKDAYS.map((d) =>
          `<div class="rsv-hday">${esc(d)}</div>${DAYPARTS.map(() => S.rcc.heatCell(null)).join('')}`).join('')}</div>`
          + gate('Actual occupancy heatmap'),
      });
      const leakPanel = S.rcc.panel({
        title: 'Capacity leakage', sub: 'monthly covers recoverable without adding seats',
        body: `<div>${[
          ['Late table turns', 'checks remaining open and parties exceeding target duration during peak windows'],
          ['Unfilled late cancellations', 'cancelled close to service with no waitlist replacement'],
          ['No-show gaps', 'reserved inventory unused after the grace period'],
          ['Over-blocked inventory', 'tables or combinations held longer than operationally required'],
          ['Waitlist non-response', 'guests offered a table but not contacted or expired before seating'],
        ].map(([h, p]) => `<div class="rsv-leak-row"><div><h4>${esc(h)}</h4><p>${esc(p)}.</p></div><strong>—</strong></div>`).join('')}</div>`
          + gate('Capacity leakage'),
      });
      const turnPanel = S.rcc.panel({
        title: 'Table-turn performance', sub: 'targets should vary by party size and daypart',
        body: emptyTable([['Party size'], ['Target duration', 1], ['Actual duration', 1], ['On target', 1], ['Peak variance', 1], ['Action']])
          + gate('Table-turn performance'),
      });
      const flowPanel = S.rcc.panel({
        title: 'Guest-flow signals', sub: 'OpenTable status events combined with POS table status',
        body: `<div class="r-driver-grid">${[
          ['Arrive on time', 'within the on-time window'],
          ['Late arrivals', 'after the booked slot'],
          ['Early arrivals', 'before the booked slot'],
          ['Long waits', 'seated past the quoted wait'],
          ['Waitlist accepted', 'offered → seated'],
          ['Quote accuracy', 'actual minus quoted'],
          ['Unclosed POS checks', 'table-status delay'],
          ['Table re-seats', 'peak service turnover'],
        ].map(([lab, det]) => S.rcc.driver({ label: lab, value: '—', sub: det })).join('')}</div>`
          + gate('Guest-flow signals'),
      });
      return `<div class="r-grid r-two-col">${heatPanel}${leakPanel}</div>
        <div class="r-grid r-two-col">${turnPanel}${flowPanel}</div>`;
    };

    // ============================ CUSTOMER INTELLIGENCE (identity-gated) ============================
    const renderCustomersTab = () => {
      const bestPanel = S.rcc.panel({
        title: 'Best customers and lapse monitoring', sub: 'per-guest visits, spend and lapse truth · restricted by role when live',
        headRight: S.rcc.tag('identity-gated', 'warn'),
        body: emptyTable([['Guest'], ['Visits ever', 1], ['Last quarter', 1], ['Last visit'], ['Expected gap', 1], ['Lifetime spend', 1], ['Avg / visit', 1], ['Segment'], ['Lapse flag']])
          + identityGate('Best customers and lapse monitoring'),
      });
      // The value × frequency QUAD-MATRIX frame (the menu-portfolio pattern): the four labelled
      // quadrants, NO bubbles — a bubble would be a per-guest claim.
      const quadPanel = S.rcc.panel({
        title: 'Customer value × frequency matrix', sub: 'prioritise service, retention and marketing by economic value',
        headRight: S.rcc.tag('identity-gated', 'warn'),
        body: `<div class="rsv-quad">
            <span class="rsv-q-label rsv-q-tl">High value · low frequency — OPPORTUNITY</span>
            <span class="rsv-q-label rsv-q-tr">High value · high frequency — VIP</span>
            <span class="rsv-q-label rsv-q-bl">Low value · low frequency — OCCASIONAL</span>
            <span class="rsv-q-label rsv-q-br">Low value · high frequency — HABITUAL</span>
          </div>` + identityGate('Customer value × frequency matrix'),
      });
      // Definitional lapse logic — the mock's own numeric thresholds are UNRULED, so they never
      // render; the wording stays digit-free until the identity-map ruling sets them.
      const lapsePanel = S.rcc.panel({
        title: 'Lapse logic and action rules', sub: 'a fixed calendar-window rule is too crude · definitional, thresholds land with the identity-map ruling',
        headRight: S.rcc.tag('identity-gated', 'warn'),
        body: S.rcc.formula([
          'Expected return gap = median days between recent visits',
          '(or the segment default when history is thin)',
          'Lapse ratio = days since last interaction ÷ expected return gap',
          'Current / Watch / Lapsed = ruled multiples of the expected gap',
        ])
          + `<div>${[
            ['VIP or high value becomes overdue', 'personal note or manager invitation; no generic voucher', 'First priority'],
            ['Regular becomes overdue', 'relevant new product, event or favourite-item message', 'Second priority'],
            ['Occasional customer lapses', 'automated broad campaign only when marginal capacity exists', 'Third priority'],
          ].map(([h, p, pr]) => `<div class="rsv-leak-row"><div><h4>${esc(h)}</h4><p>${esc(p)}.</p></div><strong>${esc(pr)}</strong></div>`).join('')}</div>`
          + identityGate('Lapse logic and action rules'),
      });
      return `<div class="r-grid r-two-col">${bestPanel}${quadPanel}</div>${lapsePanel}`;
    };

    // ============================ REVIEWS & RECOVERY (R1) ============================
    const renderReviewsTab = () => {
      const rev = m.rev || {};
      const snap = rev.snap;

      // ---- (1) KPI strip: 4 rating tiles (stars + window) · Google-only response rate ·
      // reviews last 90d. A missing snapshot renders '—' and NO stars (zero stars would claim
      // a zero rating — fabrication). ----
      const win = snap && snap.window ? `window: ${snap.window}` : (snap ? 'window not recorded' : 'no review snapshot yet');
      const ratingKpi = (label, val) => {
        const v = val != null ? Number(val) : null;
        return `<div class="r-card r-kpi"><div class="r-kpi-label">${esc(label)}</div><div class="r-kpi-value">${v != null ? v.toFixed(2) : '—'}</div><div class="r-kpi-sub">${v != null ? S.rcc.stars(v) + ' ' : ''}${esc(win)}</div></div>`;
      };
      const kpis = [
        ratingKpi('Overall rating', snap && snap.overall),
        ratingKpi('Google rating', snap && snap.google),
        ratingKpi('TripAdvisor rating', snap && snap.tripadvisor),
        ratingKpi('OpenTable rating', snap && snap.opentable),
        S.rcc.kpi({
          label: 'Response rate', value: rev.resp ? `${((rev.resp.replied / rev.resp.total) * 100).toFixed(1)}%` : '—',
          sub: 'Google only — reply state not tracked for TA/OT',
        }),
        S.rcc.kpi({
          label: 'Reviews · last 90d', value: rev.last90 != null ? int(rev.last90) : '—',
          sub: 'review_corpus · by reviewed_date',
        }),
      ].join('');
      const kpiCaption = snap
        ? `<div class="rv2-caption">ratings = review_snapshot (newest fetch, ${esc(snap.window || 'window not recorded')}) · response rate = Google replied ÷ Google total (${rev.resp ? `${int(rev.resp.replied)} of ${int(rev.resp.total)}` : 'no Google reviews in the corpus yet'}; has_reply is NOT tracked for TA/OT — a blended rate would be fake, so none is shown) · counts = review_corpus</div>`
        : `<div class="rv2-caption">No review snapshot yet — the daily reviews ingest fills the platform ratings; response rate and counts come from review_corpus (Google reply state only — has_reply is not tracked for TA/OT).</div>`;

      // ---- (2) monthly rating trend: 12-month line (orange) + review-volume columns; a month
      // without a rated review is a GAP — the line breaks, never interpolates ----
      let trendBody;
      const trend = rev.trend || [];
      const anyAvg = trend.some((p) => p.avg != null);
      if (anyAvg) {
        const T = 20, B = 220, L = 60, R = 865;
        const X = (i) => Math.round((L + (i * (R - L)) / Math.max(1, trend.length - 1)) * 10) / 10;
        const Y = (v) => Math.round((B - ((B - T) * v) / 5) * 10) / 10;
        const grid = [1, 2, 3, 4, 5].map((t) =>
          `<line x1="54" y1="${Y(t)}" x2="870" y2="${Y(t)}" class="gridline"/><text x="24" y="${Y(t) + 4}" class="axistext">${t}.0</text>`).join('');
        const idx = trend.map((p, i) => ({ i, v: p.avg }));
        const line = REP.contiguousRuns(idx, (p) => p.v != null).map((run) => run.length === 1
          ? `<circle cx="${X(run[0].i)}" cy="${Y(run[0].v)}" r="4" class="point"/>`
          : `<polyline points="${run.map((p) => `${X(p.i)},${Y(p.v)}`).join(' ')}" class="line-current"/>`).join('');
        const pts = idx.filter((p) => p.v != null).map((p) => `<circle cx="${X(p.i)}" cy="${Y(p.v)}" r="3" class="point"/>`).join('');
        const maxN = Math.max(...trend.map((p) => p.n), 1);
        const bars = trend.map((p, i) => p.n > 0
          ? `<rect class="rsv-vol" x="${X(i) - 8}" y="${Math.round((B - (p.n / maxN) * 40) * 10) / 10}" width="16" height="${Math.round(((p.n / maxN) * 40) * 10) / 10}" fill="#56616e" opacity=".45"><title>${esc(monthLabel(p.ym))} · avg ${p.avg.toFixed(2)} · ${int(p.n)} review(s)</title></rect>`
          : '').join('');
        const xlabs = trend.map((p, i) => `<text x="${X(i) - 12}" y="243" class="axistext">${esc(MONTHS_ABBR[Number(p.ym.slice(5, 7))])}</text>`).join('');
        trendBody = `<div class="chart-wrap"><svg viewBox="0 0 900 260" role="img" aria-label="Twelve month review rating trend">${grid}${bars}${line}${pts}${xlabs}</svg></div>
          <div class="r-mini-note">trailing 12 months · AVG(overall) per month + review count (the grey columns) · review_corpus, all platforms · a month without a rated review is a GAP — the line breaks, never interpolates.</div>`;
      } else {
        trendBody = S.rcc.emptyState({ title: 'Monthly rating trend', blocker: 'no rated review in the trailing 12 months (review_corpus).', unlock: 'the daily reviews ingest' });
      }
      const trendPanel = S.rcc.panel({
        title: 'Monthly rating trend', sub: 'blended monthly average · all platforms · with review volume',
        headRight: `<div class="r-legend"><span><i style="background:#ef6a50"></i>Avg rating</span><span><i class="sq" style="background:#56616e"></i>Review volume</span></div>`,
        body: trendBody,
      });

      // ---- (3) sentiment themes: the extraction taxonomy (review_issues) — real counts,
      // meters scaled to the max code, ONE colour (accent) ----
      let themesBody;
      if (rev.themes && rev.themes.length) {
        const max = Math.max(...rev.themes.map((t) => t.n), 1);
        const meters = rev.themes.map((t) => S.rcc.meterRow({
          label: t.code, pct: (t.n / max) * 100, value: `${int(t.n)} · ${int(t.n90)} in 90d`,
        })).join('');
        const backlogLine = rev.backlog != null
          ? `extraction backlog ${int(rev.backlog)} unclassified (has-text corpus rows not yet through issue_extractions — the extractor's own claim filter)`
          : 'extraction backlog unknown — issue_extractions not present in the DB';
        themesBody = `<div class="r-meters">${meters}</div>
          <div class="r-mini-note">themes = the extraction taxonomy (review_issues); all-time count · last-90d count (by reviewed_date) · ${esc(backlogLine)}.</div>`;
      } else {
        themesBody = S.rcc.emptyState({ title: 'Sentiment themes', blocker: 'no issue extractions yet (review_issues is empty) — the taxonomy fills as the extractor classifies the corpus.', unlock: 'the reviews-dept extraction worker' });
      }
      const themesPanel = S.rcc.panel({
        title: 'Sentiment themes', sub: 'what reviews complain about · the extraction taxonomy',
        body: themesBody,
      });

      // ---- (4) service recovery queue: IDENTITY-GATED designed empty-state (the mock's row
      // headers, ZERO rows, zero digits) ----
      const recoveryPanel = S.rcc.panel({
        title: 'Service recovery queue', sub: 'per-guest outreach on poor reviews',
        headRight: S.rcc.tag('identity-gated', 'warn'),
        body: `<div class="rsv-qrow head"><div>Guest</div><div>Review</div><div>Issue</div><div>Recovery status</div><div>Owner</div></div>
          <div class="rsv-gate">${S.rcc.emptyState({ title: 'Service recovery queue', blocker: `${IDENTITY_BLOCKER}. ${OT_BLOCKER}.` })}</div>`,
      });

      // ---- (5) review-to-return measurement: the mock's 4-stat layout, zero digits ----
      const returnStats = ['Reviewers who returned', 'Return after a negative review', 'Return after recovery outreach', 'Median days to return']
        .map((label) => S.rcc.driver({ label, value: '—', sub: 'needs identity linking' })).join('');
      const returnPanel = S.rcc.panel({
        title: 'Review-to-return measurement', sub: 'did the guest come back after the feedback loop',
        headRight: S.rcc.tag('identity-gated', 'warn'),
        body: `<div class="r-driver-grid g2">${returnStats}</div>
          <div class="rsv-gate">${S.rcc.emptyState({ title: 'Review-to-return measurement', blocker: `${IDENTITY_BLOCKER}. ${OT_BLOCKER}.` })}</div>`,
      });

      // ---- (6) reputation management actions: the action log (review_actions), newest 8;
      // before→after ONLY when both rates exist (the measurement loop) ----
      let actionsBody;
      const actions = rev.actions || [];
      if (actions.length) {
        const isoDay = (msv) => (msv > 0 ? new Date(msv).toISOString().slice(0, 10) : '—');
        const rates = (b, a) => {
          const scale = (b > 1 || a > 1) ? 1 : 100; // fractions ≤1 scale ×100 (the issues-page rule)
          return `${(b * scale).toFixed(1)}% → ${(a * scale).toFixed(1)}%`;
        };
        const rowsHtml = actions.map((a) => `<tr>
            <td>${esc(a.code)}${a.auto ? ' <span class="ash">auto</span>' : ''}</td>
            <td class="mono">${esc(isoDay(a.identifiedAt))}</td>
            <td>${a.action && a.action.trim() ? esc(a.action) : '—'}</td>
            <td>${S.rcc.tag(a.status || '—', STATUS_TONE[a.status])}</td>
            <td class="r-num mono">${a.before != null && a.after != null ? esc(rates(a.before, a.after)) : '—'}</td>
          </tr>`).join('');
        actionsBody = `<div style="overflow:auto"><table><thead><tr><th>Issue</th><th>Identified</th><th>Action taken</th><th>Status</th><th class="r-num">Rate before → after</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
          <div class="r-mini-note">newest ${int(actions.length)} of the action log (review_actions) · write path = the reviews action log CLI (reviews action log &lt;CODE&gt; "what changed") — the board never writes · before → after = the measured issue rate around the action (the measurement loop); shown only when BOTH sides are measured.</div>`;
      } else {
        actionsBody = S.rcc.emptyState({ title: 'Reputation management actions', blocker: 'no actions logged yet (review_actions is empty).', unlock: 'the reviews action log CLI: reviews action log <CODE> "what changed"' });
      }
      const actionsPanel = S.rcc.panel({
        title: 'Reputation management actions', sub: 'operator-logged corrective actions · the measurement loop',
        headRight: actions.length ? S.rcc.tag(`${actions.length} logged`, 'info') : '',
        body: actionsBody,
      });

      // (R2: the Data-readiness panel MOVED to the Executive tab — its mock home; one home per fact.)

      // ---- (7) recommended data architecture: definitional TEXT cards, no numbers ----
      const archPanel = S.rcc.panel({
        title: 'Recommended data architecture', sub: 'the sources this centre is designed around · definitional, no data claimed',
        body: `<div class="r-driver-grid">
          ${S.rcc.driver({ label: 'OpenTable GuestCenter', value: 'weekly export → inbox', sub: 'reservation truth: bookings, covers, statuses, no-shows and guest profiles — lands as the emailed weekly export into the box inbox' })}
          ${S.rcc.driver({ label: 'Lightspeed K-Series', value: 'per-receipt spend', sub: 'the wired POS record — spend, channel and daypart truth; carries NO reservation flag and NO guest identity (canon: POS guest-count is never covers)' })}
          ${S.rcc.driver({ label: 'LivePepper / COMBO', value: 'online-order feed', sub: 'direct online orders as a future guest-contact source — not wired, no store exists yet' })}
          ${S.rcc.driver({ label: 'Customer identity map', value: 'the linking decision', sub: 'one guest across OpenTable, POS and reviews — needs the operator identity-map ruling before any per-guest panel lights up' })}
        </div>`,
      });

      return `<div class="r-grid r-kpi-grid">${kpis}</div>${kpiCaption}
        <div class="r-grid r-two-col">${trendPanel}${themesPanel}</div>
        <div class="r-grid r-two-col">${recoveryPanel}${returnPanel}</div>
        ${actionsPanel}
        ${archPanel}`;
    };

    const tabBody = tab === 'reviews' ? renderReviewsTab()
      : tab === 'demand' ? renderDemandTab()
      : tab === 'behaviour' ? renderBehaviourTab()
      : tab === 'capacity' ? renderCapacityTab()
      : tab === 'customers' ? renderCustomersTab()
      : renderExecutiveTab();

    const body = `<div class="rcc">` + styles + tabsNav + tabBody + `</div>`;

    // stamp: on the reviews tab = honest snapshot freshness; elsewhere the standing feed state.
    let stamp;
    if (tab === 'reviews' && m.rev && m.rev.snap && m.rev.snap.fetchedAt) {
      const fr = S.freshness(m.rev.snap.fetchedAt, now);
      stamp = `review snapshot · ${fr.cls === 'fresh' ? `<b>${fr.label}</b>` : `<span class="${fr.cls}">${fr.label}</span>`}`;
    } else if (tab === 'reviews') {
      stamp = 'review snapshot · <span class="none">not yet ingested</span>';
    } else {
      stamp = 'OpenTable weekly export · <span class="none">pending</span>';
    }
    return { stamp, body };
  },
};
