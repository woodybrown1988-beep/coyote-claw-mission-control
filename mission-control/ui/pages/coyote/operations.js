'use strict';
// OPERATIONS CENTRE (Reports section) — built as a BUILD-AHEAD-AS-A-TARGET scaffold (operator ruling
// 2026-07-22: "build it, we can connect later"), after the Stage-1 overlap audit
// (docs/operations-centre/gap-map.md). The audit's binding finding: this is NOT a re-render of the
// other centres — it is a NEW service-execution data domain (kitchen timing, FOH flow, takeaway
// fulfilment, order defects, live ops, shift scoring) whose FOUR sources are NONE of them wired on
// the box: Lightspeed KDS, OpenTable events, LivePepper/StoreKit, and a per-order defect-capture
// system. So every service panel is a DESIGNED EMPTY-STATE naming the exact SOURCE it needs — the
// scaffold pulls the four connections into being. NO mock numbers ever render. The ~10% that IS a
// re-render (the "what needs me today" queue) is NOT recomputed here — it points ONE-HOME to Rex /
// the Decision Feed / Overview, per the one-home rule. The live heart is the Connections panel: the
// real wire-state of all eight sources (four dark, four live imports). Contract: { key, route,
// workspace, title, sub, getSection, render }. SELECT-only via ctx.q. Canon = S.rcc.
const S = require('../../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function tableExists(q, name) { const r = q(`SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1`, [name]); return rowsOf(r).length > 0; }

// ---------------------------------------------------------------------------------------------
// THE GATE CLASSES — a service panel declares which SOURCE-WIRING gate blocks it (the Stage-1 audit
// encoded). The empty-state names the source + the exact connection to make. RE-RENDER is different:
// the signal already has a home; we point to it, we never recompute (one-home rule).
// ---------------------------------------------------------------------------------------------
const GATE = {
  kds: {
    tag: 'KDS-gated', tone: 'warn',
    blocker: 'needs the Lightspeed KDS / production-centre feed — prep times, ticket completion and slowest products by station. The current Lightspeed pull is AGGREGATE SALES ONLY (no per-ticket timing).',
    unlock: 'wire the Lightspeed KDS / production statistics feed',
  },
  opentable: {
    tag: 'OpenTable-gated', tone: 'warn',
    blocker: 'needs OpenTable event timestamps — arrival, seated, turn time, waitlist, occupancy. OpenTable is export-gated (inbox-zero); the Reservations Centre named the same wall.',
    unlock: 'start the OpenTable event export (the Reservations Centre unlock)',
  },
  digital: {
    tag: 'digital-order gated', tone: 'warn',
    blocker: 'needs the LivePepper / StoreKit order-event APIs — received → accepted → kitchen-sent → ready → collected, plus channel-specific failures. Not wired at all today.',
    unlock: 'wire the LivePepper / StoreKit order-event APIs',
  },
  defect: {
    tag: 'defect-capture gated', tone: 'bad',
    blocker: 'needs a per-order defect / recovery capture — category, originating station, root cause, refund/recovery £, guest contacted. No such structured record exists; the mock itself says generic reasons like "customer complaint" are not sufficient.',
    unlock: 'stand up per-order defect + recovery capture (channel · order · station · root cause · £)',
  },
  composite: {
    tag: 'composite · all sources', tone: 'bad',
    blocker: 'a shift score / cross-service view composes ALL four service sources (KDS + OpenTable + digital-order + defect capture) — it cannot compute until those are wired.',
    unlock: 'wire the four service sources; the composite lights up last',
  },
};
function gatePanel(title, sub, cls) {
  const g = GATE[cls];
  return S.rcc.panel({ title, sub, headRight: S.rcc.tag(g.tag, g.tone), body: S.rcc.emptyState({ title, blocker: g.blocker, unlock: g.unlock }) });
}
// A RE-RENDER pointer: the signal exists elsewhere; name the home, do NOT recompute here.
function homePanel(title, sub, home, route) {
  return S.rcc.panel({
    title, sub, headRight: S.rcc.tag('one-home · re-render', 'info'),
    body: `<div class="r-empty"><b>${S.escapeHtml(title)}</b> — not recomputed here.<br>This signal already has a home: <b>${S.escapeHtml(home)}</b>. Surfacing a copy would be a fourth rendering (Rex 07:05 brief · the Decision Feed · Overview WEEK-AHEAD). One-home rule: read it there.${route ? `<div class="r-unlock">Go to: <a href="${route}" style="color:${S.rcc.tokens.blue}">${S.escapeHtml(route)}</a></div>` : ''}</div>`,
  });
}
// A live KPI tile that only ever reads — (no mock numbers), with the honest source-gate sub.
function dashKpi(label, sub) { return `<div class="r-card r-kpi"><div class="r-kpi-label">${S.escapeHtml(label)}</div><div class="r-kpi-value">—</div><div class="r-kpi-sub">${S.escapeHtml(sub)}</div></div>`; }

// The four service sources to wire (real-text unlock plan — a plan is not data).
const SOURCE_PLAN = [
  { key: 'kds', label: 'Lightspeed KDS / production feed', lights: 'Kitchen Throughput + Live station load + prep timing on every tab', note: 'prep times, ticket completion, slowest products by production centre.' },
  { key: 'opentable', label: 'OpenTable event export', lights: 'FOH & Table Flow + live FOH + seating/turn on the Executive', note: 'arrival/seat/turn/waitlist timestamps; same unlock the Reservations Centre needs.' },
  { key: 'digital', label: 'LivePepper / StoreKit order events', lights: 'the whole Takeaway tab + digital channel rows', note: 'received→accepted→ready→collected per channel, with failure reasons.' },
  { key: 'defect', label: 'Per-order defect + recovery capture', lights: 'Quality & Recovery + the shift-score accuracy term', note: 'a new capture: channel · order · station · root cause · refund/recovery £ · guest contacted.' },
];

// The eight architecture sources (the mock's own source map) + how each is wired on THIS box.
const SOURCES = [
  { key: 'kds', label: 'Lightspeed KDS', role: 'Kitchen timing', kind: 'service' },
  { key: 'opentable', label: 'OpenTable', role: 'FOH flow', kind: 'service' },
  { key: 'digital', label: 'LivePepper / StoreKit', role: 'Digital orders', kind: 'service' },
  { key: 'defect', label: 'Defect / recovery capture', role: 'Quality & recovery', kind: 'service' },
  { key: 'revenue', label: 'Revenue Centre', role: 'Revenue vs plan (import)', kind: 'import', table: 'sales_day', route: '/coyote/revenue' },
  { key: 'labour', label: 'Labour Centre', role: 'Hours / deployment (import)', kind: 'import', table: 'labour_day', route: '/coyote/labour' },
  { key: 'reviews', label: 'Reviews', role: 'Guest outcome (import)', kind: 'import', table: 'review_aggregate', route: '/coyote/reviews' },
  { key: 'safety', label: 'Kitchen Safety', role: 'Safety override (import)', kind: 'import', table: 'ks_sync_meta', route: '/coyote/kitchen-safety' },
];

const TABS = [
  ['executive', 'Executive'], ['live', 'Live Shift'], ['kitchen', 'Kitchen Throughput'],
  ['foh', 'FOH & Table Flow'], ['takeaway', 'Takeaway'], ['quality', 'Quality & Recovery'],
  ['scorecards', 'Shift Scorecards'],
];

module.exports = {
  key: 'operations',
  route: '/coyote/operations',
  workspace: 'coyote',
  title: 'Operations',
  sub: 'Throughput, service speed, order quality & shift execution — build-ahead scaffold (sources connect later)',

  getSection(db, ctx) {
    const q = ctx.q;
    // LIVE connection state — read the real wire-state of each source on this box.
    const sources = SOURCES.map((s) => {
      if (s.kind === 'import') {
        const live = tableExists(q, s.table);
        // for safety, "live" also means it has synced rows
        let ok = live;
        if (live && s.table === 'ks_sync_meta') ok = rowsOf(q(`SELECT 1 FROM ks_sync_meta WHERE row_count > 0 LIMIT 1`)).length > 0;
        return { ...s, state: ok ? 'live' : 'dark' };
      }
      return { ...s, state: 'dark' }; // the four service sources: none wired
    });
    const liveImports = sources.filter((s) => s.kind === 'import' && s.state === 'live').length;
    const importTotal = sources.filter((s) => s.kind === 'import').length;
    const serviceWired = sources.filter((s) => s.kind === 'service' && s.state === 'live').length;
    return { sources, liveImports, importTotal, serviceWired };
  },

  render(sec, ctx) {
    const q = (ctx.query && ctx.query.tab) || 'executive';
    const tab = TABS.some(([k]) => k === q) ? q : 'executive';
    const T = S.rcc.tokens;
    const esc = S.escapeHtml;

    const styles = `<style>${S.rcc.css()}</style><style>
      .rcc .r-tabs{display:flex;gap:4px;border-bottom:1px solid var(--rline);margin:0 0 14px;overflow:auto}
      .rcc .r-tab{color:#9ba4ae;padding:11px 14px;font-weight:700;border-bottom:2px solid transparent;white-space:nowrap;text-decoration:none;font-size:13px}
      .rcc .r-tab.active{color:#fff;border-bottom-color:var(--raccent)}
      .rcc .r-grid{display:grid;gap:14px}
      .rcc .r-kpi-grid{grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:8px}
      @media(max-width:1200px){.rcc .r-kpi-grid{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:820px){.rcc .r-kpi-grid{grid-template-columns:repeat(2,1fr)}}
      .rcc .r-two{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
      @media(max-width:980px){.rcc .r-two{grid-template-columns:1fr}}
      .rcc .r-mini-note{color:#8f99a4;font-size:10px;margin-top:10px}
      .ops-src{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
      @media(max-width:980px){.ops-src{grid-template-columns:repeat(2,1fr)}}
      .ops-src .s{border:1px solid var(--rline);border-radius:12px;background:#12161a;padding:12px}
      .ops-src .s h4{margin:0 0 4px;font-size:11px}
      .ops-src .s p{margin:0;color:#8f99a4;font-size:9.5px;line-height:1.45}
      .ops-src .s .st{margin-top:9px;font-size:9px;font-weight:900;letter-spacing:.04em}
      .ops-src .s.dark .st{color:#f0a58f}.ops-src .s.live .st{color:#7fe0ae}
      .ops-plan{display:grid;gap:9px}
      .ops-wk{display:grid;grid-template-columns:210px 1fr;gap:12px;align-items:start;border:1px solid var(--rline);border-radius:11px;background:#12161a;padding:11px 13px}
      .ops-wk .k{font-size:11.5px;font-weight:800;color:var(--raccent2)}
      .ops-wk p{margin:3px 0 0;color:#8f99a4;font-size:10.5px;line-height:1.5}
      @media(max-width:820px){.ops-wk{grid-template-columns:1fr}}
    </style>`;

    const tabsNav = `<div class="r-tabs">${TABS.map(([k, lbl]) => `<a class="r-tab${k === tab ? ' active' : ''}" href="/coyote/operations?tab=${k}">${esc(lbl)}</a>`).join('')}</div>`;

    // ---- the live Connections panel (the heart) ----
    const connBody = `<div class="ops-src">${sec.sources.map((s) => `
      <div class="s ${s.state}"><h4>${esc(s.label)}</h4><p>${esc(s.role)}</p>
        <div class="st">${s.state === 'live' ? '● CONNECTED' : (s.kind === 'service' ? '○ NOT WIRED — gate' : '○ not present')}${s.route && s.state === 'live' ? ` · <a href="${s.route}" style="color:${T.blue}">home</a>` : ''}</div></div>`).join('')}</div>
      <div class="r-mini-note">Four service sources (top row) are DARK — the whole operational core waits on them. Four imports are ${sec.liveImports}/${sec.importTotal} live (Revenue, Labour, Reviews, Kitchen Safety) and are read ONE-HOME from their centres, never recomputed here. No panel renders a number until its source is wired.</div>`;
    const connPanel = S.rcc.panel({ title: 'Data architecture & connection state', sub: 'Each source stays authoritative for its own events; Operations combines them', headRight: S.rcc.tag(`${sec.serviceWired}/4 service · ${sec.liveImports}/${sec.importTotal} imports`, sec.serviceWired ? 'good' : 'bad'), body: connBody });

    const sourcePlanPanel = S.rcc.panel({ title: 'The four connections to make', sub: 'Each unlock lights a defined slice — the scaffold is the target', headRight: S.rcc.tag('build-ahead plan', 'info'), body: `<div class="ops-plan">${SOURCE_PLAN.map((p) => `<div class="ops-wk"><div><div class="k">${esc(p.label)}</div></div><div><b style="font-size:10.5px">Lights up:</b> ${esc(p.lights)}<p>${esc(p.note)}</p></div></div>`).join('')}</div>` });

    // ---- tab bodies ----
    let body;
    if (tab === 'executive') {
      const kpis = [
        dashKpi('Shift quality score', 'composite of all four service sources'),
        dashKpi('Median kitchen prep', 'KDS-gated — no prep timing yet'),
        dashKpi('90th-percentile prep', 'KDS-gated — the tail needs KDS'),
        dashKpi('Order accuracy', 'defect-capture gated'),
        dashKpi('On-time table seating', 'OpenTable-gated'),
        dashKpi('Takeaway promise accuracy', 'digital-order gated'),
      ].join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        ${connPanel}
        <div class="r-two">${gatePanel('13-week operational trend', 'Shift score, prep index and service-quality target', 'composite')}${homePanel('Owner attention queue', 'What needs me today, ranked', 'Rex’s 07:05 brief + the RCC Decision Feed + Overview WEEK-AHEAD', '/coyote/overview')}</div>
        <div class="r-two">${gatePanel('Department scorecards (Kitchen / FOH / Takeaway)', 'No department hides behind the total', 'composite')}${gatePanel('Weekly service outcomes', 'Volume + operational quality', 'kds')}</div>
        ${homePanel('Core safeguards', 'Safety exceptions · labour vs budget · review score · cash discrepancy', 'the Kitchen Safety, Labour, Reviews & Revenue centres', '/coyote/kitchen-safety')}
        ${sourcePlanPanel}`;
    } else if (tab === 'live') {
      const kpis = [
        dashKpi('Open kitchen tickets', 'KDS live feed — not wired'), dashKpi('Current median age', 'KDS-gated'),
        dashKpi('Orders last 15 min', 'POS live orders — aggregate only'), dashKpi('Dine-in tables waiting', 'OpenTable-gated'),
        dashKpi('Collection orders due', 'digital-order gated'), dashKpi('Live shift status', 'composite'),
      ].join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="r-two">${gatePanel('Demand stress test', 'Simulate the next 30 minutes of order demand', 'kds')}${gatePanel('Oldest active tickets', 'Live queue ranked by risk', 'kds')}</div>
        <div class="r-two">${gatePanel('Live station load', 'Queue, capacity and ageing by production centre', 'kds')}${gatePanel('Live FOH flow', 'Reservations, walk-ins and table states', 'opentable')}</div>
        ${S.rcc.callout(`<b>Note:</b> the Live Shift tab is a <b>real-time streaming</b> surface (KDS + OpenTable + POS open-orders), a harder build than the nightly-batch centres — it needs live event feeds, not a daily pull. It lights up only after those two sources are wired AND streaming.`)}`;
    } else if (tab === 'kitchen') {
      const kpis = ['Products prepared', 'Median prep time', 'P90 prep time', 'Late-ticket rate', 'Tickets / kitchen hour', 'Kitchen remake rate'].map((l) => dashKpi(l, 'KDS-gated')).join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="r-two">${gatePanel('Prep-time distribution', 'Median can conceal the slowest experiences', 'kds')}${gatePanel('Slowest products (KDS statistics)', 'Average prep time and volume exposure', 'kds')}</div>
        <div class="r-two">${gatePanel('Kitchen demand heatmap', 'Late-ticket % by day and hour', 'kds')}${gatePanel('Kitchen decision ratios', 'Balanced throughput and quality', 'kds')}</div>`;
    } else if (tab === 'foh') {
      const kpis = ['On-time seating', 'Median booking delay', 'Average table turn', 'Waitlist quote accuracy', 'Waitlist conversion', 'FOH order accuracy'].map((l) => dashKpi(l, 'OpenTable-gated')).join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="r-two">${gatePanel('Turn-time by party size', 'Actual versus configured turn time', 'opentable')}${gatePanel('FOH service funnel', 'Where guest flow is lost or delayed', 'opentable')}</div>
        <div class="r-two">${gatePanel('Seating-delay diagnosis', 'Root causes for reservations seated late', 'opentable')}${gatePanel('FOH decision ratios', 'Service speed plus commercial outcomes', 'opentable')}</div>`;
    } else if (tab === 'takeaway') {
      const kpis = ['Takeaway orders', 'Promise accuracy', 'Median order-to-ready', 'P90 order-to-ready', 'Packing accuracy', 'Customer pickup dwell'].map((l) => dashKpi(l, 'digital-order gated')).join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="r-two">${gatePanel('Takeaway order timeline', 'Each fulfilment timestamp kept separately', 'digital')}${gatePanel('Channel performance', 'Operational service by source', 'digital')}</div>
        <div class="r-two">${gatePanel('Packing-defect Pareto', 'Count each affected order once', 'defect')}${S.rcc.panel({ title: 'Takeaway controls', sub: 'Recommended operating standard (a standard is not data)', headRight: S.rcc.tag('standard', 'info'), body: standardList([
          ['Dynamic promise time', 'Adjust using live queue and product mix', 'Required'],
          ['Separate KDS and packed timestamps', 'Kitchen completion is not handoff readiness', 'Required'],
          ['Order-specific packing checklist', 'Include free dips and modifiers', 'Required'],
          ['Named packing verification', 'User and time recorded for exceptions', 'High risk'],
          ['Pickup confirmation', 'Measure ready-to-collected dwell', 'Useful'],
          ['Defect and recovery record', 'Reason, value, customer and resolution', 'Required'],
        ]) })}</div>`;
    } else if (tab === 'quality') {
      const kpis = ['Order defect rate', 'Remake rate', 'Refund rate', 'Recovery discounts', 'Issues recovered in shift', 'Repeat-failure rate'].map((l) => dashKpi(l, 'defect-capture gated')).join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="r-two">${gatePanel('Failure Pareto', 'The few causes driving most guest harm', 'defect')}${gatePanel('Recovery economics', 'Direct cost, retained value and repeat behaviour', 'defect')}</div>
        <div class="r-two">${gatePanel('Failure impact × recurrence matrix', 'Choose action intensity rationally', 'defect')}${S.rcc.panel({ title: 'Required defect record', sub: 'What the capture system must record (the spec, not data)', headRight: S.rcc.tag('capture spec', 'info'), body: `${S.rcc.formula([
          'For each operational failure capture:',
          'channel + order/check + timestamp + shift + manager',
          'product(s) + defect category + originating station',
          'root cause + direct cost + refund/recovery value',
          'guest contacted? + corrective action + repeat occurrence',
          '',
          'Link to: Lightspeed void/refund reason, recovery discount,',
          'OpenTable guest/visit, review, and inventory availability.',
        ])}<div class="r-mini-note">Generic reasons ("customer complaint", "quality") are not sufficient — they describe the symptom, not the operational cause. This is the defect-capture unlock.</div>` })}</div>`;
    } else { // scorecards
      const kpis = ['Best shift', 'Weakest shift', 'Actions completed', 'Repeat actions', 'Forecast accuracy', 'Manager handover'].map((l) => dashKpi(l, 'composite · all sources')).join('');
      body = `<div class="r-grid r-kpi-grid">${kpis}</div>
        ${gatePanel('Shift scorecard', 'Balanced result by service; hard overrides for safety and serious guest failures', 'composite')}
        <div class="r-two">${S.rcc.panel({ title: 'Proposed shift-score weighting', sub: 'Weights reflect Coyote’s commercial + service priorities (a proposal, not data)', headRight: S.rcc.tag('proposed · calibrate', 'info'), body: `${standardBars([
          ['Kitchen speed / reliability', 25], ['Order quality / accuracy', 20], ['FOH flow / guest waits', 15], ['Revenue vs forecast', 15], ['Labour control', 10], ['Availability / waste', 10], ['Reviews / recovery', 5],
        ])}<div class="r-callout"><b>Hard override (a re-render of the Kitchen Safety red-cap):</b> a serious safety breach, allergen failure, unresolved major guest incident or material cash-control failure caps the shift at RED regardless of the weighted score — read from the <a href="/coyote/kitchen-safety" style="color:${T.blue}">Kitchen Safety Centre</a>, not recomputed here.</div>` })}${gatePanel('Management action register', 'Every exception becomes a closed-loop improvement', 'composite')}</div>`;
    }

    const stamp = `operations · build-ahead scaffold · ${sec.serviceWired}/4 service sources wired · no mock numbers — panels light up as KDS / OpenTable / digital-order / defect-capture connect`;
    return { stamp, body: `<div class="rcc">${styles}${tabsNav}${body}</div>` };
  },
};

// ---- small real-text helpers (standards/weights render as text; a standard is not data) ----
function standardList(items) {
  return `<div class="ops-plan">${items.map(([t, d, tag], i) => `<div class="ops-wk" style="grid-template-columns:26px 1fr auto"><div class="k">${i + 1}</div><div><b style="font-size:10.5px">${S.escapeHtml(t)}</b><p>${S.escapeHtml(d)}</p></div><div>${S.rcc.tag(tag, tag === 'Required' ? 'bad' : tag === 'High risk' ? 'warn' : undefined)}</div></div>`).join('')}</div>`;
}
function standardBars(items) {
  const T = S.rcc.tokens;
  return `<div style="display:grid;gap:9px">${items.map(([l, pct]) => S.rcc.barrow({ label: l, segs: [{ pct, color: T.accent }], value: pct + '%' })).join('')}</div>`;
}
