'use strict';
// INVENTORY CENTRE (Reports section) — built as a BUILD-AHEAD-AS-A-TARGET scaffold (operator ruling
// 2026-07-22, after the Stage-1 probe returned LIVE-NOW = 0). The probe verdict is binding and the
// design honours it: this venue does not run Lightspeed inventory (the ops-scope API is 403, and
// qb_bills is dead / suppliers paid direct-from-bank — no PO or count discipline), so NOTHING here
// has a live physical-stock source today. Every panel is therefore a DESIGNED EMPTY-STATE that names
// the EXACT adoption step it needs — the module is the scaffold that pulls the counting process into
// being: the operator sees precisely what starting to count/log/PO would light up. NO mock numbers
// ever render. The one genuinely-live surface is the Data Quality & Plan tab: a readiness register
// (real 0-of-everything) + the adoption plan. Contract: { key, route, workspace, title, sub,
// getSection, render }. SELECT-only via ctx.q. Design canon = S.rcc (the RCC tokens/components).
const S = require('../../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

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
    const m = { now, tab, readiness: null };
    if (typeof q !== 'function') return m;

    // THE READINESS PROBE (live, real 0-of-everything). Inventory tables do not exist in the
    // librarian (the ops-scope ingest has never run), so every physical dimension reads absent.
    // Recipe coverage IS live (the recipes worklist wires) — the one dimension that can advance
    // before the count process starts.
    const rl = (rowsOf(q(`SELECT COUNT(*) c FROM recipe_lines`))[0] || {}).c || 0;
    const products = (rowsOf(q(`SELECT COUNT(*) c FROM products`))[0] || {}).c || 0;
    const costed = rowsOf(q(
      `SELECT COUNT(*) c FROM products p
        WHERE (SELECT COUNT(*) FROM recipe_lines rl WHERE rl.product_id = p.id) > 0
          AND (SELECT COUNT(*) FROM recipe_lines rl JOIN sub_items si ON si.id = rl.sub_item_id
                 WHERE rl.product_id = p.id AND (si.pack_cost_pence IS NULL OR si.pack_qty IS NULL)) = 0`))[0];
    const costedN = costed ? (num(costed.c) || 0) : 0;
    m.readiness = {
      // physical dimensions: no store exists → 'none on record' (honest — not zero-as-data, absent)
      scope: { ready: false, detail: 'operations scope not granted (403); grant pending' },
      items: { ready: false, detail: 'no stock-item store — inventory not enabled in Lightspeed' },
      counts: { ready: false, count: 0, detail: 'no counts on record — the counting process has not started' },
      waste: { ready: false, count: 0, detail: 'no waste events logged' },
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

    // A KPI tile that can ONLY read '—' (no live physical source) with an honest gate sub.
    const dashKpi = (label, sub) => `<div class="r-card r-kpi"><div class="r-kpi-label">${esc(label)}</div><div class="r-kpi-value">—</div><div class="r-kpi-sub">${esc(sub)}</div></div>`;

    // ============================ EXECUTIVE ============================
    const renderExecutive = () => {
      const r = m.readiness || {};
      const kpis = [
        dashKpi('Current stock value', 'no count on record — start the counting process'),
        dashKpi('Stock holding (days)', 'needs stock value ÷ usage — both process-gated'),
        dashKpi('Count accuracy', 'no counts to grade — run the first count'),
        dashKpi('Actual vs theoretical gap', 'needs counts (process) + recipes (Calum gate)'),
        dashKpi('Recorded waste', 'no waste events logged — start waste logging'),
        dashKpi('Stockout events', 'no stock levels tracked — enable inventory'),
      ].join('');
      // the attention queue = REAL adoption items (the honest "what to do next"), not invented findings
      const queue = [
        S.rcc.alert({ title: 'Inventory has no live source yet', text: 'the Lightspeed inventory API is scope-gated (403) and no counting process is running — every panel below names the adoption step it needs. Start with the plan.', tone: 'bad' }),
        S.rcc.alert({ title: 'Recipe costing is the one advanceable gate', text: (r.recipes && r.recipes.count > 0) ? `${r.recipes.detail} — keep going` : 'cost the top-20 recipes (59.5% coverage, one session) to unlock the theoretical side ahead of the count feed.', tone: (r.recipes && r.recipes.count > 0) ? 'good' : 'warn', impact: 'Recipes →' }),
        S.rcc.alert({ title: 'The operations-scope grant is shared', text: 'the same Lightspeed grant that unblocks account-profiles unblocks the inventory API — chasing it advances two modules at once.', tone: 'info' }),
      ].join('');
      return `<div class="r-grid r-kpi-grid">${kpis}</div>
        <div class="rv2-caption" style="margin-bottom:12px">every value is — by design: the Stage-1 probe returned LIVE-NOW = 0. These light up as the adoption plan (Data Quality & Plan tab) is worked.</div>
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
    const renderCounts = () => `
      ${gatePanel('Top discrepancies', 'largest count-vs-book gaps', 'process', 'a completed stock count — no count, no discrepancy')}
      <div class="inv-two">
        ${gatePanel('Count quality gate', 'count completion + accuracy', 'process', 'the counting cadence — the gate grades counts that do not exist yet')}
        ${gatePanel('Movement reconciliation', 'purchases − usage − waste = closing', 'scope', 'the inventory movements API (scope-gated) OR counts + waste + recipe usage')}
      </div>
      ${gatePanel('Variance decision logic', 'the rules that turn a variance into an action', 'recipe', 'theoretical usage (recipes) to compare actual counts against')}`;

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
    const renderWaste = () => `
      <div class="inv-two">
        ${gatePanel('Waste by reason', 'spoilage / prep / over-production / error', 'process', 'waste logging at source with a reason — the single feed for this panel')}
        ${gatePanel('Top wasted items', 'ranked by £ lost', 'process', 'waste events + recipe costs to value them')}
      </div>
      ${S.rcc.panel({ title: 'Required waste fields', sub: 'the minimum a waste log must capture', headRight: S.rcc.tag('adoption spec', 'info'),
        body: `<div class="r-mini-note">when waste logging starts, each event needs: item · quantity · reason (spoilage / prep-loss / over-production / customer-error / breakage) · daypart · who. That is the schema this panel fills — it is an adoption SPEC, not a live table.</div>` })}
      <div class="inv-two">
        ${gatePanel('Batch yield performance', 'recorded yield vs recipe yield', 'recipe', 'batch recipes with expected yields + posted production')}
        ${gatePanel('Production controls', 'batch posting discipline', 'process', 'posting production batches as they are made')}
      </div>`;

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
          <div class="r-mini-note">this is the ONLY live surface in the module today: physical dimensions read “not started” because no counting process is running and the inventory API is scope-gated; recipe coverage advances via <a href="/coyote/recipes" style="color:${S.rcc.tokens.blue}">Recipes</a>.</div>` });
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
    return { stamp: 'build-ahead scaffold · no live stock source — adoption plan on the Data Quality & Plan tab', body };
  },
};
