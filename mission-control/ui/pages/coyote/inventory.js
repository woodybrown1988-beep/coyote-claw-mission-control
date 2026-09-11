'use strict';
// INVENTORY CENTRE (Reports section) — built as a BUILD-AHEAD-AS-A-TARGET scaffold (operator ruling
// 2026-07-22, after the Stage-1 probe returned LIVE-NOW = 0). Counts and waste can now graduate from
// that scaffold when their local stores contain records; the Lightspeed scope, PO, production,
// stockout and forecasting gates remain exactly as designed. No fallback number is ever invented:
// every live value is read through ctx.q and every unavailable value remains an honest dash/gate.
// Contract: { key, route, workspace, title, sub, getSection, render }. SELECT-only via ctx.q.
// Design canon = S.rcc (the RCC tokens/components).
const S = require('../../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function intOrZero(v) { const n = num(v); return n == null ? 0 : Math.trunc(n); }

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
  sub: 'Inventory command centre · BUILD-AHEAD scaffold — no live stock source yet; each panel names the adoption step that lights it',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    const tabKeys = ['executive', 'forecast', 'counts', 'kitchen', 'foh', 'purchasing', 'waste', 'plan'];
    const query = (ctx && ctx.query) || {};
    const tab = tabKeys.includes(String(query.tab || '')) ? String(query.tab) : 'executive';
    const m = {
      now, tab, counts: [], adjustments: [], countQuality: null,
      waste: { byReason: [], byIngredient: [] }, executive: null, readiness: null,
    };
    if (typeof q !== 'function') return m;

    // Latest ten counts. Movement values are derived from each count's own adjustment rows; item
    // labels and units remain owned by the sub_items catalogue rather than copied into this store.
    m.counts = rowsOf(q(
      `SELECT c.id, c.count_type, c.status, c.started_at, c.closed_at, c.settled_through,
              c.counted_by,
              SUM(CASE WHEN im.movement_type = 'count_adjustment' THEN 1 ELSE 0 END) adjustment_count,
              COUNT(CASE WHEN im.movement_type = 'count_adjustment' THEN im.unit_cost_pence END) costed_count,
              ROUND(SUM(CASE WHEN im.movement_type = 'count_adjustment'
                             THEN im.balance_after * im.unit_cost_pence END)) stock_value_pence,
              ROUND(SUM(CASE WHEN im.movement_type = 'count_adjustment'
                             THEN im.quantity * im.unit_cost_pence END)) discrepancy_pence
         FROM inventory_counts c
         LEFT JOIN inventory_movements im ON im.count_id = c.id
        GROUP BY c.id, c.count_type, c.status, c.started_at, c.closed_at,
                 c.settled_through, c.counted_by
        ORDER BY COALESCE(c.closed_at, c.started_at) DESC, c.id DESC
        LIMIT 10`)).map((r) => ({
      id: String(r.id || ''), type: String(r.count_type || ''), status: String(r.status || ''),
      startedAt: num(r.started_at), closedAt: num(r.closed_at), settledThrough: num(r.settled_through),
      countedBy: r.counted_by == null ? '' : String(r.counted_by),
      adjustmentCount: intOrZero(r.adjustment_count), costedCount: intOrZero(r.costed_count),
      stockValuePence: num(r.stock_value_pence), discrepancyPence: num(r.discrepancy_pence),
    }));

    // The discrepancy report belongs to the newest CLOSED count of any type. Signed quantities and
    // signed values deliberately pass through unchanged; ABS is ordering only.
    m.adjustments = rowsOf(q(
      `SELECT im.id, im.count_id, im.sub_item_id, si.name ingredient, si.unit_of_measure unit,
              im.balance_after counted_quantity,
              im.balance_after - im.quantity theoretical_quantity,
              im.quantity discrepancy_quantity,
              CASE WHEN im.unit_cost_pence IS NULL THEN NULL
                   ELSE ROUND(im.quantity * im.unit_cost_pence) END discrepancy_pence
         FROM inventory_movements im
         JOIN (SELECT id FROM inventory_counts
                WHERE LOWER(status) = 'closed'
                ORDER BY COALESCE(closed_at, started_at) DESC, id DESC LIMIT 1) lc
           ON lc.id = im.count_id
         JOIN sub_items si ON si.id = im.sub_item_id
        WHERE im.movement_type = 'count_adjustment'
        ORDER BY ABS(COALESCE(im.quantity * im.unit_cost_pence, 0)) DESC,
                 LOWER(si.name), im.id`)).map((r) => ({
      id: String(r.id || ''), countId: String(r.count_id || ''), subItemId: String(r.sub_item_id || ''),
      ingredient: String(r.ingredient || ''), unit: r.unit == null ? '' : String(r.unit),
      countedQuantity: num(r.counted_quantity), theoreticalQuantity: num(r.theoretical_quantity),
      discrepancyQuantity: num(r.discrepancy_quantity), discrepancyPence: num(r.discrepancy_pence),
    }));

    // The aggregate below always returns one row when a closed count exists, including a fully
    // complete count with zero omissions. The nested LIMIT caps the displayed catalogue name list
    // without losing the exact missing total.
    const missing = rowsOf(q(
      `SELECT lc.id count_id,
              (SELECT COUNT(*)
                 FROM inventory_count_settings cs
                 JOIN sub_items si ON si.id = cs.sub_item_id
                 LEFT JOIN inventory_movements im
                   ON im.count_id = lc.id AND im.sub_item_id = cs.sub_item_id
                  AND im.movement_type = 'count_adjustment'
                WHERE cs.active = 1 AND im.id IS NULL) missing_count,
              (SELECT GROUP_CONCAT(name, ' · ')
                 FROM (SELECT si.name name
                         FROM inventory_count_settings cs
                         JOIN sub_items si ON si.id = cs.sub_item_id
                         LEFT JOIN inventory_movements im
                           ON im.count_id = lc.id AND im.sub_item_id = cs.sub_item_id
                          AND im.movement_type = 'count_adjustment'
                        WHERE cs.active = 1 AND im.id IS NULL
                        ORDER BY LOWER(si.name), si.id LIMIT 5)) missing_names
         FROM (SELECT id FROM inventory_counts
                WHERE LOWER(status) = 'closed'
                ORDER BY COALESCE(closed_at, started_at) DESC, id DESC LIMIT 1) lc`))[0];
    if (missing) {
      m.countQuality = {
        countId: String(missing.count_id || ''), missingCount: intOrZero(missing.missing_count),
        missingNames: missing.missing_names == null ? [] : String(missing.missing_names).split(' · '),
      };
    }

    // Last-28-day non-voided waste, twice: first at reason grain, then at catalogue ingredient
    // grain. A waste value is a positive control cost even though its movement quantity is signed.
    const wasteStart = now - (28 * 86400000);
    m.waste.byReason = rowsOf(q(
      `SELECT we.reason, COUNT(DISTINCT we.id) event_count, COUNT(im.id) movement_count,
              COUNT(im.unit_cost_pence) costed_count,
              ROUND(SUM(ABS(im.quantity * im.unit_cost_pence))) waste_pence
         FROM inventory_waste_events we
         JOIN inventory_movements im
           ON im.waste_event_id = we.id AND im.movement_type = 'waste'
        WHERE COALESCE(LOWER(we.status), '') <> 'voided'
          AND we.occurred_at >= ? AND we.occurred_at <= ?
        GROUP BY we.reason
        ORDER BY waste_pence DESC, LOWER(we.reason)`, [wasteStart, now])).map((r) => ({
      reason: String(r.reason || ''), eventCount: intOrZero(r.event_count),
      movementCount: intOrZero(r.movement_count), costedCount: intOrZero(r.costed_count),
      wastePence: num(r.waste_pence),
    }));
    m.waste.byIngredient = rowsOf(q(
      `SELECT im.sub_item_id, si.name ingredient, si.unit_of_measure unit,
              COUNT(DISTINCT we.id) event_count, COUNT(im.id) movement_count,
              COUNT(im.unit_cost_pence) costed_count,
              SUM(ABS(im.quantity)) waste_quantity,
              ROUND(SUM(ABS(im.quantity * im.unit_cost_pence))) waste_pence
         FROM inventory_waste_events we
         JOIN inventory_movements im
           ON im.waste_event_id = we.id AND im.movement_type = 'waste'
         JOIN sub_items si ON si.id = im.sub_item_id
        WHERE COALESCE(LOWER(we.status), '') <> 'voided'
          AND we.occurred_at >= ? AND we.occurred_at <= ?
        GROUP BY im.sub_item_id, si.name, si.unit_of_measure
        ORDER BY waste_pence DESC, LOWER(si.name), im.sub_item_id`, [wasteStart, now])).map((r) => ({
      subItemId: String(r.sub_item_id || ''), ingredient: String(r.ingredient || ''),
      unit: r.unit == null ? '' : String(r.unit), eventCount: intOrZero(r.event_count),
      movementCount: intOrZero(r.movement_count), costedCount: intOrZero(r.costed_count),
      wasteQuantity: num(r.waste_quantity), wastePence: num(r.waste_pence),
    }));

    // Stock position and accuracy use the latest CLOSED FULL count. Usage deliberately has a
    // different anchor: the settlement boundary of the latest closed count (including a later
    // flash count), so movements posted after that boundary cannot leak into "last 7 settled days".
    const full = rowsOf(q(
      `SELECT c.id count_id, c.closed_at, c.settled_through,
              COUNT(im.id) movement_count, COUNT(im.unit_cost_pence) costed_count,
              ROUND(SUM(im.balance_after * im.unit_cost_pence)) stock_value_pence,
              ROUND(SUM((im.balance_after - im.quantity) * im.unit_cost_pence)) theoretical_value_pence,
              ROUND(SUM(ABS(im.quantity * im.unit_cost_pence))) absolute_discrepancy_pence,
              ROUND(SUM(im.quantity * im.unit_cost_pence)) discrepancy_pence
         FROM (SELECT id, closed_at, settled_through FROM inventory_counts
                WHERE LOWER(status) = 'closed' AND LOWER(count_type) = 'full'
                ORDER BY COALESCE(closed_at, started_at) DESC, id DESC LIMIT 1) c
         LEFT JOIN inventory_movements im
           ON im.count_id = c.id AND im.movement_type = 'count_adjustment'
        GROUP BY c.id, c.closed_at, c.settled_through`))[0] || null;
    const usage = rowsOf(q(
      `SELECT c.id count_id, c.settled_through,
              COUNT(im.id) movement_count, COUNT(im.unit_cost_pence) costed_count,
              ROUND(SUM(ABS(im.quantity * im.unit_cost_pence))) usage_pence
         FROM (SELECT id, settled_through FROM inventory_counts
                WHERE LOWER(status) = 'closed' AND settled_through IS NOT NULL
                ORDER BY COALESCE(closed_at, started_at) DESC, id DESC LIMIT 1) c
         LEFT JOIN inventory_movements im
           ON im.movement_type = 'usage'
          AND im.occurred_at > c.settled_through - ? AND im.occurred_at <= c.settled_through
        GROUP BY c.id, c.settled_through`, [7 * 86400000]))[0] || null;
    const wasteMovementCount = m.waste.byReason.reduce((s, r) => s + r.movementCount, 0);
    const wasteCostedCount = m.waste.byReason.reduce((s, r) => s + r.costedCount, 0);
    m.executive = {
      full: full ? {
        countId: String(full.count_id || ''), closedAt: num(full.closed_at),
        settledThrough: num(full.settled_through), movementCount: intOrZero(full.movement_count),
        costedCount: intOrZero(full.costed_count), stockValuePence: num(full.stock_value_pence),
        theoreticalValuePence: num(full.theoretical_value_pence),
        absoluteDiscrepancyPence: num(full.absolute_discrepancy_pence),
        discrepancyPence: num(full.discrepancy_pence),
      } : null,
      usage: usage ? {
        countId: String(usage.count_id || ''), settledThrough: num(usage.settled_through),
        movementCount: intOrZero(usage.movement_count), costedCount: intOrZero(usage.costed_count),
        usagePence: num(usage.usage_pence),
      } : null,
      waste: m.waste.byReason.length ? {
        eventCount: m.waste.byReason.reduce((s, r) => s + r.eventCount, 0),
        movementCount: wasteMovementCount, costedCount: wasteCostedCount,
        wastePence: m.waste.byReason.reduce((s, r) => s + (r.wastePence || 0), 0),
      } : null,
    };

    // Readiness uses row existence, not the ten-row presentation cap. A voided waste event is not
    // evidence that waste logging is live, and therefore never contributes to readiness either.
    const countRows = (rowsOf(q(`SELECT COUNT(*) c FROM inventory_counts`))[0] || {}).c;
    const wasteRows = (rowsOf(q(
      `SELECT COUNT(*) c FROM inventory_waste_events
        WHERE COALESCE(LOWER(status), '') <> 'voided'`))[0] || {}).c;

    // Recipe coverage remains independently live: it can advance before every remaining physical
    // or purchasing gate does.
    const rl = (rowsOf(q(`SELECT COUNT(*) c FROM recipe_lines`))[0] || {}).c || 0;
    const products = (rowsOf(q(`SELECT COUNT(*) c FROM products`))[0] || {}).c || 0;
    const costed = rowsOf(q(
      `SELECT COUNT(*) c FROM products p
        WHERE (SELECT COUNT(*) FROM recipe_lines rl WHERE rl.product_id = p.id) > 0
          AND (SELECT COUNT(*) FROM recipe_lines rl JOIN sub_items si ON si.id = rl.sub_item_id
                 WHERE rl.product_id = p.id AND (si.pack_cost_pence IS NULL OR si.pack_qty IS NULL)) = 0`))[0];
    const costedN = costed ? (num(costed.c) || 0) : 0;
    m.readiness = {
      scope: { ready: false, detail: 'operations scope not granted (403); grant pending' },
      items: { ready: false, detail: 'no stock-item store — inventory not enabled in Lightspeed' },
      counts: intOrZero(countRows) > 0
        ? { ready: true, count: intOrZero(countRows), detail: `${intOrZero(countRows)} count${intOrZero(countRows) === 1 ? '' : 's'} on record` }
        : { ready: false, count: 0, detail: 'no counts on record — the counting process has not started' },
      waste: intOrZero(wasteRows) > 0
        ? { ready: true, count: intOrZero(wasteRows), detail: `${intOrZero(wasteRows)} waste event${intOrZero(wasteRows) === 1 ? '' : 's'} logged` }
        : { ready: false, count: 0, detail: 'no waste events logged' },
      pos: { ready: false, count: 0, detail: 'no purchase orders in-system (paid direct from bank)' },
      recipes: { ready: rl > 0, count: rl, products, costed: costedN, pct: products > 0 ? (costedN / products) * 100 : null,
        detail: rl > 0 ? `${costedN}/${products} products costed` : `0 of ${products} products costed — the Calum gate` },
    };
    return m;
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const int = S.fmtInt;
    const gbp = (pence) => S.fmtGbpPence(Math.round(Number(pence)));
    const signedGbp = (pence) => {
      const n = num(pence);
      if (n == null) return '—';
      return `${n < 0 ? '−' : n > 0 ? '+' : ''}${gbp(Math.abs(n))}`;
    };
    const qty = (value) => {
      const n = num(value);
      return n == null ? '—' : n.toLocaleString('en-GB', { maximumFractionDigits: 3 });
    };
    const signedQty = (value) => {
      const n = num(value);
      if (n == null) return '—';
      return `${n < 0 ? '−' : n > 0 ? '+' : ''}${qty(Math.abs(n))}`;
    };
    const unitQty = (value, unit, signed) => `${signed ? signedQty(value) : qty(value)}${unit ? ` ${unit}` : ''}`;
    const time = (value) => num(value) == null ? '—' : S.fmtTime(Number(value));
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
    </style>`;
    const tabsNav = `<div class="r-tabs">${TABS.map(([k, lbl]) =>
      `<a class="r-tab${k === tab ? ' active' : ''}" href="/coyote/inventory?tab=${k}">${esc(lbl)}</a>`).join('')}</div>`;

    // KPI markup remains byte-identical to the scaffold; only a genuinely sourced value changes it.
    const dashKpi = (label, sub) => `<div class="r-card r-kpi"><div class="r-kpi-label">${esc(label)}</div><div class="r-kpi-value">—</div><div class="r-kpi-sub">${esc(sub)}</div></div>`;
    const valueKpi = (label, value, sub) => `<div class="r-card r-kpi"><div class="r-kpi-label">${esc(label)}</div><div class="r-kpi-value">${esc(value)}</div><div class="r-kpi-sub">${esc(sub)}</div></div>`;

    const countHistoryPanel = () => {
      if (!(m.counts || []).length) {
        return gatePanel('13-week inventory control trend', 'stock value + variance over time', 'process', 'a weekly stock count — the trend needs a count history to plot');
      }
      const rows = m.counts.map((c) => {
        const fullyCosted = c.adjustmentCount > 0 && c.costedCount === c.adjustmentCount;
        return `<tr><td class="mono"><b>${esc(c.id)}</b></td><td>${esc(c.type || '—')}</td><td>${S.rcc.tag(c.status || 'unknown', String(c.status).toLowerCase() === 'closed' ? 'good' : 'warn')}</td><td class="mono">${time(c.closedAt != null ? c.closedAt : c.startedAt)}</td><td class="mono">${time(c.settledThrough)}</td><td>${esc(c.countedBy || '—')}</td><td class="r-num mono">${int(c.adjustmentCount)}</td><td class="r-num mono">${fullyCosted && c.stockValuePence != null ? esc(gbp(c.stockValuePence)) : '—'}</td><td class="r-num mono">${fullyCosted && c.discrepancyPence != null ? esc(signedGbp(c.discrepancyPence)) : '—'}</td></tr>`;
      }).join('');
      return S.rcc.panel({ title: '13-week inventory control trend', sub: 'stock value + variance over time',
        headRight: S.rcc.tag(`latest ${Math.min(10, m.counts.length)}`, 'info'),
        body: `<div style="overflow:auto"><table><thead><tr><th>Count</th><th>Type</th><th>Status</th><th>Closed</th><th>Settled through</th><th>Counted by</th><th class="r-num">Items</th><th class="r-num">Stock value</th><th class="r-num">Discrepancy</th></tr></thead><tbody>${rows}</tbody></table></div>` });
    };

    // ============================ EXECUTIVE ============================
    const renderExecutive = () => {
      const r = m.readiness || {};
      const ex = m.executive || {};
      const full = ex.full || null;
      const usage = ex.usage || null;
      const waste = ex.waste || null;
      const fullCosted = full && full.movementCount > 0 && full.costedCount === full.movementCount;
      const usageCosted = usage && usage.movementCount > 0 && usage.costedCount === usage.movementCount && usage.usagePence > 0;
      const wasteCosted = waste && waste.movementCount > 0 && waste.costedCount === waste.movementCount;
      const fullAge = full && full.closedAt != null ? S.agoLabel(Math.max(0, m.now - full.closedAt)) : null;
      const accuracy = fullCosted && full.theoreticalValuePence > 0 && full.absoluteDiscrepancyPence != null
        ? (1 - (full.absoluteDiscrepancyPence / full.theoreticalValuePence)) * 100 : null;
      const holdingDays = fullCosted && usageCosted && full.stockValuePence != null
        ? full.stockValuePence / (usage.usagePence / 7) : null;
      const kpis = [
        fullCosted && full.stockValuePence != null
          ? valueKpi('Current stock value', gbp(full.stockValuePence), `latest full count ${full.countId}${fullAge ? ` · ${fullAge}` : ''}`)
          : dashKpi('Current stock value', 'no count on record — start the counting process'),
        holdingDays != null
          ? valueKpi('Stock holding (days)', `${holdingDays.toFixed(1)} days`, `${gbp(usage.usagePence)} usage · last 7 settled days`)
          : dashKpi('Stock holding (days)', 'needs stock value ÷ usage — both process-gated'),
        accuracy != null
          ? valueKpi('Count accuracy', `${accuracy.toFixed(1)}%`, `${gbp(full.absoluteDiscrepancyPence)} absolute discrepancy · latest full count`)
          : dashKpi('Count accuracy', 'no counts to grade — run the first count'),
        fullCosted && full.discrepancyPence != null
          ? valueKpi('Actual vs theoretical gap', signedGbp(full.discrepancyPence), 'signed count discrepancy · latest full count')
          : dashKpi('Actual vs theoretical gap', 'needs counts (process) + recipes (Calum gate)'),
        wasteCosted && waste.wastePence != null
          ? valueKpi('Recorded waste', gbp(Math.abs(waste.wastePence)), `${int(waste.eventCount)} non-voided event${waste.eventCount === 1 ? '' : 's'} · last 28 days`)
          : dashKpi('Recorded waste', 'no waste events logged — start waste logging'),
        dashKpi('Stockout events', 'no stock levels tracked — enable inventory'),
      ].join('');
      const inventoryStarted = (m.counts || []).length > 0 || (m.waste && m.waste.byReason.length > 0);
      // the attention queue = REAL adoption items (the honest "what to do next"), not invented findings
      const queue = [
        inventoryStarted
          ? S.rcc.alert({ title: 'Counts and waste records are now live', text: 'the local counting and waste processes are producing records; Lightspeed scope, purchasing, stockouts and production remain gated.', tone: 'info' })
          : S.rcc.alert({ title: 'Inventory has no live source yet', text: 'the Lightspeed inventory API is scope-gated (403) and no counting process is running — every panel below names the adoption step it needs. Start with the plan.', tone: 'bad' }),
        S.rcc.alert({ title: 'Recipe costing is the one advanceable gate', text: (r.recipes && r.recipes.count > 0) ? `${r.recipes.detail} — keep going` : 'cost the top-20 recipes (59.5% coverage, one session) to unlock the theoretical side ahead of the count feed.', tone: (r.recipes && r.recipes.count > 0) ? 'good' : 'warn', impact: 'Recipes →' }),
        S.rcc.alert({ title: 'The operations-scope grant is shared', text: 'the same Lightspeed grant that unblocks account-profiles unblocks the inventory API — chasing it advances two modules at once.', tone: 'info' }),
      ].join('');
      const anyKpiLive = (fullCosted && full.stockValuePence != null) || holdingDays != null || accuracy != null
        || (fullCosted && full.discrepancyPence != null) || (wasteCosted && waste.wastePence != null);
      return `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="rv2-caption" style="margin-bottom:12px">${anyKpiLive ? 'count KPIs use the latest closed full count; usage stops at the latest closed count’s settlement boundary; waste covers non-voided events in the last 28 days. Unavailable sources remain —.' : 'every value is — by design: the Stage-1 probe returned LIVE-NOW = 0. These light up as the adoption plan (Data Quality & Plan tab) is worked.'}</div>
        <div class="inv-two">
          ${countHistoryPanel()}
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
      const adjustments = m.adjustments || [];
      const topPanel = adjustments.length
        ? S.rcc.panel({ title: 'Top discrepancies', sub: 'largest count-vs-book gaps',
          headRight: S.rcc.tag(`count ${adjustments[0].countId}`, 'info'),
          body: `<div style="overflow:auto"><table><thead><tr><th>Ingredient</th><th class="r-num">Theoretical</th><th class="r-num">Counted</th><th class="r-num">Discrepancy qty</th><th class="r-num">Discrepancy £</th></tr></thead><tbody>${adjustments.map((a) => `<tr><td>${esc(a.ingredient)}</td><td class="r-num mono">${esc(unitQty(a.theoreticalQuantity, a.unit, false))}</td><td class="r-num mono">${esc(unitQty(a.countedQuantity, a.unit, false))}</td><td class="r-num mono">${esc(unitQty(a.discrepancyQuantity, a.unit, true))}</td><td class="r-num mono"><b>${esc(signedGbp(a.discrepancyPence))}</b></td></tr>`).join('')}</tbody></table></div>` })
        : gatePanel('Top discrepancies', 'largest count-vs-book gaps', 'process', 'a completed stock count — no count, no discrepancy');
      const quality = m.countQuality;
      let qualityPanel;
      if (!quality) {
        qualityPanel = gatePanel('Count quality gate', 'count completion + accuracy', 'process', 'the counting cadence — the gate grades counts that do not exist yet');
      } else {
        const shown = quality.missingNames.join(' · ');
        const remainder = Math.max(0, quality.missingCount - quality.missingNames.length);
        const detail = quality.missingCount === 0
          ? 'every active count-setting ingredient is present'
          : `${shown}${remainder ? ` · +${remainder} more` : ''}`;
        qualityPanel = S.rcc.panel({ title: 'Count quality gate', sub: 'count completion + accuracy',
          headRight: S.rcc.tag(quality.missingCount === 0 ? 'complete' : `${quality.missingCount} missing`, quality.missingCount === 0 ? 'good' : 'bad'),
          body: `<div class="r-formula"><b>Latest closed count ${esc(quality.countId)}</b><br>Active ingredients absent: ${int(quality.missingCount)}<br>${esc(detail)}</div>` });
      }
      return `
      ${topPanel}
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
      const waste = m.waste || { byReason: [], byIngredient: [] };
      const reasonPanel = waste.byReason.length
        ? S.rcc.panel({ title: 'Waste by reason', sub: 'spoilage / prep / over-production / error',
          headRight: S.rcc.tag('last 28 days', 'info'),
          body: `<div style="overflow:auto"><table><thead><tr><th>Reason</th><th class="r-num">Value</th><th class="r-num">Events</th></tr></thead><tbody>${waste.byReason.map((r) => `<tr><td>${esc(r.reason)}</td><td class="r-num mono">${r.movementCount > 0 && r.costedCount === r.movementCount && r.wastePence != null ? esc(gbp(Math.abs(r.wastePence))) : '—'}</td><td class="r-num mono">${int(r.eventCount)}</td></tr>`).join('')}</tbody></table></div>` })
        : gatePanel('Waste by reason', 'spoilage / prep / over-production / error', 'process', 'waste logging at source with a reason — the single feed for this panel');
      const ingredientPanel = waste.byIngredient.length
        ? S.rcc.panel({ title: 'Top wasted items', sub: 'ranked by £ lost',
          headRight: S.rcc.tag('last 28 days', 'info'),
          body: `<div style="overflow:auto"><table><thead><tr><th>Ingredient</th><th class="r-num">Quantity</th><th class="r-num">Value</th><th class="r-num">Events</th></tr></thead><tbody>${waste.byIngredient.map((r) => `<tr><td>${esc(r.ingredient)}</td><td class="r-num mono">${esc(unitQty(r.wasteQuantity, r.unit, false))}</td><td class="r-num mono">${r.movementCount > 0 && r.costedCount === r.movementCount && r.wastePence != null ? esc(gbp(Math.abs(r.wastePence))) : '—'}</td><td class="r-num mono">${int(r.eventCount)}</td></tr>`).join('')}</tbody></table></div>` })
        : gatePanel('Top wasted items', 'ranked by £ lost', 'process', 'waste events + recipe costs to value them');
      return `
      <div class="inv-two">
        ${reasonPanel}
        ${ingredientPanel}
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
      const inventoryStarted = (r.counts && r.counts.ready) || (r.waste && r.waste.ready);
      const regPanel = S.rcc.panel({ title: 'Data-quality register', sub: `${readyN} of ${READINESS_DIMS.length} readiness dimensions started — probed live, never illustrative`,
        body: `<table class="inv-reg"><tbody>${regRows}</tbody></table>
          <div class="r-mini-note">${inventoryStarted ? `counts and waste advance from row-existence checks; remaining physical dimensions stay gated by their named process/source. Recipe coverage advances via <a href="/coyote/recipes" style="color:${S.rcc.tokens.blue}">Recipes</a>.` : `this is the ONLY live surface in the module today: physical dimensions read “not started” because no counting process is running and the inventory API is scope-gated; recipe coverage advances via <a href="/coyote/recipes" style="color:${S.rcc.tokens.blue}">Recipes</a>.`}</div>` });
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
    const inventoryStarted = (m.readiness && m.readiness.counts && m.readiness.counts.ready)
      || (m.readiness && m.readiness.waste && m.readiness.waste.ready);
    return { stamp: inventoryStarted
      ? 'inventory counts + waste · SELECT-only · remaining gates named in place'
      : 'build-ahead scaffold · no live stock source — adoption plan on the Data Quality & Plan tab', body };
  },
};
