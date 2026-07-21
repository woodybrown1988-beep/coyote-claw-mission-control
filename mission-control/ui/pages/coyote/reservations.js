'use strict';
// Reservations — the RESERVATIONS & GUEST COMMAND CENTRE (R1, built from the Stage-1 gap map
// docs/reservations-centre/gap-map.md + the operator mock reference/mock-*.png). ONE route
// (/coyote/reservations), six subtabs per the mock:
//   executive (default) · demand · behaviour · capacity · customers · reviews
// R1 SCOPE: the shell + the REVIEWS & RECOVERY tab fully built (mostly REAL — the wired reviews
// dept: review_snapshot / review_corpus / review_issues / review_actions). The five other tabs
// render ONE honest line each; their designed gate-states land in R2 (stacked next).
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

// The five non-reviews tabs carry EXACTLY this line in R1 (the designed gate-states are R2).
const R2_NOTE = 'R2 gate-state build pending — every panel here needs the OpenTable weekly export (inbox: no files received yet).';
// The ONE OpenTable blocker line, VERBATIM from the gap map — every OpenTable-gated surface names it.
const OT_BLOCKER = 'OpenTable weekly export — no files received yet; unlock = start the emailed export to the inbox';
// The identity blocker for the two per-guest panels on this tab.
const IDENTITY_BLOCKER = 'per-guest recovery needs review↔guest identity linking (OpenTable + the identity-map decision)';

// review_actions status → chip tone (the ruled classes; an unknown status renders neutral).
const STATUS_TONE = { open: 'warn', actioned: 'info', escalated: 'bad', resolved: 'good' };

// ---------------------------------------------------------------------------------------------
// getSection — SELECT-only; every read degrades to an honest null on a missing table.
// ---------------------------------------------------------------------------------------------
function buildReviews(q, now) {
  const r = { snap: null, resp: null, last90: null, trend: null, themes: null, backlog: null, actions: [], ready: null };
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

  // ---- data readiness: REAL DB probes — a failed SELECT (missing table) = null, an honest
  // distinct state from a present-but-empty store ----
  const probe = (table) => { const res = q(`SELECT COUNT(*) n FROM ${table}`); return res && res.ok && res.rows[0] ? (num(res.rows[0].n) || 0) : null; };
  r.ready = {
    receipts: probe('sales_receipts_api'),
    corpus: probe('review_corpus'),
    otRes: probe('opentable_reservations'),
    otCovers: probe('covers_day'),
  };
  return r;
}

module.exports = {
  key: 'reservations', route: '/coyote/reservations', workspace: 'coyote', title: 'Reservations',
  sub: 'Guest & reservations command centre · OpenTable feed pending',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    const query = (ctx && ctx.query) || {};
    const tab = TAB_KEYS.includes(String(query.tab || '')) ? String(query.tab) : 'executive';
    const m = { now, tab, rev: null };
    if (typeof q !== 'function') return m;
    if (tab === 'reviews') m.rev = buildReviews(q, now);
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
    </style>`;

    // ---- subtab nav: 6 links, the reports .r-tabs grammar; ?tab only ----
    const tabsNav = `<div class="r-tabs">${TABS.map((t) =>
      `<a class="r-tab${t.key === tab ? ' active' : ''}" href="/coyote/reservations?tab=${t.key}">${esc(t.label)}</a>`).join('')}</div>`;

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

      // ---- (7) data readiness: REAL DB statuses (the mock's honest-state pattern) ----
      const ready = rev.ready || { receipts: null, corpus: null, otRes: null, otCovers: null };
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
        'review_corpus + review_snapshot — the wired reviews dept feeds this whole tab',
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

      // ---- (8) recommended data architecture: definitional TEXT cards, no numbers ----
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
        ${readinessPanel}
        ${archPanel}`;
    };

    const tabBody = tab === 'reviews' ? renderReviewsTab() : S.rcc.note(R2_NOTE);

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
