'use strict';
// Recipes & Costs — the BOM editor (Slice 2 foundation). Contract: { key, route, title, sub, getSection, render }.
// TIER 1 (this page) is SELECT-only via ctx.q — it RENDERS the recipe/cost state + computes product cost
// (Σ quantity × exact per-unit cost, rounded only here at display) and coverage. TIER 2 (the edits) go to
// the gated POST /api/recipe-action + /api/recipe-import (server.js) — the ONE operator write path; the
// page itself never writes. NO-FABRICATION: a product only counts as "costed" when it has a complete
// recipe whose every ingredient carries pack cost + qty; uncosted SKUs show as a visible coverage GAP,
// never a made-up cost. Products are the LIVE Lightspeed SKUs (seeded from sales), never typed here.
const S = require('../../shared.js');

function rowsOf(res) { return res && res.ok && Array.isArray(res.rows) ? res.rows : []; }
function num(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
// £ from integer pence, rounded ONLY here (display boundary) — the store keeps exact inputs.
function gbp(pence) { const n = num(pence); return n == null ? '—' : S.fmtGbpPence(Math.round(n)); }
function pct(x) { return x == null ? '—' : `${(x * 100).toFixed(1)}%`; }

module.exports = {
  key: 'recipes', route: '/coyote/recipes', workspace: 'coyote', title: 'Recipes & Costs',
  sub: 'Bill-of-materials · your recipes + ingredient costs → true prime cost',

  getSection(db, ctx) {
    const q = ctx && ctx.q;
    const now = (ctx && ctx.now) || Date.now();
    if (typeof q !== 'function') return { now, subItems: [], products: [], salesWired: false, coverage: null };

    // Ingredients — the per-usable-unit cost is COMPUTED (pack_cost / pack_qty), never stored rounded.
    const subItems = rowsOf(q(
      `SELECT id, name, supplier, pack_description, pack_cost_pence, pack_qty, unit_of_measure, cost_source, updated_at
         FROM sub_items ORDER BY name`))
      .map((s) => ({ ...s, unit_cost: (num(s.pack_cost_pence) != null && num(s.pack_qty)) ? num(s.pack_cost_pence) / num(s.pack_qty) : null }));

    // Products (live SKUs) + recipe completeness + computed product cost. A product is "costed" iff it
    // has ≥1 recipe line AND none of its ingredients is missing pack cost/qty.
    const products = rowsOf(q(
      `SELECT p.id, p.lightspeed_sku, p.name, p.category,
          (SELECT COUNT(*) FROM recipe_lines rl WHERE rl.product_id = p.id) AS line_count,
          (SELECT COUNT(*) FROM recipe_lines rl JOIN sub_items si ON si.id = rl.sub_item_id
             WHERE rl.product_id = p.id AND (si.pack_cost_pence IS NULL OR si.pack_qty IS NULL)) AS uncosted_lines,
          (SELECT SUM(rl.quantity * CAST(si.pack_cost_pence AS REAL) / si.pack_qty)
             FROM recipe_lines rl JOIN sub_items si ON si.id = rl.sub_item_id WHERE rl.product_id = p.id) AS product_cost
         FROM products p`));

    // Sales volume per SKU (from Slice 1) — used to SORT the worklist (biggest sellers first) + compute
    // coverage % of net sales. The table does not exist until the sales ingest runs; safeSelect returns
    // ok:false → salesWired=false and we sort by name + show "awaiting sales data" (never fabricate).
    // Slice 1 lands sales as AGGREGATES (sales_by_product), not per-line rows. total_amount_pence is gross —
    // a fine weight for the "biggest sellers first" worklist + coverage %. Table absent until the sales
    // ingest runs → safeSelect ok:false → salesWired=false → sort by name + "awaiting sales data".
    const salesRes = q(
      `SELECT sku, SUM(total_amount_pence) AS net, SUM(quantity) AS units
         FROM sales_by_product GROUP BY sku`);
    const salesWired = !!(salesRes && salesRes.ok);
    const salesBySku = new Map();
    for (const r of rowsOf(salesRes)) salesBySku.set(String(r.sku), { net: num(r.net) || 0, units: num(r.units) || 0 });

    for (const p of products) {
      const s = salesBySku.get(String(p.lightspeed_sku));
      p.net_sales = s ? s.net : 0;
      p.units = s ? s.units : 0;
      p.costed = num(p.line_count) > 0 && num(p.uncosted_lines) === 0;
      p.seen_in_sales = !!s; // a recipe whose SKU isn't in sales = a stray (drift/typo) — surfaced, not hidden
    }
    products.sort((a, b) => (salesWired ? (b.net_sales - a.net_sales) : String(a.name || a.id).localeCompare(String(b.name || b.id))));

    // Coverage: % of net sales whose product is fully costed (only meaningful once sales flow).
    let coverage = null;
    if (salesWired) {
      const totalNet = products.reduce((t, p) => t + p.net_sales, 0);
      const costedNet = products.filter((p) => p.costed).reduce((t, p) => t + p.net_sales, 0);
      coverage = { pct: totalNet > 0 ? costedNet / totalNet : null, costed: products.filter((p) => p.costed).length, total: products.length };
    }
    return { now, subItems, products, salesWired, coverage };
  },

  render(section, ctx) {
    const m = section || {};
    const esc = S.escapeHtml;
    const stamp = m.salesWired
      ? `bill-of-materials · joined to <span class="mono">live sales</span>`
      : `bill-of-materials · <span class="mono">products seed when sales flow</span>`;
    const parts = [];

    // ---- coverage summary (no-fabrication) ----
    parts.push(`<div class="sec-label">Recipe coverage<span class="rule"></span></div>`);
    if (!m.products.length) {
      parts.push(`<div class="banner muted">No products yet — the menu seeds from the live Lightspeed SKUs once the sales ingest is flowing. Define your ingredients now (below); attach recipes to real products once they appear.</div>`);
    } else if (m.coverage) {
      const c = m.coverage;
      parts.push(`<div class="tiles">
        <div class="tile ${c.pct != null && c.pct >= 0.8 ? 'green' : 'amber'}"><div class="lab">Net sales costed</div><div class="val">${pct(c.pct)}</div><div class="sub">recipes cover this share of net sales</div></div>
        <div class="tile"><div class="lab">Products costed</div><div class="val">${esc(String(c.costed))}/${esc(String(c.total))}</div><div class="sub">${esc(String(c.total - c.costed))} uncosted (shown as a gap, never estimated)</div></div>
      </div>`);
    } else {
      parts.push(`<div class="banner muted">${esc(String(m.products.length))} products defined. Coverage % lights up once sales data flows (it weights by what actually sells). Until then, add recipes to any product below.</div>`);
    }

    // ---- ingredients (sub_items) — computed per-unit cost, add/edit form ----
    parts.push(`<div class="sec-label">Ingredients <span class="mono">(${esc(String(m.subItems.length))})</span><span class="rule"></span></div>`);
    parts.push(`<div class="panel"><div class="panel-body">`);
    if (m.subItems.length) {
      const rows = m.subItems.map((s) => `<tr>
        <td class="mono">${esc(s.id)}</td><td>${esc(s.name || '')}</td>
        <td>${esc(s.pack_description || '')}${s.supplier ? ` · <span class="ash">${esc(s.supplier)}</span>` : ''}</td>
        <td class="mono">${gbp(s.pack_cost_pence)}${num(s.pack_qty) != null ? ` / ${esc(String(s.pack_qty))} ${esc(s.unit_of_measure)}` : ''}</td>
        <td class="mono">${s.unit_cost == null ? '<span class="a">no cost yet</span>' : `${(s.unit_cost / 100).toFixed(4)} £/${esc(s.unit_of_measure)}`}</td>
        <td class="mono ash">${esc(s.cost_source || 'manual')}</td></tr>`).join('');
      parts.push(`<table class="tbl"><thead><tr><th>id</th><th>name</th><th>pack</th><th>pack cost</th><th>unit cost (computed)</th><th>source</th></tr></thead><tbody>${rows}</tbody></table>`);
    } else {
      parts.push(`<div class="empty-row">No ingredients yet — add your first below (pack cost + pack qty → the per-unit cost is computed).</div>`);
    }
    // add/edit ingredient — gated form → POST /api/recipe-action upsert_sub_item
    parts.push(`<form class="rc-form" data-rc="sub_item">
      <input name="id" placeholder="id (e.g. bun)" required>
      <input name="name" placeholder="name" required>
      <input name="supplier" placeholder="supplier">
      <input name="pack_description" placeholder="pack (e.g. box of 48)">
      <input name="pack_cost" placeholder="pack cost £" inputmode="decimal">
      <input name="pack_qty" placeholder="usable qty (e.g. 48)" inputmode="decimal">
      <select name="unit_of_measure"><option value="each">each</option><option value="g">g</option><option value="ml">ml</option><option value="portion">portion</option></select>
      <button class="btn" type="submit">Save ingredient</button>
    </form>`);
    parts.push(`</div></div>`);

    // ---- products worklist (biggest sellers first) + per-product recipe ----
    parts.push(`<div class="sec-label">Products <span class="mono">(top-down by ${m.salesWired ? 'sales' : 'name'})</span><span class="rule"></span></div>`);
    parts.push(`<div class="panel"><div class="panel-body">`);
    if (m.products.length) {
      const opts = m.subItems.map((s) => `<option value="${esc(s.id)}">${esc(s.id)} — ${esc(s.name || '')}</option>`).join('');
      const rows = m.products.map((p) => {
        const badge = p.costed ? `<span class="chip green">costed ${gbp(p.product_cost)}</span>`
          : num(p.line_count) > 0 ? `<span class="chip amber">partial · ${esc(String(p.uncosted_lines))} ingredient(s) uncosted</span>`
            : `<span class="chip">no recipe</span>`;
        const stray = (m.salesWired && !p.seen_in_sales) ? ` <span class="chip amber">SKU not in live sales</span>` : '';
        const sales = m.salesWired ? `<span class="ash mono">${gbp(p.net_sales)} net · ${esc(String(Math.round(p.units)))} sold</span>` : '';
        return `<div class="rc-prod">
          <div class="rc-prod-head"><span class="mono">${esc(p.lightspeed_sku)}</span> <b>${esc(p.name || '')}</b> ${badge}${stray} ${sales}</div>
          <form class="rc-form" data-rc="recipe_line">
            <input type="hidden" name="product_id" value="${esc(p.id)}">
            <select name="sub_item_id" required><option value="">add ingredient…</option>${opts}</select>
            <input name="quantity" placeholder="qty (in the ingredient's unit)" inputmode="decimal" required>
            <button class="btn" type="submit">Add to recipe</button>
          </form></div>`;
      }).join('');
      parts.push(rows);
    } else {
      parts.push(`<div class="empty-row">Products appear here once the Lightspeed sales ingest seeds them (real current menu).</div>`);
    }
    parts.push(`</div></div>`);

    // ---- CSV bulk import (PRIMARY first-load) + pre-filled template ----
    parts.push(`<div class="sec-label">Bulk import<span class="rule"></span></div>`);
    parts.push(`<div class="panel"><div class="panel-body">
      <p class="ash">Fill ~30–40 recipes in one sitting. Two CSVs, both through the same validation; a bad row is reported, never silently imported.</p>
      <p><b>1. Ingredients</b> — columns: <span class="mono">id,name,supplier,pack_description,pack_cost,pack_qty,unit_of_measure</span> (pack_cost in £; unit ∈ each/g/ml/portion)</p>
      <div class="rc-import" data-kind="sub_items"><input type="file" accept=".csv"><button class="btn rc-import-btn" type="button">Import ingredients</button><span class="rc-result ash"></span></div>
      <p style="margin-top:.8rem"><b>2. Recipes</b> — columns: <span class="mono">product_sku,product_name,sub_item_id,quantity</span> — attach ingredients to your REAL SKUs. <a class="btn" href="/api/recipe-template">Download template (pre-filled with your live products)</a></p>
      <div class="rc-import" data-kind="recipes"><input type="file" accept=".csv"><button class="btn rc-import-btn" type="button">Import recipes</button><span class="rc-result ash"></span></div>
    </div></div>`);

    // No clientScript here — the recipe form/import wiring lives in shared.js clientScript() (keyed by
    // the data-rc / data-kind attributes above), so this page module makes no network call itself
    // (the SELECT-only page boundary, enforced by the boundary test which now covers this page too).
    return { stamp, body: parts.join('\n') };
  },
};
