'use strict';
// INVENTORY CENTRE (Reports section). Counts, count adjustments, usage and waste now read the local
// inventory engine contract; feeds that contract still cannot answer remain in their original gate
// states. Contract: { key, route, workspace, title, sub, getSection, render }. Every runtime read is
// SELECT-only through ctx.q. Design canon = S.rcc (the RCC tokens/components).
const S = require('../../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
const DAY_MS = 86400000;
const DASH = '—';

// Kept together and exported so the schema-conformance test can prove that this page never reaches
// beyond the six-table Inventory Centre contract.
const INVENTORY_SQL = Object.freeze({
  readiness: `SELECT
      (SELECT COUNT(*) FROM stock_counts) count_rows,
      (SELECT COUNT(*) FROM waste_events) waste_rows`,
  lastCounts: `SELECT id, business_date, kind, status, opened_by, opened_at,
      closed_by, closed_at, settled_through, note
    FROM stock_counts
    ORDER BY business_date DESC, closed_at DESC, id DESC
    LIMIT 10`,
  latestClosedCount: `SELECT id, business_date, kind, status, opened_by, opened_at,
      closed_by, closed_at, settled_through, note
    FROM stock_counts
    WHERE status = 'closed'
    ORDER BY business_date DESC, closed_at DESC, id DESC
    LIMIT 1`,
  latestClosedFullCount: `SELECT id, business_date, kind, status, opened_by, opened_at,
      closed_by, closed_at, settled_through, note
    FROM stock_counts
    WHERE status = 'closed' AND kind = 'full'
    ORDER BY business_date DESC, closed_at DESC, id DESC
    LIMIT 1`,
  countAdjustments: `SELECT sm.id, sm.ingredient_id, si.name, sm.location, sm.qty,
      sm.unit_of_measure, sm.value_pence, sm.business_date
    FROM stock_movements sm
    JOIN sub_items si ON si.id = sm.ingredient_id
    WHERE sm.kind = 'adjustment'
      AND sm.proof_kind = 'count'
      AND sm.proof_ref = ?
    ORDER BY ABS(sm.value_pence) DESC, sm.ingredient_id ASC, sm.id ASC
    LIMIT 15`,
  countQualityTotals: `SELECT COUNT(*) active_count,
      SUM(CASE WHEN NOT EXISTS (
        SELECT 1 FROM count_lines cl
        WHERE cl.count_id = ?
          AND cl.ingredient_id = ics.ingredient_id
          AND cl.location = ics.location
      ) THEN 1 ELSE 0 END) missing_count
    FROM ingredient_count_settings ics
    WHERE ics.active = 1`,
  countQualityNames: `SELECT si.name, ics.ingredient_id, ics.location
    FROM ingredient_count_settings ics
    JOIN sub_items si ON si.id = ics.ingredient_id
    WHERE ics.active = 1
      AND NOT EXISTS (
        SELECT 1 FROM count_lines cl
        WHERE cl.count_id = ?
          AND cl.ingredient_id = ics.ingredient_id
          AND cl.location = ics.location
      )
    ORDER BY ics.location ASC, ics.walk_order ASC, si.name ASC, ics.ingredient_id ASC
    LIMIT 10`,
  countedStockValue: `SELECT
      SUM(cl.counted_qty * CAST(si.pack_cost_pence AS REAL) / si.pack_qty) value_pence,
      COUNT(*) line_count,
      COUNT(CASE WHEN si.pack_cost_pence IS NOT NULL AND si.pack_qty IS NOT NULL THEN 1 END) costed_line_count
    FROM count_lines cl
    JOIN sub_items si ON si.id = cl.ingredient_id
    WHERE cl.count_id = ?`,
  recentUsage: `SELECT -SUM(value_pence) value_pence,
      COUNT(*) movement_count,
      COUNT(value_pence) costed_movement_count,
      COUNT(DISTINCT business_date) date_count
    FROM stock_movements
    WHERE kind = 'usage'
      AND proof_kind = 'sales-day'
      AND proof_ref = business_date
      AND business_date IN (
        SELECT DISTINCT business_date
        FROM stock_movements
        WHERE kind = 'usage'
          AND proof_kind = 'sales-day'
          AND proof_ref = business_date
        ORDER BY business_date DESC
        LIMIT 7
      )`,
  recentWaste: `SELECT -SUM(sm.value_pence) value_pence,
      COUNT(*) movement_count,
      COUNT(sm.value_pence) costed_movement_count
    FROM stock_movements sm
    JOIN waste_events we ON we.id = sm.proof_ref
    WHERE sm.kind = 'waste'
      AND sm.proof_kind = 'waste'
      AND sm.business_date BETWEEN ? AND ?
      AND instr(lower(COALESCE(we.note, '')), '[voided by') = 0`,
  wasteByReason: `SELECT we.reason,
      COUNT(DISTINCT we.id) event_count,
      -SUM(sm.value_pence) value_pence,
      COUNT(sm.value_pence) costed_movement_count
    FROM waste_events we
    JOIN stock_movements sm ON sm.proof_ref = we.id
      AND sm.proof_kind = 'waste'
      AND sm.kind = 'waste'
    WHERE we.business_date BETWEEN ? AND ?
      AND instr(lower(COALESCE(we.note, '')), '[voided by') = 0
    GROUP BY we.reason
    ORDER BY value_pence DESC, we.reason ASC`,
  topWastedIngredients: `SELECT si.id ingredient_id, si.name, si.unit_of_measure,
      COUNT(DISTINCT we.id) event_count,
      -SUM(sm.qty) qty,
      -SUM(sm.value_pence) value_pence,
      COUNT(sm.value_pence) costed_movement_count
    FROM waste_events we
    JOIN stock_movements sm ON sm.proof_ref = we.id
      AND sm.proof_kind = 'waste'
      AND sm.kind = 'waste'
    JOIN sub_items si ON si.id = sm.ingredient_id
    WHERE we.business_date BETWEEN ? AND ?
      AND instr(lower(COALESCE(we.note, '')), '[voided by') = 0
    GROUP BY si.id, si.name, si.unit_of_measure
    ORDER BY value_pence DESC, si.name ASC, si.id ASC
    LIMIT 10`,
});

function utcBusinessDate(now) { return new Date(now).toISOString().slice(0, 10); }
function daysBefore(now, days) { return new Date(now - days * DAY_MS).toISOString().slice(0, 10); }
function calendarDaysAgo(businessDate, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate || ''))) return null;
  const then = Date.parse(`${businessDate}T00:00:00Z`);
  const today = Date.parse(`${utcBusinessDate(now)}T00:00:00Z`);
  return Number.isFinite(then) ? Math.floor((today - then) / DAY_MS) : null;
}
function formatPounds(pence, signed) {
  const n = num(pence);
  if (n == null) return DASH;
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '−' : (signed && rounded > 0 ? '+' : '');
  const pounds = (Math.abs(rounded) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}£${pounds}`;
}
function formatSignedQuantity(qty, unit) {
  const n = num(qty);
  if (n == null) return DASH;
  const sign = n < 0 ? '−' : (n > 0 ? '+' : '');
  const magnitude = Math.abs(n).toFixed(3).replace(/\.?0+$/, '');
  return `${sign}${magnitude} ${String(unit || '').trim()}`.trim();
}
function getReadiness(q) {
  const row = rowsOf(q(INVENTORY_SQL.readiness))[0] || {};
  const countRows = num(row.count_rows) || 0;
  const wasteRows = num(row.waste_rows) || 0;
  return {
    scope: { ready: false, detail: 'operations scope not granted (403); grant pending' },
    items: { ready: false, detail: 'no stock-item store — inventory not enabled in Lightspeed' },
    counts: { ready: countRows > 0, count: countRows, detail: countRows > 0 ? `${countRows} count${countRows === 1 ? '' : 's'} on record` : 'no counts on record — the counting process has not started' },
    waste: { ready: wasteRows > 0, count: wasteRows, detail: wasteRows > 0 ? `${wasteRows} waste event${wasteRows === 1 ? '' : 's'} logged` : 'no waste events logged' },
    pos: { ready: false, count: 0, detail: 'no purchase orders in-system (paid direct from bank)' },
    recipes: { ready: false, detail: 'recipe coverage remains the Calum gate' },
  };
}
function getCountQuality(q, countId) {
  if (!countId) return { activeCount: null, missingCount: null, names: [] };
  const totals = rowsOf(q(INVENTORY_SQL.countQualityTotals, [countId]))[0];
  if (!totals || num(totals.active_count) == null) return { activeCount: null, missingCount: null, names: [] };
  return {
    activeCount: num(totals.active_count),
    missingCount: num(totals.missing_count) || 0,
    names: rowsOf(q(INVENTORY_SQL.countQualityNames, [countId])).map((row) => String(row.name || row.ingredient_id || '')),
  };
}
function getCountsAggregation(q) {
  const lastCounts = rowsOf(q(INVENTORY_SQL.lastCounts));
  const latestClosed = rowsOf(q(INVENTORY_SQL.latestClosedCount))[0] || null;
  return {
    lastCounts,
    latestClosed,
    adjustments: latestClosed ? rowsOf(q(INVENTORY_SQL.countAdjustments, [latestClosed.id])) : [],
    quality: latestClosed ? getCountQuality(q, latestClosed.id) : { activeCount: null, missingCount: null, names: [] },
  };
}
function getWasteAggregates(q, now) {
  const to = utcBusinessDate(now);
  const from = daysBefore(now, 27);
  return {
    from,
    to,
    byReason: rowsOf(q(INVENTORY_SQL.wasteByReason, [from, to])),
    topIngredients: rowsOf(q(INVENTORY_SQL.topWastedIngredients, [from, to])),
  };
}
function aggregatePence(row) {
  return row && (num(row.costed_movement_count) || 0) > 0 ? num(row.value_pence) : null;
}
function getExecutiveKpis(q, now) {
  const latestFull = rowsOf(q(INVENTORY_SQL.latestClosedFullCount))[0] || null;
  const stock = latestFull ? rowsOf(q(INVENTORY_SQL.countedStockValue, [latestFull.id]))[0] : null;
  const usage = rowsOf(q(INVENTORY_SQL.recentUsage))[0] || null;
  const wasteTo = utcBusinessDate(now);
  const wasteFrom = daysBefore(now, 6);
  const waste = rowsOf(q(INVENTORY_SQL.recentWaste, [wasteFrom, wasteTo]))[0] || null;
  return {
    latestFull,
    countedStockPence: stock && (num(stock.costed_line_count) || 0) > 0 ? num(stock.value_pence) : null,
    usagePence: aggregatePence(usage),
    usageDateCount: usage ? (num(usage.date_count) || 0) : 0,
    wastePence: aggregatePence(waste),
    wasteFrom,
    wasteTo,
    lastFullDaysAgo: latestFull ? calendarDaysAgo(latestFull.business_date, now) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// THE FOUR GATE CLASSES (the Stage-1 readiness verdict, encoded). Each panel declares which gate
// blocks it; the empty-state names the gate + the specific adoption step. A tag shows the class so
// the operator can scan what unlocks what.
// ---------------------------------------------------------------------------------------------
const GATE = {
  scope: {
    tag: 'scope + process', tone: 'bad',
    blocker: 'Lightspeed inventory is the K-Series OPERATIONS API — 403-NO-SCOPE on today’s token (the same wall as account-profiles; grant requested, pending). AND even once granted it stays empty until the venue MAINTAINS stock in Lightspeed — this is a process to adopt, not a toggle.',
  },
  recipe: {
    tag: 'recipe-gated', tone: 'warn',
    blocker: 'theoretical usage needs recipe_lines (the Calum gate) AND the physical/actual side above — double-gated: recipe costing alone does not light this without the count feed.',
  },
  invoice: {
    tag: 'invoice-line gated', tone: 'warn',
    blocker: 'per-unit cost + price-change tracking needs the supplier invoice-line ingest already named as future work in the Costs module (unit prices, pack sizes, yields).',
  },
  process: {
    tag: 'process-gated', tone: 'bad',
    blocker: 'needs a DAILY HUMAN WORKFLOW that is not happening — this is one of the mock’s own Weeks 1–6: a process the business would adopt, not a data source waiting on a switch.',
  },
};
/** A designed gate-state panel: the mock's own layout (title/sub) + the honest blocker + the exact
 *  adoption step it needs. Never a number. */
function gatePanel(title, sub, cls, step) {
  const g = GATE[cls];
  return S.rcc.panel({
    title, sub, headRight: S.rcc.tag(g.tag, g.tone),
    body: S.rcc.emptyState({ title, blocker: g.blocker, unlock: step }),
  });
}

// The adoption plan — the mock's Weeks 1–6 rollout, rendered as REAL text (a plan is not data).
const ADOPTION_PLAN = [
  { wk: 'Week 1', t: 'Enable Lightspeed inventory + the operations-scope grant', d: 'switch inventory on in Lightspeed; land the ops-scope grant (the same one account-profiles needs) so the API becomes readable.' },
  { wk: 'Week 2', t: 'Seed the item list + starting stock', d: 'the SKUs already exist from sales; add stock items, pack sizes and an opening count so quantities have a baseline.' },
  { wk: 'Week 3', t: 'Start the counting cadence', d: 'a weekly (then daily on high-risk lines) stock count — the single feed that lights up value, days, turns, variance and par compliance.' },
  { wk: 'Week 4', t: 'Log waste at source', d: 'record waste events with a reason at the moment they happen — the only source for waste-by-reason and the actual-vs-theoretical gap.' },
  { wk: 'Week 5', t: 'Bring purchasing into the system', d: 'raise purchase orders + receive deliveries in Lightspeed (or the invoice-line ingest) so PO discipline, delivery shorts and price-change watch have a source.' },
  { wk: 'Week 6', t: 'Cost the recipes (top-20)', d: 'the Calum gate: cost the top-20 recipes (59.5% coverage in one session) so theoretical usage, variance and margin unlock — pairs with the count feed above.' },
];

// The mock's Data-Quality register: the readiness dimensions this module tracks. Each row's status is
// REAL (probed live), never illustrative.
const READINESS_DIMS = [
  { key: 'scope', label: 'Inventory API scope', how: 'operations-scope grant (Lightspeed)' },
  { key: 'items', label: 'Stock items + opening count', how: 'seed items + first count' },
  { key: 'counts', label: 'Stock counts on record', how: 'run the first count' },
  { key: 'waste', label: 'Waste events logged', how: 'start waste logging' },
  { key: 'pos', label: 'Purchase orders raised', how: 'raise POs in-system' },
  { key: 'recipes', label: 'Recipe coverage (theoretical usage)', how: 'cost the top-20 recipes' },
];

module.exports = {
  key: 'inventory', route: '/coyote/inventory', workspace: 'coyote', title: 'Inventory',
  sub: 'Inventory command centre · counts, usage and waste from the local inventory engine',
  INVENTORY_SQL,
  calendarDaysAgo,
  formatPounds,
  formatSignedQuantity,
  getReadiness,
  getCountsAggregation,
  getCountQuality,
  getWasteAggregates,
  getExecutiveKpis,

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    const tabKeys = ['executive', 'forecast', 'counts', 'kitchen', 'foh', 'purchasing', 'waste', 'plan'];
    const query = (ctx && ctx.query) || {};
    const tab = tabKeys.includes(String(query.tab || '')) ? String(query.tab) : 'executive';
    const m = { now, tab, readiness: null, counts: null, waste: null, executive: null };
    if (typeof q !== 'function') return m;
    m.readiness = getReadiness(q);
    m.counts = getCountsAggregation(q);
    m.waste = getWasteAggregates(q, now);
    m.executive = getExecutiveKpis(q, now);
    return m;
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const int = S.fmtInt;
    const tab = m.tab || 'executive';
    const TABS = [
      ['executive', 'Executive'], ['forecast', 'Forecast & Availability'], ['counts', 'Counts & Variance'],
      ['kitchen', 'Kitchen'], ['foh', 'FOH & Bar'], ['purchasing', 'Purchasing'],
      ['waste', 'Waste & Production'], ['plan', 'Data Quality & Plan'],
    ];
    const styles = `<style>
      /* reports shell grammar — the r-tabs/r-grid layout classes (r-card/r-kpi-* come from S.rcc.css) */
      .rcc .r-tabs{display:flex;gap:4px;border-bottom:1px solid var(--rline);margin:0 0 14px;overflow:auto}
      .rcc .r-tab{color:#9ba4ae;padding:11px 14px;font-weight:700;border-bottom:2px solid transparent;white-space:nowrap;text-decoration:none;font-size:13px}
      .rcc .r-tab.active{color:#fff;border-bottom-color:var(--raccent)}
      .rcc .r-grid{display:grid;gap:14px}
      .rcc .r-kpi-grid{grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:8px}
      @media(max-width:1200px){.rcc .r-kpi-grid{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:820px){.rcc .r-kpi-grid{grid-template-columns:repeat(2,1fr)}}
      .rcc .r-mini-note{color:#8f99a4;font-size:10px;margin-top:10px}
      .inv-two{display:grid;grid-template-columns:minmax(0,2fr) minmax(300px,1fr);gap:14px;margin-bottom:14px}
      @media(max-width:1000px){.inv-two{grid-template-columns:1fr}}
      .inv-plan{display:grid;gap:9px}
      .inv-wk{display:grid;grid-template-columns:78px 1fr;gap:12px;align-items:start;border:1px solid var(--rline);border-radius:11px;background:#12161a;padding:11px 13px}
      .inv-wk .wk{font-family:var(--font-mono,monospace);font-size:11px;color:var(--raccent2);font-weight:800}
      .inv-wk h4{margin:0 0 3px;font-size:12.5px}
      .inv-wk p{margin:0;color:#8f99a4;font-size:11px;line-height:1.45}
      .inv-reg{width:100%;border-collapse:collapse}
      .inv-reg td{padding:9px 8px;border-bottom:1px solid #222930;font-size:12px;color:#d5dbe1}
      .inv-reg .st{white-space:nowrap;text-align:right}
      .inv-scroll{overflow:auto}
      .inv-table{width:100%;border-collapse:collapse;min-width:620px}
      .inv-table th,.inv-table td{padding:9px 8px;border-bottom:1px solid #222930;text-align:left;font-size:11px;white-space:nowrap}
      .inv-table th{color:#89949f;text-transform:uppercase;letter-spacing:.06em;font-size:9px}
      .inv-table td{color:#d5dbe1}
      .inv-table .num{text-align:right;font-family:var(--font-mono,monospace)}
      .inv-empty{color:#9aa4ae;font-size:22px;padding:16px 4px}
      .inv-quality-list{margin-top:10px;color:#c9d0d8;font-size:11px;line-height:1.6}
    </style>`;
    const tabsNav = `<div class="r-tabs">${TABS.map(([k, lbl]) =>
      `<a class="r-tab${k === tab ? ' active' : ''}" href="/coyote/inventory?tab=${k}">${esc(lbl)}</a>`).join('')}</div>`;

    const noData = () => `<div class="inv-empty">${DASH}</div>`;
    const dashKpi = (label, sub) => `<div class="r-card r-kpi"><div class="r-kpi-label">${esc(label)}</div><div class="r-kpi-value">—</div><div class="r-kpi-sub">${esc(sub)}</div></div>`;
    const valueKpi = (label, value, sub) => S.rcc.kpi({ label, value: value == null ? DASH : value, sub });
    const fmtStamp = (v) => {
      const n = num(v);
      return n == null ? DASH : new Date(n).toISOString().slice(0, 16).replace('T', ' ');
    };

    // ============================ EXECUTIVE ============================
    const renderExecutive = () => {
      const r = m.readiness || {};
      const e = m.executive || {};
      const fullDate = e.latestFull && e.latestFull.business_date ? String(e.latestFull.business_date) : null;
      const age = num(e.lastFullDaysAgo);
      const kpis = [
        valueKpi('Counted stock value', formatPounds(e.countedStockPence), fullDate ? `latest closed full count · ${fullDate}` : 'no closed full count'),
        valueKpi('Usage', formatPounds(e.usagePence), e.usageDateCount > 0 ? `${int(e.usageDateCount)} most recent settled business date${e.usageDateCount === 1 ? '' : 's'}` : 'no settled usage days'),
        valueKpi('Last full count', fullDate, fullDate && age != null ? `${int(age)} calendar day${age === 1 ? '' : 's'} ago` : 'no closed full count'),
        dashKpi('Actual vs theoretical gap', 'needs counts (process) + recipes (Calum gate)'),
        valueKpi('Recorded waste', formatPounds(e.wastePence), `${e.wasteFrom || DASH} to ${e.wasteTo || DASH} inclusive`),
        dashKpi('Stockout events', 'no stock levels tracked — enable inventory'),
      ].join('');
      const queue = [
        S.rcc.alert({ title: (r.counts && r.counts.ready) ? 'Stock counts are on record' : 'No stock count yet', text: (r.counts && r.counts.ready) ? r.counts.detail : 'run the first full count to establish physical stock value and a dated baseline.', tone: (r.counts && r.counts.ready) ? 'good' : 'bad' }),
        S.rcc.alert({ title: (r.waste && r.waste.ready) ? 'Waste logging is live' : 'Waste logging has not started', text: (r.waste && r.waste.ready) ? r.waste.detail : 'record waste at source with an item, quantity and reason.', tone: (r.waste && r.waste.ready) ? 'good' : 'warn' }),
        S.rcc.alert({ title: 'The operations-scope grant is shared', text: 'the same Lightspeed grant that unblocks account-profiles unblocks the inventory API — chasing it advances two modules at once.', tone: 'info' }),
      ].join('');
      return `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="rv2-caption" style="margin-bottom:12px">count value uses the latest closed full count; usage uses the seven most recent settled business dates; waste uses today’s inclusive seven-day window. Missing results remain —.</div>
        <div class="inv-two">
          ${gatePanel('13-week inventory control trend', 'stock value + variance over time', 'process', 'a weekly stock count — the trend needs a count history to plot')}
          ${S.rcc.panel({ title: 'Owner attention queue', sub: 'what to do next — real adoption steps, not invented findings', body: `<div class="r-alert-list">${queue}</div>` })}
        </div>
        <div class="inv-two">
          ${gatePanel('Stock value by ownership', 'physical inventory, not weekly purchases', 'process', 'a stock count (own vs consignment/shared packaging split)')}
          ${gatePanel('Department scorecards', 'Kitchen / FOH accountability on the same control framework', 'process', 'department-tagged counts + waste — see the Kitchen / FOH tabs')}
        </div>
        ${gatePanel('Core controls', 'items below par · dead stock · open POs · stock turns', 'process', 'counts + par levels + PO entry — the daily inventory workflow')}`;
    };

    // ============================ FORECAST & AVAILABILITY ============================
    const renderForecast = () => `
      ${gatePanel('Interactive requirement forecast', 'next-week order requirement (recipe-led)', 'recipe', 'recipe costs + a current stock count — requirement = forecast usage − usable stock')}
      <div class="inv-two">
        ${gatePanel('Availability risk', 'items that run out before the weekend', 'process', 'current stock levels + par — no stock tracked, no risk computable')}
        ${gatePanel('Dynamic par recommendations', 'reorder points from usage', 'recipe', 'usage history (recipes × sales) + counts to set a safety floor')}
      </div>
      ${gatePanel('Forecast inputs', 'the revenue projection feeds usage; recipes convert it to ingredients', 'recipe', 'recipe_lines to convert projected covers into ingredient demand (Revenue → Forecast already provides the projection)')}`;

    // ============================ COUNTS & VARIANCE ============================
    const renderCounts = () => {
      const c = m.counts || { lastCounts: [], latestClosed: null, adjustments: [], quality: {} };
      const lastRows = (c.lastCounts || []).map((row) => `<tr>
        <td>${esc(row.id || DASH)}</td><td>${esc(row.business_date || DASH)}</td><td>${esc(row.kind || DASH)}</td><td>${esc(row.status || DASH)}</td>
        <td>${esc(row.opened_by || DASH)}</td><td>${esc(fmtStamp(row.opened_at))}</td><td>${esc(row.closed_by || DASH)}</td><td>${esc(fmtStamp(row.closed_at))}</td>
        <td>${esc(row.settled_through || DASH)}</td><td>${esc(row.note || DASH)}</td></tr>`).join('');
      const lastPanel = S.rcc.panel({ title: 'Last counts', sub: 'latest 10 · business date, then closure time',
        body: lastRows ? `<div class="inv-scroll"><table class="inv-table"><thead><tr><th>Count</th><th>Business date</th><th>Kind</th><th>Status</th><th>Opened by</th><th>Opened</th><th>Closed by</th><th>Closed</th><th>Settled through</th><th>Note</th></tr></thead><tbody>${lastRows}</tbody></table></div>` : noData() });
      const discrepancyPanel = c.latestClosed
        ? S.rcc.panel({ title: 'Top discrepancies', sub: 'largest count-vs-book gaps', headRight: S.rcc.tag(String(c.latestClosed.business_date || ''), 'info'),
          body: (c.adjustments || []).length ? `<div class="inv-scroll"><table class="inv-table"><thead><tr><th>Ingredient</th><th>Location</th><th class="num">Quantity</th><th class="num">Value</th></tr></thead><tbody>${c.adjustments.map((row) => `<tr><td>${esc(row.name || row.ingredient_id || DASH)}</td><td>${esc(row.location || DASH)}</td><td class="num">${esc(formatSignedQuantity(row.qty, row.unit_of_measure))}</td><td class="num">${esc(formatPounds(row.value_pence, true))}</td></tr>`).join('')}</tbody></table></div>` : noData() })
        : gatePanel('Top discrepancies', 'largest count-vs-book gaps', 'process', 'a completed stock count — no count, no discrepancy');
      const quality = c.quality || {};
      const qualityPanel = c.latestClosed
        ? S.rcc.panel({ title: 'Count quality gate', sub: 'count completion + accuracy', headRight: S.rcc.tag(String(c.latestClosed.business_date || ''), 'info'),
          body: quality.missingCount == null ? noData() : `<div class="r-driver"><small>Active item-locations not counted</small><strong>${esc(int(quality.missingCount))}</strong><p>${esc(int(quality.activeCount || 0))} active count setting${quality.activeCount === 1 ? '' : 's'}</p></div>${quality.names && quality.names.length ? `<div class="inv-quality-list"><b>Missing:</b> ${quality.names.map(esc).join(' · ')}</div>` : ''}` })
        : gatePanel('Count quality gate', 'count completion + accuracy', 'process', 'the counting cadence — the gate grades counts that do not exist yet');
      return `${lastPanel}
        ${discrepancyPanel}
        <div class="inv-two">
          ${qualityPanel}
          ${gatePanel('Movement reconciliation', 'purchases − usage − waste = closing', 'scope', 'the inventory movements API (scope-gated) OR counts + waste + recipe usage')}
        </div>
        ${gatePanel('Variance decision logic', 'the rules that turn a variance into an action', 'recipe', 'theoretical usage (recipes) to compare actual counts against')}`;
    };

    // ============================ KITCHEN / FOH (mirror) ============================
    const deptTab = (dept, other) => `
      ${gatePanel(`${dept} category control`, 'stock position by category', 'process', `${dept.toLowerCase()}-tagged stock counts`)}
      <div class="inv-two">
        ${gatePanel(`${dept} manager actions`, 'the shortlist for the section head', 'process', 'counts + waste to rank by control risk')}
        ${gatePanel(`${dept} risk matrix`, 'value × volatility', 'recipe', 'usage (recipes × sales) + counts to place items')}
      </div>
      ${gatePanel(`${dept} operating cadence`, 'the count/waste/order rhythm for the section', 'process', `the ${dept.toLowerCase()} adoption cadence — see Data Quality & Plan`)}`;

    // ============================ PURCHASING ============================
    const renderPurchasing = () => `
      ${S.rcc.panel({ title: 'Supplier and purchase performance', sub: 'spend + delivery reliability', headRight: S.rcc.tag('partial — spend on Costs', 'info'),
        body: S.rcc.emptyState({ title: 'Supplier performance', blocker: 'supplier SPEND is already live on the Costs → Suppliers tab (from bank purchases). The DELIVERY/reliability axis (on-time, fill rate, shorts) needs POs raised in-system — which are not.', unlock: 'raise purchase orders in Lightspeed (or the invoice-line ingest)' }) })}
      <div class="inv-two">
        ${gatePanel('Purchase-to-delivery workflow', 'PO → receipt → discrepancy', 'process', 'PO discipline in-system — the venue pays direct from bank, no PO ledger')}
        ${gatePanel('Ingredient price-change watch', 'unit-cost movement per ingredient', 'invoice', 'the supplier invoice-line ingest (the Costs named build)')}
      </div>
      ${gatePanel('Delivery exceptions', 'shorts / substitutions / over-charges', 'process', 'receiving discipline (checking deliveries against POs in-system)')}`;

    // ============================ WASTE & PRODUCTION ============================
    const renderWaste = () => {
      const w = m.waste || { from: null, to: null, byReason: [], topIngredients: [] };
      const reasonRows = (w.byReason || []).map((row) => `<tr><td>${esc(row.reason || DASH)}</td><td class="num">${esc(int(row.event_count || 0))}</td><td class="num">${esc(formatPounds((num(row.costed_movement_count) || 0) > 0 ? row.value_pence : null))}</td></tr>`).join('');
      const itemRows = (w.topIngredients || []).map((row) => `<tr><td>${esc(row.name || row.ingredient_id || DASH)}</td><td class="num">${esc(`${num(row.qty) == null ? DASH : Math.abs(num(row.qty)).toFixed(3).replace(/\.?0+$/, '')} ${row.unit_of_measure || ''}`.trim())}</td><td class="num">${esc(int(row.event_count || 0))}</td><td class="num">${esc(formatPounds((num(row.costed_movement_count) || 0) > 0 ? row.value_pence : null))}</td></tr>`).join('');
      const period = w.from && w.to ? `${w.from} to ${w.to} inclusive` : 'today through 27 days prior';
      return `<div class="inv-two">
        ${S.rcc.panel({ title: 'Waste by reason', sub: period, body: reasonRows ? `<div class="inv-scroll"><table class="inv-table"><thead><tr><th>Reason</th><th class="num">Events</th><th class="num">Value</th></tr></thead><tbody>${reasonRows}</tbody></table></div>` : noData() })}
        ${S.rcc.panel({ title: 'Top wasted items', sub: `ranked by £ lost · ${period}`, body: itemRows ? `<div class="inv-scroll"><table class="inv-table"><thead><tr><th>Ingredient</th><th class="num">Quantity</th><th class="num">Events</th><th class="num">Value</th></tr></thead><tbody>${itemRows}</tbody></table></div>` : noData() })}
      </div>
      ${S.rcc.panel({ title: 'Required waste fields', sub: 'the minimum a waste log must capture', headRight: S.rcc.tag('adoption spec', 'info'),
        body: `<div class="r-mini-note">when waste logging starts, each event needs: item · quantity · reason (spoilage / prep-loss / over-production / customer-error / breakage) · daypart · who. That is the schema this panel fills — it is an adoption SPEC, not a live table.</div>` })}
      <div class="inv-two">
        ${gatePanel('Batch yield performance', 'recorded yield vs recipe yield', 'recipe', 'batch recipes with expected yields + posted production')}
        ${gatePanel('Production controls', 'batch posting discipline', 'process', 'posting production batches as they are made')}
      </div>`;
    };

    // ============================ DATA QUALITY & PLAN (the live heart) ============================
    const renderPlan = () => {
      const r = m.readiness || {};
      const st = (dim) => {
        const d = r[dim.key];
        if (!d) return S.rcc.tag('unknown', '');
        if (d.ready) return S.rcc.tag(dim.key === 'recipes' && d.pct != null ? `${d.pct.toFixed(0)}% — in progress` : 'ready', 'good');
        return S.rcc.tag('not started', 'bad');
      };
      const regRows = READINESS_DIMS.map((dim) => {
        const d = (r[dim.key]) || {};
        return `<tr><td><b>${esc(dim.label)}</b><div class="ash" style="font-size:10.5px">${esc(d.detail || '')}</div></td><td class="ash">${esc(dim.how)}</td><td class="st">${st(dim)}</td></tr>`;
      }).join('');
      const readyN = READINESS_DIMS.filter((dim) => (r[dim.key] || {}).ready).length;
      const regPanel = S.rcc.panel({ title: 'Data-quality register', sub: `${readyN} of ${READINESS_DIMS.length} readiness dimensions started — probed live, never illustrative`,
        body: `<table class="inv-reg"><tbody>${regRows}</tbody></table>
          <div class="r-mini-note">count and waste readiness come directly from the local inventory engine tables; the remaining dimensions retain their existing adoption gates.</div>` });
      const planPanel = S.rcc.panel({ title: 'Implementation plan', sub: 'the adoption sequence — what to start, in order, to light the module',
        body: `<div class="inv-plan">${ADOPTION_PLAN.map((w) => `<div class="inv-wk"><div class="wk">${esc(w.wk)}</div><div><h4>${esc(w.t)}</h4><p>${esc(w.d)}</p></div></div>`).join('')}</div>` });
      const locPanel = gatePanel('Recommended stock locations', 'where counts are taken', 'process', 'a location list (walk-in / dry store / bar / prep) — defined when counting starts');
      const oversightPanel = S.rcc.panel({ title: 'Oversight rules', sub: 'the control framework once data flows',
        body: `<div class="r-formula">${['A variance is only actionable against a theoretical (recipe) baseline — never a raw count alone.',
          'People appear as rota-structural facts only — no per-person waste scoring (the surveillance boundary).',
          'Stock value is physical inventory, never weekly purchases (that is Costs).',
          'Every figure carries its source + as-of count date; a stale count is stated, never bridged.'].map(esc).join('<br>')}</div>` });
      return `<div class="inv-two">${regPanel}${planPanel}</div><div class="inv-two">${locPanel}${oversightPanel}</div>`;
    };

    const tabBody = tab === 'forecast' ? renderForecast()
      : tab === 'counts' ? renderCounts()
      : tab === 'kitchen' ? deptTab('Kitchen', 'FOH')
      : tab === 'foh' ? deptTab('FOH & bar', 'Kitchen')
      : tab === 'purchasing' ? renderPurchasing()
      : tab === 'waste' ? renderWaste()
      : tab === 'plan' ? renderPlan()
      : renderExecutive();

    const body = `<div class="rcc"><style>${S.rcc.css()}</style>${styles}${tabsNav}${tabBody}</div>`;
    return { stamp: 'inventory engine · counts, usage and waste · unavailable feeds remain gated', body };
  },
};
